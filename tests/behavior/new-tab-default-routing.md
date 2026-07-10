# Behavior Test: New-Tab Default Routing

**Slug**: `new-tab-default-routing`
**Status**: active
**Created**: 2026-07-09
**Last Run**: 2026-07-10-04-43-55

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

## Observables Required

- app tab/jar state (tab list with per-tab `jarId` — measured via the goldfinch MCP
  `enumerateTabs` tool)
- chrome-renderer jar registry state and mutation results (measured via the goldfinch
  MCP chrome-target evaluation apparatus — `getChromeTarget` + evaluate — calling the
  `window.goldfinch.jars*` preload wrappers)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Enumerate tabs. | Exactly one boot tab exists and its `jarId` is `personal` (the fresh-seed default), not `default` and not a `burner-*` id. |
| 2 | Open a tab via the automation `openTab` tool with the `jarId` field **omitted**. | The new tab's `jarId` is `personal`. |
| 3 | Via the chrome apparatus, call `window.goldfinch.jarsSetDefault({ id: 'work' })`. | Resolves `true`. |
| 4 | Open a tab via `openTab` with `jarId` omitted. | The new tab's `jarId` is `work` — the moved flag governs routing with no restart. |
| 5 | Via the chrome apparatus, call `jarsRemove({ id: 'work' })` then `jarsRemove({ id: 'personal' })`. | Both resolve `{ ok: true, ... }`; the registry is empty (chrome apparatus: `jarsList()` resolves `[]`, `jarsGetDefault()` resolves the Burner identity, id `burner`). |
| 6 | Open a tab via `openTab` with `jarId` omitted. | The new tab's `jarId` matches `burner-<n>` — Burner-as-default yields a fresh evaporating burner tab (NOT id `burner` itself, and not any persistent jar). |
| 7 | Via the chrome apparatus, call `jarsAdd({ name: 'Fresh' })`. Then open a tab via `openTab` with `jarId` omitted. | `jarsAdd` resolves a container with id `fresh`; the newly opened tab's `jarId` is `fresh` — the first persistent jar added into an empty registry auto-claimed the default flag. |

## Out of Scope

- Tab-strip dot rendering and visual propagation (operator-judged in the F2 HAT leg).
- Deleting a jar closes its open tabs (management-page behavior, Flight 3/5).
- Explicitly flagging Burner as default while persistent jars exist (not a product
  behavior — the flag reaches Burner only via last-jar deletion).
- Rename/recolor propagation (Flight 3's page owns the user-drivable flow).

## Variants

None.
