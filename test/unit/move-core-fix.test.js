'use strict';

// Move-core fix pin (M09 Flight 9, Leg 1 — DD8 / F8 Rec 5) — a source-scan test in the
// move-tab-synchrony.test.js / broadcast-invariant.test.js house pattern, pinning the CODE
// SHAPE of the fix that removed the disarm-then-hand-compensate pattern from the move core.
//
// WHAT THE FIX WAS. `moveTabIntoWindow` used to PRE-SET `target.activeTabWcId = p.wcId`
// before the adopt round-trip. That pre-set DISARMED `tab-set-active`'s guard
// (`owner.activeTabWcId !== null && owner.activeTabWcId !== wcId`), which gates TWO effects
// on the target: hiding the displaced (outgoing) guest, and `closeMenuOverlay('tab-switch')`.
// Disarmed, the round-trip skipped both, so the core hand-mirrored them — the classic
// "disarm a guard, then compensate for what it guarded" pattern that produced F8 HIGH-1's
// double-active AND the re-shown stale menu (two defects one branch apart). Leg 1 (Fix 2,
// no caption override) REMOVES the pre-set: `activeTabWcId` now holds the OLD active until
// the round-trip's tab-set-active sets it, so the guard is ARMED and re-does both effects
// idempotently. The core KEEPS the synchronous hide + menu-close so the interim window
// never shows two guests (the property leg 4's `tab-tearoff` row 8a asserts).
//
// WHAT THIS PINS, AND WHAT IT DOES NOT. This is a CODE-SHAPE pin, not a runtime one — this
// repo has no main-process harness (main.js is never executed by any test). The RUNTIME
// reading (no window ends two-active; no stale menu re-shown) is LEG 4's, via the
// `tab-tearoff` row 8a + displaced-menu residual behavior test. Stated here so no one reads
// this file as runtime proof it is not.
//
// Two directions per DD10, on the REAL main.js, mutated IN MEMORY (no file is written):
//   - the pre-set `target.activeTabWcId = p.wcId` is GONE from the core (mutate it back → present);
//   - the synchronous hide `setVisible(false)` AND `closeMenuOverlay('tab-switch')` REMAIN
//     inside the core (mutate either away → the pin fails).
//
// MASKED, and here the mask is LOAD-BEARING, not merely defensive: the rewritten
// hand-compensation comment in main.js NAMES `target.activeTabWcId = p.wcId`,
// `closeMenuOverlay('tab-switch')` and `setVisible(true)` in prose (it explains the removed
// pre-set and the two mirrored effects). An UNMASKED scan for the pre-set would therefore
// read it out of the comment and report the fix as un-applied. The control test at the end
// asserts the unmasked reading is NON-zero, proving the mask is doing the work.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { maskComments, findMatchingBracket } = require('../helpers/source-scan');

const MAIN_JS = path.join(__dirname, '../../src/main/main.js');

// The move core's body — anchored on the function name (never a line; move-tab-synchrony's
// header measured four different line numbers for one pair). `resolveTarget` in the
// signature keeps this from matching a near-miss overload.
const DEFINITION_RE = /function\s+moveTabIntoWindow\s*\(source, p, resolveTarget, allowSoleTab = false\)\s*\{/;

// The disarming pre-set the fix removed. Receiver-qualified — bare `activeTabWcId = p.wcId`
// could drift; `target.activeTabWcId = p.wcId` is the exact assignment F8 shipped.
const PRESET = 'target.activeTabWcId = p.wcId';
// The two synchronous compensations that MUST remain: the displaced-guest hide and the
// target menu-close. `setVisible(false)` (not `(true)`, which the incoming guest still gets)
// and the quoted `'tab-switch'` overlay.
const HIDE = 'setVisible(false)';
const MENU_CLOSE = "closeMenuOverlay('tab-switch')";

/** The move core's body slice, comments masked. @returns {string} */
function coreBody(source) {
  const masked = maskComments(source);
  const m = masked.match(DEFINITION_RE);
  assert.ok(m && m.index !== undefined, 'moveTabIntoWindow(source, p, resolveTarget) not found — re-anchor this pin');
  const braceIdx = masked.indexOf('{', m.index + m[0].length - 1);
  const end = findMatchingBracket(masked, braceIdx, '{', '}');
  assert.notEqual(end, -1, 'unbalanced moveTabIntoWindow body');
  return masked.slice(braceIdx, end + 1);
}

/** The real main.js, read fresh. @returns {string} */
function realSource() {
  return fs.readFileSync(MAIN_JS, 'utf8');
}

/** Assert a mutation actually applied — a no-op .replace() would "discharge" vacuously. */
function assertMutated(before, after, what) {
  assert.notEqual(after, before, `the ${what} mutation did not apply — the .replace() target is stale`);
}

// ---------------------------------------------------------------------------
// AC1 / AC2 — the pre-set is GONE, and both synchronous compensations REMAIN.
// ---------------------------------------------------------------------------

test('AC1: the move core no longer pre-sets target.activeTabWcId — masked, real → 0, mutated → 1', () => {
  const body = coreBody(realSource());
  assert.equal(body.split(PRESET).length - 1, 0, 'the disarming pre-set is gone from the core (masked)');
});

test('AC1: mutating the pre-set back into the core makes it reappear — the scan is not vacuous', () => {
  const real = realSource();
  // Re-insert the pre-set exactly where F8 had it: right after the hand-compensation block's
  // closing brace, before the focus rules. Anchor on the `target.win.focus();` line.
  const mutated = real.replace(
    '  target.win.focus();',
    '  target.activeTabWcId = p.wcId;\n  target.win.focus();'
  );
  assertMutated(real, mutated, 'preset-reintroduced');
  const body = coreBody(mutated);
  assert.equal(body.split(PRESET).length - 1, 1, 'mutated → the pre-set is back');
});

test('AC2: the synchronous displaced-tab hide REMAINS in the core — real → present, mutated → gone', () => {
  const real = realSource();
  assert.equal(coreBody(real).includes(HIDE), true, `real → the core still calls ${HIDE}`);

  // Delete the hide. If the fix ever drops it, the interim window shows two guests — the
  // exact F8 HIGH-1 shape leg 4's row 8a catches at runtime; this catches it at the source.
  const mutated = real.replace(
    'if (!prevActive.view.webContents.isDestroyed()) prevActive.view.setVisible(false);',
    'if (!prevActive.view.webContents.isDestroyed()) void 0;'
  );
  assertMutated(real, mutated, 'hide-removed');
  assert.equal(coreBody(mutated).includes(HIDE), false, 'mutated → the hide is gone and this pin FAILS');
});

test("AC2: the synchronous closeMenuOverlay('tab-switch') REMAINS in the core — real → present, mutated → gone", () => {
  const real = realSource();
  assert.equal(coreBody(real).includes(MENU_CLOSE), true, `real → the core still calls ${MENU_CLOSE}`);

  // Delete the menu-close. If dropped, the target's stale menu is re-shown in the interim —
  // the displaced-menu residual defect. Same shape as the hide mutation, other branch.
  const mutated = real.replace(
    "    target.sheet?.closeMenuOverlay('tab-switch');",
    '    void 0;'
  );
  assertMutated(real, mutated, 'menu-close-removed');
  assert.equal(coreBody(mutated).includes(MENU_CLOSE), false, 'mutated → the menu-close is gone and this pin FAILS');
});

// ---------------------------------------------------------------------------
// The mask is LOAD-BEARING here — the rewritten comment names the removed pre-set in prose.
// ---------------------------------------------------------------------------

test('the MASK carries the pre-set reading — unmasked, the real core reads NON-zero', () => {
  // The hand-compensation comment explains the REMOVED pre-set and so names
  // `target.activeTabWcId = p.wcId` in prose. An unmasked scan of the core therefore reads
  // the pre-set out of the comment and would report the fix un-applied — discrimination
  // zero. Asserting the unmasked reading is non-zero proves the mask (not an empty core) is
  // what makes the AC1 reading above mean 0.
  const real = realSource();
  const m = real.match(DEFINITION_RE);
  assert.ok(m && m.index !== undefined, 'the core is found in the unmasked file too');
  const unmaskedBraceIdx = real.indexOf('{', m.index + m[0].length - 1);
  const unmaskedEnd = findMatchingBracket(maskComments(real), unmaskedBraceIdx, '{', '}');
  const unmaskedBody = real.slice(unmaskedBraceIdx, unmaskedEnd + 1);
  assert.ok(
    unmaskedBody.split(PRESET).length - 1 > 0,
    'the rewritten comment names the removed pre-set — if this ever reads 0 the AC1 scan went vacuous'
  );
  assert.equal(coreBody(real).split(PRESET).length - 1, 0, 'masked → 0');
});
