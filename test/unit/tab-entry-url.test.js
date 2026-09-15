'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { effectiveUrl } = require('../../src/main/tab-entry-url');

function makeEntry(url, lastRequestedUrl) {
  return { view: { webContents: { getURL: () => url } }, lastRequestedUrl };
}

test('effectiveUrl returns the live URL as-is when it is not a chrome-error: URL', () => {
  const entry = makeEntry('https://example.test/page', 'https://example.test/page');
  assert.equal(effectiveUrl(entry), 'https://example.test/page');
});

test('effectiveUrl substitutes lastRequestedUrl when the live URL is chrome-error: and the field is non-null', () => {
  const entry = makeEntry('chrome-error://chromewebdata/', 'http://127.0.0.1:1/');
  assert.equal(effectiveUrl(entry), 'http://127.0.0.1:1/');
});

test('effectiveUrl substitutes even when loadFailure is not set — order-independent (DD4 refinement)', () => {
  // The error document's did-navigate may fire BEFORE did-fail-load records the
  // failure — the predicate reads the live URL directly, never entry.loadFailure.
  const entry = makeEntry('chrome-error://chromewebdata/', 'http://nonexistent-host-abc123xyz.invalid/');
  entry.loadFailure = null;
  assert.equal(effectiveUrl(entry), 'http://nonexistent-host-abc123xyz.invalid/');
});

test('effectiveUrl falls back to the live URL when lastRequestedUrl is null (defensive)', () => {
  const entry = makeEntry('chrome-error://chromewebdata/', null);
  assert.equal(effectiveUrl(entry), 'chrome-error://chromewebdata/');
});

test('effectiveUrl falls back to the live URL when lastRequestedUrl is an empty string (falsy)', () => {
  const entry = makeEntry('chrome-error://chromewebdata/', '');
  assert.equal(effectiveUrl(entry), 'chrome-error://chromewebdata/');
});
