'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { isSafeColor } = require('../../src/shared/safe-color');

// The extraction is a re-export seam: jars.js must keep exposing the SAME function
// (test/unit/jars.test.js requires it from src/main/jars — pinned here by identity).
require('../helpers/electron-stub');
const jars = require('../../src/main/jars');

test('jars.js re-exports the shared isSafeColor (same function, not a copy)', () => {
  assert.equal(jars.isSafeColor, isSafeColor);
});

// ---------------------------------------------------------------------------
// HEX domain: 3/4/6/8 hex digits (4/8 are CSS4 RGBA shorthand)
// ---------------------------------------------------------------------------
test('accepts 3/4/6/8-digit hex colors', () => {
  assert.equal(isSafeColor('#abc'), true);
  assert.equal(isSafeColor('#abc8'), true);
  assert.equal(isSafeColor('#9aa0ac'), true);
  assert.equal(isSafeColor('#11223344'), true);
  assert.equal(isSafeColor('#F5C518'), true); // case-insensitive hex
});

test('rejects 5/7-digit hex and malformed hex', () => {
  assert.equal(isSafeColor('#abcde'), false);
  assert.equal(isSafeColor('#1234567'), false);
  assert.equal(isSafeColor('#xyz'), false);
  assert.equal(isSafeColor('abc123'), false); // no leading #  → keyword rule rejects digits
  assert.equal(isSafeColor('#'), false);
});

// ---------------------------------------------------------------------------
// KEYWORD domain: letters-only, ≤20 chars
// ---------------------------------------------------------------------------
test('accepts CSS color keywords (letters-only, ≤20 chars)', () => {
  assert.equal(isSafeColor('red'), true);
  assert.equal(isSafeColor('rebeccapurple'), true);
  assert.equal(isSafeColor('Tomato'), true);
});

test('rejects >20-letter strings and non-letter keywords', () => {
  assert.equal(isSafeColor('a'.repeat(21)), false);
  assert.equal(isSafeColor('a'.repeat(20)), true); // boundary
  assert.equal(isSafeColor(''), false);
});

// ---------------------------------------------------------------------------
// Injection strings and non-strings
// ---------------------------------------------------------------------------
test('rejects injection-shaped values', () => {
  assert.equal(isSafeColor('red;background:url(x)'), false);
  assert.equal(isSafeColor('rgb(1,2,3)'), false);
  assert.equal(isSafeColor('red"><script>'), false);
  assert.equal(isSafeColor('var(--x)'), false);
  assert.equal(isSafeColor('red green'), false); // space
});

test('rejects non-string values', () => {
  assert.equal(isSafeColor(null), false);
  assert.equal(isSafeColor(undefined), false);
  assert.equal(isSafeColor(123), false);
  assert.equal(isSafeColor({}), false);
  assert.equal(isSafeColor(['red']), false);
});
