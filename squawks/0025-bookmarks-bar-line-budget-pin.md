# Squawk 0025: `bookmarks-bar.js` has no line-budget test — M15 asked for one, never landed

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: 2026-08-27

## Report

Mission 15's debrief asked to "give the budget test a second file" for `bookmarks-bar.js` (1046 lines) alongside the existing `renderer.js` pin. Nothing landed. Add a budget assertion beside the existing one in `seam-contract.test.js`, set at the current size plus a small allowance, so the drag-session/render extraction seam is protected from growth until it is actually split.

Source: maintenance report 2026-08-27, finding F25 (known, M15).

## Evidence

- `test/unit/seam-contract.test.js:146` — `RENDERER_LINE_BUDGET` pin for `renderer.js` (1649/1650)
- `grep -rn budget test/unit` — no pin for `bookmarks-bar.js`

## Corrective Action

Added a `BOOKMARKS_BAR_LINE_BUDGET` pin in `test/unit/seam-contract.test.js`, mirroring the
existing `RENDERER_LINE_BUDGET` pin in style: a `BOOKMARKS_BAR_JS` path const beside
`RENDERER_JS`, a budget const with a comment explaining the measured baseline and the
allowance's rationale, and a new test asserting the file's split-array line count stays
at or under the budget (same assertion shape and counting convention as the renderer
test). The comment notes this protects the drag-session/render extraction seam
(bookmarks-bar.js currently owns both concerns) until that split happens, per the M15
debrief.

## Verification

- Current line count: `src/renderer/chrome/bookmarks-bar.js` measures 1047 lines by this
  test's own `source.split(/\r?\n/).length` metric (1046 by `wc -l`; the split-array
  metric counts one higher for a newline-terminated file, matching the convention
  `RENDERER_LINE_BUDGET`'s comment documents).
- Allowance rationale: `RENDERER_LINE_BUDGET`'s most recent bump (comment at
  `test/unit/seam-contract.test.js:142-145`) sets its budget to "measured + ~123
  headroom (rounded to a clean number)" — but that headroom was earmarked for specific
  planned growth (legs 2-3's jar-scoped bookmark call-sites) in the same flight. No
  bar/overflow work is currently planned, so this pin mirrors the *style* (measured +
  small headroom, rounded to a clean number) with a proportionally smaller allowance: 53
  lines over the 1047 measured, rounded to 1100. This buffers incidental drift (small
  edits landing near the file) without absorbing room for unplanned feature growth —
  consistent with the squawk's "small allowance" framing.
- Red-on-growth check (reasoned, not executed against a modified source file per the
  task's constraint): the new test computes `lines` from the same
  `fs.readFileSync(...).split(/\r?\n/).length` pattern as the renderer test and asserts
  `lines <= BOOKMARKS_BAR_LINE_BUDGET` (1100) via `assert.ok`. If `bookmarks-bar.js`
  grows past 1100 lines, `lines` exceeds the budget, the `assert.ok` condition is false,
  `assert.ok` throws an `AssertionError`, and the test fails — the same mechanism that
  makes the existing `RENDERER_LINE_BUDGET` test red on renderer.js growth.
- `timeout 180 npm test` — 3793/3793 pass.
- `npm run lint` — clean.
- `npm run typecheck` — clean.

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the Developers' reasoning) — one review round, clean; non-blocking note that the comment's 'measured 1047' predates squawk 0026's −7 lines in the same batch (file is 1040; budget 1100 holds); batch turnaround 2026-08-27 (batch 2)
**Verdict**: confirmed
**Commit**: `squawk: turnaround 2026-08-27 (batch 2)` on `squawk/turnaround-2026-08-27-2` (PR number recorded on the PR itself)

Batch gates at review: 3806/3806 tests, lint clean, typecheck clean.
