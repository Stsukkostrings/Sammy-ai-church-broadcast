const auth = require('../../lib/auth/supabase');

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).setHeader('Allow', 'POST').json({ ok: false, error: 'Method not allowed.' });
    if (!auth.isSameOrigin(req)) return res.status(403).json({ ok: false, error: 'Request origin not allowed.' });
    const result = await auth.authenticateRequest(req);
    if (result.accessToken) {
        try { await auth.authRequest('/logout', { method: 'POST', accessToken: result.accessToken }); } catch (_) {}
    }
    res.setHeader('Set-Cookie', [auth.clearCookie(auth.SESSION_COOKIE, req), auth.clearCookie(auth.SCOPE_COOKIE, req), auth.clearCookie(auth.CHANNEL_COOKIE, req), auth.clearCookie('sf_youtube', req)]);
    return res.status(200).json({ ok: true });
};
