# Squawk 0078: `behavior-tests-execution.md` carries two `## Prompts` sections

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-15
**Completed**: —

## Report

`.flightops/agent-crews/behavior-tests-execution.md` has TWO `## Prompts`
H2 sections — a generic block (~line 169) and the live, apparatus-notes-aware
block (~line 682) that the behavior-test run skill's prompts actually cite.
Every sibling crew file has exactly one. A reader (or a future
`/mission-control:init-project` sync) can edit or validate the wrong block;
squawk 0076's escalation rule had to be verified against the second block
specifically. Found by the Reviewer of the 2026-09-15 squawk turnaround.

## Evidence

- `grep -n "^## Prompts" .flightops/agent-crews/behavior-tests-execution.md`
  → two hits.
- Squawk 0076's Corrective Action note (which block carries the pointer).

## Corrective Action

_(written at completion)_ Dedupe to the one live block (the one whose
Executor/Validator initial prompts carry the PROJECT APPARATUS NOTES pointer),
preserving every project customisation; confirm the run skill's structure
validation (`## Crew`, `## Interaction Protocol`, `## Prompts`) still passes.

## Verification

`grep -c "^## Prompts"` → 1; fenced-block count even; a Witnessed run spawns
normally.

## Sign-Off

_(written at completion)_
