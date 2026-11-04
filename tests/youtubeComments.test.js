const assert = require('assert');
const { Readable } = require('stream');
const commentsCore = require('../api/_youtubeCommentsCore');
const geminiCommentsCore = require('../api/_geminiCommentsCore');
const youtubeCore = require('../api/_youtubeCore');
const creatorFlowCore = require('../api/_creatorFlowCore');

const store = new Map();
const sets = new Map();
const geminiCalls = [];
const youtubeCalls = [];
const originalFetch = global.fetch;
const originalEnv = { ...process.env };

const CHANNEL = {
    id: 'UCspiritflow123',
    snippet: { title: 'SpiritFlow Sounds', description: 'Christian worship music and gospel messages.', customUrl: '@spiritflow' },
    statistics: { subscriberCount: 1200, viewCount: 9000, videoCount: 3 },
    contentDetails: { relatedPlaylists: { uploads: 'UUspiritflow123' } }
};

const VIDEO = {
    id: 'video-1',
    snippet: { title: 'Moses Saw This Happen', publishedAt: '2026-09-01T10:00:00Z' },
    statistics: { viewCount: 1200, commentCount: 5 }
};

const COMMENT_THREAD_PAGE_1 = {
    items: [
        {
            id: 'comment-1',
            snippet: {
                videoId: 'video-1',
                totalReplyCount: 0,
                topLevelComment: {
                    authorDisplayName: 'Faithful Viewer',
                    authorChannelId: 'UCviewer1',
                    textOriginal: 'God is faithful!',
                    publishedAt: '2026-10-29T09:00:00Z',
                    likeCount: 4,
                    replyCount: 0
                }
            }
        }
    ],
    nextPageToken: 'page-2'
};

const COMMENT_THREAD_PAGE_2 = {
    items: [
        {
            id: 'comment-2',
            snippet: {
                videoId: 'video-1',
                totalReplyCount: 0,
                topLevelComment: {
                    authorDisplayName: 'Grace O',
                    authorChannelId: 'UCviewer2',
                    textOriginal: 'Wetin dey happen for my spirit today?',
                    publishedAt: '2026-10-30T08:00:00Z',
                    likeCount: 2,
                    replyCount: 0
                }
            }
        }
    ]
};

function jsonResponse(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function installMocks() {
    process.env.SESSION_SECRET = 'test-session-secret-with-enough-length';
    process.env.UPSTASH_REDIS_REST_URL = 'https://unit-test-upstash.example';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'unit-test-token';
    process.env.YOUTUBE_CLIENT_ID = 'test-youtube-client-id';
    process.env.YOUTUBE_CLIENT_SECRET = 'test-youtube-client-secret';
    process.env.YOUTUBE_REDIRECT_URI = 'http://localhost:8081/api/youtube-callback';
    process.env.YOUTUBE_SPIRITFLOW_CHANNEL_ID = 'UCspiritflow123';
    process.env.GEMINI_API_KEY = 'gemini-test-key';
    process.env.GEMINI_MODEL = 'gemini-2.0-flash';
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    geminiCalls.length = 0;
    youtubeCalls.length = 0;

    global.fetch = async (url, options = {}) => {
        const rawUrl = String(url);
        if (rawUrl.includes('unit-test-upstash.example')) {
            const command = JSON.parse(options.body);
            const [op, key, ...args] = command;
            let result = null;
            if (op === 'GET') result = store.get(key) || null;
            if (op === 'SET') { store.set(key, args[0]); result = 'OK'; }
            if (op === 'DEL') result = store.delete(key) ? 1 : 0;
            if (op === 'SADD') { if (!sets.has(key)) sets.set(key, new Set()); args.forEach((value) => sets.get(key).add(value)); result = args.length; }
            if (op === 'SMEMBERS') result = [...(sets.get(key) || new Set())];
            return jsonResponse({ result });
        }
        if (rawUrl.includes('oauth2.googleapis.com/token')) {
            return jsonResponse({ access_token: 'ya-access-token', refresh_token: 'ya-refresh-token', expires_in: 3600 });
        }
        if (rawUrl.includes('generativelanguage.googleapis.com')) {
            geminiCalls.push({ url: rawUrl, body: options.body });
            return jsonResponse({
                candidates: [{ content: { parts: [{ text: '{"category":"praise","language":"en","flagged":false,"confidence":0.92}' }] } }]
            });
        }
        if (rawUrl.includes('youtube/v3/channels')) {
            youtubeCalls.push({ url: rawUrl, method: options.method || 'GET' });
            return jsonResponse({ items: [CHANNEL] });
        }
        if (rawUrl.includes('youtube/v3/playlistItems')) {
            return jsonResponse({ items: [{ contentDetails: { videoId: 'video-1' } }] });
        }
        if (rawUrl.includes('youtube/v3/videos')) {
            return jsonResponse({ items: [VIDEO] });
        }
        if (rawUrl.includes('youtube/v3/commentThreads')) {
            const pageToken = new URL(rawUrl).searchParams.get('pageToken');
            return jsonResponse(pageToken ? COMMENT_THREAD_PAGE_2 : COMMENT_THREAD_PAGE_1);
        }
        if (rawUrl.includes('youtube/v3/comments')) {
            youtubeCalls.push({ url: rawUrl, method: options.method || 'POST', body: options.body });
            return jsonResponse({ items: [{ id: 'youtube-reply-1', snippet: { publishedAt: '2026-10-30T10:00:00Z' } }] });
        }
        return jsonResponse({});
    };
}

function restore() {
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
}

function req(method, action, body, cookie = '', urlPath = '/api/creatorflow') {
    const stream = body ? Readable.from([JSON.stringify(body)]) : Readable.from([]);
    stream.method = method;
    stream.url = `http://localhost:8081${urlPath}?action=${action}`;
    stream.headers = { host: 'localhost:8081', cookie };
    return stream;
}

function handlerFor(urlPath) {
    if (urlPath.startsWith('/api/youtube-comments')) return commentsCore.youtubeCommentsHandler;
    if (urlPath.startsWith('/api/gemini-comments')) return geminiCommentsCore.geminiCommentsHandler;
    return creatorFlowCore.creatorFlowHandler;
}

async function call(method, action, body, cookie = '', urlPath = '/api/creatorflow') {
    const handler = handlerFor(urlPath);
    const result = await handler(req(method, action, body, cookie, urlPath));
    const parsed = result.body ? JSON.parse(result.body) : {};
    return { ...result, parsed };
}

function cookieFrom(result) {
    return String(result.headers['Set-Cookie']).split(';')[0];
}

function makeYouTubeCookie() {
    const session = { access_token: 'ya-access-token', refresh_token: 'ya-refresh-token', expires_at: Date.now() + 3600000 };
    const value = youtubeCore.sealSession(session, process.env.SESSION_SECRET);
    const header = youtubeCore.cookie('sf_youtube', value, { maxAge: 60 * 60 * 24 * 30 });
    return header.split(';')[0];
}

async function run() {
    installMocks();

    const config = await call('GET', 'config');
    assert.deepEqual(config.parsed.missing, []);

    const signup = await call('POST', 'signup', {
        name: 'Comment Manager',
        email: 'comment-manager@example.com',
        password: 'password-a',
        channelName: 'SpiritFlow Sounds'
    });
    assert.equal(signup.statusCode, 200);
    const cookie = cookieFrom(signup);

    const status = geminiCommentsCore.getGeminiStatus();
    assert.equal(status.available, true);
    assert.equal(status.freeTierOnly, true);
    assert.equal(status.paidModelBlocked, false);
    assert.equal(status.quotaExhausted, false);

    process.env.GEMINI_MODEL = 'gemini-3-pro';
    const paidStatus = geminiCommentsCore.getGeminiStatus();
    assert.equal(paidStatus.paidModelBlocked, true);
    assert.equal(paidStatus.available, false);
    delete process.env.GEMINI_MODEL;

    const unauth = await call('GET', 'list', null, cookie, '/api/youtube-comments');
    assert.equal(unauth.statusCode, 401);
    assert.match(unauth.parsed.error, /No YouTube channel is connected yet/);

    const listAuth = await call('GET', 'list', null, `${cookie}; ${makeYouTubeCookie()}`, '/api/youtube-comments');
    assert.equal(listAuth.statusCode, 200);
    assert.equal(listAuth.parsed.ok, true);
    assert.equal(listAuth.parsed.comments.length, 2);
    assert.equal(listAuth.parsed.stats.totalComments, 2);
    assert.equal(listAuth.parsed.stats.newComments, 2);
    assert.equal(listAuth.parsed.stats.unansweredComments, 2);
    assert.equal(listAuth.parsed.stats.draftsAwaitingApproval, 0);
    assert.equal(listAuth.parsed.stats.publishedReplies, 0);
    assert.equal(listAuth.parsed.stats.flaggedComments, 0);
    assert.equal(listAuth.parsed.videos.length, 1);
    assert.equal(listAuth.parsed.videos[0].id, 'video-1');
    assert.equal(listAuth.parsed.channel.id, 'UCspiritflow123');
    assert.equal(listAuth.parsed.comments[0].status, 'new');
    const authedCookie = `${cookie}; ${makeYouTubeCookie()}`;

    const syncOne = await call('POST', 'sync', {}, authedCookie, '/api/youtube-comments');
    assert.equal(syncOne.statusCode, 200);
    assert.equal(syncOne.parsed.ok, true);
    assert.equal(syncOne.parsed.fetchedComments, 2);
    assert.equal(syncOne.parsed.storedNew, 2);

    const syncTwo = await call('POST', 'sync', {}, authedCookie, '/api/youtube-comments');
    assert.equal(syncTwo.statusCode, 200);
    assert.equal(syncTwo.parsed.storedNew, 0);
    assert.equal(syncTwo.parsed.duplicates, 2);

    const draftSave = await call('POST', 'draft-save', { commentId: 'comment-1', text: 'Thanks for sharing this worship song with us, friend.', source: 'ai' }, cookie, '/api/youtube-comments');
    assert.equal(draftSave.statusCode, 200);
    assert.equal(draftSave.parsed.draft.status, 'awaiting_approval');
    assert.equal(draftSave.parsed.draft.source, 'ai');

    const publishOne = await call('POST', 'publish', { commentId: 'comment-1' }, authedCookie, '/api/youtube-comments');
    assert.equal(publishOne.statusCode, 200);
    assert.equal(publishOne.parsed.ok, true);
    assert.equal(publishOne.parsed.publishedReplyId, 'youtube-reply-1');

    const publishDuplicate = await call('POST', 'publish', { commentId: 'comment-1' }, authedCookie, '/api/youtube-comments');
    assert.equal(publishDuplicate.statusCode, 409);
    assert.equal(publishDuplicate.parsed.code, 'DUPLICATE_REPLY');

    const flagOne = await call('POST', 'flag', { commentId: 'comment-2', flagged: true, note: 'Sensitive language - human review.' }, cookie, '/api/youtube-comments');
    assert.equal(flagOne.statusCode, 200);
    assert.equal(flagOne.parsed.comment.status, 'flagged');

    const skipOne = await call('POST', 'skip', { commentId: 'comment-2' }, cookie, '/api/youtube-comments');
    assert.equal(skipOne.statusCode, 200);
    assert.equal(skipOne.parsed.comment.status, 'skipped');

    const preferences = await call('GET', 'preferences', null, cookie, '/api/youtube-comments');
    assert.equal(preferences.statusCode, 200);
    assert.equal(preferences.parsed.preferences.preferredLanguage, 'auto');
    assert.equal(preferences.parsed.preferences.tone, 'warm-christian-conversational');

    const savedPreferences = await call('POST', 'preferences', {
        autoLanguageDetection: true,
        preferredLanguage: 'auto',
        tone: 'warm-christian-conversational',
        maxReplyLength: 'short-medium',
        emojiUsage: 'moderate',
        bibleReferences: 'only-where-appropriate',
        style: 'conversational'
    }, cookie, '/api/youtube-comments');
    assert.equal(savedPreferences.statusCode, 200);
    assert.equal(savedPreferences.parsed.preferences.maxReplyLength, 'short-medium');

    const missingDraft = await call('POST', 'draft-save', { commentId: 'comment-does-not-exist', text: 'Hello.' }, cookie, '/api/youtube-comments');
    assert.equal(missingDraft.statusCode, 404);

    // Pure helper coverage: normalization and pagination/dedup.
    const normalized = commentsCore.normalizeYouTubeComment(
        'comment-1',
        {
            videoId: 'video-1',
            title: 'Moses Saw This Happen',
            topLevelComment: { authorDisplayName: 'Faithful Viewer', authorChannelId: 'UCviewer1', textOriginal: 'God is faithful!', publishedAt: '2026-10-29T09:00:00Z', likeCount: 4, replyCount: 2 },
            totalReplyCount: 2
        },
        'Moses Saw This Happen'
    );
    assert.equal(normalized.commentId, 'comment-1');
    assert.equal(normalized.videoId, 'video-1');
    assert.equal(normalized.authorName, 'Faithful Viewer');
    assert.equal(normalized.text, 'God is faithful!');
    assert.equal(normalized.likeCount, 4);
    assert.equal(normalized.replyCount, 2);

    assert.equal(commentsCore.isSpiritFlowChannel({ id: 'UCspiritflow123' }), true);
    assert.equal(commentsCore.isSpiritFlowChannel({ id: 'UCotherchannel' }), false);

    const fetched = await commentsCore.fetchCommentsForVideos('ya-access-token', [{ id: 'video-1', snippet: { title: 'Moses Saw This Happen' } }]);
    assert.equal(fetched.length, 2);
    assert.deepEqual(fetched.map((comment) => comment.commentId).sort(), ['comment-1', 'comment-2']);
    assert.equal(fetched[1].text, 'Wetin dey happen for my spirit today?');

    const geminiBad = await call('POST', 'generate', { commentId: '', comment: { text: '' } }, cookie, '/api/gemini-comments');
    assert.equal(geminiBad.statusCode, 400);
    assert.match(geminiBad.parsed.error, /commentId and comment text are required/);

    const geminiGenerate = await call('POST', 'generate', { commentId: 'comment-1', comment: { text: 'God is faithful to me today.' } }, cookie, '/api/gemini-comments');
    assert.equal(geminiGenerate.statusCode, 200);
    assert.equal(geminiGenerate.parsed.ok, true);
    assert.equal(geminiGenerate.parsed.flagged, false);
    assert.equal(geminiGenerate.parsed.category, 'praise');
    assert.equal(geminiGenerate.parsed.language, 'en');
    assert.equal(typeof geminiGenerate.parsed.draft.text, 'string');
    assert.equal(geminiGenerate.parsed.draft.status, 'awaiting_approval');

    const geminiStatus = await call('GET', 'status', null, cookie, '/api/gemini-comments');
    assert.equal(geminiStatus.statusCode, 200);
    assert.equal(geminiStatus.parsed.ok, true);
    assert.equal(geminiStatus.parsed.available, true);

    const replyResult = await geminiCommentsCore.generateReply({
        comment: { text: 'Please help me dear friend.', category: 'prayer', language: 'yo' },
        preferences: { maxReplyLength: 'short-medium', tone: 'warm-christian-conversational', emojiUsage: 'moderate', bibleReferences: 'only-where-appropriate', style: 'conversational' }
    });
    assert.equal(typeof replyResult.draft, 'string');
    const lastGeminiCall = JSON.parse(geminiCalls[geminiCalls.length - 1].body);
    assert.ok(String(lastGeminiCall.contents[0].parts[0].text).includes('Original comment language: yo'));

    restore();
    console.log('YouTube comment manager tests passed');
}

async function runGeminiQuotaTest() {
    installMocks();
    process.env.GEMINI_API_KEY = 'gemini-test-key';
    process.env.GEMINI_MODEL = 'gemini-2.0-flash';

    global.fetch = async () => new Response(JSON.stringify({ error: { message: 'Quota exceeded for Gemini API.' } }), { status: 429, headers: { 'Content-Type': 'application/json' } });

    let generationError = null;
    try {
        await geminiCommentsCore.generateGeminiContent({ task: 'classify', comment: { text: 'God is faithful!' }, preferences: { maxReplyLength: 'short-medium' } });
    } catch (error) {
        generationError = error;
    }
    assert.ok(generationError);
    assert.equal(generationError.statusCode, 429);
    assert.equal(generationError.code, 'GEMINI_QUOTA_EXHAUSTED');
    assert.equal(geminiCommentsCore.getGeminiStatus().quotaExhausted, true);
    geminiCommentsCore.resetGeminiQuota();
    assert.equal(geminiCommentsCore.getGeminiStatus().quotaExhausted, false);
}

run().then(() => runGeminiQuotaTest()).catch((error) => {
    restore();
    console.error(error);
    process.exit(1);
});
