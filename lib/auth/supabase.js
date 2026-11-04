const crypto = require('crypto');

const SESSION_COOKIE = 'omni_session';
const FLOW_COOKIE = 'omni_auth_flow';
const CHANNEL_COOKIE = 'omni_channel';
const SCOPE_COOKIE = 'omni_scope';
const COOKIE_TTL_SECONDS = 7 * 24 * 60 * 60;

function getConfig() {
    const url = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
    const apiKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || '';
    const sessionSecret = process.env.SESSION_SECRET || '';
    let validUrl = false;
    try {
        const parsed = new URL(url);
        validUrl = (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(parsed.hostname)))
            && !parsed.username && !parsed.password && parsed.pathname === '/' && !parsed.search && !parsed.hash;
    } catch (_) {}
    let elevatedKey = /^sb_secret_/i.test(apiKey);
    try {
        const payload = apiKey.split('.')[1];
        if (payload) elevatedKey = elevatedKey || JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).role === 'service_role';
    } catch (_) {}
    const validKey = !!apiKey && !elevatedKey;
    return { url, apiKey, sessionSecret, configured: validUrl && validKey && sessionSecret.length >= 32 };
}

function cookieKey(secret, purpose) {
    return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret), Buffer.from('omnicast-cookie-v1'), Buffer.from(purpose), 32));
}

function seal(value, secret, purpose) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', cookieKey(secret, purpose), iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}

function open(value, secret, purpose) {
    if (!value || !secret) return null;
    try {
        const raw = Buffer.from(value, 'base64url');
        if (raw.length < 29) return null;
        const decipher = crypto.createDecipheriv('aes-256-gcm', cookieKey(secret, purpose), raw.subarray(0, 12));
        decipher.setAuthTag(raw.subarray(12, 28));
        return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'));
    } catch (_) { return null; }
}

function parseCookies(header = '') {
    return header.split(';').reduce((items, part) => {
        const split = part.indexOf('=');
        if (split < 0) return items;
        try { items[part.slice(0, split).trim()] = decodeURIComponent(part.slice(split + 1).trim()); } catch (_) {}
        return items;
    }, {});
}

function origin(req) {
    const host = String(req.headers.host || '').trim();
    if (!host || /[\s,\\/@?#\r\n]/.test(host)) throw new Error('Request host is invalid.');
    const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host);
    const parsed = new URL(`${isLocal ? 'http' : 'https'}://${host}`);
    if (!parsed.hostname || parsed.username || parsed.password) throw new Error('Request host is invalid.');
    return parsed.origin;
}

function baseUrl(req) {
    return String(process.env.APP_BASE_URL || origin(req)).replace(/\/+$/, '');
}

/* Accept an Origin only when it matches APP_BASE_URL or the request's own
 * origin. This keeps state-changing routes CSRF-safe while allowing Vercel
 * preview deployments (which have a different host to APP_BASE_URL) to work. */
function isSameOrigin(req) {
    const header = req.headers.origin;
    if (!header) return false;
    let parsed;
    try { parsed = new URL(header); } catch (_) { return false; }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const allowed = new Set();
    try { allowed.add(new URL(baseUrl(req)).origin); } catch (_) {}
    try { allowed.add(origin(req)); } catch (_) {}
    return allowed.has(parsed.origin);
}

function serializeCookie(name, value, req, maxAge = COOKIE_TTL_SECONDS, { httpOnly = true } = {}) {
    const secure = !origin(req).startsWith('http://localhost') && !origin(req).startsWith('http://127.0.0.1');
    return `${name}=${encodeURIComponent(value)}; Path=/;${httpOnly ? ' HttpOnly;' : ''} SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function clearCookie(name, req) { return serializeCookie(name, '', req, 0); }

function getSealedCookie(req, name, purpose) {
    const config = getConfig();
    const cookies = parseCookies(req.headers.cookie || '');
    return open(cookies[name], config.sessionSecret, purpose);
}

async function authRequest(path, { method = 'GET', body, accessToken, signal } = {}) {
    const config = getConfig();
    if (!config.configured) throw Object.assign(new Error('Supabase authentication is not configured.'), { status: 503, code: 'AUTH_NOT_CONFIGURED' });
    const response = await fetch(`${config.url}/auth/v1${path}`, {
        method,
        headers: {
            apikey: config.apiKey,
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
            ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        ...(signal ? { signal } : {})
    });
    let data = {};
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) {
        const status = response.status === 400 || response.status === 401 ? 401 : response.status;
        throw Object.assign(new Error(status === 401 ? 'Sign in again to continue.' : 'Authentication service is temporarily unavailable.'), { status, code: data.error_code || 'AUTH_FAILED' });
    }
    return data;
}

function createAuthSession(req, session, userId = null) {
    const config = getConfig();
    const expiry = Math.min(Number(session.expires_in) || 3600, COOKIE_TTL_SECONDS);
    const value = seal({ accessToken: session.access_token, refreshToken: session.refresh_token, expiresAt: Date.now() + expiry * 1000 - 30_000 }, config.sessionSecret, 'auth-session');
    const sessionCookie = serializeCookie(SESSION_COOKIE, value, req, COOKIE_TTL_SECONDS);
    if (!userId) return sessionCookie;
    const scopeCookie = serializeCookie(SCOPE_COOKIE, String(userId), req, COOKIE_TTL_SECONDS, { httpOnly: false });
    return [sessionCookie, scopeCookie];
}

async function authenticateRequest(req) {
    const config = getConfig();
    if (!config.configured) return { error: Object.assign(new Error('Account sign-in is not configured.'), { status: 503, code: 'AUTH_NOT_CONFIGURED' }) };
    let session = getSealedCookie(req, SESSION_COOKIE, 'auth-session');
    if (!session?.accessToken || !session?.refreshToken) return { error: Object.assign(new Error('Sign in to your Omnicast account first.'), { status: 401, code: 'UNAUTHENTICATED' }) };
    let setCookie;
    try {
        if (!Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now()) {
            const refreshed = await authRequest('/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: session.refreshToken } });
            const nextSession = { access_token: refreshed.access_token, refresh_token: refreshed.refresh_token || session.refreshToken, expires_in: refreshed.expires_in };
            if (!nextSession.access_token) throw Object.assign(new Error('Sign in again to continue.'), { status: 401, code: 'AUTH_EXPIRED' });
            setCookie = createAuthSession(req, nextSession);
            session = { accessToken: nextSession.access_token, refreshToken: nextSession.refresh_token, expiresAt: Date.now() + (Number(nextSession.expires_in) || 3600) * 1000 - 30_000 };
        }
        const user = await authRequest('/user', { accessToken: session.accessToken });
        if (!user?.id) throw Object.assign(new Error('Sign in again to continue.'), { status: 401, code: 'AUTH_INVALID' });
        return { user: { id: user.id, email: user.email || null }, accessToken: session.accessToken, setCookie };
    } catch (error) {
        return { error, clearCookie: error.status === 401 ? clearCookie(SESSION_COOKIE, req) : undefined };
    }
}

function encryptSecret(value, purpose = 'youtube-token') {
    const keyText = process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY || '';
    if (keyText.length < 32) throw Object.assign(new Error('YouTube token encryption is not configured.'), { status: 503, code: 'TOKEN_ENCRYPTION_NOT_CONFIGURED' });
    const iv = crypto.randomBytes(12);
    const key = crypto.hkdfSync('sha256', Buffer.from(keyText), Buffer.from('omnicast-data-v1'), Buffer.from(purpose), 32);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}

function decryptSecret(value, purpose = 'youtube-token') {
    const keyText = process.env.YOUTUBE_TOKEN_ENCRYPTION_KEY || '';
    if (keyText.length < 32 || !value) throw Object.assign(new Error('YouTube channel credentials are unavailable.'), { status: 503, code: 'TOKEN_ENCRYPTION_NOT_CONFIGURED' });
    try {
        const raw = Buffer.from(value, 'base64url');
        const key = crypto.hkdfSync('sha256', Buffer.from(keyText), Buffer.from('omnicast-data-v1'), Buffer.from(purpose), 32);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
        decipher.setAuthTag(raw.subarray(12, 28));
        return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
    } catch (_) { throw Object.assign(new Error('YouTube channel credentials could not be decrypted.'), { status: 503, code: 'TOKEN_DECRYPT_FAILED' }); }
}

module.exports = {
    SESSION_COOKIE, FLOW_COOKIE, CHANNEL_COOKIE, SCOPE_COOKIE, COOKIE_TTL_SECONDS,
    getConfig, seal, open, parseCookies, origin, baseUrl, isSameOrigin, serializeCookie, clearCookie,
    getSealedCookie, authRequest, createAuthSession, authenticateRequest,
    encryptSecret, decryptSecret
};
