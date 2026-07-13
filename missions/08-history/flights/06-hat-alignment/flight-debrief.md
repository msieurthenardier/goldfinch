# Flight Debrief: HAT & Alignment — Per-Jar History

**Date**: 2026-07-13
**Flight**: [HAT & Alignment](flight.md)
**Status**: landed
**Duration**: 2026-07-13 (guided HAT session + fix legs, same day)
**Legs Completed**: 7 of 7 (`hat-walkthrough`, `address-select-all`, `jars-page-tabs`, `history-panel-content`, `confirm-modal-and-wipe`, `hat-reverification`, `history-paging-scroll-anchor`)

## Outcome Assessment

### Objectives Achieved

The mission's human half. A guided live HAT session walked the operator through the
history feature end-to-end, surfacing findings H1–H9 and rulings R1–R6; the fixes
landed as sequenced legs (risk-tiered design review; fix-vs-feature gate). Delivered:
select-all on address focus (R1), a per-jar tab strip replacing the collapsible panels
(H4), a numbered history pager + rows-as-links-open-new-tab-in-jar + trashcan delete
(H1/H2/H3, H5 closed), a page-level confirm modal + wipe-closes-tabs (H7/H6), and a
pager scroll-anchor (H9). Closing re-verification confirmed R1 + H1–H7 resolved live;
the `jar-data-controls` behavior test re-ran 7/7 (close-not-reload). Suite green at
1502/1502.

### Mission Criteria Advanced

No new machine criteria — all 11 were closed by Flights 1–5. This flight is
operator-acceptance of the three new surfaces plus the correctness fix H6 (which
restored the mission's "wiping removes the jar's history" guarantee for jars with open
tabs). The mission is now ready for `/mission-debrief`.

## What Went Well

- **The fix-vs-feature gate + risk-tiered leg review was sound governance, not
  friction.** The tiering was proportionate (LOW: address-select-all, scroll-anchor →
  review skipped; HIGH: tabs, history-content, confirm-modal → full design review), and
  every HIGH review caught real gaps. The FD recorded the tier and rationale for every
  leg — auditable governance that kept low-risk legs friction-free.
- **The multi-surface design-review trigger paid for itself twice in Leg 05:** it caught
  (1) that `jars-tabs.js` hard-depended on `regionForAction`/`closeTransient` params the
  modal rework deletes — omitting that edit would break the tab strip; and (2) that
  `jar-data-controls.md` Step 5 still pinned the *old* reload behavior and would have
  red-failed the re-run. Both were flagged before implementation, not discovered after.
  Leg 03's review also caught a latent perf regression (History-default would fire a
  50-row fetch for *every* jar at build time → moved to lazy scroll-into-view fetch).
- **The HAT fixes retired more machinery than they added — net simplification.** The
  confirm modal retired `CONFIRM_REGIONS`/`regionForAction`/`confirmAreas`/
  `confirmOpenKeys`/`updateConfirmAreas` *and* Leg 03's own close-confirm-on-tab-switch
  branch (dead under a focus-trapped modal). The tab strip replaced three
  independently-collapsible panels + their `panelOpen` map with a single `activeTab` +
  one `selectTab()` switch path (click/keyboard/hash all funnel through it). Fewer states.
- **The DD2 growth ratchet worked — twice.** jars.js hit 1,827 inline at Leg 03 → extract
  `jars-tabs.js` → 1,708; hit 1,817 inline at Leg 05 → extract `jars-confirm-modal.js` →
  1,587; settled at **1,598 at rest (~200 lines under the ~1,800 trigger)**. The jars-page
  family is now four cohesive modules (jars.js 1,598 + jars-tabs.js 210 +
  jars-history-panel.js 558 + jars-confirm-modal.js 316 = 2,682) — controlled
  decomposition along real seams, not fragmentation. The pre-agreed extraction fallback
  meant the split was mechanical, not a mid-implementation re-litigation.
- **H6 was correctly scoped as a renderer-only change.** `handleWipe` (`jar-ipc.js`) was
  untouched — it still purges history + broadcasts `jar-wiped`; the entire behavior change
  lives in `renderer.js`'s `onJarWiped` reaction, reusing the DD6 ordered-sweep shape to
  avoid `tabSetActive` flicker. Minimal blast radius; the isolation/broadcast contract is
  unchanged.
- **Clean reopen-after-landing discipline.** Post-landing operator requests were triaged
  correctly: clear-history-tab-behavior → investigated, ruled keep-as-is (conventional,
  matches Chrome/Firefox); H9 → promoted to Leg 07 with a fresh design pass; H8 → filed as
  a BACKLOG follow-up flight, correctly identified as pre-existing and cross-cutting, not
  jammed into this history HAT.

## What Could Be Improved

### Process — the core methodology finding

- **Defer *aesthetics* to an end-of-mission HAT; do NOT defer *behavioral correctness
  signals* that contradict a mission criterion.** Two findings should have been caught in
  their originating flights:
  - **H6 is the clearest miss.** Flight 3 probe 6 *actually foresaw it* — it observed "the
    1 residual row is a legitimate reload-triggered new visit" and classified it a
    non-defect. HAT reclassified the same observation as a real bug violating "wiping
    removes the jar's history." The signal was in hand a flight earlier and mis-triaged.
    **Standardize: a residual that contradicts a stated mission criterion is a defect
    regardless of how legitimate its mechanism is.** The root interaction (reload-on-wipe
    meets a recorder that counts navigations as visits) was latent from the moment F4/DD4
    chose reload-sweep; a design review at F4 asking "what does the recorder do with a
    programmatic reload?" would have caught it.
  - **H5 ("Showing X of many" when X < the page limit)** is a plain display-logic bug — a
    functional check or a targeted unit assert in Flight 3 could have caught it rather than
    waiting for a human. It dissolved into H1's pager, so no cost here, but it shouldn't
    have needed HAT.
  - By contrast **H4 (cartoonish panels → tabs)** is genuinely a judgment call and
    *appropriately* deferred to HAT — the look-and-feel-with-a-human class the flight
    exists for. Not a miss.
- **Internal-page manual HAT can produce false negatives that need a machine tiebreaker.**
  H6 re-verification initially read as a PARTIAL FAIL (operator saw a tab survive); it was
  resolved NOT-A-BUG via direct automation reproduction (the survivor was `closeTab`'s
  last-tab→fresh-blank-tab branch, a test-setup nuance). The spec correctly routed
  authoritative confirmation to the behavior test rather than the operator's eyeball. Good
  instinct — but it confirms internal-page manual observation needs a machine backstop.

### Technical

- **Watch item: duplicated `buildIcon`/`ICON_DELETE`** (~50 lines) copied into
  `jars-history-panel.js` because jars.js doesn't export them. Design-review-sanctioned to
  avoid a 3-file extraction, but this icon has churned twice. A second such duplication is
  the trigger to extract a shared `src/shared/` icon module (which would retire the
  duplication debt at the same time).
- **`history-list`/`internal-history-list` IPC twin removed outright** (dead
  post-migration; net twin count held at 6). Clean, but a breaking internal-surface change
  worth noting for anyone tracking the IPC catalog.
- **The jars-page module family is now a de facto multi-module subsystem** with an
  implicit contract (mount-boundary discipline, `selectTab` sole-switch-path,
  render-never-writes-count, the three-point module-onboarding ritual) that lives only in
  scattered doc-comments. It warrants a short single-reference note.

### Testing

- **One behavior test is the only automated net for a 5-finding, multi-surface change, and
  it only reaches the main-process-observable subset.** The `jar-data-controls` test
  authoritatively verified H6 close-not-reload (the wiped jar's `wcId` disappeared from
  `enumerateTabs`; a stale eval errored `no-such-contents` — destroyed, not reloaded).
  Correct — tab lifecycle *is* main-process-observable. But the renderer-feel surface
  (modal focus-trap, pager click behavior, middle-click/`auxclick` jar routing, H9
  scroll-anchor, R1 select-all) has zero regression net going forward and relies solely on
  operator HAT. Consistent with house practice (internal-page DOM isn't eval-observable),
  not a Flight-6 regression — but a standing mission-level exposure.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| jars.js extracted to sibling modules twice mid-flight (jars-tabs.js, jars-confirm-modal.js) | Inline landing crossed the ~1,800 DD2 trigger both times; pre-agreed fallback fired | Yes — name the extraction target at design time for legs that may cross a size trigger |
| H6 re-verification PARTIAL FAIL → resolved NOT-A-BUG via automation | Operator's manual observation was a test-setup nuance; behavior test was the tiebreaker | Yes — route authoritative internal-page confirmation to a machine observable |
| Flight reopened landed→in-flight post-landing for Leg 07 (H9) | Operator request after the flight had landed | No (situational); the reopen discipline (annotate, don't rewrite) is the reusable part |

## Key Learnings

- **A dedicated end-of-mission HAT flight was the right structure — budget it by default
  for any mission shipping new user-facing surfaces.** It was chartered in the mission up
  front (not bolted on), F1–F5 closed all 11 machine criteria, and F6 surfaced 9 findings
  + 6 rulings that machine gates provably could not (all four surfaces are internal-page
  DOM, "not eval-observable"). For missions that ship no new interactive surface, it is not
  warranted.
- **Batching look-and-feel to one HAT flight beat per-flight polish and did not create net
  rework** — because H4 (tabs) and H1/H2/H3 (content) landed together they were *sequenced*
  (shell first, content into it), not re-touched. The one exception (H6) is precisely the
  case that proves *behavioral* correctness must not be deferred.
- **Methodology patterns worth standardizing (project-agnostic):** the multi-surface
  design-review trigger inside HAT; the pre-agreed growth-checkpoint extraction fallback;
  risk-tiered per-leg review with an explicit recorded LOW-tier skip; folding the
  behavior-test re-run into the closing HAT leg rather than a separate step.

## Recommendations

1. **Add a triage rule to flight/leg design:** a "legitimate but surprising" residual that
   contradicts a stated mission criterion is a defect, not an accepted quirk — file it in
   the originating flight, don't carry it to HAT.
2. **Promote the multi-surface design-review trigger and the pre-agreed growth-extraction
   fallback** from per-flight rules to standing methodology conventions.
3. **Document the jars-page module subsystem contract** in a single reference (a `docs/`
   note or a jars.js header block).
4. **Track H8 at mission level** — internal-page keyboard focus is genuinely broken
   (`tab-set-active` raises the guest view but never calls `webContents.focus()`, so Tab
   traverses the chrome toolbar). It affects *all* internal pages, not just history; it is
   correctly filed as a dedicated BACKLOG follow-up flight with its own design + behavior
   test.
5. **Extract a shared icon module** if `buildIcon`/`ICON_DELETE` duplicates a third time.

## Action Items

- [ ] Add the "residual contradicting a mission criterion = defect" triage rule to the
      leg/flight design checklist.
- [ ] Carry H8 (internal-page guest-view keyboard focus) into the mission debrief and
      confirm its BACKLOG follow-up flight entry.
- [ ] Document the jars-page 4-module subsystem contract in one place.
- [ ] Watch item: extract a shared icon module on the next `buildIcon`/`ICON_DELETE`
      duplication.
- [ ] Confirm the two banked `jar-data-controls` spec carry-forwards (burner-vs-unknown
      error granularity; explicit fixture URL) are captured where the next spec author
      will see them.
