# Squawk 0110: One-off flake in vault `listItemsMeta` test

**Status**: deferred
**Type**: defect
**Severity**: routine
**Reported**: 2026-09-29
**Completed**: —

## Report
During Sortie 01 leg 1, one full `npm test` run failed `listItemsMeta returns metadata for all three types with NO secret field/value`; it passed on immediate re-run and in every later full run (FD re-run 5722/0; flight Reviewer 5748/0). Not reproducible on demand.

## Evidence
`test/unit/vault-item-management.test.js` — "listItemsMeta returns metadata for all three types with NO secret field/value". Reported in `sorties/01-default-browser/flight-log.md` (leg 1 anomaly). Sortie 01 did not touch `src/main/vault/`.

## Corrective Action
*(written at completion)*

## Verification

## Sign-Off
*(written at completion)*

## Disposition
**Deferred**: single unreproduced occurrence; no failure output was captured — revisit when it recurs (capture the failing assertion and seed/timing), or the next time `vault-item-management.test.js` or `listItemsMeta` is touched.
