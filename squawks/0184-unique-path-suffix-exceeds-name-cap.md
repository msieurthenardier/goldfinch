# Squawk 0184: De-duplicating a download name can push it past the sanitiser's length cap

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-14
**Completed**: —

## Report
Found by the Developer of Mission 23 Flight 1's `downloads` leg. `sanitizeFilename` caps a name at 180 bytes, but `uniquePath` then inserts ` (n)` before the extension without re-checking, so a name at the cap can reach about 184 bytes. Harmless today (file systems allow 255), but the cap is no longer the cap.

## Evidence
- `src/main/download-path.js` — `MAX_NAME_BYTES = 180`, applied in `sanitizeFilename`.
- `src/main/register-download-ipc.js` — `uniquePath` builds `base (n)ext` from the already-sanitised name.

## Corrective Action
*(written at completion)*

## Verification
Reserve room for the suffix, or re-apply the byte cap to the stem after adding it, keeping the extension. Unit: a name at the cap that needs ` (12)` stays at or under the cap and keeps its extension.

## Sign-Off
*(written at completion)*
