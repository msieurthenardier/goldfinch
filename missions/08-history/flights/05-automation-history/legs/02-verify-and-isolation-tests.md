# Leg: verify-and-isolation-tests

**Status**: completed
*(FD-authored; spec `history-automation-isolation` authored at this leg's
design per flight DD4 as amended — apparatus proven across three prior
runs.)*
**Flight**: [Automation History Surface](../flight.md)

## Objective

Run `/behavior-test history-automation-isolation` (7 checkpoints across
two launches), land the docs (mcp-automation.md getHistory reference +
tool count + the enumerateTabs table fix; README automation line;
CLAUDE.md tool inventory sixth category + accessor note), and close the
flight + the mission's remaining criteria book-keeping.

## Split of work

**Developer half**: docs per flight DD3 (verify every claim against
code); gates green post-docs; flight-log entry.
**FD half**: run the behavior test (live two-agent); spec → active on
pass; land the leg; flight close-out follows (review → commit → PR).

## Acceptance Criteria

- [x] Docs accurate (28 tools; getHistory identity semantics + refusal
      codes; enumerateTabs claim fixed in the docs table; README line;
      CLAUDE.md inventory + accessors).
- [x] `/behavior-test history-automation-isolation`: **pass (7/7)**, live
      two-agent, two launches; run log at
      `tests/behavior/history-automation-isolation/runs/2026-07-13-02-13-20.md`;
      spec → active.
- [x] Gates green post-docs (1494/1494).

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Do NOT commit *(no git ops performed during leg landing; flight-level
      commit follows at flight close-out)*
