# Squawk 0082: Behavior-test crew file — nine apparatus facts from the M20 F3 acceptance run

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-17
**Completed**: 2026-09-21

## Report

The `crash-and-hang-surfaces` Witnessed run (2026-09-17) rediscovered nine
rig facts live that belong in `.flightops/agent-crews/behavior-tests-execution.md`'s
"Project Apparatus Notes (goldfinch)": (1) with `crashReporter` active,
`kill -SEGV`/`-ABRT` do not crash a SANDBOXED guest renderer — only
`-KILL` does (go straight to KILL); (2) `captureWindow`/`captureScreenshot`
time out (`capture-timeout`) against a `SIGSTOP`ped renderer — a stopped
guest's visibility is a `[by-eye]` observable; (3) a SEGV on the unsandboxed
chrome takes ~15 s to register (Crashpad's in-process handler) — corroborate
a chrome crash by the `chromePid` change, not by catching `booted: false`;
(4) `openTab` returns a bare number (the wcId); (5) `navigate` right after
`openTab` can race the still-loading page — poll until url/loadState/pid
stabilise; (6) same-origin, same-jar tabs are not guaranteed to share a
renderer, and when they do, one kill crashes both; (7) a wedged
`enumerateTabs` against a window with no live chrome was a PRODUCT defect
(fixed) — `enumerateWindows` stays fast and is the liveness proof; set an
explicit short client timeout in doubtful states; (8) any value read only
after a polling loop ends must be saved as its own evidence file; (9) the
window topology renumbers totally after a relaunch — re-resolve THE window by
`lastFocused`.

## Evidence

- `tests/behavior/crash-and-hang-surfaces/runs/2026-09-17-00-22-28.md` — Orchestrator Notes; Closing Summaries (Executor closing 1–9;
  Validator closing).

## Corrective Action

Added all nine facts to `.flightops/agent-crews/behavior-tests-execution.md`'s
"Project Apparatus Notes (goldfinch)" section, appended after the existing
"Old-material provisioning via throwaway rotation" bullet (the section's
current tail), each with its own citation into
`tests/behavior/crash-and-hang-surfaces/runs/2026-09-17-00-22-28.md`:

1. Guest-crash signal choice (SEGV/ABRT inert on a sandboxed guest;
   go straight to KILL).
2. `captureWindow`/`captureScreenshot` refuse `capture-timeout` against a
   `SIGSTOP`ped renderer — a stopped guest's visibility is a `[by-eye]`
   observable.
3. Chrome SEGV registers ~15 s later (Crashpad's in-process handler) —
   corroborate by the `chromePid` change, not by catching a transient
   `booted: false`. Cross-checked against `src/main/window-census.js`'s
   `WindowCensusRow.chromePid`/`chromePidOf` — the field exists as
   described.
4. `openTab` returns a bare number (the wcId) — verified against
   `src/main/automation/mcp-tools.js`'s own doc comment ("the new wcId
   (number) OR null").
5. `navigate` right after `openTab` can race the still-loading page —
   poll until url/loadState/pid stabilise.
6. Same-origin, same-jar tabs are not guaranteed to share a renderer, but
   when they do, one kill crashes both.
7. A wedged `enumerateTabs` against a dead-chrome window was a PRODUCT
   defect (fixed in-run by `chrome-recovery.js`'s pause branch clearing
   `bootConfigServed`) — `enumerateWindows` stays fast and is the
   liveness proof; set an explicit short client timeout in doubtful
   states.
8. A value read only after a polling loop ends must be saved as its own
   evidence file. Noted in the new bullet as the companion case to the
   PRE-EXISTING "transient read is evidence in its own right" bullet
   (tls-trust-surface run, already in the section) — that bullet covers
   reads taken DURING a poll (don't overwrite a settled read with a
   scratch one); this fact covers the read taken AFTER the poll
   concludes (checkpoint 10's `chromePid` confirmation, which the
   Executor hadn't filed). Not a duplicate — written as an explicit
   cross-reference rather than a second independent bullet, per the
   task's "where a fact is already in the section, don't duplicate it"
   instruction; the two rules are stated once each, pointing at each
   other.
9. Window topology renumbers totally after a relaunch — re-resolve THE
   window by `lastFocused`. Related to, but not a duplicate of, the
   PRE-EXISTING out-of-band-relaunch bullet, which uses wcId
   renumbering + the re-minted key hash as relaunch-detection signals;
   that bullet says nothing about `windowId`s or `lastFocused`-based
   re-resolution, so this is a genuinely new, narrower fact about
   locating the window under test post-relaunch. Cross-referenced in
   the new bullet's text rather than folded silently into the old one.

No source or test files were touched — this squawk is documentation-only,
matching its `Type: servicing` / `Severity: routine` classification. All
nine facts checked out true against the run log's raw evidence (Checkpoint
Actions/Raw state/Orchestrator Notes/Closing Summaries) and, where cheaply
checkable against current code (facts 3, 4), confirmed against
`src/main/window-census.js` and `src/main/automation/mcp-tools.js`. No
fact needed to be dropped as false.

## Verification

- `npm run format` — ran clean over the whole tree; the two edited files
  (`squawks/0082-behavior-test-crew-apparatus-notes-m20f3.md`,
  `.flightops/agent-crews/behavior-tests-execution.md`) were reported
  `(unchanged)`.
- `npm run format:check` — "All matched files use Prettier code style!"
- `npm test` — `node --test` over `test/unit/**`: 5455/5458 pass, 0 fail,
  3 todo (pre-existing, unrelated to this change — this squawk touches no
  source or test file).
- Manual: re-read the appended crew-file section against the squawk's
  nine-fact list and the run log's Checkpoint/Orchestrator Notes/Closing
  Summaries text to confirm each addition is traceable to a specific
  cited passage, and cross-checked facts 3 and 4 against
  `src/main/window-census.js` / `src/main/automation/mcp-tools.js`.

## Sign-Off

**Reviewer**: independent Reviewer agent (leg-execution crew), batch review of the
2026-09-21 turnaround
**Verdict**: confirmed — corrective action correct, complete, and confined to the reported surface; gates green (`npm test` 5455 pass / 0 fail / 3 todo, lint, typecheck, format:check, build:preload), leak scan clean
**Commit**: see `squawk: turnaround 2026-09-21`
