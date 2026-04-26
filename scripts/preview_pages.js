#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const path = require('path');

const SITE_ROOT = path.resolve(__dirname, '..', 'site');

function createPagesPreviewServer(options = {}) {
    const rootDir = path.resolve(options.rootDir || SITE_ROOT);

    return http.createServer((req, res) => {
        const requestUrl = new URL(req.url || '/', 'http://127.0.0.1');
        const resolvedPath = resolveSiteFilePath(requestUrl.pathname, rootDir);
        if (resolvedPath === null) {
            res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Forbidden');
            return;
        }

        let filePath = resolvedPath;
        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
            filePath = path.join(filePath, 'index.html');
        }

        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not Found');
            return;
        }

        res.writeHead(200, {
            'Content-Type': getContentType(filePath),
            'Cache-Control': 'no-store'
        });
        fs.createReadStream(filePath).pipe(res);
    });
}

function resolveSiteFilePath(requestPath, rootDir = SITE_ROOT) {
    const safePath = decodeURIComponent(requestPath || '/');
    const candidatePath = safePath === '/'
        ? path.join(rootDir, 'index.html')
        : path.join(rootDir, safePath.replace(/^\/+/, ''));
    const resolvedPath = path.resolve(candidatePath);

    if (resolvedPath !== rootDir && !resolvedPath.startsWith(`${rootDir}${path.sep}`)) {
        return null;
    }

    return resolvedPath;
}

function getContentType(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    switch (extension) {
        case '.html':
            return 'text/html; charset=utf-8';
        case '.css':
            return 'text/css; charset=utf-8';
        case '.js':
            return 'application/javascript; charset=utf-8';
        case '.svg':
            return 'image/svg+xml';
        case '.png':
            return 'image/png';
        case '.jpg':
        case '.jpeg':
            return 'image/jpeg';
        case '.webp':
            return 'image/webp';
        default:
            return 'application/octet-stream';
    }
}

if (require.main === module) {
    const port = Number.parseInt(process.env.NIYAM_PAGES_PORT || '4180', 10);
    const server = createPagesPreviewServer();
    server.listen(port, '127.0.0.1', () => {
        process.stdout.write(`Niyam Pages preview: http://127.0.0.1:${port}\n`);
    });
}

module.exports = {
    createPagesPreviewServer,
    getContentType,
    resolveSiteFilePath,
    SITE_ROOT
};
