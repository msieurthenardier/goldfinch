# Flight Log: Compromise-Mode Rotation

**Flight**: [flight.md](flight.md)
**Mission**: [Vault Portability & Compromise Mode](../../mission.md)

Execution notes land here. Anomalies land **at occurrence** (Flight 1
debrief rule), not at teardown.

## Planning Notes (2026-09-01)

- Upstream recon skipped with rationale: source artifacts (mission,
  Flight 1 log/debrief) were written 2026-08-31/09-01 and their code
  citations were verified at the Flight 1 debrief against a tree that has
  not changed since (`main` at 83eceac, artifact-only commits).
- Code interrogation report (write sinks, lock coverage, enumeration
  recipe, rotate-recovery wiring, test idioms, format validation) is
  reflected in the spec's DD citations.
- Operator rulings at planning interview: one combined credential sheet
  (supersedes the prototype's two-sheet composition); manager format v2
  with optional admin fields; export omits absent admin + import
  tolerates absence; HAT leg included; **fresh adopt stops minting admin
  keys** (mission criterion 6 amended — extends R5 to restore; Flight 3
  implements; F4 stash-then-chain machinery loses its last consumer).

## Anomalies

*(none yet)*

## Flight Director Notes

*(execution begins after design review + operator approval)*
