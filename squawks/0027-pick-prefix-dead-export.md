# Squawk 0027: `PICK_PREFIX` export in `vault-picker-template.js` has no importer

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: —

## Report

`src/shared/vault-picker-template.js` exports `PICK_PREFIX` but nothing imports it. Its sibling `CERT_PICK_PREFIX` is deliberately mirrored as a literal in `register-overlay-ipc.js:17` for the CJS/ESM split. Either mirror `PICK_PREFIX` the same way (if a consumer is intended) or drop the export.

Source: maintenance report 2026-08-27, finding F28.

## Evidence

- `src/shared/vault-picker-template.js:26` — the export; `grep -rn PICK_PREFIX src test` → no importer of the un-prefixed name

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
**Reviewer**: —
**Verdict**: —
**Commit**: —
