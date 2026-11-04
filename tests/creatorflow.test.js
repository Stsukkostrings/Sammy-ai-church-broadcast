const assert = require('assert');
const { Readable } = require('stream');
const { creatorFlowHandler } = require('../api/_creatorFlowCore');

const store = new Map();
const sets = new Map();
const originalFetch = global.fetch;
const originalEnv = { ...process.env };

function installRedisMock() {
    process.env.SESSION_SECRET = 'test-session-secret-with-enough-length';
    process.env.UPSTASH_REDIS_REST_URL = 'https://unit-test-upstash.example';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'unit-test-token';
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    global.fetch = async (url, options = {}) => {
        if (String(url).includes('unit-test-upstash.example')) {
            const command = JSON.parse(options.body);
            const [op, key, ...args] = command;
            let result = null;
            if (op === 'GET') result = store.get(key) || null;
            if (op === 'SET') {
                store.set(key, args[0]);
                result = 'OK';
            }
            if (op === 'DEL') {
                result = store.delete(key) ? 1 : 0;
            }
            if (op === 'SADD') {
                if (!sets.has(key)) sets.set(key, new Set());
                args.forEach(value => sets.get(key).add(value));
                result = args.length;
            }
            if (op === 'SMEMBERS') result = [...(sets.get(key) || new Set())];
            return Response.json({ result });
        }
        return originalFetch(url, options);
    };
}

function restore() {
    global.fetch = originalFetch;
    process.env = originalEnv;
}

function req(method, action, body, cookie = '') {
    const stream = body ? Readable.from([JSON.stringify(body)]) : Readable.from([]);
    stream.method = method;
    stream.url = `http://localhost:8081/api/creatorflow?action=${action}`;
    stream.headers = { host: 'localhost:8081', cookie };
    return stream;
}

async function call(method, action, body, cookie = '') {
    const result = await creatorFlowHandler(req(method, action, body, cookie));
    const parsed = result.body ? JSON.parse(result.body) : {};
    return { ...result, parsed };
}

function cookieFrom(result) {
    return String(result.headers['Set-Cookie']).split(';')[0];
}

async function run() {
    installRedisMock();

    const config = await call('GET', 'config');
    assert.deepEqual(config.parsed.missing, []);

    const signupA = await call('POST', 'signup', {
        name: 'Creator A',
        email: 'creator-a@example.com',
        password: 'password-a',
        channelName: 'SpiritFlow Sounds'
    });
    assert.equal(signupA.statusCode, 200);
    assert.equal(signupA.parsed.user.email, 'creator-a@example.com');
    const cookieA = cookieFrom(signupA);
    const channelA = signupA.parsed.channel.id;

    const signupB = await call('POST', 'signup', {
        name: 'Creator B',
        email: 'creator-b@example.com',
        password: 'password-b',
        channelName: 'Gaming Channel'
    });
    assert.equal(signupB.statusCode, 200);
    const cookieB = cookieFrom(signupB);

    const loginA = await call('POST', 'login', { email: 'creator-a@example.com', password: 'password-a' });
    assert.equal(loginA.statusCode, 200);
    assert.ok(cookieFrom(loginA).startsWith('cf_session='));

    const imported = await call('POST', 'import-analytics', {
        channelId: channelA,
        fileName: 'real-youtube-export.csv',
        headers: ['Video title', 'Views', 'Impressions click-through rate (%)', 'Impressions', 'Watch time (hours)', 'Average view duration', 'Likes', 'Comments', 'Subscribers gained', 'Date', 'Duration', 'Traffic source', 'Content type'],
        rows: [
            { 'Video title': 'Moses Saw This Happen', Views: '1200', 'Impressions click-through rate (%)': '4.5%', Impressions: '22000', 'Watch time (hours)': '18.5', 'Average view duration': '0:42', Likes: '50', Comments: '8', 'Subscribers gained': '10', Date: '2026-08-01', Duration: '0:58', 'Traffic source': 'Shorts Feed', 'Content type': 'Shorts' },
            { 'Video title': 'Prayer When All Hope Seems Gone', Views: '850', 'Impressions click-through rate (%)': 'bad%', Impressions: '10000', 'Watch time (hours)': '9', 'Average view duration': '1:20', Likes: '30', Comments: '4', 'Subscribers gained': '3', Date: 'not-a-date', Duration: '1:30', 'Traffic source': 'Browse Features', 'Content type': 'Video' }
        ]
    }, cookieA);
    assert.equal(imported.statusCode, 200);
    assert.equal(imported.parsed.importedVideos, 2);
    assert.equal(imported.parsed.mapping.ctr, 'Impressions click-through rate (%)');
    assert.equal(imported.parsed.quality.malformedPercentages.length, 1);
    assert.equal(imported.parsed.quality.invalidDates.length, 1);
    assert.equal(imported.parsed.import.rawRows.length, 2);
    assert.equal(imported.parsed.import.cleanVideoIds.length, 2);

    const analyticsA = await call('GET', 'analytics', null, cookieA);
    assert.equal(analyticsA.statusCode, 200);
    assert.equal(analyticsA.parsed.analytics.totals.videos, 2);
    assert.equal(analyticsA.parsed.analytics.totals.views, 2050);
    assert.equal(analyticsA.parsed.analytics.totals.over1000, 1);
    assert.ok(analyticsA.parsed.analytics.videos[0].winner.components);

    const crossImport = await call('POST', 'import-analytics', { channelId: channelA, headers: [], rows: [] }, cookieB);
    assert.equal(crossImport.statusCode, 404);

    const crossThumb = await call('POST', 'thumbnail-projects', { channelId: channelA, name: 'Stolen project', variants: [] }, cookieB);
    assert.equal(crossThumb.statusCode, 404);

    const crossIdea = await call('POST', 'content-ideas', { channelId: channelA, title: 'Borrowed idea' }, cookieB);
    assert.equal(crossIdea.statusCode, 404);

    const settingsA = await call('POST', 'settings', { defaultDateRange: '90', shortsThresholdSeconds: 75, funnel: ['Discovery', 'Subscribe'] }, cookieA);
    assert.equal(settingsA.statusCode, 200);
    assert.equal(settingsA.parsed.settings.userId, signupA.parsed.user.id);
    assert.equal(settingsA.parsed.settings.shortsThresholdSeconds, 75);

    const analyticsBCross = await call('GET', `analytics&channelId=${channelA}`, null, cookieB);
    assert.equal(analyticsBCross.statusCode, 200);
    assert.notEqual(analyticsBCross.parsed.channel?.id, channelA);
    assert.equal(analyticsBCross.parsed.analytics.totals.videos, 0);

    const aiUnavailable = await call('POST', 'ai', { prompt: 'Analyze my channel' }, cookieA);
    assert.equal(aiUnavailable.statusCode, 503);
    assert.match(aiUnavailable.parsed.error, /AI provider is not configured/);

    const logout = await call('GET', 'logout', null, cookieA);
    assert.equal(logout.statusCode, 200);
    assert.match(String(logout.headers['Set-Cookie']), /Max-Age=1/);

    restore();
    console.log('CreatorFlow API tests passed');
}

run().catch(error => {
    restore();
    console.error(error);
    process.exit(1);
});
