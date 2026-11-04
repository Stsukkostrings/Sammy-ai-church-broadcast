const crypto = require('crypto');

/* Shared OBS relay rules. The Node runtime generates the only plaintext token
 * an overlay will ever receive. Postgres stores a SHA-256 hash, never the
 * token itself, so a database read cannot reconstruct an OBS URL. */
const OVERLAY_KEYS = Object.freeze({
    LOWER_THIRD: 'lower-third',
    CHURCH: 'church'
});
const OVERLAY_KEY_VALUES = Object.freeze(Object.values(OVERLAY_KEYS));
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const MAX_REFERENCE_LENGTH = 300;
const MAX_TEXT_LENGTH = 8000;
const MAX_PAYLOAD_BYTES = 16 * 1024;

function isOverlayKey(value) {
    return OVERLAY_KEY_VALUES.includes(String(value || ''));
}

function requireOverlayKey(value) {
    const key = String(value || '');
    if (!isOverlayKey(key)) {
        throw Object.assign(new Error('Choose a valid overlay channel.'), { status: 400, code: 'INVALID_OVERLAY_KEY' });
    }
    return key;
}

function generateToken() {
    return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token || ''), 'utf8').digest('hex');
}

function isValidToken(token) {
    return TOKEN_PATTERN.test(String(token || ''));
}

function isHash(value) {
    return HASH_PATTERN.test(String(value || ''));
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function textValue(value, max) {
    return typeof value === 'string' ? value.slice(0, max) : '';
}

/* Public responses are rebuilt from an allowlist. A future database column or
 * accidental extra payload property must never pass through to OBS. */
function publicPayload(value) {
    const source = isPlainObject(value) ? value : {};
    const payload = {
        reference: textValue(source.reference, MAX_REFERENCE_LENGTH),
        text: textValue(source.text, MAX_TEXT_LENGTH),
        visible: typeof source.visible === 'boolean' ? source.visible : true
    };
    if (typeof source.isLoading === 'boolean') payload.isLoading = source.isLoading;
    if (typeof source.hidden === 'boolean') payload.hidden = source.hidden;
    return payload;
}

function sanitizeOverlayPayload(value) {
    if (!isPlainObject(value)) {
        throw Object.assign(new Error('Overlay payload must be an object.'), { status: 400, code: 'INVALID_OVERLAY_PAYLOAD' });
    }
    if (value.reference != null && typeof value.reference !== 'string') {
        throw Object.assign(new Error('Overlay reference must be text.'), { status: 400, code: 'INVALID_OVERLAY_PAYLOAD' });
    }
    if (value.text != null && typeof value.text !== 'string') {
        throw Object.assign(new Error('Overlay text must be text.'), { status: 400, code: 'INVALID_OVERLAY_PAYLOAD' });
    }
    if (value.visible != null && typeof value.visible !== 'boolean') {
        throw Object.assign(new Error('Overlay visibility must be true or false.'), { status: 400, code: 'INVALID_OVERLAY_PAYLOAD' });
    }
    if (value.isLoading != null && typeof value.isLoading !== 'boolean') {
        throw Object.assign(new Error('Overlay loading state must be true or false.'), { status: 400, code: 'INVALID_OVERLAY_PAYLOAD' });
    }
    if (value.hidden != null && typeof value.hidden !== 'boolean') {
        throw Object.assign(new Error('Overlay hidden state must be true or false.'), { status: 400, code: 'INVALID_OVERLAY_PAYLOAD' });
    }

    const payload = publicPayload(value);
    if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > MAX_PAYLOAD_BYTES) {
        throw Object.assign(new Error('Overlay payload is too large.'), { status: 413, code: 'OVERLAY_PAYLOAD_TOO_LARGE' });
    }
    return payload;
}

function buildOverlayPageUrl(baseUrl, overlayKey, token) {
    const key = requireOverlayKey(overlayKey);
    const relative = key === OVERLAY_KEYS.CHURCH
        ? 'church_studio.html?overlay=lower-third'
        : 'lower-third.html';
    let base;
    try {
        base = new URL(String(baseUrl || 'http://localhost'));
    } catch (_) {
        base = new URL('http://localhost');
    }
    const url = new URL(relative, base);
    url.searchParams.set('token', String(token || ''));
    return url.toString();
}

function overlayLabel(key) {
    return key === OVERLAY_KEYS.CHURCH ? 'Church scripture overlay' : 'Scripture lower third';
}

module.exports = {
    OVERLAY_KEYS,
    OVERLAY_KEY_VALUES,
    MAX_REFERENCE_LENGTH,
    MAX_TEXT_LENGTH,
    MAX_PAYLOAD_BYTES,
    isOverlayKey,
    requireOverlayKey,
    generateToken,
    hashToken,
    isValidToken,
    isHash,
    publicPayload,
    sanitizeOverlayPayload,
    buildOverlayPageUrl,
    overlayLabel
};
