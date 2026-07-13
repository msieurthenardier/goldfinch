# Leg: verify-integration

**Status**: completed
*(FD-authored; apparatus premises recon/Architect-verified this flight.)*
**Flight**: [Address-Bar Suggestions](../flight.md)

## Objective

Verify the omnibox end-to-end: run `/behavior-test omnibox-suggestions`
(spec authored at this leg's design — 7 checkpoints incl. 50k-scale
latency, jar exclusivity, keyboard/pointer selection, burner gate), the
store-level scale probe (incl. 1–2 char queries), and docs.

## Split of work

**Developer half**: (1) scale probe — scratch script seeding 50k rows via
the store API in ONE transaction into a TEMP dir (not the dev profile),
timing `suggest` for 1/2/3/6-char queries, 10 runs each, median/max to
the flight log; (2) docs — CLAUDE.md omnibox section (suggestions
surface + non-focusing sheet regime + close-trigger matrix + the Ch7/Ch6
ordering nuance + frecency pointer) and a README feature line; gates.
**FD half**: run the behavior test (live two-agent), spec → active on
pass; land the leg.

## Acceptance Criteria

- [x] Scale probe numbers in the flight log (1-char ~4.3ms median —
      uncovered-prefix path noted; 2/3/6-char ~4ms medians; all ≤10ms).
- [x] CLAUDE.md + README updated; claims code-verified.
- [x] `/behavior-test omnibox-suggestions`: **pass 7/7** (live two-agent;
      steps 1 & 4 on rerun after spec-premise fixes — retention-safe seed
      window; resolvable live-recorded selection targets); run log at
      `tests/behavior/omnibox-suggestions/runs/2026-07-13-00-39-35.md`;
      spec → active.
- [x] Gates green post-docs (1473/1473).

## Files Affected

- `CLAUDE.md`, `README.md`, flight-log.md,
  `tests/behavior/omnibox-suggestions.md` (+ run log)

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Do NOT commit
