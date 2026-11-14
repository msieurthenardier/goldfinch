#!/usr/bin/env node
// Zero-dependency fixture server for the download-true-type behavior test.
//
// Routes:
//   /                          a page that sets a per-jar cookie (`gfdtt`) when the request lacks one
//                              and links the two files below
//   /dl/<prefix>-report.pdf    a small inert placeholder served as an attachment
//   /dl/<prefix>-flaky.bin     an attachment that is CUT SHORT on every request while the break switch
//                              is on (a declared length larger than the bytes sent, then the socket is
//                              destroyed) and served whole when it is off
//   /break  /heal              the switch (initially off)
// Every request is appended to the log as one JSON line with its path and the names plus short
// fingerprints of the cookies it carried (never the values), so a runner can tell which session made it.
// Payloads are inert placeholder bytes. <prefix> is run-unique so saved files cannot collide with the
// operator's own files in the real Downloads folder.
//
// Usage: node serve.mjs [--port 8261] --log <path> [--prefix gf-dtt-<run>]

import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';

function parseArgs(argv) {
  const args = { port: 8261, log: null, prefix: `gf-dtt-${crypto.randomBytes(3).toString('hex')}` };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') args.port = Number(argv[++i]);
    else if (argv[i] === '--log') args.log = argv[++i];
    else if (argv[i] === '--prefix') args.prefix = argv[++i];
  }
  if (!args.port || !args.log || !/^[A-Za-z0-9._-]{1,64}$/.test(args.prefix)) {
    console.error('Usage: node serve.mjs [--port <port>] --log <path> [--prefix <run-unique-prefix>]');
    process.exit(1);
  }
  return args;
}

const { port, log: logPath, prefix } = parseArgs(process.argv.slice(2));
fs.writeFileSync(logPath, '');

const REPORT_PATH = `/dl/${prefix}-report.pdf`;
const FLAKY_PATH = `/dl/${prefix}-flaky.bin`;
const FLAKY_LENGTH = 4096;
const FLAKY_SENT_WHEN_BROKEN = 1024;
let broken = false;

const REPORT = Buffer.from('%PDF-1.1\n% inert placeholder for the download-true-type fixture\n%%EOF\n', 'latin1');
const FLAKY = Buffer.alloc(FLAKY_LENGTH, 0x2e);

const fingerprint = (value) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 8);

function parseCookies(header) {
  if (!header) return [];
  return header
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf('=');
      const name = eq === -1 ? part : part.slice(0, eq);
      const value = eq === -1 ? '' : part.slice(eq + 1);
      return { name, fp: fingerprint(value) };
    });
}

function appendLog(entry) {
  fs.appendFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const cookies = parseCookies(req.headers['cookie']);
  const base = { path: pathname, cookies };

  if (pathname === '/') {
    let setCookie = null;
    if (!cookies.some((c) => c.name === 'gfdtt')) {
      const value = crypto.randomUUID();
      setCookie = { name: 'gfdtt', fp: fingerprint(value) };
      res.setHeader('Set-Cookie', `gfdtt=${value}; Path=/`);
    }
    appendLog({ ...base, setCookie });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(`<!doctype html>
<html>
<head><meta charset="utf-8"><title>download-true-type fixture</title></head>
<body>
  <p><a href="${REPORT_PATH}">report</a></p>
  <p><a href="${FLAKY_PATH}">flaky</a></p>
</body>
</html>
`);
    return;
  }

  if (pathname === '/break' || pathname === '/heal') {
    broken = pathname === '/break';
    appendLog({ ...base, broken });
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(broken ? 'broken' : 'healed');
    return;
  }

  if (pathname === REPORT_PATH) {
    appendLog(base);
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${prefix}-report.pdf"`,
      'Content-Length': REPORT.length,
      'Cache-Control': 'no-store'
    });
    res.end(REPORT);
    return;
  }

  if (pathname === FLAKY_PATH) {
    appendLog({ ...base, broken });
    const headers = {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${prefix}-flaky.bin"`,
      'Content-Length': FLAKY_LENGTH,
      'Cache-Control': 'no-store'
    };
    if (!broken) {
      res.writeHead(200, headers);
      res.end(FLAKY);
      return;
    }
    // Declared length larger than the bytes sent, then the socket is destroyed.
    res.writeHead(200, headers);
    res.write(FLAKY.subarray(0, FLAKY_SENT_WHEN_BROKEN), () => {
      setTimeout(() => req.socket.destroy(), 50);
    });
    return;
  }

  appendLog(base);
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`download-true-type fixture listening on http://127.0.0.1:${port} prefix=${prefix}`);
});
