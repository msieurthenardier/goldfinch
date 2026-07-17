// @ts-check
'use strict';

// Per-guest-kind chrome-class accelerator forwarding allowlist (DD8, M06 F3 Leg
// 4). The guest `before-input-event` forwarder (`handleGuestChromeShortcut` in
// main.js) classifies a keystroke with the existing pure `keydownToAction`
// (src/shared/keydown-action.js — the SAME classifier the chrome DOM keydown
// handler uses) and consults this allowlist to decide whether the resulting
// action should be forwarded to the chrome renderer as a `chrome-shortcut-action`
// send, given which guest kind (web vs internal) currently holds OS focus.
//
// WEB guests forward the FULL chrome-class action set `keydownToAction` can
// produce, MINUS the actions that are handled main-side with their own existing
// branches (devtools, zoom-in/out/reset, find, downloads) — those keep their own
// branches in wireGuestContents and never reach this allowlist question (parity
// goal, FD ruling: an accelerator that works under chrome focus works
// identically under guest focus). Resolved-at-design-review enumeration:
// keydownToAction's 12 outputs minus the 6 main-side-handled ones leaves exactly
// {new-tab, close-tab, focus-address, toggle-panel, toggle-privacy, reload}.
//
// INTERNAL guests forward a conservative, EXPLICITLY enumerated subset: new-tab
// and close-tab only (FD ruling — conservative on purpose; extend one action at
// a time at future leg design, never widen silently). Cross-view nav (Ctrl+L /
// Tab) is a SEPARATE, pre-existing mechanism (handleGuestCrossViewNav) and is
// not part of this allowlist at all.
//
// Tab-cycle/jump (M09 F3 Leg 1, DD1/DD2): tab switching is navigation-neutral
// chrome behavior — an internal settings page must not trap the operator — so
// these actions are added to BOTH guest kinds (not gated by the internal
// allowlist's usual conservative-extend-one-at-a-time posture, per the flight's
// explicit ruling).
const TAB_CYCLE_JUMP_ACTIONS = [
  'tab-next',
  'tab-prev',
  'tab-jump-1', 'tab-jump-2', 'tab-jump-3', 'tab-jump-4',
  'tab-jump-5', 'tab-jump-6', 'tab-jump-7', 'tab-jump-8',
  'tab-jump-last',
];

// reopen-closed-tab (M09 F4 Leg 2, DD2 step 1): RETIRES the Ctrl+Shift+T
// reservation. Same navigation-neutral tab-management class as tab-cycle/jump
// above — the flight's Open Questions ruling ("is reopen guest-forwardable /
// internal-forwardable? Yes, both") adds it to BOTH guest kinds for the same
// reason (an internal settings page must not trap the operator from reopen
// either). NOT repeat-safe: its `tab-*`-prefixed cousins are exempted from the
// isAutoRepeat guard below by prefix match, but 'reopen-closed-tab' does not
// start with 'tab-', so it stays guarded (single-shot semantics — holding the
// chord must not machine-gun the stack, per the flight's ruling) with no code
// change needed; pinned by a dedicated unit test.
// new-window (M09 F6 DD5): the New Window command joins BOTH guest kinds — the
// same app-level navigation-neutral class as new-tab (which is in both), so an
// internal settings page must not trap the operator from opening a window
// either. Like reopen-closed-tab above it is NOT `tab-`-prefixed, so the
// forwarder's blanket `!isAutoRepeat` guard covers it with no code change
// (windows are heavier than tabs — a held Ctrl+N must not machine-gun
// BaseWindows; flight design review L1); pinned by a dedicated unit test.
const WEB_CHROME_ACTIONS = new Set([
  'new-tab',
  'close-tab',
  'new-window',
  'focus-address',
  'toggle-panel',
  'toggle-privacy',
  'reload',
  'reopen-closed-tab',
  ...TAB_CYCLE_JUMP_ACTIONS,
]);

const INTERNAL_CHROME_ACTIONS = new Set(['new-tab', 'close-tab', 'new-window', 'reopen-closed-tab', ...TAB_CYCLE_JUMP_ACTIONS]);

/**
 * isChromeActionForwardable(action, guestKind)
 *
 * @param {string | null | undefined} action  a keydownToAction output (or null —
 *   always returns false for a non-match, so callers can pass the classifier's
 *   result through unchecked)
 * @param {'web' | 'internal'} guestKind
 * @returns {boolean}
 */
function isChromeActionForwardable(action, guestKind) {
  if (!action) return false;
  return guestKind === 'internal' ? INTERNAL_CHROME_ACTIONS.has(action) : WEB_CHROME_ACTIONS.has(action);
}

// Repeat-safe action set (M09 F3 fix-cycle, FD ruling). The guest forwarder's
// blanket `!input.isAutoRepeat` guard (handleGuestChromeShortcut, main.js) exists
// to stop a HELD key from stacking/repeat-firing new-tab/close-tab/downloads-style
// actions — but it must NOT suppress tab-cycle repeat under guest focus: the
// leg's Edge Cases ruling is "allow repeat cycling" (Chrome allows held-Ctrl+Tab
// to cycle), and silently dropping that under guest focus would be a
// chrome/guest parity regression. Jumps (tab-jump-N / tab-jump-last) are
// idempotent under repeat (re-landing on the same target every keyDown), so
// exempting the whole `tab-*` family alongside the two cycle actions is
// harmless and simpler than special-casing just tab-next/tab-prev.
//
// @param {string | null | undefined} action
// @returns {boolean}
function isRepeatSafeAction(action) {
  return typeof action === 'string' && action.startsWith('tab-');
}

// CJS-only (main-only consumer today — no page loads this via <script>; dual
// export is added the moment a renderer-side consumer needs it, per the
// src/shared/ dual-export pattern's own convention).
module.exports = {
  isChromeActionForwardable,
  isRepeatSafeAction,
  WEB_CHROME_ACTIONS,
  INTERNAL_CHROME_ACTIONS,
};
