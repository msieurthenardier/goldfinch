# Squawk 0206: The release checklist does not include an accessibility audit of Settings

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-11-18
**Completed**: —

## Report
Mission 23 Flight 3 shipped a "Download now" button whose accessible name ("Download version X") did not contain its visible words — a WCAG label-in-name failure. It was released in v0.19.16 and found only when Sortie 09's leg ran `npm run a11y` against the Settings page. The audit needs the running app, so it is not in CI; nothing in the release process prompts it.

## Evidence
- `docs/RELEASING.md` — *Release checklist: by-eye items* has no accessibility audit item.
- Sortie 09 flight log, "Leg 02 a11y fix"; `scripts/a11y-audit.mjs` (`npm run a11y -- --target=goldfinch://settings`).

## Corrective Action
*(written at completion)*

## Verification
`docs/RELEASING.md` gains a pre-release step: run `npm run a11y -- --target=goldfinch://settings` against a dev launch with the update fixture showing a newer version (as `tests/behavior/update-notice.md`'s Preconditions describe), and expect "No NEW violations".
