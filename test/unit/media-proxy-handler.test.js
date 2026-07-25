'use strict';

// Unit tests for src/main/media-proxy-handler.js (Mission 13 Flight 1 / Leg 2 — DD2/AC2).
//
// The handler is Electron-free and injected-deps: getTabContents,
// isInternalContents, and parseMediaProxyUrl are all plain fakes here — no
// Electron runtime, no real session/webContents.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createMediaProxyHandler, ALLOWED_RESPONSE_HEADERS } = require('../../src/main/media-proxy-handler');
const { toMediaProxyUrl, parseMediaProxyUrl } = require('../../src/shared/media-proxy');

function fakeRequest({ method = 'GET', url, headers = {} } = {}) {
  return {
    method,
    url,
    headers: {
      get: (name) => {
        const match = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
        return match ? headers[match] : null;
      },
    },
  };
}

function fakeUpstreamResponse({ status = 200, headers = {}, body = 'streamed-body' } = {}) {
  return {
    status,
    body,
    headers: {
      get: (name) => {
        const match = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
        return match ? headers[match] : null;
      },
    },
  };
}

function makeHandler({ getTabContents, isInternalContents, parseMediaProxyUrl: parseFn }) {
  return createMediaProxyHandler({
    getTabContents: getTabContents || (() => null),
    isInternalContents: isInternalContents || (() => false),
    parseMediaProxyUrl: parseFn || (() => null),
  });
}

test('non-GET requests are refused with 405, never reaching parse/resolve', async () => {
  let parseCalls = 0;
  const handler = makeHandler({ parseMediaProxyUrl: () => { parseCalls++; return null; } });
  const res = await handler(fakeRequest({ method: 'POST', url: 'goldfinch-media://proxy/1/x' }));
  assert.equal(res.status, 405);
  assert.equal(parseCalls, 0);
});

test('an unparseable/non-http(s) proxy url is refused with 400', async () => {
  const handler = makeHandler({ parseMediaProxyUrl: () => null });
  const res = await handler(fakeRequest({ url: 'goldfinch-media://proxy/garbage' }));
  assert.equal(res.status, 400);
});

test('a wcId that resolves to nothing live is refused with 404', async () => {
  const handler = makeHandler({
    parseMediaProxyUrl: () => ({ wcId: 5, url: 'https://example.com/img.png' }),
    getTabContents: () => null,
  });
  const res = await handler(fakeRequest({ url: 'goldfinch-media://proxy/5/x' }));
  assert.equal(res.status, 404);
});

test('a wcId resolving to an internal-session contents is refused with 404', async () => {
  const internalWc = { session: { fetch: async () => fakeUpstreamResponse() } };
  const handler = makeHandler({
    parseMediaProxyUrl: () => ({ wcId: 5, url: 'https://example.com/img.png' }),
    getTabContents: () => internalWc,
    isInternalContents: (wc) => wc === internalWc,
  });
  const res = await handler(fakeRequest({ url: 'goldfinch-media://proxy/5/x' }));
  assert.equal(res.status, 404);
});

test('forwards Range and Accept request headers to the guest session fetch', async () => {
  let capturedUrl = null;
  let capturedOptions = null;
  const wc = {
    session: {
      fetch: async (url, options) => {
        capturedUrl = url;
        capturedOptions = options;
        return fakeUpstreamResponse();
      },
    },
  };
  const handler = makeHandler({
    parseMediaProxyUrl: () => ({ wcId: 3, url: 'https://example.com/clip.mp4' }),
    getTabContents: (wcId) => (wcId === 3 ? wc : null),
  });
  await handler(fakeRequest({
    url: 'goldfinch-media://proxy/3/x',
    headers: { Range: 'bytes=0-99', Accept: 'video/mp4', Cookie: 'should-not-forward=1' },
  }));
  assert.equal(capturedUrl, 'https://example.com/clip.mp4');
  assert.deepEqual(capturedOptions.headers, { Range: 'bytes=0-99', Accept: 'video/mp4' });
  assert.ok(!('Cookie' in capturedOptions.headers), 'Cookie header must never be forwarded');
});

test('omits Range/Accept from forwarded headers when absent on the incoming request', async () => {
  let capturedOptions = null;
  const wc = {
    session: {
      fetch: async (_url, options) => {
        capturedOptions = options;
        return fakeUpstreamResponse();
      },
    },
  };
  const handler = makeHandler({
    parseMediaProxyUrl: () => ({ wcId: 3, url: 'https://example.com/clip.mp4' }),
    getTabContents: () => wc,
  });
  await handler(fakeRequest({ url: 'goldfinch-media://proxy/3/x' }));
  assert.deepEqual(capturedOptions.headers, {});
});

test('returns the upstream status and ONLY allowlisted response headers, streaming the body', async () => {
  const wc = {
    session: {
      fetch: async () => fakeUpstreamResponse({
        status: 206,
        headers: {
          'content-type': 'video/mp4',
          'content-length': '1000',
          'content-range': 'bytes 0-99/1000',
          'accept-ranges': 'bytes',
          'set-cookie': 'evil=1', // must never cross
          'x-upstream-secret': 'nope', // must never cross
        },
        body: 'the-streamed-body',
      }),
    },
  };
  const handler = makeHandler({
    parseMediaProxyUrl: () => ({ wcId: 3, url: 'https://example.com/clip.mp4' }),
    getTabContents: () => wc,
  });
  const res = await handler(fakeRequest({ url: 'goldfinch-media://proxy/3/x' }));
  assert.equal(res.status, 206);
  // The real Response constructor wraps any BodyInit (including a plain string)
  // into its own internal ReadableStream — read it back via text() rather than
  // comparing res.body directly.
  assert.equal(await res.text(), 'the-streamed-body');
  for (const name of ALLOWED_RESPONSE_HEADERS) {
    // Response normalizes header casing; read case-insensitively via get().
    assert.ok(res.headers.get(name), `expected allowlisted header ${name} to be present`);
  }
  assert.equal(res.headers.get('set-cookie'), null, 'set-cookie must never cross the proxy boundary');
  assert.equal(res.headers.get('x-upstream-secret'), null, 'unknown upstream headers must never cross');
});

test('a thrown/rejected upstream fetch resolves to 502, never throws', async () => {
  const wc = { session: { fetch: async () => { throw new Error('network died'); } } };
  const handler = makeHandler({
    parseMediaProxyUrl: () => ({ wcId: 3, url: 'https://example.com/clip.mp4' }),
    getTabContents: () => wc,
  });
  const res = await handler(fakeRequest({ url: 'goldfinch-media://proxy/3/x' }));
  assert.equal(res.status, 502);
});

test('end-to-end wiring: a real toMediaProxyUrl-built request resolves via the real parseMediaProxyUrl', async () => {
  let capturedUrl = null;
  const wc = {
    session: {
      fetch: async (url) => {
        capturedUrl = url;
        return fakeUpstreamResponse({ status: 200, headers: { 'content-type': 'image/png' } });
      },
    },
  };
  const handler = createMediaProxyHandler({
    getTabContents: (wcId) => (wcId === 9 ? wc : null),
    isInternalContents: () => false,
    parseMediaProxyUrl,
  });
  const proxyUrl = toMediaProxyUrl(9, 'https://example.com/thumb.png');
  const res = await handler(fakeRequest({ url: proxyUrl }));
  assert.equal(res.status, 200);
  assert.equal(capturedUrl, 'https://example.com/thumb.png');
});
