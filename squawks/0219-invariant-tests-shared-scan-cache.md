# Squawk 0219: Source-scan invariant tests re-read and re-parse `src/main/**` each time; one file is 60 % of the suite's wall-clock

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-18
**Completed**: —

## Report
`npm test` wall-clock went from ~3.4 s (3,792 tests, 2026-08-27) to ~9–10 s (7,323 tests). The critical path is `ipc-gate-invariant.test.js` at ~5.9 s standalone; files run in parallel, so nothing else moves the total. Memoize the shared read/parse in one `test/helpers/` module (and split `ipc-gate-invariant` by concern if the cache alone is not enough), before the next mission adds more scan tests. Known Mission 23 debt; finding #6.

## Evidence
- Standalone times (tool pass 2026-11-18): `ipc-gate-invariant` 5.9 s; next largest `vault-compromise-rotate` 2.7 s, `vault-txn` 2.1 s.
- Trend across flight debriefs: 4.97 s (M19) → 6.5 s → 8.2 s (sortie 08) → 9.4 s (M23 F1) → ~9 s.

## Corrective Action
*(written at completion)*

## Verification
`ipc-gate-invariant` standalone time and `npm test` wall-clock before/after recorded; every scan test still neuter-verified against the cached reader.
