const aiService = require('../lib/ai/ai-service');
const accountAuth = require('../lib/auth/supabase');
const { checkRateLimit, retryAfterSeconds } = require('../lib/security/rate-limit');

const MAX_BODY_BYTES = 6 * 1024 * 1024;
const MAX_PROMPT_CHARS = 24_000;

function send(res, status, body, headers = {}) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value));
    return res.status(status).json(body);
}

function originIsSameSite(req) {
    if (!req.headers.origin) return req.method === 'GET' || req.method === 'HEAD';
    return accountAuth.isSameOrigin(req);
}

function readBody(req) {
    if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
    if (typeof req.body === 'string') {
        try { return Promise.resolve(JSON.parse(req.body)); }
        catch (_) { return Promise.reject(Object.assign(new Error('Request must contain valid JSON.'), { status: 400, code: 'INVALID_INPUT' })); }
    }
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let settled = false;
        const fail = (error) => { if (!settled) { settled = true; reject(error); } };
        req.on('data', (chunk) => {
            if (settled) return;
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += buffer.length;
            if (size > MAX_BODY_BYTES) return fail(Object.assign(new Error('Request is too large.'), { status: 413, code: 'INPUT_TOO_LARGE' }));
            chunks.push(buffer);
        });
        req.on('end', () => {
            if (settled) return;
            try {
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
                settled = true;
                resolve(body);
            } catch (_) { fail(Object.assign(new Error('Request must contain valid JSON.'), { status: 400, code: 'INVALID_INPUT' })); }
        });
        req.on('error', (error) => fail(error));
    });
}

module.exports = async (req, res) => {
    if (!originIsSameSite(req)) return send(res, 403, { ok: false, error: 'Request origin not allowed.' });
    if (req.method === 'GET') return send(res, 200, { ok: true, ...aiService.getStatus() });
    if (req.method === 'HEAD') { res.setHeader('Allow', 'GET, HEAD, POST'); res.status(200); return res.end(); }
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'GET, HEAD, POST');
        return send(res, 405, { ok: false, error: 'Method not allowed.' });
    }

    const account = await accountAuth.authenticateRequest(req);
    if (account.error) return send(res, account.error.status || 503, { ok: false, code: account.error.code, error: account.error.message }, account.clearCookie ? { 'Set-Cookie': account.clearCookie } : {});
    const limitResult = await checkRateLimit({ user: account.user, accessToken: account.accessToken, bucket: 'ai_generate', limit: 8, windowMs: 60_000 });
    if (!limitResult.allowed) {
        const headers = { 'Retry-After': String(retryAfterSeconds(limitResult)) };
        if (account.setCookie) headers['Set-Cookie'] = account.setCookie;
        return send(res, 429, { ok: false, code: 'APP_RATE_LIMIT', error: 'Too many AI requests in a short time. Please wait a minute and try again.', retryAfter: retryAfterSeconds(limitResult) }, headers);
    }

    try {
        const data = await readBody(req);
        const prompt = typeof data.prompt === 'string' ? data.prompt.trim() : '';
        if (!prompt) return send(res, 400, { ok: false, code: 'INVALID_INPUT', error: 'Prompt required.' });
        if (prompt.length > MAX_PROMPT_CHARS) return send(res, 400, { ok: false, code: 'INVALID_INPUT', error: 'Prompt is too long.' });
        const module = ['general', 'creator', 'youtube', 'thumbnail', 'content', 'comments', 'analytics', 'script', 'lyrics'].includes(data.module) ? data.module : 'general';
        const options = {
            prompt,
            module,
            ...(typeof data.image?.data === 'string' && typeof data.image?.mimeType === 'string' ? { image: data.image } : {}),
            ...(Number.isFinite(data.temperature) ? { temperature: data.temperature } : {}),
            ...(Number.isFinite(data.maxOutputTokens) ? { maxOutputTokens: data.maxOutputTokens } : {}),
            ...(module === 'general' && data.verifyConnection === true ? { bypassCache: true } : {})
        };
        if (module === 'general' && typeof data.systemInstruction === 'string') {
            options.systemInstruction = data.systemInstruction.slice(0, 8000);
        }
        const result = await aiService.generate(options);
        return send(res, 200, { ok: true, text: result.text, model: result.model, cached: !!result.cached }, account.setCookie ? { 'Set-Cookie': account.setCookie } : {});
    } catch (error) {
        const status = Number.isInteger(error.status) ? error.status : 500;
        return send(res, status, { ok: false, code: error.code || 'AI_ERROR', error: error.message || 'AI request failed.' }, account.setCookie ? { 'Set-Cookie': account.setCookie } : {});
    }
};
