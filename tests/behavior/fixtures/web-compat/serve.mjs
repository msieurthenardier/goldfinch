#!/usr/bin/env node
// Zero-dependency fixture server for the Mission 14 web-compat behavior tests.
//
// This server (F1 L1 html-fullscreen + F1 L2 auth-challenges) serves:
//   GET /video.html — a page with an embedded <video>, a visible
//                     "Enter fullscreen" button calling video.requestFullscreen(),
//                     and a #fs-state element kept live by a fullscreenchange
//                     listener (the spec's observability seam).
//   GET /media.wav  — the video element's source, generated in memory at boot
//                     (WAV sine precedent from cross-jar-fetch; decoded video
//                     frames are not required for fullscreen mechanics).
//   GET /protected  — HTTP basic auth (F1 L2): 401 `WWW-Authenticate: Basic
//                     realm="fixture"` until a valid Authorization for
//                     fixtureuser/fixturepass arrives; then 200 HTML echoing the
//                     USERNAME ONLY. The JSONL log records Authorization
//                     PRESENCE/validity/match — never the header value itself
//                     (the log is committed-spec-adjacent evidence).
//   GET /doc.pdf    — (F1 L4) generated 3-page PDF, served inline
//                     (Content-Disposition: inline) — the pdf-inline spec's
//                     viewer-render + no-auto-download subject.
//   GET /doc-attachment.pdf — the SAME PDF bytes with
//                     `Content-Disposition: attachment` — must download, never
//                     render.
//   GET /redirect-302 — (F1 L4, mission-13 tab-scheme-guard carry-forward)
//                     302 whose Location is `?to=<url>` when given, defaulting
//                     to the PINNED cross-scheme target
//                     `data:text/html,redirected` (refused by isSafeTabUrl —
//                     exactly what the deferred spec re-run needs).
//
// Usage: node serve.mjs --port <port> [--log <path>]
// (--log is optional here, unlike the cross-jar-fetch precedent: the
// fullscreen spec asserts nothing about request arrival. The JSONL log format
// matches that precedent so the auth leg can rely on it.)

import http from 'node:http';
import fs from 'node:fs';

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

// Truncate the log at boot so each run starts from a clean slate (only when
// logging was requested).
if (logPath) fs.writeFileSync(logPath, '');

function appendLog(entry) {
  if (logPath) fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
}

// --- Fixture assets, generated in-memory at boot (no committed binaries) ---

function buildWavSine({ seconds = 30, sampleRate = 44100, freq = 440, amplitude = 0.2 } = {}) {
  const numSamples = Math.floor(seconds * sampleRate);
  const bytesPerSample = 2; // 16-bit PCM
  const numChannels = 1;
  const dataSize = numSamples * bytesPerSample * numChannels;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF chunk descriptor
  buffer.write('RIFF', 0, 'ascii');
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8, 'ascii');

  // fmt subchunk
  buffer.write('fmt ', 12, 'ascii');
  buffer.writeUInt32LE(16, 16); // Subchunk1Size (PCM)
  buffer.writeUInt16LE(1, 20); // AudioFormat (1 = PCM)
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28); // ByteRate
  buffer.writeUInt16LE(numChannels * bytesPerSample, 32); // BlockAlign
  buffer.writeUInt16LE(16, 34); // BitsPerSample

  // data subchunk
  buffer.write('data', 36, 'ascii');
  buffer.writeUInt32LE(dataSize, 40);

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const sample = Math.sin(2 * Math.PI * freq * t) * amplitude * 32767;
    buffer.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(sample))), 44 + i * bytesPerSample);
  }

  return buffer;
}

const MEDIA_WAV = buildWavSine();

// Minimal 3-page PDF generated in memory at boot (no committed binary). Each
// page draws large, distinctive base-14 Helvetica text — page identity is
// legible in a capture and scrolling between pages is a real observable (the
// pdf-inline spec's step 3). Pure ASCII: byte offsets equal string offsets, so
// the xref table can be computed by simple accumulation.
function buildFixturePdf() {
  const pageTexts = [
    ['GOLDFINCH FIXTURE PDF', 'PAGE ONE OF THREE'],
    ['GOLDFINCH FIXTURE PDF', 'PAGE TWO OF THREE'],
    ['GOLDFINCH FIXTURE PDF', 'PAGE THREE OF THREE'],
  ];
  // Object numbering: 1 Catalog, 2 Pages, 3..8 alternating Page/Contents, 9 Font.
  const pageObjNums = [3, 5, 7];
  const objects = [];
  objects.push({ num: 1, body: '<< /Type /Catalog /Pages 2 0 R >>' });
  objects.push({
    num: 2,
    body: `<< /Type /Pages /Kids [${pageObjNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pageObjNums.length} >>`,
  });
  pageTexts.forEach((lines, i) => {
    const pageNum = pageObjNums[i];
    const contentNum = pageNum + 1;
    objects.push({
      num: pageNum,
      body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 9 0 R >> >> /Contents ${contentNum} 0 R >>`,
    });
    const stream = `BT /F1 40 Tf 60 660 Td (${lines[0]}) Tj 0 -120 Td (${lines[1]}) Tj ET`;
    objects.push({ num: contentNum, stream });
  });
  objects.push({ num: 9, body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>' });

  let out = '%PDF-1.4\n';
  const offsets = new Map();
  for (const obj of objects) {
    offsets.set(obj.num, out.length);
    if (obj.stream !== undefined) {
      out += `${obj.num} 0 obj\n<< /Length ${obj.stream.length} >>\nstream\n${obj.stream}\nendstream\nendobj\n`;
    } else {
      out += `${obj.num} 0 obj\n${obj.body}\nendobj\n`;
    }
  }
  const xrefStart = out.length;
  const maxNum = 9;
  out += `xref\n0 ${maxNum + 1}\n`;
  out += '0000000000 65535 f \n';
  for (let n = 1; n <= maxNum; n++) {
    out += `${String(offsets.get(n)).padStart(10, '0')} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${maxNum + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return Buffer.from(out, 'ascii');
}

const DOC_PDF = buildFixturePdf();

// Pinned default 302 target: cross-scheme, refused by isSafeTabUrl — the
// mission-13 tab-scheme-guard re-run depends on this exact literal.
const REDIRECT_302_DEFAULT = 'data:text/html,redirected';

const VIDEO_PAGE = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>web-compat fullscreen fixture</title>
  <style>
    body { font-family: sans-serif; margin: 16px; background: #f5f5f5; }
    video { display: block; width: 480px; height: 270px; background: #000; }
    #enter-fs { font-size: 18px; padding: 8px 16px; margin: 12px 0; }
    #fs-state { font-weight: bold; }
  </style>
</head>
<body>
  <h1>Fullscreen fixture</h1>
  <video id="vid" src="/media.wav" controls></video>
  <button id="enter-fs">Enter fullscreen</button>
  <p>Fullscreen state: <span id="fs-state">inactive</span></p>
  <script>
    const video = document.getElementById('vid');
    // Real user gesture required: requestFullscreen from a click handler.
    document.getElementById('enter-fs').addEventListener('click', () => {
      video.requestFullscreen().catch((err) => {
        document.getElementById('fs-state').textContent = 'error: ' + err.name;
      });
    });
    // The observability seam the behavior spec reads via evaluate/readDom.
    document.addEventListener('fullscreenchange', () => {
      document.getElementById('fs-state').textContent =
        document.fullscreenElement ? 'active' : 'inactive';
    });
  </script>
</body>
</html>
`;

// --- Range parsing (single-range only, per fixture contract) ---

function parseRange(rangeHeader, totalLength) {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return null;
  const [, startStr, endStr] = match;
  if (startStr === '' && endStr === '') return null;

  let start;
  let end;
  if (startStr === '') {
    // suffix range: last N bytes
    const suffixLength = Number(endStr);
    start = Math.max(0, totalLength - suffixLength);
    end = totalLength - 1;
  } else {
    start = Number(startStr);
    end = endStr === '' ? totalLength - 1 : Number(endStr);
  }

  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= totalLength) {
    return null;
  }
  end = Math.min(end, totalLength - 1);
  return { start, end };
}

// --- Request handling ---

// --- Basic-auth checking for /protected (F1 L2) ---
// Returns { present, valid, matched, username }: `present` = an Authorization
// header arrived at all; `valid` = it is a syntactically well-formed
// `Basic <base64(user:pass)>`; `matched` = the credentials are the fixture pair.
// NEVER returns or logs the raw header/password (spec-adjacent evidence rule).
const FIXTURE_USER = 'fixtureuser';
const FIXTURE_PASS = 'fixturepass';

function checkBasicAuth(authHeader) {
  if (!authHeader) return { present: false, valid: false, matched: false, username: null };
  const m = /^Basic\s+([A-Za-z0-9+/]+={0,2})$/.exec(String(authHeader).trim());
  if (!m) return { present: true, valid: false, matched: false, username: null };
  let decoded;
  try {
    decoded = Buffer.from(m[1], 'base64').toString('utf8');
  } catch {
    return { present: true, valid: false, matched: false, username: null };
  }
  const sep = decoded.indexOf(':');
  if (sep === -1) return { present: true, valid: false, matched: false, username: null };
  const username = decoded.slice(0, sep);
  const password = decoded.slice(sep + 1);
  return {
    present: true,
    valid: true,
    matched: username === FIXTURE_USER && password === FIXTURE_PASS,
    username,
  };
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const rangeHeader = req.headers['range'] ?? null;

  // /protected's auth disposition is computed BEFORE the log line so each
  // request's entry carries it (presence/validity/match only — never the value).
  const auth = pathname === '/protected' ? checkBasicAuth(req.headers['authorization']) : null;

  appendLog({
    ts: new Date().toISOString(),
    path: pathname + url.search,
    range: rangeHeader,
    ...(auth ? { authPresent: auth.present, authValid: auth.valid, authMatched: auth.matched } : {}),
  });

  if (pathname === '/protected') {
    // Cache-Control: no-store (matching the other endpoints) so repeat
    // navigations reliably re-challenge instead of serving from cache.
    if (auth && auth.matched) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      // Echo the USERNAME only — the behavior spec's step 5 asserts the
      // password appears nowhere in the page DOM beyond what the server echoes.
      res.end(
        '<!doctype html><html><head><meta charset="utf-8"><title>protected fixture</title></head>'
          + '<body><h1 id="protected-content">Protected content</h1>'
          + `<p id="auth-user">Welcome, ${auth.username === FIXTURE_USER ? FIXTURE_USER : ''}</p></body></html>`
      );
      return;
    }
    res.writeHead(401, {
      'Content-Type': 'text/plain',
      'WWW-Authenticate': 'Basic realm="fixture"',
      'Cache-Control': 'no-store',
    });
    res.end('unauthorized');
    return;
  }

  if (pathname === '/video.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(VIDEO_PAGE);
    return;
  }

  if (pathname === '/media.wav') {
    const total = MEDIA_WAV.length;
    const range = parseRange(rangeHeader, total);
    const baseHeaders = {
      'Content-Type': 'audio/wav',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    };

    if (range) {
      const { start, end } = range;
      res.writeHead(206, {
        ...baseHeaders,
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Content-Length': end - start + 1,
      });
      res.end(MEDIA_WAV.subarray(start, end + 1));
      return;
    }

    res.writeHead(200, { ...baseHeaders, 'Content-Length': total });
    res.end(MEDIA_WAV);
    return;
  }

  if (pathname === '/doc.pdf' || pathname === '/doc-attachment.pdf') {
    // Same bytes both ways — only the disposition differs, so any behavioral
    // divergence in the app is attributable to the header alone.
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': DOC_PDF.length,
      'Content-Disposition': pathname === '/doc-attachment.pdf'
        ? 'attachment; filename="doc-attachment.pdf"'
        : 'inline; filename="doc.pdf"',
      'Cache-Control': 'no-store',
    });
    res.end(DOC_PDF);
    return;
  }

  if (pathname === '/redirect-302') {
    const to = url.searchParams.get('to') || REDIRECT_302_DEFAULT;
    res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' });
    res.end();
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`web-compat fixture server listening on http://127.0.0.1:${port}`);
});
