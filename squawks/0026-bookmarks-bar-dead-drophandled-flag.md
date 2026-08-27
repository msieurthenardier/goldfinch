# Squawk 0026: `dropHandled` in `bookmarks-bar.js` is set but never read

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: —

## Report

Mission 15's debrief flagged `dropHandled` as dead (set-only) and asked either to delete it and retitle the test that describes it, or implement the guard DD2 describes. Still set-only. Delete the flag and its assignments, and retitle `bookmarks-bar.test.js`'s test so it no longer claims a guard that does not exist. Implementing DD2's guard is not this squawk.

Source: maintenance report 2026-08-27, finding F27 (flag half; known, M15).

## Evidence

- `src/renderer/chrome/bookmarks-bar.js:969` — `dropHandled = true` with no reader (earlier cites `:274`, `:543` at M15 time)
- `test/unit/bookmarks-bar.test.js:559` — test title referencing the guard

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
**Reviewer**: —
**Verdict**: —
**Commit**: —
