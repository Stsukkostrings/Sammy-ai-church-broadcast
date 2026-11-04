const crypto = require('crypto');

// This model is currently documented by Google as free-tier eligible for text
// generation. App-side caps are conservative safeguards, not Google's quota.
const MODEL = 'gemini-3.5-flash-lite';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const MAX_PROMPT_CHARS = 24000;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_OUTPUT_TOKENS = 1200;
const APP_RPM = 8;
const APP_RPD = 250;
const APP_TPM = 80000;
function quotaDay() {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

const memory = {
    requests: 0,
    errors: 0,
    quotaExhausted: false,
    lastRequest: null,
    lastError: null,
    day: quotaDay(),
    requestTimes: [],
    estimatedTokens: [],
    cache: new Map(),
    inFlight: new Map()
};

function resetDailyCountersIfNeeded() {
    const today = quotaDay();
    if (memory.day !== today) {
        memory.day = today;
        memory.requests = 0;
        memory.errors = 0;
        memory.quotaExhausted = false;
        memory.estimatedTokens = [];
    }
}

function pruneWindows(now = Date.now()) {
    memory.requestTimes = memory.requestTimes.filter((at) => now - at < 60_000);
    memory.estimatedTokens = memory.estimatedTokens.filter((entry) => now - entry.at < 60_000);
    for (const [key, entry] of memory.cache) if (entry.expiresAt <= now) memory.cache.delete(key);
}

function cleanStatus() {
    resetDailyCountersIfNeeded();
    return {
        requests: memory.requests,
        errors: memory.errors,
        quotaExhausted: memory.quotaExhausted,
        lastRequest: memory.lastRequest,
        lastError: memory.lastError,
        tracking: 'Per server instance; resets when a serverless instance restarts. Not Google quota data.'
    };
}

function safeError(message, code, status = 503) {
    const error = new Error(message);
    error.code = code;
    error.status = status;
    return error;
}

function getInput(options) {
    const prompt = String(options.prompt || '').trim();
    if (!prompt) throw safeError('Enter a prompt and try again.', 'INVALID_INPUT', 400);
    if (prompt.length > MAX_PROMPT_CHARS) throw safeError('The request is too long. Shorten it and try again.', 'INPUT_TOO_LARGE', 413);
    const image = options.image;
    if (image && (!['image/jpeg', 'image/png', 'image/webp'].includes(image.mimeType) || !/^[A-Za-z0-9+/]+=*$/.test(image.data || '') || Buffer.byteLength(image.data, 'base64') > MAX_IMAGE_BYTES)) {
        throw safeError('The image is invalid or too large. Use a JPEG, PNG, or WebP under 4 MB.', 'INVALID_IMAGE', 400);
    }
    return { prompt, image };
}

class GeminiService {
    constructor() {
        this.apiKey = process.env.GEMINI_API_KEY || '';
    }

    isConfigured() { return !!this.apiKey; }

    recordError() {
        memory.errors += 1;
        memory.lastError = { at: new Date().toISOString() };
    }

    async generateText(options = {}) {
        try { return await this._generateText(options); }
        catch (error) { this.recordError(); throw error; }
    }

    async _generateText(options = {}) {
        resetDailyCountersIfNeeded();
        const { prompt, image } = getInput(options);
        if (!this.isConfigured()) throw safeError('AI is not configured yet. Ask the site administrator to add the Gemini API key.', 'NOT_CONFIGURED');
        if (memory.quotaExhausted) throw safeError('The free Gemini quota is temporarily exhausted. Your work is saved; please try again later.', 'QUOTA_EXHAUSTED', 429);

        const now = Date.now();
        pruneWindows(now);
        if (memory.requests >= APP_RPD) throw safeError('This service has reached its local daily request limit. Please try again tomorrow.', 'APP_DAILY_LIMIT', 429);
        if (memory.requestTimes.length >= APP_RPM) throw safeError('Too many AI requests in a short time. Please wait a minute and try again.', 'APP_RATE_LIMIT', 429);

        const systemInstruction = String(options.systemInstruction || '').slice(0, 8000);
        const bypassCache = options.bypassCache === true;
        const temperature = Number.isFinite(options.temperature) ? Math.min(1, Math.max(0, options.temperature)) : 0.7;
        const maxOutputTokens = Number.isFinite(options.maxOutputTokens) ? Math.min(MAX_OUTPUT_TOKENS, Math.max(32, Math.floor(options.maxOutputTokens))) : 512;
        const key = crypto.createHash('sha256').update(JSON.stringify({ prompt, image: image?.data, systemInstruction, temperature, maxOutputTokens })).digest('hex');
        const cached = bypassCache ? null : memory.cache.get(key);
        if (cached && cached.expiresAt > now) return { ...cached.result, cached: true, usage: cleanStatus() };
        if (!bypassCache && memory.inFlight.has(key)) return memory.inFlight.get(key);

        const estimated = Math.ceil((prompt.length + systemInstruction.length) / 4) + maxOutputTokens;
        const usedThisMinute = memory.estimatedTokens.reduce((sum, entry) => sum + entry.tokens, 0);
        if (usedThisMinute + estimated > APP_TPM) throw safeError('The AI service is busy. Please shorten the request or retry in a minute.', 'APP_TOKEN_LIMIT', 429);

        const request = this._request({ prompt, image, systemInstruction, temperature, maxOutputTokens, key, estimated });
        if (!bypassCache) memory.inFlight.set(key, request);
        try { return await request; } finally { memory.inFlight.delete(key); }
    }

    async _request({ prompt, image, systemInstruction, temperature, maxOutputTokens, key, estimated }) {
        const parts = [];
        if (image) parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
        parts.push({ text: prompt });
        const body = {
            contents: [{ role: 'user', parts }],
            generationConfig: { temperature, maxOutputTokens },
            ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {})
        };
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 25000);
        try {
            const response = await fetch(`${API_BASE}/${MODEL}:generateContent`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
                body: JSON.stringify(body),
                signal: controller.signal
            });
            if (!response.ok) {
                let details = {};
                try { details = await response.json(); } catch (_) {}
                const status = response.status;
                const detailText = JSON.stringify(details).toLowerCase();
                memory.lastError = { status, at: new Date().toISOString() };
                const dailyQuotaExhausted = status === 429 && /(per.?day|daily|requestsperday|quota.*exceed)/i.test(detailText);
                if (dailyQuotaExhausted) memory.quotaExhausted = true;
                if (status === 401 || status === 403) throw safeError('Gemini rejected the server configuration. Ask the site administrator to check the API key and free-tier access.', 'GEMINI_AUTH', 502);
                if (status === 404) throw safeError('The configured Gemini model is unavailable for this project.', 'MODEL_UNAVAILABLE', 502);
                if (status === 429 && dailyQuotaExhausted) throw safeError('The free Gemini daily quota is exhausted. Your work is saved; please try again after the quota resets.', 'QUOTA_EXHAUSTED', 429);
                if (status === 429) throw safeError('Gemini is rate limited right now. Your work is saved; please wait a minute and try again.', 'GEMINI_RATE_LIMIT', 429);
                if (status === 400) throw safeError('Gemini could not process this request. Check the input and try again.', 'GEMINI_INVALID_REQUEST', 400);
                throw safeError('Gemini is temporarily unavailable. Your work is saved; please try again.', 'GEMINI_UNAVAILABLE', 502);
            }
            const data = await response.json();
            const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
            if (!text) throw safeError('Gemini returned an empty or invalid response. Please try again.', 'INVALID_RESPONSE', 502);
            const now = Date.now();
            memory.requests += 1;
            memory.requestTimes.push(now);
            memory.estimatedTokens.push({ at: now, tokens: estimated });
            memory.lastRequest = { model: MODEL, at: new Date(now).toISOString() };
            const result = { text, model: MODEL };
            if (!bypassCache) {
                memory.cache.set(key, { result, expiresAt: now + 5 * 60_000 });
                if (memory.cache.size > 200) memory.cache.delete(memory.cache.keys().next().value);
            }
            return { ...result, usage: cleanStatus() };
        } catch (error) {
            if (!error.code) {
                memory.lastError = { at: new Date().toISOString() };
                if (error.name === 'AbortError') throw safeError('Gemini took too long to respond. Your work is saved; please retry.', 'TIMEOUT', 504);
                throw safeError('Could not reach Gemini. Your work is saved; please check your connection and retry.', 'NETWORK_ERROR', 502);
            }
            throw error;
        } finally {
            clearTimeout(timeout);
        }
    }

    async generateJson(options = {}) {
        const result = await this.generateText({ ...options, prompt: `${options.prompt}\n\nReturn valid JSON only, without markdown fences.` });
        const match = result.text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
        if (!match) { this.recordError(); throw safeError('Gemini returned data in an unexpected format. Please try again.', 'INVALID_RESPONSE', 502); }
        try { return { data: JSON.parse(match[0]), ...result }; }
        catch (_) { this.recordError(); throw safeError('Gemini returned invalid JSON. Please try again.', 'INVALID_RESPONSE', 502); }
    }

    getStatus() {
        return { configured: this.isConfigured(), provider: 'Google Gemini', model: MODEL, freeTierEligible: true, billingTierVerified: false, quotaExhausted: memory.quotaExhausted, usage: cleanStatus() };
    }
}

module.exports = new GeminiService();
