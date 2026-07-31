# Behavior Test: Bookmarks — Star State, Popover, and Sync

**Slug**: `bookmarks-star-sync`
**Status**: active
**Created**: 2026-07-28
**Last Run**: 2026-07-29-15-04-37 (pass, 11/11)

## Intent

Verifies that starring a page from the address-bar star, the page context menu, or the keyboard shortcut creates/edits/removes a bookmark, and that the star's filled/outline state tracks the truth through every sync path: navigation, in-page (SPA) address changes, tab switches, cross-window edits, and internal-page gating. This needs a behavior test because the observables are rendered chrome UI state across multiple live windows and a real guest page — nothing a unit test can see.

## Preconditions

- App running via the canonical admin dev launch (`docs/dev-testing.md`); MCP key is **admin-tier** (chrome-target access verified by a successful `getChromeTarget`, not just tab enumeration)
- MCP binding reaches the instance under test (probe: open a tab, confirm it appears in `enumerateTabs`)
- No existing bookmarks (fresh or cleared `bookmarks` store)
- **Operator present** — apparatus constraint (established run 2026-07-29): the menu-overlay sheet (popover, context menus) is refused by the automation surface for ALL ops at EVERY tier by design (`automation: secret-sheet`). Every step that types into, clicks inside, or dismisses a sheet (steps 3, 5, 6, 8, 9) is **operator-performed**; the Executor triggers the sheet's appearance and captures all evidence. Multi-window creation (step 9) is also operator-performed.

## Observables Required

- browser (rendered chrome UI: star control, popover sheet, page context menu — measured via the goldfinch MCP chrome target: screenshots primary, accessibility tree secondary)
- browser (guest page content and URL — measured via goldfinch MCP tab tools)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Open a tab and navigate to a stable public web page (e.g. `https://example.com/`). Observe the address area of the chrome. | A star control is visible beside the address field, in the outline (not bookmarked) state. |
| 2 | Click the star. | A quick-edit popover appears anchored near the star, showing a name field prefilled with the page title, a URL field, and Remove and Done actions; the star is now filled. |
| 3 | In the popover, change the name to `Example Bookmark` and confirm/Done. | The popover closes; the star remains filled. |
| 4 | Navigate the same tab to a different page (e.g. `https://example.org/`). | The star returns to outline state on the new page. |
| 5 | Press the bookmark keyboard shortcut (Ctrl+D). | The star fills and the quick-edit popover opens for the new page. Dismiss it; the star stays filled. |
| 6 | Right-click on the page background. | The context menu includes a bookmark item for this page labelled "Edit bookmark…" (the already-bookmarked label; it opens the same quick-edit popover, which offers Remove). Dismiss the menu. |
| 7 | Open a second tab to a third, unbookmarked page, then switch back and forth between the tabs. | The star state follows the active tab correctly on every switch: filled on the bookmarked tabs, outline on the unbookmarked one. |
| 8 | On the bookmarked `example.com` tab: click the star, then activate Remove in the popover. | The popover closes and the star returns to outline state. |
| 9 | Open a second window (**operator-assisted, or synthetic Ctrl+N via pressKey if the pre-flight probe verified it** — the MCP surface has no window-create tool), **its tab in the SAME jar as window A's tabs throughout this spec** (confirm via each window's jar indicator/`enumerateTabs[].jarId` before proceeding — same-jar is load-bearing for this checkpoint as of M15 F2 "Jar-Scoped Bookmarks"). In window B, navigate to `https://example.org/` (bookmarked in step 5). Then, in window A, remove that bookmark via the star popover. Observe window B without interacting with it. | Window B's star transitions to outline state without any action in window B — cross-window sync holds **within a jar**. *(The cross-jar negative counterpart — a mutation in one jar's window never reaching a DIFFERENT jar's window — is covered by the `bookmarks-jar-scoping` spec, not here.)* |
| 10 | Navigate a tab to an internal page (`goldfinch://settings`). | No star control is visible (or it is inert/hidden) on the internal page; pressing Ctrl+D does nothing observable. |
| 11 | Navigate a tab to a single-page-app-style URL and trigger an in-page address change (e.g. navigate to a page, then use the site's own client-side navigation, or navigate to `https://example.com/#section` from `https://example.com/`). | The star state re-evaluates on the in-page address change: the fragment URL (not separately bookmarked) shows outline even though the base URL's bookmark state may differ, per exact-URL matching. |

## Out of Scope

- The bookmarks bar, overflow menu, and bar editing (see `bookmarks-bar`)
- Omnibox suggestions (see `bookmarks-omnibox`)
- Drag interactions (Flight 2)
- Restart persistence (covered in `bookmarks-bar`)
