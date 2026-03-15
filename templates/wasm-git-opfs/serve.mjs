import http from 'http';
import fs from 'fs';
import path from 'path';

const PORT = process.env.WEB_APP_PORT || 8080;
const GIT_SERVER_PORT = process.env.GIT_SERVER_PORT || 3000;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.wasm': 'application/wasm',
    '.css': 'text/css',
    '.json': 'application/json',
    '.txt': 'text/plain',
};

function proxyToGit(req, res) {
    const proxyReq = http.request({
        hostname: 'localhost',
        port: GIT_SERVER_PORT,
        path: req.url,
        method: req.method,
        headers: req.headers,
    }, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res);
    });
    proxyReq.on('error', (err) => {
        res.writeHead(502);
        res.end('Git server error: ' + err.message);
    });
    req.pipe(proxyReq);
}

http.createServer((req, res) => {
    // Required for SharedArrayBuffer (wasm-git pthreads)
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');

    const urlPath = (req.url || '/').split('?')[0];

    // Health check
    if (urlPath === '/ping') {
        res.writeHead(200);
        res.end('pong');
        return;
    }

    // Proxy git smart-HTTP requests to git server
    if (/\.git\//.test(urlPath)) {
        proxyToGit(req, res);
        return;
    }

    const filePath = urlPath === '/'
        ? path.join('public', 'index.html')
        : path.join('public', urlPath);

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not found: ' + urlPath);
            return;
        }
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
    });
}).listen(PORT, () => console.log(`App server running at http://localhost:${PORT}/`));
