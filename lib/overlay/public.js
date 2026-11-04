const db = require('../db/supabase-rest');
const { hashToken, isOverlayKey, isValidToken, publicPayload } = require('./relay');

function firstRow(value) {
    return Array.isArray(value) ? (value[0] || null) : (value || null);
}

/* Public OBS reads are intentionally limited to presentation data. The SQL
 * function returns no user id, token hash or account information; this mapper
 * is a second allowlist in case the database shape changes later. */
async function readPublicOverlay(token) {
    if (!isValidToken(token)) return null;
    const result = await db.publicRpc('read_overlay_token', {
        p_token_hash: hashToken(token)
    });
    const row = firstRow(result);
    if (!row || !isOverlayKey(row.overlay_key)) return null;
    return {
        key: row.overlay_key,
        payload: publicPayload(row.payload),
        revision: Number(row.revision) || 0,
        updatedAt: row.updated_at || null
    };
}

module.exports = { readPublicOverlay };
