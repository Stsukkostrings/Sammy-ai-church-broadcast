const { spiritFlowNowPlayingHandler } = require('../_spiritFlowCore');

/* GET /api/spiritflow/nowplaying — server-side proxy for AzuraCast now-playing data.
   The AzuraCast API key never reaches the browser. */
module.exports = async (req, res) => {
    if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
        res.setHeader('Allow', 'GET, HEAD');
        return res.status(405).json({ ok: false, error: 'Method not allowed. Use GET for station data.' });
    }

    const result = await spiritFlowNowPlayingHandler();
    Object.entries(result.headers || {}).forEach(([key, value]) => res.setHeader(key, value));
    res.status(result.statusCode).send(result.body || '');
};
