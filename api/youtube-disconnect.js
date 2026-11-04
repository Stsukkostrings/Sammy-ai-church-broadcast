const { disconnectHandler } = require('./_youtubeCore');

module.exports = async (req, res) => {
    if (req.method && req.method !== 'POST' && req.method !== 'GET') {
        res.setHeader('Allow', 'POST, GET');
        return res.status(405).json({ ok: false, error: 'Method not allowed. Use POST to disconnect the YouTube channel.' });
    }

    const result = disconnectHandler(req);
    Object.entries(result.headers || {}).forEach(([key, value]) => res.setHeader(key, value));
    res.status(result.statusCode).send(result.body || '');
};
