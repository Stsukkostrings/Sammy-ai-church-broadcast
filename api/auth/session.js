const auth = require('../../lib/auth/supabase');

module.exports = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') return res.status(405).setHeader('Allow', 'GET').json({ ok: false, error: 'Method not allowed.' });
    const result = await auth.authenticateRequest(req);
    if (result.error) {
        if (result.error.status === 401) {
            res.setHeader('Set-Cookie', [
                result.clearCookie || auth.clearCookie(auth.SESSION_COOKIE, req),
                auth.clearCookie(auth.SCOPE_COOKIE, req),
                auth.clearCookie(auth.CHANNEL_COOKIE, req)
            ]);
        }
        return res.status(result.error.status || 503).json({ ok: false, code: result.error.code, error: result.error.message });
    }
    const cookies = Array.isArray(result.setCookie) ? [...result.setCookie] : (result.setCookie ? [result.setCookie] : []);
    cookies.push(auth.serializeCookie(auth.SCOPE_COOKIE, result.user.id, req, auth.COOKIE_TTL_SECONDS, { httpOnly: false }));
    res.setHeader('Set-Cookie', cookies);
    return res.status(200).json({ ok: true, user: result.user });
};
