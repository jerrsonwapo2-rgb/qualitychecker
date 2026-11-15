// Streaming Quality Checker - zero-dependency speed test server
// Run: node server.js   (then open http://localhost:3000)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MAX_DOWNLOAD = 200 * 1024 * 1024; // 200 MB per request
const MAX_UPLOAD = 100 * 1024 * 1024;   // 100 MB per request
const CHUNK = crypto.randomBytes(1024 * 1024); // incompressible 1 MB block
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

const NO_CACHE = { 'Cache-Control': 'no-store, no-cache, must-revalidate', 'Pragma': 'no-cache' };

function sendBytes(res, total) {
  res.writeHead(200, { ...NO_CACHE, 'Content-Type': 'application/octet-stream', 'Content-Length': total, 'Content-Encoding': 'identity' });
  let left = total, dead = false;
  res.on('close', () => { dead = true; });
  (function pump() {
    while (left > 0 && !dead) {
      const len = Math.min(left, CHUNK.length);
      const ok = res.write(len === CHUNK.length ? CHUNK : CHUNK.subarray(0, len));
      left -= len;
      if (!ok) { res.once('drain', pump); return; }
    }
    if (!dead) res.end();
  })();
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p === '/api/ping') {            // tiny response for latency / jitter
    res.writeHead(204, NO_CACHE);
    return res.end();
  }
  if (p === '/api/download') {        // streams N random bytes
    const n = Math.min(Math.max(parseInt(url.searchParams.get('bytes'), 10) || 1048576, 1), MAX_DOWNLOAD);
    return sendBytes(res, n);
  }
  if (p === '/api/upload' && req.method === 'POST') { // reads and discards body
    let got = 0;
    req.on('data', (c) => {
      got += c.length;
      if (got > MAX_UPLOAD) { req.destroy(); }
    });
    req.on('end', () => {
      res.writeHead(200, { ...NO_CACHE, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ received: got }));
    });
    req.on('error', () => {});
    return;
  }
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, p);
  res.writeHead(405); res.end();
}).listen(PORT, () => {
  const url = 'http://localhost:' + PORT;
  console.log('Streaming Quality Checker running at ' + url);
  console.log('Keep this window open. Press Ctrl+C to stop.');
  if (process.argv.includes('--open')) {          // optional: open the browser automatically
    const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    try { require('child_process').spawn(cmd, args, { stdio: 'ignore', detached: true }).on('error', () => {}).unref(); } catch (e) {}
  }
}).on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error('Port ' + PORT + ' is already in use. Close the other copy, or use another port, e.g.  PORT=8080 node server.js');
  else console.error(e.message);
  process.exit(1);
});