'use strict';

// Unit tests for src/shared/guest-forward-allowlist.js (DD8, M06 F3 Leg 4).
//
// The truth table this pins: per-guest-kind (web vs internal), which
// keydownToAction outputs the generalized guest-focus forwarder
// (handleGuestChromeShortcut, main.js) is allowed to send as
// `chrome-shortcut-action`. Also pins Ctrl+Shift+T's reopen-closed-tab
// forwarding (M09 F4 DD2 — the reservation retirement) end-to-end through the
// classify -> allowlist pipeline the forwarder actually runs.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { isChromeActionForwardable, isRepeatSafeAction } = require('../../src/shared/guest-forward-allowlist');
const { keydownToAction } = require('../../src/shared/keydown-action');

// ---------------------------------------------------------------------------
// WEB guests: the full chrome-class set (design-review enumeration — 6 actions)
// ---------------------------------------------------------------------------

const WEB_FORWARDABLE = ['new-tab', 'close-tab', 'focus-address', 'toggle-panel', 'toggle-privacy', 'reload', 'reopen-closed-tab'];

for (const action of WEB_FORWARDABLE) {
  test(`web guest: '${action}' is forwardable (chrome-class parity set)`, () => {
    assert.equal(isChromeActionForwardable(action, 'web'), true);
  });
}

// Main-side-handled actions must NOT be in the web allowlist — they keep their
// own existing branches in wireGuestContents (zoom/print/find/downloads/devtools
// are not chrome-class; this forwarder must never double-fire them).
const WEB_MAIN_SIDE = ['devtools', 'zoom-in', 'zoom-out', 'zoom-reset', 'find', 'downloads'];

for (const action of WEB_MAIN_SIDE) {
  test(`web guest: '${action}' is NOT forwardable (main-side-handled, own branch)`, () => {
    assert.equal(isChromeActionForwardable(action, 'web'), false);
  });
}

// ---------------------------------------------------------------------------
// INTERNAL guests: deliberately thin — new-tab + close-tab ONLY (FD ruling)
// ---------------------------------------------------------------------------

test('internal guest: new-tab is forwardable (absorbs the former handleGuestNewTab)', () => {
  assert.equal(isChromeActionForwardable('new-tab', 'internal'), true);
});

test('internal guest: close-tab is forwardable (Ctrl+W closes an internal tab)', () => {
  assert.equal(isChromeActionForwardable('close-tab', 'internal'), true);
});

// reopen-closed-tab (M09 F4 DD2): joins BOTH guest kinds like tab-cycle/jump —
// an internal settings page must not trap the operator from reopen either.
test('internal guest: reopen-closed-tab is forwardable (M09 F4 DD2 — navigation-neutral, like tab-cycle/jump)', () => {
  assert.equal(isChromeActionForwardable('reopen-closed-tab', 'internal'), true);
});

const INTERNAL_NOT_FORWARDABLE = ['focus-address', 'toggle-panel', 'toggle-privacy', 'reload', ...WEB_MAIN_SIDE];

for (const action of INTERNAL_NOT_FORWARDABLE) {
  test(`internal guest: '${action}' is NOT forwardable (conservative allowlist — extend explicitly later)`, () => {
    assert.equal(isChromeActionForwardable(action, 'internal'), false);
  });
}

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

test('null/undefined/empty action never forwards on either guest kind (never throws)', () => {
  assert.doesNotThrow(() => {
    assert.equal(isChromeActionForwardable(null, 'web'), false);
    assert.equal(isChromeActionForwardable(undefined, 'web'), false);
    assert.equal(isChromeActionForwardable('', 'internal'), false);
  });
});

test('unrecognized action string never forwards', () => {
  assert.equal(isChromeActionForwardable('not-a-real-action', 'web'), false);
  assert.equal(isChromeActionForwardable('not-a-real-action', 'internal'), false);
});

// ---------------------------------------------------------------------------
// Ctrl+Shift+T reopen-closed-tab (M09 F4 DD2 step 1) — pinned END-TO-END
// through the SAME classify(keydownToAction) -> allowlist pipeline
// handleGuestChromeShortcut runs, not just the allowlist in isolation. This
// RETIRES the chord's former reserved-unassigned/intentional-drop status (FD
// ruling, design review cycle 1, M06 F3 Leg 4): it now forwards on BOTH guest
// kinds, the same navigation-neutral class as tab-cycle/jump. Literal Ctrl+T
// (unshifted) still forwards as new-tab on both guest kinds — no regression
// on the F2 D2 fix.
// ---------------------------------------------------------------------------

test('Ctrl+Shift+T classifies to reopen-closed-tab end-to-end and forwards on both guest kinds (M09 F4 DD2)', () => {
  const action = keydownToAction({ key: 'T', ctrl: true, meta: false, shift: true, lightboxOpen: false });
  assert.equal(action, 'reopen-closed-tab');
  assert.equal(isChromeActionForwardable(action, 'web'), true);
  assert.equal(isChromeActionForwardable(action, 'internal'), true);
});

test('Ctrl+T (unshifted, either case main.js before-input-event reports) still forwards as new-tab on both guest kinds — no regression', () => {
  const action = keydownToAction({ key: 't', ctrl: true, meta: false, shift: false, lightboxOpen: false });
  assert.equal(action, 'new-tab');
  assert.equal(isChromeActionForwardable(action, 'web'), true);
  assert.equal(isChromeActionForwardable(action, 'internal'), true);
});

// ---------------------------------------------------------------------------
// Tab-cycle/jump (M09 F3 Leg 1, DD1/DD2): unlike the rest of the WEB-only set,
// these forward on BOTH guest kinds — tab switching is navigation-neutral
// chrome behavior, and an internal settings page must not trap the operator.
// ---------------------------------------------------------------------------

const TAB_CYCLE_JUMP = [
  'tab-next', 'tab-prev',
  'tab-jump-1', 'tab-jump-2', 'tab-jump-3', 'tab-jump-4',
  'tab-jump-5', 'tab-jump-6', 'tab-jump-7', 'tab-jump-8',
  'tab-jump-last',
];

for (const action of TAB_CYCLE_JUMP) {
  test(`web guest: '${action}' is forwardable (tab-cycle/jump, M09 F3)`, () => {
    assert.equal(isChromeActionForwardable(action, 'web'), true);
  });
  test(`internal guest: '${action}' is forwardable (tab-cycle/jump — internal tabs must not trap the operator)`, () => {
    assert.equal(isChromeActionForwardable(action, 'internal'), true);
  });
}

test('Ctrl+Tab classifies to tab-next end-to-end and forwards on both guest kinds', () => {
  const action = keydownToAction({ key: 'Tab', ctrl: true, meta: false, shift: false, lightboxOpen: false });
  assert.equal(action, 'tab-next');
  assert.equal(isChromeActionForwardable(action, 'web'), true);
  assert.equal(isChromeActionForwardable(action, 'internal'), true);
});

test('Ctrl+Alt+7 classifies to null end-to-end (AltGr guard) and never forwards', () => {
  const action = keydownToAction({ key: '7', ctrl: true, meta: false, shift: false, lightboxOpen: false, alt: true });
  assert.equal(action, null);
  assert.equal(isChromeActionForwardable(action, 'web'), false);
  assert.equal(isChromeActionForwardable(action, 'internal'), false);
});

// ---------------------------------------------------------------------------
// isRepeatSafeAction (M09 F3 fix-cycle, FD ruling): the pure carve-out predicate
// consulted by handleGuestChromeShortcut's (main.js) isAutoRepeat guard so that
// held-key repeat cycling isn't swallowed under guest focus — mirrors Chrome's
// own held-Ctrl+Tab repeat-cycle behavior (the leg's Edge Cases ruling).
// ---------------------------------------------------------------------------

for (const action of TAB_CYCLE_JUMP) {
  test(`isRepeatSafeAction('${action}') is true (tab-* family exempted from the repeat guard)`, () => {
    assert.equal(isRepeatSafeAction(action), true);
  });
}

const NOT_REPEAT_SAFE = ['new-tab', 'close-tab', 'focus-address', 'toggle-panel', 'toggle-privacy', 'reload', 'reopen-closed-tab'];

for (const action of NOT_REPEAT_SAFE) {
  test(`isRepeatSafeAction('${action}') is false (held key must not stack/repeat-fire)`, () => {
    assert.equal(isRepeatSafeAction(action), false);
  });
}

test('isRepeatSafeAction never throws on null/undefined/empty/non-string', () => {
  assert.doesNotThrow(() => {
    assert.equal(isRepeatSafeAction(null), false);
    assert.equal(isRepeatSafeAction(undefined), false);
    assert.equal(isRepeatSafeAction(''), false);
    assert.equal(isRepeatSafeAction(42), false);
  });
});
