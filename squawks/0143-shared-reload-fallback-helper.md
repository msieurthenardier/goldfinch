# Squawk 0143: Duplicated empty-history fallback in the `tab-navigate` reload branches

**Status**: deferred
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-10
**Completed**: —

## Report
The `tab-navigate` handler in `src/main/register-tab-ipc.js` now has two reload branches, `verb === 'reload'` and `verb === 'reloadIgnoringCache'` (Sortie 03). Each repeats the same fallback: a crashed-before-first-commit guest has an empty `navigationHistory`, so the handler calls `wc.loadURL(effectiveUrl(entry))` with an identical `.catch` logger instead of reloading. The fix is to extract one small helper that takes the reload call, so a third navigation verb doesn't copy the block again. `register-tab-ipc.test.js`'s existing reload and `reloadIgnoringCache` tests (including the empty-history cases) cover the refactor.

## Evidence
- `src/main/register-tab-ipc.js` — `} else if (verb === 'reload') {` … `if (entry && wc.navigationHistory.length() === 0) { wc.loadURL(effectiveUrl(entry)).catch(…)` … `} else { wc.reload(); }`
- `src/main/register-tab-ipc.js` — `} else if (verb === 'reloadIgnoringCache') {`, the same block with `wc.reloadIgnoringCache()`.
- Sortie 03 debrief, Recommendation 4 (`sorties/03-hard-reload/flight-debrief.md`). The flight's DD4 allowed a shared helper but none was taken.

## Corrective Action
—

## Verification
—

## Sign-Off
—

## Disposition
**Deferred**: logged from the Sortie 03 debrief. This is debt only, with no behavior change. Revisit before any third reload-like `tab-navigate` verb is added, or at the next squawk turnaround.
