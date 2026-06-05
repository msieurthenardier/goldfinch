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
