# Leg: active-view-consolidation

**Status**: completed
**Flight**: [Conveniences & Event-Seam Re-architecture](../flight.md)

## Objective

Replace the renderer's scattered web-only active-view bookkeeping (`visibleWebTabWcId` + raw
`!t.trusted` / `tab.trusted` guards) with a single active-view concept (`activeViewWcId`) and one
container-derived predicate (`isWebTab()` / `isInternalTab()`), and run a substrate-guard audit
confirming every old-substrate-keyed guard is correct under the unified concept.

## Context

- **Flight DD2 (operator chose full structural consolidation at Phase 6).** Reframed by design review as
  **preventive hardening + readability**, *not* a live-bug fix: the three Flight-3 HAT regressions this
  once targeted are already individually fixed (`freezeGuest` keys on `wcId`, `sendActiveBounds` bounds
  internal views, `capture-active-guest` captures internal deliberately), and `isInternalTab()` already
  exists (`renderer.js:911`). This leg makes the *code* express one concept cleanly; runtime behavior is
  preserved except for one explicitly-flagged refinement (see "Behavior delta" below).
- **Equivalence is proven.** `tab.trusted` is the call-site arg to `createTab`; `trusted:true` always
  sets `jar.id==='internal'` + `partition===internalPartition` (`renderer.js:711-725`), so
  `isInternalTab(tab) === tab.trusted` for every tab. The predicate swap is therefore behavior-identical.
  `tab.trusted` stays as the field passed to `tabCreate` (main needs it to pick webPreferences); only the
  renderer's *decision* sites switch to the predicate.
- **What `visibleWebTabWcId` actually does** (`renderer.js:110`): tracks "the view main is currently
  showing, that the renderer may need to hide itself when switching to a not-yet-ready (just-created)
  tab." When the incoming tab's `wcId` is already known, `tabSetActive` is sent and *main* hides the
  previous view; the renderer-side `tabHide(visibleWebTabWcId)` path fires **only** in the brief window
  before a freshly-created tab's `wcId` arrives (`activateTab` 863-877). Today it is set for web tabs
  only (`if (!tab.trusted)` at 859, 790; `if (!t.trusted)` at 1096) and the two not-ready branches
  (internal 863-869, web 870-876) are **byte-identical**.
- **Highest-risk site (DD2, audit must verify explicitly):** the outgoing-view hide on
  switch-to-not-ready-tab (`activateTab` 863-877). The merge must still hide the **outgoing** view
  (read the tracker *before* reassigning) and must not confuse "hide outgoing" with "incoming is
  internal." Do not flatten this away.
- **Regression net:** the new `tab-surface-geometry` + `internal-tab-menus` specs (Leg 4) and the HAT
  (Leg 5). DD2 divert: if consolidation destabilizes freeze/geometry beyond inline-fixable, scope down
  to the minimal predicate sweep + a behavior-preserving `visibleWebTabWcId`→`activeViewWcId` rename
  (no uniform-tracking change), recorded in the flight log.

## Behavior delta (the ONE intentional runtime change — flagged for design review)

Today `visibleWebTabWcId` is set for **web tabs only**, so when the active tab is **internal** and the
user opens a brand-new tab, during the window before the new tab's `wcId` arrives the renderer does
**not** hide the outgoing internal view (the tracker pointed at a stale/last web tab or null). Main
hides it once the new `wcId` arrives via `tabSetActive`, so the gap is sub-second — but it is a latent
seam the web-only tracker leaves open.

Consolidating to `activeViewWcId` that tracks **whichever** view main is currently showing (web *or*
internal) closes that gap: the outgoing view is hidden uniformly. This is a strict improvement and the
honest single-concept end state. **It is the one behavior change in this leg.** If the design reviewer
judges it outside a readability leg's remit or too risky on a working surface, fall back to the DD2
divert (keep web-only tracking semantics under the new name; predicate-unify only).

## Inputs

- `src/renderer/renderer.js` — the consolidation surface:
  - state decl `visibleWebTabWcId` (`:110`)
  - `createTab` `.then` web-only set (`:790-793`)
  - `closeTab` clear (`:811`)
  - `activateTab` ready-branch set (`:859-862`) and the two identical not-ready branches (`:863-877`)
  - `freezeGuest` (`:1066-1081`, already keys on `t.wcId` — no tracker use) / `unfreezeGuest` web-only
    re-set (`:1088-1098`, `:1096`)
  - `sendActiveBounds` (`:1036-1052`, already web+internal correct)
  - `.trusted` decision sites: `:859, :863, :1096, :1108, :1137, :1160, :1166, :1172, :1260, :2099,
    :2144, :2282, :2327, :2598` (14 total)
  - `isInternalTab` (`:911`), `isWebTab` (to add)
- No external coupling: `grep -rn "visibleWebTabWcId\|isWebTab" src/ test/` returns only renderer.js.
  renderer.js has no unit tests (`automation-tabs.test.js` covers the engine `tabs.js`, not the renderer).

## Outputs

- `renderer.js` with: `isWebTab(tab)` helper; every `.trusted` decision site replaced by
  `isInternalTab`/`isWebTab`; `visibleWebTabWcId` renamed to `activeViewWcId` with a single set/clear/
  hide path; the two not-ready branches collapsed to one; a substrate-guard audit recorded in the flight
  log.
- No new `tab.trusted` *decision* reads in the renderer (only the `trusted` field passed to `tabCreate`
  remains). `grep -n "\.trusted" src/renderer/renderer.js` shows only the `tabCreate({...trusted})` call
  and type/comment lines, not branch conditions.

## Acceptance Criteria

- [x] `isWebTab(tab)` helper added (`return !isInternalTab(tab)`), placed beside `isInternalTab`.
- [x] Every `.trusted`-based **decision** in renderer.js replaced by `isInternalTab(tab)` /
  `isWebTab(tab)` (the 14 sites above). The `trusted` value passed to `tabCreate` is unchanged.
- [x] `visibleWebTabWcId` renamed to `activeViewWcId`, updated at exactly **three** setter sites
  (`activateTab` ready-branch; `createTab` `.then` when this tab is still active; `unfreezeGuest`),
  cleared at one site (`closeTab` of the tracked tab) and at the not-ready branch after the outgoing
  hide, and read at one site (the outgoing-view hide on switch-to-not-ready-tab).
- [x] Every inline comment / JSDoc that references the old `visibleWebTabWcId` name or its "web-only"
  semantics is updated to the unified `activeViewWcId` framing — including the `freezeGuest` JSDoc
  (`:1059-1060`) and `unfreezeGuest` JSDoc (`:1083-1086`). (The `freezeGuest` *code* stays unchanged;
  only its comment that names the renamed symbol is corrected. This is part of the rename, NOT Leg 3 —
  Leg 3 owns CLAUDE.md + behavior-spec citations, not renderer inline comments coupled to this rename.)
- [x] The two identical not-ready branches in `activateTab` (`:863-877`) are collapsed into one that
  hides the outgoing `activeViewWcId` (read before reassignment) then clears it — the
  hide-outgoing-vs-incoming-internal distinction preserved (see Behavior delta).
- [x] `freezeGuest` still hides `t.wcId` directly (unchanged); `unfreezeGuest` re-shows the active view
  and sets `activeViewWcId = t.wcId` for **whichever** view is active (web or internal), consistent with
  the uniform tracker.
- [x] Substrate-guard audit performed and recorded in the flight log: every `isInternalTab`/`isWebTab`/
  `activeViewWcId`/`isInternalContents` reference confirmed correct under the unified concept; the
  outgoing-hide site verified explicitly.
- [x] `npm test`, `npm run typecheck`, `npm run lint` all green. `npm run a11y` deferred to Leg 5 HAT
  (requires live GUI + automation surface — not executable headless).

## Verification Steps

- `grep -n "\.trusted" src/renderer/renderer.js` → only the `tabCreate` field pass + JSDoc/comments, no
  `if (...trusted)` branch conditions remain.
- `grep -n "if (!trusted)" src/renderer/renderer.js` → empty (the `createTab .then` closure gate at
  `:790` uses the bare `trusted` closure var — no dot — so it is invisible to the `.trusted` grep; this
  separate check confirms it was dropped).
- `grep -rn "visibleWebTabWcId" src/` → nothing (renamed); `grep -rn "visibleWebTabWcId" src/renderer/`
  including comments → nothing.
- `npm test` / `npm run typecheck` / `npm run lint` / `npm run a11y` → all green.
- Rendered-state correctness (freeze/restore, panel-resize, switch-to-new-tab on web AND internal) is
  verified live in **Leg 4** (`tab-surface-geometry`, `internal-tab-menus`) and the **Leg 5** HAT — not
  required to launch the app in this leg.

## Implementation Guidance

1. **Add `isWebTab`** next to `isInternalTab` (`:911`):
   ```js
   /** @param {Tab|null} tab @returns {boolean} */
   function isWebTab(tab) { return !isInternalTab(tab); }
   ```
2. **Swap the 14 `.trusted` decision sites.** Mechanical, behavior-identical:
   - `if (!t.trusted ...)` / `if (!tab.trusted ...)` → `if (isWebTab(t) ...)` / `if (isWebTab(tab) ...)`
     (sites `:1137, :1160, :1166, :1172, :2099, :2144, :2282, :2327, :2598`, and the `:1096` set).
   - `if (tab.trusted)` / `else if (tab.trusted)` → `if (isInternalTab(tab))` (`:863, :1108`).
   - `:1260` (`... || t.trusted) return;`) → `... || isInternalTab(t)) return;`.
   - `:859` (`if (!tab.trusted)` web-set) folds into the tracker rework (step 3), not a bare swap.
   - Update the adjacent comments that say "web-only"/"internal never …" to the unified framing.
3. **Consolidate the tracker** (`visibleWebTabWcId` → `activeViewWcId`):
   - Rename the decl (`:110`) and its JSDoc: "wcId of the view main is currently showing (web or
     internal); used to hide the outgoing view when switching to a not-yet-ready tab."
   - `createTab` `.then` (`:790-793`): set `activeViewWcId = tab.wcId` unconditionally when this is the
     active tab and `tabSetActive` was just sent (drop the `if (!trusted)` gate).
   - `activateTab` ready branch (`:854-862`): after `tabSetActive(...)`, set `activeViewWcId = tab.wcId`
     unconditionally (drop the `if (!tab.trusted)` gate).
   - `activateTab` not-ready branches (`:863-877`): collapse to ONE branch:
     ```js
     } else {
       // wcId not yet arrived — hide the outgoing view while we wait; the tabCreate .then()
       // sends tabSetActive once wcId is available. Read the tracker BEFORE clearing.
       if (activeViewWcId != null) window.goldfinch.tabHide(activeViewWcId);
       activeViewWcId = null;
     }
     ```
   - `closeTab` (`:811`): `if (tab.wcId === activeViewWcId) activeViewWcId = null;`.
   - `unfreezeGuest` (`:1096`): `activeViewWcId = t.wcId;` unconditionally (drop the `if (!t.trusted)`).
4. **Do NOT change the CODE of** `freezeGuest` (already correct — hides `t.wcId`), `sendActiveBounds`
   (already web+internal correct), or any main-process / `tab.trusted`-in-main code. **Do** update the
   `freezeGuest`/`unfreezeGuest` JSDoc comments that name the renamed symbol or call it "web-only"
   (`:1059-1060`, `:1083-1086`) to the unified framing — a rename must not leave dangling references.
5. **Substrate-guard audit.** After the swap, grep and walk each guard, confirming correctness under the
   unified concept; write the audit as a short table in the flight-log Leg-2 entry. Cover:
   `grep -n "isInternalTab\|isWebTab\|activeViewWcId" src/renderer/renderer.js` and confirm
   `grep -rn "isInternalContents" src/main/` is unaffected (main-side guard, out of this leg's scope but
   named in the audit for completeness). Explicitly note the outgoing-hide site is correct.

## Edge Cases

- **Switch internal → brand-new tab (the behavior delta).** With uniform tracking, the outgoing internal
  view is now hidden during the not-ready window (previously left visible until main switched). Verify in
  Leg 4 `internal-tab-menus` / HAT that no flash/black-band regression appears on the internal→new-tab
  transition.
- **freeze while a menu is open, then switch tabs.** `guestFrozen` short-circuits `sendActiveBounds`;
  ensure the tracker rename doesn't change the freeze/unfreeze ordering. `unfreezeGuest` sets the tracker
  to the re-shown view — confirm it isn't left stale after a dismiss-then-switch.
- **freeze → switch-while-frozen → unfreeze.** `activateTab` does not check `guestFrozen`, so a switch
  while frozen is possible. `unfreezeGuest` reads `activeTab()` (the NEW active tab), re-shows it, and
  sets `activeViewWcId = t.wcId` to that new view — which is correct (the tracker reflects what main is
  now showing). Confirm in the audit that this sequence leaves `activeViewWcId` pointing at the newly
  active view, not the frozen-at-time tab.
- **closeTab of the active web tab while frozen.** `activeViewWcId` clear on close must not strand a
  frozen still; freeze is dismissed before close in the normal flow — confirm no path closes the tracked
  tab while `guestFrozen` without clearing both.
- **Predicate vs field divergence (none expected).** If any tab ever had `trusted` disagree with
  `isInternalTab`, the swap would change behavior — proven impossible by the createTab equivalence, but
  the audit re-confirms.

## Files Affected

- `src/renderer/renderer.js` — predicate unification + active-view tracker consolidation (only file).

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]`** *(deferred-commit model — do NOT
commit per-leg):*

- [x] All acceptance criteria verified
- [x] Tests passing (`npm test` / `typecheck` / `lint`; `a11y` deferred to Leg 5 HAT)
- [x] Substrate-guard audit recorded in flight-log.md
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [ ] Check off this leg in flight.md (deferred — Flight Director handles at commit)

---

## Citation Audit

All citations verified against current code on `flight/04-conveniences-event-seam` at leg design time:

- `renderer.js:110` (`visibleWebTabWcId` decl), `:790-793` / `:859-877` (set + not-ready branches),
  `:811` (close clear), `:1066-1081` (`freezeGuest`), `:1088-1098`/`:1096` (`unfreezeGuest`),
  `:1036-1052` (`sendActiveBounds`), `:911` (`isInternalTab`), `:711-725` (createTab trusted/jar
  equivalence) — **OK**.
- `.trusted` decision sites `:859, :863, :1096, :1108, :1137, :1160, :1166, :1172, :1260, :2099, :2144,
  :2282, :2327, :2598` — **OK** (14, confirmed by `grep -c "\.trusted"`).
- No external coupling: `grep -rn "visibleWebTabWcId\|isWebTab" src/ test/` → renderer.js only — **OK**.
