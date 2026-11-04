const { commentsApiHandler } = require('./_youtubeCommentsCore');

module.exports = async (req, res) => {
    if (req.method === 'OPTIONS') {
        res.setHeader('Allow', 'GET, POST, OPTIONS');
        return res.status(204).end();
    }
    try {
        const result = await commentsApiHandler(req);
        Object.entries(result.headers || {}).forEach(([key, value]) => res.setHeader(key, value));
        res.status(result.statusCode).send(result.body || '');
    } catch (error) {
        console.error('[youtube-comments] Unhandled error:', error);
        res.status(500).json({ ok: false, error: error.message || 'YouTube comments failed.' });
    }
};
