# Squawk 0222: `admin-reach-refusal` spec needs run-order, session-hygiene and by-eye cadence fixes

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-19
**Completed**: 2026-11-19

## Report
The spec's first full pass (run 2026-11-19-00-25-54) needed Orchestrator workarounds that the spec should state. Its Validator found six fixes:

1. **Step order.** Step 9 quits the app, yet steps 10–13 follow it. Make the quit the last-numbered step.
2. **Step 8 session hygiene.** `reason=touched` needs no other admin session active, but step 1b's raw `initialize` leaves one. Write the cleanup into step 8: list the sessions through the automation activity, `DELETE` the extras, and arm only from the sole remaining client.
3. **By-eye handshake.** Steps 6b, 12 and 13 need a "watch-ready" handshake with the operator before each. State that a rerun's extra trace lines (`gone`, or `confirmed` from an answered dialog) are accounted for in step 9.
4. **Exact strings.** Give the operator the exact expected dialog strings to confirm against.
5. **Step 1b.** Record the real-key attach both before and after.
6. **Step 13 evidence.** Capture the deletion, port closure and process checks as files: process state by PID, polled during the pending call.

## Evidence
- `tests/behavior/admin-reach-refusal/runs/2026-11-19-00-25-54.md`: Orchestrator Notes and Validator closing.

## Corrective Action
Edited `tests/behavior/admin-reach-refusal.md` only:
1. Step order: the app quit is now step 13 (last); the vault and download steps moved up to 9-12. Every cross-reference (intro banner, Preconditions, step 9/10 text, step 13's trace accounting, Out of Scope) was renumbered; the Last Run line notes that the run log uses the old numbers.
2. Step 8: session hygiene added, from `automation:get-activity` (`window.goldfinchInternal.automationGetActivity()`, sessions `{ sessionId, identity, kind, jarId, since }`, `src/main/automation/mcp-server.js` `getActivity` / docs/mcp-automation.md) and a raw `DELETE` with `mcp-session-id` (the `transport.terminateSession()` path); evidence `step-8-sessions-pre.json` / `-post.json`.
3. Watch-ready handshake for steps 6b, 11, 12 in Preconditions, with rerun trace accounting in step 13.
4. Exact dialog strings quoted from `src/main/reveal-gate.js` (`ACTIONS`, `buildOptions`, `CHANGED_NOTE`), marked as sourced there.
5. Step 1b: real-key attach recorded before and after (`step-1b-attach-before.json`, `step-1b-attach-after.json`).
6. Step 12 (download) and step 13 (quit) evidence captured as named files (ps polled by PID during the call, ls before/after, ss before/after).

## Verification
The spec has been edited for each point, and the next run needs no Orchestrator-side reordering or session cleanup that the spec does not itself state.

Ran: `timeout 300 npm test` (7455 tests, 7450 pass, 0 fail, 5 skipped); `npm run lint` and `npm run typecheck` clean; `prettier --write` on the spec and this squawk only, then `npm run format:check` passed.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the ninth 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. The quit is now step 13 and every renumbered reference is consistent; the quoted dialog strings match `src/main/reveal-gate.js` verbatim; the session list shape matches `getActivity()`, and a `DELETE` with `mcp-session-id` closes a session. Step 8's hygiene does reach `reason=touched`: `hasAdminSession()` walks the live sessions map, so once the extra sessions are deleted only the arming client counts. One low note accepted: step 8 does not say the arming client must hold the admin key, which is implied. Older flight logs and debriefs cite the old step numbers; they are historical records and were left alone. Gates at review: `npm test` 7,455 tests (7,450 pass, 0 fail, 1 skipped, 4 todo); lint, typecheck and format:check clean; `path-hygiene.test.js` 3 pass. Artifacts and docs only: no runtime change, so no live check.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-i`
