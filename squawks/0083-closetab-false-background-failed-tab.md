# Squawk 0083: `closeTab` returns `false` for a failed tab in a background window

**Status**: deferred
**Type**: defect
**Severity**: routine
**Reported**: 2026-09-17
**Completed**: —

## Report

During the `crash-and-hang-surfaces` run's row-0 precondition repair, the admin
`closeTab` op returned `false` (twice) for a tab in the NON-focused window
that carried `loadState: "failed"` (`ERR_UNSAFE_PORT`, `http://127.0.0.1:1/`,
a leftover of the a11y audit's session snapshot), while the same op closed the
equivalent failed tab in the focused window. The tab survived the relaunch too
(restored again as `failed`). Either the op refuses a background window's
tab (an admin-scope quirk worth documenting) or the failed-tab close path has a
gap in a non-focused window; reproduce and fix or document.

## Evidence

- `tests/behavior/crash-and-hang-surfaces/runs/2026-09-17-00-22-28.md` — Checkpoint 0 (post-repair report; Validator notes); Checkpoint 15
  (the same tab restored as wcId 20).
- `src/main/automation/tabs.js` (`closeTab`) and its routing to the owning
  window's chrome — the close is renderer-orchestrated.

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*

## Disposition

**Deferred** (2026-09-21, turnaround planning): excluded from the 2026-09-21
turnaround because it cannot be reproduced headlessly — it needs a live
multi-window session with an admin automation key, a failed tab in a NON-focused
window, and the admin `closeTab` op. Its fix path ("fix, or document an admin-scope
quirk") is not knowable until that reproduction is done. **Revisit when**: the next
behavior-test run that exercises `enumerateTabs` / `closeTab` across windows, or the
next leg that touches `src/main/automation/tabs.js`'s `closeTab` — whichever comes
first.

