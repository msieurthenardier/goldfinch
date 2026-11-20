# Squawk 0203: check-fuses names the ninth fuse by index with no provenance or retirement hint

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-17
**Completed**: 2026-11-19

## Report
Electron 45's fuse wire has a ninth fuse that `@electron/fuses` 1.8.0 does not name; `scripts/check-fuses.mjs` names it locally by index (`WasmTrapHandlers`). When the library learns the name, the check will fail as an unknown or missing fuse with no hint why; if Electron ever reorders the wire, the local name would silently describe the wrong fuse.

## Evidence
- `scripts/check-fuses.mjs` — `const LOCAL_NAMES = Object.freeze({ 8: 'WasmTrapHandlers' });`
- Flight 3 flight log, leg 03 entry (the finding).

## Corrective Action
`scripts/check-fuses.mjs`: a comment above `LOCAL_NAMES` records Electron 45.4.1 (installed `node_modules/electron`), the symbol `electron::fuses::IsWasmTrapHandlersEnabled` read from its binary, and that `@electron/fuses` 1.8.0 does not name index 8. New `LOCAL_HINT` is appended to the unknown-fuse problem and the `Missing` state problem in `decideFuses`: it says to retire the `LOCAL_NAMES` entry once the library names the fuse. `test/unit/check-fuses.test.js`: new test covers both messages and that a plain state flip carries no hint.

## Verification
A comment beside `LOCAL_NAMES` records the Electron version and the symbol the index was read from; the failure message for an unknown or missing fuse says to retire a local name the library now provides; `test/unit/check-fuses.test.js` covers the message.

Ran: check-fuses test 7 pass / 0 fail; neutered the hint text and the new test failed (6 pass / 1 fail), then restored; `npm test` 7445 pass / 0 fail; lint, typecheck and format:check clean.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the eighth 2026-11-19 turnaround)
**Verdict**: confirmed. Provenance checked against the installed packages: Electron 45.4.1 exports `electron::fuses::IsWasmTrapHandlersEnabled`, and `@electron/fuses` 1.8.0 does not name index 8. The retire-the-local-name hint is on the unknown-fuse and missing-fuse failures only; a plain state flip carries none, which the new test asserts (neuter: hint text changed, test red). One low note accepted as is: the hint also appears on a missing fuse that has no local name. Gates at review: `npm test` 7,455 tests (7,450 pass, 0 fail, 5 skipped or todo); lint, typecheck and format:check clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-h`
