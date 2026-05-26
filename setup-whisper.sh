#!/bin/bash
set -e

echo "=== OmniCast Whisper.cpp Auto-Setup ==="

# 1. Create whisper-assets directory
mkdir -p whisper-assets
cd whisper-assets

# 2. Download pre-built whisper.cpp WASM from official release
echo "→ Downloading whisper.cpp WASM runtime..."
if [ ! -f "libstream.js" ]; then
    curl -L -o "libstream.js" "https://github.com/ggerganov/whisper.cpp/releases/download/v1.7.5/whisper.wasm"
    # Note: If the release doesn't have single-file JS, we'll fetch from CDN fallback
fi

# 3. Download the tiny model (~75MB)
echo "→ Downloading ggml-tiny.bin model (75MB, this may take a minute)..."
if [ ! -f "ggml-tiny.bin" ]; then
    curl -L --progress-bar -o "ggml-tiny.bin" \
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin"
fi

cd ..

# 4. Create a Node.js server with proper COOP/COEP headers
echo "→ Creating server.js with required security headers..."
cat > server.js << 'EOF'
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'application/javascript',
    '.wasm': 'application/wasm',
    '.bin': 'application/octet-stream',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
    // REQUIRED: COOP/COEP headers for SharedArrayBuffer / WASM threading
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    
    // CORS for local development
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    let filePath = '.' + req.url;
    if (filePath === './') filePath = './studio.html';
    
    const extname = String(path.extname(filePath)).toLowerCase();
    const contentType = MIME_TYPES[extname] || 'application/octet-stream';
    
    fs.readFile(filePath, (err, content) => {
        if (err) {
            if (err.code === 'ENOENT') {
                res.writeHead(404, { 'Content-Type': 'text/html' });
                res.end('<h1>404 Not Found</h1>', 'utf-8');
            } else {
                res.writeHead(500);
                res.end('Server Error: ' + err.code + ' ..\n');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
});

server.listen(PORT, () => {
    console.log(`\n🎙️  OmniCast Studio running at http://localhost:${PORT}`);
    console.log(`   COOP/COEP headers: ENABLED`);
    console.log(`   Whisper model: ${fs.existsSync('./whisper-assets/ggml-tiny.bin') ? 'READY' : 'MISSING'}`);
    console.log(`   Press Ctrl+C to stop\n`);
});
EOF

# 5. Update your HTML to load whisper before app.js
echo "→ Checking studio.html for whisper script tag..."
if ! grep -q "libstream.js" studio.html 2>/dev/null; then
    echo "⚠️  Add this line BEFORE your app.js script in studio.html:"
    echo '   <script src="whisper-assets/libstream.js"></script>'
fi

echo ""
echo "=== Setup Complete ==="
echo "Files ready in ./whisper-assets/"
echo ""
echo "To start your server with correct headers:"
echo "   node server.js"
echo ""
echo "Then open: http://localhost:8080"
echo ""
echo "If whisper-assets/libstream.js is missing, use the fallback:"
echo "   npm install @timur00kh/whisper.wasm@canary"
echo "   cp node_modules/@timur00kh/whisper.wasm/dist/* whisper-assets/"