'use strict';

// Sortie 07 (AC15): renderer.js is not unit-reachable, so this source pin is the only proof
// the toolbar page-context menu receives `automationHeld`: the `pageContextModel(` call must
// spread `...vaultController.vaultMenuOpts()`. Wrap-insensitive regex (Prettier re-wrap safe);
// the neuter mutation is asserted to change the source so it cannot pass vacuously.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { maskComments } = require('../helpers/source-scan');

const SRC = maskComments(fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'renderer.js'), 'utf8'));

const CALL_RE =
  /pageContextModel\(\s*pageCtx\.params\s*,\s*pageCtx\.toolbarItem\s*,\s*\{(?:(?!\n\s*\}\s*\))[\s\S])*?\.\.\.\s*vaultController\.vaultMenuOpts\(\)/;

test('renderer.js spreads vaultController.vaultMenuOpts() into the pageContextModel opts', () => {
  assert.ok(CALL_RE.test(SRC), 'the pageContextModel( call must spread ...vaultController.vaultMenuOpts()');
});

test('neuter: removing the spread is detected', () => {
  const mutated = SRC.replace(/\.\.\.\s*vaultController\.vaultMenuOpts\(\)/, 'vaultLocked: false');
  assert.notEqual(mutated, SRC, 'the mutation actually changed the source');
  assert.equal(CALL_RE.test(mutated), false);
});
