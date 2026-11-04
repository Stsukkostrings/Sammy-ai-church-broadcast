const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const auth = require('../lib/auth/supabase');

test('same-origin checks accept the request host and configured application origin, reject mismatches', () => {
    process.env.APP_BASE_URL = 'https://app.example.test';
    const request = origin => ({ method: 'POST', headers: { host: 'preview.example.test', origin } });
    assert.equal(auth.isSameOrigin(request('https://preview.example.test')), true);
    assert.equal(auth.isSameOrigin(request('https://app.example.test')), true);
    assert.equal(auth.isSameOrigin(request('https://attacker.example')), false);
    assert.equal(auth.isSameOrigin(request('null')), false);
    assert.equal(auth.isSameOrigin({ method: 'POST', headers: { host: 'app.example.test', 'x-forwarded-host': 'attacker.example', 'x-forwarded-proto': 'https', origin: 'https://attacker.example' } }), false);
});

test('Supabase configuration rejects service-role credentials', () => {
    const old = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_PUBLISHABLE_KEY, session: process.env.SESSION_SECRET };
    try {
        process.env.SUPABASE_URL = 'https://project.example.test';
        process.env.SESSION_SECRET = 'test-session-secret-that-is-long-enough';
        process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_secret_test-only';
        assert.equal(auth.getConfig().configured, false);
        const payload = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url');
        process.env.SUPABASE_PUBLISHABLE_KEY = `header.${payload}.signature`;
        assert.equal(auth.getConfig().configured, false);
    } finally {
        if (old.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = old.url;
        if (old.key === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY; else process.env.SUPABASE_PUBLISHABLE_KEY = old.key;
        if (old.session === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = old.session;
    }
});

test('read-only GET and HEAD do not require Origin; mutations do', () => {
    assert.equal(auth.isSameOrigin({ method: 'GET', headers: { host: 'app.example.test' } }), false, 'helper remains mutation-focused; GET behavior is route-specific');
    const ai = require('../api/ai-generate');
    const makeRes = () => ({ headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end(body) { this.body = body || ''; return this; } });
    return Promise.all([
        (async () => { const res = makeRes(); await ai({ method: 'GET', headers: {} }, res); assert.equal(res.statusCode, 200); })(),
        (async () => { const res = makeRes(); await ai({ method: 'HEAD', headers: {} }, res); assert.equal(res.statusCode, 200); assert.equal(res.body, ''); })(),
        (async () => {
            const settings = require('../api/user-settings');
            const res = makeRes();
            await settings({ method: 'HEAD', headers: { host: 'app.example.test' } }, res);
            assert.notEqual(res.statusCode, 403, 'read-only HEAD is not rejected for lacking Origin');
        })(),
        (async () => {
            const settings = require('../api/user-settings');
            const res = makeRes();
            await settings({ method: 'POST', headers: { host: 'app.example.test' }, body: { key: 'theme', value: 'light' } }, res);
            assert.equal(res.statusCode, 403, 'state-changing settings require a matching Origin');
        })()
    ]);
});

test('comment dispatcher saves a draft and regenerates through their respective handlers', async () => {
    const contextPath = require.resolve('../lib/auth/youtube-context');
    const storePath = require.resolve('../lib/db/tenant-store');
    const corePath = require.resolve('../api/_youtubeCommentsCore');
    const existingContext = require.cache[contextPath];
    const existingStore = require.cache[storePath];
    const existingCore = require.cache[corePath];
    const calls = { upsertDraft: [], generate: 0 };
    const comment = { comment_id: 'c1', channel_id: 'ch1', text: 'hello', author_display_name: 'Viewer', language: 'en' };
    require.cache[contextPath] = { id: contextPath, filename: contextPath, loaded: true, exports: {
        channelForRequest: async () => ({ user: { id: 'u1' }, accessToken: 'access', channelId: 'ch1', channel: { channel_id: 'ch1', accessToken: 'yt' } }),
        accountHeaders: () => ({})
    } };
    require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: {
        getComment: async (_user, _token, channelId, commentId) => channelId === 'ch1' && commentId === 'c1' ? comment : null,
        getDraft: async () => ({ text: 'old draft' }),
        upsertDraft: async (_user, _token, draft) => { calls.upsertDraft.push(draft); return { ...draft, created_at: 'now' }; },
        updateComment: async () => undefined
    } };
    delete require.cache[corePath];
    const { commentsApiHandler } = require('../api/_youtubeCommentsCore');
    const req = (body, url = '/api/youtube-comments') => ({ method: 'POST', url, headers: { host: 'app.example.test', origin: 'https://app.example.test' }, body });
    try {
        const draft = await commentsApiHandler(req({ action: 'draft', commentId: 'c1', text: 'edited' }));
        assert.equal(draft.statusCode, 200);
        const draftBody = JSON.parse(draft.body);
        assert.equal(draftBody.ok, true);
        assert.equal(draftBody.draft.text, 'edited');
        assert.equal(calls.upsertDraft[0].text, 'edited');
        assert.equal(calls.upsertDraft[0].channel_id, 'ch1');

        const aiPath = require.resolve('../lib/ai/ai-service');
        const previousAi = require.cache[aiPath];
        require.cache[aiPath] = { id: aiPath, filename: aiPath, loaded: true, exports: { generateForModule: async () => { calls.generate += 1; return { text: 'new reply' }; } } };
        delete require.cache[corePath];
        const regeneratedCore = require('../api/_youtubeCommentsCore');
        const regenerated = await regeneratedCore.commentsApiHandler(req({ action: 'generate', commentId: 'c1', regenerate: true }));
        assert.equal(regenerated.statusCode, 200);
        const regeneratedBody = JSON.parse(regenerated.body);
        assert.equal(regeneratedBody.ok, true);
        assert.equal(regeneratedBody.draft.text, 'new reply');
        assert.equal(calls.generate, 1);
        assert.equal(calls.upsertDraft.at(-1).text, 'new reply');
        if (previousAi) require.cache[aiPath] = previousAi; else delete require.cache[aiPath];
    } finally {
        if (existingContext) require.cache[contextPath] = existingContext; else delete require.cache[contextPath];
        if (existingStore) require.cache[storePath] = existingStore; else delete require.cache[storePath];
        if (existingCore) require.cache[corePath] = existingCore; else delete require.cache[corePath];
    }
});

test('uncertain publish failure keeps the claim and never reports success', async () => {
    const contextPath = require.resolve('../lib/auth/youtube-context');
    const storePath = require.resolve('../lib/db/tenant-store');
    const corePath = require.resolve('../api/_youtubeCommentsCore');
    const previous = { context: require.cache[contextPath], store: require.cache[storePath], core: require.cache[corePath] };
    const calls = { claim: 0, release: 0, complete: 0 };
    require.cache[contextPath] = { id: contextPath, filename: contextPath, loaded: true, exports: {
        channelForRequest: async () => ({ user: { id: 'u1' }, accessToken: 'access', channelId: 'ch1', channel: { channel_id: 'ch1', accessToken: 'yt' } }),
        accountHeaders: () => ({})
    } };
    require.cache[storePath] = { id: storePath, filename: storePath, loaded: true, exports: {
        getComment: async () => ({ comment_id: 'c1' }), claimPublish: async () => { calls.claim++; return true; },
        releasePublish: async () => { calls.release++; }, completePublish: async () => { calls.complete++; }
    } };
    delete require.cache[corePath];
    const { commentsApiHandler } = require('../api/_youtubeCommentsCore');
    const oldFetch = global.fetch;
    global.fetch = async () => { throw new TypeError('connection reset'); };
    try {
        const result = await commentsApiHandler({ method: 'POST', url: '/api/youtube-comments/publish', headers: { host: 'app.example.test', origin: 'https://app.example.test' }, body: { commentId: 'c1', text: 'reply' } });
        const body = JSON.parse(result.body);
        assert.equal(result.statusCode, 503);
        assert.equal(body.code, 'PUBLISH_OUTCOME_UNCERTAIN');
        assert.equal(body.ok, false);
        assert.deepEqual(calls, { claim: 1, release: 0, complete: 0 });
    } finally {
        global.fetch = oldFetch;
        if (previous.context) require.cache[contextPath] = previous.context; else delete require.cache[contextPath];
        if (previous.store) require.cache[storePath] = previous.store; else delete require.cache[storePath];
        if (previous.core) require.cache[corePath] = previous.core; else delete require.cache[corePath];
    }
});

test('persistent comment reads request sequential PostgREST ranges under user and channel filters', async () => {
    const dbPath = require.resolve('../lib/db/supabase-rest');
    const storePath = require.resolve('../lib/db/tenant-store');
    const previousDb = require.cache[dbPath];
    const previousStore = require.cache[storePath];
    const requests = [];
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: {
        scopedFilters: (userId, filters) => ({ ...filters, user_id: `eq.${userId}` }),
        request: async (table, options) => {
            requests.push({ table, ...options });
            const start = Number(options.range.split('-')[0]);
            return start === 0 ? Array.from({ length: 1000 }, (_, i) => ({ comment_id: `c${i}` })) : [{ comment_id: 'last' }];
        }
    } };
    delete require.cache[storePath];
    try {
        const store = require('../lib/db/tenant-store');
        const rows = await store.listComments({ id: 'account-a' }, 'session', 'channel-a');
        assert.equal(rows.length, 1001);
        assert.deepEqual(requests.map(request => request.range), ['0-999', '1000-1999']);
        assert.equal(requests[0].filters.user_id, 'eq.account-a');
        assert.equal(requests[0].filters.channel_id, 'eq.channel-a');
    } finally {
        if (previousDb) require.cache[dbPath] = previousDb; else delete require.cache[dbPath];
        if (previousStore) require.cache[storePath] = previousStore; else delete require.cache[storePath];
    }
});

test('Gemini missing and invalid configuration fails safely without fallback', async () => {
    const geminiPath = require.resolve('../lib/ai/gemini');
    const previousGemini = require.cache[geminiPath];
    const old = { key: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL };
    const originalFetch = global.fetch;
    const requests = [];
    global.fetch = async url => { requests.push(String(url)); return new Response(JSON.stringify({ error: { message: 'invalid key' } }), { status: 403 }); };
    try {
        delete process.env.GEMINI_API_KEY;
        delete require.cache[geminiPath];
        const missingConfig = require('../lib/ai/gemini');
        await assert.rejects(missingConfig.generateText({ prompt: 'test' }), error => error.code === 'NOT_CONFIGURED');
        process.env.GEMINI_API_KEY = 'not-a-real-key';
        delete require.cache[geminiPath];
        const invalidConfig = require('../lib/ai/gemini');
        await assert.rejects(invalidConfig.generateText({ prompt: 'invalid-key-test', bypassCache: true }), error => error.code === 'GEMINI_AUTH');
        assert.equal(requests.length, 1);
        assert.match(requests[0], /^https:\/\/generativelanguage\.googleapis\.com\//);
    } finally {
        if (previousGemini) require.cache[geminiPath] = previousGemini; else delete require.cache[geminiPath];
        global.fetch = originalFetch;
        if (old.key === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = old.key;
        if (old.model === undefined) delete process.env.GEMINI_MODEL; else process.env.GEMINI_MODEL = old.model;
    }
});

test('API modules load and SpiritFlow reports an unconfigured state without a source', async () => {
    for (const file of ['../api/ai-generate', '../api/user-settings', '../api/youtube-channel-select', '../api/youtube-comments', '../api/youtube-comments-list', '../api/youtube-comments-sync', '../api/youtube-comments-generate', '../api/youtube-comments-publish']) assert.doesNotThrow(() => require(file));
    const root = path.resolve(__dirname, '..');
    const player = require('node:fs').readFileSync(path.join(root, 'spiritflow-player.js'), 'utf8');
    const page = require('node:fs').readFileSync(path.join(root, 'spiritflow-sounds-radio.html'), 'utf8');
    assert.match(player, /programs:\s*\[\]/);
    assert.match(player, /schedule:\s*\[\]/);
    assert.match(player, /schedule has not been configured/);
    assert.doesNotMatch(page, /24\/7/);
    assert.match(page, /stream not configured/i);
    const names = ['SPIRITFLOW_STREAM_URL', 'SPIRITFLOW_YOUTUBE_LIVE_URL', 'SPIRITFLOW_YOUTUBE_CHANNEL_URL', 'SPIRITFLOW_RUMBLE_LIVE_URL', 'SPIRITFLOW_RUMBLE_CHANNEL_URL', 'SPIRITFLOW_AZURACAST_API_URL', 'SPIRITFLOW_AZURACAST_STATION_ID', 'SPIRITFLOW_AZURACAST_API_KEY'];
    const old = Object.fromEntries(names.map(name => [name, process.env[name]]));
    try {
        for (const name of names) delete process.env[name];
        const radio = require('../api/_spiritFlowCore');
        const config = JSON.parse(radio.spiritFlowConfigHandler().body);
        const nowPlaying = await radio.spiritFlowNowPlayingHandler();
        assert.equal(config.streamUrl, '');
        assert.equal(config.nowPlayingEndpoint, '');
        assert.equal(nowPlaying.statusCode, 503);
        assert.equal(JSON.parse(nowPlaying.body).configured, false);
    } finally {
        for (const name of names) if (old[name] === undefined) delete process.env[name]; else process.env[name] = old[name];
    }
});
