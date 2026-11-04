const auth = require('./supabase');
const store = require('../db/tenant-store');

async function accountForRequest(req) {
    const result = await auth.authenticateRequest(req);
    if (result.error) return { error: result.error, setCookie: result.clearCookie };
    return { user: result.user, accessToken: result.accessToken, setCookie: result.setCookie };
}

async function selectedChannel(req, account) {
    const selection = auth.getSealedCookie(req, auth.CHANNEL_COOKIE, 'channel-selection');
    if (selection?.userId === account.user.id && selection.channelId) {
        const owned = await store.getChannel(account.user, account.accessToken, selection.channelId);
        if (owned) return owned;
    }
    const channels = await store.listChannels(account.user, account.accessToken);
    if (channels.length === 1) return store.getChannel(account.user, account.accessToken, channels[0].channel_id);
    if (channels.length > 1) throw Object.assign(new Error('Choose one of your connected YouTube channels.'), { status: 409, code: 'CHANNEL_SELECTION_REQUIRED' });
    throw Object.assign(new Error('Connect a YouTube channel to continue.'), { status: 401, code: 'YOUTUBE_NOT_CONNECTED' });
}

async function channelForRequest(req) {
    const account = await accountForRequest(req);
    if (account.error) return account;
    try {
        const channel = await selectedChannel(req, account);
        let full = await store.getChannelTokens(account.user, account.accessToken, channel.channel_id);
        if (Date.parse(full.token_expires_at) <= Date.now() + 60_000) {
            if (!full.refreshToken) throw Object.assign(new Error('Reconnect this YouTube channel to continue.'), { status: 401, code: 'YOUTUBE_RECONNECT_REQUIRED' });
            const clientId = process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
            const clientSecret = process.env.YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
            if (!clientId || !clientSecret) throw Object.assign(new Error('YouTube OAuth is not configured.'), { status: 503, code: 'YOUTUBE_NOT_CONFIGURED' });
            const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: full.refreshToken, grant_type: 'refresh_token' })
            });
            const refreshed = await tokenResponse.json();
            if (!tokenResponse.ok || !refreshed.access_token) throw Object.assign(new Error('Reconnect this YouTube channel to continue.'), { status: 401, code: 'YOUTUBE_RECONNECT_REQUIRED' });
            const expiresAt = Date.now() + ((refreshed.expires_in || 3600) - 60) * 1000;
            await store.saveChannel(account.user, account.accessToken, {
                channelId: full.channel_id, title: full.channel_title, accessToken: refreshed.access_token,
                refreshToken: refreshed.refresh_token || full.refreshToken, expiresAt
            });
            full = { ...full, accessToken: refreshed.access_token, token_expires_at: new Date(expiresAt).toISOString() };
        }
        return { ...account, channel: full, channelId: full.channel_id, user: account.user };
    } catch (error) { return { ...account, error }; }
}

function accountHeaders(result) { return result?.setCookie ? { 'Set-Cookie': result.setCookie } : {}; }

module.exports = { accountForRequest, selectedChannel, channelForRequest, accountHeaders };
