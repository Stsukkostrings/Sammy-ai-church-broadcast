const { getConfig } = require('../auth/supabase');

const ALLOWED_TABLES = new Set(['profiles', 'youtube_channels', 'comments', 'comment_drafts', 'published_replies', 'user_settings', 'overlay_channels']);
const ALLOWED_RPCS = new Set(['claim_comment_publish', 'release_comment_publish', 'complete_comment_publish', 'recover_stale_publish', 'consume_rate_limit', 'publish_overlay', 'set_overlay_token', 'revoke_overlay_token']);
const PUBLIC_RPCS = new Set(['read_overlay_token']);

function queryString(params = {}) {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
        if (value === undefined || value === null) continue;
        search.set(key, String(value));
    }
    const value = search.toString();
    return value ? `?${value}` : '';
}

async function request(table, { method = 'GET', filters = {}, body, accessToken, prefer, range } = {}) {
    if (!ALLOWED_TABLES.has(table)) throw new Error('Database table is not allowed.');
    const config = getConfig();
    if (!config.configured) throw Object.assign(new Error('Persistent storage is not configured.'), { status: 503, code: 'DATABASE_NOT_CONFIGURED' });
    if (!accessToken) throw Object.assign(new Error('An authenticated account is required.'), { status: 401, code: 'UNAUTHENTICATED' });
    const response = await fetch(`${config.url}/rest/v1/${table}${queryString(filters)}`, {
        method,
        headers: {
            apikey: config.apiKey,
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
            ...(range ? { Range: range, 'Range-Unit': 'items' } : {}),
            ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...(prefer ? { Prefer: prefer } : {})
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {})
    });
    let data = null;
    if (response.status !== 204) {
        try { data = await response.json(); } catch (_) {}
    }
    if (!response.ok) {
        const status = response.status === 401 || response.status === 403 ? 403 : response.status >= 500 ? 503 : response.status;
        throw Object.assign(new Error(status === 403 ? 'You are not authorized to access this record.' : 'Persistent storage request failed.'), { status, code: status === 403 ? 'FORBIDDEN' : 'DATABASE_ERROR' });
    }
    return data;
}

async function rpc(name, body, accessToken) {
    if (!ALLOWED_RPCS.has(name)) throw new Error('Database operation is not allowed.');
    const config = getConfig();
    if (!config.configured) throw Object.assign(new Error('Persistent storage is not configured.'), { status: 503, code: 'DATABASE_NOT_CONFIGURED' });
    if (!accessToken) throw Object.assign(new Error('An authenticated account is required.'), { status: 401, code: 'UNAUTHENTICATED' });
    const response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
        method: 'POST', headers: { apikey: config.apiKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body)
    });
    let data = null; try { data = await response.json(); } catch (_) {}
    if (!response.ok) throw Object.assign(new Error(response.status === 401 || response.status === 403 ? 'You are not authorized to access this record.' : 'Persistent storage request failed.'), { status: response.status === 401 || response.status === 403 ? 403 : 503, code: 'DATABASE_ERROR' });
    return data;
}

/* The OBS public endpoint deliberately uses the publishable/anon key only. It
 * has no user access token and cannot use a service-role credential. The
 * database exposes a single read-only SECURITY DEFINER function for this path. */
async function publicRpc(name, body) {
    if (!PUBLIC_RPCS.has(name)) throw new Error('Public database operation is not allowed.');
    const config = getConfig();
    if (!config.configured) throw Object.assign(new Error('Persistent storage is not configured.'), { status: 503, code: 'DATABASE_NOT_CONFIGURED' });
    const response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: { apikey: config.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body)
    });
    let data = null;
    try { data = await response.json(); } catch (_) {}
    if (!response.ok) {
        const status = response.status === 401 || response.status === 403 ? 404 : response.status >= 500 ? 503 : response.status;
        throw Object.assign(new Error('Overlay storage is temporarily unavailable.'), { status, code: status === 404 ? 'OVERLAY_NOT_FOUND' : 'DATABASE_ERROR' });
    }
    return data;
}

function scopedFilters(userId, extra = {}) {
    if (!userId) throw Object.assign(new Error('Authenticated user is required.'), { status: 401, code: 'UNAUTHENTICATED' });
    return { ...extra, user_id: `eq.${userId}` };
}

module.exports = { request, rpc, publicRpc, scopedFilters };
