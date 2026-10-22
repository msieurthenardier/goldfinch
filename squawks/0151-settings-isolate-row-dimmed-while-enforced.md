# Squawk 0151: Settings page dims the Isolate row while isolation is still in force

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-10-22
**Completed**: —

## Report
With the Shields master switch off but third-party cookie isolation still in force (pending a restart), `goldfinch://settings` renders the **Isolate** row dimmed along with the other child rows. The privacy panel gets this right: its isolate row follows the shared model and stays undimmed while enforced (DD6: dim = not in force). The settings page should match. This was seen during the `third-party-cookie-isolation` run for squawk 0150 (step 12, Validator note).

Repro:
1. Isolation is on and in force.
2. Turn the master Shields switch off.
3. Open `goldfinch://settings`. The Isolate row renders at 0.65 opacity, even though `#shield-isolate-note` correctly reads "Stays on until restart".

## Evidence
- `src/renderer/pages/settings.css` — `.shields-group:has(#shield-enabled:not(:checked)) .shield-row:not(.shield-parent) { opacity: 0.65; }` dims every child row, the isolate row included, keyed only off the master checkbox.
- `src/shared/shields-isolation-model.js` — `isolateRow: { dim: !inForce, showCount: inForce, note }` is the model the panel already uses (`src/renderer/chrome/shields-section.js` — `const rowDim = isIsolate ? model.isolateRow.dim : dim;`). `settings.js` builds the same model, but only reads `m.isolateRow.note`, never `.dim`.
- Run log: `tests/behavior/third-party-cookie-isolation/runs/2026-10-22-16-14-55.md`, Validator closing, suggestion 5.

## Corrective Action
*(written at completion)*

## Verification
*(written at completion)* At minimum: a unit or source-scan pin that the settings Isolate row's dim state follows `isolateRow.dim`. Re-run step 12 of `third-party-cookie-isolation` (or check by eye) and confirm the row stays undimmed while enforced.

## Sign-Off
*(written at completion)*
