const { channelHandler } = require('./_youtubeCore');

module.exports = async (req, res) => {
    if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        return res.status(405).json({ ok: false, error: 'Method not allowed. Use GET to fetch channel data.' });
    }

    try {
        const result = await channelHandler(req);
        Object.entries(result.headers || {}).forEach(([key, value]) => res.setHeader(key, value));
        res.status(result.statusCode).send(result.body || '');
    } catch (error) {
        console.error('[youtube-channel] Unhandled error:', error);
        res.status(500).json({ ok: false, error: error.message || 'YouTube channel analysis failed.' });
    }
};
