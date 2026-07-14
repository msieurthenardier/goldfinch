// @ts-check

// Tab context-menu model for the menu-overlay sheet (M09 Flight 5, Leg 1).
// Pure params→model builder — same builder shape as pageContextModel
// (src/shared/page-context-model.js): given a snapshot of the tab strip
// position (relative to the right-clicked/focused tab) plus the closed-tab
// stack size, returns the typed item array the sheet renders.
//
// NAMESPACED id space: `tab:*` (`tab:close`, `tab:close-others`,
// `tab:close-right`, `tab:duplicate`, `tab:reopen-closed`) — the vocabulary
// page-context-model established.
//
// Omission rules (flight DD1, design-review ruling — OMITTED-ONLY: the sheet's
// renderMenu has no disabled-interactive-item shape, only item/separator/note):
//   - `tab:close-others` omitted when this is the ONLY tab in the strip
//     (`isLastTab` — true means "no other tab exists to close", not a
//     positional claim).
//   - `tab:close-right` omitted when there are no tabs to this tab's right
//     (`tabsToRight === 0`).
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
 * @param {{ tabId?: string, isLastTab: boolean, tabsToRight: number, stackSize: number }} params
 * @returns {Array<{ type: 'item', id: string, label: string } | { type: 'separator' }>}
 */
export function tabContextModel({ isLastTab, tabsToRight, stackSize }) {
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

  // --- duplicate (always) ---
  sep();
  item('tab:duplicate', 'Duplicate');

  // --- reopen closed (omit empty stack) ---
  if (stackSize > 0) {
    sep();
    item('tab:reopen-closed', 'Reopen closed tab');
  }

  return model;
}
