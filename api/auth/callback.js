const auth = require('../../lib/auth/supabase');

module.exports = async (req, res) => {
    if (req.method !== 'GET') return res.status(405).setHeader('Allow', 'GET').json({ ok: false, error: 'Method not allowed.' });
    const config = auth.getConfig();
    const cookies = auth.parseCookies(req.headers.cookie || '');
    const flow = auth.open(cookies[auth.FLOW_COOKIE], config.sessionSecret, 'auth-flow');
    const clearFlow = auth.clearCookie(auth.FLOW_COOKIE, req);
    const fail = (reason) => res.status(302).setHeader('Cache-Control', 'no-store').setHeader('Location', `${auth.baseUrl(req)}/index.html?account=${reason}`).setHeader('Set-Cookie', clearFlow).end();
    if (!config.configured || !flow?.verifier || Date.now() - flow.createdAt > 600_000) return fail('sign-in-failed');
    const code = new URL(req.url, auth.baseUrl(req)).searchParams.get('code');
    if (!code) return fail('sign-in-failed');
    try {
        const session = await auth.authRequest('/token?grant_type=pkce', { method: 'POST', body: { auth_code: code, code_verifier: flow.verifier } });
        if (!session.access_token || !session.refresh_token) return fail('sign-in-failed');
        const user = await auth.authRequest('/user', { accessToken: session.access_token });
        if (!user?.id || !user.email) return fail('sign-in-failed');
        const sessionCookies = auth.createAuthSession(req, session, user.id);
        const channelCookie = auth.clearCookie(auth.CHANNEL_COOKIE, req);
        const legacyYouTubeCookie = auth.clearCookie('sf_youtube', req);
        const headerCookies = [clearFlow, channelCookie, legacyYouTubeCookie].concat(Array.isArray(sessionCookies) ? sessionCookies : [sessionCookies]);
        return res.status(302).setHeader('Cache-Control', 'no-store').setHeader('Location', `${auth.baseUrl(req)}/spiritflow_creator_studio.html?account=signed-in`).setHeader('Set-Cookie', headerCookies).end();
    } catch (_) { return fail('sign-in-failed'); }
};
