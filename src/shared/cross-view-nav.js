// @ts-check

// Real ES module (M07 Flight 2 sweep). Consumers are the main process
// (main.js, via require(esm)) and the test runner ONLY — no renderer document
// ever loaded this file via <script>, so the old globalThis branch was dead
// code and was deleted with the dual-export tail (no transitional bridge).

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
export function crossViewNavAction({ key, control, meta, shift, alt }) {
  // Ctrl/Cmd+L — matches both `l` and `L` (the shifted form) with control||meta,
  // per the leg spec; no other guest accelerator uses the L key, so this is safe.
  if ((control || meta) && (key === 'l' || key === 'L')) return 'focus-address';
  // Unmodified forward Tab only — Shift/Ctrl/Alt/Meta+Tab fall through to null.
  if (key === 'Tab' && !shift && !control && !meta && !alt) return 'tab-handoff';
  return null;
}
