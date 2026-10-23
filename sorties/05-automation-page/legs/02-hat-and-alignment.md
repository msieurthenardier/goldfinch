# Leg: hat-and-alignment

**Status**: completed
**Flight**: [Automation Page](../flight.md)

## Objective
Operator-guided acceptance of the Automation page: confirm by eye what automation cannot observe (the kebab sheet, rendered look, scroll-spy movement), then run the re-authored behavior specs and the a11y audit against `goldfinch://automation`, fixing issues inline.

## Context
- Leg 01 `automation-page` completed and committed (`1a0ce3e`). Its AC25 scroll-spy "About becomes current" sub-check was unreachable by automation on this rig and is carried here by eye.
- The kebab sheet (menuType `kebab`) is not in `AUTOMATABLE_MENU_TYPES` — the menu click is by-eye only (DD8).
- Contract the behavior specs depend on (DD6): URL `goldfinch://automation`, section ids `connection`/`keys`/`activity`, all `automation-*` ids unchanged. A HAT change to that contract is a spec re-author, not an inline fix.
- Fix-vs-feature gate applies: look-and-feel fixes ride inline; new behavior gets a scoped design review first. Multi-surface fixes get a Developer design-review pass first.
- Apparatus: Goldfinch dev mode (`GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 npm run dev:automation`), never the registered `goldfinch-dev` MCP server.

## Acceptance Criteria
- [x] H1 [by-eye]: The ⋯ menu lists New window | Settings, Downloads, Cookie jars, **Automation**, Vault | Print…, Exit; ArrowDown/ArrowUp traverse Automation between Cookie jars and Vault.
- [x] H2 [by-eye]: Activating **Automation** (click and Enter) opens a new tab on `goldfinch://automation`, titled "Automation — Goldfinch".
- [x] H3 [by-eye]: The page looks native next to Settings (same sidebar shell, fonts, controls); Connection / Keys / Activity nav links jump to their sections; both hints read correctly under Keys.
- [x] H4 [by-eye]: Settings shows no Automation section or nav link; scrolling Settings to the bottom moves the nav highlight off the first link (About highlighted, or the operator's judgment that the behavior matches pre-change Settings).
- [x] H5: *(operator-dispositioned: skipped — spec pre-existing staleness, see flight log; re-author squawked)* `/mission-control:behavior-test settings-automation` passes (or failures dispositioned with the operator).
- [x] H6: *(operator-dispositioned: skipped — spec pre-existing staleness, see flight log; re-author squawked)* `/mission-control:behavior-test settings-activity-viewer` passes (or dispositioned).
- [x] H7: *(operator-dispositioned: skipped — spec pre-existing staleness, see flight log; re-author squawked)* `/mission-control:behavior-test automation-key-gating` passes (or dispositioned).
- [x] H8: `npm run a11y -- --target=goldfinch://automation` reports no new findings beyond the accepted allowlist (or new findings fixed / dispositioned).

## Verification Steps
The Flight Director presents one step at a time; the operator performs and reports. Behavior specs run via the behavior-test skill (Executor + Validator); run logs land under `tests/behavior/{slug}/runs/`.

## Edge Cases
- If the app's restored dev profile opens unrelated tabs, ignore them; use a fresh tab for the Automation page.
- If a behavior spec fails on a step that was already stale before this sortie (not caused by the page move), disposition it with the operator and log a squawk rather than widening this leg.

## Files Affected
- Inline fixes only, as found; run logs under `tests/behavior/*/runs/`.
