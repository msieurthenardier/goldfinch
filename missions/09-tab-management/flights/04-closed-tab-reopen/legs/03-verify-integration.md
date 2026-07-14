# Leg: verify-integration

**Status**: completed
**Flight**: [Closed-Tab Stack and Reopen](../flight.md)

## Objective

Run the `closed-tab-reopen` behavior test (Witnessed) against the live app;
a11y sweep; static suites; fix loop as needed.

## Acceptance Criteria

- [x] `/behavior-test closed-tab-reopen` — **PASS 9/9 first run**
      (`tests/behavior/closed-tab-reopen/runs/2026-07-14-21-48-13.md`);
      spec `draft` → `active`.
- [x] `npm run a11y` WCAG gate green (no new violations); `npm test`
      1640/1640, lint, typecheck green.
- [x] Flight log leg entry with the run-log path.

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [ ] Do NOT commit — the flight commits once after review
