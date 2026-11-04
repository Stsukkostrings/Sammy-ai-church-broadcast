const auth = require('../lib/auth/supabase');
const store = require('../lib/db/tenant-store');
const { accountForRequest } = require('../lib/auth/youtube-context');

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') return res.status(405).setHeader('Allow', 'GET').json({ ok: false, error: 'Method not allowed.' });
    const account = await accountForRequest(req);
    if (account.error) {
        if (account.setCookie) res.setHeader('Set-Cookie', account.setCookie);
        return res.status(account.error.status || 503).json({ ok: false, code: account.error.code, error: account.error.message });
    }
    try {
        const channels = await store.listChannels(account.user, account.accessToken);
        if (account.setCookie) res.setHeader('Set-Cookie', account.setCookie);
        const selected = auth.getSealedCookie(req, auth.CHANNEL_COOKIE, 'channel-selection');
        const selectedChannelId = selected?.userId === account.user.id && channels.some(channel => channel.channel_id === selected.channelId) ? selected.channelId : channels.length === 1 ? channels[0].channel_id : null;
        return res.status(200).json({ ok: true, selectedChannelId, channels: channels.map(({ channel_id, channel_title, connected_at }) => ({ id: channel_id, title: channel_title, connectedAt: connected_at })) });
    } catch (error) { return res.status(error.status || 503).json({ ok: false, error: error.message }); }
};
