const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const FREE_TIER_GEMINI_MODELS = ['gemini-2.0-flash', 'gemini-1.5-flash'];
const DEFAULT_GEMINI_MODEL = 'gemini-2.0-flash';

const creatorFlow = require('./_creatorFlowCore');
const { requireUser, getJson, setJson } = creatorFlow;
const commentsCore = require('./_youtubeCommentsCore');

const SAFETY_POLICY = {
    neverClaimPersonalPrayer: true,
    neverClaimDivineRevelation: true,
    neverPromiseHealing: true,
    noMedicalLegalFinancialCertainty: true,
    noAggressiveCriticismResponse: true,
    noArguingWithViewers: true,
    noInventedChannelFacts: true
};

let geminiQuotaExhausted = false;
const classificationCache = new Map();
const replyDraftCache = new Map();
let lastGeminiCallAt = 0;
const MIN_GEMINI_INTERVAL_MS = Number(process.env.GEMINI_MIN_INTERVAL_MS || 1500);

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readBodySafe(req) {
    if (req.body && typeof req.body === 'object') return req.body;
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw) return {};
    try {
        return JSON.parse(raw);
    } catch (error) {
        const parseError = new Error('Invalid JSON body.');
        parseError.statusCode = 400;
        throw parseError;
    }
}

function getGeminiConfig() {
    const model = String(process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL).trim();
    const apiKey = process.env.GEMINI_API_KEY || '';
    return { apiKey, model, allowed: FREE_TIER_GEMINI_MODELS.includes(model) };
}

function isPaidGeminiModel(model) {
    return !FREE_TIER_GEMINI_MODELS.includes(String(model || '').trim());
}

function getGeminiStatus() {
    const config = getGeminiConfig();
    return {
        available: Boolean(config.apiKey) && config.allowed && !geminiQuotaExhausted,
        apiKeyConfigured: Boolean(config.apiKey),
        model: config.model,
        paidModelBlocked: !config.allowed,
        quotaExhausted: geminiQuotaExhausted,
        reason: geminiQuotaExhausted ? 'Gemini free-tier quota exhausted. AI generation is paused until quota returns or configuration changes.' : null,
        freeTierOnly: true
    };
}

function resetGeminiQuota() {
    geminiQuotaExhausted = false;
}

async function generateGeminiContent({ task, comment, preferences }) {
    const config = getGeminiConfig();
    const status = getGeminiStatus();
    if (!config.apiKey) {
        const error = new Error('Gemini API key is not configured. Set GEMINI_API_KEY to enable AI comment drafts.');
        error.statusCode = 503;
        throw error;
    }
    if (isPaidGeminiModel(config.model)) {
        const error = new Error('Gemini paid models are not permitted. Only free-tier Gemini models may be used.');
        error.statusCode = 503;
        error.code = 'GEMINI_PAID_MODEL_BLOCKED';
        throw error;
    }
    if (geminiQuotaExhausted) {
        const error = new Error('Gemini free-tier quota is exhausted. AI generation was stopped.');
        error.statusCode = 429;
        error.code = 'GEMINI_QUOTA_EXHAUSTED';
        throw error;
    }
    if (Date.now() - lastGeminiCallAt < MIN_GEMINI_INTERVAL_MS) {
        await sleep(MIN_GEMINI_INTERVAL_MS - (Date.now() - lastGeminiCallAt));
    }
    lastGeminiCallAt = Date.now();

    const systemInstruction = {
        parts: [{
            text: [
                'You are SpiritFlow AI, the friendly and compassionate engagement assistant for SpiritFlow Sounds, a Christian gospel worship music channel.',
                'You write replies to YouTube comments with a warm, respectful, Christian, encouraging, compassionate, natural, friendly and professional personality.',
                'Reply language: respond in the same language as the original comment when possible.',
                'Length: keep replies short to medium.',
                'Emoji: use only moderate, appropriate emoji.',
                'Bible references: only where clearly appropriate.',
                'Safety: never claim to have personally prayed, never claim divine revelation, never promise healing or guaranteed miracles, never give medical, legal or financial advice as religious certainty, never respond aggressively to criticism, never argue with viewers, never invent facts about SpiritFlow Sounds.'
            ].join(' ')
        }]
    };

    const maxOutputTokens = task === 'classify'
        ? 200
        : Number((preferences && preferences.maxReplyLength === 'long' ? 500 : preferences && preferences.maxReplyLength === 'medium' ? 360 : 240)) || 240;

    const generationConfig = {
        temperature: task === 'classify' ? 0.2 : 0.3,
        maxOutputTokens
    };

    const userContent = task === 'classify'
        ? `Classify this YouTube comment for SpiritFlow Sounds and return only JSON: {"category":"praise|question|prayer|testimony|biblical|criticism|music_request|business|spam|offensive|other","language":"en|yo|...","flagged":true|false,"confidence":0-1}. Comment: ${comment.text}`
        : `Write a short warm YouTube reply for SpiritFlow Sounds. Original comment language: ${comment.language || 'auto'}. Category: ${comment.category || 'general'}. Preferences: tone=${preferences?.tone || 'warm-christian-conversational'}, maxReplyLength=${preferences?.maxReplyLength || 'short-medium'}, emojiUsage=${preferences?.emojiUsage || 'moderate'}, bibleReferences=${preferences?.bibleReferences || 'only-where-appropriate'}, style=${preferences?.style || 'conversational'}. Comment text: ${comment.text}`;

    const response = await fetch(`${GEMINI_API_BASE}/${config.model}:generateContent?key=${config.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            systemInstruction,
            generationConfig,
            contents: [{ role: 'user', parts: [{ text: userContent }] }]
        })
    });
    const data = await response.json().catch(() => ({}));
    const blocked = response.status === 429 || /resource.?exhausted|quota|rate.?limit/i.test(`${response.status} ${data?.error?.message || data?.error || ''}`);
    if (!response.ok || blocked) {
        if (blocked) geminiQuotaExhausted = true;
        const error = new Error(data?.error?.message || 'Gemini API request failed.');
        error.statusCode = response.status || 502;
        error.code = blocked ? 'GEMINI_QUOTA_EXHAUSTED' : 'GEMINI_API_ERROR';
        throw error;
    }

    const candidate = (data && data.candidates && data.candidates[0]) || {};
    const parts = candidate.content && candidate.content.parts ? candidate.content.parts : [];
    const text = parts.map((part) => part.text || '').join('\n').trim();
    return { text, model: config.model, task, cached: false };
}

async function classifyComment(commentText) {
    const normalized = String(commentText || '').trim().toLowerCase();
    const cacheKey = `classify:${Buffer.from(normalized || 'empty').toString('base64url')}`;
    const cached = classificationCache.get(cacheKey);
    if (cached) return { ...cached, cached: true };
    const { text } = await generateGeminiContent({ task: 'classify', comment: { text: String(commentText || '') }, preferences: { maxReplyLength: 'short-medium' } });
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    let parsed = {};
    try {
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch (error) {
        parsed = {};
    }
    const category = String(parsed.category || 'other');
    const language = String(parsed.language || 'auto');
    const flagged = Boolean(parsed.flagged);
    const confidence = Number(parsed.confidence || 0);
    const result = { category, language, flagged, confidence };
    classificationCache.set(cacheKey, result);
    return { ...result, cached: false };
}

async function generateReply({ comment, preferences, force = false }) {
    const normalized = String(comment.text || '').trim().toLowerCase();
    const cacheKey = `draft:${Buffer.from(normalized || 'empty').toString('base64url')}:${comment.category || 'general'}`;
    if (force) replyDraftCache.delete(cacheKey);
    const cached = replyDraftCache.get(cacheKey);
    if (cached) return { draft: cached, cached: true };
    const { text } = await generateGeminiContent({ task: 'reply', comment: { ...comment, text: String(comment.text || '') }, preferences });
    replyDraftCache.set(cacheKey, text);
    return { draft: text, cached: false };
}

async function geminiCommentsHandler(req) {
    try {
        return await geminiCommentsCoreHandler(req);
    } catch (error) {
        return {
            statusCode: error.statusCode || 500,
            headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
            body: JSON.stringify({ ok: false, error: error.message || 'Gemini comment reply generation failed.', code: error.code })
        };
    }
}

async function geminiCommentsCoreHandler(req) {
    const url = new URL(req.url, 'http://localhost');
    const action = url.searchParams.get('action') || '';
    const method = req.method || 'GET';

    if (action === 'status') {
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
            body: JSON.stringify({ ok: true, ...getGeminiStatus() })
        };
    }

    if (action === 'generate' && method === 'POST') {
        const user = await requireUser(req);
        const body = await readBodySafe(req);
        const commentId = String(body.commentId || '');
        const commentText = String(body.comment?.text || body.text || '').trim();
        if (!commentId || !commentText) {
            const error = new Error('A commentId and comment text are required.');
            error.statusCode = 400;
            throw error;
        }
        const stored = await getJson(`cf:user:${user.id}:comment:${commentId}`);
        if (!stored) {
            const error = new Error('Comment record not found. Run a YouTube comment sync first.');
            error.statusCode = 404;
            throw error;
        }
        const preferences = await commentsCore.getCommentPreferences(user.id);
        const classification = await classifyComment(commentText);
        if (classification.flagged) {
            const comment = await commentsCore.setCommentFlag(user.id, commentId, true, String(body.flagNote || 'Flagged by safety policy.'));
            return {
                statusCode: 200,
                headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
                body: JSON.stringify({ ok: true, flagged: true, commentId, category: classification.category, language: classification.language, draft: null, reason: 'Comment flagged for human review.' })
            };
        }
        const generation = await generateReply({
            comment: { text: commentText, category: classification.category, language: classification.language },
            preferences,
            force: Boolean(body.force)
        });
        const draft = await commentsCore.saveCommentDraft(user.id, commentId, generation.draft, 'ai');
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
            body: JSON.stringify({ ok: true, flagged: false, commentId, category: classification.category, language: classification.language, draft, reply: generation.draft, cached: generation.cached })
        };
    }

    const error = new Error('Unknown Gemini comment manager action.');
    error.statusCode = 404;
    throw error;
}

module.exports = {
    FREE_TIER_GEMINI_MODELS,
    SAFETY_POLICY,
    getGeminiConfig,
    isPaidGeminiModel,
    getGeminiStatus,
    resetGeminiQuota,
    generateGeminiContent,
    classifyComment,
    generateReply,
    geminiCommentsHandler,
    geminiCommentsCoreHandler
};
