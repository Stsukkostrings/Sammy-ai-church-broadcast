const http = require('http');
const fs = require('fs');
const path = require('path');
const { authHandler, callbackHandler, channelHandler } = require('./api/_youtubeCore');
const PORT = process.env.PORT || 8081;

const MIME_TYPES = {
    '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript',
    '.wasm': 'application/wasm', '.bin': 'application/octet-stream',
    '.css': 'text/css', '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
};

function sendServerlessResult(res, result) {
    Object.entries(result.headers || {}).forEach(([key, value]) => res.setHeader(key, value));
    res.writeHead(result.statusCode);
    res.end(result.body || '');
}

const server = http.createServer(async (req, res) => {
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Access-Control-Allow-Origin', '*');

    try {
        if (req.url.startsWith('/api/youtube-auth')) {
            return sendServerlessResult(res, authHandler(req));
        }
        if (req.url.startsWith('/api/youtube-callback')) {
            return sendServerlessResult(res, await callbackHandler(req));
        }
        if (req.url.startsWith('/api/youtube-channel')) {
            return sendServerlessResult(res, await channelHandler(req));
        }
    } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: error.message || 'Server error' }));
        return;
    }
    
    let filePath = '.' + req.url;
    if (filePath === './') filePath = './studio.html';
    
    const ext = String(path.extname(filePath)).toLowerCase();
    const ct = MIME_TYPES[ext] || 'application/octet-stream';
    
    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(err.code === 'ENOENT' ? 404 : 500);
            res.end(err.code === 'ENOENT' ? '<h1>404</h1>' : 'Server Error');
        } else {
            res.writeHead(200, { 'Content-Type': ct });
            res.end(content);
        }
    });
});

server.listen(PORT, () => {
    console.log('\n🎙️  OmniCast running at http://localhost:' + PORT);
    console.log('   Headers: COOP/COEP enabled\n');
});
