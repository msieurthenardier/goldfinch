// @ts-check

// Real ES module (M07 Flight 2 sweep). Consumers are the main process
// (main.js, via require(esm)) and the test runner ONLY — no renderer document
// ever loaded this file via <script>, so the old globalThis branch was dead
// code and was deleted with the dual-export tail (no transitional bridge).

/**
 * crossViewNavAction({ key, control, meta, shift, alt })
 *
 * Pure decision for the guest→chrome keyboard bridge (M05 Flight 5 Leg 2; M17
 * Flight 1 Leg 1, DD3; M17 Flight 1 Leg 2, DD6). On the native multi-
 * `WebContentsView` surface, OS keyboard focus lives in ONE view at a time,
 * so this key must be captured main-side on a focused guest and handed back
 * across the boundary to the chrome view:
 *
 *   Ctrl/Cmd+L        → 'focus-address'    (focus the address bar — a chrome-level
 *                       accelerator, dead when a guest holds OS focus otherwise)
 *   F6                → 'focus-address'    (Chrome's own F6 contract: from the page,
 *                       F6 goes to the omnibox — same target as Ctrl/Cmd+L)
 *   Shift+F6          → 'focus-chrome-end' (the chrome's last visible tabbable — the
 *                       backward-boundary placement, DD9's shared tabSequence walk)
 *
 * F6 is gated on ctrl/meta/alt (parity with the chrome-side classifier,
 * keydown-action.js's `keydownToAction`): Ctrl+F6 / Meta+F6 / Alt+F6 is a
 * no-op on both sides (Edge Cases).
 *
 * Everything else → null (the guest keeps the key — F12/zoom/print/find/downloads/
 * devtools stay with their own guest branches; this decision never intercepts them).
 *
 * M17 F1 L1 (DD3) — unmodified Tab → null (handled by the guest-tab-boundary
 * signal, M17 F1). Unmodified forward Tab used to return 'tab-handoff' here
 * and eject to the address bar on EVERY press mid-page (M05 F5 L2's original
 * gap). That branch is retired: `tabBoundary` (src/shared/tab-boundary.js),
 * wired from both guest preloads, now decides per-press whether Tab is at the
 * end of the page's tabbable sequence — only THEN does the preload send
 * `guest-tab-boundary`, forwarded main-side as `tab-boundary`. Mid-page Tab
 * falls all the way through to Chromium's own default action, unintercepted
 * by this module or by `guest-wiring.js`'s before-input-event branches.
 *
 * The decision is pure (no DOM/IPC/Electron) so it unit-tests like sheet-accelerator.js;
 * the caller (`handleCrossView` in guest-wiring.js) runs the focus-then-send side
 * effects (OS-focus the chrome view, THEN the `chrome-shortcut-action` send carrying
 * THIS computed action — the F4 focus-then-send rule) and the isAutoRepeat guard.
 *
 * @param {{ key: string, control: boolean, meta: boolean, shift: boolean, alt: boolean }} input
 * @returns {'focus-address' | 'focus-chrome-end' | null}
 */
export function crossViewNavAction({ key, control, meta, shift, alt }) {
  // Ctrl/Cmd+L — matches both `l` and `L` (the shifted form) with control||meta,
  // per the leg spec; no other guest accelerator uses the L key, so this is safe.
  if ((control || meta) && (key === 'l' || key === 'L')) return 'focus-address';
  // F6 / Shift+F6 (M17 F1 L2, DD6) — decided BEFORE nothing else gates it (no
  // separate "mod" branch here, unlike keydownToAction): an unmodified F6
  // focuses the address bar; Shift+F6 focuses the chrome's last visible
  // tabbable; any of ctrl/meta/alt held makes it a no-op (parity).
  if (key === 'F6' && !control && !meta && !alt) return shift ? 'focus-chrome-end' : 'focus-address';
  return null;
}
