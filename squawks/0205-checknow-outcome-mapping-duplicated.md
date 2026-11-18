# Squawk 0205: The update checker maps a raw outcome to the page's answer in two places

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-18
**Completed**: —

## Report
Sortie 09 added `checkNow` to the update checker. The mapping from a raw check outcome (`newer`, `current`, every failure code, `aborted`, `timeout`) to the three public answers (`newer`, `current`, `failed`) is written out twice — once where `lastCheck` is recorded and once in `checkNow`'s answer. A new outcome code would have to be added to both.

## Evidence
- `src/main/update-check.js` — `lastCheck = { at: now(), outcome: outcome === 'newer' || outcome === 'current' ? outcome : 'failed' };` and, in `checkNow`, `return { outcome: raw === 'newer' || raw === 'current' ? raw : 'failed' };`
- Sortie 09 debrief, Technical and Action Items.

## Corrective Action
*(written at completion)*

## Verification
One small helper used by both sites; `test/unit/update-check.test.js` passes unchanged.
