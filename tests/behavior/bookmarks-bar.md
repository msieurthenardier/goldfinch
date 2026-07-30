# Behavior Test: Bookmarks Bar — Toggle, Reflow, Overflow, Edit, Persistence

**Slug**: `bookmarks-bar`
**Status**: active
**Created**: 2026-07-28
**Last Run**: 2026-07-29-18-23-40 (pass, 12/12; checkpoint 8 failed first attempt, fixed inline and re-run)

## Intent

Verifies the bookmarks bar end-to-end: the merged startup-and-appearance Settings section with its off-by-default toggle, instant (non-animated) show/hide reflow across windows, bar rendering (order, names, site icons, tooltips), click and middle-click activation, overflow collapse with per-row editing, and restart persistence including corrupt-store repair. Behavior test because the observables are rendered chrome layout (guest area geometry during toggle), multi-window sync, and cross-restart state.

## Preconditions

- App running via `npm run dev:automation`; **admin-tier** MCP key verified via `getChromeTarget`; instance identity confirmed (re-verify after the relaunch steps)
- Operator available for the two relaunch steps AND for every sheet interaction — apparatus constraints established run 2026-07-29: the menu-overlay sheet (popovers, overflow menu, context menus) refuses ALL automation ops at EVERY tier by design; there is no hover primitive (native tooltips are un-assertable); there are no window-create/resize tools
- Reader notes for the Executor: `readAxTree` (not `readDom` HTML) is authoritative for live checkbox state; every `window.goldfinch.*` read is Promise-based and silently yields `{}` if not awaited; clicking a named chrome control requires an `evaluate` + `getBoundingClientRect()` round-trip then a coordinate click; after a relaunch, check port/pid (a stale instance answers 401 rather than refusing) and identify the continuing window by tab-set match, not `lastFocused`; dismiss any popover before capturing "did the bar update" evidence
- At least 8 bookmarks exist with distinct names (create via star if needed; enough to overflow a normal-width window when the bar is narrow — resize window narrower if needed)

## Observables Required

- browser (rendered chrome UI: settings page, bar, overflow sheet, guest-area geometry — goldfinch MCP chrome target; screenshots primary)
- filesystem/shell (operator-assisted: app relaunch; corrupt-store fixture write while app is closed)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Open `goldfinch://settings`. Inspect the section navigation and content. | Settings shows a single combined startup-and-appearance section (no separate "On startup" / "Appearance" entries); it contains a bookmarks-bar toggle in the off state. [a11y] |
| 2 | With a second window open (**operator-assisted, or synthetic Ctrl+N via pressKey if the pre-flight probe verified it** — no MCP window-create tool exists), enable the bookmarks-bar toggle. Observe both windows. | The bar appears under the toolbar in **both** windows immediately; the page area shrinks to make room in a single instant step (no visible animation/transition); page content remains correctly laid out. |
| 3 | Toggle the bar off and on again via the keyboard shortcut (Ctrl+Shift+B) from a normal browsing tab. | The bar hides and re-shows instantly; the settings page toggle (re-checked afterwards) reflects the final state. |
| 4 | Examine the bar's items. Hover one. | Bookmarks appear in stored order, each with a site icon (or letter monogram where no icon was captured) and its name; hovering shows a tooltip containing the bookmark's name and address. |
| 5 | Left-click a bookmark on the bar. | The current tab navigates to that bookmark's page; the bar stays visible. |
| 6 | Middle-click (or Ctrl+click) a different bookmark on the bar. Observe the tab strip and active tab. | A new tab for that bookmark appears in the tab strip, but focus/foreground stays on the current tab (background open); switching to the new tab shows the bookmarked page loaded/loading. |
| 7 | Ensure more bookmarks exist than fit the bar at the current window width (add more via star if needed — **no MCP window-resize tool exists**; window narrowing, if needed instead, is operator-assisted). | The bar shows leading bookmarks plus an overflow control; overflowed bookmarks are absent from the main row. |
| 8 | Click the overflow control. | A menu sheet opens listing the remaining bookmarks with their names; arrow keys move through rows and Escape closes it (standard sheet keyboard contract). [a11y] |
| 9 | Reopen the overflow menu; right-click one of its rows, and edit the bookmark's name to `Renamed In Overflow`. | An edit surface opens for exactly that bookmark; after confirming, the updated name is visible (in overflow or on the bar) without any manual refresh. |
| 10 | Right-click a bookmark on the main bar; change its URL to a different valid web address, confirm; then right-click another and remove it. | The edited bookmark navigates to the new URL when clicked; the removed bookmark disappears from the bar immediately; total count drops by one. |
| 11 | Operator: quit the app fully and relaunch (`npm run dev:automation`). Re-verify MCP instance identity. Observe the bar. | The bar is still enabled and shows the same bookmarks in the same order with names and icons preserved (restart persistence). |
| 12 | Operator: quit the app; corrupt the bookmarks document row in the app database (it is a SQLite `documents` row, not a standalone file — e.g. `sqlite3 <userData>/app.db "UPDATE documents SET payload='garbage' WHERE store='bookmarks'"`); relaunch. [mixed-frame] — the corrupting action is only possible at the storage layer; the observable is the UI's repair behavior. | The app starts normally (no boot failure); the bar renders empty (repaired-to-empty), and starring a page adds a bookmark normally again. |

## Out of Scope

- Star/popover state sync details (see `bookmarks-star-sync`)
- Omnibox suggestions (see `bookmarks-omnibox`)
- Drag interactions: reorder, bar↔overflow moves, drag-onto-page (Flight 2)
- Per-entry (partial) corruption repair — asserted at unit level in the store's tests
