'use strict';

// Unit tests for src/shared/bookmark-url.js (DD2, M15 Flight 1 "Bookmarking
// Core and Surfaces" Leg 1) — the exact-committed-URL-match predicate shared
// by the store's add()/update() dedupe (and, in later legs, star fill /
// re-star toggling / omnibox dedup).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bookmarkUrlsMatch } = require('../../src/shared/bookmark-url');

test('identical strings match', () => {
  assert.equal(bookmarkUrlsMatch('https://example.com/', 'https://example.com/'), true);
});

test('a fragment difference does NOT match (DD2 — exact string, no fragment stripping)', () => {
  assert.equal(bookmarkUrlsMatch('https://example.com/page', 'https://example.com/page#section'), false);
});

test('a trailing-slash difference does NOT match (no normalization beyond what already happened upstream)', () => {
  assert.equal(bookmarkUrlsMatch('https://example.com', 'https://example.com/'), false);
});

test('a query-string difference does NOT match', () => {
  assert.equal(bookmarkUrlsMatch('https://example.com/?a=1', 'https://example.com/?a=2'), false);
});

test('a case difference in the path does NOT match (plain string equality, no case-folding)', () => {
  assert.equal(bookmarkUrlsMatch('https://example.com/Page', 'https://example.com/page'), false);
});

test('empty string only matches empty string', () => {
  assert.equal(bookmarkUrlsMatch('', ''), true);
  assert.equal(bookmarkUrlsMatch('', 'https://example.com/'), false);
});

test('non-string inputs never match and never throw', () => {
  assert.doesNotThrow(() => {
    assert.equal(bookmarkUrlsMatch(null, 'https://example.com/'), false);
    assert.equal(bookmarkUrlsMatch(undefined, undefined), false);
    assert.equal(bookmarkUrlsMatch(42, 42), false);
    assert.equal(bookmarkUrlsMatch({}, {}), false);
    assert.equal(bookmarkUrlsMatch(['https://example.com/'], 'https://example.com/'), false);
  });
});
