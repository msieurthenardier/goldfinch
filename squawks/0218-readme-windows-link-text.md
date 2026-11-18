# Squawk 0218: README download table shows the Windows installer name with spaces

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-18
**Completed**: —

## Report
The README's Windows row shows the link text "Goldfinch Setup 0.19.18.exe" while the link and the real asset are `Goldfinch-Setup-0.19.18.exe`. A user verifying the download by name sees a mismatch. The table is generated, so the fix is in the generator. Found by routine maintenance 2026-11-18 (finding #34).

## Evidence
- `README.md` download table, Windows row.
- `scripts/update-readme.mjs` (generator); `package.json` `build.nsis.artifactName`.
- `test/unit/artifact-names.test.js` checks the URLs, not the link text.

## Corrective Action
*(written at completion)*

## Verification
Regenerated README shows the hyphenated name as link text; `artifact-names.test.js` extended to compare link text with the URL's file name.
