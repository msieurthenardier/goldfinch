# Squawk 0143: Duplicated empty-history fallback in the `tab-navigate` reload branches

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-10
**Completed**: 2026-10-24

## Report
The `tab-navigate` handler in `src/main/register-tab-ipc.js` now has two reload branches, `verb === 'reload'` and `verb === 'reloadIgnoringCache'` (Sortie 03). Each repeats the same fallback: a crashed-before-first-commit guest has an empty `navigationHistory`, so the handler calls `wc.loadURL(effectiveUrl(entry))` with an identical `.catch` logger instead of reloading. The fix is to extract one small helper that takes the reload call, so a third navigation verb doesn't copy the block again. `register-tab-ipc.test.js`'s existing reload and `reloadIgnoringCache` tests (including the empty-history cases) cover the refactor.

## Evidence
- `src/main/register-tab-ipc.js` — `} else if (verb === 'reload') {` … `if (entry && wc.navigationHistory.length() === 0) { wc.loadURL(effectiveUrl(entry)).catch(…)` … `} else { wc.reload(); }`
- `src/main/register-tab-ipc.js` — `} else if (verb === 'reloadIgnoringCache') {`, the same block with `wc.reloadIgnoringCache()`.
- Sortie 03 debrief, Recommendation 4 (`sorties/03-hard-reload/flight-debrief.md`). The flight's DD4 allowed a shared helper but none was taken.

## Corrective Action
Picked up at the 2026-10-23 turnaround. Added a local `reloadOrLoadEffective(wc, wcId, owner, label, reloadCall)` helper in `src/main/register-tab-ipc.js` (just above the `tab-navigate` handler). Both the `reload` and `reloadIgnoringCache` branches now call it. Same empty-`navigationHistory` condition, same `loadURL(effectiveUrl(entry))` fallback, and the same `.catch` log text (`reload` / `hard-reload` label interpolated). No behavior change.

## Verification
No test or pin edits were needed. `register-tab-ipc.test.js` reload and `reloadIgnoringCache` tests (including the empty-history cases) cover the refactor. See the gate results in the implementation report.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped, turnaround batch)
**Verdict**: confirmed, with no blocking issues. Behavior is equivalent: the same guard, `loadURL(effectiveUrl(entry))` and else branch, and the log strings are preserved through the label. The batch gates were `npm test` 6041 (6037 pass, 0 fail, 4 todo), with typecheck, lint and format:check clean.
**Commit**: the `squawk: turnaround 2026-10-23` commit on `squawk/turnaround-2026-10-23`

## Disposition
**Deferred**: logged from the Sortie 03 debrief. This is debt only, with no behavior change. Revisit before any third reload-like `tab-navigate` verb is added, or at the next squawk turnaround.
