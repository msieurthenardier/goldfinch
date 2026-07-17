'use strict';

// Sole-tab move + empty-source close — code-shape pins (M09 Flight 10, Leg 3).
// A source-scan test in the move-core-fix.test.js / move-tab-synchrony.test.js house
// pattern, pinning the CODE SHAPE of the three moving parts of L3:
//
//   AC2 — the move core's sole-tab guard is GATED by `allowSoleTab`
//         (`if (!allowSoleTab && source.tabViews.size <= 1) ...`), and ONLY the
//         existing-window consolidate paths pass it true (`() => target, true`) —
//         `tab-move-to-window` alone at L3; `tab-adopt-by-drop` joined at M09 F11 Leg 3
//         (the same consolidate semantics by drag, its leg DD5), bumping the pinned
//         count 1 → 2. The two `newWindowForMove` callers (`tab-move-to-new-window`,
//         `tab-tear-off`) do NOT pass it — a sole-tab move to a NEW window stays
//         refused (AC3).
//   AC2 — the empty-source close (`if (source.tabViews.size === 0 &&
//         !source.win.isDestroyed()) source.win.close();`) is present in the core, as the
//         LAST statement before its `return { ok: true }`.
//   AC4 — the SOURCE renderer's `onTabMovedAway` no longer boots a tab on an empty strip:
//         the `else createTab()` arm is GONE (deleted, not gated).
//
// WHAT THIS PINS, AND WHAT IT DOES NOT. This is a CODE-SHAPE pin, not a runtime one —
// this repo has no main/renderer process harness (neither file is executed by any test).
// The RUNTIME reading (a sole tab actually consolidates into another window and the
// emptied source window closes, with no orphaned home tab) is L3's MANUAL VERIFICATION
// PASS. Stated here so no one reads this file as runtime proof it is not.
//
// Two readings per pin (DD10), on the REAL sources, mutated IN MEMORY (no file is written):
// the shape is present in the real file (real → the pinned count), and a mutation that
// removes/subverts it flips the count — so a green pass cannot be vacuous.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { maskComments, findMatchingBracket } = require('../helpers/source-scan');

const MAIN_JS = path.join(__dirname, '../../src/main/main.js');
const RENDERER_JS = path.join(__dirname, '../../src/renderer/renderer.js');

// The move core's body — anchored on the function name + the L3 signature (never a line;
// move-tab-synchrony's header measured four different line numbers for one pair). The
// `allowSoleTab = false` param keeps this from matching a pre-L3 overload.
const CORE_DEF_RE = /function\s+moveTabIntoWindow\s*\(source, p, resolveTarget, allowSoleTab = false\)\s*\{/;
// The source renderer's tab-moved-away handler body.
const MOVED_AWAY_RE = /onTabMovedAway\(\(payload\)\s*=>\s*\{/;

// AC2 — the guard is gated by allowSoleTab (mask-safe: no comment names this exact expr).
const GATED_GUARD = '!allowSoleTab && source.tabViews.size <= 1';
// AC2 — the empty-source close, guarded by size === 0.
const EMPTY_CLOSE = 'source.tabViews.size === 0 && !source.win.isDestroyed()';
// AC2/AC3 — the ONLY callers that pass allowSoleTab true (existing-window paths:
// tab-move-to-window, and tab-adopt-by-drop since M09 F11 Leg 3).
const CONSOLIDATE_CALL = '() => target, true)';
// AC3 — the new-window callers must NOT pass true. Its presence would be a leak.
const NEWWINDOW_TRUE = 'newWindowForMove(source), true)';

const realMain = () => fs.readFileSync(MAIN_JS, 'utf8');
const realRenderer = () => fs.readFileSync(RENDERER_JS, 'utf8');

/** Slice a `{ … }` body opened by the first match of `re`, comments masked. */
function bodyOf(source, re, what) {
  const masked = maskComments(source);
  const m = masked.match(re);
  assert.ok(m && m.index !== undefined, `${what} not found — re-anchor this pin`);
  const braceIdx = masked.indexOf('{', m.index + m[0].length - 1);
  const end = findMatchingBracket(masked, braceIdx, '{', '}');
  assert.notEqual(end, -1, `unbalanced ${what} body`);
  return masked.slice(braceIdx, end + 1);
}

const coreBody = (source) => bodyOf(source, CORE_DEF_RE, 'moveTabIntoWindow core');
const movedAwayBody = (source) => bodyOf(source, MOVED_AWAY_RE, 'onTabMovedAway handler');
const count = (hay, needle) => hay.split(needle).length - 1;

/** Assert a mutation actually applied — a no-op .replace() would "discharge" vacuously. */
function assertMutated(before, after, what) {
  assert.notEqual(after, before, `the ${what} mutation did not apply — the .replace() target is stale`);
}

// ---------------------------------------------------------------------------
// AC2 — the sole-tab guard is gated by allowSoleTab.
// ---------------------------------------------------------------------------

test('AC2: the move core gates its sole-tab guard on allowSoleTab — masked, real → 1, mutated → 0', () => {
  const real = realMain();
  assert.equal(count(coreBody(real), GATED_GUARD), 1, 'real → the guard is gated by allowSoleTab');

  // Ungate it (revert to the F8 unconditional refusal). A sole tab could then never
  // consolidate, AC1/AC2's whole reversal gone.
  const mutated = real.replace(
    'if (!allowSoleTab && source.tabViews.size <= 1)',
    'if (source.tabViews.size <= 1)'
  );
  assertMutated(real, mutated, 'ungate-guard');
  assert.equal(count(coreBody(mutated), GATED_GUARD), 0, 'mutated → the gate is gone and this pin FAILS');
});

// ---------------------------------------------------------------------------
// AC2 — the empty-source close is present in the core.
// ---------------------------------------------------------------------------

test('AC2: the core closes an emptied source (size === 0 → win.close()) — masked, real → 1, mutated → 0', () => {
  const real = realMain();
  const body = coreBody(real);
  assert.equal(count(body, EMPTY_CLOSE), 1, 'real → the size===0 close is present');
  assert.equal(body.includes('source.win.close()'), true, 'real → it calls source.win.close()');

  // Delete the close. The emptied source would then linger as a tabless window (the F8
  // orphan the leg removes).
  const mutated = real.replace(
    'if (source.tabViews.size === 0 && !source.win.isDestroyed()) source.win.close();',
    'void 0;'
  );
  assertMutated(real, mutated, 'remove-empty-close');
  assert.equal(count(coreBody(mutated), EMPTY_CLOSE), 0, 'mutated → the close is gone and this pin FAILS');
});

// ---------------------------------------------------------------------------
// AC2/AC3 — allowSoleTab flows to the existing-window path ONLY.
// ---------------------------------------------------------------------------

test('AC3: ONLY the existing-window consolidate paths pass allowSoleTab true — masked, consolidate calls present, new-window calls not', () => {
  const real = realMain();
  const masked = maskComments(real);
  assert.equal(count(masked, CONSOLIDATE_CALL), 2, 'real → exactly two () => target, true calls (tab-move-to-window + tab-adopt-by-drop; was 1 before F11 Leg 3)');
  assert.equal(count(masked, NEWWINDOW_TRUE), 0, 'real → no newWindowForMove caller passes true (sole-tab → new window stays refused)');

  // Leak allowSoleTab into a new-window caller. This would make a sole-tab tear-off /
  // move-to-new-window succeed as a no-op window swap — the AC3 regression.
  const mutated = real.replace(
    'moveTabIntoWindow(source, p, () => newWindowForMove(source));',
    'moveTabIntoWindow(source, p, () => newWindowForMove(source), true);'
  );
  assertMutated(real, mutated, 'leak-allowSoleTab');
  assert.equal(count(maskComments(mutated), NEWWINDOW_TRUE), 1, 'mutated → a new-window caller now passes true and this pin FAILS');
});

// ---------------------------------------------------------------------------
// AC4 — the source renderer no longer boots a tab on an empty strip.
// ---------------------------------------------------------------------------

// The pin scans the PAREN-QUALIFIED `createTab(` — see the inverted-mask note below for
// why the bare token would be unsafe here.
test('AC4: onTabMovedAway has no createTab( arm — real → 0, mutated → 1', () => {
  const real = realRenderer();
  assert.equal(count(movedAwayBody(real), 'createTab('), 0, 'real → the else-createTab arm is gone');

  // Re-insert the deleted arm. An empty strip would then race a tab-create into a window
  // main is already closing (the orphan-guest leak the deletion prevents).
  const mutated = real.replace(
    '    const next = orderedTabIds().pop();\n    if (next) activateTab(next);\n  }',
    '    const next = orderedTabIds().pop();\n    if (next) activateTab(next);\n    else createTab();\n  }'
  );
  assertMutated(real, mutated, 'reintroduce-createTab');
  assert.equal(count(movedAwayBody(mutated), 'createTab('), 1, 'mutated → the arm is back and this pin FAILS');
});

// ---------------------------------------------------------------------------
// WHY THE RENDERER PIN IS PAREN-QUALIFIED — maskComments is INVERTED here.
// maskComments tracks quote parity and does NOT understand regex literals (its documented
// blind spot — an odd-quote regex upstream inverts parity for the rest of the file). A regex
// upstream of this handler leaves comments in this region UN-masked, so the bare token
// `createTab` reads out of the rewritten comment ("else-createTab arm") even after masking.
// The pin therefore scans `createTab(` (paren-qualified), which the comment does not carry —
// robust whether the mask applies or not. This test MEASURES that state rather than assuming
// it, so a future maskComments fix (or a comment reword) is caught as a changed reading.
// ---------------------------------------------------------------------------

test('the renderer mask is INVERTED here — the bare token reads the comment, the paren-qualified one does not', () => {
  const body = movedAwayBody(realRenderer());
  assert.ok(
    count(body, 'createTab') > 0,
    'the (masked) body still reads `createTab` from the comment — maskComments is inverted here (regex blind spot)'
  );
  assert.equal(count(body, 'createTab('), 0, 'the paren-qualified token the AC4 pin uses is comment-proof → 0');
});
