#!/usr/bin/env node
// Zero-dependency TLS fixture for the third-party-cookie-isolation behavior
// spec (sortie 02 DD9). ONE port serves three distinct SITES, routed by the
// request's Host header (port stripped):
//   A = 127.0.0.1   B = localhost   C = 127.0.0.2
// (different registrable "sites" to Chromium, one listener). Listens on the
// dual-stack wildcard (`::`, falling back to 0.0.0.0) so 127.0.0.2 is
// reachable and `localhost` works on either IP family.
//
// Usage: node gen-certs.mjs && node serve.mjs --port <port> [--log <path>]
// Every cookie carries Max-Age=3600. The JSONL log holds cookie NAMES only,
// NEVER values: { ts, host, path, search, cookieNames, setCookieNames }.

import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const MAX_AGE = 'Max-Age=3600';

function parseArgs(argv) {
  const args = { port: null, log: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') args.port = Number(argv[++i]);
    else if (argv[i] === '--log') args.log = argv[++i];
  }
  if (!args.port) {
    console.error('Usage: node serve.mjs --port <port> [--log <path>]');
    process.exit(1);
  }
  return args;
}
const { port, log: logPath } = parseArgs(process.argv.slice(2));

if (logPath) fs.writeFileSync(logPath, '');
function appendLog(entry) {
  if (logPath) fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
}

function readCert(name) {
  try {
    return fs.readFileSync(path.join(here, 'certs', name));
  } catch {
    console.error(`serve: missing certs/${name} — run \`node gen-certs.mjs\` in ${here} first.`);
    process.exit(1);
  }
}

const A = '127.0.0.1';
const B = 'localhost';
const C = '127.0.0.2';
const origin = (host) => `https://${host}:${port}`;

const names = (cookieHeader) =>
  (cookieHeader || '')
    .split(';')
    .map((p) => p.split('=')[0].trim())
    .filter(Boolean);
const setNames = (lines) => lines.map((l) => l.split('=')[0].trim());

const page = (title, body, script = '') =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body>${body}${script ? `<script>${script}</script>` : ''}`;

// Embedder (sites A and C): hosts the claude-shaped sandboxed B frame and the
// UNSANDBOXED sa-frame, and renders relayed iframe reports into #frame-report.
function embedPage(label, frameQuery) {
  const frameSrc = `${origin(B)}/b/frame${frameQuery}`;
  const saSrc = `${origin(B)}/b/sa-frame`;
  return page(
    `${label} embed`,
    `<h1 id="who">${label} embed</h1>
<iframe id="claude-frame" src="${frameSrc}" sandbox="allow-scripts allow-same-origin" width="400" height="80"></iframe><br>
<iframe id="sa-frame" src="${saSrc}" width="400" height="80"></iframe>
<pre id="frame-report" data-ready="0">{}</pre>`,
    `window.frameReport = {};
window.addEventListener('message', (e) => {
  if (e.origin !== ${JSON.stringify(origin(B))} || !e.data || typeof e.data !== 'object') return;
  Object.assign(window.frameReport, e.data);
  const el = document.getElementById('frame-report');
  el.textContent = JSON.stringify(window.frameReport);
  el.dataset.ready = '1';
});`
  );
}

const FRAME_SCRIPT = `
const post = (m) => parent.postMessage(m, '*');
const readNames = () => document.cookie.split(';').map((p) => p.split('=')[0].trim()).filter(Boolean).sort();
const q = new URLSearchParams(location.search);
const reportOnly = q.has('report-only');
const partOnly = q.has('part-only');
const writes = {};
if (!reportOnly) {
  if (!partOnly) document.cookie = 'js_unpart=1; SameSite=None; Secure; ${MAX_AGE}';
  document.cookie = 'js_part=1; SameSite=None; Secure; Partitioned; ${MAX_AGE}';
}
const cookieNames = readNames();
writes.js_unpart = cookieNames.includes('js_unpart');
writes.js_part = cookieNames.includes('js_part');
post({ cookieNames, writes: reportOnly ? {} : writes });
`;

const SA_SCRIPT = `
const post = (m) => parent.postMessage(m, '*');
document.getElementById('sa').addEventListener('click', async () => {
  let storageAccess;
  try {
    await document.requestStorageAccess();
    storageAccess = 'granted';
  } catch (err) {
    storageAccess = 'rejected:' + (err && err.name);
  }
  let hasStorageAccess = null;
  try {
    hasStorageAccess = await document.hasStorageAccess();
  } catch {}
  post({ storageAccess, hasStorageAccess });
});
`;

const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

function route(req, res, host, url) {
  /** @type {string[]} */
  const setCookies = [];
  const send = (status, type, body, extra = {}) => {
    res.writeHead(status, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      ...(setCookies.length ? { 'Set-Cookie': setCookies } : {}),
      ...extra
    });
    res.end(body);
    return setCookies;
  };
  const p = url.pathname;
  if (p === '/health') return send(200, 'text/plain', 'ok');

  if (p === '/b/set-fp') {
    setCookies.push(`b_fp=1; SameSite=None; Secure; Path=/; ${MAX_AGE}`);
    return send(200, 'text/html', page('B set-fp', '<h1 id="who">B first-party cookie set</h1>'));
  }
  if (p === '/a/set-fp') {
    setCookies.push(
      `a_none=1; SameSite=None; Secure; Path=/; ${MAX_AGE}`,
      `a_lax=1; SameSite=Lax; Path=/; ${MAX_AGE}`,
      `a_strict=1; SameSite=Strict; Path=/; ${MAX_AGE}`
    );
    return send(200, 'text/html', page('A set-fp', '<h1 id="who">A first-party cookies set</h1>'));
  }
  if (p === '/a/embed') {
    const q = url.searchParams.get('b') === 'part-only' ? '?part-only=1' : '';
    return send(200, 'text/html', embedPage('A', q));
  }
  if (p === '/c/embed') {
    return send(200, 'text/html', embedPage('C', '?report-only=1'));
  }
  if (p === '/b/frame') {
    const reportOnly = url.searchParams.has('report-only');
    const partOnly = url.searchParams.has('part-only');
    if (!reportOnly) {
      if (!partOnly) setCookies.push(`b_3p_unpart=1; SameSite=None; Secure; Path=/; ${MAX_AGE}`);
      setCookies.push(`__Host-b_part=1; Secure; Path=/; SameSite=None; Partitioned; ${MAX_AGE}`);
    }
    return send(200, 'text/html', page('B frame', '<p>claude-shaped B frame</p>', FRAME_SCRIPT));
  }
  if (p === '/b/sa-frame') {
    return send(
      200,
      'text/html',
      page(
        'B sa-frame',
        '<button id="sa" style="width:280px;height:40px;font-size:16px;position:absolute;left:10px;top:10px">Request storage access</button>',
        SA_SCRIPT
      )
    );
  }
  if (p === '/b/pixel') return send(200, 'image/gif', GIF);
  if (p === '/b/api') {
    const o = req.headers.origin;
    return send(
      200,
      'application/json',
      JSON.stringify({ ok: true }),
      o ? { 'Access-Control-Allow-Origin': o, 'Access-Control-Allow-Credentials': 'true', Vary: 'Origin' } : {}
    );
  }
  return send(404, 'text/plain', 'not found');
}

const server = https.createServer({ key: readCert('server-key.pem'), cert: readCert('server.pem') }, (req, res) => {
  const host = (req.headers.host || '').replace(/:\d+$/, '');
  const url = new URL(req.url || '/', 'https://fixture.invalid');
  let setCookies = [];
  try {
    setCookies = route(req, res, host, url) || [];
  } catch (err) {
    res.writeHead(500).end('error');
    console.error('serve: handler error', err);
  }
  appendLog({
    ts: Date.now(),
    host,
    path: url.pathname,
    search: url.search,
    cookieNames: names(req.headers.cookie),
    setCookieNames: setNames(setCookies)
  });
});

server.on('error', (err) => {
  if (err.code === 'EAFNOSUPPORT' || err.code === 'EADDRNOTAVAIL') {
    server.listen({ port, host: '0.0.0.0' });
  } else {
    console.error('serve:', err.message);
    process.exit(1);
  }
});
server.on('listening', () => {
  const a = server.address();
  console.log(
    `third-party-cookies fixture listening on ${a.address}:${a.port} — A=${origin(A)} B=${origin(B)} C=${origin(C)}`
  );
});
server.listen({ port, host: '::', ipv6Only: false });
