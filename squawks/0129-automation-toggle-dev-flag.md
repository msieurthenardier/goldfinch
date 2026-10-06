# Squawk 0129: Settings 'Enable automation surface' reads OFF while force-bound by --automation-dev

**Status**: escalated
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

## Disposition
**Escalated** (2026-10-06, turnaround): fails squawk criterion 3 (bounded blast radius, no shared-interface change). The internal settings page learns automation state only from `automationGetStatus()` (`{enabled, host, port, bound, error}`, built by `currentAutomationStatus()` in `src/main/main.js` and served by `automation:get-status` in `src/main/register-settings-ipc.js`). The dev force-bind flag (`devEnableOverride`, `src/main/main.js`) is module-private and never exposed.

A correct fix adds a `forced` field to that payload, which is a main↔internal-page contract change touching the `.d.ts` and the register tests. Inferring it (`bound && !automationEnabled`) is racy during a user flip-off.

→ **Sortie candidate (small):** "Expose dev force-bind in automation status; render the toggle checked and disabled with a 'Forced on by the dev launch' note". No code was changed.

