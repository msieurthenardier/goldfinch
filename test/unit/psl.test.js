'use strict';

// Unit tests for src/main/vault/psl.js (M12 Flight 4, Leg 4 / DD5) — the credential-safe
// registrable-domain (eTLD+1) resolver behind the `matchMode:'registrable-domain'` fill
// opt-in. This is the flight's HIGHEST-RISK surface: a wrong result silently widens a
// password across sites, so the rule classes (normal / `*` wildcard / `!` exception,
// exception-over-wildcard priority) and every fail-closed null case are pinned
// exhaustively against the VENDORED public_suffix_list.dat snapshot.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { registrableDomainSafe: rd, isPslStale, SNAPSHOT_MS, PSL_MAX_AGE_MS } = require('../../src/main/vault/psl');

const DAY_MS = 24 * 60 * 60 * 1000;

// --- Expiry gate (PR#112 finding 10): a too-stale snapshot disables widening -----

test('the vendored snapshot exposes a parseable date and is not stale near its own date', () => {
  assert.equal(typeof SNAPSHOT_MS, 'number', 'the // VERSION: header date parsed');
  assert.equal(isPslStale(SNAPSHOT_MS + 10 * DAY_MS), false, 'fresh within the window');
  assert.equal(isPslStale(SNAPSHOT_MS + PSL_MAX_AGE_MS - DAY_MS), false, 'just inside the window');
  assert.equal(isPslStale(SNAPSHOT_MS + PSL_MAX_AGE_MS + DAY_MS), true, 'just past the window is stale');
});

test('registrableDomainSafe returns null (no widening) once the snapshot is over-stale', () => {
  const fresh = SNAPSHOT_MS + 10 * DAY_MS;
  const stale = SNAPSHOT_MS + PSL_MAX_AGE_MS + DAY_MS;
  // Fresh: normal resolution.
  assert.equal(rd('accounts.example.com', { now: fresh }), 'example.com');
  // Over-stale: EVERY host resolves to null → the fill layer degrades to exact origin.
  assert.equal(rd('accounts.example.com', { now: stale }), null);
  assert.equal(rd('example.co.uk', { now: stale }), null);
});

test('normal registrable domains: (suffix) + one label', () => {
  assert.equal(rd('example.com'), 'example.com');
  assert.equal(rd('accounts.example.com'), 'example.com'); // the motivating case
  assert.equal(rd('a.b.c.example.com'), 'example.com');
  assert.equal(rd('example.co.uk'), 'example.co.uk'); // multi-label suffix (co.uk)
  assert.equal(rd('deep.sub.example.co.uk'), 'example.co.uk');
});

test('host IS a public suffix → null (no registrable label above it)', () => {
  assert.equal(rd('com'), null); // a bare TLD
  assert.equal(rd('co.uk'), null); // the multi-label suffix itself
  assert.equal(rd('github.io'), null); // a PRIVATE-section multi-tenant suffix
});

test('unknown / unlisted suffix → null (FAIL-CLOSED — no implicit `*` default)', () => {
  // The standard PSL algorithm would apply an implicit `*` rule (treating the last
  // label as a suffix) and RETURN a registrable domain. This module must NOT — an
  // unlisted suffix is exactly the credential-leak vector.
  assert.equal(rd('foo.madeupzzznotatld'), null);
  assert.equal(rd('host.invalidtldxyz'), null);
});

test('IP literals → null (never label-slice an address)', () => {
  assert.equal(rd('192.168.1.10'), null);
  assert.equal(rd('8.8.8.8'), null);
  assert.equal(rd('[::1]'), null); // bracketed IPv6 (URL.hostname form)
  assert.equal(rd('[2001:db8::1]'), null);
});

test('empty / malformed / non-string → null', () => {
  assert.equal(rd(''), null);
  assert.equal(rd('   '), null);
  assert.equal(rd('a..b'), null); // empty middle label
  assert.equal(rd('.example.com'), null); // empty leading label
  assert.equal(rd(/** @type {any} */ (null)), null);
  assert.equal(rd(/** @type {any} */ (undefined)), null);
  assert.equal(rd(/** @type {any} */ (42)), null);
});

test('trailing dot (absolute form) and case are normalized', () => {
  assert.equal(rd('Accounts.Example.COM'), 'example.com');
  assert.equal(rd('accounts.example.com.'), 'example.com');
});

test('multi-tenant platforms resolve tenants DISTINCT (the whole point)', () => {
  // github.io is a public suffix, so each tenant is its own registrable domain.
  assert.equal(rd('alice.github.io'), 'alice.github.io');
  assert.equal(rd('bob.github.io'), 'bob.github.io');
  assert.notEqual(rd('alice.github.io'), rd('bob.github.io'));
  // A tenant's subdomains still collapse to that tenant.
  assert.equal(rd('www.alice.github.io'), 'alice.github.io');
  // s3.amazonaws.com is a listed suffix → per-bucket boundaries.
  assert.equal(rd('my-bucket.s3.amazonaws.com'), 'my-bucket.s3.amazonaws.com');
  assert.equal(rd('s3.amazonaws.com'), null); // the suffix itself
});

test('registry siblings under a listed ccTLD suffix are DISTINCT registrable domains', () => {
  // co.id is a public suffix → a.co.id and b.co.id differ (the sibling-leak guard).
  assert.equal(rd('a.co.id'), 'a.co.id');
  assert.equal(rd('b.co.id'), 'b.co.id');
  assert.notEqual(rd('a.co.id'), rd('b.co.id'));
  assert.equal(rd('www.a.co.id'), 'a.co.id');
});

test('`*` wildcard rule: `*.ck` makes any single label under .ck a suffix', () => {
  // *.ck (with the !www.ck exception). `<label>.ck` is a public suffix.
  assert.equal(rd('foo.ck'), null); // foo.ck IS a suffix (matched by *.ck)
  assert.equal(rd('bar.foo.ck'), 'bar.foo.ck'); // one label above the suffix
});

test('`!` EXCEPTION rule beats the `*` wildcard (exception-over-wildcard priority)', () => {
  // !www.ck un-wildcards: www.ck is a registrable domain, NOT a suffix.
  assert.equal(rd('www.ck'), 'www.ck');
  assert.equal(rd('sub.www.ck'), 'www.ck');
  // The Japan geographic case: *.kawasaki.jp + !city.kawasaki.jp.
  assert.equal(rd('city.kawasaki.jp'), 'city.kawasaki.jp'); // exception → registrable
  assert.equal(rd('www.city.kawasaki.jp'), 'city.kawasaki.jp');
  assert.equal(rd('foo.kawasaki.jp'), null); // *.kawasaki.jp → foo.kawasaki.jp is a suffix
  assert.equal(rd('bar.foo.kawasaki.jp'), 'bar.foo.kawasaki.jp'); // one label above it
});

test('IDN hosts are RECONCILED (punycode host vs Unicode .dat) — not blindly failed', () => {
  // 公司.cn (xn--55qx5d.cn) is itself a listed suffix → its bare form is null, and a
  // label above it is that tenant's registrable domain. Proves the .dat's Unicode
  // entries are ASCII-normalized to match a punycode host from URL.hostname.
  assert.equal(rd('xn--55qx5d.cn'), null); // the IDN suffix itself
  assert.equal(rd('shop.xn--55qx5d.cn'), 'shop.xn--55qx5d.cn');
  // A punycode host under a plain ASCII suffix resolves normally.
  assert.equal(rd('xn--r8jz45g.jp'), 'xn--r8jz45g.jp'); // 例え.jp
  // A raw Unicode host is defensively reconciled too (callers pass punycode, but be safe).
  assert.equal(rd('例え.jp'), 'xn--r8jz45g.jp');
});
