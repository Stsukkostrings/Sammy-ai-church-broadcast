/*
 SpiritFlow Sounds Radio — server-side configuration + station data.

 This module is the ONLY place that reads the AzuraCast environment
 variables. It is used by:
   - api/spiritflow-config.js      -> GET /api/spiritflow-config   (public, safe values only)
   - api/spiritflow/nowplaying.js  -> GET /api/spiritflow/nowplaying (proxied station data)
   - server.js                     -> same routes for local development

 Environment variables (Vercel project settings):
   PUBLIC (returned to the browser):
     SPIRITFLOW_STREAM_URL           e.g. "https://radio.example.com/radio/8000/stream"
     SPIRITFLOW_YOUTUBE_LIVE_URL
     SPIRITFLOW_YOUTUBE_CHANNEL_URL
     SPIRITFLOW_SUBMIT_MUSIC_URL     (optional override for the "Submit Music" link)
   SERVER-SIDE ONLY (never returned to the browser):
     SPIRITFLOW_AZURACAST_API_URL    e.g. "https://radio.example.com"
     SPIRITFLOW_AZURACAST_STATION_ID e.g. "1"
     SPIRITFLOW_AZURACAST_API_KEY    AzuraCast API key, sent only to the upstream

 Until these are set, the endpoints report "not configured" and the
 frontend shows an honest offline / "being configured" state.
*/

const NOW_PLAYING_PATH = '/api/spiritflow/nowplaying';

function json(statusCode, body) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store'
        },
        body: JSON.stringify(body)
    };
}

function upstreamConfig() {
    return {
        apiUrl: (process.env.SPIRITFLOW_AZURACAST_API_URL || '').replace(/\/+$/, ''),
        stationId: process.env.SPIRITFLOW_AZURACAST_STATION_ID || '',
        apiKey: process.env.SPIRITFLOW_AZURACAST_API_KEY || ''
    };
}

/* Only http(s) upstreams with a simple station id are allowed, so a bad
 * environment value cannot turn the proxy into an arbitrary URL fetcher. */
function upstreamUrl() {
    const { apiUrl, stationId } = upstreamConfig();
    if (!apiUrl || !/^[A-Za-z0-9_-]{1,64}$/.test(stationId)) return null;
    let parsed;
    try { parsed = new URL(apiUrl); } catch (_) { return null; }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return apiUrl + '/api/nowplaying/' + encodeURIComponent(stationId);
}

function isUpstreamConfigured() {
    return !!upstreamUrl();
}

function safeSong(song) {
    if (!song || typeof song !== 'object') return null;
    return {
        title: typeof song.title === 'string' ? song.title : '',
        artist: typeof song.artist === 'string' ? song.artist : '',
        art: typeof song.art === 'string' ? song.art : ''
    };
}

/* Forward only the public now-playing fields the player actually uses. */
function safeNowPlaying(data) {
    const history = Array.isArray(data?.song_history) ? data.song_history.slice(0, 10) : [];
    return {
        is_online: data?.is_online === true,
        listeners: { current: Number(data?.listeners?.current ?? data?.listeners?.total ?? 0) || 0 },
        now_playing: { song: safeSong(data?.now_playing?.song) },
        song_history: history.map(item => ({
            song: safeSong(item?.song),
            played_at: typeof item?.played_at === 'string' ? item.played_at : null
        })),
        live: { is_live: data?.live?.is_live === true }
    };
}

/* Public, safe-for-browser configuration only. */
function spiritFlowConfigHandler() {
    return json(200, {
        ok: true,
        streamUrl: process.env.SPIRITFLOW_STREAM_URL || '',
        youtubeLiveUrl: process.env.SPIRITFLOW_YOUTUBE_LIVE_URL || '',
        youtubeChannelUrl: process.env.SPIRITFLOW_YOUTUBE_CHANNEL_URL || '',
        rumbleLiveUrl: process.env.SPIRITFLOW_RUMBLE_LIVE_URL || '',
        rumbleChannelUrl: process.env.SPIRITFLOW_RUMBLE_CHANNEL_URL || '',
        submitMusicUrl: process.env.SPIRITFLOW_SUBMIT_MUSIC_URL || '',
        nowPlayingEndpoint: isUpstreamConfigured() ? NOW_PLAYING_PATH : ''
    });
}

/* Proxies the AzuraCast now-playing payload. The API key stays here. */
async function spiritFlowNowPlayingHandler() {
    const url = upstreamUrl();
    if (!url) {
        return json(503, {
            ok: false,
            configured: false,
            error: 'SpiritFlow radio service is not configured. Set SPIRITFLOW_AZURACAST_API_URL and SPIRITFLOW_AZURACAST_STATION_ID.'
        });
    }

    const { apiKey } = upstreamConfig();
    const headers = { 'Accept': 'application/json' };
    if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;

    try {
        const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
        if (!res.ok) {
            return json(502, { ok: false, configured: true, error: 'Station service responded with status ' + res.status });
        }
        const data = await res.json();
        return { statusCode: 200, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, body: JSON.stringify({ ok: true, configured: true, ...safeNowPlaying(data) }) };
    } catch (error) {
        return json(502, { ok: false, configured: true, error: 'Unable to reach the station service.' });
    }
}

module.exports = {
    spiritFlowConfigHandler,
    spiritFlowNowPlayingHandler
};
