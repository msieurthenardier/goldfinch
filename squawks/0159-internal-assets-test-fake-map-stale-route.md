# Squawk 0159: internal-assets test's synthetic map carries a settings route the real map dropped

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-23
**Completed**: 2026-10-24

## Report
`test/unit/internal-assets.test.js` builds its own synthetic route map, which still serves `/audit-paging.js` under the `settings` host. Sortie 05 moved that route to the `automation` host in the real `internal-page-map.js`. The test exercises the resolver against its own fake, so it still passes and nothing is broken. But a reader comparing it to the real map is misled about what the Settings page serves. Retarget the fake's audit-paging case to an `automation` host entry, or use a neutral host name.

## Evidence
- `test/unit/internal-assets.test.js` — `const syntheticMap = { settings: { …, '/audit-paging.js': FAKE_AUDIT_JS } }` and `resolve('settings', '/audit-paging.js')`
- `src/main/internal-page-map.js` — `settings` entry has no `/audit-paging.js` route after sortie 05; `automation` does.

## Corrective Action
In `test/unit/internal-assets.test.js`, moved `/audit-paging.js` out of the fake `settings` entry into a new fake `automation` entry (matching the real map after sortie 05), retargeted the audit-paging test to `resolve('automation', ...)`, and added an assertion that `settings` no longer serves it. Assertions on content type and file are unchanged.

## Verification
Run `node --test test/unit/internal-assets.test.js` and confirm it passes with the retargeted fake.

Results: internal-assets test 23 pass, 0 fail; `npm run format`, `format:check` clean; `npm run lint` clean; `npm test` 6028 pass, 0 fail.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped, turnaround batch)
**Verdict**: confirmed, with no blocking issues. Correct and test-only: `audit-paging.js` moved under a fake `automation` host, plus a `resolve('settings', '/audit-paging.js') === null` assertion. The batch gates were `npm test` 6041 (6037 pass, 0 fail, 4 todo), with typecheck, lint and format:check clean.
**Commit**: the `squawk: turnaround 2026-10-23` commit on `squawk/turnaround-2026-10-23`
