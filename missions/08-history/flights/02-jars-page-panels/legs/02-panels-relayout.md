# Leg: panels-relayout

**Status**: completed
**Flight**: [Manage-Jars Page Panels](../flight.md)

## Objective

Rework each persistent-jar section on `goldfinch://jars` into three
collapsible panels (History / Cookies / Other site data) with per-region
confirm areas and a generalized footer confirm (wipe + delete), a live
history count in the History panel's disclosure button, `history-changed`
subscription wiring, hash deep-link expansion, and panel CSS — preserving
every existing page contract (focus-preserving reconcile, `ui`
exclusivity, `action:rowId` keys, scroll-spy, Burner read-only).

## Context

- Flight DD3 (as amended by the Architect review) is the authoritative
  contract for this leg — read it in full before coding. Key pins:
  per-region confirm areas gated by the one global `ui`; footer
  generalizes wipe + delete into one string-keyed slot (boolean
  `deleteConfirmOpen` retires); collapse toggle flips `.hidden` +
  `aria-expanded` only, EXCEPT it first calls `closeTransient()` when
  collapsing the panel that owns the open confirm; builder reshape is
  authorized (not the DD2 controller split).
- Flight DD4 (default collapsed, in-page state, independent toggles, hash
  deep-link after first `applyState`), DD6 (count in the disclosure
  button label, uniform initial fetch at section build, broadcast
  refresh), DD7 (scroll-spy untouched), DD8 (disclosure semantics:
  `h3 > button[aria-expanded]` + `role="region"` + `aria-labelledby`).
- Leg 1 landed `JAR_PANELS` / `panelForDataClass` (page must import from
  `./jar-panel-model.js` — flat specifier, `// @ts-ignore` + `any` per
  the internal-page import convention) and `bridge.historyCount`.

## Inputs (citations verified at flight recon; leg 1 did not touch jars.js)

- `src/renderer/pages/jars.js` (1,389 lines, one closure):
  `SectionRefs` typedef (~452–464), `buildJarSection` (~482–588),
  `updateJarSection` (~594–615), `DATA_ACTIONS` (~762–776),
  `CLEAR_COPY`/`WIPE_COPY` tables (~739–751, name-free by design),
  `buildDataControlsBlock` (~786–820), `buildDataConfirm` (~852–914),
  `updateDataConfirmArea` (~931–943, the `action + ':' + row.id` key),
  delete button/confirm/area (~953–1035: `buildDeleteButton`,
  `buildDeleteConfirm`, boolean-keyed `updateDeleteArea`;
  `openConfirmDelete` itself is at ~1290–1293 — *citation corrected at
  design review*), `renderSections` (~1108–1141), `ui` state +
  `closeTransient` (~152–208), global Escape (~1318–1320), subscriptions +
  `pagehide` (~1373–1388), scroll-spy (~402–446).
- `src/renderer/pages/jars.css` — section/button/error/confirm styles.
- `src/shared/jar-panel-model.js`, `bridge.historyCount`,
  `bridge.onHistoryChanged`/`offHistoryChanged` (leg 1 / flight 1).

## Implementation Contract

1. **Panels block** (per persistent jar, between the name/swatch area and
   the footer): for each `JAR_PANELS` entry render
   `<div class="jar-panel" data-panel="<id>">` containing
   `<h3 class="jar-panel-heading"><button type="button"
   id="jar-<jarId>--<panelId>-heading" aria-expanded="false"
   aria-controls="jar-<jarId>--<panelId>">…</button></h3>`
   and `<div id="jar-<jarId>--<panelId>" role="region"
   aria-labelledby="jar-<jarId>--<panelId>-heading"
   class="jar-panel-region" hidden>…</div>`.
   **⚠ DOUBLE-HYPHEN separator is load-bearing** *(design review, HIGH)*:
   a single hyphen collides — jar ids come from `slug()` which can
   produce ids ENDING in a panel token (jar "Personal" + jar "Personal
   Cookies" → `jar-personal-cookies` would be BOTH jar-Personal's cookies
   region and jar-Personal-Cookies' section id). `slug()` collapses
   non-alnum runs to a single `-` and never emits `--`, so `--` is a
   reserved separator. Use it in region AND button ids.
   Button label text: panel label; for History, the DD6 count suffix
   ("History — 3 visits" / "History — no visits"; count element is a
   `<span>` inside the button so label patching is targeted).
2. **Panel state**: `SectionRefs` gains `panelOpen: Map<panelId, boolean>`
   (default all `false`) and `panelRefs: Map<panelId, { button, region,
   countSpan? }>`. Toggle handler: if collapsing AND
   `ui.mode === 'confirm' && ui.rowId === row.id && regionForAction(ui.action)
   === thisPanelId` → `closeTransient()` first (which re-renders), then
   flip. Expansion/collapse itself never rebuilds region content.
3. **Region routing**: module-level `regionForAction(action)`:
   `clear-<classId>` → `panelForDataClass(classId)`; `wipe` → `'footer'`;
   `delete` → `'footer'`. Clear buttons render into their panel's region;
   wipe + delete buttons render side by side in the footer block.
4. **Confirm areas per region**: `SectionRefs.confirmAreas: Map<regionId,
   element>` + `confirmOpenKeys: Map<regionId, string|null>` replace
   `dataConfirmArea`/`dataConfirmOpenKey`/`deleteArea`/`deleteConfirmOpen`.
   One update function `updateConfirmAreas(refs, row)` iterates the three
   regions; for each, key = (`ui.mode==='confirm' && ui.rowId===row.id &&
   regionForAction(ui.action)===regionId`) ? `ui.action + ':' + row.id` :
   null; diff against the region's open-key; rebuild that region's confirm
   only on key change (focus the Confirm button on genuine open/swap —
   existing behavior). `delete` becomes a `DATA_ACTIONS`-style entry in
   the same confirm machinery (its verbatim F3 copy and its
   `bridge.jarsRemove` run body preserved exactly; `openConfirmDelete`
   collapses into the generic `openDataConfirm`). The old
   `updateDeleteArea`/`buildDeleteConfirm` paths are deleted.
   **Delete success stays a NO-OP** *(design review, FD ruling)*: today
   delete's confirm does nothing on success — no `setSectionStatus`, no
   `closeTransient` — relying on the `jars-changed` broadcast to remove
   the section and `reconcileUi` to null `ui`; the generic path's success
   handling would introduce a transient flash under the documented
   broadcast-before-resolve race. Give the delete entry a
   `silentSuccess: true` flag (or equivalent) skipping both. Delete's
   COPY is byte-identical; its RUN BODY preserved; its success path is
   the existing no-op.
   **The footer's delete button MUST register in the shared buttons map
   under `'delete'`** *(design review)*: it now stays visible beside its
   open confirm, so `buildDataConfirm`'s trigger-disable guard
   (`refs.dataButtons.get(action)`) becomes load-bearing against
   double-fire for delete — a bespoke unregistered button silently loses
   that guard.
5. **Count wiring**: at section build, `bridge.historyCount({ jarId:
   row.id })` → on ok, patch `countSpan` (button label reads
   "History — N visits" / "History — no visits"; pre-fetch and
   failure state is the bare "History" label — pinned). Module-level
   `onHistoryChanged` subscription (handle + `pagehide` off, beside the
   jars pair): payload `{ jarId }` → if a section exists for it, re-run
   the same count fetch. No other reaction (invalidation semantics).
   **INVARIANT** *(design review, HIGH)*: `updateJarSection`/`render()`
   must NEVER write the History count span — the count is not derivable
   from `row`/`state`, and a render-path rebuild would blank it on every
   unrelated broadcast with nothing to restore it. Count patching happens
   EXCLUSIVELY in the build-time fetch callback and the
   `onHistoryChanged` handler, decoupled from the state-render cycle.
   Static panel labels give `updateJarSection` nothing to touch in the
   panels block except via `updateConfirmAreas`.
   **Teardown race guard** *(design review)*: both fetch sites
   closure-capture `countSpan` at fetch-issue time (a write to a
   detached node is a harmless no-op) — never re-derive via
   `sectionMap.get(jarId)` after the await without a null guard; wrap in
   try/catch consistent with the file's defensive style.
6. **Hash deep-link**: module-level `appliedInitialHash` flag; after the
   FIRST `applyState` render, if `location.hash` names a panel region:
   expand that panel (set state + aria + unhide) and `scrollIntoView`
   the section. Also a `hashchange` listener doing the same at runtime.
   **Match by exact-id equality, never by splitting on hyphens**
   *(design review — `site-data` itself contains a hyphen)*: resolve via
   `document.getElementById(hash.slice(1))` and check it is a known
   panel region (e.g. classList/`sectionMap` cross-check), or compare
   against precomputed `jar-<id>--<panel>` composites. If it fights the
   scroll-spy in practice, dropping the runtime listener is an accepted
   variation (log it).
7. **Burner**: untouched (`isBurner` branch renders no panels/footer).
8. **CSS** (`jars.css`): `.jar-panel` block spacing; heading-button reset
   (full-width, inherits h3 size, chevron via
   `button[aria-expanded="true"]::before` rotation or content swap — pick
   the simplest); `.jar-panel-region` padding; NO height animation
   (instant toggle); respect existing token palette. Reusing
   `.jar-data-controls`/`-buttons`/`-confirm-area` classes across the
   three regions is safe (no per-section-singleton selectors — design
   review verified); **delete the now-orphaned `.jar-delete-area` rule**
   when its DOM path goes (no dead CSS).
9. **Section reconcile**: `updateJarSection` diffs panel button labels
   (count), never touches open/closed state or region contents except via
   `updateConfirmAreas`. `renderSections` unchanged structurally.

## Acceptance Criteria

- [x] Three panels per persistent jar in `JAR_PANELS` order; all collapsed
      on load; toggles independent; Burner unchanged (no panels).
- [x] Disclosure semantics exactly: `h3 > button[aria-expanded]` +
      `role="region"` + `aria-labelledby` + `aria-controls`; regions carry
      the stable `jar-<id>-<panel>` ids (implemented as the double-hyphen
      `jar-<id>--<panel>` composite per Implementation Contract #1/DD3).
- [x] Clear-cookies confirm renders in the Cookies region;
      clear-storage/clear-cache confirms in the Other-site-data region;
      wipe AND delete confirms in the footer region — all through ONE
      `(action, rowId)`-keyed mechanism; `updateDeleteArea` and the
      boolean `deleteConfirmOpen` are gone (grep-AC:
      `grep -n "deleteConfirmOpen" src/renderer/pages/jars.js` → 0 hits,
      verified).
- [x] Delete's confirm COPY is byte-identical (grepped the exact string
      before refactoring; carried into `DELETE_COPY` verbatim); its run
      body is preserved; its success path is the existing no-op
      (`silentSuccess: true` — no status note, no closeTransient); the
      footer delete button is registered in the shared `dataButtons` map
      (trigger-disable guard holds — verified by reading).
- [x] Collapsing a panel with its confirm open closes the transient first
      (no hidden focused controls); Escape behavior unchanged.
- [x] History button label carries the live count; initial fetch at build
      (uniform boot + jarsAdd path); `history-changed` refresh wired with
      handle + `pagehide` cleanup.
- [x] Hash deep-link expands + scrolls after first render; boot race
      guarded (`appliedInitialHash` gate in `applyState`).
- [x] `npm test` / `npm run typecheck` / `npm run lint` green (the page
      has no unit suite — the script-tag contract test and typecheck are
      the static nets); suite ~1s (1392/1392, ~1.0s).
- [x] jars.js stays under the DD2 trigger (~1,800 lines) — **1,671 lines**
      (was 1,389; +282), reported in the flight log.

## Verification Steps

- Gates above. Live verification (rendered panels, focus preservation,
  live count) is leg 3's charter — this leg's own bar is static
  correctness + contract preservation, verified by careful reading and
  the grep-ACs.
- Leg 3 must explicitly exercise: open a panel's confirm → collapse that
  panel → clean collapse, no orphaned focus, no double-render artifact
  (the toggle-handler ordering: read `ui` → `closeTransient()` → flip
  state/aria/hidden on the SAME live nodes — safe because render never
  touches `panelOpen` or panel DOM; design-review-verified ordering).

## Edge Cases

- Broadcast arrives while a panel is expanded and its confirm open: the
  per-region diff sees the same key → no rebuild → focus survives (the
  M06 F4 DD6 rule extended to regions).
- A jar deleted while its section's confirm is open: `reconcileUi`
  (existing) collapses the transient; the section removal path already
  clears status timers — panels add no new timers.
- `historyCount` rejects (invoke error): catch and leave the neutral
  label; never throw from the count path.
- Two rapid toggles: state is a plain boolean flip — last one wins; no
  async in the toggle path.

## Files Affected

- `src/renderer/pages/jars.js` — the relayout
- `src/renderer/pages/jars.css` — panel styles

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry (incl. new jars.js line
      count)
- [x] Set this leg's status to `landed`
- [x] Do NOT commit

## Citation Audit

jars.js line-range citations (~452–1388) verified during flight-design
recon at flight/01 HEAD; leg 1 modified only `jars.html` (script tag) —
jars.js is byte-identical, so the ranges hold. Symbol names double as
drift-guards; the implementer should navigate by symbol.
