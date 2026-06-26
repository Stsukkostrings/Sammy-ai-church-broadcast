const crypto = require('crypto');

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3';
const YOUTUBE_ANALYTICS_API = 'https://youtubeanalytics.googleapis.com/v2/reports';

const SCOPES = [
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/yt-analytics.readonly'
].join(' ');

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

function redirect(location, headers = {}) {
    return {
        statusCode: 302,
        headers: {
            Location: location,
            'Cache-Control': 'no-store',
            ...headers
        },
        body: ''
    };
}

function getOrigin(req) {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const proto = req.headers['x-forwarded-proto'] || (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host || '') ? 'http' : 'https');
    return `${proto}://${host}`;
}

function isSecureCookie(req) {
    return !getOrigin(req).startsWith('http://localhost') && !getOrigin(req).startsWith('http://127.0.0.1');
}

function getRedirectUri(req) {
    return process.env.YOUTUBE_REDIRECT_URI
        || process.env.GOOGLE_REDIRECT_URI
        || `${getOrigin(req)}/api/youtube-callback`;
}

function getClientConfig() {
    return {
        clientId: process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET,
        sessionSecret: process.env.SESSION_SECRET || process.env.YOUTUBE_SESSION_SECRET
    };
}

function assertConfig() {
    const config = getClientConfig();
    const missing = [];
    if (!config.clientId) missing.push('YOUTUBE_CLIENT_ID or GOOGLE_CLIENT_ID');
    if (!config.clientSecret) missing.push('YOUTUBE_CLIENT_SECRET or GOOGLE_CLIENT_SECRET');
    if (!config.sessionSecret) missing.push('SESSION_SECRET');
    return { config, missing };
}

function parseCookies(header = '') {
    return header.split(';').reduce((cookies, part) => {
        const index = part.indexOf('=');
        if (index > -1) cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
        return cookies;
    }, {});
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

function frontEndRedirect(req, suffix = '') {
    return `${getOrigin(req)}/spiritflow_creator_studio.html${suffix}`;
}

function authHandler(req) {
    console.log('[youtube-auth] Route hit', { method: req.method, url: req.url, origin: getOrigin(req) });

    const { config, missing } = assertConfig();
    if (missing.length) {
        console.error('[youtube-auth] Missing env vars:', missing);
        return json(500, {
            ok: false,
            error: 'YouTube OAuth is not configured yet.',
            missing,
            setup: 'Set YOUTUBE_CLIENT_ID (or GOOGLE_CLIENT_ID), YOUTUBE_CLIENT_SECRET (or GOOGLE_CLIENT_SECRET), SESSION_SECRET, and YOUTUBE_REDIRECT_URI (or GOOGLE_REDIRECT_URI) on Vercel.'
        });
    }

    const redirectUri = getRedirectUri(req);
    const state = crypto.randomBytes(24).toString('hex');
    const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        scope: SCOPES,
        state
    });

    const authUrl = `${GOOGLE_AUTH_URL}?${params.toString()}`;
    console.log('[youtube-auth] Redirect URI:', redirectUri);
    console.log('[youtube-auth] Generated auth URL:', authUrl);

    return redirect(authUrl, {
        'Set-Cookie': cookie('sf_youtube_state', state, { maxAge: 600, secure: isSecureCookie(req) })
    });
}

async function callbackHandler(req) {
    console.log('[youtube-callback] Route hit', { method: req.method, url: req.url });

    const { config, missing } = assertConfig();
    if (missing.length) return redirect(frontEndRedirect(req, '?youtube=missing-config'));

    const url = new URL(req.url, getOrigin(req));
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const cookies = parseCookies(req.headers.cookie || '');
    if (!code || !state || cookies.sf_youtube_state !== state) {
        console.error('[youtube-callback] Auth failed: invalid code/state');
        return redirect(frontEndRedirect(req, '?youtube=auth-failed'));
    }

    const redirectUri = getRedirectUri(req);
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            code,
            client_id: config.clientId,
            client_secret: config.clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code'
        })
    });

    const token = await tokenResponse.json();
    if (!tokenResponse.ok) {
        console.error('[youtube-callback] Token exchange failed:', token.error || token);
        return redirect(frontEndRedirect(req, '?youtube=auth-failed'));
    }

    const session = {
        access_token: token.access_token,
        refresh_token: token.refresh_token,
        expires_at: Date.now() + ((token.expires_in || 3600) - 60) * 1000
    };

    console.log('[youtube-callback] OAuth success, redirecting to studio');
    return redirect(frontEndRedirect(req, '?youtube=connected'), {
        'Set-Cookie': [
            cookie('sf_youtube', sealSession(session, config.sessionSecret), { maxAge: 60 * 60 * 24 * 30, secure: isSecureCookie(req) }),
            cookie('sf_youtube_state', '', { maxAge: 1, secure: isSecureCookie(req) })
        ]
    });
}

async function refreshSession(session, config) {
    if (!session || Date.now() < session.expires_at) return { session, changed: false };
    if (!session.refresh_token) throw new Error('Missing refresh token. Reconnect the channel.');

    const response = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            refresh_token: session.refresh_token,
            grant_type: 'refresh_token'
        })
    });
    const token = await response.json();
    if (!response.ok) throw new Error(token.error_description || token.error || 'Unable to refresh YouTube token.');

    return {
        changed: true,
        session: {
            ...session,
            access_token: token.access_token,
            expires_at: Date.now() + ((token.expires_in || 3600) - 60) * 1000
        }
    };
}

async function googleGet(url, accessToken) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || data.error || 'Google API request failed.');
    return data;
}

function compactNumber(value) {
    const number = Number(value || 0);
    if (number >= 1000000) return `${(number / 1000000).toFixed(1)}M`;
    if (number >= 1000) return `${(number / 1000).toFixed(1)}K`;
    return `${number}`;
}

function scoreFromChannel(channel, videos, analytics) {
    const stats = channel.statistics || {};
    const branding = channel.brandingSettings?.channel || {};
    const hasDescription = (branding.description || channel.snippet?.description || '').length > 80;
    const uploads = Number(stats.videoCount || 0);
    const subscribers = Number(stats.subscriberCount || 0);
    const recentCount = videos.length;
    const avgViews = recentCount ? videos.reduce((sum, video) => sum + Number(video.statistics?.viewCount || 0), 0) / recentCount : 0;
    const brandingScore = hasDescription ? 88 : 55;
    const consistencyScore = Math.min(95, Math.round((recentCount / 10) * 100));
    const seoScore = Math.round(Math.min(95, 45 + (hasDescription ? 20 : 0) + Math.min(20, uploads / 5) + Math.min(10, subscribers / 1000)));
    const engagementScore = Math.round(Math.min(95, 40 + Math.min(35, avgViews / 100) + (analytics?.views ? 10 : 0)));
    const health = Math.round((brandingScore + consistencyScore + seoScore + engagementScore) / 4);

    return { health, brandingScore, consistencyScore, seoScore, engagementScore };
}

async function channelHandler(req) {
    console.log('[youtube-channel] Route hit', { method: req.method, url: req.url });

    const { config, missing } = assertConfig();
    if (missing.length) return json(500, { ok: false, error: 'YouTube API is not configured.', missing });

    const cookies = parseCookies(req.headers.cookie || '');
    let session;
    try {
        session = openSession(cookies.sf_youtube, config.sessionSecret);
    } catch (error) {
        return json(401, { ok: false, error: 'Invalid YouTube session. Connect your channel again.' });
    }
    if (!session) return json(401, { ok: false, error: 'No YouTube channel is connected yet.' });

    let changed = false;
    try {
        const refreshed = await refreshSession(session, config);
        session = refreshed.session;
        changed = refreshed.changed;
    } catch (error) {
        return json(401, { ok: false, error: error.message });
    }

    let channelData, channel;
    try {
        channelData = await googleGet(`${YOUTUBE_API}/channels?part=snippet,statistics,contentDetails,brandingSettings&mine=true`, session.access_token);
        channel = channelData.items?.[0];
        if (!channel) return json(404, { ok: false, error: 'No YouTube channel was found on this Google account.' });
    } catch (error) {
        return json(401, { ok: false, error: `Failed to fetch channel data: ${error.message}. Your YouTube token may be invalid or expired. Please reconnect your channel.` });
    }

    const uploadsPlaylist = channel.contentDetails?.relatedPlaylists?.uploads;
    let videos = [];
    if (uploadsPlaylist) {
        try {
            const playlist = await googleGet(`${YOUTUBE_API}/playlistItems?part=snippet,contentDetails&playlistId=${uploadsPlaylist}&maxResults=10`, session.access_token);
            const ids = (playlist.items || []).map(item => item.contentDetails.videoId).filter(Boolean);
            if (ids.length) {
                const videoData = await googleGet(`${YOUTUBE_API}/videos?part=snippet,statistics,contentDetails&id=${ids.join(',')}`, session.access_token);
                videos = videoData.items || [];
            }
        } catch (error) {
            console.error('[youtube-channel] Failed to fetch videos:', error.message);
            videos = [];
        }
    }

    let analytics = null;
    try {
        const end = new Date().toISOString().slice(0, 10);
        const start = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const analyticsUrl = `${YOUTUBE_ANALYTICS_API}?ids=channel==MINE&startDate=${start}&endDate=${end}&metrics=views,estimatedMinutesWatched,averageViewDuration,subscribersGained&dimensions=day&sort=day`;
        const report = await googleGet(analyticsUrl, session.access_token);
        const totals = (report.rows || []).reduce((sum, row) => ({
            views: sum.views + Number(row[1] || 0),
            minutesWatched: sum.minutesWatched + Number(row[2] || 0),
            averageViewDuration: Number(row[3] || sum.averageViewDuration || 0),
            subscribersGained: sum.subscribersGained + Number(row[4] || 0)
        }), { views: 0, minutesWatched: 0, averageViewDuration: 0, subscribersGained: 0 });
        analytics = { ...totals, rows: report.rows || [] };
    } catch (error) {
        analytics = { unavailable: true, reason: error.message, rows: [] };
    }

    const score = scoreFromChannel(channel, videos, analytics);
    const body = {
        ok: true,
        channel: {
            id: channel.id,
            title: channel.snippet?.title,
            description: channel.snippet?.description || channel.brandingSettings?.channel?.description || '',
            thumbnail: channel.snippet?.thumbnails?.default?.url,
            publishedAt: channel.snippet?.publishedAt,
            statistics: channel.statistics || {},
            compact: {
                subscribers: compactNumber(channel.statistics?.subscriberCount),
                views: compactNumber(channel.statistics?.viewCount),
                videos: compactNumber(channel.statistics?.videoCount)
            }
        },
        analytics,
        videos: videos.map(video => ({
            id: video.id,
            title: video.snippet?.title,
            publishedAt: video.snippet?.publishedAt,
            thumbnail: video.snippet?.thumbnails?.medium?.url,
            statistics: video.statistics || {},
            compact: {
                views: compactNumber(video.statistics?.viewCount),
                likes: compactNumber(video.statistics?.likeCount),
                comments: compactNumber(video.statistics?.commentCount)
            }
        })),
        audit: {
            ...score,
            strengths: [
                channel.snippet?.title ? `Clear channel identity: ${channel.snippet.title}` : 'Channel identity detected',
                `${compactNumber(channel.statistics?.videoCount)} public uploads are available for analysis`,
                videos.length ? 'Recent uploads are available for performance comparison' : 'Channel metadata is connected'
            ],
            weaknesses: [
                (channel.snippet?.description || '').length < 80 ? 'Channel description is too short for strong SEO' : 'Review older uploads for metadata consistency',
                analytics?.unavailable ? 'YouTube Analytics report was unavailable for this account' : 'Keep improving retention and watch-time patterns',
                videos.some(video => !(video.statistics?.commentCount)) ? 'Some recent videos have low comment activity' : 'Community engagement should be monitored weekly'
            ],
            recommendations: [
                'Use target worship/gospel keywords in the channel description and latest uploads',
                'Group recent videos into playlists by worship theme, testimony, sermon, or Bible topic',
                'Compare top recent videos and repeat the strongest title/thumbnail patterns',
                'Post community updates around every major release or livestream'
            ]
        }
    };

    const headers = changed
        ? { 'Set-Cookie': cookie('sf_youtube', sealSession(session, config.sessionSecret), { maxAge: 60 * 60 * 24 * 30, secure: isSecureCookie(req) }) }
        : {};
    return json(200, body, headers);
}

module.exports = { authHandler, callbackHandler, channelHandler };
