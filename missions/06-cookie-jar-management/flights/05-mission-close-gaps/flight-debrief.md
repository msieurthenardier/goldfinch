# Flight Debrief: Mission-Close Gaps

**Date**: 2026-07-11
**Flight**: [Mission-Close Gaps](flight.md)
**Status**: landed
**Duration**: 2026-07-10 (chartered post-audit) – 2026-07-11 (landed)
**Legs Completed**: 2 of 2

> **Debrief method note (FD call, logged)**: this two-leg flight was debriefed
> by synthesis from the four independent agent assessments produced during the
> flight itself (leg-1 design review, leg-2 spec premise audit, the flight
> Reviewer, and the behavior run's Validator closing) rather than fresh
> Developer/Architect interview spawns — proportional to a flight this size.
> A flight of normal scope gets the full interview protocol.

## Outcome Assessment

### Objectives Achieved

Both audit gaps closed. The container picker now shows the default marker
(model-level `isDefault` + sheet badge, live-correct per open including the
null/dangling→Burner routing-parity rule), and the automation-degradation
guarantee has a passing, re-runnable live witness
(`jar-key-revocation-on-delete`, 5/5 first run). Mission 06's success criteria
are now fully closeable; the tentative "Flight 5: Chrome integration" scope is
resolved — most of it was already covered by Flights 1–4 (audit evidence), the
two real gaps are closed, original framing preserved in mission.md.

### Value Delivered

- Suite 1277 → **1283** (+6 net); typecheck/lint clean throughout.
- New behavior spec + first-run pass, closing the mission's own named Open
  Question ("delete a jar while an automation key is scoped to it").
- The picker default marker closes criterion 5's last surface-parity hole.

## What Went Well

- **The mission-close audit as flight recon**: chartering from a read-only
  audit produced an honestly-scoped two-leg flight instead of the multi-day
  "Chrome integration" flight the mission sketch implied. The audit's
  already-covered verdicts (with evidence) let five of seven scope items be
  retired without work.
- **Design review continued its streak — one would-be gate failure caught per
  leg, pre-implementation.** Leg 1: the `renderer-globals.d.ts` declare gap
  (TS2554, empirically confirmed by the reviewer on a scratch copy) — the
  exact DD10(b)-scope recurrence Flight 4's debrief predicted, third data
  point. Leg 2: the chrome apparatus is admin-only but the spec draft withheld
  the admin key — the live run would have died at step 2, burning a two-agent
  spawn chain. Both caught for the price of two review spawns.
- **The behavior run passed 5/5 on the first attempt**, and its one apparatus
  anomaly (idle admin-session prune) became an in-run negative control — the
  run's own evidence now contains both rejection shapes (404 pruned-valid vs
  401 revoked), sharpening the mixed-frame discrimination. Promoted into the
  spec post-run.
- **The daemon-held-transport pattern** (long-lived node process holding SDK
  clients; per-step calls over a local control port) made "same live session,
  no reconnect" mechanically provable across a five-step run — the Validator
  could verify session continuity as fact, not executor assertion.

## What Could Be Improved

### Process

- The idle-session-pruning hazard was discovered by luck (it hit the
  apparatus identity, not the fixture). Long-gap multi-step specs against
  live sessions should carry a pruning precondition from authoring, not from
  first-run learning — added to this spec; worth an AUTHORING.md note at the
  next methodology touch (route to mission debrief).
- Leg/checklist hygiene lagged execution (Reviewer MEDIUM + LOWs: missing
  flight-log entry for leg 2, unchecked boxes on landed legs). Cheap to fix,
  but the Developer prompt should say "check your boxes as you verify" —
  the flight-4 prompt did not, and neither did this one.

### Technical

- None introduced. The one code finding (CSS token literal vs the sheet's own
  `--bg` variable) was fixed pre-commit. No new debt items; no existing debt
  touched.

## Test Suite Metrics (2026-07-11, HEAD = d0c8cc1)

- **1283/1283 pass**, 0 fail/skip; internal duration ~5.03 s — the
  `automation-find.test.js` floor persists unchanged (fifth flight of flat
  ~5.0s internal duration; still routed to `/routine-maintenance`).

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Flight 5 flown at reduced scope vs the mission sketch | Post-F4 audit showed 5/7 scope items already covered with evidence | Yes — audit-before-charter for mission-tail flights |
| Debrief by synthesis, no fresh interviews | Two-leg flight; four independent assessments already on record | Case-by-case — proportionality, FD call logged |
| Spec corrected twice at `draft` (pre-run premise fix, post-run shape fixes) | Premise audit + first-run learnings | Yes — premise-audit new specs before their first run, always |

## Key Learnings

1. A read-only completeness audit is cheap relative to what it retires — it
   deleted most of a planned flight and focused the remainder into hours.
2. Behavior-spec premise audits pay the same way leg design reviews do: the
   admin-only apparatus error would have cost a full run cycle to discover
   live.
3. Apparatus anomalies can be evidence: the pruned-session 404 sitting next to
   the revocation 401 in one run's evidence is stronger discrimination than
   the spec alone would have produced.

## Recommendations

1. Add the premise-audit step (Developer trace of every empirical claim)
   as standard practice before a new behavior spec's first run — raise at
   mission debrief for methodology adoption.
2. Add the idle-pruning/live-session-fixture note to AUTHORING.md.
3. Add "check acceptance/checklist boxes as you verify them" to the Developer
   implement-prompt template.

## Action Items

- [ ] Mission debrief: propose premise-audit-before-first-run as methodology
- [ ] Mission debrief: AUTHORING.md note (live-session fixtures + pruning +
      daemon-held-transport pattern)
- [ ] Crew-prompt template: box-checking instruction (with the two flight-4
      items already queued for the next methodology touch)
