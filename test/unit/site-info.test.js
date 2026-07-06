'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { deriveSiteInfo } = require('../../src/shared/site-info');

// ---------------------------------------------------------------------------
// Internal-note branch (caller-resolved internal flag; also no-tab)
// ---------------------------------------------------------------------------
test('internal tab → secure-page note, no site data', () => {
  const info = deriveSiteInfo({ url: 'goldfinch://settings' }, true);
  assert.equal(info.internal, true);
  assert.equal(info.note, "You're viewing a secure Goldfinch page.");
  assert.equal('host' in info, false);
});

test('no tab at all → the internal-note branch (regardless of the flag)', () => {
  const info = deriveSiteInfo(null, false);
  assert.equal(info.internal, true);
  assert.equal(info.note, "You're viewing a secure Goldfinch page.");
});

// ---------------------------------------------------------------------------
// Web branch: host derivation + fresh-tab '—' fallback
// ---------------------------------------------------------------------------
test('web tab → host from URL', () => {
  const info = deriveSiteInfo({ url: 'https://example.com/path?q=1' }, false);
  assert.equal(info.internal, false);
  assert.equal(info.host, 'example.com');
});

test('host keeps a non-default port (URL.host semantics)', () => {
  const info = deriveSiteInfo({ url: 'http://example.com:8080/' }, false);
  assert.equal(info.host, 'example.com:8080');
});

test("fresh tab with unparseable/empty URL → '—' host fallback", () => {
  assert.equal(deriveSiteInfo({ url: '' }, false).host, '—');
  assert.equal(deriveSiteInfo({}, false).host, '—');
  assert.equal(deriveSiteInfo({ url: 'not a url' }, false).host, '—');
});

// ---------------------------------------------------------------------------
// Connection: HTTPS vs HTTP (prefix test, case-insensitive — parity with the
// chrome popup's /^https:/i)
// ---------------------------------------------------------------------------
test('connection is HTTPS for https: URLs, HTTP otherwise', () => {
  assert.equal(deriveSiteInfo({ url: 'https://a.example/' }, false).connection, 'HTTPS');
  assert.equal(deriveSiteInfo({ url: 'HTTPS://a.example/' }, false).connection, 'HTTPS');
  assert.equal(deriveSiteInfo({ url: 'http://a.example/' }, false).connection, 'HTTP');
  assert.equal(deriveSiteInfo({ url: '' }, false).connection, 'HTTP');
});

// ---------------------------------------------------------------------------
// Trackers / permissions: values + 0-defaults on absent privacy state
// ---------------------------------------------------------------------------
test('trackers/permissions default to 0 when privacy state is absent', () => {
  const info = deriveSiteInfo({ url: 'https://a.example/' }, false);
  assert.equal(info.trackers, 0);
  assert.equal(info.permissions, 0);
});

test('trackers/permissions read from tab privacy state', () => {
  const info = deriveSiteInfo(
    {
      url: 'https://a.example/',
      privacy: { net: { trackers: { blocked: 7 } }, permissions: [{}, {}] }
    },
    false
  );
  assert.equal(info.trackers, 7);
  assert.equal(info.permissions, 2);
});

test('partially-populated privacy state falls back per-field', () => {
  const info = deriveSiteInfo({ url: 'https://a.example/', privacy: { net: {} } }, false);
  assert.equal(info.trackers, 0);
  assert.equal(info.permissions, 0);
});
