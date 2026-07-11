# Leg: verify-key-revocation

**Status**: landed
**Flight**: [Mission-Close Gaps](../flight.md)

## Objective

The `jar-key-revocation-on-delete` behavior spec exists and passes on a fresh
stage, closing the mission's named automation-degradation verification gap.

## Context

- Flight DD2. The mechanism is fully unit-backed (`revokeJarKey` in the delete
  composition — `jar-ipc.test.js`, `automation-mcp-server.test.js`) but has
  zero live witness; the mission's Open Questions and two behavior specs'
  Out-of-Scope notes name exactly this scenario.
- Spec authored at design time per AUTHORING.md:
  `tests/behavior/jar-key-revocation-on-delete.md`. Includes a rename
  positive-control step so the delete-revocation verdict is discriminated from
  "any lifecycle change kills sessions."
- Run via `/behavior-test jar-key-revocation-on-delete` (the run skill
  orchestrates its own Executor/Validator crew — the FD invokes it directly,
  no Developer spawn).

## Inputs

- The spec file (authored, status `draft`)
- Leg 1's changes on the working tree (independent — no interaction with the
  automation surface)
- Mint apparatus + chrome apparatus (existing, proven by prior specs)

## Outputs

- A passing run log at
  `tests/behavior/jar-key-revocation-on-delete/runs/{timestamp}.md`
- Spec status `draft` → `active`, Last Run stamped

## Acceptance Criteria

- [x] All 5 steps pass on a fresh stage (step 1 halt conditions respected)
- [x] Run log written per ARTIFACTS.md conventions; evidence outside the tree
- [x] Spec status flipped to `active`

## Verification Steps

- The run log's Summary reads 5/5 (or documents any operator-accepted partial
  with disposition)

## Implementation Guidance

1. Confirm leg 1 has landed (or is at least gate-green) so the stage isn't
   mid-edit while the app launches.
2. Invoke `/behavior-test jar-key-revocation-on-delete`.
3. On failure: diagnose, fix in a new commit if a code defect (none expected —
   the mechanism is unit-green), re-run. A spec defect is fixed in the spec and
   re-run (spec is `draft`; pre-first-pass corrections are authoring, not
   drift).

## Edge Cases

- **Default flag not on `personal` at launch**: precondition step handles it
  (set via `jarsSetDefault` before mint).
- **Port collision**: pin `GOLDFINCH_MCP_PORT` per the spec.

## Files Affected

- `tests/behavior/jar-key-revocation-on-delete.md` — status/Last Run
- `tests/behavior/jar-key-revocation-on-delete/runs/` — new run log

---

## Post-Completion Checklist

- [x] Run log committed reference recorded in flight log
- [x] Leg status `landed`; checked off in flight.md
- [x] Do NOT commit separately (deferred single review + commit at flight end)
