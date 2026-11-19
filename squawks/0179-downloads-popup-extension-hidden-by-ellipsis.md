# Squawk 0179: The downloads popup can hide a long file name's extension behind its ellipsis

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-14
**Completed**: 2026-11-19

## Report
Found during Mission 23 Flight 1 (finding 6d; left out of the slim `downloads` leg by operator ruling). In the downloads popup a file name is one line that is shortened at its **end**, so a long name loses its extension from view. Display only: the saved name is correct and the operating system shows the real name when the file is opened.

## Evidence
- `src/renderer/menu-overlay.css` — `.dl-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`.
- The row is built in the downloads block of `src/renderer/menu-overlay.js`; its DOM shape is pinned by `test/unit/downloads-popup-contract.test.js`.
- The picker's destination line had the same wrong-end problem and was fixed in the flight by keeping the tail (`destinationLineText` in `src/shared/vault-picker-template.js`).

## Corrective Action
- New pure helper `splitDownloadName` in `src/shared/download-name-split.js` (extension = final dot + 1-16 letters/digits, the `EXTENSION_PATTERN` rule of `src/main/download-path.js`; dot-files, trailing dot, over-long tails are stem only; `stem + ext === name`).
- `src/renderer/menu-overlay.js`: new `fillDownloadName` (called from both `.dl-name` sites in `renderDownloads`) fills the existing `.dl-name` element (button or span, unchanged) with `.dl-name-stem` and `.dl-name-ext` child spans, `textContent` only. Element, text content and accessible name are unchanged (the concatenated text is the full name; no `title` existed before). Imported as a module like the other shared helpers; no HTML/eslint/typecheck change needed.
- `src/renderer/menu-overlay.css`: `.dl-name` gains `display: flex`; `.dl-name-stem` is `flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`; `.dl-name-ext` is `flex: 0 0 auto; white-space: nowrap`. The contract test needed no change (it does not pin `.dl-name`).

## Verification
Render the name as a stem that may shrink and an extension that never does (two spans, `textContent` only), keeping the contract test's pinned shape. Unit: a pure name-splitting helper (extension = final dot + 1–16 letters or digits, as `download-path.js` defines it). By eye: a 200-character name ending `.exe` shows `.exe`. If the popup's row structure has to change beyond what the contract test allows, that is a shared-surface change — escalate.


Actual results: `test/unit/download-name-split.test.js` (new, 4 tests: report.exe, 200-char stem + .exe, archive.tar.gz, no extension, .bashrc, trailing dot, 17-char tail, 16-char tail, and a drift guard that the helper's pattern equals the literal in `download-path.js`) and `downloads-popup-contract.test.js` pass (5/5). `npm test` 7397 pass / 0 fail; `npm run lint`, `npm run typecheck` and `npm run format:check` clean.
By eye — **passed** (operator, 2026-11-19): in a dev launch of the branch on a scratch profile, the downloads popup showed a ~200-character name ending `.exe` as `….exe`, an in-progress ~200-character `.exe` row the same way, a long `.gz` row as `….gz`, and a short `…-setup.exe` name in full with no ellipsis. (The popup sheet is unobservable to automation, so this is the only check of the rendered row.) CSS reasoning: the extension span is `flex-shrink: 0` so it is never given less than its content width; only the stem (`min-width: 0`, `overflow: hidden`) shrinks, and its own `text-overflow: ellipsis` truncates the stem's end, so the ellipsis sits before `.exe`.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the fourth 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. The sheet stays `textContent`-only, `.dl-name`'s text and accessible name are unchanged, the stem shrinks with its own ellipsis while the extension does not, and the drift guard reads the real `EXTENSION_PATTERN` from `download-path.js` (neuter: changing the pattern fails two tests). By-eye check passed by the operator afterwards (see Verification). Gates at re-review: `npm test` 7,404 tests (7,399 pass, 0 fail, 1 skipped — the `jq` test, no `jq` on the dev host — and 4 todo); lint, typecheck and format:check clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-d`
