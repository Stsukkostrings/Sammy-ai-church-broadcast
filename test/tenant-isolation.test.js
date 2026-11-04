const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = 'https://mock-supabase.test';
process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
process.env.SESSION_SECRET = 'development-test-secret-at-least-32-chars';
process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY = 'development-youtube-token-secret-32chars';
process.env.YOUTUBE_CLIENT_ID = 'test-youtube-client';
process.env.YOUTUBE_CLIENT_SECRET = 'test-youtube-secret';
process.env.APP_BASE_URL = 'https://app.test';
process.env.GEMINI_API_KEY = 'mock-only-not-a-real-key';

const identities = new Map([['account-token-a', { id: 'user-a', email: 'a@example.test' }], ['account-token-b', { id: 'user-b', email: 'b@example.test' }]]);
const rows = {
    youtube_channels: [], comments: [], comment_drafts: [], published_replies: [], user_settings: []
};
const { encryptSecret, createAuthSession, seal, CHANNEL_COOKIE, FLOW_COOKIE, SESSION_COOKIE } = require('../lib/auth/supabase');
const auth = require('../lib/auth/supabase');

function makeChannel(userId, channelId, title, youtubeToken) {
    return {
        user_id: userId, channel_id: channelId, channel_title: title,
        access_token_ciphertext: encryptSecret(youtubeToken, `yt-access:${userId}:${channelId}`),
        refresh_token_ciphertext: encryptSecret(`refresh-${youtubeToken}`, `yt-refresh:${userId}:${channelId}`),
        token_expires_at: new Date(Date.now() + 3_600_000).toISOString(), connected_at: new Date().toISOString(),
        last_synced_at: null, last_sync_count: 0, updated_at: new Date().toISOString()
    };
}

rows.youtube_channels.push(makeChannel('user-a', 'channel-a', 'Channel A', 'youtube-a'), makeChannel('user-b', 'channel-b', 'Channel B', 'youtube-b'));

function comment(userId, channelId, commentId) {
    return { user_id: userId, channel_id: channelId, comment_id: commentId, video_id: `video-${channelId}`, video_title: `Title ${channelId}`, author_display_name: `Viewer ${userId}`, author_channel_id: null, text: `Text ${commentId}`, published_at: new Date().toISOString(), like_count: 0, can_reply: true, total_reply_count: 0, replies: [], category: 'Other', language: 'en', flagged: false, status: 'unanswered', replied: false, publish_status: 'idle', reply_id: null, synced_at: new Date().toISOString() };
}

rows.comments.push(comment('user-a', 'channel-a', 'comment-a'), comment('user-b', 'channel-b', 'comment-b'));
rows.comment_drafts.push({ user_id: 'user-a', channel_id: 'channel-a', comment_id: 'comment-a', text: 'Draft A', status: 'draft', edited: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { user_id: 'user-b', channel_id: 'channel-b', comment_id: 'comment-b', text: 'Draft B', status: 'draft', edited: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
rows.published_replies.push({ user_id: 'user-a', channel_id: 'channel-a', comment_id: 'old-a', reply_id: 'reply-a', text: 'History A', published_at: new Date().toISOString() }, { user_id: 'user-b', channel_id: 'channel-b', comment_id: 'old-b', reply_id: 'reply-b', text: 'History B', published_at: new Date().toISOString() });
rows.user_settings.push({ user_id: 'user-a', key: 'theme', value: 'amber' }, { user_id: 'user-b', key: 'theme', value: 'blue' });

let youtubePublishes = [];
let geminiRequests = 0;
let oauthExchanges = 0;
let oauthLogouts = 0;
let authRefreshes = 0;

function jsonResponse(status, value) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } }); }

global.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const authorization = init.headers?.Authorization || init.headers?.authorization || '';
    if (url.hostname === 'mock-supabase.test' && url.pathname === '/auth/v1/authorize') {
        assert.equal(init.headers?.apikey, process.env.SUPABASE_PUBLISHABLE_KEY, 'OAuth kickoff sends the publishable key server-side');
        return new Response(null, { status: 302, headers: { Location: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=mock' } });
    }
    if (url.hostname === 'mock-supabase.test' && url.pathname === '/auth/v1/token') {
        const body = JSON.parse(init.body || '{}');
        if (url.searchParams.get('grant_type') === 'pkce') {
            assert.equal(body.auth_code, 'valid-code');
            assert.equal(body.code_verifier, 'test-code-verifier', 'callback must prove possession of the PKCE verifier');
            oauthExchanges += 1;
            return jsonResponse(200, { access_token: 'account-token-a', refresh_token: 'refresh-token-a', expires_in: 3600 });
        }
        if (url.searchParams.get('grant_type') === 'refresh_token') {
            assert.equal(body.refresh_token, 'refresh-token-a');
            authRefreshes += 1;
            return jsonResponse(200, { access_token: 'account-token-a', refresh_token: 'refresh-token-a', expires_in: 3600 });
        }
    }
    if (url.hostname === 'mock-supabase.test' && url.pathname === '/auth/v1/logout') {
        assert.equal(authorization, 'Bearer account-token-a');
        oauthLogouts += 1;
        return new Response(null, { status: 204 });
    }
    if (url.hostname === 'mock-supabase.test' && url.pathname === '/auth/v1/user') {
        const user = identities.get(authorization.replace(/^Bearer\s+/i, ''));
        return user ? jsonResponse(200, user) : jsonResponse(401, { message: 'Invalid token' });
    }
    if (url.hostname === 'mock-supabase.test' && url.pathname.startsWith('/rest/v1/rpc/')) {
        const userId = identities.get(authorization.replace(/^Bearer\s+/i, ''))?.id;
        if (!userId) return jsonResponse(401, { message: 'Unauthorized' });
        const args = JSON.parse(init.body || '{}');
        const channelId = args.p_channel_id;
        const commentId = args.p_comment_id;
        const found = rows.comments.find(row => row.user_id === userId && row.channel_id === channelId && row.comment_id === commentId);
        if (url.pathname.endsWith('/claim_comment_publish')) {
            if (!found || found.replied || !['idle', 'draft'].includes(found.publish_status)) return jsonResponse(200, false);
            found.publish_status = 'publishing'; return jsonResponse(200, true);
        }
        if (url.pathname.endsWith('/release_comment_publish')) {
            if (found?.publish_status === 'publishing') found.publish_status = 'idle';
            return jsonResponse(200, null);
        }
        if (url.pathname.endsWith('/complete_comment_publish')) {
            if (!found || found.publish_status !== 'publishing') return jsonResponse(403, { message: 'Not owned' });
            rows.published_replies.push({ user_id: userId, channel_id: channelId, comment_id: commentId, reply_id: args.p_reply_id, text: args.p_text, published_at: new Date().toISOString() });
            found.replied = true; found.status = 'published'; found.publish_status = 'published'; found.reply_id = args.p_reply_id;
            return jsonResponse(200, null);
        }
    }
    if (url.hostname === 'mock-supabase.test' && url.pathname.startsWith('/rest/v1/')) {
        const table = url.pathname.split('/').pop();
        const userId = identities.get(authorization.replace(/^Bearer\s+/i, ''))?.id;
        if (!userId || !rows[table]) return jsonResponse(401, { message: 'Unauthorized' });
        const filters = Object.fromEntries(url.searchParams.entries());
        const matches = row => row.user_id === userId && Object.entries(filters).every(([key, expression]) => {
            if (['select', 'order', 'limit', 'on_conflict'].includes(key)) return true;
            return expression.startsWith('eq.') && String(row[key]) === expression.slice(3);
        });
        if ((init.method || 'GET') === 'GET') return jsonResponse(200, rows[table].filter(matches));
        let body = init.body ? JSON.parse(init.body) : {};
        if ((init.method || 'GET') === 'POST') {
            const batch = Array.isArray(body) ? body : [body];
            if (batch.some(row => row.user_id !== userId)) return jsonResponse(403, { message: 'RLS violation' });
            const added = [];
            for (const row of batch) {
                const conflict = rows[table].find(old => old.user_id === userId && old.channel_id === row.channel_id && old.comment_id === row.comment_id && row.comment_id);
                if (conflict) {
                    if (init.headers?.Prefer?.includes('resolution=merge-duplicates')) Object.assign(conflict, row);
                    if (!init.headers?.Prefer?.includes('resolution=ignore-duplicates')) added.push(conflict);
                } else {
                    rows[table].push(row); added.push(row);
                }
            }
            return jsonResponse(201, added);
        }
        if ((init.method || 'GET') === 'PATCH') {
            body = body || {};
            if (body.user_id && body.user_id !== userId) return jsonResponse(403, { message: 'RLS violation' });
            const changed = rows[table].filter(matches);
            changed.forEach(row => Object.assign(row, body));
            return jsonResponse(200, changed);
        }
    }
    if (url.hostname === 'www.googleapis.com' && url.pathname.includes('/commentThreads')) {
        const channelId = url.searchParams.get('allThreadsRelatedToChannelId');
        const letter = channelId === 'channel-a' ? 'a' : 'b';
        return jsonResponse(200, { items: [{ snippet: { videoId: `video-${letter}`, videoTitle: `Title ${letter}`, canReply: true, totalReplyCount: 0, topLevelComment: { id: `new-${letter}`, snippet: { authorDisplayName: `Viewer ${letter}`, textDisplay: `Synced ${letter}`, textOriginal: `Synced ${letter}`, publishedAt: new Date().toISOString(), likeCount: 0 } } } }] });
    }
    if (url.hostname === 'www.googleapis.com' && url.pathname === '/youtube/v3/comments') {
        const token = authorization.replace(/^Bearer\s+/i, '');
        youtubePublishes.push({ token, body: JSON.parse(init.body) });
        return jsonResponse(200, { id: `youtube-reply-${token}` });
    }
    if (url.hostname === 'generativelanguage.googleapis.com') {
        geminiRequests += 1;
        return jsonResponse(429, { error: { message: 'RequestsPerDayQuota exceeded' } });
    }
    throw new Error(`Unexpected mocked fetch: ${url.href}`);
};

function cookieFor(userId, token, channelId) {
    const req = { headers: { host: 'app.test', 'x-forwarded-proto': 'https' } };
    const cookies = createAuthSession(req, { access_token: token, refresh_token: `refresh-${token}`, expires_in: 3600 }, userId);
    const session = cookies.find(cookie => cookie.startsWith(`${SESSION_COOKIE}=`));
    const scope = cookies.find(cookie => cookie.startsWith('omni_scope='));
    const selection = seal({ userId, channelId }, process.env.SESSION_SECRET, 'channel-selection');
    return `${session.split(';')[0]}; ${scope.split(';')[0]}; ${CHANNEL_COOKIE}=${encodeURIComponent(selection)}`;
}

function responseMock() {
    return { headers: {}, setHeader(key, value) { this.headers[key] = value; return this; }, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, end() { return this; }, send(value) { this.body = value; return this; } };
}

test('Supabase OAuth callback, session validation/refresh, logout, and invalid-session rejection', async () => {
    const callback = require('../api/auth/callback');
    const verifier = 'test-code-verifier';
    const flowCookie = seal({ verifier, createdAt: Date.now() }, process.env.SESSION_SECRET, 'auth-flow');
    const callbackResponse = responseMock();
    await callback({
        method: 'GET', url: '/api/auth/callback?code=valid-code',
        headers: { host: 'app.test', 'x-forwarded-proto': 'https', cookie: `${FLOW_COOKIE}=${encodeURIComponent(flowCookie)}` }
    }, callbackResponse);
    assert.equal(callbackResponse.statusCode, 302);
    assert.match(callbackResponse.headers.Location, /spiritflow_creator_studio\.html\?account=signed-in$/);
    assert.equal(oauthExchanges, 1);
    const callbackCookies = callbackResponse.headers['Set-Cookie'];
    assert.ok(Array.isArray(callbackCookies));
    const sessionCookie = callbackCookies.find(cookie => cookie.startsWith(`${SESSION_COOKIE}=`));
    assert.ok(sessionCookie);
    assert.match(sessionCookie, /HttpOnly/);
    assert.match(sessionCookie, /Secure/);
    assert.doesNotMatch(sessionCookie, /account-token-a|refresh-token-a/, 'OAuth tokens must remain encrypted in cookies');

    const sessionHandler = require('../api/auth/session');
    const sessionRequest = { method: 'GET', headers: { host: 'app.test', 'x-forwarded-proto': 'https', cookie: sessionCookie.split(';')[0] } };
    const sessionResponse = responseMock();
    await sessionHandler(sessionRequest, sessionResponse);
    assert.equal(sessionResponse.statusCode, 200);
    assert.deepEqual(sessionResponse.body.user, { id: 'user-a', email: 'a@example.test' });
    assert.doesNotMatch(JSON.stringify(sessionResponse.body), /account-token-a|refresh-token-a/);
    const secondIdentityCookie = cookieFor('user-b', 'account-token-b', 'channel-b').split('; ')[0];
    const secondSessionResponse = responseMock();
    await sessionHandler({ method: 'GET', headers: { host: 'app.test', 'x-forwarded-proto': 'https', cookie: secondIdentityCookie } }, secondSessionResponse);
    assert.equal(secondSessionResponse.statusCode, 200);
    assert.deepEqual(secondSessionResponse.body.user, { id: 'user-b', email: 'b@example.test' });
    assert.notDeepEqual(secondSessionResponse.body.user, sessionResponse.body.user, 'separate session cookies resolve to separate Omnicast identities');

    const expired = seal({ accessToken: 'expired-token', refreshToken: 'refresh-token-a', expiresAt: Date.now() - 1000 }, process.env.SESSION_SECRET, 'auth-session');
    const refreshResponse = responseMock();
    await sessionHandler({ method: 'GET', headers: { host: 'app.test', 'x-forwarded-proto': 'https', cookie: `${SESSION_COOKIE}=${encodeURIComponent(expired)}` } }, refreshResponse);
    assert.equal(refreshResponse.statusCode, 200);
    assert.equal(authRefreshes, 1, 'expired account sessions refresh through Supabase');
    assert.ok(Array.isArray(refreshResponse.headers['Set-Cookie']));
    const refreshedAccountCookie = refreshResponse.headers['Set-Cookie'].find(cookie => cookie.startsWith(`${SESSION_COOKIE}=`));
    assert.match(refreshedAccountCookie, /HttpOnly/);
    assert.ok(refreshResponse.headers['Set-Cookie'].some(cookie => cookie.startsWith('omni_scope=user-a;')));

    const logout = require('../api/auth/logout');
    const logoutResponse = responseMock();
    await logout({ method: 'POST', headers: { host: 'app.test', 'x-forwarded-proto': 'https', origin: 'https://app.test', cookie: sessionCookie.split(';')[0] } }, logoutResponse);
    assert.equal(logoutResponse.statusCode, 200);
    assert.equal(oauthLogouts, 1, 'logout revokes the Supabase session server-side');
    assert.ok(logoutResponse.headers['Set-Cookie'].some(cookie => cookie.startsWith(`${SESSION_COOKIE}=`) && cookie.includes('Max-Age=0')));

    const invalidResponse = responseMock();
    await sessionHandler({ method: 'GET', headers: { host: 'app.test', 'x-forwarded-proto': 'https', cookie: `${SESSION_COOKIE}=tampered` } }, invalidResponse);
    assert.equal(invalidResponse.statusCode, 401, 'tampered/invalid sessions are rejected');

    const badCallbackResponse = responseMock();
    await callback({ method: 'GET', url: '/api/auth/callback?code=valid-code', headers: { host: 'app.test', 'x-forwarded-proto': 'https' } }, badCallbackResponse);
    assert.equal(badCallbackResponse.statusCode, 302);
    assert.equal(oauthExchanges, 1, 'callback without its PKCE cookie never exchanges a code');
});

function request(userId, route, method = 'GET', body) {
    const isA = userId === 'user-a';
    return { method, url: route, headers: { host: 'app.test', origin: 'https://app.test', cookie: cookieFor(userId, isA ? 'account-token-a' : 'account-token-b', isA ? 'channel-a' : 'channel-b') }, body };
}

test('two Omnicast accounts remain isolated through channel operations, and Gemini quota stops generation', async () => {
    const googleLogin = require('../api/auth/google');
    const loginResponse = responseMock();
    await googleLogin({ method: 'GET', url: '/api/auth/google', headers: { host: 'app.test', 'x-forwarded-proto': 'https' } }, loginResponse);
    assert.equal(loginResponse.statusCode, 302, 'Google sign-in begins with Supabase PKCE');
    assert.match(loginResponse.headers.Location, /^https:\/\/accounts\.google\.com\//);
    assert.match(loginResponse.headers['Set-Cookie'], /omni_auth_flow=/);

    const corePath = require.resolve('../api/_youtubeCommentsCore');
    const core = require(corePath);
    const aiService = require('../lib/ai/ai-service');
    const priorGenerate = aiService.generateForModule;
    const priorGenerateJson = aiService.generateJson;
    aiService.generateForModule = async () => ({ text: 'Draft created for account A' });
    aiService.generateJson = async () => ({ data: { category: 'Other', language: 'en', flag: false } });

    try {
        const anonymous = await core.commentsApiHandler({ method: 'GET', url: '/api/youtube-comments/list', headers: { host: 'app.test' } });
        assert.equal(anonymous.statusCode, 401, 'missing account session must fail closed');

        const anonymousAiResponse = responseMock();
        await require('../api/ai-generate')({ method: 'POST', url: '/api/ai-generate', headers: { host: 'app.test', origin: 'https://app.test' }, body: { prompt: 'anonymous request' } }, anonymousAiResponse);
        assert.equal(anonymousAiResponse.statusCode, 401, 'AI generation requires an Omnicast session');

        const listA = JSON.parse((await core.commentsApiHandler(request('user-a', '/api/youtube-comments/list'))).body);
        const listB = JSON.parse((await core.commentsApiHandler(request('user-b', '/api/youtube-comments/list'))).body);
        assert.deepEqual(listA.comments.map(row => row.commentId), ['comment-a']);
        assert.deepEqual(listA.drafts.map(row => row.text), ['Draft A']);
        assert.deepEqual(listA.published.map(row => row.text), ['History A']);
        assert.deepEqual(listB.comments.map(row => row.commentId), ['comment-b']);
        assert.deepEqual(listB.drafts.map(row => row.text), ['Draft B']);
        assert.deepEqual(listB.published.map(row => row.text), ['History B']);

        const channelsHandler = require('../api/youtube-channels');
        const channelsA = responseMock();
        const channelsB = responseMock();
        await channelsHandler(request('user-a', '/api/youtube-channels'), channelsA);
        await channelsHandler(request('user-b', '/api/youtube-channels'), channelsB);
        assert.deepEqual(channelsA.body.channels.map(channel => channel.id), ['channel-a']);
        assert.deepEqual(channelsB.body.channels.map(channel => channel.id), ['channel-b']);

        const settingsHandler = require('../api/user-settings');
        const settingsA = responseMock();
        const settingsB = responseMock();
        await settingsHandler(request('user-a', '/api/user-settings'), settingsA);
        await settingsHandler(request('user-b', '/api/user-settings'), settingsB);
        assert.deepEqual(settingsA.body.settings, { theme: 'amber' });
        assert.deepEqual(settingsB.body.settings, { theme: 'blue' });

        const channelSelect = require('../api/youtube-channel-select');
        const selectResponse = responseMock();
        await channelSelect(request('user-a', '/api/youtube-channel-select', 'POST', { channelId: 'channel-b' }), selectResponse);
        assert.equal(selectResponse.statusCode, 404, 'account A cannot select account B channel');

        const syncA = JSON.parse((await core.commentsApiHandler(request('user-a', '/api/youtube-comments/sync', 'POST', {}))).body);
        const syncB = JSON.parse((await core.commentsApiHandler(request('user-b', '/api/youtube-comments/sync', 'POST', {}))).body);
        assert.equal(syncA.ok, true); assert.deepEqual(syncA.comments.map(row => row.commentId).sort(), ['comment-a', 'new-a']);
        assert.equal(syncB.ok, true); assert.deepEqual(syncB.comments.map(row => row.commentId).sort(), ['comment-b', 'new-b']);

        const deniedDraft = await core.commentsApiHandler(request('user-b', '/api/youtube-comments/generate', 'POST', { commentId: 'comment-a' }));
        assert.equal(deniedDraft.statusCode, 404, 'account B cannot generate a draft for account A comment');
        const generated = JSON.parse((await core.commentsApiHandler(request('user-a', '/api/youtube-comments/generate', 'POST', { commentId: 'new-a' }))).body);
        assert.equal(generated.draft?.text, 'Draft created for account A', JSON.stringify(generated));
        const edited = await core.commentsApiHandler(request('user-a', '/api/youtube-comments/draft', 'POST', { commentId: 'new-a', text: 'Edited A draft' }));
        assert.equal(edited.statusCode, 200);

        const deniedPublish = await core.commentsApiHandler(request('user-b', '/api/youtube-comments/publish', 'POST', { commentId: 'new-a', text: 'Unauthorized' }));
        assert.equal(deniedPublish.statusCode, 404, 'account B cannot publish account A comment');
        assert.equal(youtubePublishes.length, 0, 'unauthorized attempt must never reach YouTube');
        const published = JSON.parse((await core.commentsApiHandler(request('user-a', '/api/youtube-comments/publish', 'POST', { commentId: 'new-a', text: 'Approved A reply' }))).body);
        assert.equal(published.ok, true);
        assert.deepEqual(youtubePublishes.map(row => row.token), ['youtube-a']);

        delete require.cache[corePath];
        const afterRestart = require(corePath);
        const persisted = JSON.parse((await afterRestart.commentsApiHandler(request('user-a', '/api/youtube-comments/list'))).body);
        assert.ok(persisted.comments.some(row => row.commentId === 'new-a'), 'mock database survives handler reload');
        assert.equal(rows.comment_drafts.find(row => row.comment_id === 'new-a' && row.user_id === 'user-a').text, 'Edited A draft', 'edited draft remains persisted after the handler reload');
        assert.equal(persisted.drafts.some(row => row.commentId === 'new-a'), false, 'published replies do not reappear in the active draft list');
        assert.equal(persisted.published.find(row => row.commentId === 'new-a').text, 'Approved A reply');

        const gemini = require('../lib/ai/gemini');
        geminiRequests = 0;
        await assert.rejects(gemini.generateText({ prompt: 'quota check' }), error => error.code === 'QUOTA_EXHAUSTED');
        await assert.rejects(gemini.generateText({ prompt: 'quota check again' }), error => error.code === 'QUOTA_EXHAUSTED');
        assert.equal(geminiRequests, 1, 'quota stop prevents the follow-up request and no fallback provider is contacted');
    } finally {
        aiService.generateForModule = priorGenerate;
        aiService.generateJson = priorGenerateJson;
    }
});
