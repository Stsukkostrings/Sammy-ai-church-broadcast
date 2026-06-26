const { callbackHandler } = require('../../api/_youtubeCore');
const { toNetlify } = require('./_adapter');

exports.handler = async (event) => {
    return toNetlify(await callbackHandler({
        url: event.rawUrl,
        headers: event.headers || {}
    }));
};
