# Behavior Test: Search Engine Preference

**Slug**: `search-engine-preference`
**Status**: active
**Created**: 2026-08-11
**Last Run**: 2026-08-24 — partial (7/8 pass; checkpoint 6 inconclusive: page context-menu sheet not automatable via the MCP apparatus — see the run log)

## Intent

Verifies that the search engine is a real, user-owned preference on a fresh profile: the Google default is explicit and visible in Settings, choosing another engine takes effect immediately in both search entry points (address bar and page context menu) and in every open window without a restart, the choice survives quit-and-relaunch, and the home page preference is untouched by all of it. This is real-environment behavior spanning the settings store, IPC broadcast, and per-window chrome caches — the live multi-window propagation and restart survival have no unit-test seam. Pins mission criteria 1, 2, and the settable/independence half of 3 (M16 F1).

## Preconditions

- Goldfinch dev build launched against a **fresh scratch profile** (`XDG_CONFIG_HOME` pointed at an empty directory) with the automation surface enabled and an admin key minted: `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 npm run dev:automation` (admin key required — the test drives two windows).
- MCP client attached to the goldfinch automation server (the bound port may be a free-port fallback, not the configured one — discover the live port, don't assume).
- Network access is NOT required: every search assertion reads the committed address-bar URL, not the result page.
- **Step 8 is out-of-band**: the quit/relaunch crosses the MCP transport's lifetime, and `GOLDFINCH_AUTOMATION_DEV_MINT` mints a fresh admin key on every boot — the Orchestrator performs the relaunch, rediscovers the live port, reconnects, and re-reads the newly minted key before the step's observations run (the `session-restore` procedure). That pattern is authored-but-unrun there; treat this spec's first execution of step 8 with the same caution.
- **Operator present** — apparatus constraint: the page-context menu renders in a chrome-owned overlay sheet outside `AUTOMATABLE_MENU_TYPES` (`src/main/automation/resolve.js:53`), refused by the automation surface at every tier and not composited by `captureWindow`, with no OS-level input tool available on the dev machine; step 6 is operator-performed.

## Observables Required

- browser (rendered chrome state — Settings page controls, address bar contents, context menus; screenshots + a11y snapshots via the goldfinch MCP)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Open `goldfinch://settings` and view the Startup & appearance section. | A search engine control is visible adjacent to the home page control, with Google selected explicitly. Each engine option carries a one-line description. [a11y] |
| 2 | Focus the address bar, type `zephyr quartz alpha`, commit with Enter. | The tab navigates to a Google search URL; the address bar shows a `google.com` search URL containing the encoded query. |
| 3 | Return to Settings and select DuckDuckGo as the search engine. | The control shows DuckDuckGo selected. The home page field's value is unchanged. |
| 4 | In the same window, open a new tab, type `zephyr quartz beta` in the address bar, commit. | The address bar shows a `duckduckgo.com` search URL containing the encoded query — no restart occurred. |
| 5 | Open a second window (Ctrl+N). In it, type `zephyr quartz gamma` in the address bar, commit. | The second window's address bar shows a `duckduckgo.com` search URL containing the encoded query — the choice reached a window that was not the one that set it. |
| 6 | **Operator-performed** (apparatus constraint: the page-context menu renders in a chrome-owned overlay sheet outside `AUTOMATABLE_MENU_TYPES`, refused by the automation surface at every tier and not composited by `captureWindow`; no OS-level input tool exists on the dev machine). The operator navigates any tab to a page with selectable text, selects a short phrase, right-clicks it, and chooses the "Search for …" item; the Executor captures the resulting tab as evidence. | A tab opens on a `duckduckgo.com` search URL containing the selected phrase — the context-menu entry point uses the same chosen engine (operator-observed). Structural coverage: the context menu's `sel:search` dispatch calls the same `toUrl` helper that the address-bar rows (2, 4, 5) verify directly via the apparatus. |
| 7 | In Settings, set the home page to `https://example.com` and save. | The home page field shows the new value; the search engine control still shows DuckDuckGo — setting one never changes the other. |
| 8 | Quit Goldfinch fully and relaunch against the same profile. Open Settings; then commit an address-bar search for `zephyr quartz delta`. | Settings shows DuckDuckGo selected and `https://example.com` as home page; the search commits to a `duckduckgo.com` URL — both preferences survived restart independently. |

## Out of Scope

- Upgrade behavior of pre-existing profiles — covered by `search-engine-upgrade`.
- Unset/welcome-page routing, clearing either preference — Flight 2 (M16) scope; no spec yet.
- Rejection of non-curated stored values and corrupt-row repair — unit-tested in `settings-store.test.js` (structured-output contract; no real-environment observable).
- Omnibox suggestion behavior — `omnibox-suggestions`.
- New-tab routing through jars/burners — `new-tab-default-routing`.
