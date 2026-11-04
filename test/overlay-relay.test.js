const test = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = 'https://mock-supabase.test';
process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
process.env.SESSION_SECRET = 'development-test-secret-at-least-32-chars';
process.env.APP_BASE_URL = 'https://app.test';
process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY = 'development-youtube-token-secret-32chars';

const auth = require('../lib/auth/supabase');
const relay = require('../lib/overlay/relay');
const { checkPublicRateLimit } = require('../lib/security/rate-limit');
const overlayChannel = require('../api/overlay-channel');
const overlayPublish = require('../api/overlay-publish');
const overlayPublic = require('../api/overlay-public');

const identities = new Map([
    ['account-token-a', { id: 'user-a', email: 'a@example.test' }],
    ['account-token-b', { id: 'user-b', email: 'b@example.test' }]
]);
const channels = new Map();
const calls = { setToken: [], publish: [], read: [], rpc: [] };
let nextTokenDate = Date.now();

function channelKey(userId, overlayKey) {
    return `${userId}:${overlayKey}`;
}

function rowFor(userId, overlayKey) {
    return channels.get(channelKey(userId, overlayKey)) || null;
}

function jsonResponse(status, value) {
    return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

function authUser(init) {
    const authorization = init.headers?.Authorization || init.headers?.authorization || '';
    return identities.get(authorization.replace(/^Bearer\s+/i, '')) || null;
}

function rowPayload(row) {
    return {
        overlay_key: row.overlay_key,
        payload: {
            ...row.payload,
            user_id: row.user_id,
            token_hash: row.token_hash,
            comments: [{ text: 'must not leak' }],
            drafts: [{ text: 'must not leak' }]
        },
        revision: row.revision,
        updated_at: row.updated_at
    };
}

global.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || 'GET').toUpperCase();
    const authorization = init.headers?.Authorization || init.headers?.authorization || '';
    const user = authUser(init);
    const body = init.body ? JSON.parse(init.body) : {};

    if (url.hostname !== 'mock-supabase.test') {
        throw new Error(`Unexpected network request: ${url.hostname}`);
    }

    if (url.pathname === '/auth/v1/user') {
        return user ? jsonResponse(200, user) : jsonResponse(401, { message: 'Invalid token' });
    }

    if (url.pathname.startsWith('/rest/v1/rpc/')) {
        const name = url.pathname.split('/').pop();
        calls.rpc.push({ name, authorization, body });
        if (name === 'consume_rate_limit') {
            assert.ok(authorization, 'authenticated rate limiting uses the user token');
            return jsonResponse(200, [{ allowed: true, remaining: 10, reset_at: new Date(Date.now() + 60_000).toISOString() }]);
        }
        if (name === 'set_overlay_token') {
            assert.ok(user, 'token management requires an authenticated account');
            assert.equal(typeof body.p_token_hash, 'string');
            assert.match(body.p_token_hash, /^[a-f0-9]{64}$/);
            assert.equal(body.p_token, undefined, 'plaintext token must never be sent to Postgres');
            const key = channelKey(user.id, body.p_overlay_key);
            let row = channels.get(key);
            calls.setToken.push({ userId: user.id, body, before: row ? { ...row } : null });
            if (row?.token_hash && body.p_replace !== true) {
                return jsonResponse(200, [{ changed: false, token_created_at: row.token_created_at, token_rotated_at: row.token_rotated_at }]);
            }
            const now = new Date(nextTokenDate += 1000).toISOString();
            if (!row) {
                row = {
                    user_id: user.id,
                    overlay_key: body.p_overlay_key,
                    payload: {},
                    revision: 0,
                    token_created_at: now,
                    token_rotated_at: null,
                    token_revoked_at: null,
                    updated_at: now
                };
                channels.set(key, row);
            }
            row.token_hash = body.p_token_hash;
            row.token_created_at = row.token_created_at || now;
            row.token_rotated_at = body.p_replace === true ? now : row.token_rotated_at;
            row.token_revoked_at = null;
            row.updated_at = now;
            return jsonResponse(200, [{ changed: true, token_created_at: row.token_created_at, token_rotated_at: row.token_rotated_at }]);
        }
        if (name === 'revoke_overlay_token') {
            assert.ok(user, 'token revocation requires an authenticated account');
            const row = rowFor(user.id, body.p_overlay_key);
            if (row?.token_hash) {
                row.token_hash = null;
                row.token_revoked_at = new Date(nextTokenDate += 1000).toISOString();
                row.updated_at = row.token_revoked_at;
                return jsonResponse(200, true);
            }
            return jsonResponse(200, false);
        }
        if (name === 'publish_overlay') {
            assert.ok(user, 'publishing requires an authenticated account');
            assert.equal(typeof body.p_payload, 'object');
            calls.publish.push({ userId: user.id, body });
            const key = channelKey(user.id, body.p_overlay_key);
            let row = channels.get(key);
            if (!row) {
                row = {
                    user_id: user.id,
                    overlay_key: body.p_overlay_key,
                    payload: {},
                    revision: 0,
                    token_created_at: null,
                    token_rotated_at: null,
                    token_revoked_at: null,
                    updated_at: null
                };
                channels.set(key, row);
            }
            row.payload = body.p_payload;
            row.revision += 1;
            row.updated_at = new Date(nextTokenDate += 1000).toISOString();
            return jsonResponse(200, [{ revision: row.revision, updated_at: row.updated_at }]);
        }
        if (name === 'read_overlay_token') {
            assert.equal(authorization, '', 'public overlay reads must not send a user access token');
            assert.equal(init.headers?.apikey, process.env.SUPABASE_PUBLISHABLE_KEY);
            calls.read.push(body);
            for (const row of channels.values()) {
                if (row.token_hash === body.p_token_hash && row.token_hash && !row.token_revoked_at) {
                    return jsonResponse(200, [rowPayload(row)]);
                }
            }
            return jsonResponse(200, []);
        }
        return jsonResponse(404, { message: 'Unknown RPC' });
    }

    if (url.pathname.startsWith('/rest/v1/overlay_channels')) {
        assert.ok(user, 'the owner table requires an authenticated account');
        const filters = Object.fromEntries(url.searchParams.entries());
        const key = String(filters.overlay_key || '').replace(/^eq\./, '');
        const row = rowFor(user.id, key);
        return jsonResponse(200, row ? [row] : []);
    }

    throw new Error(`Unexpected Supabase request: ${method} ${url.pathname}`);
};

function sealCookie(userId, accessToken) {
    const value = auth.seal({
        accessToken,
        refreshToken: `refresh-${accessToken}`,
        expiresAt: Date.now() + 3_600_000
    }, process.env.SESSION_SECRET, 'auth-session');
    return `${auth.SESSION_COOKIE}=${encodeURIComponent(value)}; ${auth.SCOPE_COOKIE}=${userId}`;
}

function request({ method = 'GET', url = '/api/overlay-channel', body, cookie = sealCookie('user-a', 'account-token-a'), origin = 'https://app.test' } = {}) {
    return {
        method,
        url,
        headers: { host: 'app.test', origin, cookie },
        body
    };
}

function response() {
    const state = { statusCode: 200, headers: {}, body: null };
    const res = {
        setHeader(name, value) { state.headers[String(name).toLowerCase()] = value; return res; },
        status(code) { state.statusCode = code; return res; },
        json(value) { state.body = value; return res; },
        end(value) { state.body = value; return res; }
    };
    return { res, state };
}

test('relay token helpers use URL-safe entropy, one-way hashes, and a presentation-only payload allowlist', () => {
    const first = relay.generateToken();
    const second = relay.generateToken();
    assert.match(first, /^[A-Za-z0-9_-]{43}$/);
    assert.notEqual(first, second);
    assert.match(relay.hashToken(first), /^[a-f0-9]{64}$/);
    assert.notEqual(relay.hashToken(first), first);
    assert.equal(relay.isValidToken(first), true);
    assert.equal(relay.isValidToken('short'), false);
    assert.equal(relay.hashToken(first), relay.hashToken(first));

    const sanitized = relay.sanitizeOverlayPayload({
        reference: 'John 3:16',
        text: 'For God so loved the world',
        visible: true,
        isLoading: false,
        comments: 'private',
        token_hash: 'private',
        source: 'internal'
    });
    assert.deepEqual(sanitized, {
        reference: 'John 3:16',
        text: 'For God so loved the world',
        visible: true,
        isLoading: false
    });
    assert.equal(relay.publicPayload({
        reference: 'Psalm 23',
        text: 'The Lord is my shepherd',
        visible: true,
        user_id: 'secret',
        comments: ['secret']
    }).user_id, undefined);

    const url = relay.buildOverlayPageUrl('https://app.test/studio.html', 'church', first);
    assert.match(url, /^https:\/\/app\.test\/church_studio\.html\?overlay=lower-third&token=/);
    assert.equal(relay.buildOverlayPageUrl('https://app.test/', 'lower-third', first).includes('lower-third.html?token='), true);
});

test('anonymous OBS read limiter rejects repeated requests without a database credential', () => {
    const key = `test-${Date.now()}-${Math.random()}`;
    assert.equal(checkPublicRateLimit({ key, limit: 2, windowMs: 60_000 }).allowed, true);
    assert.equal(checkPublicRateLimit({ key, limit: 2, windowMs: 60_000 }).allowed, true);
    const blocked = checkPublicRateLimit({ key, limit: 2, windowMs: 60_000 });
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.degraded, true);
});

test('authenticated owner can create, publish, rotate, and revoke; public token is read-only and isolated', async () => {
    const channelReq = request({ method: 'POST', body: { action: 'create', key: 'lower-third' } });
    const createResponse = response();
    await overlayChannel(channelReq, createResponse.res);
    assert.equal(createResponse.state.statusCode, 200);
    const created = createResponse.state.body;
    assert.equal(created.ok, true);
    assert.match(created.token, /^[A-Za-z0-9_-]{43}$/);
    assert.match(created.url, /^https:\/\/app\.test\/lower-third\.html\?token=/);
    assert.equal(created.channel.tokenActive, true);
    assert.equal(JSON.stringify(created).includes('token_hash'), false);
    assert.equal(JSON.stringify(created).includes('user-a'), false);
    assert.equal(calls.setToken.length, 1);
    assert.equal(calls.setToken[0].body.p_token_hash, relay.hashToken(created.token));
    assert.notEqual(calls.setToken[0].body.p_token_hash, created.token);

    const duplicateResponse = response();
    await overlayChannel(request({ method: 'POST', body: { action: 'create', key: 'lower-third' } }), duplicateResponse.res);
    assert.equal(duplicateResponse.state.statusCode, 409);
    assert.equal(duplicateResponse.state.body.code, 'TOKEN_ALREADY_EXISTS');

    const publishResponse = response();
    await overlayPublish(request({
        method: 'POST',
        url: '/api/overlay-publish',
        body: {
            key: 'lower-third',
            payload: {
                reference: 'John 3:16',
                text: 'For God so loved the world',
                visible: true,
                comments: 'not allowed'
            }
        }
    }), publishResponse.res);
    assert.equal(publishResponse.state.statusCode, 200);
    assert.equal(publishResponse.state.body.ok, true);
    assert.equal(publishResponse.state.body.key, 'lower-third');
    assert.equal(calls.publish.length, 1);
    assert.deepEqual(calls.publish[0].body.p_payload, {
        reference: 'John 3:16',
        text: 'For God so loved the world',
        visible: true
    });
    assert.equal(JSON.stringify(publishResponse.state.body).includes('token'), false);

    const publicResponse = response();
    await overlayPublic(request({
        url: `/api/overlay-public?token=${encodeURIComponent(created.token)}`,
        cookie: ''
    }), publicResponse.res);
    assert.equal(publicResponse.state.statusCode, 200);
    const overlay = publicResponse.state.body.overlay;
    assert.equal(overlay.key, 'lower-third');
    assert.deepEqual(overlay.payload, {
        reference: 'John 3:16',
        text: 'For God so loved the world',
        visible: true
    });
    assert.equal(JSON.stringify(overlay).includes('user_id'), false);
    assert.equal(JSON.stringify(overlay).includes('token_hash'), false);
    assert.equal(JSON.stringify(overlay).includes('comments'), false);
    assert.equal(JSON.stringify(overlay).includes('drafts'), false);
    assert.equal(calls.read.at(-1).p_token_hash, relay.hashToken(created.token));
    assert.equal(publicResponse.state.headers['cache-control'].includes('no-store'), true);

    const ownerMetadata = response();
    await overlayChannel(request({ url: '/api/overlay-channel?key=lower-third' }), ownerMetadata.res);
    assert.equal(ownerMetadata.state.statusCode, 200);
    assert.equal(JSON.stringify(ownerMetadata.state.body).includes('token_hash'), false);
    assert.equal(JSON.stringify(ownerMetadata.state.body).includes(created.token), false);

    const otherTenant = response();
    await overlayChannel(request({
        url: '/api/overlay-channel?key=lower-third',
        cookie: sealCookie('user-b', 'account-token-b')
    }), otherTenant.res);
    assert.equal(otherTenant.state.statusCode, 200);
    assert.equal(otherTenant.state.body.channel.exists, false);
    assert.equal(otherTenant.state.body.channel.tokenActive, false);

    const otherPublish = response();
    await overlayPublish(request({
        method: 'POST',
        url: '/api/overlay-publish',
        cookie: sealCookie('user-b', 'account-token-b'),
        body: {
            key: 'lower-third',
            payload: { reference: 'B account', text: 'Must not reach A', visible: true }
        }
    }), otherPublish.res);
    assert.equal(otherPublish.state.statusCode, 200);
    const stillOwnerA = response();
    await overlayPublic(request({
        url: `/api/overlay-public?token=${encodeURIComponent(created.token)}`,
        cookie: ''
    }), stillOwnerA.res);
    assert.equal(stillOwnerA.state.statusCode, 200);
    assert.equal(stillOwnerA.state.body.overlay.payload.reference, 'John 3:16');
    assert.equal(stillOwnerA.state.body.overlay.payload.text, 'For God so loved the world');

    const rotateResponse = response();
    await overlayChannel(request({ method: 'POST', body: { action: 'rotate', key: 'lower-third' } }), rotateResponse.res);
    assert.equal(rotateResponse.state.statusCode, 200);
    const rotated = rotateResponse.state.body;
    assert.notEqual(rotated.token, created.token);
    assert.equal(rotated.channel.tokenActive, true);
    assert.equal(calls.setToken.at(-1).body.p_replace, true);

    const oldTokenResponse = response();
    await overlayPublic(request({ url: `/api/overlay-public?token=${encodeURIComponent(created.token)}`, cookie: '' }), oldTokenResponse.res);
    assert.equal(oldTokenResponse.state.statusCode, 404);

    const newTokenResponse = response();
    await overlayPublic(request({ url: `/api/overlay-public?token=${encodeURIComponent(rotated.token)}`, cookie: '' }), newTokenResponse.res);
    assert.equal(newTokenResponse.state.statusCode, 200);

    const revokeResponse = response();
    await overlayChannel(request({ method: 'POST', body: { action: 'revoke', key: 'lower-third' } }), revokeResponse.res);
    assert.equal(revokeResponse.state.statusCode, 200);
    assert.equal(revokeResponse.state.body.channel.tokenActive, false);
    assert.equal(JSON.stringify(revokeResponse.state.body).includes(rotated.token), false);

    const revokedResponse = response();
    await overlayPublic(request({ url: `/api/overlay-public?token=${encodeURIComponent(rotated.token)}`, cookie: '' }), revokedResponse.res);
    assert.equal(revokedResponse.state.statusCode, 404);

    const writeAttempt = response();
    await overlayPublic(request({
        method: 'POST',
        url: `/api/overlay-public?token=${encodeURIComponent(rotated.token)}`,
        cookie: ''
    }), writeAttempt.res);
    assert.equal(writeAttempt.state.statusCode, 405);

    const invalidResponse = response();
    await overlayPublic(request({ url: '/api/overlay-public?token=not-a-valid-token', cookie: '' }), invalidResponse.res);
    assert.equal(invalidResponse.state.statusCode, 404);
});
