'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { isSafeTabUrl, isSafePosterUrl, isInternalPageUrl } = require('../../src/shared/url-safety');

// ---------------------------------------------------------------------------
// Allowed cases
// ---------------------------------------------------------------------------
test('allows http: URL', () => {
  assert.equal(isSafeTabUrl('http://example.com'), true);
});

test('allows https: URL', () => {
  assert.equal(isSafeTabUrl('https://example.com'), true);
});

test('allows https: URL with path and query', () => {
  assert.equal(isSafeTabUrl('https://example.com/path?q=1&r=2#frag'), true);
});

test('allows about:blank (lowercase)', () => {
  assert.equal(isSafeTabUrl('about:blank'), true);
});

test('allows ABOUT:BLANK (all uppercase)', () => {
  assert.equal(isSafeTabUrl('ABOUT:BLANK'), true);
});

test('allows About:Blank (mixed case)', () => {
  assert.equal(isSafeTabUrl('About:Blank'), true);
});

test('allows http: with leading/trailing whitespace', () => {
  assert.equal(isSafeTabUrl('  https://example.com  '), true);
});

// ---------------------------------------------------------------------------
// Rejected dangerous schemes
// ---------------------------------------------------------------------------
test('rejects file: URL (lowercase)', () => {
  assert.equal(isSafeTabUrl('file:///etc/passwd'), false);
});

test('rejects FILE: URL (uppercase)', () => {
  assert.equal(isSafeTabUrl('FILE:///etc/passwd'), false);
});

test('rejects data: URL', () => {
  assert.equal(isSafeTabUrl('data:text/html,<h1>hi</h1>'), false);
});

test('rejects javascript: URL', () => {
  assert.equal(isSafeTabUrl('javascript:alert(1)'), false);
});

test('rejects blob: URL', () => {
  assert.equal(isSafeTabUrl('blob:https://example.com/uuid'), false);
});

test('rejects chrome: URL', () => {
  assert.equal(isSafeTabUrl('chrome://settings'), false);
});

// ---------------------------------------------------------------------------
// Rejected about: variants (only about:blank is allowed)
// ---------------------------------------------------------------------------
test('rejects about:config', () => {
  assert.equal(isSafeTabUrl('about:config'), false);
});

test('rejects about:srcdoc', () => {
  assert.equal(isSafeTabUrl('about:srcdoc'), false);
});

// ---------------------------------------------------------------------------
// Rejected non-URL / edge inputs
// ---------------------------------------------------------------------------
test('rejects empty string', () => {
  assert.equal(isSafeTabUrl(''), false);
});

test('rejects whitespace-only string', () => {
  assert.equal(isSafeTabUrl('   '), false);
});

test('rejects null', () => {
  assert.equal(isSafeTabUrl(null), false);
});

test('rejects undefined', () => {
  assert.equal(isSafeTabUrl(undefined), false);
});

test('rejects number', () => {
  assert.equal(isSafeTabUrl(42), false);
});

test('rejects object', () => {
  assert.equal(isSafeTabUrl({}), false);
});

test('rejects array', () => {
  assert.equal(isSafeTabUrl([]), false);
});

test('rejects malformed URL (no scheme)', () => {
  assert.equal(isSafeTabUrl('not-a-url'), false);
});

test('rejects protocol-relative URL', () => {
  assert.equal(isSafeTabUrl('//example.com/path'), false);
});

test('rejects javascript: with leading whitespace', () => {
  assert.equal(isSafeTabUrl('  javascript:alert(1)'), false);
});

test('rejects file: with leading whitespace', () => {
  assert.equal(isSafeTabUrl('  file:///etc/passwd'), false);
});

// ---------------------------------------------------------------------------
// isSafePosterUrl — Allowed cases
// ---------------------------------------------------------------------------
test('poster: allows http: URL', () => {
  assert.equal(isSafePosterUrl('http://example.com/poster.jpg'), true);
});

test('poster: allows https: URL', () => {
  assert.equal(isSafePosterUrl('https://example.com/poster.jpg'), true);
});

test('poster: allows https: URL with path and query', () => {
  assert.equal(isSafePosterUrl('https://example.com/poster.jpg?v=1'), true);
});

test('poster: allows blob: URL', () => {
  assert.equal(isSafePosterUrl('blob:https://example.com/550e8400-e29b-41d4-a716-446655440000'), true);
});

test('poster: allows http: with uppercase scheme (HTTP:)', () => {
  assert.equal(isSafePosterUrl('HTTP://example.com/poster.jpg'), true);
});

test('poster: allows https: with uppercase scheme (HTTPS:)', () => {
  assert.equal(isSafePosterUrl('HTTPS://example.com/poster.jpg'), true);
});

test('poster: allows https: with leading/trailing whitespace', () => {
  assert.equal(isSafePosterUrl('  https://example.com/poster.jpg  '), true);
});

// ---------------------------------------------------------------------------
// isSafePosterUrl — Rejected dangerous schemes
// ---------------------------------------------------------------------------
test('poster: rejects data: URL (plain)', () => {
  assert.equal(isSafePosterUrl('data:image/png,abc'), false);
});

test('poster: rejects data: URL with embedded double-quote', () => {
  assert.equal(isSafePosterUrl('data:image/png,x");background:red;url("'), false);
});

test('poster: rejects data: URL with embedded close-paren', () => {
  assert.equal(isSafePosterUrl('data:image/png,x)'), false);
});

test('poster: rejects javascript: URL', () => {
  assert.equal(isSafePosterUrl('javascript:alert(1)'), false);
});

test('poster: rejects file: URL', () => {
  assert.equal(isSafePosterUrl('file:///etc/passwd'), false);
});

test('poster: rejects vbscript: URL', () => {
  assert.equal(isSafePosterUrl('vbscript:MsgBox(1)'), false);
});

// ---------------------------------------------------------------------------
// isSafePosterUrl — Rejected breakout payloads (http: with injected chars)
// ---------------------------------------------------------------------------
test('poster: rejects http: value with injected double-quote', () => {
  // new URL() percent-encodes " → %22 in paths, but test a raw payload anyway
  assert.equal(isSafePosterUrl('http://evil.com/") ; background: red; url("'), false);
});

test('poster: rejects http: value with injected close-paren', () => {
  assert.equal(isSafePosterUrl('http://evil.com/) ; background: red ; url('), false);
});

// ---------------------------------------------------------------------------
// isSafePosterUrl — Rejected non-URL / edge inputs
// ---------------------------------------------------------------------------
test('poster: rejects empty string', () => {
  assert.equal(isSafePosterUrl(''), false);
});

test('poster: rejects whitespace-only string', () => {
  assert.equal(isSafePosterUrl('   '), false);
});

test('poster: rejects null', () => {
  assert.equal(isSafePosterUrl(null), false);
});

test('poster: rejects undefined', () => {
  assert.equal(isSafePosterUrl(undefined), false);
});

test('poster: rejects number', () => {
  assert.equal(isSafePosterUrl(42), false);
});

test('poster: rejects object', () => {
  assert.equal(isSafePosterUrl({}), false);
});

test('poster: rejects malformed URL (no scheme)', () => {
  assert.equal(isSafePosterUrl('not-a-url'), false);
});

test('poster: rejects about:blank', () => {
  assert.equal(isSafePosterUrl('about:blank'), false);
});

// ---------------------------------------------------------------------------
// isInternalPageUrl — only the canonical goldfinch://settings root is trusted.
// NOTE: host-casing (goldfinch://SETTINGS) is intentionally NOT asserted — Electron
// normalizes the host for registered standard schemes but the Node test runner is
// case-preserving, so such an assertion would diverge from runtime.
// ---------------------------------------------------------------------------
test('internal: allows goldfinch://settings', () => {
  assert.equal(isInternalPageUrl('goldfinch://settings'), true);
});

test('internal: allows goldfinch://settings/ (trailing slash)', () => {
  assert.equal(isInternalPageUrl('goldfinch://settings/'), true);
});

test('internal: rejects goldfinch://settings/x (sub-path)', () => {
  assert.equal(isInternalPageUrl('goldfinch://settings/x'), false);
});

test('internal: rejects goldfinch://other host', () => {
  assert.equal(isInternalPageUrl('goldfinch://other'), false);
});

test('internal: rejects https://settings', () => {
  assert.equal(isInternalPageUrl('https://settings'), false);
});

test('internal: rejects file: URL', () => {
  assert.equal(isInternalPageUrl('file:///etc/passwd'), false);
});

test('internal: rejects data: URL', () => {
  assert.equal(isInternalPageUrl('data:text/html,<h1>hi</h1>'), false);
});

test('internal: rejects javascript: URL', () => {
  assert.equal(isInternalPageUrl('javascript:alert(1)'), false);
});

test('internal: rejects empty string', () => {
  assert.equal(isInternalPageUrl(''), false);
});

test('internal: rejects null', () => {
  assert.equal(isInternalPageUrl(null), false);
});

test('internal: rejects undefined', () => {
  assert.equal(isInternalPageUrl(undefined), false);
});

test('internal: rejects number', () => {
  assert.equal(isInternalPageUrl(42), false);
});

test('internal: rejects object', () => {
  assert.equal(isInternalPageUrl({}), false);
});

test('internal: rejects malformed URL (no scheme)', () => {
  assert.equal(isInternalPageUrl('not-a-url'), false);
});
