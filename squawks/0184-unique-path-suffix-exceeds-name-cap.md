# Squawk 0184: De-duplicating a download name can push it past the sanitiser's length cap

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-14
**Completed**: 2026-11-19

## Report
Found by the Developer of Mission 23 Flight 1's `downloads` leg. `sanitizeFilename` caps a name at 180 bytes, but `uniquePath` then inserts ` (n)` before the extension without re-checking, so a name at the cap can reach about 184 bytes. Harmless today (file systems allow 255), but the cap is no longer the cap.

## Evidence
- `src/main/download-path.js` — `MAX_NAME_BYTES = 180`, applied in `sanitizeFilename`.
- `src/main/register-download-ipc.js` — `uniquePath` builds `base (n)ext` from the already-sanitised name.

## Corrective Action
`download-path.js` gains `dedupedName(safe, n)` (reuses `cutToBytes`, `EXTENSION_PATTERN`, `MAX_NAME_BYTES`; exported): builds `stem (n).ext`, cutting the stem in whole code points so the total stays within the cap and the 1-16 char extension is kept. `register-download-ipc.js` `uniquePath` now calls it (required directly; pure module). The ` (n)` suffix shape is unchanged, so the update-download matcher is unaffected.

## Verification
Reserve room for the suffix, or re-apply the byte cap to the stem after adding it, keeping the extension. Unit: a name at the cap that needs ` (12)` stays at or under the cap and keeps its extension.

Ran: `node --test` on download-path, register-download-ipc, register-update-ipc: 136 pass, 0 fail (3 new `dedupedName` tests: at-cap with ` (12)`, extensionless/short, multi-byte é/日/😀 stems). `npm test`: 7388 pass, 0 fail. lint, typecheck, format:check clean.

Added: `register-download-ipc.test.js` test pinning that `uniquePath` de-duplicates through `dedupedName` (180-byte existing name stays within 180 bytes, keeps its extension).

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the fourth 2026-11-19 turnaround)
**Verdict**: confirmed. Byte math, code-point-safe cutting, extensionless names and the unchanged ` (n)` suffix shape (the update-download matcher's tests pass) all hold; the direct `require` of `dedupedName` from the pure `download-path.js` was judged acceptable. One low finding — no test pinned `uniquePath` calling `dedupedName` (reverting the call site still passed) — was fixed with a `will-download` test over a taken 180-byte name, which the Reviewer neuter-verified (reverting the call site fails it). Gates at re-review: `npm test` 7,404 tests (7,399 pass, 0 fail, 1 skipped — the `jq` test, no `jq` on the dev host — and 4 todo); lint, typecheck and format:check clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-d`
