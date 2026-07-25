#!/usr/bin/env node
// Zero-dependency fixture server for the cross-jar-fetch-isolation behavior test.
//
// Serves a page declaring a favicon, an <img>, and an <audio> element. Every
// response to the three resource paths (/favicon.ico, /pixel.png, /track.mp3)
// sets a fresh unique cookie and appends a JSON line to a request log, so a
// test runner can prove which session (cookie jar) made which fetch.
//
// Usage: node serve.mjs --port <port> --log <path>

import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';

function parseArgs(argv) {
  const args = { port: null, log: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') args.port = Number(argv[++i]);
    else if (argv[i] === '--log') args.log = argv[++i];
  }
  if (!args.port || !args.log) {
    console.error('Usage: node serve.mjs --port <port> --log <path>');
    process.exit(1);
  }
  return args;
}

const { port, log: logPath } = parseArgs(process.argv.slice(2));

// Truncate the log at boot so each run starts from a clean slate.
fs.writeFileSync(logPath, '');

function appendLog(entry) {
  fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
}

// --- Fixture assets, generated/decoded in-memory at boot (no committed binaries) ---

// A minimal valid 1x1 transparent PNG. Reused for both /favicon.ico (served
// as image/png -- Chromium accepts PNG bytes at a .ico URL) and /pixel.png.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

function buildWavSine({ seconds = 10, sampleRate = 44100, freq = 440, amplitude = 0.2 } = {}) {
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

const TRACK_AUDIO = buildWavSine();

// Minted once at boot. Every server restart therefore serves fresh resource
// URLs, guaranteeing a cache miss even against stale entries already sitting
// in a browser's HTTP cache from a previous run (Cache-Control: no-store only
// governs future storage, not retrieval of entries stored before this
// process existed).
const BOOT_NONCE = crypto.randomUUID();

const HTML_PAGE = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>cross-jar-fetch-isolation fixture</title>
  <link rel="icon" href="/favicon.ico?b=${BOOT_NONCE}">
</head>
<body>
  <img src="/pixel.png?b=${BOOT_NONCE}" alt="pixel">
  <audio src="/track.mp3?b=${BOOT_NONCE}" controls></audio>
</body>
</html>
`;

// --- Cookie / logging helpers ---

function pathSlug(pathname) {
  // '/favicon.ico' -> 'favicon', '/pixel.png' -> 'pixel', '/track.mp3' -> 'track'
  return pathname.replace(/^\//, '').replace(/\.[^./]+$/, '');
}

function issueCookie(pathname) {
  return `gfx_${pathSlug(pathname)}=${crypto.randomUUID()}`;
}

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

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname; // route matching ignores the query string
  const fullPath = pathname + url.search; // logged verbatim so runs (nonces) are distinguishable
  const incomingCookie = req.headers['cookie'] ?? null;
  const rangeHeader = req.headers['range'] ?? null;

  if (pathname === '/') {
    // The page response may log, but must NOT set cookies -- only resources
    // set cookies, keeping cookie attribution per-resource clean.
    appendLog({
      ts: new Date().toISOString(),
      path: fullPath,
      cookie: incomingCookie,
      range: null,
      setCookie: null,
    });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML_PAGE);
    return;
  }

  if (pathname === '/favicon.ico' || pathname === '/pixel.png') {
    const setCookie = issueCookie(pathname);
    appendLog({
      ts: new Date().toISOString(),
      path: fullPath,
      cookie: incomingCookie,
      range: null,
      setCookie,
    });
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Set-Cookie': setCookie,
      'Cache-Control': 'no-store',
    });
    res.end(PNG_1X1);
    return;
  }

  if (pathname === '/track.mp3') {
    const setCookie = issueCookie(pathname);
    const total = TRACK_AUDIO.length;
    const range = parseRange(rangeHeader, total);

    appendLog({
      ts: new Date().toISOString(),
      path: fullPath,
      cookie: incomingCookie,
      range: rangeHeader,
      setCookie,
    });

    // Content-Type is honest about the actual bytes served (WAV), even
    // though the route is named /track.mp3 per the fixture contract.
    const baseHeaders = {
      'Content-Type': 'audio/wav',
      'Set-Cookie': setCookie,
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
      res.end(TRACK_AUDIO.subarray(start, end + 1));
      return;
    }

    res.writeHead(200, { ...baseHeaders, 'Content-Length': total });
    res.end(TRACK_AUDIO);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`cross-jar-fetch fixture server listening on http://127.0.0.1:${port}`);
});
