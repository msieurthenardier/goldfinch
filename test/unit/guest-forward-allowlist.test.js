'use strict';

// Unit tests for src/shared/guest-forward-allowlist.js (DD8, M06 F3 Leg 4).
//
// The truth table this pins: per-guest-kind (web vs internal), which
// keydownToAction outputs the generalized guest-focus forwarder
// (handleGuestChromeShortcut, main.js) is allowed to send as
// `chrome-shortcut-action`. Also pins the Ctrl+Shift+T intentional-drop (FD
// ruling) end-to-end through the classify -> allowlist pipeline the forwarder
// actually runs.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { isChromeActionForwardable } = require('../../src/shared/guest-forward-allowlist');
const { keydownToAction } = require('../../src/shared/keydown-action');

// ---------------------------------------------------------------------------
// WEB guests: the full chrome-class set (design-review enumeration — 6 actions)
// ---------------------------------------------------------------------------

const WEB_FORWARDABLE = ['new-tab', 'close-tab', 'focus-address', 'toggle-panel', 'toggle-privacy', 'reload'];

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
// Ctrl+Shift+T intentional drop (FD ruling, design review cycle 1) — pinned
// END-TO-END through the SAME classify(keydownToAction) -> allowlist pipeline
// handleGuestChromeShortcut runs, not just the allowlist in isolation. Unifying
// on keydownToAction (which only matches lowercase 't') intentionally drops
// shifted-T under guest focus: parity with chrome focus (the chrome DOM handler
// never supported Ctrl+Shift+T either), and the chord is reserved unassigned
// for a future "reopen closed tab" feature. Literal Ctrl+T (unshifted) still
// forwards on both guest kinds — no regression on the F2 D2 fix.
// ---------------------------------------------------------------------------

test('Ctrl+Shift+T classifies to null (keydownToAction only matches lowercase t) -> never forwards on either guest kind', () => {
  const action = keydownToAction({ key: 'T', ctrl: true, meta: false, shift: true, lightboxOpen: false });
  assert.equal(action, null);
  assert.equal(isChromeActionForwardable(action, 'web'), false);
  assert.equal(isChromeActionForwardable(action, 'internal'), false);
});

test('Ctrl+T (unshifted, either case main.js before-input-event reports) still forwards as new-tab on both guest kinds — no regression', () => {
  const action = keydownToAction({ key: 't', ctrl: true, meta: false, shift: false, lightboxOpen: false });
  assert.equal(action, 'new-tab');
  assert.equal(isChromeActionForwardable(action, 'web'), true);
  assert.equal(isChromeActionForwardable(action, 'internal'), true);
});
