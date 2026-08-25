# Behavior Test: Welcome First Launch

**Slug**: `welcome-first-launch`
**Status**: active
**Created**: 2026-08-24
**Last Run**: 2026-08-25 — pass (7/7; re-run at M16 F3 leg 1 on the restyled build; run log `welcome-first-launch/runs/2026-08-25-20-20-29.md`)

## Intent

Verifies the fresh-profile outcome end to end: a brand-new profile boots with neither preference set (explicitly `null` on disk), its single tab is a welcome tab offering both choices, the address bar and bookmarks bar are usable from it, Goldfinch commits no provider URL before a choice, and each choice removes exactly its own block — setting the engine leaves new tabs on the welcome surface until the home page is set, and setting the home page leaves searches on the welcome surface until an engine is set. Pins mission criteria 3 (independence), 5, 6 (both-together case), and 10 (repair-to-unset is unit-tested; this pins the fresh default) (M16 F2).

## Preconditions

- Goldfinch dev build launched against a **fresh, empty** `XDG_CONFIG_HOME` scratch profile with the automation surface and admin key — no fixture setup at all; the first launch IS the test.
- MCP client attached with the run's minted key; the session-registered goldfinch MCP tools are never used.
- Network access is NOT required.

## Observables Required

- browser (rendered chrome state — tab strip, address bar, welcome panel, bookmarks bar, Settings)
- filesystem (settings row at first load — the pin-on-load write)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Observe the freshly launched window. | Exactly one tab, titled "Welcome to Goldfinch", showing the welcome surface with **both** the home page block and the search engine block; the address bar is empty with its placeholder and is writable; no tab has committed any URL. [a11y] |
| 2 | Read the profile's settings row. | `[mixed-frame]` The row exists with `version: 3`, `homePage: null`, and `searchEngine: null` — both keys present and explicitly unset (pinned at first load, not merely absent). |
| 3 | Open Settings; enable "Show bookmarks bar"; return to the welcome tab. | The bookmarks bar is visible on the welcome tab (empty, but present) — the bar is not suppressed on this surface. Settings shows an empty home page field and no engine selected, each with its hint. |
| 4 | In the welcome tab's search engine block choose Brave Search. | The engine block disappears; the home page block remains; the tab stays a welcome tab. A subsequent Ctrl+T opens another welcome tab with only the home page block. |
| 5 | In that new welcome tab type `zephyr quartz fresh` in the address bar, Enter. | The tab navigates to a `search.brave.com` search URL containing the query — the chosen engine is live; no welcome surface appears for a search. |
| 6 | Press Ctrl+T; in the welcome surface's home page block type `https://example.com`, **Set**. | The tab is now on `https://example.com/`. Ctrl+T opens `https://example.com/` — the welcome surface no longer appears for new tabs. |
| 7 | Read the settings row. | `[mixed-frame]` `homePage: "https://example.com"`, `searchEngine: "brave"` — each choice wrote exactly its own key. |

## Out of Scope

- Existing-profile clear/reset flows — `welcome-home-routing`, `welcome-search-handoff`.
- Upgrade neutrality — `search-engine-upgrade` (re-run by this flight).
- Corrupt-row repair to unset — unit-tested in `settings-store.test.js`.
