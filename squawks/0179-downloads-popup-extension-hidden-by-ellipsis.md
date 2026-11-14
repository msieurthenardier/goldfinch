# Squawk 0179: The downloads popup can hide a long file name's extension behind its ellipsis

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-14
**Completed**: —

## Report
Found during Mission 23 Flight 1 (finding 6d; left out of the slim `downloads` leg by operator ruling). In the downloads popup a file name is one line that is shortened at its **end**, so a long name loses its extension from view. Display only: the saved name is correct and the operating system shows the real name when the file is opened.

## Evidence
- `src/renderer/menu-overlay.css` — `.dl-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`.
- The row is built in the downloads block of `src/renderer/menu-overlay.js`; its DOM shape is pinned by `test/unit/downloads-popup-contract.test.js`.
- The picker's destination line had the same wrong-end problem and was fixed in the flight by keeping the tail (`destinationLineText` in `src/shared/vault-picker-template.js`).

## Corrective Action
*(written at completion)*

## Verification
Render the name as a stem that may shrink and an extension that never does (two spans, `textContent` only), keeping the contract test's pinned shape. Unit: a pure name-splitting helper (extension = final dot + 1–16 letters or digits, as `download-path.js` defines it). By eye: a 200-character name ending `.exe` shows `.exe`. If the popup's row structure has to change beyond what the contract test allows, that is a shared-surface change — escalate.

## Sign-Off
*(written at completion)*
