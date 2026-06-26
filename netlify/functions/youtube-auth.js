const { authHandler } = require('../../api/_youtubeCore');
const { toNetlify } = require('./_adapter');

exports.handler = async (event) => {
    return toNetlify(authHandler({
        url: event.rawUrl,
        headers: event.headers || {}
    }));
};
