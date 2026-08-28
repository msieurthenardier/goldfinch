# Squawk 0048: Test comments reference symbols removed in recent work (`lastVisibleChromeTabbable`, `findSheetWcId`, `SHEET_DISMISS_EXPR`)

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-28
**Completed**: —

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

*(recorded by the Developer)* — update the three comments to name the current symbols (`chromeLastVisibleTabbable` / `tabSequence`; drop the `findSheetWcId` / `SHEET_DISMISS_EXPR` references or replace with the current sheet-skip behavior). Comments only; no assertion or code change; the suite must stay green.

## Verification

*(recorded by the Developer)* — `grep -rn 'lastVisibleChromeTabbable\|findSheetWcId\|SHEET_DISMISS_EXPR' test/` returns nothing after the fix; `npm test` unchanged.
