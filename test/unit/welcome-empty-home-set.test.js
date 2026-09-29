'use strict';
// Squawk 0109: an empty Set on the welcome surface writes the unset sentinel
// (null, never '') and shows a state-derived confirmation, not a validation
// error. Source-scan pin (welcome-controller.js is a browser-side factory).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../../src/renderer/chrome/welcome-controller.js'), 'utf8');

test('submitHome maps an empty normalized input to null before welcomeSetPreference', () => {
  assert.match(source, /const\s+value\s*=\s*normalized\s*===\s*''\s*\?\s*null\s*:\s*normalized\s*;/);
  assert.match(source, /welcomeSetPreference\(\s*\{\s*key:\s*'homePage',\s*value\s*\}\s*\)/);
});

test('render derives the cleared confirmation from state so a re-render cannot blank it', () => {
  assert.match(source, /homeClearedTab\s*===\s*tab\s*\?\s*HOME_CLEARED_MESSAGE\s*:\s*''/);
  assert.match(source, /homeClearedTab\s*=\s*value\s*===\s*null\s*\?\s*tab\s*:\s*null/);
});

test('cleared confirmation is per-record: reset on hide() and when show() picks a different record', () => {
  assert.doesNotMatch(source, /\bhomeCleared\b/, 'no factory-wide boolean');
  assert.match(
    source,
    /function\s+show\(tab\)\s*\{\s*if\s*\(homeClearedTab\s*!==\s*tab\)\s*homeClearedTab\s*=\s*null\s*;/
  );
  assert.match(source, /function\s+hide\(\)\s*\{\s*currentTab\s*=\s*null\s*;\s*homeClearedTab\s*=\s*null\s*;/);
  const mutated = source.replace(/homeClearedTab\s*=\s*null\s*;(\s*root\.classList\.add)/, '$1');
  assert.notEqual(mutated, source, 'mutation must apply');
  assert.doesNotMatch(mutated, /function\s+hide\(\)\s*\{\s*currentTab\s*=\s*null\s*;\s*homeClearedTab/);
});

test('neuter: dropping the null mapping is caught by the pin', () => {
  const mutated = source.replace(/normalized\s*===\s*''\s*\?\s*null\s*:\s*normalized/, 'normalized');
  assert.notEqual(mutated, source, 'mutation must apply');
  assert.doesNotMatch(mutated, /normalized\s*===\s*''\s*\?\s*null/);
});
