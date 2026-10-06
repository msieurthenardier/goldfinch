# Squawk 0121: download-indicator spec: re-scope popup steps the apparatus can no longer observe

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: 2026-10-06

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
Re-scoped `tests/behavior/download-indicator.md`. Observable steps (1-8) now assert only chrome `aria-*`, `enumerateWindows` `sheetVisible`/`sheetWcId`, `downloadsList` and Ctrl+J reachability (`pressKey` on chrome wcId). Popup structure, in-progress row, footer activation and popup a11y became `[by-eye]` HAT steps 5b/6b/7b/8b. Apparatus note rewritten (secret-sheet gate since 82f6eb2). Added downloads-dir isolation recipe (`XDG_CONFIG_HOME/user-dirs.dirs` + `XDG_DOWNLOAD_DIR`) and a run-local slow-download server description (no fixture added; `fixtures/downloads/` holds only the static .bin). Caveat recorded: `downloads-popup-contract.test.js` pins only footer reachability/list structure, not in-progress row rendering, so that checkpoint is by-eye only.

## Verification
Spec-only change; behavior test not run (per instructions). `npm run format:check` run.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the 2026-10-06 turnaround)
**Verdict**: confirmed, no blocking issues (`npm test` x3 green, lint/typecheck/format:check/audit clean). Electron 44.5.0 and SDK 1.31.0 also live-verified by the third-party-cookie-isolation run 2026-10-06-18-13-21 (pass).
**Commit**: the `squawk: turnaround 2026-10-06` commit on `squawk/turnaround-2026-10-06`
