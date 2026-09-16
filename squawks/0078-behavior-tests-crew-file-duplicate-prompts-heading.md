# Squawk 0078: `behavior-tests-execution.md` carries two `## Prompts` sections

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-15
**Completed**: 2026-09-16

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

Diffed the two `## Prompts` blocks section-by-section
(`### Executor: Initial`, `### Validator: Initial`,
`### Per-step prompt: Executor`, `### Per-step prompt: Validator`,
`### Closing prompt (both agents)`,
`### Accessibility Validator: Initial (when enabled)`). The only differences
were the two known squawk-0076/live customisations, both already present in
the second (live) block and absent from the generic one: "Orchestrator sends
them via SendMessage" (Executor/Validator: Initial) and the "PROJECT
APPARATUS NOTES" pointer bullet (escalation-rule + `mcp__goldfinch*`
prohibition pointer, Executor/Validator: Initial). The other four
subsections were byte-identical between the two blocks. The live block is
therefore a strict superset of the generic one — nothing needed to be
carried over.

Deleted the generic duplicate `## Prompts` section in full: lines 169–448
(the heading through its trailing blank line, immediately before
`## Project Apparatus Notes (goldfinch)`), leaving the live, apparatus-notes-
aware block (previously at ~682) as the file's sole `## Prompts` section.
`## Crew`, `## Interaction Protocol`, `## Prompts`, and
`## Project Apparatus Notes (goldfinch)` (content untouched, per scope) all
remain intact. File length: 1040 → 760 lines (exactly the 280-line deleted
range).

## Verification

- `grep -c "^## Prompts" .flightops/agent-crews/behavior-tests-execution.md`
  → `1`.
- Fenced code-block count (`grep -c '^```'`): 36 → 18 after deletion (the
  removed range itself contained 18 fence lines, an even/balanced count);
  remaining 18 is even/balanced.
- Each of the six prompt subsections (`### Executor: Initial`,
  `### Validator: Initial`, `### Per-step prompt: Executor`,
  `### Per-step prompt: Validator`, `### Closing prompt (both agents)`,
  `### Accessibility Validator: Initial (when enabled)`) present exactly
  once (`grep -c "^### <heading>"` → `1` for each).
- `npm run format:check` → passes repo-wide. `.prettierignore` carries a
  blanket `*.md` entry, so all Markdown — including everything under
  `.flightops/` — is Prettier-ignored; the check does not actually inspect
  this file's formatting. Confirmed by direct diff of before/after instead
  (only the intended 280-line range removed, no incidental reflow).

## Sign-Off

**Reviewer**: Reviewer agent (Sonnet), batch review of squawks 0078–0081, 2026-09-16
**Verdict**: confirmed — corrective action correct, complete, confined to the reported surface; 4784/4784, lint/typecheck/format clean
**Commit**: `squawk: turnaround 2026-09-16` on `squawk/turnaround-2026-09-16`
