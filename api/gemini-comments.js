const { geminiCommentsHandler } = require('./_geminiCommentsCore');

module.exports = async (req, res) => {
    if (req.method && req.method !== 'POST' && req.method !== 'GET') {
        res.setHeader('Allow', 'GET, POST');
        return res.status(405).json({ ok: false, error: 'Method not allowed. Use GET for status and POST to generate comment replies.' });
    }

    const result = await geminiCommentsHandler(req);
    Object.entries(result.headers || {}).forEach(([key, value]) => res.setHeader(key, value));
    res.status(result.statusCode).send(result.body || '');
};
