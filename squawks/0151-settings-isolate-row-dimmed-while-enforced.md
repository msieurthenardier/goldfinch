# Squawk 0151: Settings page dims the Isolate row while isolation is still in force

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-10-22
**Completed**: 2026-10-22

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
`settings.js` `renderIsolation()` now toggles `.isolate-enforced` on the Isolate row (`#shield-isolate`'s `.shield-row`) from the shared model: `classList.toggle('isolate-enforced', !m.isolateRow.dim)`. `settings.css`'s master-off dim rule gained `:not(.isolate-enforced)`, so the row stays undimmed while isolation is in force and dims as before when it is not. Master-on behavior, the 0.65 opacity and all ids are unchanged. `renderIsolation` already re-runs on shields/isolation/settings changes, so the class stays live. The existing squawk-0130 CSS pin in `settings-page-shared-scripts.test.js` had its selector regex widened to allow the optional `:not(.isolate-enforced)`.

## Verification
- New `test/unit/settings-isolate-row-dim.test.js`: CSS rule excludes `.isolate-enforced`; `renderIsolation` toggles it from `!m.isolateRow.dim`; model check (master off + in force => `dim` false, not in force => true). Neuter-verified: removing the CSS `:not(...)` fails the CSS pin; flipping `!m.isolateRow.dim` to `m.isolateRow.dim` fails the controller pin (each 1 fail, restored).
- `npm test`: 5977 tests, 5973 pass, 0 fail (final batch tree with 0153: 5978 / 5974 / 0 fail / 4 todo). `npm run typecheck`, `npm run lint`, `npm run format:check`: clean.
- Live check (Flight Director, 2026-10-22). Scratch-profile dev instance (Electron 44.7.1, goldfinch 0.19.4 tree), with an attach-only admin client on a freshly minted key; `goldfinch://settings` opened via `kebabActionSettings()`, the master checkbox clicked off and then back on. Results:
  - Before: all rows at opacity 1; the Isolate row carries `isolate-enforced`.
  - Master off: Block at computed opacity `0.65`; Isolate at `1` with `isolate-enforced`. Notes: "Cookie isolation stays on until restart" and "Stays on until restart".
  - Restored: everything back to opacity 1, notes hidden.
  - The screenshot shows Block, Strip and Farble dimmed and Isolate at full brightness.
  - The master-off + not-in-force case needs a relaunch and is covered by the unit model pin.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped)
**Verdict**: confirmed, no blocking issues.
- The toggle is correct in every master × in-force state and stays live (it runs from `renderIsolation` on every shields, isolation and settings change, including the initial render).
- The null-guards are sound, and no frozen id or patch-in-place rule is broken.
- The Reviewer re-ran the neuter checks itself: both pins fail on revert, with no residue left.
- The widened 0130 regex still anchors the full rule (not vacuous).
- Gates: `npm test` 5978 (5974 pass, 0 fail, 4 todo); typecheck, lint and format:check clean.

**Commit**: the `squawk: turnaround 2026-10-22 (2)` commit on `squawk/turnaround-2026-10-22-2`
