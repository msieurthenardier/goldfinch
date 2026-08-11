# Behavior Test: Search Engine Upgrade Neutrality

**Slug**: `search-engine-upgrade`
**Status**: draft
**Created**: 2026-08-11
**Last Run**: never

## Intent

Verifies that upgrading an existing profile to the search-engine-preference build changes nothing the user can observe: searches still reach Google, a customized home page stays exactly as it was, and the previously implicit Google default is now visible in Settings as an explicit, changeable selection. Runs against an **authentic** pre-upgrade profile (produced by the pre-flight build, not hand-crafted bytes), because the migration's input is real serializer output and the fixture must be too. Pins mission criterion 4 (M16 F1).

## Preconditions

- **Fixture (decay-prone — produce fresh, do not reuse a stale directory):** a scratch profile written by the pre-flight build. Procedure: check out the commit before Flight 1 landed, launch against an empty `XDG_CONFIG_HOME` scratch dir, set the home page to `https://fixture.example.net` in Settings (this both customizes the key under test and forces a settings row write), quit. Verify the fixture before the run: the profile's settings document row exists and carries `version: 2` with the custom home page.
- Goldfinch **Flight 1 build** launched against that same scratch profile with the automation surface enabled: `GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`.
- MCP client attached (discover the live port, don't assume).
- Network access is NOT required: search assertions read the committed address-bar URL.

## Observables Required

- browser (rendered chrome state — Settings page controls, address bar contents; screenshots + a11y snapshots via the goldfinch MCP)
- filesystem (the profile's settings document row, read once post-launch to confirm the migration stamped and pinned — see step 4)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | With the upgraded build running on the pre-upgrade profile, open `goldfinch://settings` and view the Startup & appearance section. | The home page field shows `https://fixture.example.net` — untouched by the upgrade. A search engine control is visible with Google selected explicitly. [a11y] |
| 2 | Open a new tab. | The tab opens on `https://fixture.example.net` — new-tab behavior unchanged. |
| 3 | Focus the address bar, type `zephyr quartz upgrade`, commit with Enter. | The address bar shows a `google.com` search URL containing the encoded query — searches still reach Google without the user having chosen anything. |
| 4 | Read the profile's settings document row from the scratch profile directory. | `[mixed-frame]` The row carries `version: 3` with both `searchEngine` and `homePage` present as explicit values (`"google"`, `"https://fixture.example.net"`). Justification: the pinning contract is invisible by design — its entire purpose is that the user observes nothing — so only the stored row distinguishes "migrated and pinned" from "not migrated at all", and Flight 2's default flip depends on this distinction. |
| 5 | In Settings, select DuckDuckGo, then commit an address-bar search for `zephyr quartz changed`. | The address bar shows a `duckduckgo.com` search URL — the formerly implicit default is a real, changeable selection on this profile. |

## Out of Scope

- Fresh-profile behavior, multi-window propagation, restart survival, context-menu entry point — `search-engine-preference`.
- Corrupt-row and unknown-id repair — unit-tested in `settings-store.test.js`.
- The v1→v2 `restoreSession` migration step — pre-existing, covered by its own unit tests; this fixture starts at v2.
