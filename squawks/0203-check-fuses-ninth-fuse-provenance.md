# Squawk 0203: check-fuses names the ninth fuse by index with no provenance or retirement hint

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-17
**Completed**: —

## Report
Electron 45's fuse wire has a ninth fuse that `@electron/fuses` 1.8.0 does not name; `scripts/check-fuses.mjs` names it locally by index (`WasmTrapHandlers`). When the library learns the name, the check will fail as an unknown or missing fuse with no hint why; if Electron ever reorders the wire, the local name would silently describe the wrong fuse.

## Evidence
- `scripts/check-fuses.mjs` — `const LOCAL_NAMES = Object.freeze({ 8: 'WasmTrapHandlers' });`
- Flight 3 flight log, leg 03 entry (the finding).

## Corrective Action
*(written at completion)*

## Verification
A comment beside `LOCAL_NAMES` records the Electron version and the symbol the index was read from; the failure message for an unknown or missing fuse says to retire a local name the library now provides; `test/unit/check-fuses.test.js` covers the message.
