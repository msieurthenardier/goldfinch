# Squawk 0026: `dropHandled` in `bookmarks-bar.js` is set but never read

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: 2026-08-27

## Report

Mission 15's debrief flagged `dropHandled` as dead (set-only) and asked either to delete it and retitle the test that describes it, or implement the guard DD2 describes. Still set-only. Delete the flag and its assignments, and retitle `bookmarks-bar.test.js`'s test so it no longer claims a guard that does not exist. Implementing DD2's guard is not this squawk.

Source: maintenance report 2026-08-27, finding F27 (flag half; known, M15).

## Evidence

- `src/renderer/chrome/bookmarks-bar.js:969` — `dropHandled = true` with no reader (earlier cites `:274`, `:543` at M15 time)
- `test/unit/bookmarks-bar.test.js:559` — test title referencing the guard

## Corrective Action

Confirmed the premise before touching anything: grepped `dropHandled` across `src/` and `test/`. All bookmarks-bar.js occurrences (the JSDoc type entry, the `dropHandled: false` initializer, and the `dnd.dropHandled = true` assignment in the `drop` handler) had no reader anywhere in that file. The reads found repo-wide (`tab-controller.js:228,233`, `tab-drag-invariants.test.js`, `tab-adopt-by-drop.test.js`) operate on a distinct, module-local `dnd` object used for tab drag-and-drop, unrelated to bookmarks-bar.js's own `dnd`. No scope-gate trip.

Removed from `src/renderer/chrome/bookmarks-bar.js` (8 lines deleted, 1 changed, net -7):
- The `dropHandled: boolean` entry from the `dnd` session JSDoc `@type`.
- The `dropHandled: false,` initializer in the drag-session snapshot object.
- The `if (dnd) dnd.dropHandled = true;` assignment in the `drop` handler, plus its 4-line "AC8: set SYNCHRONOUSLY..." comment, which existed only to explain the now-removed flag.

Retitled the test in `test/unit/bookmarks-bar.test.js` (line ~579) from `AC8: \`dropHandled\` is set synchronously — dragend after a drop cannot double-commit` to `AC8: dragend clears the drag session — a stray drop after dragend cannot double-commit`. Read the test body: it drops, fires `dragend`, then fires a second stray `drop`, and asserts exactly one `commitReorder` call. Traced the actual mechanism in `bookmarks-bar.js`: `dragend` unconditionally sets `dnd = null` (line ~568), so the second `drop` handler sees `session = dnd || foreign` resolve to `null` and returns early — `dropHandled` was never consulted in that path. The new title describes this real mechanism; no assertions changed.

## Verification

- `timeout 180 npm test` — 3793/3793 pass (0 fail), matching the expected count, including the `BOOKMARKS_BAR_LINE_BUDGET` pin in `test/unit/seam-contract.test.js` (line count moved down, well within budget).
- `npm run lint` — clean.
- `npm run typecheck` — clean.
- `grep -n dropHandled src/renderer/chrome/bookmarks-bar.js` — no matches remaining.

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the Developers' reasoning) — one review round, clean on the first pass; batch turnaround 2026-08-27 (batch 2)
**Verdict**: confirmed
**Commit**: `squawk: turnaround 2026-08-27 (batch 2)` on `squawk/turnaround-2026-08-27-2` (PR number recorded on the PR itself)

Batch gates at review: 3806/3806 tests, lint clean, typecheck clean.
