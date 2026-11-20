# Squawk 0160: Port field shows a false "(unsaved — applies on Save)" hint when the bound port is env-pinned

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-10-24
**Completed**: 2026-11-19

## Report
On `goldfinch://automation`, the bound port can differ from the persisted `automationPort`. That happens when `GOLDFINCH_MCP_PORT` pins it in an unpackaged build, or when a port fallback was used. In that case the Port field misreports a saved value as unsaved:
- **After a reload, or after Find free port:** the field shows the persisted port and the "(unsaved — applies on Save)" hint, even though that value is already saved. Save is disabled.
- **Straight after Save:** the field instead showed the bound port.

The hint's meaning depends on which port the field happened to be seeded from. Seen during the squawk 0156 `settings-automation` run (Steps 6, 7 and 9, with the env pinned to 49707 and 49153 persisted).

## Evidence
- `src/renderer/pages/automation.js` `recomputePortNote()` sets the hint when `lastStatus.bound && Number(portInput.value) !== lastStatus.port`. That compares the field with the **bound** port.
- `updatePortSaveDirty()` and the seed paths compare and seed with `savedPort`, the **persisted** port (`settingsGet('automationPort')` / `settings-changed`, ~L167–L194 and ~L293).
- `tests/behavior/settings-automation/runs/2026-10-23-23-19-44.md`: Checkpoints 6, 7 and 9 Validator notes, and Orchestrator Notes, "Squawk candidates".

## Corrective Action
Operator ruling (2026-11-19): the Port field edits the stored setting, so the "(unsaved — applies on Save)" hint AND Save's dirty state both compare the field against the SAVED (persisted) port, and the field is always seeded with the saved port, never the bound port, including straight after Save. Where the server listens stays reported by the moved-port line (`automation-port-note.js`) and the page's status line.

- `src/renderer/pages/automation-port-moved.js`: new pure `portFieldState({ value, savedPort, bound })` (hint + Save-disabled from one comparison) and `savedPortOf(status)` (boot fallback seed only).
- `src/renderer/pages/automation.js`: `recomputePortNote()` and `updatePortSaveDirty()` now both call `portFieldState` against `savedPort`; the Save handler seeds `savedPort` and the field from the SUBMITTED value (not `status`); Find free port likewise seeds from the port it saved (was `status.port`, the bound port); the status-fallback seed uses `savedPortOf`; `isValidPort` removed (moved into the model).
- Found while fixing: under a `GOLDFINCH_MCP_PORT` pin `mcp-server.js`'s `configuredPort` is the env port (`preferred`), not the persisted setting, so `status.configuredPort` cannot be trusted as the saved port; the previous Save handler seeded from it.

**Gap for the FD to log (no copy invented):** in the env-pinned case (bound = env port = status.configuredPort, persisted differs) `portMovedLine(configured, bound)` sees equal ports and returns null, so NO moved-port note appears. The only indication of where it listens is the existing status line ("Connected — listening on 127.0.0.1:<port>") and the address field. A fallback bind (not env pinned) does show the moved-port line. If a note for "env-pinned, differs from saved" is wanted, it needs new copy and a decision.

## Verification
Add a unit test (mock DOM, injected status and settings) for bound ≠ persisted with the field equal to the persisted value: the hint must not read "unsaved". Then confirm live in dev mode with `GOLDFINCH_MCP_PORT` pinned. If the fix needs a ruling on which port the field should show (persisted vs bound), escalate rather than pick one inline.


Ran: `node --test test/unit/automation-port-moved.test.js` 11 pass / 0 fail (new tests: bound != saved with field == saved -> no hint, Save disabled; edited -> hint, Save enabled; field == bound but != saved -> hint; unbound / invalid values; after-Save seed). Neuter-verified (inverting the hint comparison: 4 failures; restored). Seam is the extracted pure decision, because the page controller is a top-level IIFE with no injected deps; the DOM wiring is covered by lint/typecheck only. Live check in dev mode with the env pinned is left to the FD.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the sixth 2026-11-19 turnaround)
**Verdict**: confirmed, no issues, following the operator ruling of 2026-11-19 (the field shows and compares against the SAVED port). Every seed path checked (boot fallback overwritten by the settings read, Save and Find free port seed the submitted value, settings-changed, status pushes never touch the field). **Live** (dev mode, `GOLDFINCH_MCP_PORT=49781`, saved 49707): on load the field read 49707 with no hint and Save disabled; an edit showed the hint and enabled Save; after saving 49790 the field read 49790 with no hint, also after a reload, while the status line read `listening on 127.0.0.1:49781`. Accepted gap: under an env pin no moved-port note appears (only the status line shows where it listens). Gates at re-review: `npm test` 7,430 tests (7,425 pass, 0 fail, 1 skipped — the `jq` test — and 4 todo); lint, typecheck and format:check clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-f`
