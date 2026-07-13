# Flight Debrief: Address-Bar Suggestions

**Date**: 2026-07-13
**Flight**: [Address-Bar Suggestions](flight.md)
**Status**: landed
**Duration**: 2026-07-12 (single-day flight)
**Legs Completed**: 4 of 4 (`suggest-store-and-ipc`, `sheet-nofocus-and-template`, `omnibox-wiring`, `verify-integration`)

## Outcome Assessment

### Objectives Achieved

Wired the omnibox end-to-end: the age-bucketed frecency `suggest` store query + IPC
twins + chrome bridge, the menu-overlay sheet's non-focusing open path + `suggestions`
template, and the renderer suggestions controller (debounced query, keyboard/pointer
selection, the full close-trigger matrix). The pure `src/shared/omnibox-suggest-model.js`
holds every decision (gate, model mapping, clamp, response-time revalidation) with 28
unit tests. Behavior test `omnibox-suggestions` passed 7/7 live — presence, jar
exclusivity, keyboard AND pointer selection arriving at exact URLs, burner gate
upstream-of-query, live 114ms keystroke-to-rows at 50k rows. Store scale probe: all
query lengths ≤ ~5ms median, including the uncovered 1-char prefix path.

### Mission Criteria Advanced

- **"Typing surfaces matching suggestions drawn exclusively from the active tab's jar
  history; chosen by keyboard or pointer; navigates the tab"** — closed this flight
  (behavior-test-backed, 7/7).
- **"Suggestions stay felt-instant at scale (tens of thousands of entries)"** — closed
  this flight (store probe + live 114ms keystroke-to-rows at 50k).
- **"No network egress"** — the suggestion half closed here, completing the criterion
  alongside Flight 3's search half.

## What Went Well

- **The central architectural bet — a non-focusing cross-view sheet — held exactly.**
  Recon verified before design that the chrome DOM is occluded by the guest
  WebContentsView, so the dropdown *must* live on the menu-overlay sheet. The whole
  feature became a **one-line focus-machinery change** (`deliverInit`'s
  `webContents.focus?.()` gained a single `!payload.noFocus` gate) rather than a rewrite.
- **The pure-decision / thin-wiring split is now proven three times** (routing, inherit,
  suggestions). Every decision lives in the pure module and is unit-testable without a
  browser; `renderer.js` only wires events.
- **The `now`-injection / no-clock-in-store determinism contract** (store *and* pure
  module both refuse to read the wall clock; the caller injects `now`) is excellent and
  should be the default for any time-dependent query logic.
- **All three design-review HIGHs were load-bearing and landed:** the Ch2 close-reason
  allowlist (without it every reason coerced to `toggle|superseded`), the grace-timer
  token+activeElement guard (pointer-click-vs-blur race), and the response-time
  revalidation gate (`acceptSuggestResponse` — the kebab-while-typing race).
- **Zero diverts.** Recon-first design meant the load-bearing facts (occluded chrome,
  sole focus site, 24-char Ch4 value cap, model-replace flicker semantics) were all
  verified before legs were written; the named chrome-DOM-dropdown fallback was never
  needed.
- **The behavior test earned its keep** — it found two real spec-premise defects
  (retention prune ate a 120-day seed; fictional `.test` hosts were unresolvable), both
  permanently folded into the spec.

## What Could Be Improved

### Process / Technical

- **The flight's most fragile invariant lives entirely in un-unit-tested renderer glue.**
  Main emits Ch7 (close) *strictly before* Ch6 (activated) for the same pointer
  activation, so the Ch7 sink must cancel timers unconditionally but preserve
  `items`/`selectedIndex` *only* on `reason==='activated'` — otherwise `suggest.items`
  is emptied before the Ch6 `sug:<i>` handler can read the clicked row's URL, silently
  breaking pointer-click navigation on *every* click. This subtle, ordering-dependent
  temporal contract between two IPC channels is guarded only by a doc comment and one
  end-to-end behavior test — there is no test that pins the *ordering* itself. This is
  the inherent cross-WebContentsView testability constraint (the sheet and chrome are
  separate documents), but it is the single largest regression exposure in the flight.
- **Two load-bearing invariants are protected by comments, not structure:** `deliverInit`
  as the *single* focus site (a second `webContents.focus()` on the sheet path silently
  breaks the no-focus guarantee), and the Ch7-before-Ch6 order. Both deserve an explicit
  pin at the sheet layer before the next non-focusing template builds on them.
- **The "two closed states" ambiguity is real sheet-subsystem debt.** The sheet has a
  hidden-class state and a view-detached-with-stale-DOM state; naive `rows>0` DOM polling
  reads phantom rows after a selection closes the sheet. Future sheet specs must judge
  visibility from pixels, not DOM presence — this belongs in behavior-test AUTHORING
  guidance, not just this flight's log.
- **Minor reason-fidelity smell:** the store-failure and IPC-catch paths both close with
  reason `'input-empty'` — an error close logged as an emptied-input close. The machinery
  to carry an honest reason now exists (the DD5 allowlist); use `'superseded'` or a
  dedicated reason.
- **Small dead surface:** `internal-history-suggest` twin registered-but-unused (YAGNI
  for uniformity), and `lastQuery`/`blurClosedAt`/`refocus` written-but-unread. All
  commented; low-priority cleanup or removal decision.

### Documentation

- The CLAUDE.md "Address-bar suggestions" section is strong (template shape, noFocus
  regime, close-trigger matrix, Ch7/Ch6 nuance). Add an AUTHORING.md-level note capturing
  the two reusable behavior-test lessons: (a) seeded-precondition specs must account for
  the system's own data-lifecycle policies (retention prune at launch); (b) navigation
  targets should be staged through the real recording pipeline to resolvable local
  fixtures, not fictional hosts.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Ch7-before-Ch6 conditional-reset dance (not in the leg contract) | Discovered in implementation; naive reset breaks pointer-click navigation | No (a fix); yes to tracing activation IPC ordering at design time |
| Two spec-premise defects fixed mid-run (retention seed window; unresolvable fixtures) | The behavior test surfaced them live | Yes — the two AUTHORING.md lessons above |
| Frecency bucket weights shipped as "acceptable variations", unvalidated | Ranking *quality* deferred to HAT | Partly — the model is sound; calibration is an open empirical question |

## Key Learnings

- **Recon-first design eliminates diverts.** Verifying the load-bearing environment
  facts *before* writing legs is why this flight had zero diversions and one-line
  machinery changes instead of rewrites.
- **The pure-decision-module + thin-controller split is the house pattern** for stateful
  chrome interactions — codify it. Paired with the response-time-gate-revalidation idiom
  (re-check the full gate at async arrival, not just at request time), it makes
  debounced-IPC-with-races surfaces tractable.
- **Cross-view temporal contracts need structural pins, not comments.** The Ch7/Ch6
  ordering and single-focus-site invariants are the flight's fragile core and are
  currently only documented.
- **Screen-reader parity for a cross-view dropdown is a pattern-level ceiling, not a
  per-feature gap.** True combobox `aria-activedescendant` from the chrome `#address`
  input to an `option` in a *different* WebContentsView document is genuinely impossible
  — the option DOM is unreachable from the input's document. The flight shipped honest
  best-effort `aria-expanded`/`aria-autocomplete="list"` and refused to claim parity.
  The mission should treat this as the accepted a11y ceiling of *every* cross-view sheet
  menu (don't relitigate per-feature).

## Recommendations

1. **Pin the sheet-layer invariants** (single focus site; Ch7-before-Ch6 ordering) with
   explicit tests before the next non-focusing template is built.
2. **Fold the two behavior-test authoring lessons into AUTHORING.md** (data-lifecycle-aware
   seeds; real-pipeline-staged fixtures) and the "two closed states → judge from pixels"
   rule.
3. **Resolve the two product rulings the run raised** — both are HAT/Flight-6
   carry-forwards that were dispositioned: click-into-populated-address-bar select-all
   (R1 → adopt), and Enter-with-no-selection search-fallthrough being recorded (R2 → keep).
   Confirm both landed.
4. **Low-priority cleanup:** honest close reasons for error paths; remove or document the
   unread fields; decide `internal-history-suggest`'s fate.
5. **Treat frecency bucket weights as calibration, not settled design** — R4 ruled
   leave-as-shipped after the HAT ranking-feel review passed; recorded.

## Action Items

- [ ] Add sheet-layer tests pinning the single-focus-site and Ch7-before-Ch6 invariants.
- [ ] Add the AUTHORING.md notes (data-lifecycle seeds; real-pipeline fixtures; judge
      sheet visibility from pixels).
- [ ] Confirm R1 (select-all) and R2 (record search-fallthrough) dispositions landed in
      Flight 6.
- [ ] Low-priority: honest error close reasons; prune unread suggestion fields.
