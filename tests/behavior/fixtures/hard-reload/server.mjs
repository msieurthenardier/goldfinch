// Fixture server for tests/behavior/hard-reload.md (Sortie 03). Zero deps.
//   GET /index.html -> no-store; sets window.__loadId (per-response counter), loads /asset.js?n=<nonce>
//   GET /asset.js   -> Cache-Control: max-age=3600 (cacheable); counted in `asset`
//   GET /hits       -> { asset, last: { cacheControl, pragma } } (last asset.js request headers, lowercased)
//   GET /reset      -> zero the counters and mint a new nonce (a persisted HTTP cache never leaks across runs)
import http from 'node:http';

const HOST = '127.0.0.1';
const PORT = 8766;

let nonce = Date.now().toString(36);
let loadId = 0;
let asset = 0;
let last = { cacheControl: null, pragma: null };

const json = (res, body) => {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  if (url.pathname === '/index.html' || url.pathname === '/') {
    loadId += 1;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(
      `<!doctype html><meta charset="utf-8"><title>hard-reload fixture</title>` +
        `<script>window.__loadId = ${loadId};</script>` +
        `<script src="/asset.js?n=${nonce}"></script><h1>hard-reload fixture</h1>`
    );
  } else if (url.pathname === '/asset.js') {
    asset += 1;
    last = {
      cacheControl: req.headers['cache-control'] ?? null,
      pragma: req.headers['pragma'] ?? null
    };
    res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'max-age=3600' });
    res.end('window.__assetRan = (window.__assetRan || 0) + 1;');
  } else if (url.pathname === '/hits') {
    json(res, { asset, last });
  } else if (url.pathname === '/reset') {
    asset = 0;
    loadId = 0;
    last = { cacheControl: null, pragma: null };
    nonce = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    json(res, { ok: true, nonce });
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`hard-reload fixture listening on http://${HOST}:${PORT}`);
});
