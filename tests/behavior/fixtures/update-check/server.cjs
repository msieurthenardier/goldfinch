'use strict';
// Loopback fixture for the `update-notice` behavior spec (Mission 23 Flight 3). Stands in for the
// release endpoint: the browser is launched with GOLDFINCH_UPDATE_CHECK_URL=http://127.0.0.1:<port>/latest
// and this server answers according to a mode set by a control request. Nothing here contacts an
// outside host. CommonJS, no dependency.
//
//   node tests/behavior/fixtures/update-check/server.cjs [--port 8237] [--redirect-port 8238]
//
// Answer path:    GET /latest                       (any other non-control path: 404)
// Control paths:  GET /__mode?m=<mode>   set the mode (higher|equal|lower|prerelease|malformed|
//                                         not-json|redirect|http-500|oversize); answers {"mode":…}
//                 GET /__log             JSON {log, redirectLog, mode}: every request seen, in order
//                 GET /__reset           empty both logs (the mode is kept); answers {"ok":true}
// Control requests are not logged. The redirect mode answers 302 to the SECOND port this fixture
// also owns (`/redirect-target`), whose own log is `redirectLog` — a followed redirect would show there.
// Versions are computed from package.json, so the spec never hard-codes one.

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const MODES = ['higher', 'equal', 'lower', 'prerelease', 'malformed', 'not-json', 'redirect', 'http-500', 'oversize'];

function argValue(name, fallback) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
}

const PORT = argValue('--port', Number(process.env.UPDATE_FIXTURE_PORT) || 8237);
const REDIRECT_PORT = argValue('--redirect-port', Number(process.env.UPDATE_FIXTURE_REDIRECT_PORT) || 8238);

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../../package.json'), 'utf8'));
const [MAJ, MIN, PAT] = String(pkg.version)
  .split('-')[0]
  .split('.')
  .map((n) => Number(n));

const higher = `${MAJ}.${MIN}.${PAT + 1}`;
const lower = PAT > 0 ? `${MAJ}.${MIN}.${PAT - 1}` : MIN > 0 ? `${MAJ}.${MIN - 1}.0` : `${Math.max(0, MAJ - 1)}.0.0`;

let mode = 'higher';
const log = [];
const redirectLog = [];

function record(into, req) {
  into.push({ method: req.method, path: req.url, headers: { ...req.headers }, at: new Date().toISOString() });
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const main = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__mode') {
    const m = url.searchParams.get('m');
    if (!MODES.includes(m)) return json(res, 400, { error: 'unknown mode', modes: MODES });
    mode = m;
    return json(res, 200, { mode, higher, lower, current: pkg.version });
  }
  if (url.pathname === '/__log') return json(res, 200, { log, redirectLog, mode });
  if (url.pathname === '/__reset') {
    log.length = 0;
    redirectLog.length = 0;
    return json(res, 200, { ok: true });
  }
  record(log, req);
  if (url.pathname !== '/latest') return json(res, 404, { error: 'not found' });
  switch (mode) {
    case 'higher':
      return json(res, 200, { tag_name: `v${higher}` });
    case 'equal':
      return json(res, 200, { tag_name: `v${pkg.version}` });
    case 'lower':
      return json(res, 200, { tag_name: `v${lower}` });
    case 'prerelease':
      return json(res, 200, { tag_name: `v${higher}-rc.1` });
    case 'malformed':
      return json(res, 200, { tag_name: higher });
    case 'not-json':
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end('this is not json');
    case 'redirect':
      res.writeHead(302, { Location: `http://127.0.0.1:${REDIRECT_PORT}/redirect-target` });
      return res.end();
    case 'http-500':
      return json(res, 500, { message: 'boom' });
    case 'oversize':
      return json(res, 200, JSON.stringify({ tag_name: `v${higher}`, pad: 'x'.repeat(2 * 1024 * 1024) }));
    default:
      return json(res, 500, {});
  }
});

const target = http.createServer((req, res) => {
  record(redirectLog, req);
  json(res, 200, { tag_name: `v${higher}` });
});

main.listen(PORT, '127.0.0.1', () => {
  target.listen(REDIRECT_PORT, '127.0.0.1', () => {
    console.log(`update-check fixture: answer http://127.0.0.1:${PORT}/latest, redirect target ${REDIRECT_PORT}, higher=${higher} lower=${lower}`);
  });
});

function shutdown() {
  main.close();
  target.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
