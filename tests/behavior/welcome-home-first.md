# Behavior Test: Welcome Home First

**Slug**: `welcome-home-first`
**Status**: draft
**Created**: 2026-08-25
**Last Run**: never

## Intent

Pins the one first-launch order Flight 2 reasoned about but never observed: on a both-unset welcome tab the user sets the **home page first**. Setting a home page is itself a navigation (Flight 2 DD7's disjunctive exit), so the tab attaches immediately and the engine choice is abandoned for that tab. New tabs do **not** re-offer it — `openNewTab()` returns a plain home-page tab once a home page is set and never consults the welcome path — so the abandoned choice comes back only when the user searches, through the address-bar handoff (`welcome-search-handoff`'s mechanism). This spec pins both halves: the immediate attach with the engine left `null`, and the plain-tab-then-handoff path that follows. Also serves as the regression net for the Flight 3 restyle: every row reads the surface through the DOM contract Flight 3 freezes (DD2) (M16 F3).

## Preconditions

- Goldfinch dev build launched against a **fresh, empty** `XDG_CONFIG_HOME` scratch profile with the automation surface and admin key — no fixture setup; the first launch IS the test.
- MCP client attached with the run's minted key; the session-registered goldfinch MCP tools are never used.
- Network access is NOT required for rows 1–4; row 5 commits a DuckDuckGo search (judge on the committed address-bar URL if the network is absent).

## Observables Required

- browser (rendered chrome state — tab strip, address bar, welcome panel, Settings)
- filesystem (settings row)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Observe the freshly launched window. | Exactly one tab, titled "Welcome to Goldfinch", showing the welcome surface with **both** the home page block and the search engine block; the address bar is empty and writable; no committed URL. |
| 2 | In the welcome surface's home page block type `https://example.com` and click **Set** — while the engine block is still showing. | That **same** tab navigates to `https://example.com/` (tab count unchanged, same strip position); the welcome surface is gone from it. `[mixed-frame]` The settings row reads `homePage: "https://example.com"`, `searchEngine: null` — the engine choice was not made for the user. |
| 3 | Press Ctrl+T. | A **plain** tab opens on `https://example.com/` — no welcome surface, no engine block: new tabs do not re-offer the abandoned engine choice. `[mixed-frame]` The settings row still reads `searchEngine: null`. |
| 4 | In that tab type `zephyr quartz order` in the address bar and press Enter. | The `example.com` tab is untouched; a **new** welcome tab opens beside it and is the active tab — strip count +1 **read from the chrome DOM strip** (the welcome tab has no wcId yet and does not appear in `enumerateTabs`) — showing the search engine block only, headed with the pending query (*Where should we search for "zephyr quartz order"?*); no provider URL is committed anywhere — separately diff `enumerateTabs` before and after: no new entry, no provider host. |
| 5 | In that welcome tab choose **DuckDuckGo**. | That **same** welcome tab navigates to a `duckduckgo.com` URL containing the encoded query (tab count unchanged) — the abandoned choice, made later, runs the search that prompted it. `[mixed-frame]` The settings row reads `homePage: "https://example.com"`, `searchEngine: "duckduckgo"`. |

## Out of Scope

- The engine-first order (`welcome-first-launch` steps 4–6); the handoff's own escape and Clear rows (`welcome-search-handoff` steps 4–6) — row 4 here reuses only its entry mechanism.
- Visual appearance of the surface — the Flight 3 HAT judges it; this spec reads ids and a11y states, not pixels.
- The burner welcome path (`welcome-home-routing` step 5).
