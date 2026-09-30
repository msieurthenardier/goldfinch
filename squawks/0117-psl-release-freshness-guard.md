# Squawk 0117: PSL release-time freshness guard

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-29
**Completed**: 2026-09-29

## Report
The vendored Public Suffix List only changes when someone refreshes it by hand, and nothing in the release flow checks it. Each shipped build freezes its snapshot, and `psl.js` has a hard 365-day cutoff, so a build shipped with a stale list reaches that cutoff early in the field. Past the cutoff, tracker classification and third-party cookie stripping fall back to treating each whole hostname as its own site, and vault `registrable-domain` matching drops to exact-match only. The current snapshot (2026-07-20) hits the cutoff on **2027-07-20**.

Fix (option 3, operator ruling 2026-09-29). The release path stays offline, and a refresh is always its own reviewed commit:
- `scripts/update-psl.mjs`: fetches ONLY from `https://publicsuffix.org/list/public_suffix_list.dat`, checks that the body has a `// VERSION:` header and the ICANN/PRIVATE section markers, then overwrites `src/main/public_suffix_list.dat` and prints the old and new VERSION. It also updates the `Snapshot:` line in the `psl.js` header comment. It never commits.
- `preversion` npm hook: refuses the bump (non-zero exit) when the vendored snapshot is older than **90 days**, and prints `node scripts/update-psl.mjs` as the fix. No network access. The age is read from `SNAPSHOT_MS` in `src/main/psl.js`, the same parse the runtime uses. The age decision lives in a small pure helper so it can be unit-tested.
- A `docs/RELEASING.md` checklist entry: refresh the PSL if the hook refuses, or if it has been a while. After any refresh, re-check the `SUPPLEMENT_SUFFIX` entries in `src/main/trackers.js` (amazonaws.com, netlify.com, surge.sh, glitch.me) against the new .dat, run `npm test` (`psl.test.js` tests against the vendored .dat directly), and review the curated `TRACKERS` table.

Out of scope: adopting a maintained tracker blocklist, which would be a possible future sortie. The tracker table stays hand-curated.

## Evidence
- `src/main/psl.js:128` — `const PSL_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;` and `registrableDomainSafe`: `if (isPslStale(...)) return null; // over-stale → no widening (fail-closed)`
- `src/main/psl.js:parseSnapshotMs` reads `// VERSION: YYYY-MM-DD` from the .dat. `src/main/public_suffix_list.dat` currently has `VERSION: 2026-07-20_19-17-05_UTC`.
- `package.json` `scripts`: the only release lifecycle hook is `version` (`update-readme.mjs`). There is no `preversion`.
- `src/main/trackers.js:SUPPLEMENT_SUFFIX`: the comment says it was checked against the 2026-07-20 snapshot and needs re-checking whenever the .dat changes.

## Corrective Action
- `scripts/lib/psl-freshness.mjs`: pure `pslFreshness(snapshotMs, nowMs, maxAgeDays=90)` (fail-closed on missing/NaN) and `validatePslBody`.
- `scripts/check-psl-fresh.mjs`: offline; reads `SNAPSHOT_MS` from `src/main/psl.js`, exits 1 naming `node scripts/update-psl.mjs` when stale. Wired as the `preversion` npm script (`version` hook unchanged).
- `scripts/update-psl.mjs`: fetches only the hardcoded publicsuffix.org URL, validates, rewrites the .dat and the `psl.js` `Snapshot:` line, prints old -> new VERSION plus a post-refresh checklist; writes nothing on failure; never commits.
- Docs: `docs/RELEASING.md` preversion/refresh checklist, CLAUDE.md release short form, `psl.js` REFRESH comment. Vendored .dat untouched.

## Verification
- `node scripts/check-psl-fresh.mjs` -> "PSL snapshot is 72 days old (limit 90) - ok.", exit 0.
- New `test/unit/psl-freshness.test.js` (boundary 89/90/90d+1ms/91, NaN/null fail-closed, body validation): 4 pass.
- `npm test`: 5757 tests, 5753 pass, 0 fail. `npm run lint`, `npm run typecheck`, `npm run format:check` clean.
- update-psl.mjs not run against the network (by design); Snapshot-line regex checked offline against psl.js.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped)
**Verdict**: confirmed — non-blocking notes accepted: `.dat` and `psl.js` are written in sequence, not atomically (runtime reads only the `.dat`, so if the second write fails only the header comment lags); one long comment line in the `psl.js` REFRESH header; the `SUPPLEMENT_SUFFIX` re-check stays a manual step on purpose, since it needs judgment
**Commit**: the `squawk/0117: PSL release-time freshness guard` commit on `squawk/0117-psl-release-freshness-guard`
