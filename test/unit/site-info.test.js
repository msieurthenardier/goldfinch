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
// Connection: neutral/blank until main pushes a known state (no known
// tab.security yet — pre-push tab). Acceptance-run fix pass, F4
// (tls-trust-surface checkpoint 9): this used to fall back to a
// scheme-derived HTTPS/HTTP label, asserting trust before the connection was
// verified. The popup never claims a state main has not pushed.
// ---------------------------------------------------------------------------
test('connection is blank until main pushes a security state (tls-trust-surface checkpoint 9)', () => {
  assert.equal(deriveSiteInfo({ url: 'https://a.example/' }, false).connection, '');
  assert.equal(deriveSiteInfo({ url: 'HTTPS://a.example/' }, false).connection, '');
  assert.equal(deriveSiteInfo({ url: 'http://a.example/' }, false).connection, '');
  assert.equal(deriveSiteInfo({ url: '' }, false).connection, '');
});

// ---------------------------------------------------------------------------
// Mission 20 Flight 2 Leg 4 (DD8): connection reads tab.security via the
// shared vocabulary; showCertificate gates on security ∈ {secure,
// overridden} OR a folded cert-blocked failure.
// ---------------------------------------------------------------------------
test('connection reads tab.security through the shared vocabulary (secure/insecure/overridden/none)', () => {
  assert.equal(deriveSiteInfo({ url: 'https://a.example/', security: 'secure' }, false).connection, 'Secure (HTTPS)');
  assert.equal(
    deriveSiteInfo({ url: 'http://a.example/', security: 'insecure' }, false).connection,
    'Not secure (HTTP)'
  );
  assert.equal(
    deriveSiteInfo({ url: 'https://a.example/', security: 'overridden' }, false).connection,
    'Not secure — certificate error overridden (HTTPS)'
  );
  // `none`/unrecognized → blank, no claim (F4: never a scheme-derived guess).
  assert.equal(deriveSiteInfo({ url: 'https://a.example/', security: 'none' }, false).connection, '');
});

test('showCertificate is true for secure/overridden, and for a cert-blocked interstitial regardless of security', () => {
  assert.equal(deriveSiteInfo({ url: 'https://a.example/', security: 'secure' }, false).showCertificate, true);
  assert.equal(deriveSiteInfo({ url: 'https://a.example/', security: 'overridden' }, false).showCertificate, true);
  assert.equal(deriveSiteInfo({ url: 'http://a.example/', security: 'insecure' }, false).showCertificate, false);
  assert.equal(deriveSiteInfo({ url: 'https://a.example/', security: 'none' }, false).showCertificate, false);
  assert.equal(
    deriveSiteInfo({ url: 'https://a.example/', security: 'none', loadFailure: { cert: { error: 'X' } } }, false)
      .showCertificate,
    true
  );
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
