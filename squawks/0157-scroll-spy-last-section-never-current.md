# Squawk 0157: Section scroll-spy never marks the last section current at end of scroll

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-10-23
**Completed**: —

## Report
On `goldfinch://settings`, scrolling to the bottom at typical window heights never moves the sidebar highlight to **About**. The first section stays inside the observer's zone, and the spy always picks the first visible section in document order. Sortie 05 extracted this code verbatim, so the defect now also affects the `goldfinch://automation` sidebar. It is less visible there because that page has only three short sections. Found in the sortie 05 live smoke (AC25) and accepted by eye at the HAT as pre-existing.

## Evidence
- `src/renderer/pages/section-scroll-spy.js` — `rootMargin: '0px 0px -50% 0px'` and `for (const section of sections)` pick the first section in `visible`. At maximum scroll, with a short final section, an earlier section can still intersect the top half of the viewport.
- `sorties/05-automation-page/flight-log.md` — AC25 note: "About becomes current" was unreachable; a hide-first-section probe confirmed the observer itself works.

## Corrective Action
*(written at completion)*

## Verification
Add a geometry-aware unit test to `test/unit/section-scroll-spy.test.js` covering end-of-scroll with a short last section, which should select the last section. Then confirm by eye on both pages.

## Sign-Off
*(written at completion)*
