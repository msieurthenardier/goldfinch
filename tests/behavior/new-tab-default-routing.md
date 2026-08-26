# Behavior Test: New-Tab Default Routing

**Slug**: `new-tab-default-routing`
**Status**: active
**Created**: 2026-07-09
**Last Run**: 2026-08-26 — pass (8/8; gate run at M16 F3 leg 2 with the DD7-pivot fixture; run log `new-tab-default-routing/runs/2026-08-26-03-01-14.md`)

## Intent

Verifies that partition-less new tabs are routed through the live default-jar flag —
including after the flag moves, after the last persistent jar is deleted (Burner
fallback: new tabs are fresh evaporating burner tabs), and after a persistent jar is
recreated (auto-claims the flag). This is real-environment behavior spanning the jar
store, IPC broadcast, and the chrome renderer's routing decision — the renderer half is
DOM-and-state-driven and has no unit-test seam, so the paradigm fits. Pins the routing
half of mission criterion 5 and the fallback half of criterion 6 (M06).

## Preconditions

- Goldfinch dev build launched against a **fresh scratch profile** (`XDG_CONFIG_HOME`
  pointed at an empty directory) with the automation surface enabled and keys minted:
  `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 npm run dev:automation`
  (admin key required — the test opens tabs across multiple jars).
- MCP client attached to the goldfinch automation server (note: the bound port may be a
  free-port fallback, not the configured 49707 — discover the live port, don't assume).
- Fresh-profile seed is Personal (default) + Work (M06 F1). No other jars.
- **Fixture-setup (M16 F2 leg 2 gate; re-authored M16 F3 leg 2, HAT item 6, DD7 pivot):** set the home page to `https://example.com` and the search engine to Google via Settings, then return to the boot welcome tab and navigate it by typing `https://example.com` in the **address bar** and pressing Enter (manual navigation still attaches the tab — the welcome surface itself no longer auto-attaches once both preferences are set, so this replaces the old "return to the boot tab, it attaches on its own" step), then close the Settings tab, so exactly one web boot tab exists — a fresh profile boots to a viewless welcome tab carrying BOTH the `home` and `search` reasons (`welcomeReasons(null, null)`), which `enumerateTabs` cannot see (no `jarId` to read) until it attaches; setting only the home page leaves `search` unset and the tab correctly stays a welcome tab (DD7), so both preferences must be set before step 1 for the "exactly one boot tab" premise to hold.

## Observables Required

- app tab/jar state (tab list with per-tab `jarId` — measured via the goldfinch MCP
  `enumerateTabs` tool)
- chrome-renderer jar registry state and mutation results (measured via the goldfinch
  MCP chrome-target evaluation apparatus — `getChromeTarget` + evaluate — calling the
  `window.goldfinch.jars*` preload wrappers)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Enumerate tabs. Via the chrome apparatus, call `jarsGetDefault()` and `jarsList()`. | Exactly one boot tab exists and its `jarId` is `personal` (the fresh-seed default), not `default` and not a `burner-*` id. `jarsGetDefault()` resolves the personal container; `jarsList()` resolves personal + work (the fresh seed) — the live flag agrees with tab assignment. |
| 2 | Open a tab via the automation `openTab` tool with the `jarId` field **omitted**. | The new tab's `jarId` is `personal`. |
| 3 | Via the chrome apparatus, call `window.goldfinch.jarsSetDefault({ id: 'work' })`. | Resolves `true`. |
| 4 | Open a tab via `openTab` with `jarId` omitted. | The new tab's `jarId` is `work` — the moved flag governs routing with no restart. |
| 5 | Via the chrome apparatus, call `jarsRemove({ id: 'work' })` then `jarsRemove({ id: 'personal' })`. Then call `jarsList()` and `jarsGetDefault()`. | Both removes resolve `{ ok: true, ... }`; `jarsList()` resolves `[]`; `jarsGetDefault()` resolves the Burner identity, id `burner` — the registry is empty and the live flag has fallen through to Burner. |
| 6 | Open a tab via `openTab` with `jarId` omitted. | The new tab's `jarId` matches `burner-<n>` — Burner-as-default yields a fresh evaporating burner tab (NOT id `burner` itself, and not any persistent jar). |
| 7 | Via the chrome apparatus, call `jarsAdd({ name: 'Fresh' })`. Then open a tab via `openTab` with `jarId` omitted. Then call `jarsGetDefault()`. | `jarsAdd` resolves a container with id `fresh`; the newly opened tab's `jarId` is `fresh`; `jarsGetDefault()` resolves the `fresh` container — the first persistent jar added into an empty registry auto-claimed the default flag. |
| 8 | Via the chrome apparatus, call `jarsAdd({ name: 'Second' })` into the now-non-empty registry (from step 7). Then call `jarsGetDefault()`. | `jarsAdd` resolves a container with id `second`; `jarsGetDefault()` still resolves the `fresh` container, NOT `second` — adding a jar into an already-non-empty registry does not move the default flag, distinguishing genuine auto-claim-on-empty-registry (step 7) from an always-default-new-jars bug. |

## Out of Scope

- Tab-strip dot rendering and visual propagation (operator-judged in the F2 HAT leg).
- Deleting a jar closes its open tabs (management-page behavior, Flight 3/5).
- Explicitly flagging Burner as default while persistent jars exist (not a product
  behavior — the flag reaches Burner only via last-jar deletion).
- Rename/recolor propagation (Flight 3's page owns the user-drivable flow).

## Variants

None.
