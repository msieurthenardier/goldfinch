# Squawk 0035: Tracker engine's registrable-domain check is not PSL-backed — multi-tenant suffixes fail open

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: —

## Report

GitHub issue #81 (security audit finding F5). `trackers.js` derives the registrable domain from a hand-maintained `MULTI_SUFFIX` set, so unrelated tenants sharing a multi-tenant public suffix (e.g. S3 buckets) are treated as the same site and third-party cookie stripping / tracker blocking silently fail open. The decision the issue was blocked on — dependency vs shipped list — was made by Mission 12: `src/main/vault/psl.js` + `public_suffix_list.dat` (333 KB, parsed once, fail-closed) shipped 2026-07-24. Back `registrableDomain` with that module (relocate it out of `vault/` to a shared location), delete the now-misleading "do not pull in a PSL package" comment, and add the S3-bucket unit case. Operator ruling 2026-08-27: PSL fail-closed behaviour for unlisted TLDs is acceptable for the tracker engine.

Source: maintenance report 2026-08-27, finding F53 (#81).

## Evidence

- `src/main/trackers.js:7-16` — "do not pull in a PSL package"; `:77` — `MULTI_SUFFIX` walk
- `src/main/vault/psl.js`, `public_suffix_list.dat` — commit `82f6eb2`, 2026-07-24

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
**Reviewer**: —
**Verdict**: —
**Commit**: —
