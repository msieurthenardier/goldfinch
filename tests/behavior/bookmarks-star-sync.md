# Behavior Test: Bookmarks — Star State, Popover, and Sync

**Slug**: `bookmarks-star-sync`
**Status**: active
**Created**: 2026-07-28
**Last Run**: 2026-08-04-14-45-00 — 11/11 pass ([run log](bookmarks-star-sync/runs/2026-08-04-14-45-00.md)); first run since bookmarks became jar-owned

## Intent

Verifies that starring a page from the address-bar star, the page context menu, or the keyboard shortcut creates/edits/removes a bookmark, and that the star's filled/outline state tracks the truth through every sync path: navigation, in-page (SPA) address changes, tab switches, cross-window edits, and internal-page gating. This needs a behavior test because the observables are rendered chrome UI state across multiple live windows and a real guest page — nothing a unit test can see.

## Preconditions

- App running via the canonical admin dev launch (`docs/dev-testing.md`); MCP key is **admin-tier** (chrome-target access verified by a successful `getChromeTarget`, not just tab enumeration)
- MCP binding reaches the instance under test (probe: open a tab, confirm it appears in `enumerateTabs`)
- No existing bookmarks **in the jar under test** — bookmarks are jar-owned as of M15 Flight 2, so a globally-empty store is neither required nor meaningful; other jars may hold whatever they like. Name the jar under test in the run log. The cleanest fixture is an empty registered jar (e.g. `disposable`), which avoids clearing a jar whose contents other specs depend on
- Window creation: no MCP window-create tool exists, but **Ctrl+N via `pressKey` on the chrome target works** — it runs `shortcut-controller.js`'s `new-window` case, the same body the kebab item runs, so it is the real user path rather than a test-only seam (verified 2026-08-03 during the `bookmarks-bar` run). Step 9 therefore does not need the operator to create the window — only to interact with sheets
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
| 6 | Right-click on the page background. **Leave the menu open** — do not dismiss it to report, because clicking away closes it. The Executor polls `enumerateWindows` and captures the instant `sheetVisible` goes true. Dismiss afterwards. | The context menu includes a bookmark item for this page labelled exactly "Edit bookmark…" — the **already-bookmarked** label, not "Bookmark this page". Sheet-interior, so `captureWindow` while the menu is open is the only possible evidence; a post-dismissal capture cannot support the claim. Corroborate the exact characters against the source string (`src/shared/page-context-model.js:140`), **paired with** the rendered capture, never substituted for it — source can diverge from the running build. *(The clause "it opens the same quick-edit popover, which offers Remove" was removed from this row at the 2026-08-04 run: it is a testable behavioural claim that this row's Actions never exercise — right-click and dismiss, never activate — so no run could observe it without deviating from the prescribed steps. The popover's contents are already directly exercised at steps 2–3 and its Remove action at step 8.)* |
| 7 | Open a second tab to a third, unbookmarked page, then switch back and forth between the tabs. | The star state follows the active tab correctly on every switch: filled on the bookmarked tabs, outline on the unbookmarked one. |
| 8 | On the bookmarked `example.com` tab: click the star, then activate Remove in the popover. | The popover closes and the star returns to outline state. |
| 9 | Open a second window (**operator-assisted, or synthetic Ctrl+N via pressKey if the pre-flight probe verified it** — the MCP surface has no window-create tool), **its tab in the SAME jar as window A's tabs throughout this spec** (confirm via each window's jar indicator/`enumerateTabs[].jarId` before proceeding — same-jar is load-bearing for this checkpoint as of M15 F2 "Jar-Scoped Bookmarks"). In window B, navigate to `https://example.org/` (bookmarked in step 5). Then, in window A, remove that bookmark via the star popover. Observe window B without interacting with it. | Window B's star transitions to outline state without any action in window B — cross-window sync holds **within a jar**. *(The cross-jar negative counterpart — a mutation in one jar's window never reaching a DIFFERENT jar's window — is covered by the `bookmarks-jar-scoping` spec, not here.)* |
| 10 | Navigate a tab to an internal page (`goldfinch://settings`). | No star control is visible (or it is inert/hidden) on the internal page; pressing Ctrl+D does nothing observable. |
| 11 | With the base URL bookmarked, trigger an in-page address change (e.g. `https://example.com/#section` from `https://example.com/`), **then reverse it back to the base URL**. Prove each leg is genuinely same-document, not a reload — set a JS global on the tab's own page context and check it survives the transition. | The star re-evaluates **in both directions**: outline at the fragment URL (not separately bookmarked) while the store still holds the base URL untouched, then **filled again** on return — per exact-URL matching. *(The reversal was added at the 2026-08-04 run. Forward-only wording left a real gap: an implementation that blanks the star on **any** URL-change event, never re-deriving per-URL truth, passes the forward direction perfectly while being broken, because nothing tests that it can fill back in.)* **Apparatus warning from that run:** `navigate()` **adding** a fragment is same-document, but `navigate()` **removing** one triggers a full reload — so a round trip driven by two plain `navigate` calls silently confounds the reversal, turning in-page re-derivation into fresh-load re-evaluation. Use `history.pushState` in the page context for the reversal. The marker check is what catches this; without it the confounded result looks clean. |

## Out of Scope

- The bookmarks bar, overflow menu, and bar editing (see `bookmarks-bar`)
- Omnibox suggestions (see `bookmarks-omnibox`)
- Drag interactions (Flight 2)
- Restart persistence (covered in `bookmarks-bar`)
