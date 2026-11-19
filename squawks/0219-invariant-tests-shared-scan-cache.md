# Squawk 0219: Source-scan invariant tests re-read and re-parse `src/main/**` each time; one file is 60 % of the suite's wall-clock

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-18
**Completed**: 2026-11-19

## Report
`npm test` wall-clock went from ~3.4 s (3,792 tests, 2026-08-27) to ~9–10 s (7,323 tests). The critical path is `ipc-gate-invariant.test.js` at ~5.9 s standalone; files run in parallel, so nothing else moves the total. Memoize the shared read/parse in one `test/helpers/` module (and split `ipc-gate-invariant` by concern if the cache alone is not enough), before the next mission adds more scan tests. Known Mission 23 debt; finding #6.

## Evidence
- Standalone times (tool pass 2026-11-18): `ipc-gate-invariant` 5.9 s; next largest `vault-compromise-rotate` 2.7 s, `vault-txn` 2.1 s.
- Trend across flight debriefs: 4.97 s (M19) → 6.5 s → 8.2 s (sortie 08) → 9.4 s (M23 F1) → ~9 s.

## Corrective Action
Profiled: `ipc-gate-invariant` ran the full `src/main/**` scan (walk, read, `maskComments`, regexes; ~515 ms) once PER TEST, seven times. `scanTree()` is now memoized per process and returned deep-frozen (no test mutates it; verified by reading every caller). `test/helpers/source-scan.js` gained `collectSourcesCached` (frozen list), `readSourceCached` and `maskedSourceCached` (module-level memos; node --test is one process per file, so no cross-file staleness). `ipc-gate-invariant`, `move-tab-synchrony` and `window-closed-invariant` use them (same roots, same `.js` filter, same exclusions: only the walk/read calls changed). No split was needed. Other scan tests (`injected-input`, `crash-reporter-pins`, `badging`, `default-browser`, `vault-binding`) read each file once per process, so a cache gains nothing; left alone.

## Verification
- `ipc-gate-invariant` standalone: before 4.61 / 4.18 / 4.18 s (load 0.8), after 0.61 / 0.61 / 0.59 s (load 0.8-2.4).
- `npm test` wall clock: before 8.09 / 8.31 / 8.36 s (load 0.8-4.3), after 7.97 / 7.90 / 8.09 s (load 2.4-5.4). Barely moved: `ipc-gate-invariant` is no longer the critical path, but total time is now bounded by CPU across ~170 files (next longest standalone: `vault-txn` 4.0 s, `vault-compromise-rotate` 2.9 s, `stable-tag-check` 2.9 s). Further wall-clock gains need work on those, not on scan caching.
- Neuter checks (scratch `src/main/zz-scratch.js`, removed after): raw `ipcMain.handle('x-planted')` + `win.on('closed')` turned `ipc-gate-invariant` red (3 fail) and `window-closed-invariant` red (1 fail); a planted async `moveTabIntoWindow` with `await` turned `move-tab-synchrony` red (1 fail). All green again after removal; `git status` shows no `src/` change.
- Ran: `timeout 300 npm test` (0 fail), `npm run lint`, `npm run typecheck`, `npm run format:check`, all clean after `npm run format`.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. The cached helpers return strings or frozen arrays and `scanTree` a deep-frozen result; no caller mutates them; `collectSourcesCached` wraps the unchanged `collectSources`, so each migrated test scans the same file set. `ipc-gate-invariant` re-measured at 0.6 s standalone. Gates at review: `npm test` 7,384 tests (7,379 pass, 0 fail, 1 skipped — the `jq` test — and 4 todo); lint, typecheck and format:check clean; `git diff main -- src .github/workflows` empty.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19`
