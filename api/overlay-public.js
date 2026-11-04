const auth = require('../lib/auth/supabase');
const { hashToken, isValidToken } = require('../lib/overlay/relay');
const { readPublicOverlay } = require('../lib/overlay/public');
const { checkPublicRateLimit, retryAfterSeconds } = require('../lib/security/rate-limit');

function setSecurityHeaders(res) {
    res.setHeader('Cache-Control', 'no-store, max-age=0, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
}

function json(res, status, body, headers = {}) {
    setSecurityHeaders(res);
    Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value));
    return res.status(status).json(body);
}

function clientAddress(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const real = String(req.headers['x-real-ip'] || '').trim();
    const socket = String(req.socket?.remoteAddress || '').trim();
    return (forwarded || real || socket || 'unknown').slice(0, 96);
}

function failure(res, status, code, message, headers = {}) {
    return json(res, status, { ok: false, code, error: message }, headers);
}

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.setHeader('Allow', 'GET, HEAD, OPTIONS');
        res.status(204).end();
        return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD, OPTIONS');
        return failure(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
    }
    if (req.headers.origin && !auth.isSameOrigin(req)) {
        return failure(res, 403, 'ORIGIN_NOT_ALLOWED', 'Request origin not allowed.');
    }

    let url;
    try { url = new URL(req.url || '/api/overlay-public', 'http://localhost'); }
    catch (_) { return failure(res, 400, 'INVALID_REQUEST', 'Invalid overlay request.'); }

    const token = String(url.searchParams.get('token') || '');
    if (!isValidToken(token)) {
        return failure(res, 404, 'OVERLAY_NOT_FOUND', 'This OBS overlay link is invalid or has been revoked.');
    }

    const tokenHash = hashToken(token);
    const now = Date.now();
    const byAddress = checkPublicRateLimit({
        key: `read:ip:${clientAddress(req)}`,
        limit: 600,
        windowMs: 60_000,
        now
    });
    const byToken = checkPublicRateLimit({
        key: `read:token:${tokenHash}`,
        limit: 240,
        windowMs: 60_000,
        now
    });
    if (!byAddress.allowed || !byToken.allowed) {
        const reset = Math.max(byAddress.resetAt || now, byToken.resetAt || now);
        return failure(res, 429, 'RATE_LIMITED', 'Too many overlay requests. Try again shortly.', {
            'Retry-After': String(retryAfterSeconds({ resetAt: reset }, now))
        });
    }

    try {
        const overlay = await readPublicOverlay(token);
        if (!overlay) {
            return failure(res, 404, 'OVERLAY_NOT_FOUND', 'This OBS overlay link is invalid or has been revoked.');
        }
        setSecurityHeaders(res);
        if (req.method === 'HEAD') {
            res.status(200).end();
            return;
        }
        return json(res, 200, { ok: true, overlay });
    } catch (error) {
        if (Number(error?.status) === 404) {
            return failure(res, 404, 'OVERLAY_NOT_FOUND', 'This OBS overlay link is invalid or has been revoked.');
        }
        return failure(res, 503, 'OVERLAY_UNAVAILABLE', 'Overlay services are temporarily unavailable.');
    }
};
