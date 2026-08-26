# Behavior Test: Welcome First Launch

**Slug**: `welcome-first-launch`
**Status**: active
**Created**: 2026-08-24
**Last Run**: 2026-08-26 — pass (7/7; gate run for the M16 F3 leg-2 HAT behavior changes on the final build; run log `welcome-first-launch/runs/2026-08-26-02-10-54.md`)

## Intent

Verifies the fresh-profile outcome end to end: a brand-new profile boots with neither preference set (explicitly `null` on disk), its single tab is a welcome tab offering both choices, the address bar and bookmarks bar are usable from it, Goldfinch commits no provider URL before a choice, and each choice removes exactly its own block — setting the engine leaves new tabs on the welcome surface until the home page is set, and setting the home page leaves searches on the welcome surface until an engine is set. Pins mission criteria 3 (independence), 5, 6 (both-together case), and 10 (repair-to-unset is unit-tested; this pins the fresh default) (M16 F2).

**Note (M16 F3 leg 2, HAT):** step 4's expected result changed at the HAT — an operator decision that choosing a search engine should not hide the engine block; it now stays, showing the selection and a confirmation line, instead of disappearing.

## Preconditions

- Goldfinch dev build launched against a **fresh, empty** `XDG_CONFIG_HOME` scratch profile with the automation surface and admin key — the first launch IS the test, with one fixture exception below for row 3's bookmarks-bar check.
- **Bookmark fixture (row 3):** an empty bookmarks bar has no visual signature on the dark chrome, so row 3 needs one bookmark present to check the bar by content instead. Launch the dev build once against the fresh profile to initialize `app.db`, then quit. With the app down, insert one row into the `bookmarks` table for the fresh-seed default jar (`personal` — `src/main/jars.js`'s `FRESH_SEED`): `sqlite3 <userData>/app.db "INSERT INTO bookmarks (id, jar_id, url, title, icon, position, added_at) VALUES ('fixture-bm','personal','https://example.com/','Fixture Bookmark',NULL,0,0)"`. Relaunch — this second launch is the one the run's steps observe, and is otherwise identical to a genuine first launch (no settings/jars fixture, no tab fixture).
- MCP client attached with the run's minted key; the session-registered goldfinch MCP tools are never used.
- Network access is NOT required.

## Observables Required

- browser (rendered chrome state — tab strip, address bar, welcome panel, bookmarks bar, Settings)
- filesystem (settings row at first load — the pin-on-load write)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Observe the freshly launched window. | Exactly one tab, titled "Welcome to Goldfinch", showing the welcome surface with **both** the home page block and the search engine block; the address bar is empty with its placeholder and is writable; no tab has committed any URL. [a11y] |
| 2 | Read the profile's settings row. | The row exists with `version: 3`, `homePage: null`, and `searchEngine: null` — both keys present and explicitly unset (pinned at first load, not merely absent). |
| 3 | Open Settings; enable "Show bookmarks bar"; return to the welcome tab. | The bookmarks bar is visible on the welcome tab, showing the pre-seeded fixture bookmark (`button.bm-item` inside `#bookmarks-bar`) — the bar is not suppressed on this surface. Settings shows an empty home page field and no engine selected, each with its hint. |
| 4 | In the welcome tab's search engine block choose Brave Search. | The engine block stays, showing Brave Search selected, with a saved confirmation beneath it; the home page block remains; the tab stays a welcome tab. |
| 5 | Press Ctrl+T. | Opens another welcome tab with only the home page block. |
| 6 | In that new welcome tab type `zephyr quartz fresh` in the address bar, Enter. | The tab navigates to a `search.brave.com` search URL containing the query — the chosen engine is live; no welcome surface appears for a search. |
| 7 | Press Ctrl+T; in the welcome surface's home page block type `https://example.com`, **Set**. *(changed at M16 F3 leg 2, HAT item 6 — DD7 pivot)* | The tab stays a welcome tab: the home page field shows `https://example.com` with a saved confirmation (this tab was opened for the home page only — the engine was already set — so no engine card is shown). |
| 8 | Press Ctrl+T. | Opens `https://example.com/` — the welcome surface no longer appears for new tabs. |
| 9 | Read the settings row. | `homePage: "https://example.com"`, `searchEngine: "brave"` — each choice wrote exactly its own key. |

## Out of Scope

- Existing-profile clear/reset flows — `welcome-home-routing`, `welcome-search-handoff`.
- Upgrade neutrality — `search-engine-upgrade` (re-run by this flight).
- Corrupt-row repair to unset — unit-tested in `settings-store.test.js`.
