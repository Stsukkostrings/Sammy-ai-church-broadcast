const auth = require('../lib/auth/supabase');
const store = require('../lib/db/tenant-store');
const { accountForRequest } = require('../lib/auth/youtube-context');

function readBody(req) {
    if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
    if (typeof req.body === 'string') { try { return Promise.resolve(JSON.parse(req.body)); } catch (_) { return Promise.resolve({}); } }
    return new Promise(resolve => { let raw = ''; req.on('data', c => raw += c); req.on('end', () => { try { resolve(JSON.parse(raw || '{}')); } catch (_) { resolve({}); } }); });
}

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).setHeader('Allow', 'POST').json({ ok: false, error: 'Method not allowed.' });
    if (!auth.isSameOrigin(req)) return res.status(403).json({ ok: false, error: 'Request origin not allowed.' });
    const account = await accountForRequest(req);
    if (account.error) return res.status(account.error.status || 503).json({ ok: false, error: account.error.message });
    const { channelId } = await readBody(req);
    if (typeof channelId !== 'string' || !channelId || channelId.length > 200) return res.status(400).json({ ok: false, error: 'Choose a valid connected channel.' });
    try {
        const owned = await store.getChannel(account.user, account.accessToken, channelId);
        if (!owned) return res.status(404).json({ ok: false, error: 'That channel is not connected to your Omnicast account.' });
        const value = auth.seal({ userId: account.user.id, channelId }, auth.getConfig().sessionSecret, 'channel-selection');
        res.setHeader('Set-Cookie', [auth.serializeCookie(auth.CHANNEL_COOKIE, value, req), ...(account.setCookie ? [account.setCookie] : [])]);
        return res.status(200).json({ ok: true, channel: { id: owned.channel_id, title: owned.channel_title } });
    } catch (error) { return res.status(error.status || 503).json({ ok: false, error: error.message }); }
};
