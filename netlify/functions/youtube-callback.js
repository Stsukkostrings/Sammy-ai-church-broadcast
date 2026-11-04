const { callbackHandler } = require('../../api/_youtubeCore');
const { toNetlify } = require('./_adapter');

exports.handler = async (event) => {
    const result = await callbackHandler({
        url: event.rawUrl || `https://${event.headers?.host || ''}${event.path || ''}${event.rawQuery ? '?' + event.rawQuery : ''}`,
        headers: event.headers || {}
    });
    return toNetlify(result);
};
