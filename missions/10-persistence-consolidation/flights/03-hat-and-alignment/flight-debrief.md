# Flight Debrief: HAT & Alignment

**Date**: 2026-07-18
**Flight**: [HAT & Alignment](flight.md)
**Status**: landed
**Duration**: 2026-07-18 (single operator session)
**Legs Completed**: 1 of 1 (interactive walkthrough)

## Outcome Assessment

### Objectives Achieved

The mission closed under real operator eyes: TC1 (real-profile migration
fidelity) and TC2 (cookies panel) PASS; four operator findings became
same-session riders (cookie value reveal — with its own design review;
live tab counts — one review cycle returning not-ready + FD revision;
icon refresh; retention control relocated out of its M08 fossil position);
one finding became a BACKLOG seed (site-data inspector, with the operator's
vision statement and the measured feasibility ceiling recorded). Stations
A/B/C discharged: PRs #96/#98 merged (+ operator-directed dependabot
#73/#95, 0.10.1 bump, no tag, issue #94 closed); keys rotated by the
operator with the old key verified refusing (HTTP 401); NUL-delimiter fix
landed. All 8 mission criteria checked. Suite 2123/2123 across three
debrief runs, zero flakes; typecheck/lint clean at HEAD.

### Honest dispositions (the debrief's own correction included)

TC5/TC6/Station E closed on real prior machine-witnessed evidence.
**TC8 (cookie-removal-by-age) is closed procedurally, NOT substantively**
— the Architect interview pushed back on the FD's original "unit + gate
coverage" wording: the F2 gate witnessed storage/history age-removal, not
cookies (that clause was the gate's honest FAIL); the true coverage is
unit tests + analogy to the sibling sweep. Corrected in the flight log
and mission.md; a cheap live spot-check (one jar at 1-day retention,
checked a day later) carries forward as a standing open item. Two Station
D items (orphan self-heal, real-profile site-data diversity) were folded
into the general UX read rather than individually dispositioned — named
here rather than absorbed silently.

## What Went Well

- **The HAT surfaced exactly what agent eyes couldn't**: every operator
  finding was a comprehension/presentation gap (unexplained panel,
  misleading retention placement, missing counts, value transparency) —
  none were correctness bugs. Two missions of implementation rigor showed
  up as a UX-only HAT.
- **Fix-vs-feature taxonomy held** (Developer interview verified all six
  calls against the diffs); the two FEATURE riders' reviews earned their
  cost (the tab-counts cycle-1 "not ready" caught a premise error about
  History's actual count trigger and rejected a bad DD2 justification).
- **Station B validated the codified key-handling default**: the operator
  performed the rotation directly; the key never transited the session;
  revocation verified live by the old registration's 401.
- The flat station checklist absorbed operator-added scope (dependabot,
  issue closure, version bump) without ceremony — DD1's "operator
  reshapes the session live" working as designed.

## What Could Be Improved

- **The multi-surface review trigger tracked the fix/feature LABEL, not
  the footprint** (Developer interview): the retention-move rider
  transplanted stateful logic across three files + CSS + docs, and the
  refresh-icon rider restructured DOM ownership across two modules — both
  structurally comparable to the reviewed riders, both shipped inline
  with zero review because they were tagged FIX. No regression resulted
  (inspection + 3× clean suites), but the protocol's own criterion says
  footprint, not label. Methodology fix for mission-control.
- **Raw review verdicts should be preserved, not just FD summaries**: the
  tab-counts cycle-1 verdict exists only as the FD's narrative in the
  flight log — not independently auditable from committed artifacts.
- **`jar-ipc.test.js` worsened again**: 906ms → 1440ms own-time (+59%) —
  the value-reveal matrix landed on the expensive real-file harness. The
  fixture conversion is now **thrice-earned** (F1, F2, F3) and escalates
  in priority at routine maintenance.
- **The count-fetch trigger quietly extended a full-jar-set enumeration
  pattern onto panels DD2 had deliberately bounded** (Architect): not a
  violation (list views stay gated; History precedent real), but a
  design tradeoff inherited by extension rather than re-examined — flag
  as an open architectural question (lazy/visible-only counts?) if jar
  counts grow.
- The single-flat-checklist HAT shape worked because the surprises stayed
  rider-sized; its resilience against an M09-style "this needs its own
  flight" surprise was never tested. Keep M09 F10's escalation path in
  mind for future HATs.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Stations reordered (tests before merges) | Operator asked to walk test cases first | Yes — merge-after-acceptance is arguably the better default |
| TC5/TC8 not operator-witnessed | Operator election, anticipated by the plan | Honest-disposition path worked; keep the substantive/procedural distinction explicit |
| Merges performed by FD | Operator's explicit instruction lifted the classifier block | Fine with explicit authorization |
| TC8 disposition re-worded at debrief | Architect caught coverage overstatement | Yes — debrief-corrects-the-log is the system working |

## Recommendations

1. **[Important — mission debrief]** Promote the key-handling rule to
   standing methodology text (three incidents, two missions, thrice
   recommended — now overdue); include the "hand keyed gates to the
   operator" default that Station B just validated.
2. **[Important — routine maintenance]** jar-ipc fixture conversion
   (thrice-earned, now measurably worse); persistence-cluster timing
   check against F2's baseline; IndexedDB-dirname re-verify as an
   Electron-bump standing tax.
3. **[Important — mission debrief]** Carry TC8's live spot-check as a
   standing open item; carry the god-file debt line (confirmed untouched
   through M10 — not worsened, not reduced).
4. **[Minor — methodology]** Multi-surface review trigger evaluated on
   footprint, not label; preserve raw review verdicts in flight logs.

## Test Suite Metrics

2123 / 0 / 0 across three runs at HEAD `a5084f1`, no flakes; wall
2.45-2.74s (machine variance vs F2's 1.94s noted; the reproducible
component is jar-ipc's 906→1440ms own-time growth). +7 tests vs F2, all
in the value-reveal validation matrix.
