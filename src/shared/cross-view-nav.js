// @ts-check
'use strict';

/**
 * crossViewNavAction({ key, control, meta, shift, alt })
 *
 * Pure decision for the guest→chrome keyboard bridge (M05 Flight 5 Leg 2). On the
 * native multi-`WebContentsView` surface, OS keyboard focus lives in ONE view at a
 * time, so two keys must be captured main-side on a focused guest and handed back
 * across the boundary to the chrome view:
 *
 *   Ctrl/Cmd+L        → 'focus-address'  (focus the address bar — a chrome-level
 *                       accelerator, dead when a guest holds OS focus otherwise)
 *   Tab (unmodified)  → 'tab-handoff'    (release the guest and land focus on the
 *                       chrome's pinned first control, the address bar)
 *
 * Everything else → null (the guest keeps the key — F12/zoom/print/find/downloads/
 * devtools stay with their own guest branches; this decision never intercepts them).
 * Shift+Tab (and any Ctrl/Alt/Meta-Tab) → null: only forward, unmodified Tab is the
 * gated handoff path; Shift+Tab is left to Chromium default (leg AC — out of scope).
 *
 * The decision is pure (no DOM/IPC/Electron) so it unit-tests like sheet-accelerator.js;
 * the caller (`handleGuestCrossViewNav` in main.js) runs the focus-then-send side
 * effects (OS-focus the chrome view, THEN the `chrome-shortcut-action:focus-address`
 * send — the F4 focus-then-send rule) and the isAutoRepeat guard.
 *
 * @param {{ key: string, control: boolean, meta: boolean, shift: boolean, alt: boolean }} input
 * @returns {'focus-address' | 'tab-handoff' | null}
 */
function crossViewNavAction({ key, control, meta, shift, alt }) {
  // Ctrl/Cmd+L — matches both `l` and `L` (the shifted form) with control||meta,
  // per the leg spec; no other guest accelerator uses the L key, so this is safe.
  if ((control || meta) && (key === 'l' || key === 'L')) return 'focus-address';
  // Unmodified forward Tab only — Shift/Ctrl/Alt/Meta+Tab fall through to null.
  if (key === 'Tab' && !shift && !control && !meta && !alt) return 'tab-handoff';
  return null;
}

// Dual export: CommonJS (main process + test runner) and global (renderer-class
// documents, which run with nodeIntegration:false and cannot require()) — mirrors
// sheet-accelerator.js / keydown-action.js.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { crossViewNavAction };
} else {
  /** @type {any} */ (globalThis).crossViewNavAction = crossViewNavAction;
}
