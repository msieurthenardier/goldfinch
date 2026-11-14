'use strict';
// Loopback fixture server for the page-containment probe rig and product harness.
// Serves ./pages as static files plus three small dynamic routes. Nothing here
// carries a payload: pages only measure what the browser's own isolation allows.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PAGES = path.join(__dirname, 'pages');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

/**
 * @param {number} port 0 = ephemeral
 * @returns {Promise<{ port: number, log: any[], close: () => Promise<void> }>}
 */
function startServer(port = 0) {
  const log = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    log.push({ path: url.pathname, host: req.headers.host, authorization: req.headers.authorization ? 'present' : 'absent' });
    if (url.pathname === '/redir') {
      // Server redirect to a URL carrying userinfo (Q4).
      res.writeHead(302, { Location: `http://probeuser:probepass@${req.headers.host}/userinfo-target.html` });
      res.end();
      return;
    }
    const name = url.pathname === '/' ? 'benign.html' : url.pathname.slice(1);
    if (!/^[\w.-]+$/.test(name)) {
      res.writeHead(404).end();
      return;
    }
    const file = path.join(PAGES, name);
    fs.readFile(file, (err, buf) => {
      if (err) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(name)] || 'text/plain', 'Cache-Control': 'no-store' });
      res.end(buf);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve({
        port: /** @type {any} */ (server.address()).port,
        log,
        close: () => new Promise((r) => server.close(() => r()))
      });
    });
  });
}

module.exports = { startServer };
if (require.main === module) {
  const p = Number(process.argv[2] || 8231);
  startServer(p).then((s) => console.log('FIXTURE listening on 127.0.0.1:' + s.port));
}
