# Squawk 0182: The client-certificate picker gives no visual cue while it is ignoring input

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-14
**Completed**: —

## Report
Found during Mission 23 Flight 1's `prompts-and-bounds` leg. The certificate picker ignores activation for 500 ms after it opens, like the vault picker, but unlike the vault picker it does not dim its rows during that time, so an early click simply appears to do nothing. Not walked at the HAT (group 2 was not walked).

## Evidence
- `src/renderer/menu-overlay.js` — the vault picker adds and removes the `vault-picker-arming` class around its delay; the certificate picker's open handler has no equivalent.
- `src/renderer/menu-overlay.css` — `#sheet-vault-picker.vault-picker-arming .cm-item` is the only arming style.

## Corrective Action
*(written at completion)*

## Verification
Give the certificate picker the same one-class cue for the delay taken from `src/shared/sheet-arming.js`. Cosmetic only — the gate itself is a timestamp in the shared sender and must not be touched. By eye (the sheet is not observable to automation); a source-scan pin in the style of `sheet-arming.test.js`.

## Sign-Off
*(written at completion)*
