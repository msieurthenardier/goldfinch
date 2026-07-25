'use strict';

// Unit tests for src/shared/media-proxy.js (Mission 13 Flight 1 / Leg 2 — DD2/AC1).
//
// Pure ESM module, required from this CJS test file via Node >=22
// require(esm) — the url-safety.test.js precedent.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toMediaProxyUrl, parseMediaProxyUrl } = require('../../src/shared/media-proxy');

test('wraps an http: url into a goldfinch-media:// proxy url', () => {
  const wrapped = toMediaProxyUrl(7, 'http://example.com/img.png');
  assert.equal(typeof wrapped, 'string');
  assert.ok(wrapped.startsWith('goldfinch-media://proxy/7/'));
});

test('wraps an https: url into a goldfinch-media:// proxy url', () => {
  const wrapped = toMediaProxyUrl(42, 'https://example.com/video.mp4');
  assert.ok(wrapped.startsWith('goldfinch-media://proxy/42/'));
});

test('round-trips a plain http url', () => {
  const wcId = 3;
  const original = 'http://example.com/media/clip.mp4';
  const wrapped = toMediaProxyUrl(wcId, original);
  const parsed = parseMediaProxyUrl(wrapped);
  assert.deepEqual(parsed, { wcId, url: original });
});

test('round-trips a url with a query string', () => {
  const wcId = 11;
  const original = 'https://example.com/path?a=1&b=two words&c=x%26y';
  const wrapped = toMediaProxyUrl(wcId, original);
  const parsed = parseMediaProxyUrl(wrapped);
  assert.deepEqual(parsed, { wcId, url: original });
});

test('round-trips a url with a fragment', () => {
  const wcId = 12;
  const original = 'https://example.com/path#section-2';
  const wrapped = toMediaProxyUrl(wcId, original);
  const parsed = parseMediaProxyUrl(wrapped);
  assert.deepEqual(parsed, { wcId, url: original });
});

test('round-trips a url containing unicode characters', () => {
  const wcId = 99;
  const original = 'https://example.com/фото/日本語.jpg?q=café';
  const wrapped = toMediaProxyUrl(wcId, original);
  const parsed = parseMediaProxyUrl(wrapped);
  assert.deepEqual(parsed, { wcId, url: original });
});

test('round-trips a url whose query carries the six encodeURIComponent-missed characters', () => {
  const wcId = 5;
  const original = "https://example.com/path?q=)( '!~*";
  const wrapped = toMediaProxyUrl(wcId, original);
  const parsed = parseMediaProxyUrl(wrapped);
  assert.deepEqual(parsed, { wcId, url: original });
});

test('encoding never leaves a raw " or ) character in the wrapped url', () => {
  const original = 'https://example.com/path?q=")(\'!~*';
  const wrapped = toMediaProxyUrl(1, original);
  // Strip the fixed, unencoded prefix + wcId segment before asserting — those
  // are not "encoded" content.
  const encodedPart = wrapped.slice('goldfinch-media://proxy/1/'.length);
  assert.ok(!encodedPart.includes('"'), 'no raw " in encoded segment');
  assert.ok(!encodedPart.includes(')'), 'no raw ) in encoded segment');
});

for (const passthrough of [
  'blob:http://example.com/uuid-1234',
  'data:image/png;base64,AAAA',
  'not a url at all',
  'javascript:alert(1)',
  'ftp://example.com/file.txt',
  '',
]) {
  test(`toMediaProxyUrl passes through unchanged: ${JSON.stringify(passthrough)}`, () => {
    assert.equal(toMediaProxyUrl(1, passthrough), passthrough);
  });
}

for (const nonString of [null, undefined, 123, {}, [], true]) {
  test(`toMediaProxyUrl passes through non-string input unchanged: ${JSON.stringify(nonString)}`, () => {
    assert.equal(toMediaProxyUrl(1, nonString), nonString);
  });
}

test('parseMediaProxyUrl rejects a string with no goldfinch-media:// proxy prefix', () => {
  assert.equal(parseMediaProxyUrl('https://example.com/img.png'), null);
});

test('parseMediaProxyUrl rejects a malformed prefix (missing /proxy/ segment)', () => {
  assert.equal(parseMediaProxyUrl('goldfinch-media://1/http%3A%2F%2Fexample.com'), null);
});

test('parseMediaProxyUrl rejects a non-numeric wcId segment', () => {
  assert.equal(parseMediaProxyUrl('goldfinch-media://proxy/abc/http%3A%2F%2Fexample.com%2F'), null);
});

test('parseMediaProxyUrl rejects a missing encoded target segment', () => {
  assert.equal(parseMediaProxyUrl('goldfinch-media://proxy/1/'), null);
  assert.equal(parseMediaProxyUrl('goldfinch-media://proxy/1'), null);
});

test('parseMediaProxyUrl rejects undecodable percent-escapes', () => {
  assert.equal(parseMediaProxyUrl('goldfinch-media://proxy/1/%'), null);
});

test('parseMediaProxyUrl rejects a decoded target that is not http/https', () => {
  const wrapped = `goldfinch-media://proxy/1/${encodeURIComponent('blob:http://example.com/uuid')}`;
  assert.equal(parseMediaProxyUrl(wrapped), null);

  const wrapped2 = `goldfinch-media://proxy/1/${encodeURIComponent('not a url')}`;
  assert.equal(parseMediaProxyUrl(wrapped2), null);

  const wrapped3 = `goldfinch-media://proxy/1/${encodeURIComponent('javascript:alert(1)')}`;
  assert.equal(parseMediaProxyUrl(wrapped3), null);
});

test('parseMediaProxyUrl rejects non-string input', () => {
  for (const bad of [null, undefined, 123, {}, []]) {
    assert.equal(parseMediaProxyUrl(bad), null);
  }
});
