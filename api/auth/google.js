const crypto = require('crypto');
const auth = require('../../lib/auth/supabase');

function respond(res, status, body, headers = {}) {
    res.setHeader('Cache-Control', 'no-store');
    Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value));
    return res.status(status).json(body);
}

module.exports = async (req, res) => {
    if (req.method !== 'GET') return respond(res, 405, { ok: false, error: 'Method not allowed.' }, { Allow: 'GET' });
    const config = auth.getConfig();
    if (!config.configured) return respond(res, 503, { ok: false, error: 'Account sign-in is not configured.' });
    try {
        const verifier = crypto.randomBytes(48).toString('base64url');
        const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
        const url = new URL(`${config.url}/auth/v1/authorize`);
        url.searchParams.set('provider', 'google');
        url.searchParams.set('redirect_to', `${auth.baseUrl(req)}/api/auth/callback`);
        url.searchParams.set('code_challenge', challenge);
        url.searchParams.set('code_challenge_method', 's256');
        // The Supabase JS client sends the project API key when it requests the
        // OAuth redirect. Do the same server-side so the key never has to be
        // placed in the browser URL or a public script.
        const response = await fetch(url, {
            method: 'GET',
            headers: { apikey: config.apiKey },
            redirect: 'manual'
        });
        const location = response.headers.get('location');
        if (response.status < 300 || response.status >= 400 || !location) {
            return respond(res, 503, { ok: false, error: 'Unable to start secure sign-in.' });
        }
        const providerUrl = new URL(location);
        if (providerUrl.protocol !== 'https:' || !providerUrl.hostname) {
            return respond(res, 503, { ok: false, error: 'Unable to start secure sign-in.' });
        }
        const flow = auth.seal({ verifier, createdAt: Date.now() }, config.sessionSecret, 'auth-flow');
        return res.status(302).setHeader('Cache-Control', 'no-store').setHeader('Location', providerUrl.toString()).setHeader('Set-Cookie', auth.serializeCookie(auth.FLOW_COOKIE, flow, req, 600)).end();
    } catch (_) { return respond(res, 400, { ok: false, error: 'Unable to start secure sign-in.' }); }
};
