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
const WEB_CHROME_ACTIONS = new Set([
  'new-tab',
  'close-tab',
  'focus-address',
  'toggle-panel',
  'toggle-privacy',
  'reload',
]);

const INTERNAL_CHROME_ACTIONS = new Set(['new-tab', 'close-tab']);

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

// CJS-only (main-only consumer today — no page loads this via <script>; dual
// export is added the moment a renderer-side consumer needs it, per the
// src/shared/ dual-export pattern's own convention).
module.exports = { isChromeActionForwardable, WEB_CHROME_ACTIONS, INTERNAL_CHROME_ACTIONS };
