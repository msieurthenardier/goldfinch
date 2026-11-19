# Squawk 0218: README download table shows the Windows installer name with spaces

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-18
**Completed**: 2026-11-19

## Report
The README's Windows row shows the link text "Goldfinch Setup 0.19.18.exe" while the link and the real asset are `Goldfinch-Setup-0.19.18.exe`. A user verifying the download by name sees a mismatch. The table is generated, so the fix is in the generator. Found by routine maintenance 2026-11-18 (finding #34).

## Evidence
- `README.md` download table, Windows row.
- `scripts/update-readme.mjs` (generator); `package.json` `build.nsis.artifactName`.
- `test/unit/artifact-names.test.js` checks the URLs, not the link text.

## Corrective Action
`scripts/update-readme.mjs` (`block` template, Windows row): the link text was hardcoded `Goldfinch Setup ${version}.exe` (electron-builder's productName form) while the URL used `Goldfinch-Setup-${version}.exe`; the text now uses the hyphenated name. Other rows already matched (the `.zip`/`.deb` extras are deliberate extension-only labels). README.md regenerated at 0.19.18 (diff: only the Windows link text). `test/unit/artifact-names.test.js`: new test compares each link's text with its URL's file name (extras must be the extension of their file).

## Verification
Regenerated README shows the hyphenated name as link text; `artifact-names.test.js` extended to compare link text with the URL's file name.

**Ran**: artifact-names.test.js 3/3 pass; `npm test` 7385 pass / 0 fail; lint, typecheck, format:check clean. Neuter-verify: restored the spaced text in README.md, new test failed (`link text "Goldfinch Setup 0.19.18.exe" must equal the file name ...`), regenerated, passes.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the third 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. `README.md` changes only the Windows link text; the new `artifact-names.test.js` test checks every download link's text against its URL's file name and failed when the Reviewer put the old text back. Gates at review: `npm test` 7,390 tests (7,385 pass, 0 fail, 1 skipped — the `jq` test, no `jq` on the dev host — and 4 todo); lint, typecheck and format:check clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-c`
