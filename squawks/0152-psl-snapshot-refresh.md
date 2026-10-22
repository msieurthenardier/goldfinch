# Squawk 0152: Refresh the vendored Public Suffix List snapshot (blocks the 0.19.4 release)

**Status**: completed
**Type**: servicing
**Severity**: grounding
**Reported**: 2026-10-22
**Completed**: 2026-10-22

## Report
The `preversion` guard refuses the 0.19.4 patch bump because the vendored PSL snapshot is 94 days old (limit 90). `docs/RELEASING.md` requires the refresh to land as its own reviewed change before the release. That procedure:
1. Run `node scripts/update-psl.mjs`.
2. Re-check `SUPPLEMENT_SUFFIX` against the new `.dat`.
3. Run `npm test` and review the curated `TRACKERS` table.

This is grounding for the release only.

## Evidence
- `node scripts/check-psl-fresh.mjs` → "Refusing to bump the version: the vendored Public Suffix List snapshot is 94 days old (limit 90 days)." (exit 1).
- `src/main/psl.js` — `//   Snapshot: 2026-07-20 (file header VERSION 2026-07-20_19-17-05_UTC)`; `src/main/public_suffix_list.dat` was 16420 lines before the refresh.
- `src/main/trackers.js` — `const SUPPLEMENT_SUFFIX = new Set(['amazonaws.com', 'netlify.com', 'surge.sh', 'glitch.me']);`
- Precedent: squawk 0117 (the freshness guard).

## Corrective Action
Ran `node scripts/update-psl.mjs` (fetches only publicsuffix.org, validates, never commits): `src/main/public_suffix_list.dat` VERSION `2026-07-20_19-17-05_UTC` -> `2026-10-20_08-40-56_UTC` (COMMIT `5dd321f`), and the `Snapshot:` line in `src/main/psl.js` -> `2026-10-20`. `git diff --numstat`: `.dat` 322 added / 180 removed lines, `psl.js` 1/1. By rule (comments excluded): 10244 -> 10396 rules, 202 added, 50 removed. No other source changes.

`SUPPLEMENT_SUFFIX` re-check: `surge.sh` is now a native PSL PRIVATE-section rule, so PSL resolves `a.surge.sh` itself and the supplement no longer fires for it (the `safe === suffix` guard makes it inert, the comment's "PSL always wins" case). `amazonaws.com`, `netlify.com` and `glitch.me` still have no bare-suffix rule (only deeper rules for amazonaws.com), so the supplement is still needed for them. Behavior is unchanged either way; the stale `surge.sh` entry and the "Checked 2026-08-27 / snapshot 2026-07-20" comment in `src/main/trackers.js` were NOT edited (left for a follow-up decision).

## Verification
Developer, 2026-10-22:
- `node scripts/check-psl-fresh.mjs` -> "PSL snapshot is 2 days old (limit 90) - ok." (exit 0).
- `npm test`: 5974 tests, 5970 pass, 0 fail, 0 cancelled, 0 skipped (includes `psl.test.js` against the new `.dat`).
- `TRACKERS` review: ran `registrableDomain` over all 69 `TRACKERS` keys (plus `x.<key>` and `a.b.<key>`) under the old (`git show HEAD:`) and new `.dat`: 0 differences.
- Supplement probe: `a.amazonaws.com`, `a.netlify.com`, `a.glitch.me` -> PSL still returns the bare suffix, final result keeps the tenant label via the supplement; `a.surge.sh` -> PSL now returns `a.surge.sh` natively. All final results unchanged from before.
- `npm run typecheck`, `npm run lint`, `npm run format:check`: clean.
- `git diff --stat`: `src/main/psl.js` (1 line), `src/main/public_suffix_list.dat`, plus this squawk file.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped)
**Verdict**: confirmed, no blocking or non-blocking issues.
- The `.dat` is byte-identical (`cmp`) to a fresh fetch of publicsuffix.org (VERSION `2026-10-20_08-40-56_UTC`), with headers and section markers intact and nothing injected.
- `psl.js` changes only the one `Snapshot:` line.
- The Reviewer's own old-vs-new `registrableDomain` sweep over 223 hosts (the `TRACKERS` keys and the `SUPPLEMENT_SUFFIX` forms) found 0 differences.
- Gates re-run: `npm test` 5974 (5970 pass, 0 fail, 4 todo); `check-psl-fresh` ok; typecheck, lint and format:check clean.
- Beyond this diff, the now-inert `surge.sh` `SUPPLEMENT_SUFFIX` entry and its stale "Checked 2026-08-27" comment in `trackers.js` are left for a separate cleanup squawk.

**Commit**: the `squawk/0152` commit on `squawk/0152-psl-refresh`
