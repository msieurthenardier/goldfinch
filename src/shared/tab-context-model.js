// @ts-check

// Tab context-menu model for the menu-overlay sheet (M09 Flight 5, Leg 1).
// Pure params→model builder — same builder shape as pageContextModel
// (src/shared/page-context-model.js): given a snapshot of the tab strip
// position (relative to the right-clicked/focused tab) plus the closed-tab
// stack size, returns the typed item array the sheet renders.
//
// NAMESPACED id space: `tab:*` (`tab:close`, `tab:close-others`,
// `tab:close-right`, `tab:duplicate`, `tab:move-new-window`,
// `tab:move-window:<windowId>`, `tab:reopen-closed`) — the vocabulary
// page-context-model established.
//
// Omission rules (flight DD1, design-review ruling — OMITTED-ONLY: the sheet's
// renderMenu has no disabled-interactive-item shape, only item/separator/note):
//   - `tab:close-others` omitted when this is the ONLY tab in the strip
//     (`isLastTab` — true means "no other tab exists to close", not a
//     positional claim).
//   - `tab:close-right` omitted when there are no tabs to this tab's right
//     (`tabsToRight === 0`).
//   - `tab:move-new-window` (M09 F6 DD5) omitted at `isLastTab` (moving a
//     sole tab to a NEW window is a no-op window swap) AND for internal tabs
//     (`isInternal` — app-UI pages never move between windows; F6 design review
//     M4). Defaults false so every pre-F6 caller is unaffected.
//   - `tab:move-window:<windowId>` (M09 F8 DD8) — one FLAT item per OTHER open
//     window, gated on `!isInternal` ALONE (M09 F10 L3 relaxed the isLastTab
//     condition it once shared with move-new-window): a sole tab may now
//     consolidate into an EXISTING window, with main closing the emptied source
//     (`tab-move-to-window` passes `allowSoleTab: true`). move-new-window keeps
//     its `isLastTab` omission — a sole-tab move to a NEW window is still a
//     no-op swap and stays refused. The two gates deliberately diverge here;
//     each still mirrors exactly what main's core refuses. Absent/empty
//     `moveTargets` (the
//     single-window case) emits NOTHING — no header, no note, no empty
//     submenu, per the OMITTED-ONLY ruling above. Defaults `[]` so every
//     pre-F8 caller is unaffected.
//     NO SUBMENU: the sheet's renderMenu has item/separator/note and nothing
//     else (DD8 — no submenu capability is assumed of it).
//     The id carries the target's `windowId`, NOT its ordinal (DD8, reversed at
//     review): a caller resolves the destination by id through the registry, so
//     a window closing between build and dispatch REFUSES rather than
//     re-pointing at whichever window now sits at that position. The `spell:<i>`
//     index-dispatch idiom's shape, deliberately carrying the stable key instead
//     of the position.
//   - `tab:reopen-closed` omitted when the closed-tab stack is empty
//     (`stackSize === 0`).
//   - `tab:duplicate` is ALWAYS present, even at a single tab (Chrome parity —
//     duplicate has no cardinality precondition).
//
// Item types (the page-context-model registry vocabulary; no `note` type is
// used here — every omission is a silent absence, never a note/disabled row):
//   { type: 'item', id, label }   — focusable role="menuitem" button
//   { type: 'separator' }         — role="separator", non-focusable, skipped by roving

/**
 * @param {{ tabId?: string, isLastTab: boolean, tabsToRight: number, stackSize: number, isInternal?: boolean, moveTargets?: Array<{ windowId: number, label: string }> }} params
 *   moveTargets — the OTHER open windows (M09 F8 DD8), each already captioned
 *   main-side from its active tab's title. This module stays PURE and
 *   Electron-free: it never reaches for a window list, it renders the one it is
 *   handed, so its item count is driven entirely by the caller's window count.
 * @returns {Array<{ type: 'item', id: string, label: string } | { type: 'separator' }>}
 */
export function tabContextModel({ isLastTab, tabsToRight, stackSize, isInternal = false, moveTargets = [] }) {
  /** @type {Array<{ type: 'item', id: string, label: string } | { type: 'separator' }>} */
  const model = [];
  let needSep = false;
  /** Separator before the next section — only emitted when a prior item exists
   * (never a leading separator, never a dangling trailing one: every call site
   * gates the sep() call itself, then unconditionally pushes an item). */
  const sep = () => {
    if (needSep) model.push({ type: 'separator' });
  };
  /** @param {string} id @param {string} label */
  const item = (id, label) => {
    model.push({ type: 'item', id, label });
    needSep = true;
  };

  // --- close section: close (always) / close-others (omit only-tab) / close-right (omit none-right) ---
  item('tab:close', 'Close');
  if (!isLastTab) item('tab:close-others', 'Close other tabs');
  if (tabsToRight > 0) item('tab:close-right', 'Close tabs to the right');

  // --- duplicate (always) + move-to-new-window (M09 F6 DD5) + move-to-window:*
  // (M09 F8 DD8; same section — Chrome adjacency). Both are omitted for internal
  // tabs (design review M4). move-new-window is ALSO omitted at isLastTab
  // (sole-tab move to a new window = no-op swap); move-window:* is NOT (M09 F10
  // L3 — a sole tab may consolidate into an existing window, source then closes). ---
  sep();
  item('tab:duplicate', 'Duplicate');
  if (!isInternal) {
    // move-new-window stays omitted for a SOLE tab (no-op window swap; M09 F6
    // DD5). move-window:* is NOT — a sole tab can now consolidate into another
    // EXISTING window and the emptied source closes (M09 F10 L3), so its gate
    // drops the isLastTab condition and rides `!isInternal` alone.
    if (!isLastTab) item('tab:move-new-window', 'Move to new window');
    // One flat item per OTHER window (M09 F8 DD8) — same section as the
    // new-window move (Chrome adjacency, the F6 precedent above).
    for (const t of moveTargets || []) {
      item(`tab:move-window:${t.windowId}`, `Move to window "${t.label}"`);
    }
  }

  // --- reopen closed (omit empty stack) ---
  if (stackSize > 0) {
    sep();
    item('tab:reopen-closed', 'Reopen closed tab');
  }

  return model;
}
