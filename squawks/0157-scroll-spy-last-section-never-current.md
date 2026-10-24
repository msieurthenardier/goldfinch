# Squawk 0157: Section scroll-spy never marks the last section current at end of scroll

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-10-23
**Completed**: 2026-10-24

## Report
On `goldfinch://settings`, scrolling to the bottom at typical window heights never moves the sidebar highlight to **About**. The first section stays inside the observer's zone, and the spy always picks the first visible section in document order. Sortie 05 extracted this code verbatim, so the defect now also affects the `goldfinch://automation` sidebar. It is less visible there because that page has only three short sections. Found in the sortie 05 live smoke (AC25) and accepted by eye at the HAT as pre-existing.

## Evidence
- `src/renderer/pages/section-scroll-spy.js` — `rootMargin: '0px 0px -50% 0px'` and `for (const section of sections)` pick the first section in `visible`. At maximum scroll, with a short final section, an earlier section can still intersect the top half of the viewport.
- `sorties/05-automation-page/flight-log.md` — AC25 note: "About becomes current" was unreachable; a hide-first-section probe confirmed the observer itself works.

## Corrective Action
`initSectionScrollSpy` takes a new optional injected `window` dep. A shared `update()` runs from the observer callback and from a passive `scroll` listener. When the page is scrollable and `scrollY` is within 2px of max scroll, it marks the LAST section current. Otherwise it applies the unchanged first-visible rule. `aria-current="true"` semantics are unchanged. `settings.js` and `automation.js` pass `window`; the `automation-page-shared-scripts.test.js` init-call regex pin was updated to match. A non-scrollable page never forces the last section.

## Verification
Three geometry-aware unit tests were added to `test/unit/section-scroll-spy.test.js`: at bottom with an earlier section still visible, mid-page with a non-scrollable-page guard, and scrolling back up from bottom. A fourth test pins the passive scroll listener. Neuter check: forcing the bottom rule off turned 2 tests red (6 pass, 2 fail) and restoring it returned to 8 pass. Gates: format:check, lint, typecheck clean; `npm test` 6034 pass, 0 fail. By-eye confirmation on `goldfinch://settings` and `goldfinch://automation` is pending the operator at review.

Original plan: Add a geometry-aware unit test to `test/unit/section-scroll-spy.test.js` covering end-of-scroll with a short last section, which should select the last section. Then confirm by eye on both pages.
- **Operator by-eye (2026-10-23, turnaround dev-mode launch): confirmed.**

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped, turnaround batch)
**Verdict**: confirmed, with no blocking issues. Normal scrolling is unchanged (the first-visible rule moved into `update()`). The `window` dep is optional, and the listener is passive and lives as long as the page, which is fine because neither page has a teardown. The tests cover bottom, mid, non-scrollable, scroll-back and passive. The operator confirmed it by eye on both pages. The batch gates were `npm test` 6041 (6037 pass, 0 fail, 4 todo), with typecheck, lint and format:check clean.
**Commit**: the `squawk: turnaround 2026-10-23` commit on `squawk/turnaround-2026-10-23`
