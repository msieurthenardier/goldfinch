# Flight Debrief: Floating Overlay Find Bar

**Date**: 2026-07-02
**Flight**: [Floating Overlay Find Bar](flight.md)
**Status**: landed
**Duration**: 2026-07-01 (planning) – 2026-07-02 (execution + landing; single execution day)
**Legs Completed**: 4 of 4 (3 autonomous + guided HAT; HAT 12/13 steps, DPR≠1 skipped/not-run)

## Outcome Assessment

### Objectives Achieved

The flight delivered its full objective: the inset (push-down) find bar is replaced by a floating
overlay `WebContentsView` stacked above the live guest. Float-not-inset, position-sync
(panel/resize/maximize/tab-switch), DD7 internal-tab exclusion, DD5 freeze-hide/restore, per-tab
restore with live-typed text, and focus semantics all shipped and verified three ways: guided HAT
(operator, physical input), the `find-overlay-geometry` Witnessed run (PASS 6/6 on
independently-inspected pixels; spec promoted to `active`), and the a11y gate (green, 6-state sweep).
The chrome `#find-bar`, the guest inset machinery, and the `tab-found-in-page` fan-out are fully
retired. `main` untouched; merged to `mission/05` at `d5a8f0f`.

**Bonus outcome beyond scope**: the HAT surfaced an edit-after-Enter defect (HAT-1) whose root cause —
Electron's `findNext` option semantics inverted relative to the `<webview>`-era reading — turned out to
be pre-existing (A/B-proven on the pre-flight baseline) AND the root of the longstanding WSLg find
cold-start blank-count family carried in mission Known Issues since M04. The fix (`e5daeca`) resolved
both: the count now populates from the first character, operator-confirmed.

### Mission Criteria Advanced

- **SC4 (conveniences parity, UX enhancement)** — the find surface is now strictly better than
  pre-migration (floats instead of insetting; cold-start fixed). Not a landing gate; delivered anyway.
- **SC2 discipline reaffirmed** — every geometry claim was accepted on rendered pixels, never DOM
  reads, per the mission's "DOM-correct ≠ render-correct" rule.
- All four flight checkpoints met.

## What Went Well

- **Recon + citation discipline (zero drift)**: the flight-planning recon locked line-numbered
  integration points; every leg re-verified citations against the live tree at design time (15/17/30+
  citations across legs, one two-line range repair total). No implementing agent ever chased a stale
  reference.
- **Per-leg design reviews earned their cost**: 4 reviews caught 1 HIGH (unconditional close-refocus
  that would have stolen OS focus onto a hidden view during tab-strip keyboard nav — and would have
  carried into the cutover), ~9 mediums, and a false-failure trap in the HAT checklist (missing
  cold-start disposition). Every catch was pre-implementation. The Architect's assessment: the per-leg
  design review is the right place for semantic correctness; the batch review for cross-leg
  consistency and security.
- **The disposable dev-gate staging technique**: `GOLDFINCH_FIND_OVERLAY_DEV` made Leg 1's lifecycle
  exercisable without routing, narrowed to a stimulus gate in Leg 2, deleted at cutover. Clean
  three-leg staging of an architectural primitive ahead of its real input wiring — reusable.
- **Batch review + single commit** fit the tight inter-leg dependencies; the flight-wide Reviewer
  (fresh context) independently re-verified the security properties (sender validation, internal
  exclusion, no automation-surface widening, teardown paths) with zero fix cycles.
- **Live apparatus quality**: the probed-wcId technique made the overlay directly drivable (real
  keystrokes, DOM corroboration) despite being non-enumerable; the Witnessed run's evidence bar
  (Validator personally inspects every pixel claim) held throughout.
- **The HAT caught what automation couldn't**: HAT-1 required a physical keyboard and human intent
  ("edit the term after stepping") — exactly the class of check the HAT leg exists for. The inline
  fix loop (diagnose → isolated-instance A/B → fix → re-verify) closed it same-session.
- **Test metrics healthy**: 953/953, +6 tests (all the new geometry suite, ~38ms), no suite
  regressions, no flakes; typecheck/lint clean. Wall-clock ~5.0s, dominated (~4.35s) by
  `automation-find`'s deliberate timer tests — unchanged this flight.

## What Could Be Improved

### Process

- **Information-flow completeness at flight design (the flight's one real design gap)**: DD4's channel
  set was incomplete — the two main→chrome sync channels (`find-overlay-text`,
  `find-overlay-closed`) follow *logically* from DD9's "per-tab state stays in the renderer" once
  typing/Esc move into the overlay, but were only discovered at Leg-3 design. A design-time check —
  "for each state owner, does every mutation site have a feedback path?" — would have surfaced them.
  Same class: the a11y apparatus-reachability constraint (overlay not axe-injectable) was knowable at
  planning but discovered at Leg 3.
- **Parity is not a correctness predicate**: HAT-1 was carried into the overlay as *faithful parity*
  with a defective original. When an AC says "matches pre-migration behavior," the review should also
  ask "was the pre-migration behavior correct?" — especially for API option semantics crossing the
  `<webview>` → `WebContentsView` boundary.
- **Agent process isolation**: a Developer agent's cleanup `pkill` matched the shared Electron command
  line and killed the operator's live HAT instance (disclosed, no data lost). Crew protocols must
  mandate PID-scoped kills whenever parallel instances run.
- **Witnessed-run re-spawn protocol validated**: the Executor context loss before step 7 was recovered
  cleanly because the re-spawn prompt carried a precise CURRENT-STATE block — worth codifying as
  mandatory in the behavior-test skill's context-loss handling.

### Technical

- **CSS token duplication**: `find-overlay.css` hard-codes seven theme tokens duplicated from
  `styles.css :root` (structural — standalone document); two-location maintenance if the theme evolves.
- **Find-overlay subsystem size**: ~250 lines / 8 module-level state vars / 7 helpers now live in a
  2085-line `main.js`. A `find-overlay-manager.js` extraction is a natural maintenance candidate (the
  module-level-is-load-bearing constraint survives an imported singleton).
- **`onInit`/`onCount` lack the internal-preload handle-cleanup pattern** — harmless today (crash
  teardown rebuilds the whole view), a latent leak if the overlay ever gains a reload path.
- **Untested edges (documented, accepted)**: `render-process-gone` recovery is code-reviewed only;
  DPR≠1 not producible on this rig; Witnessed run exercised only the kebab freeze trigger (HAT covered
  all three on-screen).

### Documentation

- CLAUDE.md should gain the patterns this flight proved (see Recommendations 3).
- `find-in-page.md`'s WSLg cold-start caveat is now stale for the human bar (root-caused + fixed); the
  automation op's own retry-path caveat stands until separately re-verified.
- CLAUDE.md's "overlay is not MCP-addressable" wording is accurate for enumeration but misleading for
  direct addressing — nuance to "not enumerable via `enumerateTabs`; directly addressable by probed
  wcId for test driving."

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Env-var dev gate: blanket (L1) → stimulus gate (L2) → deleted (L3) | Make each leg independently verifiable pre-cutover | **Yes** — reusable staging technique for primitives built ahead of their input wiring |
| chrome-preload bridge methods moved from Leg 2 to Leg 3 | Ship bridge methods with their consumers; avoid dead surface at review | **Yes** — "bridge-with-consumers" as default |
| Two sync channels added at Leg-3 design (not in flight DD4) | DD9's invariant demanded a feedback path once input moved into the overlay | **No** — this was a design gap; standardize the *information-flow completeness check* instead |
| Sender-resolved close refocus (no payload flag) | Two semantically distinct close paths; sender identity is unspoofable | **Yes** — pattern for any dual-close-path overlay/popup |
| a11y audit find-bar state removed (DD12 letter unmet) | Overlay webContents not axe-injectable by construction | **Yes** (apparatus-honest) — but name reachability constraints at design time |
| Draft-PR step superseded by local mission-branch merge | Mission's long-running-branch model (Flights 2–4 precedent) | Already standing for this mission |
| HAT fix committed mid-leg (`e5daeca`), no amend | HAT protocol: fix inline, new commits | Already the rule; worked |

## Key Learnings

1. **Parity inheritance carries defects silently.** The migrated code faithfully reproduced an
   inverted API reading because the original had it too. Migration ACs need parity *plus* a spot-check
   of the underlying API contract.
2. **Hidden ≠ destroyed is an observable-taxonomy trap.** The overlay's DOM persists across close (by
   design: lazy singleton, reset-on-next-open) — so a DOM probe can never serve as a "find is closed"
   observable. Pixels are the only closed-state authority. Generalizes to any reused native view.
3. **Absence-authoritativeness**: an overlay-absence pixel check is only meaningful when a same-run
   grab has shown the overlay compositing on the active capture path. The Witnessed run turned this
   from a per-step judgment call into a mechanical rule — worth codifying in the spec.
4. **Sender identity beats payload flags** for IPC actions with actor-dependent semantics.
5. **The freeze-frame follow-on should be reframed**: the overlay primitive is proven, but replacing
   four transient HTML menus with native views would be architecturally expensive. First investigate a
   cheaper "pause guest hit-testing" native mechanism; treat menus-as-overlays as a fallback design
   option, not a committed direction.

## Recommendations

1. **Adopt parity-plus-correctness for the remaining migration flights, with a concrete sweep**: audit
   other `<webview>`-era Electron option semantics carried across the boundary — `stopFindInPage`
   action values, `sendInputEvent` type strings, zoom level/factor semantics, and the full
   `webPreferences` object at tab construction. Fold into Flight 5 (automation parity sweep) or
   Flight 6 planning as a checklist item.
2. **Add a PID-scoped-kill isolation rule to `.flightops/agent-crews/leg-execution.md`** (and the
   mission-control default): agents running app instances alongside an operator session must kill by
   PID, never by command-line pattern.
3. **CLAUDE.md pattern additions** (one section, five entries): the Electron `findNext` inversion +
   the `findOverlayLastQueryText` adapter; the pending-init queue for lazily-loaded WebContentsView
   first-load races; sender-resolved close refocus; the Electron-free unit-testable module pattern
   (`find-overlay-geometry.js` as template); the rule "WebContentsViews not in `tabViews` are
   invisible to the automation surface — a design choice to document at construction" + the
   enumerable-vs-addressable nuance.
4. **Apply the four spec errata to `find-overlay-geometry.md`** (probe-direction "around" not "above";
   step-2 pixel-tolerance band ≤5px/>10px; menu DOM-bracketing technique; DOM-anchored control
   location) plus the absence-authoritativeness rule and an optional final reopen-check asserting the
   reset-on-next-open contract.
5. **Update `find-in-page.md`'s cold-start caveat** to record the root cause + fix for the human bar,
   keeping the automation op's caveat standing until its retry path is re-verified on the new
   semantics (Flight 5 candidate).
6. **Maintenance candidates** (roll into the end-of-mission maintenance flight, not fixed now):
   `find-overlay-manager.js` extraction; `onInit`/`onCount` handle-cleanup if a reload path appears;
   CSS token consolidation strategy if theming evolves.
7. **macOS HAT additions for Flight 6 landing**: overlay float + position-sync + DPR≠1 + traffic-light
   coexistence, joining the standing internal→new-tab item.

## Action Items

- [ ] Flight 5/6 planning: `<webview>`-era option-semantics sweep checklist (Rec 1)
- [ ] `.flightops/agent-crews/leg-execution.md`: PID-scoped-kill rule (Rec 2) — also propose upstream
  to mission-control defaults
- [ ] CLAUDE.md: pattern section (Rec 3)
- [ ] `tests/behavior/find-overlay-geometry.md`: spec errata (Rec 4)
- [ ] `tests/behavior/find-in-page.md`: cold-start caveat update (Rec 5)
- [ ] Mission Known Issues: mark the WSLg find cold-start family RESOLVED for the human bar
  (automation-op re-verify pending, Flight 5)
- [ ] Flight 6 planning: macOS HAT additions (Rec 7); maintenance-flight candidates recorded (Rec 6)
- [ ] Mission-control methodology (upstream): mandatory CURRENT-STATE block in Witnessed-run re-spawn
  prompts; information-flow completeness check in the flight skill's design phase

## Skill Effectiveness Notes (for the mission debrief)

- **`/flight` skill**: worked well; would benefit from an explicit "information-flow completeness"
  prompt when a design moves input/ownership across process boundaries (the DD4 gap).
- **`/leg` skill**: citation-audit discipline again prevented all drift; the immutability +
  design-review loop caught a HIGH pre-implementation.
- **`/agentic-workflow`**: batch mode (design-review per leg, one code review + commit) fit this
  flight; the interactive-HAT protocol (fix inline, new commits) absorbed a real defect smoothly.
- **`/behavior-test`**: live two-agent mode + evidence-for-pass rule produced high-trust verdicts; the
  context-loss re-spawn protocol worked — codify the CURRENT-STATE block as mandatory.

## Operator Notes

Operator elected to skip the human interview (flight log deemed comprehensive); confirmed flight completion 2026-07-02.
