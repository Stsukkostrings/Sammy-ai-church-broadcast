const crypto = require('crypto');

/* Per-process fallback. Supabase-backed counters are authoritative across warm
 * serverless instances; this map keeps local development and a temporarily
 * unavailable database from turning into an unlimited path. */
const memory = new Map();
const MEMORY_MAX_KEYS = 5000;

function pruneMemory(now) {
    if (memory.size < MEMORY_MAX_KEYS) return;
    for (const [key, entry] of memory) {
        if (!entry || entry.resetAt <= now) memory.delete(key);
    }
    if (memory.size >= MEMORY_MAX_KEYS) {
        const first = memory.keys().next().value;
        if (first) memory.delete(first);
    }
}

function memoryLimit(key, limit, windowMs, now = Date.now()) {
    const entry = memory.get(key);
    if (!entry || entry.resetAt <= now) {
        memory.set(key, { count: 1, resetAt: now + windowMs });
        return { allowed: true, remaining: Math.max(0, limit - 1), resetAt: now + windowMs, degraded: true };
    }
    entry.count += 1;
    return { allowed: entry.count <= limit, remaining: Math.max(0, limit - entry.count), resetAt: entry.resetAt, degraded: true };
}

function cleanString(value, max = 96) {
    return String(value || '').replace(/[^a-zA-Z0-9:._-]/g, '').slice(0, max);
}

function identityFor(user, accessToken) {
    if (user?.id) return `user:${user.id}`;
    if (accessToken) return `token:${crypto.createHash('sha256').update(accessToken).digest('hex')}`;
    return 'anonymous';
}

async function distributedLimit({ accessToken, bucket, limit, windowSeconds }) {
    if (!accessToken) return null;
    let db;
    try { db = require('../db/supabase-rest'); } catch (_) { return null; }
    try {
        const result = await db.rpc('consume_rate_limit', {
            p_bucket: bucket,
            p_limit: limit,
            p_window_seconds: windowSeconds
        }, accessToken);
        const row = Array.isArray(result) ? result[0] : result;
        if (!row || typeof row.allowed !== 'boolean') return null;
        return {
            allowed: row.allowed,
            remaining: Number.isFinite(Number(row.remaining)) ? Number(row.remaining) : 0,
            resetAt: row.reset_at ? Date.parse(row.reset_at) : Date.now() + windowSeconds * 1000,
            degraded: false
        };
    } catch (_) {
        return null;
    }
}

async function checkRateLimit({ user, accessToken, bucket, limit, windowMs, now = Date.now() }) {
    const safeBucket = cleanString(bucket, 64) || 'general';
    const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 1));
    const safeWindowMs = Math.max(1000, Math.min(86400 * 1000, Number(windowMs) || 60_000));
    const identity = identityFor(user, accessToken);
    const key = `${identity}:${safeBucket}`;
    const distributed = await distributedLimit({
        accessToken,
        bucket: safeBucket,
        limit: safeLimit,
        windowSeconds: Math.min(86400, Math.max(1, Math.round(safeWindowMs / 1000)))
    });
    if (distributed) return distributed;
    pruneMemory(now);
    return memoryLimit(key, safeLimit, safeWindowMs, now);
}

/* Anonymous OBS polling cannot use the authenticated distributed counter. This
 * per-process limiter still bounds abusive polling and is deliberately keyed by
 * both client address and token hash so one leaked URL cannot exhaust all
 * public overlay traffic. */
function checkPublicRateLimit({ key, limit = 60, windowMs = 60_000, now = Date.now() } = {}) {
    const safeKey = `public:${cleanString(key, 200) || 'unknown'}`;
    const safeLimit = Math.max(1, Math.min(2000, Number(limit) || 1));
    const safeWindowMs = Math.max(1000, Math.min(3600_000, Number(windowMs) || 60_000));
    pruneMemory(now);
    return memoryLimit(safeKey, safeLimit, safeWindowMs, now);
}

function retryAfterSeconds(result, now = Date.now()) {
    const seconds = Math.ceil((Number(result?.resetAt || now) - now) / 1000);
    return Math.max(1, Math.min(3600, seconds));
}

module.exports = { checkRateLimit, checkPublicRateLimit, retryAfterSeconds, identityFor };
