# Leg: verify-integration

**Status**: completed
**Flight**: [Tab Order Model and Reorder](../flight.md)

## Objective

Verify the flight end-to-end: run the new `tab-reorder` behavior test and the
extended `tab-keyboard-operability` behavior test against the live app, plus
the a11y sweep and static suites; fix loop as needed.

## Context

- Legs 1–2 landed (uncommitted). Both specs are authored; `tab-reorder` has
  never run; `tab-keyboard-operability` last ran pre-extension.
- Behavior tests are run by the Flight Director via the Witnessed protocol
  (fresh Executor+Validator per spec).

## Acceptance Criteria

- [x] `/behavior-test tab-reorder` — pass (9/9 first run) (all steps; failed steps fixed
      before landing). Spec transitions `draft` → `active` on first pass.
- [x] `/behavior-test tab-keyboard-operability` — pass on the extended contract (8 pass / 1 inconclusive — Step 3 focus-ring visual, pre-classified WSLg apparatus limit, no regression; accepted disposition consistent with the 2026-07-08 run).
- [x] `npm run a11y` WCAG gate green (no new findings).
- [x] `npm test` (1565/1565), lint, typecheck green on the final tree.
- [x] Flight log leg entry with both run-log paths.

## Verification Steps

Run logs themselves + sweep outputs captured in the flight log.

## Implementation Guidance

Same environment pattern as flight 1's verify leg: fixture server (distinct
pages, `<meta charset>`), `dev:automation` with mint envs and no port pin,
fresh crew per spec, evidence under `/tmp/behavior-tests/goldfinch/...`.

## Edge Cases

- WSLg screenshot/geometry artifacts: numeric-first apparatus; note and
  proceed per each spec's rules.

## Files Affected

- `tests/behavior/tab-reorder/runs/{ts}.md` (new),
  `tests/behavior/tab-keyboard-operability/runs/{ts}.md` (new)
- `tests/behavior/tab-reorder.md` (status → active on pass)
- flight-log.md

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [ ] Do NOT commit — the flight commits once after review
