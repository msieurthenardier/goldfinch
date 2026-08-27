'use strict';

// Squawk 0002 (squawks/0002-windows-taskbar-pin-aumid.md): on Windows, pinning the
// installed app to the taskbar survives a normal quit/relaunch but was lost across an
// installer-driven update — the running process never claimed the AppUserModelID that
// electron-builder stamps onto the shortcut it creates (build.appId in package.json),
// so Windows couldn't reconcile the pin across NSIS's uninstall-then-reinstall swap
// (electron-builder #1293, #926, #2514).
//
// The end-to-end taskbar-pin behavior only manifests on a real Windows install→update
// cycle and is NOT automatable here (no Windows shell, no NSIS, no taskbar). This is a
// source-scan pin (the house pattern for main.js — see test/unit/broadcast-invariant.test.js
// and test/helpers/source-scan.js's header — main.js can't be require()'d directly under
// plain `node --test`: it pulls in real Electron classes like BaseWindow that the
// electron stub doesn't provide, and its top-level code has app-wide side effects). It
// pins what IS checkable offline:
//   1. main.js calls app.setAppUserModelId with the EXACT literal from package.json's
//      build.appId — built from the parsed JSON, never retyped, so the two can't
//      silently drift.
//   2. The call is guarded to run only on win32 (the API is a Windows-only no-op
//      elsewhere, but an unguarded call would still be dead weight on other platforms).
//   3. The call's source position precedes registerAppLifecycle(...) — the call that
//      wires up app.whenReady() and, inside it, the first createWindow() invocation
//      (src/main/app-lifecycle.js). main.js's setAppUserModelId call sits at MODULE
//      LOAD, so it always runs before that wiring is even registered, let alone before
//      whenReady resolves and a window gets created.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { maskComments } = require('../helpers/source-scan');

const REPO_ROOT = path.join(__dirname, '..', '..');
const MAIN_JS = path.join(REPO_ROOT, 'src', 'main', 'main.js');

function readPackageJson() {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
}

function readMaskedMain() {
  return maskComments(fs.readFileSync(MAIN_JS, 'utf8'));
}

test('main.js claims the exact package.json build.appId as its AppUserModelID', () => {
  const pkg = readPackageJson();
  const appId = pkg.build && pkg.build.appId;
  assert.equal(typeof appId, 'string', 'package.json build.appId must be a string');
  assert.ok(appId.length > 0, 'package.json build.appId must be non-empty');

  const masked = readMaskedMain();
  // Built from the parsed appId, not a second hand-typed literal — a changed
  // build.appId with no matching main.js update fails THIS assertion, not a
  // hardcoded duplicate that could drift unnoticed.
  const expectedCall = `app.setAppUserModelId('${appId}')`;
  assert.ok(
    masked.includes(expectedCall),
    `expected main.js to call ${expectedCall} (derived from package.json build.appId="${appId}")`
  );
});

test('the AppUserModelID claim is guarded to win32 only', () => {
  const masked = readMaskedMain();
  const callIdx = masked.indexOf('app.setAppUserModelId(');
  assert.notEqual(callIdx, -1, 'expected an app.setAppUserModelId(...) call in main.js');

  // The nearest preceding `if (` must be the win32 platform guard, with nothing
  // else (no unrelated statement) between the guard and the call.
  const guardIdx = masked.lastIndexOf('if (', callIdx);
  assert.notEqual(guardIdx, -1, 'expected an `if (...)` guard before the setAppUserModelId call');
  const guardSlice = masked.slice(guardIdx, callIdx);
  assert.match(
    guardSlice,
    /if \(\s*process\.platform === 'win32'\s*\)\s*\{\s*$/,
    "expected the immediately-enclosing guard to be `if (process.platform === 'win32') {`"
  );
});

test('the AppUserModelID claim runs before app-lifecycle wiring (and so before any window is created)', () => {
  const masked = readMaskedMain();
  const callIdx = masked.indexOf('app.setAppUserModelId(');
  assert.notEqual(callIdx, -1, 'expected an app.setAppUserModelId(...) call in main.js');

  // registerAppLifecycle(...) is the call that wires app.whenReady().then(...), inside
  // which app-lifecycle.js makes the FIRST createWindow() call (session-restore or
  // fresh-boot branch). setAppUserModelId sits at main.js's top level (module load),
  // so it must precede even the REGISTRATION call, well before any window exists.
  const lifecycleIdx = masked.indexOf('registerAppLifecycle(');
  assert.notEqual(lifecycleIdx, -1, 'expected a registerAppLifecycle(...) call in main.js');

  assert.ok(
    callIdx < lifecycleIdx,
    'setAppUserModelId must run before registerAppLifecycle(...) wires app.whenReady() / createWindow()'
  );

  // Sanity guard against a vacuous pass: prove the comparison has teeth by
  // confirming app-lifecycle.js itself creates the first window inside whenReady,
  // downstream of registerAppLifecycle's call site above (not some unrelated hit).
  const lifecycleSrc = fs.readFileSync(path.join(REPO_ROOT, 'src', 'main', 'app-lifecycle.js'), 'utf8');
  assert.match(
    lifecycleSrc,
    /app\.whenReady\(\)\.then\(/,
    'expected app-lifecycle.js to wire the first window inside app.whenReady().then(...)'
  );
  assert.ok(
    lifecycleSrc.indexOf('createWindow(') > lifecycleSrc.indexOf('app.whenReady()'),
    'expected createWindow() to be called after app.whenReady() inside app-lifecycle.js'
  );
});
