# Squawk 0129: Settings 'Enable automation surface' reads OFF while force-bound by --automation-dev

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: —

## Report
On a dev launch (`npm run dev:automation`, which force-binds the MCP surface via `--automation-dev`), `goldfinch://settings` shows "Enable automation surface" unchecked while also saying "Connected — listening on 127.0.0.1:<port>". The toggle reflects the persisted `automationEnabled` setting, not the forced runtime state, so the copy contradicts itself. Show the forced state (checked and disabled, with a "forced on by dev launch" note).

## Evidence
`src/renderer/pages/settings.js:736` (`automation-enabled` toggle), `:864` (`settingsGet('automationEnabled')`); sortie 02 AC10 run, step 15 screenshots.

## Corrective Action
*(written at completion)*

## Verification
*(written at completion)*

## Sign-Off
*(written at completion)*
**Reviewer**:
**Verdict**:
**Commit**:
