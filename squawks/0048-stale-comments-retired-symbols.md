# Squawk 0048: Test comments reference symbols removed in recent work (`lastVisibleChromeTabbable`, `findSheetWcId`, `SHEET_DISMISS_EXPR`)

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-28
**Completed**: 2026-08-28

## Report

Three test-file comments name identifiers that no longer exist, left behind by Mission 17 Flight 1 (Leg 2) and squawk 0045:

- `test/unit/shortcut-controller.test.js:22,47` — comments describe the expected chrome tabbable via `lastVisibleChromeTabbable`, the helper Flight 1 Leg 2 deleted in favour of `chromeLastVisibleTabbable()` wrapping the shared `tabSequence(document)`.
- `test/unit/a11y-audit-exit-codes.test.js:28` — lists `findSheetWcId` among `main().catch`'s callers; squawk 0045 removed `findSheetWcId` with the sheet-state loop.
- `test/unit/vault-accesskey-template.test.js:8` — "enforced by the a11y-audit's `SHEET_DISMISS_EXPR`"; squawk 0045 removed `SHEET_DISMISS_EXPR`.

Comment-only drift — no code or assertion is wrong; the references simply point at deleted symbols and mislead a future reader. Surfaced by the Flight 1 flight-end reviews and the squawk-0045 review.

## Evidence

- `grep -n lastVisibleChromeTabbable test/unit/shortcut-controller.test.js` → lines 22, 47 (the source helper is gone: `grep -rn lastVisibleChromeTabbable src/` is empty).
- `test/unit/a11y-audit-exit-codes.test.js:28` names `findSheetWcId`; `test/unit/vault-accesskey-template.test.js:8` names `SHEET_DISMISS_EXPR` — both removed from `scripts/a11y-audit.mjs` by squawk 0045.

## Corrective Action

Reworded the three comments to name current symbols/behavior; no assertions or code touched:

- `test/unit/shortcut-controller.test.js:22,47` — both comments now say `chromeLastVisibleTabbable` (via `tabSequence(document)`) instead of the deleted `lastVisibleChromeTabbable`, keeping the original visibility/order rationale intact.
- `test/unit/a11y-audit-exit-codes.test.js:28` — dropped `findSheetWcId` from the `fail()`-caller list and added a note that sheet states are skipped entirely by the audit (squawk 0045), so no sheet-wcId lookup exists to cite.
- `test/unit/vault-accesskey-template.test.js:8` — reworded to describe the acknowledge-button-dismisses-the-sheet contract and where it's enforced (menu-overlay.js), dropping the removed `SHEET_DISMISS_EXPR` citation.

## Verification

- `grep -rn 'lastVisibleChromeTabbable\|findSheetWcId\|SHEET_DISMISS_EXPR\|SHEET_CLOSED_EXPR\|SHEET_NODE_IDS' test/` — clean except `test/unit/a11y-audit-sheet-skip.test.js`, which is out of scope for this squawk and whose hits are correct as-is (negative assertions confirming those symbols are ABSENT from `scripts/a11y-audit.mjs`, not stale mentions).
- `npm test`, `npm run lint`, `npx prettier --check .` — see Developer's gate run in the completion report.

## Sign-off

Independent Reviewer (batch turnaround 2026-08-28): `[HANDOFF:confirmed]` — comment-only; every changed line a `//` comment, no assertion/code touched; the renamed symbols (`chromeLastVisibleTabbable`, `tabSequence`) verified present in source; the remaining grep hits in `a11y-audit-sheet-skip.test.js` are intentional negative assertions. Gates green (3950/3950).
