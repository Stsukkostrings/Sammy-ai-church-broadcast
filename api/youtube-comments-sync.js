const { commentsApiHandler } = require('./_youtubeCommentsCore');

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.setHeader('Allow', 'POST, OPTIONS');
        return res.status(204).end();
    }
    req.url = req.url.replace('/api/youtube-comments-sync', '/api/youtube-comments/sync');
    try {
        const result = await commentsApiHandler(req);
        Object.entries(result.headers || {}).forEach(([key, value]) => res.setHeader(key, value));
        res.status(result.statusCode).send(result.body || '');
    } catch (error) {
        res.status(500).json({ ok: false, error: error.message });
    }
};
