const { callbackHandler } = require('./_youtubeCore');

module.exports = async (req, res) => {
    if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        return res.status(405).json({ ok: false, error: 'Method not allowed. Use GET for OAuth callback.' });
    }

    const result = await callbackHandler(req);
    Object.entries(result.headers || {}).forEach(([key, value]) => res.setHeader(key, value));
    res.status(result.statusCode).send(result.body || '');
};
