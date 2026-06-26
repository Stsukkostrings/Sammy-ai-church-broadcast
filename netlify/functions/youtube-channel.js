const { channelHandler } = require('../../api/_youtubeCore');
const { toNetlify } = require('./_adapter');

exports.handler = async (event) => {
    try {
        return toNetlify(await channelHandler({
            url: event.rawUrl,
            headers: event.headers || {}
        }));
    } catch (error) {
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
            body: JSON.stringify({ ok: false, error: error.message || 'YouTube channel analysis failed.' })
        };
    }
};
