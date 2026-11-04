const crypto = require('crypto');

const APP_COOKIE = 'cf_session';
const UNAVAILABLE = 'Connect YouTube or upload YouTube Analytics data to begin.';

function json(statusCode, body, headers = {}) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            ...headers
        },
        body: JSON.stringify(body)
    };
}

function parseCookies(header = '') {
    return header.split(';').reduce((cookies, part) => {
        const index = part.indexOf('=');
        if (index > -1) cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
        return cookies;
    }, {});
}

function getOrigin(req) {
    const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
    const proto = req.headers['x-forwarded-proto'] || (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? 'http' : 'https');
    return `${proto}://${host}`;
}

function isSecureCookie(req) {
    return !getOrigin(req).startsWith('http://localhost') && !getOrigin(req).startsWith('http://127.0.0.1');
}

function cookie(name, value, options = {}) {
    const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
    if (options.maxAge) parts.push(`Max-Age=${options.maxAge}`);
    if (options.secure !== false) parts.push('Secure');
    return parts.join('; ');
}

function keyFromSecret(secret) {
    return crypto.createHash('sha256').update(secret).digest();
}

function sealSession(payload, secret) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', keyFromSecret(secret), iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64url');
}

function openSession(value, secret) {
    if (!value) return null;
    const raw = Buffer.from(value, 'base64url');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const encrypted = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyFromSecret(secret), iv);
    decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'));
}

function getConfig() {
    return {
        sessionSecret: process.env.SESSION_SECRET || process.env.CREATORFLOW_SESSION_SECRET,
        redisUrl: process.env.UPSTASH_REDIS_REST_URL,
        redisToken: process.env.UPSTASH_REDIS_REST_TOKEN,
        aiKey: process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY,
        aiBaseUrl: process.env.AI_BASE_URL || (process.env.OPENROUTER_API_KEY ? 'https://openrouter.ai/api/v1' : 'https://api.openai.com/v1'),
        aiModel: process.env.AI_MODEL || (process.env.OPENROUTER_API_KEY ? 'openai/gpt-4o-mini' : 'gpt-4o-mini')
    };
}

function missingConfig() {
    const config = getConfig();
    const missing = [];
    if (!config.sessionSecret) missing.push('SESSION_SECRET');
    if (!config.redisUrl) missing.push('UPSTASH_REDIS_REST_URL');
    if (!config.redisToken) missing.push('UPSTASH_REDIS_REST_TOKEN');
    return missing;
}

async function redis(command) {
    const config = getConfig();
    if (!config.redisUrl || !config.redisToken) {
        const error = new Error('CreatorFlow database is not configured.');
        error.code = 'DATABASE_UNCONFIGURED';
        throw error;
    }
    const response = await fetch(config.redisUrl, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${config.redisToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(command)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.error) throw new Error(data.error || `Redis command failed: ${response.status}`);
    return data.result;
}

async function getJson(key, fallback = null) {
    const raw = await redis(['GET', key]);
    if (!raw) return fallback;
    return JSON.parse(raw);
}

async function setJson(key, value) {
    await redis(['SET', key, JSON.stringify(value)]);
    return value;
}

async function delKey(key) {
    await redis(['DEL', key]);
}

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function publicUser(user) {
    if (!user) return null;
    return {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt
    };
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    const hash = crypto.pbkdf2Sync(String(password), salt, 210000, 32, 'sha256').toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
    const [salt, expected] = String(stored || '').split(':');
    if (!salt || !expected) return false;
    const actual = hashPassword(password, salt).split(':')[1];
    return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

async function readBody(req) {
    if (req.body && typeof req.body === 'object') return req.body;
    const chunks = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString('utf8');
    if (!raw) return {};
    return JSON.parse(raw);
}

async function getSessionUser(req) {
    const config = getConfig();
    if (!config.sessionSecret) return null;
    const cookies = parseCookies(req.headers.cookie || '');
    let session = null;
    try {
        session = openSession(cookies[APP_COOKIE], config.sessionSecret);
    } catch (error) {
        return null;
    }
    if (!session?.userId || session.expiresAt < Date.now()) return null;
    const user = await getJson(`cf:user:${session.userId}`);
    return user ? { session, user } : null;
}

async function requireUser(req) {
    const auth = await getSessionUser(req);
    if (!auth) {
        const error = new Error('Sign in to access your CreatorFlow workspace.');
        error.statusCode = 401;
        throw error;
    }
    return auth.user;
}

async function listKeysByIds(listKey, prefix) {
    const ids = await redis(['SMEMBERS', listKey]);
    const values = [];
    for (const id of ids || []) {
        const item = await getJson(`${prefix}:${id}`);
        if (item) values.push(item);
    }
    return values;
}

function parseNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const clean = String(value).replace(/[%,$,\s]/g, '');
    const number = Number(clean);
    return Number.isFinite(number) ? number : null;
}

function isMalformedNumber(value) {
    if (value === null || value === undefined || value === '') return false;
    return parseNumber(value) === null;
}

function isMalformedPercent(value) {
    if (value === null || value === undefined || value === '') return false;
    const text = String(value).trim();
    return !/^[-+]?\d*\.?\d+\s*%?$/.test(text);
}

function isInvalidDate(value) {
    if (!value) return false;
    return Number.isNaN(Date.parse(value));
}

function normalizeHeader(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const COLUMN_ALIASES = {
    title: ['video title', 'title', 'content', 'video', 'video name'],
    views: ['views', 'view', 'video views'],
    impressions: ['impressions', 'impression'],
    ctr: ['impressions click through rate', 'impressions ctr', 'ctr', 'click through rate'],
    watchTimeHours: ['watch time hours', 'watch hours', 'watch time'],
    averageViewDuration: ['average view duration', 'average duration', 'avd'],
    likes: ['likes', 'like'],
    comments: ['comments', 'comment'],
    subscribersGained: ['subscribers gained', 'subs gained', 'new subscribers'],
    date: ['date', 'day', 'published date', 'publish date'],
    duration: ['video duration', 'duration', 'length'],
    trafficSource: ['traffic source', 'source', 'traffic source type'],
    contentType: ['content type', 'format', 'type']
};

function detectMapping(headers) {
    const normalized = headers.map(header => normalizeHeader(header));
    const mapping = {};
    Object.entries(COLUMN_ALIASES).forEach(([field, aliases]) => {
        const index = normalized.findIndex(header => aliases.includes(header) || aliases.some(alias => header.includes(alias)));
        if (index >= 0) mapping[field] = headers[index];
    });
    return mapping;
}

function dataQualityReport(headers, rows, mapping) {
    const requiredForCore = ['title', 'views'];
    const metricFields = ['impressions', 'ctr', 'watchTimeHours', 'averageViewDuration', 'likes', 'comments', 'subscribersGained', 'date', 'duration', 'trafficSource', 'contentType'];
    const missingColumns = [...requiredForCore, ...metricFields]
        .filter(field => !mapping[field])
        .map(field => ({ field, message: field === 'title' || field === 'views' ? 'Core field is missing.' : 'Not available in this export.' }));
    const missingValues = [];
    const invalidNumbers = [];
    const invalidDates = [];
    const malformedPercentages = [];
    const duplicateKeys = new Map();

    rows.forEach((row, index) => {
        Object.entries(mapping).forEach(([field, column]) => {
            if (!column) return;
            const value = row[column];
            if (value === undefined || value === null || String(value).trim() === '') {
                missingValues.push({ row: index + 2, field, column });
            }
            if (['views', 'impressions', 'watchTimeHours', 'likes', 'comments', 'subscribersGained'].includes(field) && isMalformedNumber(value)) {
                invalidNumbers.push({ row: index + 2, field, column, value });
            }
            if (field === 'ctr' && isMalformedPercent(value)) {
                malformedPercentages.push({ row: index + 2, field, column, value });
            }
            if (field === 'date' && isInvalidDate(value)) {
                invalidDates.push({ row: index + 2, field, column, value });
            }
        });
        const duplicateKey = [mapping.title ? row[mapping.title] : '', mapping.date ? row[mapping.date] : '', mapping.duration ? row[mapping.duration] : ''].join('|').toLowerCase();
        if (duplicateKey.trim() !== '||') duplicateKeys.set(duplicateKey, (duplicateKeys.get(duplicateKey) || 0) + 1);
    });

    const duplicates = [...duplicateKeys.entries()]
        .filter(([, count]) => count > 1)
        .map(([key, count]) => ({ key, count }));

    return {
        rowCount: rows.length,
        headerCount: headers.length,
        missingColumns,
        missingValues: missingValues.slice(0, 100),
        invalidNumbers: invalidNumbers.slice(0, 100),
        invalidDates: invalidDates.slice(0, 100),
        malformedPercentages: malformedPercentages.slice(0, 100),
        duplicateRecords: duplicates.slice(0, 100),
        warningsTruncated: missingValues.length > 100 || invalidNumbers.length > 100 || invalidDates.length > 100 || malformedPercentages.length > 100 || duplicates.length > 100
    };
}

function secondsFromDuration(value) {
    if (!value) return null;
    const text = String(value).trim();
    if (/^\d+$/.test(text)) return Number(text);
    const parts = text.split(':').map(part => Number(part));
    if (parts.some(part => !Number.isFinite(part))) return null;
    return parts.reduce((total, part) => total * 60 + part, 0);
}

function classifyFormat(durationSeconds, threshold = 60, explicitType = '') {
    const type = String(explicitType || '').toLowerCase();
    if (type.includes('live')) return 'Livestream';
    if (type.includes('short')) return 'Short';
    if (type.includes('music')) return 'Music';
    if (Number.isFinite(durationSeconds)) return durationSeconds <= threshold ? 'Short' : 'Long-form';
    return 'Unknown';
}

function classifyPillar(title = '') {
    const text = title.toLowerCase();
    if (/(bible|moses|jonah|david|esther|daniel|paul|jesus|noah|joseph)/.test(text)) return 'Bible / Story';
    if (/(protect|saved|deliver|miracle|interven)/.test(text)) return 'Divine Intervention / Protection';
    if (/(hope|crisis|fear|almost|dead|storm|wanted)/.test(text)) return 'Crisis -> Hope -> God Intervenes';
    if (/(worship|gospel|song|music|praise|hallelu)/.test(text)) return 'Gospel Music / Worship';
    if (/(faith|prayer|pray|encourage|grace)/.test(text)) return 'Faith / Prayer / Encouragement';
    return 'Other';
}

function median(numbers) {
    const clean = numbers.filter(number => Number.isFinite(number)).sort((a, b) => a - b);
    if (!clean.length) return 0;
    const mid = Math.floor(clean.length / 2);
    return clean.length % 2 ? clean[mid] : (clean[mid - 1] + clean[mid]) / 2;
}

function winnerScore(video, medians) {
    const viewsScore = medians.views ? Math.min(40, (Number(video.views || 0) / medians.views) * 20) : 0;
    const ctrScore = medians.ctr ? Math.min(25, (Number(video.ctr || 0) / medians.ctr) * 12.5) : 0;
    const watchScore = medians.watchTimeHours ? Math.min(20, (Number(video.watchTimeHours || 0) / medians.watchTimeHours) * 10) : 0;
    const engagement = Number(video.likes || 0) + Number(video.comments || 0) + Number(video.subscribersGained || 0);
    const engagementScore = medians.engagement ? Math.min(15, (engagement / medians.engagement) * 7.5) : 0;
    const total = Math.round(viewsScore + ctrScore + watchScore + engagementScore);
    let label = 'NORMAL';
    if (total >= 80) label = 'BREAKOUT WINNER';
    else if (total >= 65) label = 'STRONG PERFORMER';
    else if (total >= 50) label = 'PROMISING';
    else if (total < 30) label = 'UNDERPERFORMER';
    return { total, label, components: { viewsScore, ctrScore, watchScore, engagementScore } };
}

function buildAnalytics(videos) {
    const totals = videos.reduce((sum, video) => ({
        videos: sum.videos + 1,
        views: sum.views + Number(video.views || 0),
        impressions: sum.impressions + Number(video.impressions || 0),
        watchTimeHours: sum.watchTimeHours + Number(video.watchTimeHours || 0),
        likes: sum.likes + Number(video.likes || 0),
        comments: sum.comments + Number(video.comments || 0),
        subscribersGained: sum.subscribersGained + Number(video.subscribersGained || 0),
        over100: sum.over100 + (Number(video.views || 0) >= 100 ? 1 : 0),
        over500: sum.over500 + (Number(video.views || 0) >= 500 ? 1 : 0),
        over1000: sum.over1000 + (Number(video.views || 0) >= 1000 ? 1 : 0),
        over5000: sum.over5000 + (Number(video.views || 0) >= 5000 ? 1 : 0),
        zeroViews: sum.zeroViews + (Number(video.views || 0) === 0 ? 1 : 0)
    }), { videos: 0, views: 0, impressions: 0, watchTimeHours: 0, likes: 0, comments: 0, subscribersGained: 0, over100: 0, over500: 0, over1000: 0, over5000: 0, zeroViews: 0 });
    totals.averageCtr = totals.impressions ? (videos.reduce((sum, video) => sum + (Number(video.impressions || 0) * Number(video.ctr || 0)), 0) / totals.impressions) : null;

    const medians = {
        views: median(videos.map(video => Number(video.views || 0))),
        ctr: median(videos.map(video => Number(video.ctr || 0)).filter(Boolean)),
        watchTimeHours: median(videos.map(video => Number(video.watchTimeHours || 0))),
        engagement: median(videos.map(video => Number(video.likes || 0) + Number(video.comments || 0) + Number(video.subscribersGained || 0)))
    };
    const scoredVideos = videos.map(video => ({ ...video, winner: winnerScore(video, medians) }))
        .sort((a, b) => Number(b.views || 0) - Number(a.views || 0));
    const pillars = {};
    scoredVideos.forEach(video => {
        const key = video.contentPillar || 'Other';
        if (!pillars[key]) pillars[key] = { pillar: key, videos: 0, views: 0, watchTimeHours: 0, ctrValues: [], over1000: 0 };
        pillars[key].videos += 1;
        pillars[key].views += Number(video.views || 0);
        pillars[key].watchTimeHours += Number(video.watchTimeHours || 0);
        if (video.ctr !== null && video.ctr !== undefined) pillars[key].ctrValues.push(Number(video.ctr));
        if (Number(video.views || 0) >= 1000) pillars[key].over1000 += 1;
    });
    const pillarPerformance = Object.values(pillars).map(pillar => ({
        ...pillar,
        averageViews: pillar.videos ? pillar.views / pillar.videos : 0,
        averageCtr: pillar.ctrValues.length ? pillar.ctrValues.reduce((sum, value) => sum + value, 0) / pillar.ctrValues.length : null,
        oneKRate: pillar.videos ? pillar.over1000 / pillar.videos : 0
    })).sort((a, b) => b.views - a.views);
    return { unavailable: !videos.length, message: UNAVAILABLE, totals, medians, videos: scoredVideos, pillarPerformance };
}

function filterVideosByDate(videos, range, startDate, endDate) {
    if (!range || range === 'all') return videos;
    let start = startDate ? new Date(startDate) : null;
    let end = endDate ? new Date(endDate) : new Date();
    if (range !== 'custom') {
        const days = Number(range);
        if (!Number.isFinite(days)) return videos;
        start = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    }
    if (!start || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return videos;
    return videos.filter(video => {
        const value = video.publishedDate || video.date;
        if (!value) return false;
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return false;
        return date >= start && date <= end;
    });
}

async function creatorFlowHandler(req) {
    const url = new URL(req.url, getOrigin(req));
    const action = url.searchParams.get('action') || '';
    const missing = missingConfig();
    if (missing.length && action !== 'config') {
        return json(503, {
            ok: false,
            error: 'CreatorFlow persistence is not configured.',
            missing,
            message: UNAVAILABLE
        });
    }

    try {
        if (action === 'config') return json(200, { ok: true, missing });
        if (action === 'me') {
            const auth = await getSessionUser(req);
            return json(200, { ok: true, user: publicUser(auth?.user || null) });
        }
        if (action === 'signup' && req.method === 'POST') {
            const body = await readBody(req);
            const email = normalizeEmail(body.email);
            if (!email || !body.password) return json(400, { ok: false, error: 'Email and password are required.' });
            if (String(body.password).length < 8) return json(400, { ok: false, error: 'Password must be at least 8 characters.' });
            const emailKey = `cf:userByEmail:${email}`;
            const existing = await redis(['GET', emailKey]);
            if (existing) return json(409, { ok: false, error: 'An account already exists for this email.' });
            const now = new Date().toISOString();
            const user = { id: crypto.randomUUID(), email, name: String(body.name || 'Creator').trim(), passwordHash: hashPassword(body.password), createdAt: now };
            await setJson(`cf:user:${user.id}`, user);
            await redis(['SET', emailKey, user.id]);
            const channel = {
                id: crypto.randomUUID(),
                userId: user.id,
                name: body.channelName || 'SpiritFlow Sounds',
                youtubeUrl: body.youtubeUrl || '',
                youtubeChannelId: body.youtubeChannelId || '',
                niche: body.niche || 'Christian music and Bible storytelling',
                secondaryNiche: body.secondaryNiche || '',
                targetAudience: body.targetAudience || '',
                createdAt: now,
                settings: { shortsThresholdSeconds: 60 }
            };
            await setJson(`cf:channel:${channel.id}`, channel);
            await redis(['SADD', `cf:user:${user.id}:channels`, channel.id]);
            const token = sealSession({ userId: user.id, expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 30 }, getConfig().sessionSecret);
            return json(200, { ok: true, user: publicUser(user), channel }, { 'Set-Cookie': cookie(APP_COOKIE, token, { maxAge: 60 * 60 * 24 * 30, secure: isSecureCookie(req) }) });
        }
        if (action === 'login' && req.method === 'POST') {
            const body = await readBody(req);
            const userId = await redis(['GET', `cf:userByEmail:${normalizeEmail(body.email)}`]);
            const user = userId ? await getJson(`cf:user:${userId}`) : null;
            if (!user || !verifyPassword(body.password, user.passwordHash)) return json(401, { ok: false, error: 'Invalid email or password.' });
            const token = sealSession({ userId: user.id, expiresAt: Date.now() + 1000 * 60 * 60 * 24 * 30 }, getConfig().sessionSecret);
            return json(200, { ok: true, user: publicUser(user) }, { 'Set-Cookie': cookie(APP_COOKIE, token, { maxAge: 60 * 60 * 24 * 30, secure: isSecureCookie(req) }) });
        }
        if (action === 'logout') {
            return json(200, { ok: true }, { 'Set-Cookie': cookie(APP_COOKIE, '', { maxAge: 1, secure: isSecureCookie(req) }) });
        }
        if (action === 'channels') {
            const user = await requireUser(req);
            if (req.method === 'GET') {
                const channels = await listKeysByIds(`cf:user:${user.id}:channels`, 'cf:channel');
                return json(200, { ok: true, channels });
            }
            const body = await readBody(req);
            const channel = {
                id: crypto.randomUUID(),
                userId: user.id,
                name: body.name,
                youtubeUrl: body.youtubeUrl || '',
                youtubeChannelId: body.youtubeChannelId || '',
                niche: body.niche || '',
                secondaryNiche: body.secondaryNiche || '',
                targetAudience: body.targetAudience || '',
                createdAt: new Date().toISOString(),
                settings: { shortsThresholdSeconds: Number(body.shortsThresholdSeconds || 60) }
            };
            await setJson(`cf:channel:${channel.id}`, channel);
            await redis(['SADD', `cf:user:${user.id}:channels`, channel.id]);
            return json(200, { ok: true, channel });
        }
        if (action === 'import-analytics' && req.method === 'POST') {
            const user = await requireUser(req);
            const body = await readBody(req);
            const channel = await getJson(`cf:channel:${body.channelId}`);
            if (!channel || channel.userId !== user.id) return json(404, { ok: false, error: 'Channel workspace not found.' });
            const headers = Array.isArray(body.headers) ? body.headers : [];
            const mapping = body.mapping || detectMapping(headers);
            const rows = Array.isArray(body.rows) ? body.rows : [];
            const importedVideos = rows.map(row => {
                const get = field => row[mapping[field]];
                const durationSeconds = secondsFromDuration(get('duration'));
                const title = String(get('title') || '').trim() || 'Untitled video';
                return {
                    id: crypto.randomUUID(),
                    userId: user.id,
                    channelId: channel.id,
                    source: 'csv',
                    importId: body.importId,
                    title,
                    views: parseNumber(get('views')) || 0,
                    impressions: parseNumber(get('impressions')),
                    ctr: parseNumber(get('ctr')),
                    watchTimeHours: parseNumber(get('watchTimeHours')),
                    averageViewDuration: get('averageViewDuration') || null,
                    likes: parseNumber(get('likes')),
                    comments: parseNumber(get('comments')),
                    subscribersGained: parseNumber(get('subscribersGained')),
                    publishedDate: get('date') || null,
                    duration: get('duration') || null,
                    durationSeconds,
                    trafficSource: get('trafficSource') || null,
                    contentType: get('contentType') || null,
                    format: classifyFormat(durationSeconds, channel.settings?.shortsThresholdSeconds || 60, get('contentType')),
                    contentPillar: classifyPillar(title),
                    createdAt: new Date().toISOString()
                };
            });
            const cleanVideoIds = importedVideos.map(video => video.id);
            const quality = dataQualityReport(headers, rows, mapping);
            const importRecord = {
                id: crypto.randomUUID(),
                userId: user.id,
                channelId: channel.id,
                fileName: body.fileName || 'youtube-analytics.csv',
                headers,
                mapping,
                rawRows: rows,
                cleanVideoIds,
                quality,
                rowCount: importedVideos.length,
                createdAt: new Date().toISOString()
            };
            await setJson(`cf:analyticsImport:${importRecord.id}`, importRecord);
            await redis(['SADD', `cf:channel:${channel.id}:imports`, importRecord.id]);
            for (const video of importedVideos) {
                video.importId = importRecord.id;
                await setJson(`cf:video:${video.id}`, video);
                await redis(['SADD', `cf:channel:${channel.id}:videos`, video.id]);
            }
            return json(200, { ok: true, import: importRecord, importedVideos: importedVideos.length, mapping, quality });
        }
        if (action === 'analytics') {
            const user = await requireUser(req);
            const channelId = url.searchParams.get('channelId');
            const channels = await listKeysByIds(`cf:user:${user.id}:channels`, 'cf:channel');
            const channel = channelId ? channels.find(item => item.id === channelId) : channels[0];
            if (!channel) return json(200, { ok: true, message: UNAVAILABLE, channels: [], analytics: buildAnalytics([]) });
            const videos = filterVideosByDate(
                await listKeysByIds(`cf:channel:${channel.id}:videos`, 'cf:video'),
                url.searchParams.get('range') || 'all',
                url.searchParams.get('startDate'),
                url.searchParams.get('endDate')
            );
            return json(200, { ok: true, message: UNAVAILABLE, channel, channels, analytics: buildAnalytics(videos) });
        }
        if (action === 'thumbnail-projects') {
            const user = await requireUser(req);
            if (req.method === 'GET') {
                const channelId = url.searchParams.get('channelId');
                const projects = await listKeysByIds(`cf:user:${user.id}:thumbnailProjects`, 'cf:thumbnailProject');
                return json(200, { ok: true, projects: channelId ? projects.filter(project => project.channelId === channelId) : projects });
            }
            const body = await readBody(req);
            const channel = await getJson(`cf:channel:${body.channelId}`);
            if (!channel || channel.userId !== user.id) return json(404, { ok: false, error: 'Channel workspace not found.' });
            const now = new Date().toISOString();
            const project = {
                id: body.id || crypto.randomUUID(),
                userId: user.id,
                channelId: channel.id,
                name: body.name || 'Untitled thumbnail project',
                width: 1280,
                height: 720,
                activeVariantId: body.activeVariantId || 'variant-a',
                variants: body.variants || [],
                updatedAt: now,
                createdAt: body.createdAt || now
            };
            await setJson(`cf:thumbnailProject:${project.id}`, project);
            await redis(['SADD', `cf:user:${user.id}:thumbnailProjects`, project.id]);
            return json(200, { ok: true, project });
        }
        if (action === 'settings') {
            const user = await requireUser(req);
            if (req.method === 'GET') {
                const settings = await getJson(`cf:user:${user.id}:settings`, {
                    userId: user.id,
                    defaultDateRange: 'all',
                    shortsThresholdSeconds: 60,
                    funnel: ['Discovery', 'Curiosity', 'Emotional Connection', 'Subscribe', 'Long-form', 'Music / Worship', 'Playlist', 'Livestream / Community'],
                    updatedAt: null
                });
                return json(200, { ok: true, settings });
            }
            const body = await readBody(req);
            const settings = {
                userId: user.id,
                defaultDateRange: body.defaultDateRange || 'all',
                shortsThresholdSeconds: Number(body.shortsThresholdSeconds || 60),
                funnel: Array.isArray(body.funnel) ? body.funnel.map(item => String(item).trim()).filter(Boolean) : ['Discovery', 'Curiosity', 'Emotional Connection', 'Subscribe', 'Long-form', 'Music / Worship', 'Playlist', 'Livestream / Community'],
                updatedAt: new Date().toISOString()
            };
            await setJson(`cf:user:${user.id}:settings`, settings);
            return json(200, { ok: true, settings });
        }
        if (action === 'content-ideas') {
            const user = await requireUser(req);
            if (req.method === 'GET') {
                const channelId = url.searchParams.get('channelId');
                const ideas = await listKeysByIds(`cf:user:${user.id}:contentIdeas`, 'cf:contentIdea');
                return json(200, { ok: true, ideas: channelId ? ideas.filter(idea => idea.channelId === channelId) : ideas });
            }
            const body = await readBody(req);
            const channel = await getJson(`cf:channel:${body.channelId}`);
            if (!channel || channel.userId !== user.id) return json(404, { ok: false, error: 'Channel workspace not found.' });
            const idea = {
                id: crypto.randomUUID(),
                userId: user.id,
                channelId: channel.id,
                title: body.title || '',
                pillar: body.pillar || '',
                format: body.format || '',
                hook: body.hook || '',
                thumbnailText: body.thumbnailText || '',
                evidence: body.evidence || '',
                winningPattern: body.winningPattern || '',
                recommendedCta: body.recommendedCta || '',
                suggestedNextVideo: body.suggestedNextVideo || '',
                createdAt: new Date().toISOString()
            };
            await setJson(`cf:contentIdea:${idea.id}`, idea);
            await redis(['SADD', `cf:user:${user.id}:contentIdeas`, idea.id]);
            return json(200, { ok: true, idea });
        }
        if (action === 'report') {
            const user = await requireUser(req);
            const channels = await listKeysByIds(`cf:user:${user.id}:channels`, 'cf:channel');
            const channel = channels[0];
            const videos = channel ? await listKeysByIds(`cf:channel:${channel.id}:videos`, 'cf:video') : [];
            return json(200, { ok: true, generatedAt: new Date().toISOString(), user: publicUser(user), channel, analytics: buildAnalytics(videos) });
        }
        if (action === 'ai' && req.method === 'POST') {
            const user = await requireUser(req);
            const config = getConfig();
            if (!config.aiKey) return json(503, { ok: false, error: 'AI provider is not configured. Set OPENAI_API_KEY or OPENROUTER_API_KEY.' });
            const body = await readBody(req);
            const report = await creatorFlowHandler({ ...req, method: 'GET', url: `${getOrigin(req)}/api/creatorflow?action=analytics`, headers: req.headers });
            const context = JSON.parse(report.body);
            const response = await fetch(`${config.aiBaseUrl}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.aiKey}` },
                body: JSON.stringify({
                    model: config.aiModel,
                    messages: [
                        { role: 'system', content: 'You are CreatorFlow, a YouTube creator intelligence assistant. Use only the provided channel context. If data is missing, say that YouTube or CSV analytics must be connected. Never invent analytics.' },
                        { role: 'user', content: `Creator: ${user.email}\nChannel context JSON: ${JSON.stringify(context).slice(0, 12000)}\n\nRequest: ${body.prompt}` }
                    ],
                    temperature: 0.4
                })
            });
            const data = await response.json();
            if (!response.ok) return json(response.status, { ok: false, error: data.error?.message || 'AI provider request failed.' });
            return json(200, { ok: true, text: data.choices?.[0]?.message?.content || '' });
        }
        return json(404, { ok: false, error: 'Unknown CreatorFlow action.' });
    } catch (error) {
        return json(error.statusCode || 500, { ok: false, error: error.message || 'CreatorFlow request failed.' });
    }
}

module.exports = {
    APP_COOKIE,
    UNAVAILABLE,
    json,
    parseCookies,
    cookie,
    sealSession,
    openSession,
    getOrigin,
    isSecureCookie,
    getConfig,
    redis,
    getJson,
    setJson,
    requireUser,
    creatorFlowHandler,
    buildAnalytics,
    classifyFormat,
    classifyPillar,
    detectMapping
};
