'use strict';

// Sortie 01 (default browser) DD1: the single-instance lock. Electron keys the lock on the
// userData dir, so it must sit AFTER the dev-profile redirect (dev and installed builds
// coexist) and BEFORE crashReporter.start / registerAppLifecycle (a losing instance must
// open no store, mint no key, write no snapshot). The loser leaves with app.exit(0) then
// process.exit(0) — never app.quit() (the whenReady chain would still run) and never a
// top-level return (TS1108 under checkJs).
//
// Source-scan pin over comment-masked main.js (see dev-profile-redirect-order.test.js).
// Every neuter mutation is guarded by assertMutated so a stale regex fails loudly.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { maskComments } = require('../helpers/source-scan');

const MAIN_JS = path.join(__dirname, '..', '..', 'src', 'main', 'main.js');
const masked = maskComments(fs.readFileSync(MAIN_JS, 'utf8'));

function assertMutated(before, after, what) {
  assert.notEqual(after, before, `the ${what} mutation did not apply — the .replace() target is stale`);
}

const LOCK_BLOCK_RE =
  /(const gotSingleInstanceLock = app\.requestSingleInstanceLock\(\);\s*if \(!gotSingleInstanceLock\) \{[\s\S]*?\n\})/;
const REDIRECT_RE = /if \(!app\.isPackaged\) \{\s*app\.setPath\('userData'/;

/** @returns {string[]} violations (empty = the pinned shape holds) */
function violations(src) {
  const out = [];
  const count = (src.match(/app\.requestSingleInstanceLock\(/g) || []).length;
  if (count !== 1) out.push(`requestSingleInstanceLock( appears ${count}x, expected exactly 1`);
  const redirect = src.search(REDIRECT_RE);
  const lock = src.indexOf('app.requestSingleInstanceLock(');
  const crash = src.indexOf('crashReporter.start(');
  const lifecycle = src.indexOf('registerAppLifecycle(');
  if ([redirect, lock, crash, lifecycle].some((i) => i === -1)) out.push('a sanity marker is missing');
  else if (!(redirect < lock && lock < crash && crash < lifecycle)) {
    out.push('order must be: dev redirect < lock < crashReporter.start( < registerAppLifecycle(');
  }
  const m = src.match(LOCK_BLOCK_RE);
  if (!m) out.push('lock failure-branch shape not found');
  else {
    const branch = m[1];
    if (!/app\.exit\(0\);\s*process\.exit\(0\);/.test(branch))
      out.push('failure branch must be app.exit(0); process.exit(0);');
    if (/app\.quit\(/.test(branch)) out.push('failure branch must not call app.quit(');
    if (/\breturn\b/.test(branch)) out.push('failure branch must not use a top-level return');
  }
  return out;
}

test('the real main.js satisfies the lock pin (with live sanity markers)', () => {
  assert.deepEqual(violations(masked), []);
  assert.match(masked, REDIRECT_RE, 'sanity: redirect marker present');
  assert.ok(masked.includes('crashReporter.start('), 'sanity: crashReporter marker present');
});

test('neuter: moving the lock above the dev redirect turns the pin red', () => {
  const m = masked.match(LOCK_BLOCK_RE);
  assert.ok(m, 'lock block must be found');
  const removed = masked.replace(LOCK_BLOCK_RE, '');
  assertMutated(masked, removed, 'lock removal');
  const moved = removed.replace(/(if \(!app\.isPackaged\) \{\s*app\.setPath\('userData')/, (hit) => `${m[1]}\n${hit}`);
  assertMutated(removed, moved, 'lock re-insert above redirect');
  assert.notDeepEqual(violations(moved), []);
});

test('neuter: swapping app.exit for app.quit turns the pin red', () => {
  const swapped = masked.replace(/(if \(!gotSingleInstanceLock\) \{\s*)app\.exit\(0\)/, '$1app.quit()');
  assertMutated(masked, swapped, 'exit->quit swap');
  assert.notDeepEqual(violations(swapped), []);
});

test('neuter: a top-level return or a second lock call turns the pin red', () => {
  const returned = masked.replace(/(process\.exit\(0\);)(\s*\n\})/, '$1 return;$2');
  assertMutated(masked, returned, 'return insert');
  assert.notDeepEqual(violations(returned), []);
  const doubled = masked.replace(/(const gotSingleInstanceLock)/, 'app.requestSingleInstanceLock();\n$1');
  assertMutated(masked, doubled, 'duplicate lock call');
  assert.notDeepEqual(violations(doubled), []);
});
