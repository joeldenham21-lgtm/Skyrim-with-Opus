#!/usr/bin/env node
/**
 * WYRMHOLD — zero-dependency static server.
 *
 * ES modules can't be loaded over file://, so the game needs to be served.
 * This has no npm dependencies at all: `node serve.js` and you're playing.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(url.parse(req.url).pathname);
  } catch {
    res.writeHead(400); return res.end('Bad request');
  }
  if (pathname === '/') pathname = '/index.html';

  // Resolve inside ROOT only — no path traversal.
  const filePath = path.join(ROOT, path.normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); return res.end('Forbidden');
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found: ' + pathname);
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': stat.size,
      // Vendored engine is immutable; game source should always be fresh.
      'Cache-Control': filePath.includes(path.sep + 'vendor' + path.sep)
        ? 'public, max-age=604800'
        : 'no-cache',
    };
    res.writeHead(200, headers);
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log('');
  console.log('  \x1b[33m⚔  WYRMHOLD\x1b[0m — Crown of the North');
  console.log('');
  console.log(`  Play at:  \x1b[36mhttp://${shown}:${PORT}/\x1b[0m`);
  console.log('  Stop with Ctrl+C');
  console.log('');
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is busy. Try:  PORT=8081 node serve.js\n`);
    process.exit(1);
  }
  throw e;
});
