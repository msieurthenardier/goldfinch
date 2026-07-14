# Behavior Test: First-class tab management

**Slug**: `tab-management`
**Status**: active
**Created**: 2026-07-14

## Intent

Verify Issue #82 end to end: pointer and keyboard reorder, middle-click and tab-scoped
menu actions, recently-closed restoration with jar fidelity and burner exclusion,
multi-window tear-off/cross-window re-parenting, keyboard parity, and startup restore.

## Preconditions

- Run `npm run dev:automation` with an admin key and drive the chrome renderer through
  the loopback MCP surface described in `docs/mcp-automation.md`.
- Serve distinct fixture URLs so order, navigation history, and tab identity are observable.
- Use a disposable dev profile. Multi-window and startup checkpoints close/relaunch the app.

## Checkpoints

| # | Action | Expected result |
|---|---|---|
| 1 | Open four distinct tabs. Pointer-drag the first between the third and fourth. | Tabs displace during the drag and the final ARIA tab order matches the drop position; the active guest remains the same live `wcId`. |
| 2 | Focus that tab and press `Ctrl+Shift+ArrowLeft`, then `Ctrl+Shift+ArrowRight`. | Each chord moves the focused/active tab one slot and preserves focus/selection. |
| 3 | Middle-click a background tab. | Exactly that tab closes; the active tab does not change. |
| 4 | Open a tab's context menu by right-click and by Context-Menu key. Exercise Close other tabs, Close tabs to the right, Duplicate, and Reopen closed tab. | The shared menu-overlay sheet presents all actions with correct disabled states and each action targets the captured tab. Duplicate preserves URL/jar. |
| 5 | Close a persistent-jar tab, press `Ctrl+Shift+T`, and inspect its jar indicator/session. Then close a burner tab and press the chord again. | The persistent tab returns with the same jar; the burner never enters the recently-closed stack and is not resurrected. |
| 6 | Exercise `Ctrl+Tab`, `Ctrl+Shift+Tab`, `Ctrl+PgDn`, `Ctrl+PgUp`, `Ctrl+1`–`Ctrl+8`, and `Ctrl+9` under chrome, web-guest, internal-tab, and open-sheet focus. | Each chord selects the specified tab consistently across focus domains. |
| 7 | Drag a tab out of the strip. | A new Goldfinch `BaseWindow` opens and adopts the same guest `wcId`; URL, navigation history, and jar session remain intact. The source window retains a usable tab. |
| 8 | Drag the adopted tab into the other Goldfinch window. | The same guest `wcId` is re-parented into the destination window and removed from the source; both window shells remain independently operable. |
| 9 | Enable “Restore previous tabs and windows,” leave two windows with persistent-jar tabs, quit, and relaunch. | Both windows and their ordered tabs/active indexes return with jar assignments. Burner tabs are absent. |
| 10 | Disable the setting, quit, and relaunch. | Goldfinch opens one normal home tab and does not restore the prior session. |

## Verification boundary

The `wcId` equality in checkpoints 1, 7, and 8 is the proof that transfer re-parents a
live `WebContentsView` rather than recreating a URL-only replacement. Screenshot/AX evidence
proves rendered strip and menu behavior; session/jar state is read through the existing
admin tab enumeration and chrome DOM observables.
