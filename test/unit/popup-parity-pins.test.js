'use strict';

// M14 F2 L2 — source-scan pins for the popup-parity wiring whose runtime
// fallbacks are SILENT (the house "Absent → no behavior change" idiom means a
// forgotten injection produces no test failure anywhere else):
//
//   1. BOTH live engine injection sites carry the popup census/addressability
//      deps (`listPopups` + `isPopupWcId`) — main.js's MCP getEngine and
//      app-lifecycle.js's dev-seam engine (the listWindows grep-pin precedent,
//      restated by this leg).
//   2. main.js's leg-1 no-op cancel stub is REPLACED by the real thin
//      cancelForTab delegation (DD1f seam), and the same seam is threaded into
//      guest-wiring for the self-close teardown path.
//   3. main.js's enumerateWindows accessor feeds popup census entries.
//
// These are grep-AC pins (CLAUDE.md convention): literal, reproducible source
// facts — not behavior tests (the behavior halves live in automation-tabs /
// window-census / auth-challenges suites).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...rel) => fs.readFileSync(path.join(__dirname, '..', '..', ...rel), 'utf8');

test('main.js (MCP getEngine site) injects listPopups + isPopupWcId', () => {
  const src = read('src', 'main', 'main.js');
  assert.ok(src.includes('listPopups: popupTabRows'), 'listPopups injection at the getEngine site');
  assert.ok(src.includes('isPopupWcId: (id) => popupRegistry.isPopupWcId(id)'), 'isPopupWcId injection at the getEngine site');
});

test('app-lifecycle.js (dev-seam engine site) threads listPopups + isPopupWcId into createEngine', () => {
  const src = read('src', 'main', 'app-lifecycle.js');
  const engineIdx = src.indexOf('createEngine(getChromeContents');
  assert.ok(engineIdx !== -1, 'the dev-seam engine construction exists');
  const block = src.slice(engineIdx, src.indexOf('});', engineIdx));
  assert.ok(/\blistPopups\b/.test(block), 'listPopups threaded at the dev-seam site');
  assert.ok(/\bisPopupWcId\b/.test(block), 'isPopupWcId threaded at the dev-seam site');
});

test('main.js: the leg-1 cancel stub is gone; the DD1f seam is the thin cancelForTab delegation, shared with guest-wiring', () => {
  const src = read('src', 'main', 'main.js');
  assert.equal(src.includes('cancelChallengesForPopup: () => {}'), false, 'the no-op stub is replaced');
  assert.ok(src.includes("const cancelChallengesForPopup = (popupWcId) => authChallenges.cancelForTab(popupWcId, 'tab-close')"),
    'the seam is a thin cancelForTab delegation (queue scan / exactly-once / sheet close all live in the store)');
  const wiringIdx = src.indexOf('createGuestWiring({');
  const wiringBlock = src.slice(wiringIdx, src.indexOf('});', wiringIdx));
  assert.ok(/\bcancelChallengesForPopup\b/.test(wiringBlock), 'the SAME seam rides guest-wiring deps (self-close teardown path)');
});

test('main.js: enumerateWindows derives popup census entries at call time', () => {
  const src = read('src', 'main', 'main.js');
  assert.ok(src.includes('buildWindowCensus(registry.records(), registry.getLastFocused(), popupCensusEntries())'),
    'the census accessor appends live popup entries (zero-state discipline)');
});

test('main.js: authChallenges receives the lazy popup-registry routing seam', () => {
  const src = read('src', 'main', 'main.js');
  assert.ok(src.includes('popupRegistry: { getByWcId: (wcId) => popupRegistry.getByWcId(wcId) }'),
    'popup-registry-first challenge routing is wired (DD1b wall 1)');
});
