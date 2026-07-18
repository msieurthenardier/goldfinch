# Mission Debrief: Persistence Consolidation

**Date**: 2026-07-18
**Mission**: [Persistence Consolidation](mission.md)
**Status**: completed
**Duration**: 2026-07-17 – 2026-07-18 (two days, largely autonomous)
**Flights Completed**: 3 of 3

## Outcome Assessment

### Success Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| Five surfaces on the shared substrate, no-loss migration | **Met** | Live-witnessed (gate 6/6) + operator TC1 on the real profile |
| Corrupt/missing DB never bricks boot | **Met** | Machine-witnessed twice (gate checkpoint 7 + unit quarantine suite) |
| Store discipline incl. shields uplift | **Met** | Architect-verified uniform 5/5 at mission close |
| Cookies panel with per-cookie delete | **Met** | Operator TC2 PASS + gate; HAT added value-reveal, counts |
| Site-data panel with per-origin delete | **Met** | Honest two-tier mechanism; usage refused (API absence); operator UX findings addressed |
| Retention governs cookies + site data | **Met, one clause procedurally** | Storage/history half live-witnessed (gate); cookie-age half unit-covered + analogy — live spot-check carried as a standing open item (see below) |
| DD1 re-affirmed + docs current | **Met** | Widened-tax text in CLAUDE.md; BACKLOG seed retired |
| safeStorage codec seam survives | **Met** | Seam untouched through all conversions (reviewer-verified) |

### Overall Outcome

Issue #94 delivered in full and closed. Goldfinch's two-substrate era is
over: one storage discipline, one quarantine story, one retention dial per
jar governing history, cookies, and site data — with the jars page finally
answering "what does this identity know about me." Delivered as v0.10.1 on
main (no release cut, per operator). Suite 1973 → 2123, zero failures,
zero flakes across every measured run. The operator's HAT verdict
surfaced only comprehension/presentation findings — zero correctness
bugs reached human eyes.

## Flight Summary

| Flight | Status | Key Outcome |
|--------|--------|-------------|
| F1 SQLite store consolidation | completed | 5 stores + migration + quarantine; gate 6/6; "unusually high plan-to-code fidelity" |
| F2 Jar data surfaces + retention | completed | Spike-gated panels + sweeps; gate 6/7 with one honest structural FAIL → spec amended |
| F3 HAT & alignment | completed | 4 operator findings → same-session riders; 1 BACKLOG seed; merges, rotation, honest dispositions |

## What Went Well

- **The review lattice caught real bugs before they shipped, repeatedly**:
  the never-throw boundary (F1 leg 1 HIGH), the 59-test blast radius and
  shields pre-load contract (F1 leg 2), the missing activation seam and
  origin-normalization error (F2 leg 2), and above all the
  snapshot-before-prune SEQUENCING bug (F2 leg 3 "needs rework") that
  would have shipped a functionally inert storage sweep. Risk-tiered
  cycles tracked actual catches (0/1/1, then 0/1/2).
- **Spike-first earned its cost with underivable findings**: CDP's total
  absence, localStorage's non-attributable store, the cookie
  overwrite/removed event pair, the `_0` default-port dirname sentinel
  (the last caught by the extended smoke check the leg review demanded).
- **The Witnessed pattern rendered honest verdicts against working code**:
  the F2 gate's cookie-clause FAIL (structurally unobservable cold-start)
  was confirmed independently by both agents reading the mechanism, then
  dispositioned by spec amendment rather than a stretched pass. The F3
  debrief then corrected the FD's own too-generous closure wording —
  the system auditing itself.
- **Operator interview**: the mostly-autonomous execution with an
  operator-HAT close "is an emerging pattern I'd like to continue" — now
  the twice-run standing shape (M09, M10); the one-step-at-a-time HAT
  rhythm "works".

## What Could Be Improved

- **Key handling failed three times across two missions, same class**
  (transcript-print with bad redaction; briefed launch-command capturing
  key-bearing stdout into evidence; redaction destroying the only copy).
  Every debrief since M09 F10 has recommended codifying the fix; it is
  now **overdue** — see Methodology Feedback. The validated defaults:
  keys move only as function arguments through the project's own client
  library; launch stdout goes to a private path with any evidence copy an
  explicitly redacted derivative; keyed gates handed to the operator
  where possible (Station B proved it).
- **Spec premise-audits must check the flight's own prior DD text**: the
  cold-start cookie clause was already recorded at leg 1 and still
  reached the live gate unapplied at leg 3's spec finalization. Rule:
  when a spec premise depends on "this table has existed a while" and the
  table ships in the same flight, audit time-zero for every row the
  feature touches.
- **The multi-surface review trigger tracked the fix/feature label, not
  the footprint** (two structurally multi-file HAT riders shipped
  review-free because they were tagged FIX). No regression resulted;
  the criterion needs restating as footprint-based.
- **Thrice-recommended, still unactioned**: `jar-ipc.test.js`
  shared-fixture conversion (906→1440ms own-time across the mission, the
  suite's slowest; the file itself doubled to 658 lines — the next
  god-file candidate to watch).

## Lessons Learned

- Cold-start is a whole-population property, not a fixture property.
- Two mechanisms consuming one shared aging signal need an explicit
  ordering constraint at DD-writing time (snapshot-before-prune).
- A read-back through the project's own SDK beats any hand-rolled
  keyed-transport mechanism (the F1 run's Executor refusal → better
  mechanism loop).
- Literal NUL bytes make a source file binary to git — invisible in
  editors, fatal to diff review.
- "Usage" figures you can't honestly compute are better refused than
  approximated (operator accepted the absence without comment).

## Standing Items Carried Forward (explicitly OPEN, not closed)

1. **Cookie-removal-by-age live spot-check**: set one jar to 1-day
   retention, return a day later, watch an aged cookie vanish. Cheap;
   substantively unwitnessed today (unit + sibling-sweep analogy only).
2. **Passive watches**: orphan-row self-heal on real profiles; the
   site-data two-tier UX against genuinely diverse real-world data.
3. **Routine-maintenance queue**: jar-ipc fixture conversion
   (thrice-earned, escalated); persistence-cluster timing vs the F2
   baseline (~3.5-3.7s own-time); consolidate the standing taxes into
   ONE CLAUDE.md section and give the IndexedDB-dirname format its
   promised "re-verify on Electron major bump" trigger (the BACKLOG
   42→43 entry still names only node:sqlite); god-file debt (main.js
   +3.2% wiring-only this mission — not worsened, not reduced, carried
   since M09).
4. **BACKLOG seeds planted**: site-data inspector (operator vision:
   non-technical users see exactly what a site stores).

## Methodology Feedback (for mission-control)

1. **[Overdue — promote to standing text] Key-handling rule**: never
   print a key-bearing stream, even "redacted"; extract fields with
   jq/node; keys as function arguments only; private launch-log paths
   with redacted evidence derivatives; prefer handing keyed gates to the
   operator. Three incidents, two missions, recommended by five debriefs.
2. **Multi-surface review trigger**: evaluate on the change's actual
   footprint, not its fix/feature label.
3. **DD-writing checklist addition**: shared-aging-signal ordering
   constraint; spec finalization re-reads the flight's own DD/VERDICT
   text for named edge cases.
4. **Preserve raw review verdicts** in flight logs when findings are
   resolved by FD revision (auditability).
5. **Confirmed effective, keep**: risk-tiered leg review (every catch
   this mission was a HIGH-tier cycle); spike-verdict-annotation flow;
   the honest-disposition path for gate failures; the
   autonomous-flights + operator-HAT-close mission shape (operator's
   explicit preference, twice run).

## Action Items

- [ ] mission-control: codify the key-handling rule + footprint-based
      review trigger + DD checklist items (methodology repo change).
- [ ] goldfinch routine maintenance: the queue in Standing Items 3.
- [ ] Operator (any day): the TC8 live spot-check (2 minutes).
