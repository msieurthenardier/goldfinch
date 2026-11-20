# Squawk 0206: The release checklist does not include an accessibility audit of Settings

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-18
**Completed**: 2026-11-19

## Report
Mission 23 Flight 3 shipped a "Download now" button whose accessible name ("Download version X") did not contain its visible words — a WCAG label-in-name failure. It was released in v0.19.16 and found only when Sortie 09's leg ran `npm run a11y` against the Settings page. The audit needs the running app, so it is not in CI; nothing in the release process prompts it.

## Evidence
- `docs/RELEASING.md` — *Release checklist: by-eye items* has no accessibility audit item.
- Sortie 09 flight log, "Leg 02 a11y fix"; `scripts/a11y-audit.mjs` (`npm run a11y -- --target=goldfinch://settings`).

## Corrective Action
`docs/RELEASING.md` gains a paragraph after the *Release checklist: by-eye items* table ("Before tagging: audit the Settings page") giving the fixture start, the `GOLDFINCH_UPDATE_CHECK_URL` dev launch, the `npm run a11y -- --target=goldfinch://settings` command, the expected `No NEW violations` result, and a link-by-name to `docs/dev-testing.md` *a11y audit* for attach. Checked against `package.json` (`a11y` script), `scripts/a11y-audit.mjs` (`--target`, success line "No NEW violations"), and `tests/behavior/update-notice.md` Preconditions.

## Verification
`docs/RELEASING.md` gains a pre-release step: run `npm run a11y -- --target=goldfinch://settings` against a dev launch with the update fixture showing a newer version (as `tests/behavior/update-notice.md`'s Preconditions describe), and expect "No NEW violations".

Ran: `node --test test/unit/path-hygiene.test.js` 3 pass / 0 fail; `npm test` 7450 pass / 0 fail; `npm run lint` clean; `npm run typecheck` clean; `npm run format:check` clean (prettier run on the two changed files only). The audit itself was not run (no app launch, per the batch rules).

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the ninth 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. The fixture command, port 8237, default mode `higher`, `GOLDFINCH_UPDATE_CHECK_URL` and `--target=goldfinch://settings` match `update-notice.md` and `scripts/a11y-audit.mjs`, and the expected `No NEW violations` is the script's own success line; the attach recipe is linked to `docs/dev-testing.md`, not restated. Gates at review: `npm test` 7,455 tests (7,450 pass, 0 fail, 1 skipped, 4 todo); lint, typecheck and format:check clean; `path-hygiene.test.js` 3 pass. Artifacts and docs only: no runtime change, so no live check.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-i`
