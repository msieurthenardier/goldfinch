'use strict';

// Shortcut-classifier parity contract (M15 Flight 1 "Bookmarking Core and
// Surfaces" Leg 1 / DD5). Retires the documented hand-mirror risk between
// src/shared/keydown-action.js (the chrome DOM keydown handler's classifier)
// and src/shared/sheet-accelerator.js (the menu-overlay sheet's before-input-
// event forwarder) by pinning that they agree — SCOPED TO CHROME-SCOPE
// RESULTS ONLY (design-review correction): unscoped "identical actions"
// parity is testably false today — sheetAcceleratorAction also carries a
// GUEST scope (devtools/zoom/find/print/downloads, handled by main's own
// before-input-event branches) that keydownToAction has no concept of at all.
//
// The two functions take DIFFERENT descriptor shapes (keydownToAction:
// {ctrl,...} -> string|null; sheetAcceleratorAction: {control,...} (note the
// field NAME difference) -> {scope,action,autoRepeatGuard}|null) — per the
// leg's Implementation Guidance #3, each gets its OWN adapter rather than one
// shared descriptor object that could silently typo the modifier field name
// on one side.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { keydownToAction } = require('../../src/shared/keydown-action');
const { sheetAcceleratorAction } = require('../../src/shared/sheet-accelerator');

/** @param {{key:string, ctrl?:boolean, meta?:boolean, shift?:boolean, alt?:boolean}} chord */
function toKeydownDescriptor({ key, ctrl = false, meta = false, shift = false, alt = false }) {
  return { key, ctrl, meta, shift, alt, lightboxOpen: false };
}

/** @param {{key:string, ctrl?:boolean, meta?:boolean, shift?:boolean, alt?:boolean}} chord */
function toSheetDescriptor({ key, ctrl = false, meta = false, shift = false, alt = false }) {
  return { key, control: ctrl, meta, shift, alt };
}

// ---------------------------------------------------------------------------
// Chrome-scope corpus: every chord BOTH files document as chrome-class,
// including this leg's two new bookmarks additions (DD5). Each entry pins
// BOTH the sheet's own {scope:'chrome', action} output AND the parity claim
// against keydownToAction in one assertion — a real behavior pin, not a
// vacuous loop.
// ---------------------------------------------------------------------------

const CHROME_SCOPE_CASES = [
  { chord: { key: 'Tab', ctrl: true }, action: 'tab-next' },
  { chord: { key: 'Tab', ctrl: true, shift: true }, action: 'tab-prev' },
  { chord: { key: 'PageDown', ctrl: true }, action: 'tab-next' },
  { chord: { key: 'PageUp', ctrl: true }, action: 'tab-prev' },
  { chord: { key: '1', ctrl: true }, action: 'tab-jump-1' },
  { chord: { key: '2', ctrl: true }, action: 'tab-jump-2' },
  { chord: { key: '3', ctrl: true }, action: 'tab-jump-3' },
  { chord: { key: '4', ctrl: true }, action: 'tab-jump-4' },
  { chord: { key: '5', ctrl: true }, action: 'tab-jump-5' },
  { chord: { key: '6', ctrl: true }, action: 'tab-jump-6' },
  { chord: { key: '7', ctrl: true }, action: 'tab-jump-7' },
  { chord: { key: '8', ctrl: true }, action: 'tab-jump-8' },
  { chord: { key: '9', ctrl: true }, action: 'tab-jump-last' },
  { chord: { key: 't', ctrl: true }, action: 'new-tab' },
  { chord: { key: 'w', ctrl: true }, action: 'close-tab' },
  { chord: { key: 'n', ctrl: true }, action: 'new-window' },
  { chord: { key: 'l', ctrl: true }, action: 'focus-address' },
  { chord: { key: 'm', ctrl: true }, action: 'toggle-panel' },
  { chord: { key: 'r', ctrl: true }, action: 'reload' },
  { chord: { key: 'P', ctrl: true, shift: true }, action: 'toggle-privacy' },
  { chord: { key: 'p', ctrl: true, shift: true }, action: 'toggle-privacy' },
  { chord: { key: 'T', ctrl: true, shift: true }, action: 'reopen-closed-tab' },
  { chord: { key: 't', ctrl: true, shift: true }, action: 'reopen-closed-tab' },
  // This leg's additions (DD5).
  { chord: { key: 'd', ctrl: true }, action: 'bookmark-page' },
  { chord: { key: 'B', ctrl: true, shift: true }, action: 'toggle-bookmarks-bar' },
  { chord: { key: 'b', ctrl: true, shift: true }, action: 'toggle-bookmarks-bar' }
];

for (const { chord, action } of CHROME_SCOPE_CASES) {
  const label = `${chord.ctrl ? 'Ctrl+' : ''}${chord.shift ? 'Shift+' : ''}${chord.key}`;
  test(`chrome-scope parity: ${label} -> '${action}' on both classifiers`, () => {
    const sheetResult = sheetAcceleratorAction(toSheetDescriptor(chord));
    assert.deepEqual(sheetResult && { scope: sheetResult.scope, action: sheetResult.action }, {
      scope: 'chrome',
      action
    });
    assert.equal(keydownToAction(toKeydownDescriptor(chord)), action);
  });
}

// A single generic sweep, asserting the CONTRACT itself (not just the curated
// cases above): for every chord in the corpus, wherever sheetAcceleratorAction
// resolves 'chrome' scope, keydownToAction agrees. This protects against a
// future addition to one file that lands only in the curated list above.
test('generic contract: across the whole corpus, every chrome-scope sheet result agrees with keydownToAction', () => {
  for (const { chord } of CHROME_SCOPE_CASES) {
    const sheetResult = sheetAcceleratorAction(toSheetDescriptor(chord));
    if (sheetResult && sheetResult.scope === 'chrome') {
      assert.equal(keydownToAction(toKeydownDescriptor(chord)), sheetResult.action, `chord ${JSON.stringify(chord)}`);
    }
  }
});

// ---------------------------------------------------------------------------
// The explicit guest-scope exemption (AC — "the exemption is asserted
// explicitly"): unshifted Ctrl+P is guest-scope on the sheet (print) but has
// NO chrome-classifier analog at all — keydownToAction has no unshifted-p
// branch, so it resolves null. A pre-existing, accepted divergence (guest-
// only accelerators have no chrome analog), not a bug this test should catch.
// ---------------------------------------------------------------------------

test('exemption: unshifted Ctrl+P is guest-scope on the sheet (print) with no chrome-classifier analog', () => {
  const sheetResult = sheetAcceleratorAction(toSheetDescriptor({ key: 'p', ctrl: true }));
  assert.deepEqual(sheetResult, { scope: 'guest', action: 'print' });
  assert.equal(keydownToAction(toKeydownDescriptor({ key: 'p', ctrl: true })), null);
});

test('exemption sibling: capital P (shifted-key-char, no shift flag) is the same guest-scope divergence', () => {
  const sheetResult = sheetAcceleratorAction(toSheetDescriptor({ key: 'P', ctrl: true }));
  assert.deepEqual(sheetResult, { scope: 'guest', action: 'print' });
  assert.equal(keydownToAction(toKeydownDescriptor({ key: 'P', ctrl: true })), null);
});

// ---------------------------------------------------------------------------
// Near-miss variants: wrong modifier, unshifted/shifted confusions. Neither
// classifier should match — both sides agree on null (a genuine parity claim,
// not scoped away, since a null sheet result carries no {scope:'chrome',...}
// to trigger the exemption).
// ---------------------------------------------------------------------------

const NULL_ON_BOTH = [
  { key: 'd' }, // bookmark-page requires Ctrl — no modifier
  { key: 'D', shift: true }, // Shift alone, no ctrl
  { key: 'b', ctrl: true }, // unshifted Ctrl+B — unassigned (only Ctrl+Shift+B is)
  { key: 'B', ctrl: true }, // capital B, no shift flag — same unassigned chord
  { key: 'D', ctrl: true, shift: true, alt: true }, // near-miss noise: an unassigned Alt combo
  { key: '7', ctrl: true, alt: true } // AltGr digit guard (pre-existing, re-verified here)
];

for (const chord of NULL_ON_BOTH) {
  const label = `${chord.ctrl ? 'Ctrl+' : ''}${chord.shift ? 'Shift+' : ''}${chord.alt ? 'Alt+' : ''}${chord.key}`;
  test(`near-miss: ${label} classifies to null on BOTH classifiers`, () => {
    const sheetResult = sheetAcceleratorAction(toSheetDescriptor(chord));
    assert.equal(sheetResult, null);
    assert.equal(keydownToAction(toKeydownDescriptor(chord)), null);
  });
}
