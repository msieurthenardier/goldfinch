# Squawk 0159: internal-assets test's synthetic map carries a settings route the real map dropped

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-23
**Completed**: —

## Report
`test/unit/internal-assets.test.js` builds its own synthetic route map, which still serves `/audit-paging.js` under the `settings` host. Sortie 05 moved that route to the `automation` host in the real `internal-page-map.js`. The test exercises the resolver against its own fake, so it still passes and nothing is broken. But a reader comparing it to the real map is misled about what the Settings page serves. Retarget the fake's audit-paging case to an `automation` host entry, or use a neutral host name.

## Evidence
- `test/unit/internal-assets.test.js` — `const syntheticMap = { settings: { …, '/audit-paging.js': FAKE_AUDIT_JS } }` and `resolve('settings', '/audit-paging.js')`
- `src/main/internal-page-map.js` — `settings` entry has no `/audit-paging.js` route after sortie 05; `automation` does.

## Corrective Action
*(written at completion)*

## Verification
Run `node --test test/unit/internal-assets.test.js` and confirm it passes with the retargeted fake.

## Sign-Off
*(written at completion)*
