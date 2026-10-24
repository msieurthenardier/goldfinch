# Squawk 0160: Port field shows a false "(unsaved — applies on Save)" hint when the bound port is env-pinned

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-10-24
**Completed**: —

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
*(written at completion)*

## Verification
Add a unit test (mock DOM, injected status and settings) for bound ≠ persisted with the field equal to the persisted value: the hint must not read "unsaved". Then confirm live in dev mode with `GOLDFINCH_MCP_PORT` pinned. If the fix needs a ruling on which port the field should show (persisted vs bound), escalate rather than pick one inline.

## Sign-Off
*(written at completion)*
