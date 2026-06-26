function toNetlify(result) {
    const headers = {};
    const multiValueHeaders = {};

    Object.entries(result.headers || {}).forEach(([key, value]) => {
        if (Array.isArray(value)) {
            multiValueHeaders[key] = value;
        } else {
            headers[key] = value;
        }
    });

    return {
        statusCode: result.statusCode,
        headers,
        multiValueHeaders,
        body: result.body || ''
    };
}

module.exports = { toNetlify };
