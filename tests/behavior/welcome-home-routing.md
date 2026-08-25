# Behavior Test: Welcome Home Routing

**Slug**: `welcome-home-routing`
**Status**: draft
**Created**: 2026-08-24
**Last Run**: never

## Intent

Verifies, on an existing profile, that clearing the home page turns every new-tab path into a welcome tab in the right jar, that the welcome tab is not a trap (typing an address or clicking a bookmark navigates that same tab, in place), that setting the home page from the welcome surface or from Settings restores normal new tabs everywhere — including a window that did not make the change and the boot window after a relaunch (squawk 0005 fixed) — and that welcome tabs are not restored across a relaunch. Live multi-window propagation, the same-tab guarantee, and restart behavior have no unit-test seam. Pins mission criteria 3 (clearable half), 6 (home-page case), 8, and the restore half of 9 (M16 F2).

## Preconditions

- Goldfinch dev build launched against a **fresh scratch profile** (`XDG_CONFIG_HOME` → empty dir) with `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 npm run dev:automation`; then, **as fixture setup before step 1**, the home page set to `https://example.com` and the search engine set to DuckDuckGo via Settings (reached through the `kebabActionSettings` chrome seam), and a bookmark to `https://example.org` created — so the profile is an "existing" one with both preferences set.
- MCP client attached with the run's minted admin key (discover the live port). **Never** use the session-registered goldfinch MCP tools (they point at a different browser).
- Network access is NOT required: every navigation assertion reads the committed address-bar URL.
- Step 10 is out-of-band (Orchestrator quit/relaunch, key re-mint, reconnect — the `session-restore` procedure).

## Observables Required

- browser (rendered chrome state: tab strip titles, address bar value/placeholder/writability, the welcome panel, Settings controls; `captureWindow` + chrome `readAxTree`; guest `captureScreenshot`/`readAxTree` for Settings)
- filesystem (the profile's settings row, once, to confirm `homePage: null` was persisted)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Open Settings; click the home page **Clear** button. | The home page field is empty and a status line explains that new tabs will open the welcome page. The search engine control still shows DuckDuckGo. [a11y] |
| 2 | Read the profile's settings row. | `[mixed-frame]` `homePage` is present and `null`; `searchEngine` is `"duckduckgo"`. |
| 3 | Press Ctrl+T. | A new tab opens titled "Welcome to Goldfinch" showing the welcome surface with the **home page** block only (no search-engine block); the address bar is empty, shows its placeholder, and is writable; the tab strip shows one more tab than before. |
| 4 | Open a second window (Ctrl+N). | The second window's initial tab is a welcome tab (home block only) — the cleared preference reached a window that did not make the change. |
| 5 | In window 1, open a burner tab — via the chrome seam `openNewTab(makeBurner())` (`evaluate` on the chrome wcId; the container menu itself is a sheet outside the automation surface, so this is the same code path the menu item runs). | The burner tab is a welcome tab carrying the burner note ("saved for all of Goldfinch") in the burner jar. |
| 6 | On window 1's first welcome tab, type `example.net` in the address bar and press Enter. | That **same** tab navigates to `https://example.net/` — the tab count is unchanged and the tab keeps its strip position; the welcome surface is gone from it. |
| 7 | Press Ctrl+T, then click the `example.org` bookmark on the bookmarks bar. | The new welcome tab itself navigates to `https://example.org/` (same tab, count unchanged) — bookmarks were reachable from the welcome surface. |
| 8 | Press Ctrl+T; in the welcome surface's home page block type `https://example.com` and click **Set**. | The welcome surface leaves the tab: the tab is now on `https://example.com/`. Settings (open it) shows `https://example.com` in the home page field; the search engine is still DuckDuckGo. |
| 9 | In window 2, press Ctrl+T. | The new tab opens on `https://example.com/` — the set preference reached the other window without a restart. |
| 10 | Quit Goldfinch fully and relaunch against the same profile. Then press Ctrl+T in the restored window. | No welcome tab was restored (the restored tabs are only the web tabs from step 6–9). The new tab opens on `https://example.com/` — the boot window honors the home page on its first new tab. |

## Out of Scope

- Search-engine handoff and pending queries — `welcome-search-handoff`.
- First-launch both-unset — `welcome-first-launch`.
- Default-jar and burner jar resolution rules — `new-tab-default-routing` (re-run by this flight).
- Visual branding — Flight 3.
