const test = require('node:test');
const assert = require('node:assert/strict');

function replaceModule(file, exports) {
    const resolved = require.resolve(file);
    const previous = require.cache[resolved];
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
    return () => { if (previous) require.cache[resolved] = previous; else delete require.cache[resolved]; };
}

function loadCommentsCore({ context, store, rateLimit } = {}) {
    const contextPath = '../lib/auth/youtube-context';
    const storePath = '../lib/db/tenant-store';
    const ratePath = '../lib/security/rate-limit';
    const corePath = '../api/_youtubeCommentsCore';
    const restore = [];
    if (context) restore.push(replaceModule(contextPath, context));
    if (store) restore.push(replaceModule(storePath, store));
    if (rateLimit) restore.push(replaceModule(ratePath, rateLimit));
    const resolvedCore = require.resolve(corePath);
    const previousCore = require.cache[resolvedCore];
    delete require.cache[resolvedCore];
    const core = require(corePath);
    return {
        core,
        restore() {
            if (previousCore) require.cache[resolvedCore] = previousCore; else delete require.cache[resolvedCore];
            restore.reverse().forEach(fn => fn());
        }
    };
}

function loadYoutubeCore({ context, store }) {
    const contextPath = '../lib/auth/youtube-context';
    const storePath = '../lib/db/tenant-store';
    const corePath = '../api/_youtubeCore';
    const restore = [];
    if (context) restore.push(replaceModule(contextPath, context));
    if (store) restore.push(replaceModule(storePath, store));
    const resolvedCore = require.resolve(corePath);
    const previousCore = require.cache[resolvedCore];
    delete require.cache[resolvedCore];
    const core = require(corePath);
    return {
        core,
        restore() {
            if (previousCore) require.cache[resolvedCore] = previousCore; else delete require.cache[resolvedCore];
            restore.reverse().forEach(fn => fn());
        }
    };
}

function validContext() {
    return {
        channelForRequest: async () => ({
            user: { id: 'user-test' }, accessToken: 'supabase-test-token', channelId: 'UC_OWNER',
            channel: { channel_id: 'UC_OWNER', accessToken: 'youtube-test-token' }
        }),
        accountHeaders: () => ({})
    };
}

const originHeaders = { host: 'app.example.test', origin: 'https://app.example.test' };

test('createAuthSession returns HttpOnly session plus account scope cookie for identified users', () => {
    const auth = require('../lib/auth/supabase');
    const previous = process.env.SESSION_SECRET;
    process.env.SESSION_SECRET = 'test-only-session-secret-with-32-characters-min';
    try {
        const cookies = auth.createAuthSession({ headers: { host: 'app.example.test' } }, {
            access_token: 'access-test-token', refresh_token: 'refresh-test-token', expires_in: 3600
        }, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
        assert.equal(Array.isArray(cookies), true);
        assert.match(cookies[0], /^omni_session=/);
        assert.match(cookies[0], /HttpOnly/);
        assert.doesNotMatch(cookies[0], /access-test-token|refresh-test-token/);
        assert.match(cookies[1], /^omni_scope=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/);
        assert.doesNotMatch(cookies[1], /HttpOnly/);
    } finally {
        if (previous === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = previous;
    }
});

test('unauthenticated session validation expires stale scope and channel cookies', async () => {
    const names = ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'SESSION_SECRET'];
    const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
    process.env.SUPABASE_URL = 'https://supabase.example.test';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
    process.env.SESSION_SECRET = 'test-only-session-secret-with-32-characters-min';
    const handler = require('../api/auth/session');
    const response = {
        headers: {},
        setHeader(name, value) { this.headers[name] = value; return this; },
        status(code) { this.statusCode = code; return this; },
        json(body) { this.body = body; return this; }
    };
    try {
        await handler({ method: 'GET', headers: { host: 'app.example.test', cookie: 'omni_scope=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa; omni_channel=stale' } }, response);
        assert.equal(response.statusCode, 401);
        assert.equal(response.headers['Set-Cookie'].length, 3);
        assert.match(response.headers['Set-Cookie'][0], /^omni_session=.*Max-Age=0/);
        assert.match(response.headers['Set-Cookie'][1], /^omni_scope=.*Max-Age=0/);
        assert.match(response.headers['Set-Cookie'][2], /^omni_channel=.*Max-Age=0/);
    } finally {
        for (const name of names) if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name];
    }
});

test('comment mutation rejects an invalid Origin before account or database work', async () => {
    const oldBase = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = 'https://app.example.test';
    let contextCalls = 0;
    const loaded = loadCommentsCore({ context: {
        channelForRequest: async () => { contextCalls += 1; return validContext().channelForRequest(); },
        accountHeaders: () => ({})
    } });
    try {
        const response = await loaded.core.commentsApiHandler({
            method: 'POST', url: '/api/youtube-comments/sync',
            headers: { host: 'app.example.test', origin: 'https://evil.example' }, body: {}
        });
        assert.equal(response.statusCode, 403);
        assert.equal(contextCalls, 0);
    } finally {
        loaded.restore();
        if (oldBase === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = oldBase;
    }
});

test('comment sync preserves confirmed writes and reports a later-page failure as partial', async () => {
    const priorGemini = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const stored = [];
    const syncUpdates = [];
    const store = {
        listComments: async () => stored,
        upsertComments: async (_user, _token, rows) => { stored.push(...rows); return rows; },
        updateChannelSync: async (_user, _token, channelId, count) => { syncUpdates.push({ channelId, count }); },
        listCommentsPage: async () => stored,
        listDrafts: async () => [], listPublished: async () => []
    };
    const loaded = loadCommentsCore({
        context: validContext(), store,
        rateLimit: { checkRateLimit: async () => ({ allowed: true, remaining: 1, resetAt: Date.now() + 60000 }), retryAfterSeconds: () => 60 }
    });
    const oldFetch = global.fetch;
    global.fetch = async url => {
        const parsed = new URL(String(url));
        if (parsed.pathname.endsWith('/commentThreads') && parsed.searchParams.has('pageToken')) {
            return new Response(JSON.stringify({ error: { message: 'temporary upstream failure' } }), { status: 503 });
        }
        if (parsed.pathname.endsWith('/commentThreads')) {
            return new Response(JSON.stringify({
                items: [{ id: 'thread-1', snippet: {
                    videoId: 'video-1', totalReplyCount: 0,
                    topLevelComment: { id: 'comment-1', snippet: { textOriginal: 'hello', authorDisplayName: 'Viewer', publishedAt: '2026-01-01T00:00:00Z' } }
                } }], nextPageToken: 'page-2'
            }), { status: 200 });
        }
        throw new Error(`Unexpected test request: ${parsed.pathname}`);
    };
    try {
        const response = await loaded.core._private.syncCommentsHandler({
            method: 'POST', url: '/api/youtube-comments/sync', headers: originHeaders, body: {}
        });
        const body = JSON.parse(response.body);
        assert.equal(response.statusCode, 503);
        assert.equal(body.partial, true);
        assert.equal(body.synced, 1);
        assert.equal(stored.length, 1);
        assert.equal(stored[0].comment_id, 'comment-1');
        assert.deepEqual(syncUpdates[0], { channelId: 'UC_OWNER', count: 1 });
    } finally {
        global.fetch = oldFetch;
        loaded.restore();
        if (priorGemini !== undefined) process.env.GEMINI_API_KEY = priorGemini;
    }
});

test('comment sync does not count an empty/partial PostgREST representation as fully persisted', async () => {
    const priorGemini = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    const stored = [];
    const syncUpdates = [];
    const store = {
        listComments: async () => stored,
        upsertComments: async (_user, _token, rows) => { stored.push(rows[0]); return [rows[0]]; },
        updateChannelSync: async (_user, _token, channelId, count) => { syncUpdates.push({ channelId, count }); }
    };
    const loaded = loadCommentsCore({
        context: validContext(), store,
        rateLimit: { checkRateLimit: async () => ({ allowed: true, remaining: 1, resetAt: Date.now() + 60000 }), retryAfterSeconds: () => 60 }
    });
    const oldFetch = global.fetch;
    global.fetch = async url => new Response(JSON.stringify({ items: [
        { id: 'thread-1', snippet: { totalReplyCount: 0, topLevelComment: { id: 'comment-1', snippet: { textOriginal: 'one' } } } },
        { id: 'thread-2', snippet: { totalReplyCount: 0, topLevelComment: { id: 'comment-2', snippet: { textOriginal: 'two' } } } }
    ] }), { status: 200 });
    try {
        const response = await loaded.core._private.syncCommentsHandler({ method: 'POST', url: '/api/youtube-comments/sync', headers: originHeaders, body: {} });
        const body = JSON.parse(response.body);
        assert.equal(response.statusCode, 503);
        assert.equal(body.code, 'PARTIAL_PERSISTENCE');
        assert.equal(body.synced, 1);
        assert.equal(stored.length, 1);
        assert.equal(syncUpdates[0].count, 1);
    } finally {
        global.fetch = oldFetch;
        loaded.restore();
        if (priorGemini !== undefined) process.env.GEMINI_API_KEY = priorGemini;
    }
});

test('owner reply detection matches the channel ID, including YouTube object-shaped IDs', () => {
    const { _private } = require('../api/_youtubeCommentsCore');
    const ownerReply = _private.normalizeReply({ id: 'reply-1', snippet: {
        authorChannelId: { value: 'UC_OWNER' }, textOriginal: 'Thanks for sharing', authorDisplayName: 'Channel'
    } }, 'UC_OWNER');
    const viewerReply = _private.normalizeReply({ id: 'reply-2', snippet: {
        authorChannelId: { value: 'UC_VIEWER' }, textOriginal: 'Amen'
    } }, 'UC_OWNER');
    assert.equal(ownerReply.isOwner, true);
    assert.equal(viewerReply.isOwner, false);
    assert.equal(_private.findOwnerReply([viewerReply, ownerReply], 'UC_OWNER').id, 'reply-1');
});

test('publishing reconciliation records an already-existing owner reply instead of retrying', async () => {
    const calls = { complete: [], release: 0 };
    const store = {
        getComment: async () => ({ comment_id: 'comment-1', publish_status: 'reconciliation_required', replied: false }),
        completePublish: async (...args) => { calls.complete.push(args); },
        releasePublish: async () => { calls.release += 1; }
    };
    const loaded = loadCommentsCore({ context: validContext(), store });
    const oldFetch = global.fetch;
    global.fetch = async () => new Response(JSON.stringify({ items: [{ snippet: {
        totalReplyCount: 1,
        topLevelComment: { id: 'comment-1', snippet: { textOriginal: 'Question', authorChannelId: { value: 'UC_VIEWER' } } }
    }, replies: { comments: [{ id: 'owner-reply', snippet: {
        authorChannelId: { value: 'UC_OWNER' }, textOriginal: 'Thanks for watching'
    } }] } }] }), { status: 200 });
    try {
        const response = await loaded.core._private.reconcilePublishHandler({
            method: 'POST', url: '/api/youtube-comments/reconcile', headers: originHeaders, body: { commentId: 'comment-1' }
        });
        const body = JSON.parse(response.body);
        assert.equal(response.statusCode, 200);
        assert.equal(body.reconciled, true);
        assert.equal(body.published.id, 'owner-reply');
        assert.equal(calls.complete.length, 1);
        assert.equal(calls.release, 0);
    } finally {
        global.fetch = oldFetch;
        loaded.restore();
    }
});

test('distributed rate-limit RPC arguments and bounded in-memory fallback are correct', async () => {
    const dbPath = require.resolve('../lib/db/supabase-rest');
    const previousDb = require.cache[dbPath];
    const calls = [];
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
        rpc: async (...args) => { calls.push(args); return [{ allowed: false, remaining: 0, reset_at: new Date(Date.now() + 30000).toISOString() }]; }
    } };
    const limiter = require('../lib/security/rate-limit');
    try {
        const distributed = await limiter.checkRateLimit({ user: { id: 'rpc-user' }, accessToken: 'session-token', bucket: 'ai_classify', limit: 6, windowMs: 60000 });
        assert.equal(distributed.allowed, false);
        assert.equal(distributed.degraded, false);
        assert.deepEqual(calls[0], ['consume_rate_limit', { p_bucket: 'ai_classify', p_limit: 6, p_window_seconds: 60 }, 'session-token']);

        require.cache[dbPath].exports.rpc = async () => { throw new Error('database function unavailable'); };
        const fallback1 = await limiter.checkRateLimit({ user: { id: 'fallback-user' }, accessToken: 'session-token', bucket: 'test-fallback-unique', limit: 1, windowMs: 60000 });
        const fallback2 = await limiter.checkRateLimit({ user: { id: 'fallback-user' }, accessToken: 'session-token', bucket: 'test-fallback-unique', limit: 1, windowMs: 60000 });
        assert.equal(fallback1.allowed, true);
        assert.equal(fallback1.degraded, true);
        assert.equal(fallback2.allowed, false);
        assert.equal(fallback2.degraded, true);
    } finally {
        if (previousDb) require.cache[dbPath] = previousDb; else delete require.cache[dbPath];
    }
});

test('YouTube token refresh persists a rotated refresh token under the authenticated user and channel', async () => {
    const envNames = ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_TOKEN_ENCRYPTION_KEY', 'SESSION_SECRET', 'APP_BASE_URL'];
    const priorEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
    process.env.YOUTUBE_CLIENT_ID = 'test-youtube-client';
    process.env.YOUTUBE_CLIENT_SECRET = 'test-youtube-secret';
    process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY = 'test-only-token-encryption-key-32-chars';
    process.env.SESSION_SECRET = 'test-only-session-secret-with-32-characters-min';
    process.env.APP_BASE_URL = 'https://app.example.test';
    const saved = [];
    const channel = {
        channel_id: 'UC_OWNER', channel_title: 'Owner Channel', accessToken: 'old-access-token',
        refreshToken: 'old-refresh-token', token_expires_at: new Date(Date.now() - 60_000).toISOString()
    };
    const loaded = loadYoutubeCore({
        context: { channelForRequest: async () => ({
            user: { id: 'user-test' }, accessToken: 'account-token', channelId: 'UC_OWNER', channel
        }) },
        store: { saveChannel: async (...args) => { saved.push(args); } }
    });
    const oldFetch = global.fetch;
    global.fetch = async (url, init = {}) => {
        const parsed = new URL(String(url));
        if (parsed.hostname === 'oauth2.googleapis.com') {
            assert.equal(new URLSearchParams(init.body).get('refresh_token'), 'old-refresh-token');
            return new Response(JSON.stringify({ access_token: 'new-access-token', refresh_token: 'rotated-refresh-token', expires_in: 3600 }), { status: 200 });
        }
        if (parsed.pathname.endsWith('/youtube/v3/channels')) return new Response(JSON.stringify({ items: [{
            id: 'UC_OWNER', snippet: { title: 'Owner Channel' }, statistics: {}, contentDetails: {}
        }] }), { status: 200 });
        if (parsed.hostname === 'youtubeanalytics.googleapis.com') return new Response(JSON.stringify({ error: { message: 'analytics unavailable in fixture' } }), { status: 403 });
        throw new Error(`Unexpected test request: ${parsed.hostname}${parsed.pathname}`);
    };
    try {
        const result = await loaded.core.channelHandler({ method: 'GET', url: '/api/youtube-channel', headers: { host: 'app.example.test', cookie: '' } });
        assert.equal(result.statusCode, 200);
        assert.equal(saved.length, 1);
        assert.equal(saved[0][0].id, 'user-test');
        assert.equal(saved[0][1], 'account-token');
        assert.equal(saved[0][2].channelId, 'UC_OWNER');
        assert.equal(saved[0][2].title, 'Owner Channel');
        assert.equal(saved[0][2].accessToken, 'new-access-token');
        assert.equal(saved[0][2].refreshToken, 'rotated-refresh-token');
        assert.ok(Number.isFinite(saved[0][2].expiresAt) && saved[0][2].expiresAt > Date.now());
    } finally {
        global.fetch = oldFetch;
        loaded.restore();
        for (const name of envNames) if (priorEnv[name] === undefined) delete process.env[name]; else process.env[name] = priorEnv[name];
    }
});

test('stale publishing recovery RPC is called with channel, comment and bounded timeout arguments', async () => {
    const dbPath = require.resolve('../lib/db/supabase-rest');
    const storePath = require.resolve('../lib/db/tenant-store');
    const previousDb = require.cache[dbPath];
    const previousStore = require.cache[storePath];
    const calls = [];
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
        rpc: async (...args) => { calls.push(args); return 1; }
    } };
    delete require.cache[storePath];
    try {
        const store = require('../lib/db/tenant-store');
        const result = await store.recoverStalePublish({ id: 'user-test' }, 'account-token', 'UC_OWNER', 'comment-1');
        assert.equal(result, 1);
        assert.deepEqual(calls[0], ['recover_stale_publish', {
            p_channel_id: 'UC_OWNER', p_comment_id: 'comment-1', p_stale_after_seconds: 120
        }, 'account-token']);
    } finally {
        if (previousDb) require.cache[dbPath] = previousDb; else delete require.cache[dbPath];
        if (previousStore) require.cache[storePath] = previousStore; else delete require.cache[storePath];
    }
});
