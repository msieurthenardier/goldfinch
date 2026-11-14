'use strict';

// Unit tests for src/shared/media-proxy.js (Mission 13 Flight 1 / Leg 2 — DD2/AC1).
//
// Pure ESM module, required from this CJS test file via Node >=22
// require(esm) — the url-safety.test.js precedent.
//
// Mission 23 Flight 1 (leg `jar-isolation`): the address names a per-tab TOKEN, never a tab number,
// and `toMediaProxyUrl` answers null for anything that is not an http(s) target.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toMediaProxyUrl, parseMediaProxyUrl } = require('../../src/shared/media-proxy');

const TOKEN = 'Zk3_-aB9xQ0wLmN2pRsT4u'; // 22 base64url characters, the shape main mints (longer in practice)

test('wraps an http: url into a goldfinch-media:// proxy url', () => {
  const wrapped = toMediaProxyUrl(TOKEN, 'http://example.com/img.png');
  assert.equal(typeof wrapped, 'string');
  assert.ok(wrapped.startsWith(`goldfinch-media://proxy/${TOKEN}/`));
});

test('wraps an https: url into a goldfinch-media:// proxy url', () => {
  const wrapped = toMediaProxyUrl(TOKEN, 'https://example.com/video.mp4');
  assert.ok(wrapped.startsWith(`goldfinch-media://proxy/${TOKEN}/`));
});

test('round-trips a plain http url', () => {
  const token = TOKEN;
  const original = 'http://example.com/media/clip.mp4';
  const wrapped = toMediaProxyUrl(token, original);
  const parsed = parseMediaProxyUrl(wrapped);
  assert.deepEqual(parsed, { token, url: original });
});

test('round-trips a url with a query string', () => {
  const token = TOKEN;
  const original = 'https://example.com/path?a=1&b=two words&c=x%26y';
  const wrapped = toMediaProxyUrl(token, original);
  const parsed = parseMediaProxyUrl(wrapped);
  assert.deepEqual(parsed, { token, url: original });
});

test('round-trips a url with a fragment', () => {
  const token = TOKEN;
  const original = 'https://example.com/path#section-2';
  const wrapped = toMediaProxyUrl(token, original);
  const parsed = parseMediaProxyUrl(wrapped);
  assert.deepEqual(parsed, { token, url: original });
});

test('round-trips a url containing unicode characters', () => {
  const token = TOKEN;
  const original = 'https://example.com/фото/日本語.jpg?q=café';
  const wrapped = toMediaProxyUrl(token, original);
  const parsed = parseMediaProxyUrl(wrapped);
  assert.deepEqual(parsed, { token, url: original });
});

test('round-trips a url whose query carries the six encodeURIComponent-missed characters', () => {
  const token = TOKEN;
  const original = "https://example.com/path?q=)( '!~*";
  const wrapped = toMediaProxyUrl(token, original);
  const parsed = parseMediaProxyUrl(wrapped);
  assert.deepEqual(parsed, { token, url: original });
});

test('encoding never leaves a raw " or ) character in the wrapped url', () => {
  const original = 'https://example.com/path?q=")(\'!~*';
  const wrapped = toMediaProxyUrl(TOKEN, original);
  // Strip the fixed, unencoded prefix + token segment before asserting — those
  // are not "encoded" content.
  const encodedPart = wrapped.slice(`goldfinch-media://proxy/${TOKEN}/`.length);
  assert.ok(!encodedPart.includes('"'), 'no raw " in encoded segment');
  assert.ok(!encodedPart.includes(')'), 'no raw ) in encoded segment');
});

for (const passthrough of [
  'blob:http://example.com/uuid-1234',
  'data:image/png;base64,AAAA',
  'not a url at all',
  'javascript:alert(1)',
  'ftp://example.com/file.txt',
  'file:///etc/hostname',
  'goldfinch-media://proxy/other/http%3A%2F%2Fexample.com%2F',
  ''
]) {
  test(`toMediaProxyUrl answers null for a non-web url: ${JSON.stringify(passthrough)}`, () => {
    assert.equal(toMediaProxyUrl(TOKEN, passthrough), null);
  });
}

for (const nonString of [null, undefined, 123, {}, [], true]) {
  test(`toMediaProxyUrl answers null for non-string input: ${JSON.stringify(nonString)}`, () => {
    assert.equal(toMediaProxyUrl(TOKEN, nonString), null);
  });
}

test('parseMediaProxyUrl rejects a string with no goldfinch-media:// proxy prefix', () => {
  assert.equal(parseMediaProxyUrl('https://example.com/img.png'), null);
});

test('parseMediaProxyUrl rejects a malformed prefix (missing /proxy/ segment)', () => {
  assert.equal(parseMediaProxyUrl('goldfinch-media://1/http%3A%2F%2Fexample.com'), null);
});

test('parseMediaProxyUrl rejects a token outside the base64url alphabet or over the length bound', () => {
  assert.equal(parseMediaProxyUrl('goldfinch-media://proxy/ab.c/http%3A%2F%2Fexample.com%2F'), null);
  assert.equal(parseMediaProxyUrl('goldfinch-media://proxy/ab%20c/http%3A%2F%2Fexample.com%2F'), null);
  assert.equal(parseMediaProxyUrl(`goldfinch-media://proxy/${'a'.repeat(65)}/http%3A%2F%2Fexample.com%2F`), null);
  assert.deepEqual(parseMediaProxyUrl(`goldfinch-media://proxy/${'a'.repeat(64)}/http%3A%2F%2Fexample.com%2F`), {
    token: 'a'.repeat(64),
    url: 'http://example.com/'
  });
});

test('toMediaProxyUrl answers null for a missing, empty, over-long or non-alphabet token', () => {
  for (const bad of [null, undefined, '', 7, {}, 'a/b', 'a b', 'a'.repeat(65)]) {
    assert.equal(toMediaProxyUrl(bad, 'https://example.com/x.png'), null, JSON.stringify(bad));
  }
});

test('parseMediaProxyUrl is lenient: a decimal tab number parses (the store, not the parser, refuses it)', () => {
  assert.deepEqual(parseMediaProxyUrl('goldfinch-media://proxy/28/http%3A%2F%2Fexample.com%2F'), {
    token: '28',
    url: 'http://example.com/'
  });
});

test('parseMediaProxyUrl rejects a missing encoded target segment', () => {
  assert.equal(parseMediaProxyUrl('goldfinch-media://proxy/tok/'), null);
  assert.equal(parseMediaProxyUrl('goldfinch-media://proxy/tok'), null);
});

test('parseMediaProxyUrl rejects undecodable percent-escapes', () => {
  assert.equal(parseMediaProxyUrl('goldfinch-media://proxy/tok/%'), null);
});

test('parseMediaProxyUrl rejects a decoded target that is not http/https', () => {
  const wrapped = `goldfinch-media://proxy/tok/${encodeURIComponent('blob:http://example.com/uuid')}`;
  assert.equal(parseMediaProxyUrl(wrapped), null);

  const wrapped2 = `goldfinch-media://proxy/tok/${encodeURIComponent('not a url')}`;
  assert.equal(parseMediaProxyUrl(wrapped2), null);

  const wrapped3 = `goldfinch-media://proxy/tok/${encodeURIComponent('javascript:alert(1)')}`;
  assert.equal(parseMediaProxyUrl(wrapped3), null);
});

test('parseMediaProxyUrl rejects non-string input', () => {
  for (const bad of [null, undefined, 123, {}, []]) {
    assert.equal(parseMediaProxyUrl(bad), null);
  }
});
