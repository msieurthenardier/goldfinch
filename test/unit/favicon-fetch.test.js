'use strict';

// Unit tests for src/main/favicon-fetch.js (Mission 13 Flight 1 / Leg 1 — DD1).
//
// The fetcher is Electron-free and injected-deps: fetchImpl is a plain fake
// async function returning a Response-shaped object ({ ok, headers, arrayBuffer }).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createFaviconFetcher,
  DATA_FAVICON_MAX_BYTES,
  DEFAULT_FETCH_MAX_BYTES
} = require('../../src/main/favicon-fetch');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeResponse({ ok = true, contentType = 'image/png', body = 'x' } = {}) {
  return {
    ok,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null) },
    arrayBuffer: async () => Buffer.from(body)
  };
}

test('rejects non-http(s), non-data: schemes without ever fetching', async () => {
  const fetcher = createFaviconFetcher();
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls++;
    return fakeResponse();
  };
  for (const url of ['javascript:alert(1)', 'goldfinch://internal/icon.png', 'file:///etc/passwd']) {
    const result = await fetcher.request({ wcId: 1, favicons: [url], fetchImpl });
    assert.equal(result, null, `must reject ${url}`);
  }
  assert.equal(fetchCalls, 0);
});

test('a page-declared data:image/... favicon passes through unchanged with no fetch', async () => {
  const fetcher = createFaviconFetcher();
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls++;
    return fakeResponse();
  };
  const dataUrl = 'data:image/png;base64,AAAA';
  const result = await fetcher.request({ wcId: 1, favicons: [dataUrl], fetchImpl });
  assert.equal(result, dataUrl);
  assert.equal(fetchCalls, 0);
});

test('a data: favicon exactly at the 512 KB cap still passes through', async () => {
  const fetcher = createFaviconFetcher();
  const prefix = 'data:image/png;base64,';
  const padded = prefix + 'A'.repeat(DATA_FAVICON_MAX_BYTES - prefix.length);
  assert.equal(padded.length, DATA_FAVICON_MAX_BYTES);
  const result = await fetcher.request({ wcId: 1, favicons: [padded], fetchImpl: async () => fakeResponse() });
  assert.equal(result, padded);
});

test('an oversized data: favicon is rejected', async () => {
  const fetcher = createFaviconFetcher();
  const big = 'data:image/png;base64,' + 'A'.repeat(DATA_FAVICON_MAX_BYTES);
  const result = await fetcher.request({ wcId: 1, favicons: [big], fetchImpl: async () => fakeResponse() });
  assert.equal(result, null);
});

test('a non-image data: URL (e.g. data:text/html) is rejected', async () => {
  const fetcher = createFaviconFetcher();
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls++;
    return fakeResponse();
  };
  const result = await fetcher.request({
    wcId: 1,
    favicons: ['data:text/html,<script>evil()<' + '/script>'],
    fetchImpl
  });
  assert.equal(result, null);
  assert.equal(fetchCalls, 0);
});

test('rejects a non-image final content-type (e.g. text/html)', async () => {
  const fetcher = createFaviconFetcher();
  const result = await fetcher.request({
    wcId: 1,
    favicons: ['https://example.test/favicon.ico'],
    fetchImpl: async () => fakeResponse({ contentType: 'text/html; charset=utf-8' })
  });
  assert.equal(result, null);
});

test('rejects a body over the size cap (Content-Length is never trusted — the actual body is read)', async () => {
  const fetcher = createFaviconFetcher({ maxBytes: 10 });
  const result = await fetcher.request({
    wcId: 1,
    favicons: ['https://example.test/favicon.ico'],
    fetchImpl: async () => fakeResponse({ body: 'x'.repeat(11) })
  });
  assert.equal(result, null);
});

test('a successful fetch resolves to a well-formed data: URL', async () => {
  const fetcher = createFaviconFetcher();
  const result = await fetcher.request({
    wcId: 1,
    favicons: ['https://example.test/favicon.ico'],
    fetchImpl: async () => fakeResponse({ contentType: 'image/png', body: 'hello' })
  });
  assert.equal(result, `data:image/png;base64,${Buffer.from('hello').toString('base64')}`);
});

test('an SVG favicon succeeds — the inert-via-<img> guarantee made visible', async () => {
  const fetcher = createFaviconFetcher();
  const result = await fetcher.request({
    wcId: 1,
    favicons: ['https://example.test/favicon.svg'],
    fetchImpl: async () => fakeResponse({ contentType: 'image/svg+xml', body: '<svg/>' })
  });
  assert.equal(result, `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`);
});

test('validates the FINAL response after a transparent redirect, not the original request', async () => {
  // session.fetch follows 30x transparently — fetchImpl's returned response
  // describes the FINAL resource regardless of what the original favicon URL
  // pointed at. This is the success path restated with a redirect in the mix.
  const fetcher = createFaviconFetcher();
  const result = await fetcher.request({
    wcId: 1,
    favicons: ['https://example.test/redirects-elsewhere'],
    fetchImpl: async () => fakeResponse({ contentType: 'image/png', body: 'final-bytes' })
  });
  assert.equal(result, `data:image/png;base64,${Buffer.from('final-bytes').toString('base64')}`);
});

test('HTTP error responses (404/500) are treated as failure', async () => {
  const fetcher = createFaviconFetcher();
  const result = await fetcher.request({
    wcId: 1,
    favicons: ['https://example.test/missing.ico'],
    fetchImpl: async () => fakeResponse({ ok: false })
  });
  assert.equal(result, null);
});

test('a thrown/rejected fetchImpl resolves to null and never throws', async () => {
  const fetcher = createFaviconFetcher();
  const result = await fetcher.request({
    wcId: 1,
    favicons: ['https://example.test/favicon.ico'],
    fetchImpl: async () => {
      throw new Error('network down');
    }
  });
  assert.equal(result, null);
});

test('empty favicons array or a falsy favicons[0] resolves to null without fetching', async () => {
  const fetcher = createFaviconFetcher();
  let fetchCalls = 0;
  const fetchImpl = async () => {
    fetchCalls++;
    return fakeResponse();
  };
  assert.equal(await fetcher.request({ wcId: 1, favicons: [], fetchImpl }), null);
  assert.equal(await fetcher.request({ wcId: 1, favicons: [''], fetchImpl }), null);
  assert.equal(await fetcher.request({ wcId: 1, favicons: null, fetchImpl }), null);
  assert.equal(fetchCalls, 0);
});

test('latest-wins: a slow first fetch resolving after a fast second is dropped', async () => {
  const fetcher = createFaviconFetcher();
  const slow = deferred();
  const fast = deferred();
  const slowPromise = fetcher.request({
    wcId: 1,
    favicons: ['https://example.test/slow.ico'],
    fetchImpl: () => slow.promise
  });
  const fastPromise = fetcher.request({
    wcId: 1,
    favicons: ['https://example.test/fast.ico'],
    fetchImpl: () => fast.promise
  });

  fast.resolve(fakeResponse({ contentType: 'image/png', body: 'fast' }));
  const fastResult = await fastPromise;
  assert.equal(fastResult, `data:image/png;base64,${Buffer.from('fast').toString('base64')}`);

  slow.resolve(fakeResponse({ contentType: 'image/png', body: 'slow' }));
  const slowResult = await slowPromise;
  assert.equal(slowResult, null, 'the stale slow fetch must be dropped once a newer request has landed');
});

test('forget clears per-tab state so a reused wcId starts clean', async () => {
  const fetcher = createFaviconFetcher();
  await fetcher.request({
    wcId: 1,
    favicons: ['data:image/png;base64,AAAA'],
    fetchImpl: async () => fakeResponse()
  });
  fetcher.forget(1);
  const result = await fetcher.request({
    wcId: 1,
    favicons: ['data:image/png;base64,BBBB'],
    fetchImpl: async () => fakeResponse()
  });
  assert.equal(result, 'data:image/png;base64,BBBB');
});

test('DEFAULT_FETCH_MAX_BYTES is the documented 256 KB default', () => {
  assert.equal(DEFAULT_FETCH_MAX_BYTES, 256 * 1024);
});
