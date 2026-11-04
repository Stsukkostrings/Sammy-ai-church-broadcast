const { creatorFlowHandler } = require('./_creatorFlowCore');

module.exports = async (req, res) => {
    const result = await creatorFlowHandler(req);
    Object.entries(result.headers || {}).forEach(([key, value]) => res.setHeader(key, value));
    res.status(result.statusCode).send(result.body || '');
};
