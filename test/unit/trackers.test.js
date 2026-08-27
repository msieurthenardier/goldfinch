'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// trackers.js is pure (no require('electron')) — load directly.
const { registrableDomain, hostnameOf, classify } = require('../../src/main/trackers');

// ---------------------------------------------------------------------------
// registrableDomain
// ---------------------------------------------------------------------------
test('registrableDomain: simple two-label domain', () => {
  assert.equal(registrableDomain('a.com'), 'a.com');
});

test('registrableDomain: subdomain stripped to eTLD+1', () => {
  assert.equal(registrableDomain('sub.a.com'), 'a.com');
});

test('registrableDomain: bbc.co.uk via MULTI_SUFFIX (two-level suffix)', () => {
  assert.equal(registrableDomain('bbc.co.uk'), 'bbc.co.uk');
});

test('registrableDomain: x.bbc.co.uk via MULTI_SUFFIX', () => {
  assert.equal(registrableDomain('x.bbc.co.uk'), 'bbc.co.uk');
});

test('registrableDomain: empty string returns empty string', () => {
  assert.equal(registrableDomain(''), '');
});

test('registrableDomain: undefined returns empty string', () => {
  assert.equal(registrableDomain(undefined), '');
});

test('registrableDomain: single label (localhost) returned as-is', () => {
  assert.equal(registrableDomain('localhost'), 'localhost');
});

// F5: multi-tenant public suffixes — tenants must not collapse to the shared suffix
test('F5 registrableDomain: alice.github.io and bob.github.io are distinct', () => {
  assert.equal(registrableDomain('alice.github.io'), 'alice.github.io');
  assert.equal(registrableDomain('bob.github.io'), 'bob.github.io');
  assert.notEqual(registrableDomain('alice.github.io'), registrableDomain('bob.github.io'));
});

test('F5 classify: alice.github.io vs bob.github.io is third-party across tenants', () => {
  const result = classify('https://bob.github.io/asset.js', 'alice.github.io');
  assert.equal(result.thirdParty, true);
  assert.equal(result.domain, 'bob.github.io');
});

test('F5 registrableDomain: normal example.co.uk still resolves to example.co.uk', () => {
  assert.equal(registrableDomain('example.co.uk'), 'example.co.uk');
  assert.equal(registrableDomain('www.example.co.uk'), 'example.co.uk');
});

test('F5 registrableDomain: other multi-tenant suffixes isolate tenants', () => {
  assert.equal(registrableDomain('alice.vercel.app'), 'alice.vercel.app');
  assert.equal(registrableDomain('bob.pages.dev'), 'bob.pages.dev');
  assert.equal(registrableDomain('app.herokuapp.com'), 'app.herokuapp.com');
});

// Squawk 0035 (GitHub #81, F5): registrableDomain is now PSL-backed
// (src/main/psl.js) instead of the hand-maintained MULTI_SUFFIX set — these
// pin the multi-tenant fix and the operator-approved fail-closed fallback.
test('squawk 0035: two S3-bucket hostnames under the shared amazonaws.com suffix are different sites', () => {
  const bucketA = registrableDomain('my-app-assets.s3.amazonaws.com');
  const bucketB = registrableDomain('unrelated-tenant.s3.amazonaws.com');
  assert.equal(bucketA, 'my-app-assets.s3.amazonaws.com');
  assert.equal(bucketB, 'unrelated-tenant.s3.amazonaws.com');
  assert.notEqual(bucketA, bucketB, 's3.amazonaws.com is a listed PSL suffix — buckets must not collapse to it');
});

test('squawk 0035 classify: two S3-bucket hostnames are third-party to each other', () => {
  const result = classify('https://unrelated-tenant.s3.amazonaws.com/x.js', 'my-app-assets.s3.amazonaws.com');
  assert.equal(result.thirdParty, true);
  assert.equal(result.domain, 'unrelated-tenant.s3.amazonaws.com');
});

test('squawk 0035: two github.io tenants remain distinct sites (PSL-backed, not the old curated set)', () => {
  const tenantA = registrableDomain('research-tools.github.io');
  const tenantB = registrableDomain('unrelated-org.github.io');
  assert.notEqual(tenantA, tenantB);
  assert.equal(tenantA, 'research-tools.github.io');
  assert.equal(tenantB, 'unrelated-org.github.io');
});

test('squawk 0035: an unlisted TLD fails closed to the whole hostname (registrableDomainSafe returns null; never merges two distinct hosts)', () => {
  // "madeupzzznotatld" is not in the vendored PSL, so registrableDomainSafe()
  // returns null (same fail-closed case pinned in test/unit/psl.test.js).
  // trackers.js's fallback treats the full host as its own identity rather
  // than guessing at a suffix split — an accepted tradeoff (operator ruling
  // 2026-08-27): it may under-strip a legitimate subdomain, but it can never
  // wrongly collapse two unrelated hosts onto the same "site".
  const hostA = registrableDomain('tenant-a.madeupzzznotatld');
  const hostB = registrableDomain('tenant-b.madeupzzznotatld');
  assert.equal(hostA, 'tenant-a.madeupzzznotatld');
  assert.equal(hostB, 'tenant-b.madeupzzznotatld');
  assert.notEqual(hostA, hostB);
});

// Squawk 0035 review fix (BLOCKING): four old MULTI_SUFFIX platform entries
// (amazonaws.com, netlify.com, surge.sh, glitch.me) sit under a real ICANN
// TLD with no matching PSL PRIVATE-section rule, so registrableDomainSafe()
// resolves them via the bare TLD alone — a non-null but WRONG split that
// drops the tenant label. SUPPLEMENT_SUFFIX restores the old curated split
// for exactly these four.
test('squawk 0035 review fix: two tenants under each supplemented suffix are different sites', () => {
  for (const suffix of ['amazonaws.com', 'netlify.com', 'surge.sh', 'glitch.me']) {
    const a = registrableDomain(`tenant-a.${suffix}`);
    const b = registrableDomain(`tenant-b.${suffix}`);
    assert.equal(a, `tenant-a.${suffix}`, `${suffix}: tenant-a should keep its label`);
    assert.equal(b, `tenant-b.${suffix}`, `${suffix}: tenant-b should keep its label`);
    assert.notEqual(a, b, `${suffix}: distinct tenants must not collapse`);
  }
});

test('squawk 0035 review fix classify: tenants under a supplemented suffix are third-party to each other', () => {
  const result = classify('https://tenant-b.netlify.com/asset.js', 'tenant-a.netlify.com');
  assert.equal(result.thirdParty, true);
  assert.equal(result.domain, 'tenant-b.netlify.com');
});

test('squawk 0035 review fix: a suffix that IS in the PSL still resolves via the PSL, not the supplement', () => {
  // s3.amazonaws.com and github.io are PSL PRIVATE-section entries in their
  // own right — the supplement must not shadow the PSL's (correct, deeper)
  // answer for these.
  assert.equal(registrableDomain('my-app-assets.s3.amazonaws.com'), 'my-app-assets.s3.amazonaws.com');
  assert.equal(registrableDomain('unrelated-tenant.s3.amazonaws.com'), 'unrelated-tenant.s3.amazonaws.com');
  assert.equal(registrableDomain('research-tools.github.io'), 'research-tools.github.io');
});

test('squawk 0035 review fix: bare supplement suffix host (no tenant label) is unaffected', () => {
  assert.equal(registrableDomain('amazonaws.com'), 'amazonaws.com');
  assert.equal(registrableDomain('netlify.com'), 'netlify.com');
  assert.equal(registrableDomain('surge.sh'), 'surge.sh');
  assert.equal(registrableDomain('glitch.me'), 'glitch.me');
});

// F6: IP literals must not be label-sliced
test('F6 registrableDomain: IPv4 literal returned unchanged', () => {
  assert.equal(registrableDomain('192.168.1.10'), '192.168.1.10');
});

test('F6 registrableDomain: distinct IPv4s are not collapsed', () => {
  assert.equal(registrableDomain('10.0.0.1'), '10.0.0.1');
  assert.equal(registrableDomain('10.0.0.2'), '10.0.0.2');
  assert.notEqual(registrableDomain('10.0.0.1'), registrableDomain('10.0.0.2'));
  // Pre-fix bug: both would have become "0.1" / "0.2" via last-2 labels, or
  // worse collide if only last2 of a.b.c.d pattern — ensure full host identity.
  assert.notEqual(registrableDomain('192.168.1.10'), '1.10');
});

test('F6 registrableDomain: IPv6 literal (bracketed / colon) returned unchanged', () => {
  assert.equal(registrableDomain('[2001:db8::1]'), '[2001:db8::1]');
  assert.equal(registrableDomain('2001:db8::1'), '2001:db8::1');
});

// ---------------------------------------------------------------------------
// hostnameOf
// ---------------------------------------------------------------------------
test('hostnameOf: extracts hostname from valid URL', () => {
  assert.equal(hostnameOf('https://a.com/x'), 'a.com');
});

test('hostnameOf: returns empty string for non-URL', () => {
  assert.equal(hostnameOf('not a url'), '');
});

// ---------------------------------------------------------------------------
// classify
// ---------------------------------------------------------------------------
test('classify: third-party known tracker returns category', () => {
  // google-analytics.com is in TRACKERS as 'analytics'; first party is example.com
  const result = classify('https://google-analytics.com/collect', 'example.com');
  assert.equal(result.thirdParty, true);
  assert.equal(result.tracker, 'analytics');
  assert.equal(result.domain, 'google-analytics.com');
});

test('classify: same-domain first-party known tracker yields tracker:null', () => {
  // Even though google-analytics.com is a tracker, if it IS the first party, tracker must be null.
  const result = classify('https://google-analytics.com/collect', 'google-analytics.com');
  assert.equal(result.thirdParty, false);
  assert.equal(result.tracker, null);
  assert.equal(result.domain, 'google-analytics.com');
});

test('classify: third-party non-tracker yields tracker:null', () => {
  // example.org is not in TRACKERS
  const result = classify('https://example.org/img.png', 'example.com');
  assert.equal(result.thirdParty, true);
  assert.equal(result.tracker, null);
  assert.equal(result.domain, 'example.org');
});

test('classify: host-level fallback — analytics.google.com (registrable google.com NOT in TRACKERS, but host IS)', () => {
  // google.com is not in TRACKERS; analytics.google.com IS → should resolve via host fallback
  const result = classify('https://analytics.google.com/collect', 'example.com');
  assert.equal(result.thirdParty, true);
  assert.equal(result.tracker, 'analytics');
  assert.equal(result.domain, 'google.com');
});

// F7: host-keyed TRACKERS must match subdomain variants via suffix walk
test('F7 classify: www.analytics.google.com matches host-keyed analytics.google.com', () => {
  const base = classify('https://analytics.google.com/collect', 'example.com');
  const www = classify('https://www.analytics.google.com/collect', 'example.com');
  assert.equal(base.tracker, 'analytics');
  assert.equal(www.tracker, 'analytics', 'subdomain variant must inherit host-keyed category');
  assert.equal(www.thirdParty, true);
  assert.equal(www.domain, 'google.com');
});

test('F7 classify: unrelated host is not reclassified as a tracker', () => {
  const result = classify('https://www.example.org/page', 'example.com');
  assert.equal(result.thirdParty, true);
  assert.equal(result.tracker, null);
});

test('F7 classify: first-party gate still suppresses tracker on same-site host variant', () => {
  // Even if host walk would match a TRACKERS host key under google.com, first-party → tracker:null
  const result = classify('https://www.analytics.google.com/collect', 'google.com');
  assert.equal(result.thirdParty, false);
  assert.equal(result.tracker, null);
});

test('classify: known tracker with undefined firstParty returns thirdParty:false and tracker:null', () => {
  // firstPartyDomain is undefined → thirdParty = false → tracker must be null
  const result = classify('https://google-analytics.com/collect', undefined);
  assert.equal(result.thirdParty, false);
  assert.equal(result.tracker, null);
  assert.equal(result.domain, 'google-analytics.com');
});

test('classify: garbage URL returns domain empty string', () => {
  const result = classify('not-a-url', 'example.com');
  assert.equal(result.thirdParty, false);
  assert.equal(result.tracker, null);
  assert.equal(result.domain, '');
});
