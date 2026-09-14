# Leg: restore-modal-extraction

**Status**: completed
**Flight**: [Chromium Family Breadth](../flight.md)

## Objective

Move the restore + export modal cluster out of `src/renderer/pages/vault.js`
into a new injected-deps `src/renderer/pages/vault-restore-controller.js`
(the `vault-browser-import-controller.js` precedent), with `pendingImportRecord`
becoming controller-owned state, so `vault.js` drops well under its line budget —
behavior-preserving, no restore-flow change.

## Context

- **Charter: DD4** (flight.md). Read it in full. This is the flight's risky leg:
  a behavior-preserving refactor of HAT-tuned (M18 F3) restore code, with a
  state-ownership handoff and source-scan-pin retargeting — NOT a blind cut.
- The `vault-browser-import-controller.js` from M19 F1 is the exact template:
  `createVaultBrowserImport(deps)`, injected DOM helpers + bridge + state
  getters, closure-owned `heldRecord` exposed via `heldRecord()`/`loadHeld()`,
  consumed at `vault.js:1696`. Mirror it.
- **All citations verified 2026-09-14** on `flight/02-chromium-family-breadth`
  off main d68fcf7.

## Leg-Level Design Rulings

1. **New module `src/renderer/pages/vault-restore-controller.js`**, plain ESM,
   `// @ts-check`, `createVaultRestoreController(deps)` returning
   `{ openExportModal, openImportPickModal, openMapping, heldRecord, loadHeld,
   handleLabelsReady, dropHeldOnPagehide }` (design review: `openMapping(record,
   vaults)` is the resume-banner entry against an already-held record;
   `handleLabelsReady(vaults)` is the DISTINCT first-arrival path — it fetches +
   validates via `bridge.fetchImportLabels()` (reusing `loadHeld`'s
   `rec && rec.labels` shape), stores the record, then opens the mapping modal
   with the caller's current vault list, since `lastViewVaults` stays module
   state in `vault.js`). `openCompletionModal`, `buildColorSwatchGrid`,
   `buildVaultSelect`, `appendOption`(if not already shared), and
   `NEW_JAR_FALLBACK_COLOR` are INTERNAL to the controller (not on the returned
   surface) — they are only called by the moved functions.
2. **Extraction set** (move verbatim, bodies unchanged):
   `openExportModal` (`vault.js:568`), `openImportPickModal` (`:715`),
   `buildColorSwatchGrid` (`:813`), `openMappingModal` (`:931`),
   `openCompletionModal` (`:1213`), plus `buildVaultSelect` (`:538` — shared by
   `openExportModal` + `openMappingModal`, both moving) and the modal-only
   `NEW_JAR_FALLBACK_COLOR` (`:792`). **`appendOption` (`:786`)**: it is a
   generic helper — grep its uses; if used ONLY by the extraction set, move it;
   if also used by code staying in `vault.js`, keep it in `vault.js` and inject
   it (do not duplicate). Same rule for any other helper the move reveals.
3. **Injected deps** (the identifiers the moved bodies reference that are
   defined outside them — verified by scanning the 538-1252 range): DOM helpers
   `el`, `button`, `iconButton`, `openModal`, `appendOption` (if kept in
   vault.js); the internal bridge `bridge`; a `refresh` callback; and —
   because `jarRows`/`jarVaultPresence` are MUTABLE module state in `vault.js`
   updated by `refresh()` — **getter deps** `getJarRows()`/`getJarVaultPresence()`
   (never a snapshot passed once; the modals read live state at open time,
   mirroring `vault-browser-import-controller.js`'s `getPresence`).
   - **`setNotice(text)` callback (design review HIGH — a SECOND state
     handoff).** `pendingNotice` (`vault.js:403`, module state) is WRITTEN inside
     `openExportModal` (`:642`, `:659`, `:664`) and read/cleared only in
     `render()` (`:2695-2700`, stays in vault.js). Once `openExportModal` moves
     into an ES module, a bare `pendingNotice = …` assignment throws a
     `ReferenceError` on every successful export. Inject `setNotice(text)`
     (vault.js implements it `(text) => { pendingNotice = text; }`, a plain
     callback — the `refresh` precedent, NOT folded into `refresh`); the three
     `openExportModal` sites call `setNotice(…)`.
   - **`GLOBAL_VAULT_ID` is a LOCAL literal, NOT an import (design review
     medium).** It is a hand-typed literal at `vault.js:175` (with a rationale
     comment) — `vault-page-model.js:159` documents WHY it deliberately does not
     export the `GLOBAL_ID` sentinel to page-side. The controller RE-DECLARES the
     literal locally (same value + rationale comment). Do NOT flat-import it and
     do NOT add a `GLOBAL_ID` export to `vault-page-model.js`.
   - **Flat-imported pure models the controller imports ITSELF** (routed, flat
     specifier + `// @ts-ignore`): `restoreDestinationOptions`,
     `restoreOutcomeLines` from `./vault-page-model.js`; `isSafeColor` from
     `./safe-color.js`; `PALETTE` from `./jar-page-model.js`. **`vault.js`'s own
     `PALETTE` import becomes dead once `openMappingModal` moves** (its only use
     is at `vault.js:1013`, inside the extraction range) — DROP it from
     `vault.js` (this is what AC13 of `vault-browser-import-invariants.test.js`
     pins — see ruling 4b).
   - `closeActivePageModal` is NOT injected — it appears only in a docblock in
     the moved range (`vault.js:389`), not called by any moved function
     (implementer confirms and omits it to avoid an unused-dep nit).
   - The implementer confirms the COMPLETE dep set by making the controller pass
     typecheck/lint with no undefined reference.
4. **`pendingImportRecord` becomes controller-owned closure state (DD4 high
   finding).** The six sites (`vault.js:415` decl, `:1172`/`:1194` inside
   `openMappingModal`, `:1281-1282` + `:1687-1690` "Resume restore…" banners,
   `:2747` `refresh()`, `:2786` `onVaultImportLabelsReady`, `:2800` `pagehide`):
   - the declaration + the two in-function writes MOVE into the controller;
   - the controller exposes `heldRecord()` (getter) and `loadHeld()` (the
     `bridge.fetchImportLabels()` fetch that `refresh()` did at `:2747`) and
     `dropHeldOnPagehide()` (the `:2800` drop);
   - `vault.js`'s five EXTERNAL sites are rewritten: the two banners call
     `restore.openMapping(restore.heldRecord(), …)` guarded on
     `restore.heldRecord()`; `refresh()` calls `restore.loadHeld()` inside its
     existing `Promise.all` (mirroring the browser-import `loadHeld` join);
     `onVaultImportLabelsReady` calls `restore.handleLabelsReady(lastViewVaults)`
     (the first-arrival fetch+validate+open, ruling 1); `pagehide` calls
     `restore.dropHeldOnPagehide()`. NO bare `pendingImportRecord` access
     remains in `vault.js`.
4b. **`test/unit/vault-browser-import-invariants.test.js` breaks on two
   assertions this leg must update (design review HIGH — a second invariants
   file the first draft missed).**
   - `AC13` (`:285-289`) scans `vault.js` for `import { PALETTE } from
     './jar-page-model.js'` AND the literal `PALETTE.includes(initialColor) ?
     PALETTE : [...PALETTE, initialColor]`. Both move to
     `vault-restore-controller.js` (the swatch-grid call is inside
     `buildColorSwatchGrid`/`openMappingModal`). RETARGET that assertion to scan
     the new controller source, and DROP the "PALETTE import in `vault.js`" half
     (the import is dead in vault.js post-move, ruling 3).
   - `AC10` (`:92-139`) is a CLOSED-SET fixture asserting the vault route's
     entry count (currently 11). Ruling 5's new `/vault-restore-controller.js`
     entry makes it 12 — add the entry to the fixture and bump the count.
5. **New internal-page route.** Add `'/vault-restore-controller.js':
   rendererPage('vault-restore-controller.js')` to `internal-page-map.js`'s
   `vault` route; import it in `vault.js` as a flat specifier with the
   `// @ts-ignore` convention (`vault.js:31-32` shape). Update
   `internal-page-map.test.js`'s exact-allowlist `deepEqual` for the vault route
   (add the one entry); `internal-page-route-closure.test.js` then passes
   because the controller's own imports (`vault-page-model.js`, `safe-color.js`,
   `jar-page-model.js`) are already routed.
6. **Retarget the source-scan invariants** in
   `test/unit/vault-restore-workflow-invariants.test.js`: the scans that read
   `openMappingModal` (`:133`), `buildColorSwatchGrid` (`:181`, `:296`), and
   `openExportModal` (`:321`, `:344`) BY NAME in `vault.js` must read the new
   `vault-restore-controller.js` source instead (add a `VAULT_RESTORE_JS` read
   var; retarget those five `VAULT_JS.indexOf(...)` sites). The `render(state)`
   scans (`:109`, `:374`) and the `openModal` scan (`:405`) STAY on `vault.js`
   (neither is extracted). This is a mechanical retarget, not a rewrite of what
   each test asserts.
7. **Lower `VAULT_PAGE_LINE_BUDGET`** (`seam-contract.test.js:193`) to the
   post-extraction `vault.js` line count + a small buffer (~30-50 lines), to
   lock in the headroom (DD4 / Architect low-finding). The new
   `vault-restore-controller.js` gets NO budget (sibling
   `vault-browser-import-controller.js` precedent — it has none).

## Inputs

- `src/renderer/pages/vault.js` (2820 lines): the extraction set + helpers at the
  cited lines; `pendingImportRecord` at the six sites; the flat-import block
  `:1-32` (the `// @ts-ignore` convention); `refresh()` `:2737`; the
  labels-ready/pagehide handlers `:2783-2803`; `buildImportExportSection`
  `:1676` (the resume banner at `:1687-1690`) and the other banner `:1281-1282`.
- `src/renderer/pages/vault-browser-import-controller.js` — the template
  (`createVaultBrowserImport`, `heldRecord`/`loadHeld`, deps bag, pagehide drop).
- `src/main/internal-page-map.js` — the vault route (`/vault-browser-import-controller.js`
  is the adjacent precedent entry).
- `test/unit/vault-restore-workflow-invariants.test.js` — the 5 scans to
  retarget + the 3 that stay.
- `test/unit/vault-browser-import-invariants.test.js` — AC13 (`:285-289`, the
  PALETTE import + swatch literal, retarget to the controller) and AC10
  (`:92-139`, the closed-set vault-route count, +1).
- `test/unit/internal-page-map.test.js` — the exact-allowlist vault-route
  `deepEqual`.
- `test/unit/seam-contract.test.js:193` — `VAULT_PAGE_LINE_BUDGET`.
- Green bar at leg start: 4433 tests, typecheck, lint, format clean.

## Outputs

- New: `src/renderer/pages/vault-restore-controller.js`.
- Modified: `src/renderer/pages/vault.js` (functions removed, controller
  constructed + wired, five `pendingImportRecord` sites rewired, `setNotice`
  callback + `pendingNotice` handoff, dead `PALETTE` import dropped, flat import +
  route consumer); `src/main/internal-page-map.js` (route entry);
  `test/unit/internal-page-map.test.js` (allowlist); `test/unit/vault-restore-workflow-invariants.test.js`
  (5 scans retargeted); `test/unit/vault-browser-import-invariants.test.js`
  (AC13 PALETTE-scan retargeted, AC10 route-count fixture +1);
  `test/unit/seam-contract.test.js` (budget lowered).
- `flight-log.md` leg entry; flight.md leg checkbox (at flight commit).

## Acceptance Criteria

- [x] AC1 `vault-restore-controller.js` exists, `// @ts-check`,
      `createVaultRestoreController(deps)`, exposing exactly the surface
      `vault.js` calls (`openExportModal`, `openImportPickModal`, an
      open-mapping entry, `heldRecord`, `loadHeld`, the labels-ready open, the
      pagehide drop); the five moved modals + `buildVaultSelect` +
      `buildColorSwatchGrid` + `NEW_JAR_FALLBACK_COLOR` live there, bodies
      unchanged (a diff shows a move, not a rewrite).
- [x] AC2 `pendingImportRecord` no longer appears in `vault.js` as a bare
      variable (grep: zero hits outside a comment); the controller owns it;
      `vault.js`'s five former external sites call the controller's
      accessor/loader. `refresh()`'s held-record load joins its `Promise.all`.
      `pendingNotice` writes in the moved `openExportModal` go through the
      injected `setNotice` (no bare `pendingNotice =` in the controller);
      `pendingNotice` stays declared + read in `vault.js`.
- [x] AC3 `internal-page-map.js`'s vault route has the new
      `/vault-restore-controller.js` entry; `internal-page-map.test.js`'s
      exact-allowlist test is updated and green;
      `internal-page-route-closure.test.js` is green.
- [x] AC4 `vault-restore-workflow-invariants.test.js`'s five restore/export/
      swatch scans read `vault-restore-controller.js`; the render/openModal
      scans still read `vault.js`; the whole suite is green. AND
      `vault-browser-import-invariants.test.js` green: AC13's PALETTE/swatch
      scan retargeted to the controller (no PALETTE import left in `vault.js`),
      AC10's route-count fixture bumped to include `/vault-restore-controller.js`.
- [x] AC5 `VAULT_PAGE_LINE_BUDGET` lowered to the new `vault.js` count + a small
      buffer; `seam-contract.test.js` green; the new controller has no budget.
- [x] AC6 Behavior preserved: full green bar — `npm test`, `npm run typecheck`,
      `npm run lint`, `npm run format` then `format:check` — all clean; EVERY
      pre-existing restore/vault suite green with no assertion weakened. No
      user-facing string, DOM id/class, or restore semantic changed (this leg
      is a move; the Chromium copy generalization is leg 2).
- [x] AC7 `flight-log.md` carries the leg entry (what moved, the dep set, the
      pendingImportRecord handoff, the new budget number); leg `landed`.

## Verification Steps

- AC1/AC2: `git diff` review (move not rewrite; no bare `pendingImportRecord`
  in `vault.js` — `grep -n pendingImportRecord src/renderer/pages/vault.js`).
- AC3: `node --test test/unit/internal-page-map.test.js test/unit/internal-page-route-closure.test.js`.
- AC4: `node --test test/unit/vault-restore-workflow-invariants.test.js`.
- AC5: `node --test test/unit/seam-contract.test.js`; `node -e "console.log(require('fs').readFileSync('src/renderer/pages/vault.js','utf8').split(/\r?\n/).length)"`.
- AC6: the four green-bar commands.
- Belt-and-suspenders (CP1): a one-time manual app open — pick → mapping →
  completion + export modals render and behave (no DOM harness for this page).

## Edge Cases

- **`jarRows`/`jarVaultPresence` liveness**: they mutate in `refresh()`; the
  controller MUST read them via getters at modal-open time, never a stale
  snapshot passed at construction — else the mapping modal's destination list
  goes stale after a jar change.
- **`refresh()` ordering**: the held-record load must join the existing
  `Promise.all` so the first post-broadcast render reflects the resume state (no
  one-render-late flicker — the browser-import `loadHeld` precedent).
- **`appendOption` / shared helpers**: if any moved helper is also used by
  code staying in `vault.js`, keep it in `vault.js` and inject it; never
  duplicate (a second definition drifts).
- **The forced-close vs cancel distinction** (`render()`'s unconditional
  `closeActivePageModal()` vs the mapping modal's `onCancel` drop): preserve it
  exactly — `render()` stays in vault.js and must still force-close the (now
  controller-rendered) modal via the shared `closeActivePageModal`/`activePageModal`
  path. Confirm the single-active-page-modal ref stays owned where `openModal`
  lives (vault.js), so a controller-opened modal is still closed by vault.js's
  `render()`.

## Files Affected

- `src/renderer/pages/vault-restore-controller.js` — new.
- `src/renderer/pages/vault.js` — extraction + wiring + pendingImportRecord rewire.
- `src/main/internal-page-map.js` — route entry.
- `test/unit/internal-page-map.test.js`, `test/unit/vault-restore-workflow-invariants.test.js`,
  `test/unit/seam-contract.test.js` — allowlist, scan retarget, budget.
- `flight-log.md`.

## Citation Audit

All `vault.js` line citations (functions 538/568/715/786/792/813/931/1213;
pendingImportRecord 415/1172/1194/1281-1282/1687-1690/2747/2786/2800; refresh
2739; import block 1-32) and the invariant scan lines (133/181/296/321/344 to
retarget; 109/374/405 stay) verified 2026-09-14 on this branch. The budget
constant is `seam-contract.test.js:193`. The `openModal`/`activePageModal`
single-modal ownership stays in vault.js (`:418` region) — confirmed the moved
modals call the injected `openModal`, so `render()`'s force-close still applies.

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `completed` (in this file's header)
- [x] Check off this leg in flight.md
- [ ] If final leg of flight: update flight.md status to `landed`, check off flight in mission.md
- [ ] Commit all changes together (code + artifacts)
