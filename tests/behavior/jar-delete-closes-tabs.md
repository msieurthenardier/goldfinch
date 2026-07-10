# Behavior Test: Jar Delete Closes Its Tabs

**Slug**: `jar-delete-closes-tabs`
**Status**: active
**Created**: 2026-07-10
**Last Run**: 2026-07-10-22-24-45

## Intent

Verifies that deleting a jar closes every open tab in that jar (mission criterion 4's
tab-closure clause — the documented Flight 2 DD2 gap this behavior replaces), that
tabs in other jars survive untouched, and that deleting the last persistent jar while
its tabs are open lands the browser in a sane zero-orphan state (closed tabs + the
last-tab fallback, with Burner as default). This is real-environment behavior spanning
the jar store, the delete composition, the `jars-changed` broadcast, and the chrome
renderer's tab lifecycle — the renderer half has no unit-test seam, so the paradigm
fits. Complements `new-tab-default-routing` (which pins routing; this pins closure).

## Preconditions

- Goldfinch dev build launched against a **fresh scratch profile** (`XDG_CONFIG_HOME`
  pointed at an empty directory) with the automation surface enabled and keys minted:
  `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 npm run dev:automation`
  (admin key required — the test opens and enumerates tabs across multiple jars).
- MCP client attached to the goldfinch automation server (the bound port may be a
  free-port fallback, not the configured 49707 — discover the live port).
- Fresh-profile seed is Personal (default) + Work. No other jars.

## Observables Required

- app tab/jar state (tab list with per-tab `jarId` and `wcId` — measured via the
  goldfinch MCP `enumerateTabs` tool)
- chrome-renderer jar registry state and mutation results (measured via
  `getChromeTarget` + `evaluate` calling the `window.goldfinch.jars*` preload
  wrappers)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Open two tabs via `openTab` with `jarId: "work"`, and one tab via `openTab` with `jarId: "personal"`. Enumerate tabs. | Enumeration shows the boot tab plus three new tabs: exactly two with `jarId` `work`, and at least two with `jarId` `personal` (boot tab + explicit open). Record every `wcId` per jar. |
| 2 | Via the chrome apparatus, call `window.goldfinch.jarsRemove({ id: 'work' })`. Then enumerate tabs. | The remove resolves `{ ok: true, ... }`. Both previously-recorded `work` wcIds are GONE from the enumeration; no remaining tab reports `jarId` `work`. Every `personal` wcId recorded in step 1 is still present, unchanged. |
| 3 | Via the chrome apparatus, call `jarsList()` and `jarsGetDefault()`. | `jarsList()` resolves to only the personal jar; `jarsGetDefault()` resolves the personal container (flag repaired or retained on `personal`). |
| 4 | Call `jarsRemove({ id: 'personal' })` — the LAST persistent jar, while its tabs are open. Then enumerate tabs. | The remove resolves `{ ok: true, ... }`. Every previously-recorded `personal` wcId is gone; no tab reports `jarId` `personal`. The window is NOT tabless: at least one tab exists, and every remaining tab's `jarId` matches `burner-<n>` (the last-tab fallback opened a fresh evaporating burner tab). |
| 5 | Via the chrome apparatus, call `jarsList()` and `jarsGetDefault()`. | `jarsList()` resolves `[]`; `jarsGetDefault()` resolves the Burner identity (id `burner`) — registry empty, Burner is default. |

## Out of Scope

- The management page's delete-confirmation UI (operator-judged at the flight's HAT —
  internal-page DOM is not automation-observable by design).
- Data-wipe verification (`wiped: true` semantics were pinned in
  `new-tab-default-routing`'s first run; per-jar data controls are Flight 4).
- Routing of NEW tabs after deletion (owned by `new-tab-default-routing`).
- Automation-key degradation when a key's jar is deleted (Flight 5 candidate per the
  mission's open questions).

## Variants

None.
