const auth = require('../lib/auth/supabase');
const { accountForRequest, accountHeaders } = require('../lib/auth/youtube-context');
const store = require('../lib/db/overlay-store');
const { generateToken, hashToken, buildOverlayPageUrl, requireOverlayKey } = require('../lib/overlay/relay');
const { checkRateLimit, retryAfterSeconds } = require('../lib/security/rate-limit');

const MAX_BODY_BYTES = 8 * 1024;

function json(res, status, body, headers = {}) {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value));
    return res.status(status).json(body);
}

function readBody(req) {
    if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
    if (typeof req.body === 'string') {
        try { return Promise.resolve(JSON.parse(req.body)); }
        catch (_) { return Promise.reject(Object.assign(new Error('Request must contain valid JSON.'), { status: 400, code: 'INVALID_JSON' })); }
    }
    return new Promise((resolve, reject) => {
        let raw = '';
        let size = 0;
        const finish = () => {
            try { resolve(JSON.parse(raw || '{}')); }
            catch (_) { reject(Object.assign(new Error('Request must contain valid JSON.'), { status: 400, code: 'INVALID_JSON' })); }
        };
        req.on('data', chunk => {
            size += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
            if (size > MAX_BODY_BYTES) {
                reject(Object.assign(new Error('Request is too large.'), { status: 413, code: 'REQUEST_TOO_LARGE' }));
                req.destroy?.();
                return;
            }
            raw += chunk;
        });
        req.on('end', finish);
        req.on('error', reject);
    });
}

function publicBase(req) {
    try { return auth.origin(req); } catch (_) { return String(process.env.APP_BASE_URL || '').replace(/\/+$/, '') || 'http://localhost'; }
}

function keyFrom(value) {
    try { return requireOverlayKey(value || 'lower-third'); }
    catch (error) { return error; }
}

function failure(res, error, setCookie) {
    const status = Number(error?.status) || 503;
    const safeStatus = status >= 500 ? 503 : status;
    const message = safeStatus >= 500
        ? 'Overlay services are temporarily unavailable.'
        : (error?.message || 'Overlay request failed.');
    const body = { ok: false, code: error?.code || (safeStatus === 401 ? 'UNAUTHENTICATED' : 'OVERLAY_ERROR'), error: message };
    return json(res, safeStatus, body, accountHeaders({ setCookie }));
}

module.exports = async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'POST') {
        res.setHeader('Allow', 'GET, POST');
        return json(res, 405, { ok: false, error: 'Method not allowed.' });
    }
    if (req.method === 'POST' && !auth.isSameOrigin(req)) {
        return json(res, 403, { ok: false, code: 'ORIGIN_NOT_ALLOWED', error: 'Request origin not allowed.' });
    }

    const account = await accountForRequest(req);
    if (account.error) return failure(res, account.error, account.setCookie);

    try {
        if (req.method === 'GET') {
            const url = new URL(req.url || '/api/overlay-channel', 'http://localhost');
            const key = keyFrom(url.searchParams.get('key'));
            if (key instanceof Error) return failure(res, key, account.setCookie);
            const channel = await store.getOverlay(account.user, account.accessToken, key);
            return json(res, 200, { ok: true, channel }, accountHeaders(account));
        }

        const limit = await checkRateLimit({
            user: account.user,
            accessToken: account.accessToken,
            bucket: 'overlay-token-management',
            limit: 20,
            windowMs: 60_000
        });
        if (!limit.allowed) {
            return json(res, 429, {
                ok: false,
                code: 'RATE_LIMITED',
                error: 'Too many overlay link changes. Try again shortly.'
            }, { ...accountHeaders(account), 'Retry-After': String(retryAfterSeconds(limit)) });
        }

        const body = await readBody(req);
        const action = String(body.action || '').toLowerCase();
        if (!['create', 'rotate', 'revoke'].includes(action)) {
            return failure(res, Object.assign(new Error('Choose create, rotate or revoke.'), { status: 400, code: 'INVALID_ACTION' }), account.setCookie);
        }
        const key = keyFrom(body.key);
        if (key instanceof Error) return failure(res, key, account.setCookie);

        if (action === 'revoke') {
            await store.revokeOverlayToken(account.user, account.accessToken, key);
            const channel = await store.getOverlay(account.user, account.accessToken, key);
            return json(res, 200, { ok: true, action, channel }, accountHeaders(account));
        }

        const token = generateToken();
        const result = await store.setOverlayToken(
            account.user,
            account.accessToken,
            key,
            hashToken(token),
            { replace: action === 'rotate' }
        );
        if (!result.changed) {
            return failure(res, Object.assign(new Error('An active OBS token already exists. Rotate it instead.'), { status: 409, code: 'TOKEN_ALREADY_EXISTS' }), account.setCookie);
        }

        const channel = await store.getOverlay(account.user, account.accessToken, key);
        const url = buildOverlayPageUrl(publicBase(req), key, token);
        /* Plaintext token is returned exactly once, in this response. Later GET
         * requests can confirm the token is active but can never read it. */
        return json(res, 200, { ok: true, action, token, url, channel }, accountHeaders(account));
    } catch (error) {
        return failure(res, error, account.setCookie);
    }
};
