# Behavior Test: Bookmarks — Jar Ownership, Burner Inertness, and Jar Lifecycle

**Slug**: `bookmarks-jar-scoping`
**Status**: draft
**Created**: 2026-07-30
**Last Run**: never

## Intent

Verifies that bookmarks are owned by the cookie jar rather than the application: the bar, the star, and address-bar suggestions all reflect only the active tab's jar and swap contents when the active tab's jar changes; the same URL can be bookmarked independently in two jars; burner jars are inert for bookmarking; and a jar's bookmarks die with the jar but survive an identity wipe. This needs a behavior test because the central observable is *rendered chrome state changing in response to a tab switch* across multiple live jars and windows — a cross-process, cross-surface behavior that unit tests structurally cannot see. The lifecycle clauses need a real jar being really deleted, with a real session behind it.

## Preconditions

- App running via the canonical admin dev launch (`docs/dev-testing.md`); MCP key is **admin-tier**, confirmed by a successful `getChromeTarget` — not merely by tab enumeration succeeding.
- MCP binding reaches the instance under test (probe: open a tab, confirm it appears in `enumerateTabs`).
- Two persistent jars exist and are distinguishable in the chrome (the run below names them `personal` and `work`); a third, disposable jar exists for the deletion checkpoints so no fixture jar is destroyed mid-run.
- Bookmarks bar **enabled** in Settings (app-wide toggle) — several checkpoints assert bar contents, and the toggle is deliberately *not* jar-scoped.
- No pre-existing bookmarks in either fixture jar (fresh or cleared).
- **Operator present.** Apparatus constraint, inherited from the Flight 1 runs and unchanged: the menu-overlay sheet (popovers, context menus, suggestion dropdowns) is refused by the automation surface for ALL operations at EVERY tier by design (`automation: secret-sheet`, `src/main/automation/resolve.js`) — the refusal keys on the shared sheet `WebContentsView`'s wcId identity, not on content. Every step that types into, clicks inside, or dismisses a sheet is **operator-performed**; the Executor triggers the sheet and captures all evidence. There is also no window-create primitive and no hover primitive.
- Operator available for the two clauses stills cannot carry: the instantness of the burner reflow (an *absence* of animation) and the absence of a stale frame on jar switch.

## Observables Required

- browser (rendered chrome UI: bookmarks bar, address-bar star, suggestions sheet — measured via the goldfinch MCP chrome target; screenshots primary, accessibility tree secondary)
- browser (per-tab jar identity — measured via the goldfinch MCP tab enumeration, which carries `jarId`)
- browser (per-jar stored bookmark truth — measured via `window.goldfinch.bookmarksGet({ jarId })` evaluated on the chrome target; **await it** — it is a Promise and silently yields `{}` if not awaited, a documented false-negative trap from the Flight 1 runs)
- filesystem / shell (direct `app.db` table inspection via `sqlite3`, with the app **down** — measured via Bash). Required, not optional: post-deletion and orphaned-row assertions are unreachable from the chrome target, because a deleted jar has no tab through which to query it. This mirrors the direct-inspection procedure `sqlite-store-migration` already establishes.

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Open a tab in the `personal` jar and navigate it to a stable public page (e.g. `https://example.com/`). Bookmark it via the star. Operator names it `Personal Copy` and confirms. | The bar shows exactly one item, `Personal Copy`; the star is filled. Stored truth for `personal` holds one entry; stored truth for `work` is empty. |
| 2 | Open a second tab in the `work` jar, navigate it to the **same** URL, and activate it. | On activation the bar re-renders **empty** and the star returns to **outline** — the same URL is not bookmarked in this jar. No bookmark data from `personal` is visible anywhere in the chrome. |
| 3 | With the `work` tab active, bookmark the page via the star. Operator names it `Work Copy` and confirms. | The bar shows exactly one item, `Work Copy`. Stored truth: `personal` holds one entry titled `Personal Copy`, `work` holds one titled `Work Copy` — same URL, independent entries, neither overwritten. |
| 4 | Switch the active tab back and forth between the `personal` and `work` tabs several times, capturing the bar and star after each switch. | The bar contents and star state track the active tab's jar on **every** switch — `Personal Copy` / filled, then `Work Copy` / filled — with no frame showing the other jar's contents. *(Operator confirms live that no stale contents flash between switches — a null-result observation stills cannot carry.)* |
| 5 | In the `personal` tab, rename its bookmark to `Personal Renamed` via right-click on the bar item. Then switch to the `work` tab and back. | The rename is visible in `personal`. The `work` jar's bar is unchanged by it (`Work Copy`), and its stored entry is byte-identical to before — a mutation in one jar never reaches another. |
| 6 | With the `personal` tab active, type a prefix matching the bookmark into the address bar and observe the suggestions. Then repeat in the `work` tab with the same prefix. | Each jar surfaces **only its own** bookmark row, with the bookmark indicator, and neither surfaces the other's. *(Inverts `bookmarks-omnibox` checkpoint 4, which asserted the superseded app-scoped behavior.)* |
| 7 | Open a burner tab and navigate it to a normal web page. Capture the chrome before and after activating it. | The bookmarks bar is **not rendered at all** in the burner tab, and no star is visible. The guest area reflows to reclaim the bar's height. *(Operator confirms the reflow is instant with no animation — the never-animate-guest-layout invariant; an absence stills cannot prove.)* |
| 8 | With the burner tab active, press `Ctrl+D`, then right-click the page background. Then switch back to the `personal` tab. | Nothing observable happens on `Ctrl+D`: no popover, no star, no bar. The page context menu offers **no** bookmark item at all (not a present-but-inert one). Stored truth for every jar is unchanged — no bookmark was created anywhere, and no row exists under any burner id. The `personal` tab's bar and star return intact on switch back. |
| 8b | Activate an internal page (`goldfinch://settings`), capturing before and after. Then return to the `personal` tab. | The bar is suppressed exactly as in the burner case, and the guest reflows; no star. On return to `personal` the bar comes back with identical contents. *(Operator confirms both reflows are instant.)* |
| 8c | From the `personal` tab, middle-click a bar item, then Ctrl+click another. | Both open in background tabs **in the `personal` jar** — not the default jar and not a burner. Jar identity confirmed per new tab from the tab enumeration's `jarId`. |
| 8d | With the **same URL** still bookmarked independently in both jars (steps 1–3), open that URL in a **background** tab in the `work` jar (site serves a favicon) while a `personal` tab stays active. | The `personal` jar's stored entry for that URL is byte-identical before and after the background tab's favicon arrives — a background tab's favicon writes only onto its **own** jar's same-URL bookmark, never the other jar's. *(Same-URL is the point: with distinct URLs even the unfixed flat-list code would pass this step.)* |
| 9 | Open a second window (**operator-assisted** — the MCP surface has no window-create tool) and put a tab in the `personal` jar there. In window A's `personal` tab, remove the bookmark via the star popover (operator-performed). Observe window B without touching it. | Window B's `personal` bar and star update to reflect the removal with zero interaction in window B — cross-window sync still holds **within** a jar. |
| 10 | Re-bookmark in `personal`. Then, in window A, switch to a `work` tab and mutate the `work` bookmark. Observe window B, still showing `personal`, without touching it. | Window B's bar is **unaffected** by the `work`-jar mutation — the invalidation does not cross jars. *(Negative counterpart to checkpoint 9; a before/after pair on window B carries it.)* |
| 11 | In the disposable third jar, create a bookmark. Then perform a full **identity wipe** of that jar from the jars page (not a delete). | The jar's bookmarks **survive** the wipe — stored truth still holds the entry, and a tab in that jar still shows it on the bar. Cookies/storage/cache/history are cleared as before. |
| 12 | In the same disposable jar, use the **Bookmarks** data-class clear control. | That jar's bookmarks are removed; its bar renders empty. Every other jar's stored bookmarks are untouched. |
| 13 | Re-create a bookmark in the disposable jar, then **delete the jar itself** from the jars page. Quit the app and inspect the `bookmarks` table directly. | The jar's bookmarks are removed with it — the direct table read shows **no rows** carrying the deleted jar's id, and no other jar's rows are affected. |
| 14 | With the app still down from step 13, relaunch and re-create a jar with the **same name** as the deleted one (so it claims the same recycled id). Open a tab in it. | The new jar's bar is **empty**. The deleted jar's bookmarks do not reappear — neither from storage nor from a stale chrome cache entry keyed on the recycled id. *(This step spans a restart, so it verifies storage truth; the live in-session eviction path is pinned by unit test — the delete-and-recreate-without-restart case.)* |
| 15 | Quit the app and relaunch. Inspect both fixture jars. | Each jar's bookmarks return with their own names, order, and icons intact, still separated by jar — jar ownership survives a restart. |

## Out of Scope

- Star state sync across navigation, in-page address changes, and tab switches within a single jar (see `bookmarks-star-sync`)
- Bar rendering detail, overflow menu, tooltips, middle-click, and row-level validation of stored data (see `bookmarks-bar`)
- Suggestion ranking, dedup against history, and the bookmark indicator's appearance (see `bookmarks-omnibox`)
- Drag interactions (Flight 3)
- Jar export — the roadmap goal motivating jar ownership, but not built in this flight
