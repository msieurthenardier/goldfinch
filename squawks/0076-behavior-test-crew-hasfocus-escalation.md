# Squawk 0076: Behavior-test crew protocol — a false `document.hasFocus()` under automation is an escalation trigger, not a rig footnote

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-15
**Completed**: 2026-09-15

## Report

During the `navigation-failure-surface` Witnessed run (2026-09-15) the Executor
measured `document.hasFocus() === false` on the chrome document at every
keyboard-row reading and the Validator recorded it as an apparatus limitation
("no OS-focused surface under automation on WSLg"). The row passed on a11y-tree
evidence. At the HAT the same reading turned out to be the symptom of a real
defect (issue #216: the chrome loses OS focus after a typed navigation starts
and keyboard focus is stranded). The crew file's apparatus notes now state the
rig fact but do not tell the crew what to DO with it.

## Evidence

- `.flightops/agent-crews/behavior-tests-execution.md` — "Project Apparatus
  Notes (goldfinch)": the `document.hasFocus()` bullet added at that run
  describes the condition only.
- `tests/behavior/navigation-failure-surface/runs/2026-09-15-15-01-54.md` —
  Checkpoint 8 verdict + Validator closing (3); flight debrief "What Could Be
  Improved / Process" (M20 F1).

## Corrective Action

Added one new protocol-rule bullet to `.flightops/agent-crews/behavior-tests-execution.md`'s
`## Project Apparatus Notes (goldfinch)` preamble, immediately before the
existing "Never use session-registered `mcp__goldfinch*`" bullet (same list,
same standing as that other hard rule): a `document.hasFocus() === false`
reading (or any other evidence the chrome document lacks OS focus) on a row
whose Expected Result concerns keyboard focus, focus rings, or focus order is
reported by the Executor as `[BLOCKED:apparatus-focus]`; the Validator must
not render PASS from a11y-tree evidence alone on that row — it renders
INCONCLUSIVE and escalates to the Orchestrator ("verify by eye before this
row is judged"), who pauses for an operator confirmation. Cites Mission 20
Flight 1 / `navigation-failure-surface` run 2026-09-15 checkpoint 8 and issue
#216 as precedent.

This section's preamble is already the thing both live Initial prompts point
crew members at ("PROJECT APPARATUS NOTES: read the `Project Apparatus Notes
(goldfinch)` section... before signalling `[READY]`"), so no new prompt
plumbing was needed for reachability — but the existing pointer sentence
named only the `mcp__goldfinch*` prohibition "in particular," so it was
extended (via `replace_all`, since the sentence is duplicated verbatim in
both the Executor: Initial and Validator: Initial fenced prompts of the
crew file's second `## Prompts` block, the one with the apparatus-notes
pointer) to also name the new `document.hasFocus()` escalation rule
in particular.

Also revised the pre-existing `document.hasFocus()` fact bullet (further
down the same notes, "false on the chrome document under automation on
WSLg") so its closing clause now says what to DO with the reading — points
at the new rule and at squawk 0076 / issue #216 — instead of ending on
"a rendered ring is a HAT-only observable" as a bare limitation.

Note (not acted on, out of scope for this servicing item): the crew file
has a pre-existing structural duplication — two `## Prompts` H2 sections
(the plain generic one at line 169, and a second, apparatus-notes-aware
copy at line 682) — where every sibling crew file in
`.flightops/agent-crews/` has exactly one. The second block is the one
carrying the "PROJECT APPARATUS NOTES" pointer sentence (and is therefore
the maintained/live copy), so the escalation-rule reachability above was
verified against that block specifically. Flagging the duplication for a
future maintenance pass rather than fixing it here, since deduplicating it
is outside this squawk's declared surface.

## Verification

- `grep -n "^## " .flightops/agent-crews/behavior-tests-execution.md` still
  shows exactly `## Crew`, `## Separation Rules`, `## Interaction Protocol`,
  `## Template Variables`, `## Prompts` (x2, pre-existing), `## Project
  Apparatus Notes (goldfinch)` — the three headings the run skill validates
  (`## Crew`, `## Interaction Protocol`, `## Prompts`) are all present.
- The new rule bullet lives at the top of `## Project Apparatus Notes
  (goldfinch)`'s list (line ~458), inside the section both live Initial
  prompts explicitly instruct the Executor and Validator to read before
  signalling `[READY]`.
- Both fenced Initial prompts in the crew file's second `## Prompts` block
  (Executor: Initial and Validator: Initial) now read: "in particular the
  prohibition on session-registered `mcp__goldfinch*` tools and the
  `document.hasFocus()` escalation rule (a false reading on a
  keyboard-focus row is `[BLOCKED:apparatus-focus]`, never folded into a
  pass)." — confirmed via `grep -n "hasFocus" .flightops/agent-crews/behavior-tests-execution.md`
  (hits inside both fenced prompt blocks plus the two apparatus-notes
  bullets).
- Fenced-code-block count in the file is even (36 → 18 open/close pairs);
  no fence was broken by the edits.
- `npm run format:check` — passed ("All matched files use Prettier code
  style!").
- Not yet verified: a live Witnessed run exercising a keyboard-focus row
  citing the new rule (no run has executed since this edit landed).

## Sign-Off

**Reviewer**: Reviewer agent (Sonnet), batch review of squawks 0074 + 0076, 2026-09-15
**Verdict**: confirmed — corrective action correct, complete, confined to the reported surface; lint/format/tests green (4565/4565)
**Commit**: `squawk: turnaround 2026-09-15` on `flight/02-tls-trust` (turnaround shares the Mission 20 Flight 2 branch by operator ruling)
