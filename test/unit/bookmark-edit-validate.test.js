'use strict';

// Unit tests for the bookmark-edit sheet's pure, Electron-free per-field
// validator (M15 F1 Leg 2, flight DD4/AC "two rejection paths, two UXes" —
// this is rejection path (a), the pre-forward validation).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { validateBookmarkEditFields } = require('../../src/main/bookmark-edit-validate');

test('valid name + http(s) url passes through trimmed', () => {
  assert.deepEqual(validateBookmarkEditFields({ name: '  Example  ', url: '  https://example.com/  ' }), {
    ok: true,
    name: 'Example',
    url: 'https://example.com/'
  });
  assert.deepEqual(validateBookmarkEditFields({ name: 'Example', url: 'http://example.com/' }), {
    ok: true,
    name: 'Example',
    url: 'http://example.com/'
  });
});

test('empty/whitespace-only name is rejected', () => {
  for (const name of ['', '   ', undefined, null, 42]) {
    assert.deepEqual(validateBookmarkEditFields({ name, url: 'https://example.com/' }), { ok: false });
  }
});

test('malformed/unsafe/internal urls are rejected — never widen past isSafeTabUrl', () => {
  for (const url of [
    '',
    '   ',
    undefined,
    null,
    42,
    'not a url',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'data:text/html,hi',
    'goldfinch://settings',
    'goldfinch://vault',
    'chrome://settings'
  ]) {
    assert.deepEqual(validateBookmarkEditFields({ name: 'Example', url }), { ok: false });
  }
});

test("about:blank is rejected (mirrors the store's own validUrl — never a bookmarkable url)", () => {
  for (const url of ['about:blank', 'ABOUT:BLANK', '  about:blank  ']) {
    assert.deepEqual(validateBookmarkEditFields({ name: 'Example', url }), { ok: false });
  }
});

test('missing fields object defaults to an empty bag — rejected, never throws', () => {
  assert.deepEqual(validateBookmarkEditFields(), { ok: false });
  assert.deepEqual(validateBookmarkEditFields({}), { ok: false });
});
