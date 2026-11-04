const auth = require('../lib/auth/supabase');
const { accountForRequest, accountHeaders } = require('../lib/auth/youtube-context');
const store = require('../lib/db/overlay-store');
const { requireOverlayKey, sanitizeOverlayPayload } = require('../lib/overlay/relay');
const { checkRateLimit, retryAfterSeconds } = require('../lib/security/rate-limit');

const MAX_BODY_BYTES = 32 * 1024;

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
        const onData = chunk => {
            size += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
            if (size > MAX_BODY_BYTES) {
                req.removeListener?.('data', onData);
                req.removeListener?.('end', onEnd);
                reject(Object.assign(new Error('Request is too large.'), { status: 413, code: 'REQUEST_TOO_LARGE' }));
                return;
            }
            raw += chunk;
        };
        const onEnd = () => {
            try { resolve(JSON.parse(raw || '{}')); }
            catch (_) { reject(Object.assign(new Error('Request must contain valid JSON.'), { status: 400, code: 'INVALID_JSON' })); }
        };
        req.on('data', onData);
        req.on('end', onEnd);
        req.on('error', reject);
    });
}

function failure(res, error, setCookie) {
    const status = Number(error?.status) || 503;
    const safeStatus = status >= 500 ? 503 : status;
    const message = safeStatus >= 500
        ? 'Overlay services are temporarily unavailable.'
        : (error?.message || 'Overlay update failed.');
    return json(res, safeStatus, {
        ok: false,
        code: error?.code || (safeStatus === 401 ? 'UNAUTHENTICATED' : 'OVERLAY_ERROR'),
        error: message
    }, accountHeaders({ setCookie }));
}

module.exports = async (req, res) => {
    res.setHeader('Allow', 'POST');
    if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Method not allowed.' });
    if (!auth.isSameOrigin(req)) return json(res, 403, { ok: false, code: 'ORIGIN_NOT_ALLOWED', error: 'Request origin not allowed.' });

    const account = await accountForRequest(req);
    if (account.error) return failure(res, account.error, account.setCookie);

    try {
        const limit = await checkRateLimit({
            user: account.user,
            accessToken: account.accessToken,
            bucket: 'overlay-publish',
            limit: 120,
            windowMs: 60_000
        });
        if (!limit.allowed) {
            return json(res, 429, {
                ok: false,
                code: 'RATE_LIMITED',
                error: 'Too many overlay updates. Try again shortly.'
            }, { ...accountHeaders(account), 'Retry-After': String(retryAfterSeconds(limit)) });
        }

        const body = await readBody(req);
        let key;
        let payload;
        try {
            key = requireOverlayKey(body.key || 'lower-third');
            payload = sanitizeOverlayPayload(body.payload);
        } catch (error) {
            return failure(res, error, account.setCookie);
        }

        const result = await store.publishOverlay(account.user, account.accessToken, key, payload);
        return json(res, 200, {
            ok: true,
            key: result.key,
            revision: result.revision,
            updatedAt: result.updatedAt
        }, accountHeaders(account));
    } catch (error) {
        return failure(res, error, account.setCookie);
    }
};
