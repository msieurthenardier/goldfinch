'use strict';

// Squawk 0017 (squawks/0017-dev-profile-redirect-after-ready.md): GitHub issue #121.
// The dev-profile `app.setPath('userData', …)` redirect ran inside
// `app.whenReady().then(...)` (init-profile.js's initProfileAndStores, called from
// app-lifecycle.js's whenReady chain) — later than Electron's documented guidance.
// Electron resolves the browser process's own `--user-data-dir` (and so every Chromium
// CHILD process's inherited copy) during startup, ahead of the ready event, so a setPath
// that only runs after whenReady is too late: dev-launched child processes kept carrying
// the REAL profile's `--user-data-dir` even though the main process itself read/wrote the
// -dev directory.
//
// Fix: move the `!app.isPackaged` setPath to main.js MODULE SCOPE, beside
// `registerSchemesAsPrivileged` / `setAppUserModelId` — squawk 0002's placement
// precedent (test/unit/app-user-model-id.test.js). Store ordering (appDb.open, then the
// five store loads) stays in init-profile.js — see test/unit/init-profile-order.test.js
// for that invariant, re-pinned to no longer assert a setPath step.
//
// This is a source-scan pin (the house pattern for main.js — see
// test/unit/app-user-model-id.test.js and test/helpers/source-scan.js's header: main.js
// can't be require()'d directly under plain `node --test`, it pulls in real Electron
// classes the electron stub doesn't provide, and its top-level code has app-wide side
// effects). It pins what IS checkable offline:
//   1. main.js calls app.setPath('userData', devUserDataPath(app.getPath('userData'))).
//   2. The call is guarded by `if (!app.isPackaged) {`.
//   3. The call's source position precedes registerAppLifecycle(...) — the call that
//      wires up app.whenReady() and, inside it, initProfileAndStores / the first
//      createWindow() invocation (src/main/app-lifecycle.js). main.js's setPath call
//      sits at MODULE LOAD, so it always runs before that wiring is even registered,
//      let alone before whenReady resolves.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { maskComments } = require('../helpers/source-scan');

const REPO_ROOT = path.join(__dirname, '..', '..');
const MAIN_JS = path.join(REPO_ROOT, 'src', 'main', 'main.js');

function readMaskedMain() {
  return maskComments(fs.readFileSync(MAIN_JS, 'utf8'));
}

const EXPECTED_CALL = "app.setPath('userData', devUserDataPath(app.getPath('userData')))";

test('main.js redirects userData to the dev path via devUserDataPath', () => {
  const masked = readMaskedMain();
  assert.ok(masked.includes(EXPECTED_CALL), `expected main.js to call ${EXPECTED_CALL}`);
});

test('the dev-profile userData redirect is guarded to unpackaged runs only', () => {
  const masked = readMaskedMain();
  const callIdx = masked.indexOf(EXPECTED_CALL);
  assert.notEqual(callIdx, -1, `expected an ${EXPECTED_CALL} call in main.js`);

  // The nearest preceding `if (` must be the isPackaged guard, with nothing else
  // (no unrelated statement) between the guard and the call.
  const guardIdx = masked.lastIndexOf('if (', callIdx);
  assert.notEqual(guardIdx, -1, 'expected an `if (...)` guard before the setPath call');
  const guardSlice = masked.slice(guardIdx, callIdx);
  assert.match(
    guardSlice,
    /if \(\s*!app\.isPackaged\s*\)\s*\{\s*$/,
    'expected the immediately-enclosing guard to be `if (!app.isPackaged) {`'
  );
});

test('the dev-profile userData redirect runs before app-lifecycle wiring (and so before app.whenReady())', () => {
  const masked = readMaskedMain();
  const callIdx = masked.indexOf(EXPECTED_CALL);
  assert.notEqual(callIdx, -1, `expected an ${EXPECTED_CALL} call in main.js`);

  // registerAppLifecycle(...) is the call that wires app.whenReady().then(...), inside
  // which app-lifecycle.js calls initProfileAndStores(...) and (eventually) the first
  // createWindow(). The redirect sits at main.js's top level (module load), so it must
  // precede even the REGISTRATION call, well before whenReady ever resolves.
  const lifecycleIdx = masked.indexOf('registerAppLifecycle(');
  assert.notEqual(lifecycleIdx, -1, 'expected a registerAppLifecycle(...) call in main.js');

  assert.ok(
    callIdx < lifecycleIdx,
    'the dev-profile redirect must run before registerAppLifecycle(...) wires app.whenReady()'
  );

  // Sanity guard against a vacuous pass: prove the comparison has teeth by confirming
  // app-lifecycle.js itself calls initProfileAndStores inside whenReady, downstream of
  // registerAppLifecycle's call site above (not some unrelated hit).
  const lifecycleSrc = fs.readFileSync(path.join(REPO_ROOT, 'src', 'main', 'app-lifecycle.js'), 'utf8');
  assert.match(
    lifecycleSrc,
    /app\.whenReady\(\)\.then\(/,
    'expected app-lifecycle.js to wire initProfileAndStores inside app.whenReady().then(...)'
  );
  assert.ok(
    lifecycleSrc.indexOf('initProfileAndStores(') > lifecycleSrc.indexOf('app.whenReady()'),
    'expected initProfileAndStores(...) to be called after app.whenReady() inside app-lifecycle.js'
  );
});

test('main.js imports devUserDataPath from the shared dev-profile helper', () => {
  const masked = readMaskedMain();
  assert.match(
    masked,
    /require\(\s*['"]\.\.\/shared\/dev-profile(?:\.js)?['"]\s*\)/,
    'expected main.js to require ../shared/dev-profile (reuse, not duplicate, the path-derivation helper)'
  );
});
