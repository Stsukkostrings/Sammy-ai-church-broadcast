const http = require('http');
const fs = require('fs');
const path = require('path');
const { authHandler, callbackHandler, channelHandler } = require('./api/_youtubeCore');
const { spiritFlowConfigHandler, spiritFlowNowPlayingHandler } = require('./api/_spiritFlowCore');
const commentsList = require('./api/youtube-comments-list');
const commentsSync = require('./api/youtube-comments-sync');
const commentsGenerate = require('./api/youtube-comments-generate');
const commentsPublish = require('./api/youtube-comments-publish');
const aiGenerate = require('./api/ai-generate');
const accountGoogle = require('./api/auth/google');
const accountCallback = require('./api/auth/callback');
const accountSession = require('./api/auth/session');
const accountLogout = require('./api/auth/logout');
const youtubeChannels = require('./api/youtube-channels');
const youtubeChannelSelect = require('./api/youtube-channel-select');
const userSettings = require('./api/user-settings');
const overlayChannel = require('./api/overlay-channel');
const overlayPublish = require('./api/overlay-publish');
const overlayPublic = require('./api/overlay-public');
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

function createApiResponse(res) {
    const response = {
        setHeader(name, value) { res.setHeader(name, value); return response; },
        status(code) { res.statusCode = code; return response; },
        json(body) {
            if (!res.hasHeader('Content-Type')) res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(body));
            return response;
        },
        send(body = '') { res.end(body); return response; },
        end(body) { res.end(body); return response; }
    };
    return response;
}

function sendNotFound(res) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h1>404</h1>');
}

const server = http.createServer(async (req, res) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    try {
        const requestUrl = new URL(req.url, 'http://localhost');
        const pathname = requestUrl.pathname;
        const apiRes = createApiResponse(res);

        if (pathname === '/api/auth/google') return await accountGoogle(req, apiRes);
        if (pathname === '/api/auth/callback') return await accountCallback(req, apiRes);
        if (pathname === '/api/auth/session') return await accountSession(req, apiRes);
        if (pathname === '/api/auth/logout') return await accountLogout(req, apiRes);
        if (pathname === '/api/youtube-channels') return await youtubeChannels(req, apiRes);
        if (pathname === '/api/youtube-channel-select') return await youtubeChannelSelect(req, apiRes);
        if (pathname === '/api/user-settings') return await userSettings(req, apiRes);
        if (pathname === '/api/overlay-channel') return await overlayChannel(req, apiRes);
        if (pathname === '/api/overlay-publish') return await overlayPublish(req, apiRes);
        if (pathname === '/api/overlay-public') return await overlayPublic(req, apiRes);
        if (pathname === '/api/youtube-auth') {
            return sendServerlessResult(res, await authHandler(req));
        }
        if (pathname === '/api/youtube-callback') {
            return sendServerlessResult(res, await callbackHandler(req));
        }
        if (pathname === '/api/youtube-channel') {
            return sendServerlessResult(res, await channelHandler(req));
        }
        if (pathname === '/api/youtube-comments-list') {
            return await commentsList(req, apiRes);
        }
        if (pathname === '/api/youtube-comments-sync') {
            return await commentsSync(req, apiRes);
        }
        if (pathname === '/api/youtube-comments-generate') {
            return await commentsGenerate(req, apiRes);
        }
        if (pathname === '/api/youtube-comments-publish') {
            return await commentsPublish(req, apiRes);
        }
        if (pathname === '/api/youtube-comments' || pathname.startsWith('/api/youtube-comments/')) {
            const { commentsApiHandler } = require('./api/_youtubeCommentsCore');
            const result = await commentsApiHandler(req);
            Object.entries(result.headers || {}).forEach(([key, value]) => res.setHeader(key, value));
            res.writeHead(result.statusCode);
            res.end(result.body || '');
            return;
        }
        if (pathname === '/api/ai-generate') {
            return await aiGenerate(req, apiRes);
        }
        if (pathname === '/api/spiritflow-config') {
            return sendServerlessResult(res, spiritFlowConfigHandler());
        }
        if (pathname === '/api/spiritflow/nowplaying') {
            return sendServerlessResult(res, await spiritFlowNowPlayingHandler());
        }
        if (pathname.startsWith('/api/')) return sendNotFound(res);
    } catch (error) {
        if (res.headersSent) return res.destroy(error);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: error.message || 'Server error' }));
        return;
    }

    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch (_) { return sendNotFound(res); }
    if (pathname === '/') pathname = '/index.html';
    const relativePath = pathname.replace(/^[/\\]+/, '');
    const pathParts = relativePath.split(/[\\/]+/);
    const privateDirectories = new Set(['api', 'lib', 'db', 'test', 'netlify', 'node_modules', '.git', '.vercel']);
    const privateFiles = new Set(['server.js', 'package.json', 'package-lock.json', 'vercel.json', '.gitignore', '.vercelignore', 'netlify.toml']);
    if (pathParts.some(part => !part || part === '.' || part === '..' || part.startsWith('.') || privateDirectories.has(part.toLowerCase()))
        || privateFiles.has(pathParts[pathParts.length - 1].toLowerCase())) return sendNotFound(res);

    const siteRoot = path.resolve(__dirname);
    const filePath = path.resolve(siteRoot, relativePath);
    const relativeCheck = path.relative(siteRoot, filePath);
    if (relativeCheck.startsWith('..') || path.isAbsolute(relativeCheck)) return sendNotFound(res);

    const ext = String(path.extname(filePath)).toLowerCase();
    const ct = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(err.code === 'ENOENT' || err.code === 'EISDIR' ? 404 : 500, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(err.code === 'ENOENT' || err.code === 'EISDIR' ? '<h1>404</h1>' : 'Server Error');
        } else {
            res.writeHead(200, { 'Content-Type': ct });
            res.end(content);
        }
    });
});

server.listen(PORT, () => {
    console.log('\n🎙️  OmniCast running at http://localhost:' + PORT);
    console.log('   Headers: COOP enabled\n');
});
