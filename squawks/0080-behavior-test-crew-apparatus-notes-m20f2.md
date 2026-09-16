# Squawk 0080: Behavior-test crew file — four apparatus facts from the M20 F2 acceptance run

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-16
**Completed**: 2026-09-16

## Report

The `tls-trust-surface` Witnessed run (2026-09-16) rediscovered four rig
facts live that belong in `.flightops/agent-crews/behavior-tests-execution.md`'s
"Project Apparatus Notes (goldfinch)" so the next crew spawn needs no
hand-added instruction: (1) `pressKey` `Enter` on the chrome wcId activates
the address bar's keydown listener but does NOT activate a focused
`<button>` (no `char`/keypress event) — a keyboard row that ends in a button
activation needs a by-eye check or `evaluate .click()`; (2) the `navigate`
drive op returns `isError: true` with the net error text for a TLS-blocked
load — the tab STATE (census) is the observable, not the op's result;
(3) census `security` settles one push AFTER `loadState` flips to `ok`
(`tab-did-navigate` then `tab-security`) — read chip/census only after two
consecutive stable reads; (4) a transient read is evidence: save it under its
own ordinal suffix, never overwrite the settled read.

## Evidence

- `tests/behavior/tls-trust-surface/runs/2026-09-16-04-59-20.md` — Orchestrator
  Notes "Apparatus findings"; checkpoints 9 (timing) and 15 (Enter on Advanced).

## Corrective Action

Added four bullets to the end of the "Project Apparatus Notes (goldfinch)"
list in `.flightops/agent-crews/behavior-tests-execution.md` (immediately
before `## Prompts`), each in the section's existing voice and each ending
with a `see \`<run log path>\` (<section>)` citation into
`tests/behavior/tls-trust-surface/runs/2026-09-16-04-59-20.md`:

1. `pressKey` `Enter` on the chrome wcId activates the address bar's keydown
   listener but does NOT activate a focused `<button>` (no `char`/keypress
   event) — cites Checkpoint 15 / Orchestrator Notes.
2. The `navigate` drive op returns `isError: true` with the net error text
   for a TLS-blocked or otherwise failed load — the tab STATE via
   `enumerateTabs` is the observable, not the op's result — cites
   Checkpoint 12 / Orchestrator Notes.
3. Census `security` settles one push after `loadState` flips to `ok`
   (`tab-did-navigate` then `tab-security`) — read chip/census only after
   two consecutive identical reads 500 ms apart — cites Checkpoint 9 /
   Orchestrator Notes.
4. A transient read is evidence in its own right — save it under its own
   ordinal suffix (`step-N-census-transient.json`), never overwrite the
   settled read — cites Checkpoint 9 / Orchestrator Notes.

No fenced prompt block was touched; no code change was needed (all four
facts are apparatus/procedure notes, not defects).

## Verification

- `grep -c '^```' .flightops/agent-crews/behavior-tests-execution.md` → `18`
  (unchanged fence count).
- `grep -c pressKey` / `grep -c '<button>'` → `4` / `1` (keyword present).
- `grep -c isError` → `2` (keyword present).
- `grep -c settles` → `1` (keyword present).
- `grep -c transient` → `4` (keyword present).
- `grep -n '^## Crew$\|^## Interaction Protocol$\|^## Prompts$'` confirms all
  three headings intact and in order.
- Markdown is Prettier-ignored in this repo (`.prettierignore`'s `*.md`
  entry) — `npm run format`/`format:check` do not apply to this file.

## Sign-Off

**Reviewer**: Reviewer agent (Sonnet), batch review of squawks 0078–0081, 2026-09-16
**Verdict**: confirmed — corrective action correct, complete, confined to the reported surface; 4784/4784, lint/typecheck/format clean
**Commit**: `squawk: turnaround 2026-09-16` on `squawk/turnaround-2026-09-16`
