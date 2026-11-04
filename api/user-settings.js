const auth = require('../lib/auth/supabase');
const store = require('../lib/db/tenant-store');

function json(res, status, body) { res.setHeader('Cache-Control', 'no-store'); return res.status(status).json(body); }
function readBody(req) {
    if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
    if (typeof req.body === 'string') { try { return Promise.resolve(JSON.parse(req.body)); } catch (_) { return Promise.reject(Object.assign(new Error('Request must contain valid JSON.'), { status: 400 })); } }
    return new Promise((resolve, reject) => {
        let raw = '';
        let size = 0;
        const onData = chunk => {
            size += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
            if (size > 16 * 1024) {
                req.removeListener('data', onData); req.removeListener('end', onEnd); req.removeListener('error', onError);
                reject(Object.assign(new Error('Request is too large.'), { status: 413 }));
                return;
            }
            raw += chunk.toString();
        };
        const onEnd = () => { try { resolve(JSON.parse(raw || '{}')); } catch (_) { reject(Object.assign(new Error('Request must contain valid JSON.'), { status: 400 })); } };
        const onError = error => reject(error);
        req.on('data', onData); req.on('end', onEnd); req.on('error', onError);
    });
}

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') { res.setHeader('Allow', 'GET, HEAD, POST, OPTIONS'); return res.status(204).end(); }
    if (!['GET', 'HEAD', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD, POST, OPTIONS'); return json(res, 405, { ok: false, error: 'Method not allowed.' }); }
    if (req.method === 'POST' && !auth.isSameOrigin(req)) return json(res, 403, { ok: false, error: 'Request origin not allowed.' });
    const account = await auth.authenticateRequest(req);
    if (account.error) {
        if (account.clearCookie) res.setHeader('Set-Cookie', account.clearCookie);
        return json(res, account.error.status || 503, { ok: false, code: account.error.code, error: account.error.message });
    }
    const extraHeaders = {};
    if (account.setCookie) extraHeaders['Set-Cookie'] = account.setCookie;
    try {
        if (req.method === 'GET') {
            const rows = await store.getSettings(account.user, account.accessToken);
            if (extraHeaders['Set-Cookie']) res.setHeader('Set-Cookie', extraHeaders['Set-Cookie']);
            return json(res, 200, { ok: true, settings: Object.fromEntries(rows.map(row => [row.key, row.value])) });
        }
        if (req.method === 'HEAD') { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); if (extraHeaders['Set-Cookie']) res.setHeader('Set-Cookie', extraHeaders['Set-Cookie']); return res.status(200).end(); }
        const { key, value } = await readBody(req);
        if (typeof key !== 'string' || value === undefined || !/^[a-z][a-z0-9_.-]{1,63}$/i.test(key) || JSON.stringify(value).length > 8000) return json(res, 400, { ok: false, error: 'Invalid setting.' });
        await store.setSetting(account.user, account.accessToken, key, value);
        if (extraHeaders['Set-Cookie']) res.setHeader('Set-Cookie', extraHeaders['Set-Cookie']);
        return json(res, 200, { ok: true });
    } catch (error) { 
        if (extraHeaders['Set-Cookie']) res.setHeader('Set-Cookie', extraHeaders['Set-Cookie']);
        return json(res, error.status || 503, { ok: false, error: error.message }); 
    }
};
