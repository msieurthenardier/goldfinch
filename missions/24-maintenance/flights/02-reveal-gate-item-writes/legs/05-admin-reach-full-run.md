# Leg: admin-reach-full-run

**Status**: in-flight
**Flight**: [Reveal Gate Covers Vault Item Writes](../flight.md)

## Objective

Fix the `admin-reach-refusal` spec (squawk 0194), extend it with live steps for this flight's two changes, and get one witnessed full run in which every step passes, with the operator present to unlock the vault and to read two dialogs by eye.

## Context

- Mission 24 success criterion: "`admin-reach-refusal` passes in full". It has never passed in full. The 2026-11-16 run left step 5 unexercised (no vault) and steps 10–11 not run (they need an operator-unlocked vault).
- **Squawk 0194** (spec quality, from that run's Validator):
  - In step 6, a trace poller keyed on the channel name latches onto step 4a's earlier `busy` line, so the timeout line's arrival is never timed.
  - Step 8's band is too loose ("4 s + 60 s"), and the host wall clock can run seconds ahead of the monotonic clock, so a correct run sits just outside the band.
  - Steps 3 and 6 record wall-clock time only.
- This flight changed the gate:
  - leg 2: item writes drop grants, and the dialog names the pre-automation title with a note;
  - leg 3: opening a downloaded file is gated.
  Neither has a live step yet.
- **This is an interactive leg** (agentic-workflow: HAT/live legs are guided with the human, not run autonomously). It has two parts:
  - **(A)** spec edits by a Developer. These ride the flight's single review and commit.
  - **(B)** the live run via `/mission-control:behavior-test admin-reach-refusal`, with the operator present, after the flight's code is committed.
- Live-run rules (CLAUDE.md):
  - real native dialogs appear on the operator's screen; the run never clicks them, and `callTool` gets more than 60 s;
  - dev mode only (`dev:automation` + `GOLDFINCH_AUTOMATION_DEV_MINT=1`, env-key scripts), never the registered MCP server;
  - downloads land in the operator's REAL downloads folder, so use a run-unique name and delete it by exact name.

## Inputs

- Legs 1–4 landed and committed (part B only).
- `tests/behavior/admin-reach-refusal.md`; the last run log `tests/behavior/admin-reach-refusal/runs/2026-11-16-03-02-52.md`; squawk `squawks/0194-admin-reach-refusal-spec-poller-and-tolerance.md`.

## Outputs

- **Part A:**
  - `tests/behavior/admin-reach-refusal.md` edited: 0194's fixes, and new steps 12–13.
  - Squawk 0194 completed: status, corrective action and verification written. Its sign-off is the flight Reviewer's verdict.
- **Part B:**
  - a committed run log under `tests/behavior/admin-reach-refusal/runs/`;
  - the spec's **Last Run** line updated;
  - a flight-log entry.

## Acceptance Criteria

**Part A: spec edits (Developer)**
- [ ] **Step 6:** the poller keys on the channel AND `decision=timeout`, or on the first matching line that appears after the call's start offset in the trace file (record the file's byte length when the call starts). It must never key on the channel name alone.
- [ ] **Steps 3 and 6:** the start and settle times are recorded on the MONOTONIC clock of the process that makes the call (`performance.now()` in the Executor's script), and the wall clock is recorded alongside it for information only.
- [ ] **Step 8:** the expected band is stated precisely: from the moment the armed timer fires (a monotonic timestamp the script stores on the page, e.g. `window.__firedAt = performance.now()` inside the timer) to the settle, 60–66 s. Wall-clock skew is named as not a failure.
- [ ] **New step 12** (needs an operator-unlocked vault, with at least two login items in different vaults; this flight's leg 2). With `goldfinch://vault` active:
  - (a) `evaluate` `vaultItemSave` to rename item X to `Renamed-<run id>`, keeping its secrets (`unchangedSecrets` listing its secret fields). The reply is metadata with the new title, and there is no trace line.
  - (b) `vaultReveal(X)`, awaiting up to 150 s, not clicked. It resolves `{ refused: 'not-confirmed' }`, with trace `channel=internal-vault-reveal decision=timeout`.
  - **By-eye, operator:** the dialog names X's ORIGINAL title, not `Renamed-…`, and its detail says the item was changed while automation was active.
  - (c) Restore X's title through `vaultItemSave`, also noted in the spec.
- [ ] **New step 13** (this flight's leg 3; no vault needed):
  - Download a run-unique fixture file (`admin-reach-<run id>.txt`, plain text) in a web tab.
  - Read its download id from the chrome. Then `evaluate` on the chrome wcId `window.goldfinch.openDownloadedFile(<id>)`, awaiting up to 150 s, with the chrome as the window's front surface, and do not click.
  - It resolves `{ ok: false, refused: 'not-confirmed' }`, with trace `channel=open-downloaded-file decision=timeout reason=admin-attached`. **By-eye, operator:** the dialog reads `Open the downloaded file "admin-reach-<run id>.txt"?`, and no application opened the file.
  - The run deletes the file by exact name afterwards.
- [ ] **Step 9's "no other decision" check** allows step 13's `open-downloaded-file` timeout line, and still forbids any trace line naming an item, cookie, path or id.
- [ ] **Preconditions** list the vault requirement for steps 5 and 10–12, and the by-eye reads for steps 12–13. The `[by-eye]` list under *Unobservable* gains both dialogs.
- [ ] **Squawk 0194** file completed, with its Corrective Action and Verification written.

**Part B: live run (Flight Director + operator)**
- [ ] The operator has unlocked the vault in the dev profile before the run starts. No agent ever types a master password.
- [ ] `/mission-control:behavior-test admin-reach-refusal` passes **every** step 1–13, including 5 and 10–12 against the unlocked vault. Every by-eye read in steps 12–13 is confirmed by the operator in this conversation and recorded in the run log.
- [ ] The run log is committed, the spec's **Last Run** line is updated, and no dialog is left open.

## Verification Steps

- **Part A:** the flight-end Reviewer checks the spec diff against squawk 0194's report and the leg-2/3 behaviour.
- **Part B:** the run log's verdict table shows every step passing. `git status` shows no stray fixture or download file.

## Implementation Guidance

1. **Part A (Developer).**
   - Edit only the spec and the squawk. Keep the step table's two-column Zephyr format (`.flightops/ARTIFACTS.md` *Behavior Test — Spec*).
   - Insert steps 12–13 after 11. Do not renumber 1–11.
   - Reuse the `download-true-type` or `downloads` fixture server for step 13 if one serves a plain-text attachment; otherwise describe a tiny one-line server in the step.
2. **Part B (Flight Director).**
   - After the flight commit, ask the operator to launch per the spec's preconditions and unlock the vault.
   - Then invoke `/mission-control:behavior-test admin-reach-refusal`.
   - Relay each by-eye read to the operator one at a time.

## Edge Cases

- **The vault cannot be unlocked in the scratch profile** (no vault exists): part B creates one through the operator, or records steps 5 and 10–12 as not run. The leg does not land "in full" in that case; escalate to the operator.
- **The download opens anyway on Linux** (`xdg-open` on a `.txt`): that would mean the gate failed, so the step fails. The plain-text type keeps it harmless if it happens.

## Files Affected

- `tests/behavior/admin-reach-refusal.md`, `squawks/0194-admin-reach-refusal-spec-poller-and-tolerance.md` (part A).
- `tests/behavior/admin-reach-refusal/runs/<timestamp>.md` (part B).

## Citation Audit

Checked 2026-11-18:
- The spec's steps 3, 6, 8, 10 and 11 and its preconditions: present as described.
- Squawk 0194's report: present.
- Bridge methods `vaultItemSave` and `vaultReveal` (`internal-preload.js`) and `openDownloadedFile` (`chrome-preload.js`): present.
- Fixtures `tests/behavior/fixtures/download-true-type`, `downloads`: present.
