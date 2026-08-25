# Behavior Test: Welcome Search Handoff

**Slug**: `welcome-search-handoff`
**Status**: active
**Created**: 2026-08-24
**Last Run**: 2026-08-25 — partial (6/6 automatable rows pass; step 7 operator-pending; run log `welcome-search-handoff/runs/2026-08-25-04-48-18.md`)

## Intent

Verifies that a search typed with no engine chosen is not lost: it lands on a welcome tab that shows the pending query and offers only the search-engine choice, choosing an engine runs that search in that same tab, the choice persists so the next search goes straight to the engine, and typing an address on a pending-query welcome tab simply navigates it (the query is discarded, the user is not trapped). The context-menu entry point is covered by an operator row because its sheet is outside the automation surface. Pins mission criteria 5 (never sends a query to an unchosen provider), 6 (search case), 7, and 8 (M16 F2).

## Preconditions

- Fresh scratch profile launched with the automation surface and admin key; **as fixture setup**, the home page set to `https://example.com` via Settings and the search engine left **unset** (fresh default) — verified by reading the settings row (`homePage` set, `searchEngine: null`).
- MCP client attached with the run's minted key; the session-registered goldfinch MCP tools are never used.
- Network access is NOT required.
- **Operator present** for step 7 (operator-performed row — see the row for the apparatus reason).

## Observables Required

- browser (rendered chrome state — welcome panel, address bar, tab strip; Settings radio group)
- filesystem (settings row, once, after the engine is chosen)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Press Ctrl+T. | The new tab opens on `https://example.com/` — with a home page set and no engine, a plain new tab is not a welcome tab. |
| 2 | On that tab, type `zephyr quartz pending` in the address bar and press Enter. | A welcome tab opens **beside** the example.com tab (the page the user was on is untouched) showing only the search-engine block, headed with the pending query text `zephyr quartz pending`. No tab navigated to any search provider; the address bar of the welcome tab is empty. |
| 3 | Choose DuckDuckGo in the welcome tab's engine list. | That same welcome tab navigates to a `duckduckgo.com` search URL containing `zephyr quartz pending` (tab count unchanged). |
| 4 | Read the settings row. | `[mixed-frame]` `searchEngine` is `"duckduckgo"`; `homePage` is still `"https://example.com"`. |
| 5 | Press Ctrl+T; type `zephyr quartz direct`, Enter. | The new tab (opened on example.com) navigates directly to a `duckduckgo.com` search URL — no welcome surface appears now that an engine is set. |
| 6 | Open Settings; click the search engine **Clear** button. Then in a new tab type `zephyr quartz again`, Enter; on the resulting welcome tab type `example.net` in the address bar, Enter. | After Clear, the radio group shows no engine selected with a hint that the welcome page will ask. The search lands on a welcome tab with the pending query; typing an address navigates that same tab to `https://example.net/` and the pending query is gone with it — no provider URL was ever committed. |
| 7 | **Operator-performed** (the page-context sheet is a chrome-owned overlay outside `AUTOMATABLE_MENU_TYPES`, refused at every tier and not composited by `captureWindow`): with the engine still unset, select text on any page, right-click, choose "Search for …". | A welcome tab opens in the source tab's jar with the selected text as its pending query; choosing an engine runs it. Verdict is operator-observed. Structural coverage: `sel:search` dispatches through the same `toUrl` the address-bar rows verify. |

## Out of Scope

- Home-page routing and same-tab navigation from a home-only welcome — `welcome-home-routing`.
- First launch — `welcome-first-launch`.
- Engine-table membership and repair — unit-tested.
