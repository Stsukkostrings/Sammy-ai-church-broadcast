const db = require('./supabase-rest');
const { requireOverlayKey } = require('../overlay/relay');

const SAFE_COLUMNS = 'overlay_key,revision,updated_at,token_created_at,token_rotated_at,token_revoked_at';

function firstRow(value) {
    return Array.isArray(value) ? (value[0] || null) : (value || null);
}

function metadata(row, overlayKey) {
    const tokenActive = Boolean(row?.token_created_at && !row?.token_revoked_at);
    return {
        key: row?.overlay_key || overlayKey,
        exists: Boolean(row),
        tokenActive,
        tokenCreatedAt: row?.token_created_at || null,
        tokenRotatedAt: row?.token_rotated_at || null,
        tokenRevokedAt: row?.token_revoked_at || null,
        revision: Number(row?.revision) || 0,
        updatedAt: row?.updated_at || null
    };
}

async function listOverlays(user, accessToken) {
    const rows = await db.request('overlay_channels', {
        accessToken,
        filters: db.scopedFilters(user.id, { select: SAFE_COLUMNS, order: 'overlay_key.asc' })
    });
    return (rows || []).map(row => metadata(row, row.overlay_key));
}

async function getOverlay(user, accessToken, overlayKey) {
    const key = requireOverlayKey(overlayKey);
    const rows = await db.request('overlay_channels', {
        accessToken,
        filters: db.scopedFilters(user.id, { overlay_key: `eq.${key}`, select: SAFE_COLUMNS })
    });
    return metadata(rows?.[0] || null, key);
}

async function publishOverlay(user, accessToken, overlayKey, payload) {
    const key = requireOverlayKey(overlayKey);
    if (!user?.id || !accessToken) {
        throw Object.assign(new Error('Sign in to publish an overlay.'), { status: 401, code: 'UNAUTHENTICATED' });
    }
    const result = await db.rpc('publish_overlay', {
        p_overlay_key: key,
        p_payload: payload
    }, accessToken);
    const row = firstRow(result);
    if (!row) throw Object.assign(new Error('Overlay update was not stored.'), { status: 503, code: 'OVERLAY_PUBLISH_FAILED' });
    return {
        key,
        revision: Number(row.revision) || 0,
        updatedAt: row.updated_at || null
    };
}

async function setOverlayToken(user, accessToken, overlayKey, tokenHash, { replace = false } = {}) {
    const key = requireOverlayKey(overlayKey);
    if (!user?.id || !accessToken) {
        throw Object.assign(new Error('Sign in to manage an overlay link.'), { status: 401, code: 'UNAUTHENTICATED' });
    }
    const result = await db.rpc('set_overlay_token', {
        p_overlay_key: key,
        p_token_hash: tokenHash,
        p_replace: Boolean(replace)
    }, accessToken);
    const row = firstRow(result);
    return {
        changed: Boolean(row?.changed),
        tokenCreatedAt: row?.token_created_at || null,
        tokenRotatedAt: row?.token_rotated_at || null
    };
}

async function revokeOverlayToken(user, accessToken, overlayKey) {
    const key = requireOverlayKey(overlayKey);
    if (!user?.id || !accessToken) {
        throw Object.assign(new Error('Sign in to revoke an overlay link.'), { status: 401, code: 'UNAUTHENTICATED' });
    }
    const result = await db.rpc('revoke_overlay_token', { p_overlay_key: key }, accessToken);
    return result === true || firstRow(result) === true;
}

module.exports = {
    listOverlays,
    getOverlay,
    publishOverlay,
    setOverlayToken,
    revokeOverlayToken
};
