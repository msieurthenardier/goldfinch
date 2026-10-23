'use strict';

// Sortie 05 (AC6): renderer.js constructs `pageActions` BEFORE it hands
// `pageActions.kebabActions` to createOverlayDispatch. `pageActions` is `let`-declared
// early, so a reversed order is not a TDZ throw but `undefined.kebabActions` at load.
// Source-scan with wrap-insensitive regexes (Prettier re-wrap safe); assertMutated guards
// the neuter so a no-op swap cannot pass vacuously.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'renderer.js'), 'utf8');

const ASSIGN_RE = /pageActions\s*=\s*createChromePageActions\(/;
const CONSTRUCT_RE = /createOverlayDispatch\(/;

function orderOk(text) {
  const a = ASSIGN_RE.exec(text);
  const c = CONSTRUCT_RE.exec(text);
  assert.ok(a, 'pageActions = createChromePageActions( assignment must exist (vacuity guard)');
  assert.ok(c, 'createOverlayDispatch( call must exist (vacuity guard)');
  return a.index < c.index;
}

test('renderer.js assigns pageActions before constructing createOverlayDispatch', () => {
  assert.equal(orderOk(SRC), true);
});

test('renderer.js passes pageActions.kebabActions as KEBAB_ACTIONS and keeps the seam wrapper', () => {
  assert.match(SRC, /KEBAB_ACTIONS:\s*pageActions\.kebabActions/);
  assert.match(SRC, /function kebabActionSettings\(\)\s*\{\s*return pageActions\.kebabActions\.settings\(\);\s*\}/);
  assert.doesNotMatch(SRC, /const KEBAB_ACTIONS\b/);
});

test('neuter: swapping the order is detected', () => {
  // Swap by relocating the token texts' positions: mutate the text so the construction
  // call appears first.
  const mutated = 'createOverlayDispatch(\n' + SRC;
  assert.notEqual(mutated, SRC);
  assert.equal(orderOk(mutated), false);
});
