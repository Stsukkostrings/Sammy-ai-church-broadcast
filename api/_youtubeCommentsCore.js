const auth = require('../lib/auth/supabase');
const { channelForRequest, accountHeaders } = require('../lib/auth/youtube-context');
const store = require('../lib/db/tenant-store');
const aiService = require('../lib/ai/ai-service');
const { checkRateLimit, retryAfterSeconds } = require('../lib/security/rate-limit');

const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3';
const MAX_COMMENT_PAGES = 10;
const MAX_CLASSIFICATIONS_PER_SYNC = 12;
const MAX_REPLY_LOOKUPS_PER_SYNC = 20;
const MAX_BODY_BYTES = 64 * 1024;

function json(statusCode, body, headers = {}) {
    return { statusCode, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }, body: JSON.stringify(body) };
}

function parseBody(req) {
    if (req.omnicastParsedBody) return Promise.resolve(req.omnicastParsedBody);
    const done = (value) => { req.omnicastParsedBody = value; return value; };
    if (req.body && typeof req.body === 'object') return Promise.resolve(done(req.body));
    if (typeof req.body === 'string') {
        try { return Promise.resolve(done(JSON.parse(req.body || '{}'))); }
        catch (_) { return Promise.reject(Object.assign(new Error('Request must contain valid JSON.'), { status: 400, code: 'INVALID_INPUT' })); }
    }
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let settled = false;
        const fail = (error) => { if (!settled) { settled = true; reject(error); } };
        const onData = chunk => {
            if (settled) return;
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += buf.length;
            if (size > MAX_BODY_BYTES) return fail(Object.assign(new Error('Request is too large.'), { status: 413, code: 'INPUT_TOO_LARGE' }));
            chunks.push(buf);
        };
        const onEnd = () => {
            if (settled) return;
            try {
                const value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
                settled = true;
                resolve(done(value));
            } catch (_) { fail(Object.assign(new Error('Request must contain valid JSON.'), { status: 400, code: 'INVALID_INPUT' })); }
        };
        const onError = error => fail(error);
        req.on('data', onData);
        req.on('end', onEnd);
        req.on('error', onError);
    });
}

/* Reads never need CSRF protection. Every state-changing request must present
 * an Origin that matches the deployment or APP_BASE_URL before any account or
 * database work is performed. */
function sameOrigin(req) {
    if (!req.method || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
    return auth.isSameOrigin(req);
}

function methodAllowed(req) {
    return ['GET', 'HEAD', 'POST', 'OPTIONS'].includes(String(req.method || '').toUpperCase());
}

async function getContext(req) {
    const context = await channelForRequest(req);
    if (!context.error) return context;
    return { ...context, response: json(context.error.status || 401, { ok: false, code: context.error.code, error: context.error.message }, accountHeaders(context)) };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12_000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

async function googleGet(url, token) {
    const response = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
    let details = {};
    try { details = await response.json(); } catch (_) {}
    if (!response.ok) {
        const status = response.status;
        const reason = details?.error?.errors?.[0]?.reason || '';
        if (status === 429 || reason === 'quotaExceeded' || reason === 'rateLimitExceeded' || reason === 'dailyLimitExceeded') {
            throw Object.assign(new Error('YouTube API quota or rate limit reached. Please try again later.'), { status: 429, code: 'YOUTUBE_QUOTA' });
        }
        if (status === 401 || status === 403) {
            throw Object.assign(new Error('YouTube authorization expired or was revoked. Reconnect the channel.'), { status: 401, code: 'YOUTUBE_RECONNECT_REQUIRED' });
        }
        throw Object.assign(new Error(details?.error?.message || 'YouTube could not return channel data.'), { status: status >= 500 ? 503 : status, code: 'YOUTUBE_ERROR' });
    }
    return details;
}

async function googlePost(url, token, body) {
    const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body)
    }, 15_000);
    let details = {};
    try { details = await response.json(); } catch (_) {}
    if (!response.ok) {
        const error = Object.assign(new Error(details?.error?.message || 'YouTube could not publish this reply.'), {
            status: response.status,
            code: response.status === 401 || response.status === 403 ? 'YOUTUBE_RECONNECT_REQUIRED' : 'YOUTUBE_PUBLISH_FAILED'
        });
        throw error;
    }
    return details;
}

function authorChannelId(node) {
    const value = node?.authorChannelId;
    if (value && typeof value === 'object') return value.value || value.channelId || null;
    return value || null;
}

function normalizeReply(item, ownerChannelId) {
    const snippet = item?.snippet || {};
    const channelId = authorChannelId(snippet);
    const textOriginal = String(snippet.textOriginal || snippet.textDisplay || '');
    return {
        id: item?.id || snippet.id || null,
        authorDisplayName: String(snippet.authorDisplayName || ''),
        authorChannelId: channelId,
        text: textOriginal,
        textOriginal,
        textDisplay: String(snippet.textDisplay || textOriginal),
        publishedAt: snippet.publishedAt || null,
        likeCount: Number(snippet.likeCount || 0),
        isOwner: !!ownerChannelId && channelId === ownerChannelId
    };
}

function findOwnerReply(replies, ownerChannelId) {
    if (!ownerChannelId) return null;
    return replies.find(reply => reply && reply.authorChannelId === ownerChannelId) || null;
}

async function fetchAllReplies(token, parentId) {
    const replies = [];
    let pageToken = null;
    for (let page = 0; page < 3; page++) {
        const query = new URLSearchParams({
            part: 'snippet',
            parentId,
            maxResults: '100',
            textFormat: 'plainText',
            ...(pageToken ? { pageToken } : {})
        });
        const data = await googleGet(`${YOUTUBE_API}/comments?${query.toString()}`, token);
        for (const item of data.items || []) replies.push(normalizeReply(item, null));
        pageToken = data.nextPageToken;
        if (!pageToken) break;
    }
    return replies;
}

async function normalizeThread(thread, channel, replyLookups) {
    const top = thread?.snippet?.topLevelComment;
    const topSnippet = top?.snippet || {};
    const commentId = top?.id || thread?.snippet?.topLevelComment?.id;
    if (!topSnippet || !commentId) return null;
    const ownerChannelId = channel.channel_id;
    const totalReplyCount = Number(thread.snippet?.totalReplyCount || 0);
    let replies = (thread.replies?.comments || []).map(item => normalizeReply(item, ownerChannelId));
    let repliesIncomplete = false;

    // commentThreads.list commonly exposes only the newest few replies. If the
    // channel already replied deeper in the thread, sync must not call it
    // unanswered (which could lead to a duplicate reply).
    if (totalReplyCount > replies.length && !findOwnerReply(replies, ownerChannelId) && replyLookups.remaining > 0) {
        replyLookups.remaining -= 1;
        try {
            const complete = await fetchAllReplies(channel.accessToken, commentId);
            replies = complete.map(item => normalizeReply(item, ownerChannelId));
            if (replies.length < totalReplyCount) repliesIncomplete = true;
        } catch (_) {
            repliesIncomplete = true;
        }
    } else if (totalReplyCount > replies.length) {
        repliesIncomplete = true;
    }

    const ownerReply = findOwnerReply(replies, ownerChannelId);
    const textOriginal = String(topSnippet.textOriginal || topSnippet.textDisplay || '');
    return {
        comment_id: commentId,
        video_id: thread.snippet?.videoId || null,
        video_title: thread.snippet?.videoTitle || '',
        author_display_name: String(topSnippet.authorDisplayName || ''),
        author_channel_id: authorChannelId(topSnippet),
        text: textOriginal,
        text_display: String(topSnippet.textDisplay || textOriginal),
        text_original: textOriginal,
        published_at: topSnippet.publishedAt || null,
        like_count: Number(topSnippet.likeCount || 0),
        can_reply: thread.snippet?.canReply !== undefined ? !!thread.snippet?.canReply : false,
        total_reply_count: totalReplyCount,
        replies,
        replies_incomplete: repliesIncomplete,
        owner_reply_id: ownerReply?.id || null,
        has_owner_reply: !!ownerReply,
        synced_at: new Date().toISOString()
    };
}

function mergeCommentState(row, existingRow) {
    const hasOwnerReply = !!row.has_owner_reply;
    const wasPublished = existingRow?.replied === true || existingRow?.status === 'published' || existingRow?.publish_status === 'published';
    const published = hasOwnerReply || wasPublished;
    const status = published ? 'published' : existingRow?.status === 'draft' ? 'draft' : 'unanswered';
    return {
        ...row,
        category: existingRow?.category || null,
        language: existingRow?.language || null,
        flagged: existingRow?.flagged || false,
        status,
        replied: published,
        reply_id: row.owner_reply_id || existingRow?.reply_id || null,
        publish_status: published ? 'published' : (existingRow?.publish_status && existingRow.publish_status !== 'published' ? existingRow.publish_status : 'idle')
    };
}

async function generateGeminiDraft(comment, languageHint) {
    const prompt = `Comment: ${String(comment.text || '').slice(0, 4000)}\nAuthor: ${String(comment.authorDisplayName || 'Viewer').slice(0, 100)}\nLanguage hint: ${languageHint || 'auto'}\n\nDraft a natural, concise reply in the same language. Return only the reply text.`;
    return (await aiService.generateForModule('comments', prompt, { maxOutputTokens: 256 })).text;
}

async function classifyComment(comment) {
    const prompt = `Classify this YouTube comment. Return JSON only.\nComment: "${String(comment.text || '').slice(0, 4000)}"\nCategories: Praise and appreciation, General questions, Prayer requests, Testimonies, Biblical discussions, Criticism, Music requests, Business enquiries, Spam, Offensive comments, Other\nDetect language (en, yo, pcm, or other code).\nFlag if needs human review (true if offensive/spam/business enquiries/medical/legal financial certainty needed).\nReturn: {"category":"...","language":"...","flag":true/false}`;
    const result = await aiService.generateJson({ module: 'comments', prompt, temperature: 0.3, maxOutputTokens: 128 });
    const data = result?.data || {};
    return {
        category: String(data.category || 'Other').slice(0, 60),
        language: String(data.language || 'en').slice(0, 15),
        flag: !!data.flag
    };
}

async function classifyRows(rows, context, budget) {
    if (!process.env.GEMINI_API_KEY) {
        budget.warning = 'AI classification is not configured. Comments were saved without AI labels.';
        return [];
    }
    const changed = [];
    for (const row of rows) {
        if (budget.warning || budget.remaining <= 0) break;
        if (row.category && row.language) continue;
        const slot = await checkRateLimit({
            user: context.user,
            accessToken: context.accessToken,
            bucket: 'ai_classify',
            limit: 6,
            windowMs: 60_000
        });
        if (!slot.allowed) {
            budget.warning = 'AI classification paused for rate limiting. Comments were saved and can be classified on a later sync.';
            break;
        }
        try {
            const classification = await classifyComment({ text: row.text });
            row.category = classification.category;
            row.language = classification.language;
            row.flagged = classification.flag;
            budget.remaining -= 1;
            changed.push(row);
        } catch (error) {
            budget.warning = `Comments were saved, but AI classification stopped: ${error.message || 'temporary AI failure.'}`;
            break;
        }
    }
    return changed;
}

function mapComment(row) {
    const published = row.replied === true || row.status === 'published' || row.publish_status === 'published';
    return {
        id: row.comment_id,
        commentId: row.comment_id,
        videoId: row.video_id,
        videoTitle: row.video_title,
        authorDisplayName: row.author_display_name,
        authorChannelId: row.author_channel_id,
        text: row.text,
        textOriginal: row.text_original || row.text,
        textDisplay: row.text_display || row.text,
        publishedAt: row.published_at,
        likeCount: row.like_count,
        canReply: row.can_reply,
        totalReplyCount: row.total_reply_count,
        replies: Array.isArray(row.replies) ? row.replies : [],
        repliesIncomplete: row.replies_incomplete === true,
        hasOwnerReply: row.has_owner_reply === true || published,
        category: row.category,
        language: row.language,
        flagged: row.flagged,
        status: row.status,
        replied: published,
        publishStatus: row.publish_status || 'idle',
        replyId: row.reply_id,
        channelId: row.channel_id
    };
}

function mapDraft(row) {
    return { id: row.comment_id, commentId: row.comment_id, channelId: row.channel_id, text: row.text, status: row.status, edited: row.edited, createdAt: row.created_at, updatedAt: row.updated_at };
}

function mapPublished(row) {
    return { id: row.reply_id, replyId: row.reply_id, commentId: row.comment_id, channelId: row.channel_id, text: row.text, publishedAt: row.published_at, status: 'published' };
}

function parsePagination(req) {
    const url = new URL(req.url || '/', `http://${req.headers?.host || 'localhost'}`);
    const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit')) || 200));
    const offset = Math.max(0, Math.min(100_000, Number(url.searchParams.get('offset')) || 0));
    return { limit, offset };
}

async function listCommentsHandler(req) {
    const context = await getContext(req);
    if (context.response) return context.response;
    try {
        if (typeof store.recoverStalePublish === 'function') {
            await store.recoverStalePublish(context.user, context.accessToken, context.channelId).catch(() => {});
        }
        const { limit, offset } = parsePagination(req);
        const commentsPromise = typeof store.listCommentsPage === 'function'
            ? store.listCommentsPage(context.user, context.accessToken, context.channelId, { limit, offset })
            : store.listComments(context.user, context.accessToken, context.channelId);
        const [comments, drafts, published] = await Promise.all([
            commentsPromise,
            store.listDrafts(context.user, context.accessToken, context.channelId),
            store.listPublished(context.user, context.accessToken, context.channelId)
        ]);
        const publishedIds = new Set((published || []).map(item => item.comment_id));
        const visibleDrafts = (drafts || []).filter(item => !publishedIds.has(item.comment_id));
        const paged = typeof store.listCommentsPage === 'function';
        return json(200, {
            ok: true,
            comments: (comments || []).map(mapComment),
            drafts: visibleDrafts.map(mapDraft),
            published: (published || []).map(mapPublished),
            pagination: paged ? { limit, offset, hasMore: (comments || []).length === limit } : null,
            sync: { lastSync: context.channel.last_synced_at, count: context.channel.last_sync_count || 0 }
        }, accountHeaders(context));
    } catch (error) { return json(error.status || 503, { ok: false, error: error.message }, accountHeaders(context)); }
}

async function fetchVideoTitles(token, videoIds) {
    if (!videoIds || videoIds.length === 0) return {};
    const unique = [...new Set(videoIds.filter(Boolean))];
    const titles = {};
    for (let i = 0; i < unique.length; i += 50) {
        const batch = unique.slice(i, i + 50);
        try {
            const data = await googleGet(`${YOUTUBE_API}/videos?part=snippet&id=${batch.map(encodeURIComponent).join(',')}`, token);
            for (const item of data.items || []) {
                if (item.id && item.snippet?.title) titles[item.id] = item.snippet.title;
            }
        } catch (_) {}
    }
    return titles;
}

async function syncCommentsHandler(req) {
    const context = await getContext(req);
    if (context.response) return context.response;
    if (!sameOrigin(req)) return json(403, { ok: false, error: 'Request origin not allowed.' });

    const syncSlot = await checkRateLimit({
        user: context.user,
        accessToken: context.accessToken,
        bucket: 'comments_sync',
        limit: 3,
        windowMs: 5 * 60_000
    });
    if (!syncSlot.allowed) {
        return json(429, {
            ok: false,
            code: 'SYNC_RATE_LIMIT',
            error: 'Comments were synced recently. Please wait a few minutes before syncing again.',
            retryAfter: retryAfterSeconds(syncSlot)
        }, { ...accountHeaders(context), 'Retry-After': String(retryAfterSeconds(syncSlot)) });
    }

    const channel = context.channel;
    let totalSaved = 0;
    let allRows = [];
    try {
        const existing = await store.listComments(context.user, context.accessToken, channel.channel_id);
        const existingMap = new Map(existing.map(item => [item.comment_id, item]));
        const aiBudget = { remaining: MAX_CLASSIFICATIONS_PER_SYNC, warning: '' };
        const replyLookups = { remaining: MAX_REPLY_LOOKUPS_PER_SYNC };
        let pageToken = null;
        let pages = 0;
        let hasMore = false;

        while (pages < MAX_COMMENT_PAGES) {
            const query = new URLSearchParams({
                part: 'snippet,replies',
                allThreadsRelatedToChannelId: channel.channel_id,
                maxResults: '100',
                order: 'time',
                textFormat: 'plainText',
                ...(pageToken ? { pageToken } : {})
            });
            const threads = await googleGet(`${YOUTUBE_API}/commentThreads?${query.toString()}`, channel.accessToken);
            const items = threads.items || [];
            if (items.length === 0) break;

            const pageRows = [];
            for (const thread of items) {
                const normalized = await normalizeThread(thread, channel, replyLookups);
                if (!normalized) continue;
                const existingRow = existingMap.get(normalized.comment_id);
                pageRows.push(mergeCommentState(normalized, existingRow));
            }
            if (pageRows.length) {
                const body = pageRows.map(row => ({ ...row, user_id: context.user.id, channel_id: channel.channel_id }));
                const stored = await store.upsertComments(context.user, context.accessToken, body);
                const confirmedRows = Array.isArray(stored) ? stored : [];
                totalSaved += confirmedRows.length;
                allRows = allRows.concat(confirmedRows);
                for (const row of confirmedRows) existingMap.set(row.comment_id, row);
                if (confirmedRows.length !== body.length) {
                    throw Object.assign(new Error('The database confirmed only part of this comment page.'), {
                        status: 503, code: 'PARTIAL_PERSISTENCE'
                    });
                }

                // Comments are durable before any Gemini call. A temporary AI
                // outage therefore never discards successfully retrieved data.
                const classified = await classifyRows(pageRows, context, aiBudget);
                if (classified.length) {
                    await store.upsertComments(context.user, context.accessToken, classified.map(row => ({
                        ...row, user_id: context.user.id, channel_id: channel.channel_id
                    }))).catch(() => {});
                }
            }
            pageToken = threads.nextPageToken;
            pages += 1;
            if (!pageToken) break;
            hasMore = true;
        }

        const videoTitles = await fetchVideoTitles(channel.accessToken, allRows.map(row => row.video_id));
        const titled = allRows.filter(row => row.video_id && videoTitles[row.video_id] && row.video_title !== videoTitles[row.video_id]);
        for (const row of titled) row.video_title = videoTitles[row.video_id];
        if (titled.length) {
            await store.upsertComments(context.user, context.accessToken, titled.map(row => ({
                ...row, user_id: context.user.id, channel_id: channel.channel_id
            }))).catch(() => {});
        }

        const syncedAt = new Date().toISOString();
        await store.updateChannelSync(context.user, context.accessToken, channel.channel_id, totalSaved || allRows.length, syncedAt);
        const all = await store.listComments(context.user, context.accessToken, channel.channel_id);
        return json(200, {
            ok: true,
            synced: totalSaved,
            hasMore,
            comments: all.map(mapComment),
            ...(aiBudget.warning ? { warning: aiBudget.warning } : {})
        }, accountHeaders(context));
    } catch (error) {
        if (totalSaved > 0) {
            await store.updateChannelSync(context.user, context.accessToken, channel.channel_id, totalSaved).catch(() => {});
            return json(error.status || 503, {
                ok: false,
                partial: true,
                synced: totalSaved,
                code: error.code,
                error: `${error.message || 'Sync was interrupted.'} The ${totalSaved} comments saved before the interruption were preserved.`
            }, accountHeaders(context));
        }
        return json(error.status || 503, { ok: false, code: error.code, error: error.message }, accountHeaders(context));
    }
}

async function generateDraftHandler(req) {
    const context = await getContext(req);
    if (context.response) return context.response;
    if (!sameOrigin(req)) return json(403, { ok: false, error: 'Request origin not allowed.' });
    try {
        const { commentId, regenerate } = await parseBody(req);
        if (typeof commentId !== 'string' || !commentId) return json(400, { ok: false, error: 'Comment id required.' });
        const comment = await store.getComment(context.user, context.accessToken, context.channelId, commentId);
        if (!comment) return json(404, { ok: false, error: 'Comment not found.' });
        const cached = regenerate === true ? null : await store.getDraft(context.user, context.accessToken, context.channelId, commentId);
        if (cached?.text) return json(200, { ok: true, draft: mapDraft(cached), cached: true }, accountHeaders(context));

        const aiSlot = await checkRateLimit({
            user: context.user,
            accessToken: context.accessToken,
            bucket: 'ai_draft',
            limit: 10,
            windowMs: 60_000
        });
        if (!aiSlot.allowed) {
            return json(429, {
                ok: false,
                code: 'APP_RATE_LIMIT',
                error: 'Too many AI drafts in a short time. Please wait a minute and try again.',
                retryAfter: retryAfterSeconds(aiSlot)
            }, { ...accountHeaders(context), 'Retry-After': String(retryAfterSeconds(aiSlot)) });
        }

        const text = await generateGeminiDraft(mapComment(comment), comment.language);
        const row = await store.upsertDraft(context.user, context.accessToken, {
            channel_id: context.channelId, comment_id: commentId, text, status: 'draft', edited: false, updated_at: new Date().toISOString()
        });
        await store.updateComment(context.user, context.accessToken, context.channelId, commentId, { status: 'draft' });
        return json(200, { ok: true, draft: mapDraft(row) }, accountHeaders(context));
    } catch (error) { return json(error.status || 503, { ok: false, code: error.code, error: error.message }, accountHeaders(context)); }
}

async function saveDraftHandler(req) {
    const context = await getContext(req);
    if (context.response) return context.response;
    if (!sameOrigin(req)) return json(403, { ok: false, error: 'Request origin not allowed.' });
    try {
        const { commentId, text } = await parseBody(req);
        if (typeof commentId !== 'string' || typeof text !== 'string' || !commentId || !text.trim() || text.length > 5000) return json(400, { ok: false, error: 'Enter a reply under 5,000 characters.' });
        const comment = await store.getComment(context.user, context.accessToken, context.channelId, commentId);
        if (!comment) return json(404, { ok: false, error: 'Comment not found.' });
        if (comment.replied || comment.status === 'published') return json(409, { ok: false, code: 'ALREADY_PUBLISHED', error: 'This comment already has a published owner reply.' });
        const row = await store.upsertDraft(context.user, context.accessToken, {
            channel_id: context.channelId, comment_id: commentId, text: text.trim(), status: 'draft', edited: true, updated_at: new Date().toISOString()
        });
        await store.updateComment(context.user, context.accessToken, context.channelId, commentId, { status: 'draft' });
        return json(200, { ok: true, draft: mapDraft(row) }, accountHeaders(context));
    } catch (error) { return json(error.status || 503, { ok: false, error: error.message }, accountHeaders(context)); }
}

async function markCommentState(context, commentId, updates) {
    if (typeof store.updateComment !== 'function') return;
    await store.updateComment(context.user, context.accessToken, context.channelId, commentId, updates).catch(() => {});
}

async function publishReplyHandler(req) {
    const context = await getContext(req);
    if (context.response) return context.response;
    if (!sameOrigin(req)) return json(403, { ok: false, error: 'Request origin not allowed.' });
    try {
        const body = await parseBody(req);
        const commentId = body.commentId;
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        if (typeof commentId !== 'string' || !commentId || !text || text.length > 5000) return json(400, { ok: false, error: 'A valid comment and reply text are required.' });

        if (typeof store.recoverStalePublish === 'function') {
            await store.recoverStalePublish(context.user, context.accessToken, context.channelId, commentId).catch(() => {});
        }
        const comment = await store.getComment(context.user, context.accessToken, context.channelId, commentId);
        if (!comment) return json(404, { ok: false, error: 'Comment not found.' });
        if (comment.replied || comment.status === 'published' || comment.publish_status === 'published') {
            return json(409, { ok: false, code: 'PUBLISH_IN_PROGRESS_OR_COMPLETE', error: 'This reply has already been published.' });
        }
        if (comment.publish_status === 'reconciliation_required') {
            return json(409, {
                ok: false,
                code: 'PUBLISH_RECONCILIATION_REQUIRED',
                error: 'A previous publish attempt has an unknown outcome. Check the YouTube comment or run reconciliation before retrying.'
            });
        }
        if (comment.publish_status === 'publishing') {
            return json(409, { ok: false, code: 'PUBLISH_IN_PROGRESS_OR_COMPLETE', error: 'This reply is already publishing.' });
        }

        const claimed = await store.claimPublish(context.user, context.accessToken, context.channelId, commentId);
        if (!claimed) return json(409, { ok: false, code: 'PUBLISH_IN_PROGRESS_OR_COMPLETE', error: 'This reply is already publishing or has already been published.' });
        let result;
        try {
            result = await googlePost(`${YOUTUBE_API}/comments?part=snippet`, context.channel.accessToken, { snippet: { parentId: commentId, textOriginal: text } });
        } catch (error) {
            const definiteClientRejection = Number.isInteger(error.status) && error.status >= 400 && error.status < 500;
            if (definiteClientRejection) {
                await store.releasePublish(context.user, context.accessToken, context.channelId, commentId).catch(() => {});
                return json(error.status === 403 ? 409 : error.status || 502, { ok: false, code: error.code || 'YOUTUBE_PUBLISH_FAILED', error: error.message }, accountHeaders(context));
            }
            await markCommentState(context, commentId, { publish_status: 'reconciliation_required' });
            return json(503, {
                ok: false,
                code: 'PUBLISH_OUTCOME_UNCERTAIN',
                retryable: false,
                reconcile: true,
                error: 'YouTube did not confirm the publish outcome. The reply was not automatically retried. Check the YouTube comment or run reconciliation.'
            }, accountHeaders(context));
        }
        if (!result?.id) {
            await markCommentState(context, commentId, { publish_status: 'reconciliation_required' });
            return json(503, { ok: false, code: 'PUBLISH_RECONCILIATION_REQUIRED', retryable: false, reconcile: true, error: 'YouTube returned no reply id. Check the YouTube comment before retrying.' }, accountHeaders(context));
        }
        try {
            await store.completePublish(context.user, context.accessToken, context.channelId, commentId, result.id, text);
        } catch (_) {
            await markCommentState(context, commentId, { publish_status: 'reconciliation_required', reply_id: result.id });
            return json(503, { ok: false, code: 'PUBLISH_RECONCILIATION_REQUIRED', retryable: false, reconcile: true, error: 'YouTube accepted the reply, but its history could not be saved. Do not retry; run reconciliation.' }, accountHeaders(context));
        }
        return json(200, { ok: true, published: { id: result.id, replyId: result.id, commentId, channelId: context.channelId, text, publishedAt: new Date().toISOString(), status: 'published' } }, accountHeaders(context));
    } catch (error) {
        return json(error.status || 503, { ok: false, code: error.code, error: error.message || 'Publishing failed.' }, accountHeaders(context));
    }
}

async function reconcilePublishHandler(req) {
    const context = await getContext(req);
    if (context.response) return context.response;
    if (!sameOrigin(req)) return json(403, { ok: false, error: 'Request origin not allowed.' });
    try {
        const body = await parseBody(req);
        const commentId = body.commentId;
        if (typeof commentId !== 'string' || !commentId) return json(400, { ok: false, error: 'Comment id required.' });
        const comment = await store.getComment(context.user, context.accessToken, context.channelId, commentId);
        if (!comment) return json(404, { ok: false, error: 'Comment not found.' });
        if (comment.replied || comment.status === 'published' || comment.publish_status === 'published') {
            return json(200, { ok: true, published: true, message: 'This comment is already recorded as published.' }, accountHeaders(context));
        }
        if (!['publishing', 'reconciliation_required', 'uncertain'].includes(comment.publish_status)) {
            return json(409, { ok: false, code: 'NOT_RECONCILABLE', error: 'This comment has no unresolved publish attempt.' });
        }

        const query = new URLSearchParams({ part: 'snippet,replies', id: commentId, textFormat: 'plainText' });
        const threadData = await googleGet(`${YOUTUBE_API}/commentThreads?${query.toString()}`, context.channel.accessToken);
        const thread = (threadData.items || [])[0];
        const replies = (thread?.replies?.comments || []).map(item => normalizeReply(item, context.channelId));
        let ownerReply = findOwnerReply(replies, context.channelId);
        if (!ownerReply) {
            const complete = await fetchAllReplies(context.channel.accessToken, commentId).catch(() => []);
            ownerReply = findOwnerReply(complete.map(item => normalizeReply(item, context.channelId)), context.channelId);
        }
        if (ownerReply?.id) {
            await store.completePublish(context.user, context.accessToken, context.channelId, commentId, ownerReply.id, ownerReply.text);
            return json(200, { ok: true, reconciled: true, published: { id: ownerReply.id, commentId, channelId: context.channelId, text: ownerReply.text } }, accountHeaders(context));
        }
        await store.releasePublish(context.user, context.accessToken, context.channelId, commentId);
        return json(200, { ok: true, reconciled: true, published: false, message: 'No owner reply was found on YouTube. The comment is unlocked for a fresh publish attempt.' }, accountHeaders(context));
    } catch (error) { return json(error.status || 503, { ok: false, code: error.code, error: error.message }, accountHeaders(context)); }
}

async function commentsApiHandler(req) {
    const url = new URL(req.url || '/', `http://${req.headers?.host || 'localhost'}`);
    const route = url.pathname;
    const method = String(req.method || '').toUpperCase();
    if (!methodAllowed(req)) return json(405, { ok: false, error: 'Method not allowed.' }, { Allow: 'GET, HEAD, POST, OPTIONS' });
    if (method === 'OPTIONS') return json(204, { ok: true }, { Allow: 'GET, HEAD, POST, OPTIONS' });
    if (method === 'GET' && route.includes('list')) return listCommentsHandler(req);
    if (method === 'HEAD' && route.includes('list')) return { statusCode: 200, headers: { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' }, body: '' };

    if (!sameOrigin(req)) return json(403, { ok: false, error: 'Request origin not allowed.' });
    if (method === 'POST' && route.includes('sync')) return syncCommentsHandler(req);
    if (method === 'POST' && route.includes('generate')) return generateDraftHandler(req);
    if (method === 'POST' && route.includes('reconcile')) return reconcilePublishHandler(req);
    if (method === 'POST' && route.includes('draft')) return saveDraftHandler(req);
    if (method === 'POST' && route.includes('publish')) return publishReplyHandler(req);

    /* Backwards-compatible action routing for /api/youtube-comments. */
    if (method === 'POST' && /\/youtube-comments\/?$/.test(route)) {
        let action;
        try { action = String((await parseBody(req)).action || '').toLowerCase(); }
        catch (error) { return json(error.status || 400, { ok: false, error: error.message }); }
        if (action === 'draft') return saveDraftHandler(req);
        if (action === 'generate') return generateDraftHandler(req);
        if (action === 'sync') return syncCommentsHandler(req);
        if (action === 'publish') return publishReplyHandler(req);
        if (action === 'reconcile') return reconcilePublishHandler(req);
        return json(400, { ok: false, error: 'Unknown comment action.' });
    }

    return json(405, { ok: false, error: 'Method not allowed.' }, { Allow: 'GET, POST' });
}

module.exports = {
    commentsApiHandler,
    // Exported for focused unit tests and safe operational diagnostics.
    _private: { normalizeReply, findOwnerReply, normalizeThread, mergeCommentState, syncCommentsHandler, reconcilePublishHandler, parseBody }
};
