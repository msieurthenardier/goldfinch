'use strict';

// Sortie 06 Leg 1 (AC23, DD9/N11): CSS <-> builder drift guard. Every class the shared
// vault-capture-template builders assign must appear as a selector in save-prompt.css (the
// prompt page loads ONLY that stylesheet - `new-container-inner` etc. are re-declared there, not
// imported from menu-overlay.css). Source-scan flavor: it THROWS if it collects zero classes
// rather than passing vacuously.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function builderClasses() {
  const src = read('src/shared/vault-capture-template.js');
  const found = new Set();
  // `.className = 'a b'`  and  `classList.add('x')`
  for (const m of src.matchAll(/\.className\s*=\s*'([^']+)'/g)) for (const c of m[1].split(/\s+/)) found.add(c);
  for (const m of src.matchAll(/classList\.add\('([^']+)'\)/g)) found.add(m[1]);
  if (found.size === 0) throw new Error('collected ZERO classes from vault-capture-template.js - the scan is vacuous');
  return found;
}

test('AC23: every class the template builders emit is a selector in save-prompt.css', () => {
  const css = read('src/renderer/save-prompt.css');
  const classes = builderClasses();
  // sanity: the scan really sees the known classes
  for (const known of [
    'new-container-inner',
    'vault-capture-heading',
    'text-btn',
    'save-prompt-timer-fill',
    'hidden'
  ]) {
    assert.ok(classes.has(known), `scan must collect ${known}`);
  }
  const missing = [...classes].filter((c) => !new RegExp(`\\.${c.replace(/[-]/g, '\\-')}(?![\\w-])`).test(css));
  assert.deepEqual(missing, [], `save-prompt.css is missing selectors for: ${missing.join(', ')}`);
});

test('AC23: the page-level classes save-prompt.js toggles (paused / failure) are styled', () => {
  const css = read('src/renderer/save-prompt.css');
  const js = read('src/renderer/save-prompt.js');
  for (const m of js.matchAll(/classList\.(?:toggle|add|remove)\('([\w-]+)'/g)) {
    assert.match(css, new RegExp(`\\.${m[1]}(?![\\w-])`), `${m[1]} has a rule`);
  }
});

test('AC23: the vault-capture sheet CSS is RETIRED from menu-overlay.css', () => {
  const css = read('src/renderer/menu-overlay.css');
  assert.equal(css.includes('#sheet-vault-capture'), false);
  assert.equal(/\.vault-capture-/.test(css), false, 'no .vault-capture-* rule remains in the sheet stylesheet');
});

test('AC23: menu-overlay.html no longer loads vault-capture-template.js', () => {
  const html = read('src/renderer/menu-overlay.html');
  assert.equal(html.includes('vault-capture-template'), false);
});
