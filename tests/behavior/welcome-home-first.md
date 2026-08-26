# Behavior Test: Welcome Home First

**Slug**: `welcome-home-first`
**Status**: active
**Created**: 2026-08-25
**Last Run**: 2026-08-26 — pass (5/5; gate run for the M16 F3 leg-2 DD7 pivot on the final HAT build; run log `welcome-home-first/runs/2026-08-26-02-00-25.md`)

## Intent

Pins the one first-launch order Flight 2 reasoned about but never observed: on a both-unset welcome tab the user sets the **home page first**. **(Changed at M16 F3 leg 2, HAT item 6 — DD7 pivot.)** The welcome surface never navigates on its own except to run a pending search once an engine is chosen: setting the home page saves and stays — that same tab keeps showing the welcome surface, now with the home page card reflecting the saved value and a confirmation, and the engine card still offered (both choices can be made on the same tab; making one no longer forecloses the other, on that tab, in that sitting). `openNewTab()` still returns a plain home-page tab once a home page is set and never consults the welcome path, so a **new** tab never re-offers a choice that has already been made — that discipline is unchanged. The abandoned engine choice (never made on this tab) still comes back only when the user searches, through the address-bar handoff (`welcome-search-handoff`'s mechanism), on a **later**, different tab. This spec pins: the same-tab stay-and-reflect behavior with the engine choice left available but unmade, and the plain-tab-then-handoff path that follows once the user moves on. Also serves as the regression net for the Flight 3 restyle: every row reads the surface through the DOM contract Flight 3 freezes (DD2) (M16 F3).

## Preconditions

- Goldfinch dev build launched against a **fresh, empty** `XDG_CONFIG_HOME` scratch profile with the automation surface and admin key — no fixture setup; the first launch IS the test.
- MCP client attached with the run's minted key; the session-registered goldfinch MCP tools are never used.
- Network access is NOT required for rows 1–4; row 5 commits a DuckDuckGo search (judge on the committed address-bar URL if the network is absent).
- **Fixture-cleanliness note (M16 F3 leg 2, HAT item 6, DD7 pivot):** since Set no longer attaches the tab (row 2), the original welcome tab from row 1/2 is never closed or navigated by this spec — it stays open in the background, still a welcome tab, for the rest of the run. Rows 3–5 open and operate on separate tabs; the background tab's continued presence is expected and not itself asserted on.

## Observables Required

- browser (rendered chrome state — tab strip, address bar, welcome panel, Settings)
- filesystem (settings row)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Observe the freshly launched window. | Exactly one tab, titled "Welcome to Goldfinch", showing the welcome surface with **both** the home page block and the search engine block; the address bar is empty and writable; no committed URL. |
| 2 | In the welcome surface's home page block type `https://example.com` and click **Set** — while the engine block is still showing. *(changed at M16 F3 leg 2, HAT item 6 — DD7 pivot)* | That **same** tab stays a welcome tab: the home page field shows `https://example.com` with a saved confirmation beneath it; the engine card is still offered (no engine chosen). `[mixed-frame]` The settings row reads `homePage: "https://example.com"`, `searchEngine: null` — the engine choice was not made for the user. |
| 3 | Press Ctrl+T. | A **plain** tab opens on `https://example.com/` — no welcome surface, no engine block: new tabs do not re-offer the abandoned engine choice (the original welcome tab from step 2 stays open in the background, unaffected — see the fixture-cleanliness note below). `[mixed-frame]` The settings row still reads `searchEngine: null`. |
| 4 | In that tab type `zephyr quartz order` in the address bar and press Enter. | `[mixed-frame]` The `example.com` tab is untouched; a **new** welcome tab opens beside it and is the active tab — strip count +1 **read from the chrome DOM strip** (the welcome tab has no wcId yet and does not appear in `enumerateTabs`) — showing the search engine block only, headed with the pending query (*Where should we search for "zephyr quartz order"?*); no provider URL is committed anywhere — separately diff `enumerateTabs` before and after: no new entry, no provider host. |
| 5 | In that welcome tab choose **DuckDuckGo**. | That **same** welcome tab navigates to a `duckduckgo.com` URL containing the encoded query (tab count unchanged) — the abandoned choice, made later, runs the search that prompted it. `[mixed-frame]` The settings row reads `homePage: "https://example.com"`, `searchEngine: "duckduckgo"`. |

## Out of Scope

- The engine-first order (`welcome-first-launch` steps 4–6); the handoff's own escape and Clear rows (`welcome-search-handoff` steps 4–6) — row 4 here reuses only its entry mechanism.
- Visual appearance of the surface — the Flight 3 HAT judges it; this spec reads ids and a11y states, not pixels.
- The burner welcome path (`welcome-home-routing` step 5).
