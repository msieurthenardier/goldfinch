# Squawk 0200: The home-page Save button is 2 px shorter than Clear beside it

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-17
**Completed**: —

## Report
In Settings → Startup & appearance, `#home-page-save` renders 28 px tall beside the 30 px `#home-page-clear`. Mission 23 Flight 3 aligned every `.settings-btn` primary with the secondary variant by giving it a transparent 1 px border; `#home-page-save` has its own rule and was not included.

## Evidence
- `src/renderer/pages/settings.css` — the `#home-page-save` rules; `.settings-btn` now carries `border: 1px solid transparent`.
- Flight 3 flight log, "Leg 12 review fixes" (measured 28 px vs 30 px).

## Corrective Action
*(written at completion)*

## Verification
Both buttons measure the same height and top edge (`getBoundingClientRect()` on the live page).
