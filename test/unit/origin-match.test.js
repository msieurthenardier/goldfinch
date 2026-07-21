'use strict';

// Unit tests for src/shared/origin-match.js (M12 Flight 4, Leg 4 / DD5) — the single
// fill-decision point. Exact-origin by default; a `matchMode:'registrable-domain'`
// item optionally widens to the eTLD+1 behind the fail-closed PSL matcher. The
// fail-closed contract (every uncertainty degrades to exact) is the credential-safety
// linchpin, so it is pinned exhaustively: scheme mismatch, either-host-null, both-null,
// origin-parse failure, and a non-opted-in (legacy) item all stay exact.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { originMatches } = require('../../src/shared/origin-match');

const exactItem = (origin) => ({ origin, matchMode: 'exact' });
const wideItem = (origin) => ({ origin, matchMode: 'registrable-domain' });
const legacyItem = (origin) => ({ origin }); // no matchMode field

/* --------------------------------------------------- exact (widen omitted / false) */

test('widen omitted → exact byte-for-byte; a 2-arg call never throws (whole opts defaulted)', () => {
  assert.equal(originMatches(exactItem('https://x.com'), 'https://x.com'), true);
  assert.equal(originMatches(exactItem('https://x.com'), 'https://y.com'), false);
  // Even a registrable-domain item does NOT widen when widen is omitted.
  assert.equal(originMatches(wideItem('https://x.com'), 'https://accounts.x.com'), false);
  // Port is part of the exact origin.
  assert.equal(originMatches(exactItem('https://x.com:8443'), 'https://x.com'), false);
});

test('widen:false is identical to omitted', () => {
  assert.equal(originMatches(wideItem('https://x.com'), 'https://accounts.x.com', { widen: false }), false);
  assert.equal(originMatches(exactItem('https://x.com'), 'https://x.com', { widen: false }), true);
});

test('a null / empty origin on EITHER side never matches (the fill-site guards)', () => {
  assert.equal(originMatches({ origin: null }, 'https://x.com'), false);
  assert.equal(originMatches({ origin: undefined }, 'https://x.com'), false);
  assert.equal(originMatches(exactItem(''), ''), false);
  assert.equal(originMatches({ origin: null }, /** @type {any} */ (null)), false); // both null → still no match
});

/* --------------------------------------------------------------- widen:true widens */

test('widen:true + registrable-domain: matches across a subdomain (same scheme)', () => {
  const item = wideItem('https://example.com');
  assert.equal(originMatches(item, 'https://accounts.example.com', { widen: true }), true);
  assert.equal(originMatches(item, 'https://example.com', { widen: true }), true); // exact still matches
  assert.equal(originMatches(wideItem('https://accounts.example.com'), 'https://billing.example.com', { widen: true }), true);
  // Port need not match across subdomains in registrable-domain mode.
  assert.equal(originMatches(wideItem('https://example.com'), 'https://accounts.example.com:8443', { widen: true }), true);
});

/* ------------------------------------------------------------- widen:true REFUSES */

test('widen:true REFUSES across a registry sibling (co.id is a public suffix)', () => {
  assert.equal(originMatches(wideItem('https://a.co.id'), 'https://b.co.id', { widen: true }), false);
});

test('widen:true REFUSES across a multi-tenant platform tenant (github.io)', () => {
  assert.equal(originMatches(wideItem('https://alice.github.io'), 'https://bob.github.io', { widen: true }), false);
});

test('widen:true REFUSES a scheme mismatch even in registrable-domain mode (MITM guard)', () => {
  assert.equal(originMatches(wideItem('https://example.com'), 'http://accounts.example.com', { widen: true }), false);
});

test('widen:true fails CLOSED when the PSL misses EITHER host', () => {
  // item host unknown TLD → registrableDomainSafe null → exact fallback (no match).
  assert.equal(originMatches(wideItem('https://example.madeupzzztld'), 'https://a.example.madeupzzztld', { widen: true }), false);
  // tab host unknown TLD.
  assert.equal(originMatches(wideItem('https://example.com'), 'https://foo.madeupzzztld', { widen: true }), false);
});

test('widen:true fails CLOSED when BOTH hosts are PSL-null (e.g. IP literals)', () => {
  assert.equal(originMatches(wideItem('https://192.168.0.1'), 'https://192.168.0.2', { widen: true }), false);
  // Same IP → exact fallback DOES match (byte-for-byte origin equal).
  assert.equal(originMatches(wideItem('https://192.168.0.1'), 'https://192.168.0.1', { widen: true }), true);
});

test('widen:true fails CLOSED on an unparseable origin (falls back to exact)', () => {
  assert.equal(originMatches(wideItem('not a url'), 'https://accounts.example.com', { widen: true }), false);
  assert.equal(originMatches(wideItem('https://example.com'), 'not a url', { widen: true }), false);
  // Opaque "null" origin host → no widen.
  assert.equal(originMatches(wideItem('null'), 'https://example.com', { widen: true }), false);
});

test('widen:true does NOT widen a legacy item (no matchMode) — positive test only', () => {
  assert.equal(originMatches(legacyItem('https://example.com'), 'https://accounts.example.com', { widen: true }), false);
  assert.equal(originMatches(legacyItem('https://example.com'), 'https://example.com', { widen: true }), true); // exact still matches
  // An explicit 'exact' item likewise never widens.
  assert.equal(originMatches(exactItem('https://example.com'), 'https://accounts.example.com', { widen: true }), false);
});
