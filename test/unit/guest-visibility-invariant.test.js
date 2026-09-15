'use strict';

// Mission 20 Flight 1 (DD1/AC7): a source-pin (the "Grep-AC convention",
// CLAUDE.md) over the two-axis guest visibility/focus invariant —
// `applyGuestVisibility(entry)` is the ONE place a guest view is ever shown,
// and a failed active tab is never focused. This is not a behavior test; the
// behavior itself is pinned by the guest-wiring.test.js / register-tab-ipc.test.js
// call-order and call-site assertions.
//
// register-browser-ipc.js:499's `wc.focus()` (`page-context-correct`, the
// spelling-correction commit) is DELIBERATELY not gated here: it is reachable
// only from a guest `context-menu` event, and a hidden guest (DD1's failed-tab
// invariant) cannot raise one — structurally unreachable while hidden, not an
// enumerated show site.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const registerTabIpcSrc = fs.readFileSync(path.join(repoRoot, 'src', 'main', 'register-tab-ipc.js'), 'utf8');
const guestWiringSrc = fs.readFileSync(path.join(repoRoot, 'src', 'main', 'guest-wiring.js'), 'utf8');

test('register-tab-ipc.js: no unconditional guest show — grep for the literal setVisible(true) is empty', () => {
  assert.equal(
    registerTabIpcSrc.includes('setVisible(true)'),
    false,
    'every guest SHOW site must route through applyGuestVisibility(entry), never a bare setVisible(true)'
  );
});

test('register-tab-ipc.js: applyGuestVisibility is exported and called at >= 2 sites in this file', () => {
  assert.match(registerTabIpcSrc, /module\.exports = \{ registerTabIpc, applyGuestVisibility \};/);
  const callSites = registerTabIpcSrc.match(/applyGuestVisibility\(entry\);/g) || [];
  assert.ok(
    callSites.length >= 2,
    `expected >= 2 applyGuestVisibility(entry) call sites in register-tab-ipc.js, found ${callSites.length}`
  );
});

test('guest-wiring.js: applyGuestVisibility appears as an injected dep and is called at >= 2 sites', () => {
  assert.match(guestWiringSrc, /applyGuestVisibility,/);
  const callSites = guestWiringSrc.match(/applyGuestVisibility\(entry\);/g) || [];
  assert.ok(
    callSites.length >= 2,
    `expected >= 2 applyGuestVisibility(entry) call sites in guest-wiring.js, found ${callSites.length}`
  );
});

test('the helper name appears at >= 3 call sites across the two files combined', () => {
  const combined =
    (registerTabIpcSrc.match(/applyGuestVisibility\(entry\);/g) || []).length +
    (guestWiringSrc.match(/applyGuestVisibility\(entry\);/g) || []).length;
  assert.ok(combined >= 3, `expected >= 3 total call sites, found ${combined}`);
});

test("register-tab-ipc.js: tab-focus-guest's body references loadFailure (the focus-axis refusal)", () => {
  const start = registerTabIpcSrc.indexOf("ipcMain.handle('tab-focus-guest'");
  assert.ok(start !== -1, 'tab-focus-guest handler not found');
  const end = registerTabIpcSrc.indexOf('});', start);
  const body = registerTabIpcSrc.slice(start, end);
  assert.match(body, /loadFailure/);
});

test('register-tab-ipc.js: the tab-set-active incoming-focus re-arm is gated on loadFailure', () => {
  const start = registerTabIpcSrc.indexOf("ipcMain.on('tab-set-active'");
  assert.ok(start !== -1, 'tab-set-active handler not found');
  assert.match(
    registerTabIpcSrc.slice(start),
    /wasPageFocused[\s\S]{0,200}?!entry\.loadFailure\)\s*\{\s*\n\s*entry\.view\.webContents\.focus\(\);/
  );
});
