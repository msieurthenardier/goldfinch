# Squawk 0085: Docs — Crashpad/SEGV finding, prune race note, two planning rules, DD11 wording

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-17
**Completed**: —

## Report

Four documentation items from the Flight 3 debrief, all text-only: (1)
CLAUDE.md "Crash and hang resilience": record the finding that with
`crashReporter` active, `SIGSEGV`/`SIGABRT` do not crash a sandboxed guest
renderer on the rig (only `SIGKILL` does) and a SEGV on the unsandboxed chrome
registers after ~15 s — hypothesis Crashpad's in-process handler; consequence: a
real page segfault may present as a hang (operator ruling: documented, not
spiked; revisit if seen); (2) `docs/dev-testing.md` "Crash records and dumps":
one sentence that pruning is not synchronised with Crashpad's own writer (a
theoretical race, accepted); (3) `.flightops/FLIGHT_OPERATIONS.md` or CLAUDE.md
Flight Operations: two standing rules — a leg's live smoke exercises every
existing apparatus primitive against the leg's new state; a DD that installs a
global hook lists and re-runs the earlier spike premises it could change; plus
the "verbatim extraction" TDZ checklist item (anything referenced above the
construction site needs a getter or hoisted declaration); (4) Flight 3
`flight.md` DD11: strike "hung" from the per-tab pushes that call
`refreshTabIndicators` (`onTabHung` never needed to — the chip never reads
`hung`).

## Evidence

- `missions/20-no-silent-failures/flights/03-crash-and-hang-resilience/flight-debrief.md`
  — Technical / Documentation / Recommendations 2–3.
- `tests/behavior/crash-and-hang-surfaces/runs/2026-09-17-00-22-28.md` — Orchestrator Notes (SEGV/ABRT finding; SEGV latency).

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
