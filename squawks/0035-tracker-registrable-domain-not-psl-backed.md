# Squawk 0035: Tracker engine's registrable-domain check is not PSL-backed — multi-tenant suffixes fail open

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: 2026-08-27

## Report

GitHub issue #81 (security audit finding F5). `trackers.js` derives the registrable domain from a hand-maintained `MULTI_SUFFIX` set, so unrelated tenants sharing a multi-tenant public suffix (e.g. S3 buckets) are treated as the same site and third-party cookie stripping / tracker blocking silently fail open. The decision the issue was blocked on — dependency vs shipped list — was made by Mission 12: `src/main/vault/psl.js` + `public_suffix_list.dat` (333 KB, parsed once, fail-closed) shipped 2026-07-24. Back `registrableDomain` with that module (relocate it out of `vault/` to a shared location), delete the now-misleading "do not pull in a PSL package" comment, and add the S3-bucket unit case. Operator ruling 2026-08-27: PSL fail-closed behaviour for unlisted TLDs is acceptable for the tracker engine.

Source: maintenance report 2026-08-27, finding F53 (#81).

## Evidence

- `src/main/trackers.js:7-16` — "do not pull in a PSL package"; `:77` — `MULTI_SUFFIX` walk
- `src/main/vault/psl.js`, `public_suffix_list.dat` — commit `82f6eb2`, 2026-07-24

## Corrective Action

Relocated `src/main/vault/psl.js` + `public_suffix_list.dat` to `src/main/psl.js` +
`src/main/public_suffix_list.dat` via `git mv` (data file content untouched); updated the
two require sites (`src/shared/origin-match.js`, `test/unit/psl.test.js`) and the stale
path references in `psl.js`'s own header comment and `docs/vault.md`. `package.json`'s
`files` glob (`src/**/*`) already covers the new location — no packaging change needed.

`src/main/trackers.js`'s `registrableDomain` now delegates to `psl.js`'s
`registrableDomainSafe`, keeping its existing `isIpLiteral` short-circuit (PSL has no
concept of IP identity). Deleted the `MULTI_SUFFIX` set and the "do not pull in a PSL
package" comment (nothing else referenced `MULTI_SUFFIX`); replaced with a comment
explaining the delegation and its residual. When `registrableDomainSafe` returns `null`
(unlisted TLD, host IS a public suffix, a bare single label like `localhost`, or an
over-stale snapshot), `registrableDomain` falls back to the whole hostname unchanged —
fail-closed per the operator's 2026-08-27 ruling: it can under-strip a legitimate
subdomain on an unlisted suffix, but it can never merge two distinct hosts into one
"site" (the original bug). This fallback also reproduces the pre-existing `localhost` and
IP-literal test expectations without a special case, since PSL returns `null` for those
too.

**Review correction (2026-08-27, BLOCKING):** the "fail-closed residual" claim above was
wrong for four of the old `MULTI_SUFFIX` platform entries. `amazonaws.com`, `netlify.com`,
`surge.sh`, and `glitch.me` each sit directly under a real ICANN TLD (`.com`, `.sh`,
`.me`) with no matching PRIVATE-section rule in the vendored `.dat`. Because that parent
TLD *is* listed, `registrableDomainSafe` does not fail closed (return `null`) for these —
it resolves via the bare ICANN rule and returns a non-null but WRONG registrable domain
that drops the tenant label (`tenant-a.netlify.com` -> `netlify.com`), silently
re-merging tenants — the exact bug this squawk exists to fix, for those four. Confirmed
by running every old `MULTI_SUFFIX` entry through `registrableDomainSafe` on a synthetic
tenant host and diffing against the expected split: those four are the only ones that
differ (every other entry, including `github.io`, `s3.amazonaws.com`, `vercel.app`,
resolves correctly via the PSL alone).

Fixed by adding a small curated `SUPPLEMENT_SUFFIX` set in `trackers.js` containing
exactly those four confirmed-absent entries, unioned with the PSL result inside
`registrableDomain`: when the host's last two labels match a supplement entry *and* the
PSL's answer is exactly that bare suffix (no deeper PSL rule fired), the old curated
3-label split (`<label>.<suffix>`) is applied instead. A more specific PSL match (e.g.
`s3.amazonaws.com`'s own PRIVATE rule) is never equal to the bare 2-label suffix, so it's
left untouched — the PSL stays the primary source and always wins when it has a more
specific answer; the supplement only adds the four confirmed gaps. If the `.dat` later
gains matching PRIVATE entries for these, the supplement stops firing on its own.

## Verification

`timeout 180 npm test` — 3825/3825 pass (0 fail), including all of `test/unit/psl.test.js`
(unaffected by the move — same module, same behavior) and `test/unit/trackers.test.js`
(all pre-existing cases hold unchanged, plus five original squawk-0035 cases: two
S3-bucket hostnames under `s3.amazonaws.com` resolve to distinct registrable domains and
are third-party to each other via `classify`; two `github.io` tenants resolve distinct
(PSL-backed, not the old curated set); an unlisted made-up TLD (`madeupzzznotatld`) fails
closed per `registrableDomainSafe` returning `null` — pinned as two different tenant
hosts under it staying distinct via the whole-hostname fallback, never merging); plus four
new review-fix cases: two tenants under each of the four supplemented suffixes are
different sites (and third-party via `classify`); `s3.amazonaws.com` and `github.io`
still resolve via the PSL, not the supplement; a bare supplemented suffix host (no tenant
label) is unaffected. `npm run lint` — clean. `npm run typecheck` — clean.

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the Developers' reasoning) — two review cycles — cycle 1 found a blocking issue (PSL delegation silently merged tenants under four suffixes absent from the vendored PSL); fixed with a curated supplement set unioned with the PSL result, verified live by the Reviewer in cycle 2; batch turnaround 2026-08-27 (batch 1)
**Verdict**: confirmed
**Commit**: `squawk: turnaround 2026-08-27 (batch 1)` on `squawk/turnaround-2026-08-27-1` (PR number recorded on the PR itself)

Batch gates at review: 3825/3825 tests, lint clean, typecheck clean.
