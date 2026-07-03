'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { sanitizeActivatedValue, MAX_ACTIVATED_VALUE_LENGTH } = require('../../src/main/menu-overlay-value');

// AC5: main validates the channel-4 `value` (string, length ≤ 24) via this pure
// helper before forwarding on channel 6; non-string/oversize → undefined (the
// payload is forwarded WITHOUT value).

test('cap matches the dialog input maxlength (24)', () => {
  assert.equal(MAX_ACTIVATED_VALUE_LENGTH, 24);
});

test('strings within the cap pass through unchanged', () => {
  assert.equal(sanitizeActivatedValue('Shopping'), 'Shopping');
  assert.equal(sanitizeActivatedValue(''), ''); // empty string is a valid string (chrome trims)
  assert.equal(sanitizeActivatedValue('  padded  '), '  padded  '); // trim is chrome-side, not here
  assert.equal(sanitizeActivatedValue('a'.repeat(24)), 'a'.repeat(24)); // boundary
});

test('oversize strings are dropped', () => {
  assert.equal(sanitizeActivatedValue('a'.repeat(25)), undefined);
  assert.equal(sanitizeActivatedValue('x'.repeat(1000)), undefined);
});

test('non-strings are dropped', () => {
  assert.equal(sanitizeActivatedValue(undefined), undefined);
  assert.equal(sanitizeActivatedValue(null), undefined);
  assert.equal(sanitizeActivatedValue(42), undefined);
  assert.equal(sanitizeActivatedValue(true), undefined);
  assert.equal(sanitizeActivatedValue({}), undefined);
  assert.equal(sanitizeActivatedValue(['a']), undefined);
  assert.equal(sanitizeActivatedValue(Symbol('s')), undefined);
});
