# Squawk 0020: Jar color interpolated raw into a `style` attribute via `innerHTML` in the chrome view

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: 2026-08-27

## Report

Two chrome sinks build `style="…${jar.color}…"` inside an `innerHTML` assignment without passing the color through `isSafeColor`, while every peer sink does. Not attacker-reachable today (registry colors pass `cleanColor`; the burner color is a frozen constant) — this is defense-in-depth that goes live the moment a color arrives from import, sync, or automation. `validateMoveTabPayload` also shape-checks `color` only as `string`. Fix: apply `isSafeColor` in `validateMoveTabPayload` and at both sinks; add a unit case with a `"`-bearing color.

Source: maintenance report 2026-08-27, finding F3.

## Evidence

- `src/renderer/chrome/tab-controller.js:115` (into `innerHTML` at `:123`); `src/renderer/chrome/privacy-controller.js:414` (sibling `c.name` escaped, color not)
- `src/main/move-tab-payload.js:46` — `typeof color === 'string'` only
- Peer sinks gate with `isSafeColor`: `pages/settings.js:844`, `pages/jars-section-controller.js:454`, `pages/vault.js:1067`, `menu-overlay.js:395`

## Corrective Action

Applied `isSafeColor` at both chrome innerHTML sinks and the main-side shape validator — no new validation layers, no refactor:

- `src/renderer/chrome/tab-controller.js` — `isSafeColor` added to the injected `deps` (matching the existing dependency-injection idiom this controller already uses for every other collaborator). The tab-strip dot now computes `const dotColor = isSafeColor(jar.color) ? jar.color : '#9aa0ac'` before interpolating it into the `innerHTML` template, mirroring the exact fallback literal (`'#9aa0ac'`) peer sinks (`pages/settings.js`, `pages/jars-section-controller.js`, `menu-overlay.js`) already use. Wired the one new dep through in `src/renderer/renderer.js`'s `createTabController(...)` call site (it already imports `isSafeColor` at the top for other controllers).
- `src/renderer/chrome/privacy-controller.js` — `isSafeColor` was already present in this controller's `deps` (used elsewhere in the file) so no wiring change was needed. `pJar()` now computes the same `dotColor` guard before building its `innerHTML` string; `c.name` was already escaped via `escapeHtml`.
- `src/main/move-tab-payload.js` — added `const { isSafeColor } = require('../shared/safe-color');` and one shape-check line, `if (!isSafeColor(container.color)) return null;`, alongside the existing `typeof` checks. This validator already fails closed (returns `null` on any bad shape) rather than substituting a fallback, so rejection — not `cleanColor`'s substitute-and-continue idiom — matches its established discipline.

Incidental: wiring `isSafeColor` into `tab-controller`'s deps call in `renderer.js` would have pushed the file 1 line over `seam-contract.test.js`'s `RENDERER_LINE_BUDGET` (1650). Folded the new dep onto the existing `escapeHtml,` line instead of adding a line, so `renderer.js` is now 1649 lines — no budget change needed.

No shared-module shape changes; `isSafeColor` (src/shared/safe-color.js) is unchanged.

## Verification

- Added unit cases at all three points, each asserting a `"`/`<script>`-shaped color is rejected/replaced and the safe-color path still renders through unchanged:
  - `test/unit/move-tab-payload.test.js` — new test asserts `validateMoveTabPayload` returns `null` for a `"`-bearing, `javascript:`-shaped, `;`-bearing, and empty-string container color.
  - `test/unit/tab-controller.test.js` — new tests assert the tab-strip dot's `innerHTML` never carries the raw unsafe color/script markup and falls back to `#9aa0ac`, and that a safe `#`-prefixed color rides through unchanged. (Harness's `FakeElement.innerHTML` setter extended to retain the raw string so tests can assert on it — no prior test read `innerHTML` content.)
  - `test/unit/privacy-controller.test.js` — same two cases for `pJar()`'s `innerHTML`, driven through `controller.togglePrivacy(true)`. (This required extending the harness's `tabA` fixture with a complete `net`/`cookies` shape for `renderPrivacy()`'s other sections, which no prior test in this file exercised — a pre-existing fixture gap, not a regression.)
- `timeout 180 npm test` — 3801/3801 passing.
- `npm run lint` — clean.
- `npm run typecheck` — clean.

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the Developers' reasoning) — one review round, clean on the first pass; batch turnaround 2026-08-27 (batch 1)
**Verdict**: confirmed
**Commit**: `squawk: turnaround 2026-08-27 (batch 1)` on `squawk/turnaround-2026-08-27-1` (PR number recorded on the PR itself)

Batch gates at review: 3825/3825 tests, lint clean, typecheck clean.
