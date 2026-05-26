const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = process.env.PORT || 8081;

const MIME_TYPES = {
    '.html': 'text/html', '.js': 'application/javascript',
    '.wasm': 'application/wasm', '.bin': 'application/octet-stream',
    '.css': 'text/css', '.json': 'application/json',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Access-Control-Allow-Origin', '*');
    
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
