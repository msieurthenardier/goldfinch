# Leg: verify-integration

**Status**: completed
**Flight**: [Shrink-to-Fit Tab Strip](../flight.md)

## Objective

Verify the flight's changes end-to-end in the real environment: run the
evolved `responsive-tab-strip` behavior test, the a11y sweep, and the static
suites; audit that `tab-keyboard-operability` needs no spec change.

## Context

- Leg 1 landed all code + spec changes (see flight log — includes the
  `.tab-row` wrapper deviation).
- The behavior test is run by the Flight Director via `/behavior-test
  responsive-tab-strip` (Witnessed pattern — Executor + Validator crew), not
  by a Developer agent.
- The a11y sweep (`npm run a11y`) attaches to a live `dev:automation` app.

## Inputs

- Leg 1 landed (uncommitted working tree on `flight/1-shrink-to-fit-strip`).
- Evolved `tests/behavior/responsive-tab-strip.md` spec.
- Fixture: local static server for distinct tab URLs (spec precondition).

## Outputs

- Behavior-test run log at `tests/behavior/responsive-tab-strip/runs/{ts}.md`
  (committed with the flight).
- Flight log leg entry with a11y/suite results.
- `tab-keyboard-operability.md` audit disposition (expected: no change).

## Acceptance Criteria

- [x] `/behavior-test responsive-tab-strip` verdict: pass (all steps; any
      failed step is investigated and fixed before the leg lands).
      *(Run 1: 8/1/1 — Step-5 defect fixed via flight-log DD2 amendment;
      Run 2: 10/10 pass — `runs/2026-07-14-15-47-10.md`)*
- [x] `npm run a11y` — WCAG-gate tags green, no NEW findings vs the ACCEPTED
      allowlist.
- [x] `npm test`, `npm run lint`, `npm run typecheck` green on the final tree.
- [x] `tab-keyboard-operability.md` audited against the new DOM (`.tab-row`
      wrapper): assertions are ARIA-semantic and structure-agnostic — no
      update needed.
- [x] Flight log updated with the leg entry.

## Verification Steps

- The behavior-test run log itself (committed) + its verdict line.
- a11y sweep output captured in the flight log entry.
- Suite exit codes.

## Implementation Guidance

1. Serve `tests/behavior/fixtures/` (or a minimal static dir) on a free port
   for distinct-URL tabs, per the spec's fixture-distinctness precondition.
2. Launch `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1
   npm run dev:automation`; capture keys.
3. Run `/behavior-test responsive-tab-strip`.
4. Run `npm run a11y` (same live app; export the admin key env).
5. Run the static suites.
6. Audit `tab-keyboard-operability.md` textually against the new DOM.

## Edge Cases

- **WSLg screenshot distortion**: the evolved spec's numeric-first apparatus
  makes this non-blocking; screenshots are fallback only.
- **Fixture port collision**: probe first (spec precondition).

## Files Affected

- `tests/behavior/responsive-tab-strip/runs/{ts}.md` — new run log
- `missions/09-tab-management/flights/01-shrink-to-fit-strip/flight-log.md` —
  leg entry

---

## Post-Completion Checklist

- [ ] All acceptance criteria verified
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `landed`
- [ ] Do NOT commit — the flight commits once after review
