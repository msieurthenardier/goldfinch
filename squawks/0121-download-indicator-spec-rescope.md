# Squawk 0121: download-indicator spec: re-scope popup steps the apparatus can no longer observe

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: —

## Report
Steps 5–8 assert things about the downloads popup sheet. It has been unobservable to automation since the secret-sheet resolver refusal (82f6eb2, 2026-07-24), and its a11y state has been skipped since squawk 0045. The AC12 re-run was therefore 4 pass + 4 apparatus-inconclusive. Re-scope the spec:
- keep the observable clauses (`aria-expanded`, `sheetVisible`/`sheetWcId`, `downloadsList`);
- move popup structure, the in-progress row, footer activation and popup a11y to `[by-eye]` HAT checkpoints, or cite their unit tests (`downloads-popup-contract.test.js`, `downloads-controller.test.js`);
- use Ctrl+J to check that `openDownloads()` is reachable;
- update the stale Apparatus note;
- adopt a slow-download fixture so the in-progress state is observable.

## Evidence
`tests/behavior/download-indicator/runs/2026-10-06-13-24-48.md`; `src/main/automation/resolve.js` `AUTOMATABLE_MENU_TYPES` (no `downloads`).

## Corrective Action
*(written at completion)*

## Verification
*(written at completion)*

## Sign-Off
*(written at completion)*
**Reviewer**:
**Verdict**:
**Commit**:
