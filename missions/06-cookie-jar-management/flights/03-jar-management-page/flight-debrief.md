# Flight Debrief: Jar Management Page

**Date**: 2026-07-10
**Flight**: [Jar Management Page](flight.md)
**Status**: landed
**Duration**: 2026-07-10 (designed, executed, and landed in a single day)
**Legs Completed**: 6 of 6 (01-page-bridge-and-scaffold, 02-page-crud-interactions,
03-chrome-entry-and-delete-integration, 04-popup-inheritance-and-forwarder,
05-verify-integration, 06-hat-jar-management)

## Outcome Assessment

### Objectives Achieved

The flight delivered its full charter and then some. `goldfinch://jars` exists as
the third internal special page: live jar list with color dots and the Default
pill, a static uncontrollable Burner row, create with a curated palette,
rename/recolor, set-default, and delete behind an in-page confirm — all propagating
live in both directions (page↔picker↔tabs) over the `jars-changed` broadcast.
Deleting a jar closes its open tabs via the ordered sweep (mission criterion 4's
firm requirement), popups inherit the opener's jar with burner openers minting
fresh burners (DD7), and guest-focus accelerators are forwarded through one
classifier-driven forwarder with per-guest-kind allowlists (DD8) — retiring three
mission Known Issues in one flight. The internal jar IPC bridge fulfills Flight 1
DD7's deferral exactly as specified (origin-gated twins in jar-ipc.js).

Three commits (`7461346` legs 1-4, `3fb3d9c` leg 5, `6de9b30` HAT + landing),
suite 1154 → **1242**. Three behavior tests, **18/18 checkpoints** across three
independently staged fresh-profile runs — `jar-delete-closes-tabs` 5/5 (first
run), `popup-jar-inheritance` 5/5 (first run), extended `new-tab-default-routing`
8/8 with the new second-jar-no-claim falsification control. The HAT ran 8 steps
with **seven inline findings fixed and re-verified** (F1-F6 UI polish; F7 the
operator-specced automation-indicator rework), plus operator-witnessed
housekeeping (`containers.json.v1.bak` deleted).

F7 deserves its own line: the toolbar robot now appears whenever ≥1 automation
key is enabled (count-badged), gray when idle, the active jar's color when one
jar is connected, rainbow only for an active admin key — and implementing it
uncovered and fixed a real latent bug (three of four key-mutating IPC handlers
never broadcast `settings-changed`; only mint did).

### Mission Criteria Advanced

- **Criterion 1 (page reachable, lists jars with name/color/default)** — MET
  (kebab + picker entry points; HAT step 1; boot smoke).
- **Criterion 2 (create → immediately usable, no restart)** — MET (HAT step 2;
  live propagation witnessed).
- **Criterion 3 (rename/recolor propagates, data preserved)** — MET (HAT step 3;
  `jars-rename`/`jars-set-default` now renderer-proven, closing F1's carry-flag).
- **Criterion 4 (delete: confirm, wipe, TABS CLOSE, disappears everywhere)** —
  MET (behavior-tested 5/5 + HAT step 5).
- **Criterion 5 (exactly-one-default; flag movable from the page)** — MET
  (routing half landed F2; the page half HAT step 4 + routing spec 8/8).
- **Criterion 6 (Burner list identity, no controls)** — list-identity half MET
  (HAT step 1); behavioral halves landed F2.

## What Went Well

- **The review pipeline caught three unimplementable-or-destructive premises
  before any code ran** — the flight's standout. (1) DD6's "suppress the per-call
  fallback" assumed a `closeTab` hook that doesn't exist; the reviewer's trace
  proved the naive loop correct-but-flickery, and the FD's ordered-sweep ruling
  (survivor pre-activation → non-active orphans → active orphan last) shipped
  with zero `closeTab` surface change after a scoped cycle-2 review verified it
  line-by-line. (2) Leg 5's shared-instance staging would have destroyed the seed
  jars the second and third behavior specs' preconditions require — replaced with
  per-run fresh staging. (3) Leg 2's "PALETTE d.ts/eslint entries optional" was
  empirically disproven by the reviewer failing both gates live. Three premise
  corrections across six legs, none survived into implementation.
- **Behavior tests: three specs, three fresh stages, 18/18 first-attempt
  checkpoints, zero inconclusive.** Every Validator verdict cited evidence files
  read directly; identity-based assertions (wcId gone-ness, exact-string burner
  distinctness) made the closure and never-share-state claims strong. The
  extended routing spec's step-8 control (add-into-non-empty must NOT move the
  flag) is a falsification pair worth reusing.
- **The house pure-module pattern held under an UNPLANNED addition** — F7's
  `automation-indicator-model.js` arrived mid-HAT and still landed as a clean
  dual-export truth-table-tested module (18 tests incl. defensive branches),
  alongside the planned `jar-page-model.js` and `guest-forward-allowlist.js`.
- **F7's wiring caught a real latent bug nothing else would have**: the
  revoke/admin-mint/admin-revoke handlers violated the project's own
  broadcast-on-mutation convention; the indicator would have gone stale on
  revoke. Fixed to match mint.
- **The HAT earned its keep beyond acceptance again**: seven findings, a live
  operator ruling stream (divider/labels/icons/description placement), two
  operator catches on my own demo narration (still-rainbowing → led to a live
  disconnect-state verification; missing single-jar-color state → led to a
  jar-key-connection demonstration), and the fidelity review's whitespace-name
  step gave a zero-machine-witness code path its only live exercise.
- **Recon discipline compounding**: the F2 debrief's grep-scope rule was applied
  at first pass; the recon table retired one item with cited evidence
  (`jars-changed` already reached internal sessions) instead of re-plumbing it.

## What Could Be Improved

### Process

- **F7 is the headline: a net-new feature rode the HAT's guided-fix protocol
  with ZERO design-review cycles** (both interviews flagged it independently).
  F1-F6 were look-and-feel fixes — the protocol's intended scope. F7 changed
  indicator visibility semantics, touched main.js broadcast paths, widened a
  preload signature, and added animated CSS states, verified only by operator
  narration during a live demo; one of its four output states (`multi`) was
  witnessed only as absence-of-objection, never deliberately forced. It landed
  clean, but the flight's own history contains the right mechanism it didn't
  invoke — the scoped-review precedent (Leg 3's cycle-2 on the DD6 block alone).
  **Standing fix: operator-specced features arising mid-HAT get explicitly
  promoted to a mini-leg with a scoped design review before implementation; the
  fix-vs-feature line is the FD's call to make out loud.** (Also filed as
  methodology feedback for the agentic-workflow skill's HAT protocol.)
- **DDs kept asserting mechanisms a five-minute trace would have ruled out**
  (suppression hook, `openDownloads` dedupe guard, shared staging fixture).
  Design review absorbed all three, but each cost a cycle. When a DD leans on a
  precedent's capability ("suppress", "match its dedupe"), verify the hook
  exists at DD-authoring time — especially for any "this security posture is
  NOT relaxed" claim (DD9's citation pointed at a nonexistent path while its
  conclusion was right; Flight 5 inherits that pointer).

### Technical

- **Untested-interaction inventory carried explicitly** (none blocking, all
  behind documented rationale, all unreachable by the apparatus per DD9):
  `reconcileUi`'s cross-surface race (row deleted elsewhere while its editor is
  open) has zero live witness; Escape-dismiss was human-exercised only against
  confirm-delete (create/edit share the code path but weren't independently
  triggered); the indicator's `multi` mode; the boot-time subscribe-before-read
  race (comment-asserted only). Flight 4's HAT should deliberately exercise the
  first two; a multi-connection behavior test should pin the third when Flight
  4/5 touches automation.
- **The eslint-globals + d.ts onboarding step recurred 4-for-4** as an
  "accepted deviation" (buildJarPageModel, PALETTE, inheritFromPartition,
  buildAutomationIndicatorModel). Promote it from recurring deviation to a
  documented step in the leg template / CLAUDE.md pattern note.
- **Third flight, third instance of the classic-`<script>` shared-scope class**
  — but this time handled PROACTIVELY (Leg 1 shipped the self-deriving
  jars-page vm net before any defect, vs F1/F2's reactive nets). The mitigation
  is maturing; the architectural root cause stands. The ES-module conversation
  (F1 rec, F2 rec) remains queued for the post-M06 routine maintenance —
  escalate it there with three data points.

### Documentation

- CLAUDE.md's new pattern note (DD10, shipped this flight) documents the module
  patterns but not the onboarding checklist above — one paragraph short.

## Test Metrics

`npm test`: **1242 / 1242 pass, 0 fail, 0 skip, 0 flakes** (single debrief run;
internal duration ~5.06s, /usr/bin/time wall 5.18s). typecheck/lint clean.

**Trajectory**: M05 F9 1050 → F1 1132 (~5.06s) → F2 1154 (~5.05s) → **F3 1242**
(+88, the largest single-flight jump: +26 bridge/page-model/vm-net, +5 PALETTE,
+1 container-menu, +37 inheritance/allowlist/classifier pins, +18 indicator
truth table, +1 divider pin). Wall-clock still flat.

**Wall-clock root cause finally named** (Developer interview isolated all 54
files): `automation-find.test.js` runs ~5.02s in ISOLATION — three tests use
real `setTimeout` waits (~4.6s combined; untouched since an earlier mission).
Under the runner's file parallelism, that one file IS the suite's wall-clock
floor; every other file finishes in 40-800ms. Three flights of "flat ~5.05s" is
that file's timer budget, NOT general slack — do not misread flatness as
headroom. Mocking those three timers would likely cut the suite to ~1-2s.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| DD6 ordered-sweep replaced "suppress the fallback" (leg 3 review + scoped cycle 2) | No suppression hook exists; naive loop correct but IPC-flickery | Yes — ordering (pre-activate survivor, close active orphan last) is the pattern for tab-lifecycle sweeps; also: FD-authored design deltas get scoped re-review |
| Two-commit flight shape (review/commit after leg 4; leg 5 verified against a committed baseline, own scoped review + commit) | Behavior tests and boot smoke should run against committed state | Yes — for flights with a verify leg after implementation legs |
| Per-run fresh staging for behavior tests (leg 5 review) | First spec's destructive steps invalidate later specs' preconditions on a shared instance | Yes — one stage per run, FD-staged, torn down after; no cross-agent credential handoff |
| F7: net-new feature implemented inside the HAT with no design review | Operator specced it live and chose "implement now" | **No** — formalize the mini-leg promotion gate instead (see Process) |
| eslint/d.ts onboarding for each new shared global (×4) | Both gates hard-fail without it; classic scripts need bare globals | Yes — promote to a documented leg-template step |
| Leg 1 implementer respawn mid-leg (server 529) with working-tree inventory before trusting prior edits | API outage; partial edits untrusted until verified | Yes — the recover-by-inventory pattern worked cleanly |

## Key Learnings

1. **Design review is cheapest exactly when a DD asserts a precedent's
   capability** — three unimplementable/destructive premises died at the design
   table this flight; all three were "does X have a hook/guard/fixture for
   this?" questions answerable by a short trace at authoring time.
2. **HATs generate features, not just fixes and rulings** — F2 produced a
   semantics ruling (D3); F3 produced a full feature (F7). The guided-fix
   protocol needs an explicit promotion gate before the next one arrives.
3. **Per-run fresh staging is the behavior-test standard** — destructive specs
   make shared fixtures a category error; three stages cost minutes and bought
   18/18 with zero cross-contamination.
4. **Flat wall-clock was one file's timer budget** — a metrics trend three
   debriefs accepted as "overhead dominates" had a specific, fixable cause found
   by per-file isolation. Isolate before extrapolating.
5. **The apparatus boundary (DD9) worked as designed** — the split held
   end-to-end: machine gates covered everything store-visible; the HAT covered
   exactly the page-DOM remainder, including one path (whitespace names) whose
   ONLY witness is human by construction.

## Recommendations

1. **Adopt the mini-leg promotion gate for mid-HAT features** (FD protocol):
   fix = inline; feature = scoped design review first, then implement, still
   within the HAT session. File the same as methodology feedback for
   mission-control's agentic-workflow HAT section.
2. **Flight 4 design inputs**: reuse the page's proven idioms (swatch grid,
   `ui.mode` exclusivity, in-page confirm, F6 icon-button convention) for data
   controls; deliberately exercise the `reconcileUi` cross-surface race and
   create/edit Escape paths in its HAT; consider the cookie-cross-check variant
   to pin burner storage isolation (Validator carry-forward).
3. **Add a self-deriving broadcast-invariant net**: "every settings-mutating IPC
   handler broadcasts `settings-changed`" — the F7-found bug class, greppable
   with the chrome-shared-scripts technique, so the next gap doesn't wait for a
   feature to need the broadcast.
4. **Flight 5 inputs**: the DD9 internal-page automation boundary decision is a
   security design conversation with a ready-made motivation list (the untested
   inventory above + F7's live-activity wiring having HAT-only coverage);
   fold the Validator spec carry-forwards (settle-then-recapture codified,
   burner-id distinctness, popup-spec step-0 baseline wording) into its
   behavior-test sweep.
5. **Mock the three real-timer tests in `automation-find.test.js`** at the next
   maintenance window — likely cuts suite wall-clock ~60-75% and stops the
   flat-trend illusion; pair with the standing ES-module conversation (three
   flights, three shared-scope instances, mitigation maturing but root cause
   untouched).

## Action Items

- [ ] Flight 4 design: fold in Recommendation 2 (idioms + untested-inventory
      HAT steps + cookie-cross-check candidate).
- [ ] Flight 4/5 planning: Recommendation 3's broadcast-invariant net.
- [ ] Flight 5 design: Recommendation 4 (DD9 boundary as security design; spec
      carry-forwards).
- [ ] Next routine maintenance: Recommendation 5 (timer mocks + ES-module
      conversation, now with the wall-clock root cause named).
- [ ] Mission-control methodology: Recommendation 1 (HAT fix-vs-feature gate).
- [ ] CLAUDE.md next touch: add the eslint/d.ts onboarding checklist paragraph
      to the pattern note.
