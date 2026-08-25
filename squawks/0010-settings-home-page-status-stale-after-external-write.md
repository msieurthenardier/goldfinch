# Squawk 0010: Settings' home-page status line goes stale when the preference changes from outside the page

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-08-25
**Completed**: 2026-08-25

## Report

On `goldfinch://settings`, the status line beneath the Home page field (`#home-page-status`) is written only by the page's own Save/Clear handlers. When the preference is changed by another writer — the welcome surface's "Set" (M16 F2), or a second window's Settings page — the `settings-changed` broadcast updates the field's value but leaves the last local message in place. Observed in the `welcome-home-routing` run (2026-08-25, checkpoint 8): after clearing the home page in Settings ("Cleared — new tabs will open the welcome page until you set one.") and then setting it from a welcome tab, the field read `https://example.com` while the line beneath it still said "Cleared — …". Misleading, not harmful. Fix: on a broadcast whose `homePage` differs from the field's last-saved value, clear the status line (or render a neutral "Updated" message).

## Evidence

- `src/renderer/pages/settings.js` — home-page IIFE: the `onSettingsChanged` handler sets `input.value` from `all.homePage` and does not touch `status`; only the Save and Clear click handlers write `status.textContent`.
- `tests/behavior/welcome-home-routing/runs/2026-08-25-02-45-35.md` — checkpoint 8 side observation; evidence `step-8-screenshot-2.png`, `step-8-snapshot.txt`.

## Corrective Action

Subsumed by the M16 F2 leg 2 home-page unset-hint fix (applied at that leg's acceptance gate, 2026-08-25, in response to an unrelated `welcome-first-launch` checkpoint-3 FAIL on the Settings unset-hint symmetry — see that leg's flight-log). `src/renderer/pages/settings.js`'s home-page IIFE now has a `reflect(value)` helper that sets both `input.value` and `status.textContent` together; it is called from the `onSettingsChanged` broadcast handler (guarded `all.homePage !== undefined`), not just from the initial load. An external write (the welcome surface's Set, or another window's Settings page) now updates the status line — to `HOME_UNSET_HINT` when the new value is `null`, or blank otherwise — instead of leaving the previous local click's message ("Cleared — …", "Saved") in place. No change was made specifically to close this squawk; the fix arrived as a side effect of the other leg's gate fix and happens to cover this report's exact scenario.

## Verification

Structural: `test/unit/settings-page-shared-scripts.test.js` asserts the home-page controller's `onSettingsChanged` handler calls `reflect(all.homePage)` (added for the M16 F2 leg 2 gate fix, not written specifically for this squawk, but it exercises the same code path). Behavioral re-observation of the original repro (repeat checkpoint 8 of `welcome-home-routing`: clear the home page in Settings, set it from a welcome tab, confirm the status line no longer reads "Cleared — …") is deferred to the M16 F2 flight debrief — not run standalone as part of this fix.

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the implementers' reasoning) — Mission 16 Flight 2 flight-end review, one round, 2026-08-25
**Verdict**: confirmed
**Commit**: `flight/02: The Welcome Surface — viewless welcome tab, search handoff, unset-by-default` on `flight/02-welcome-surface` (the flight-end commit; PR number recorded in the flight debrief)

Reviewer independently ran the suite (3763/3763, ~3.3 s), typecheck and lint clean, and traced the corrective action against the diff. Subsumed by the leg-2 gate fix: the home-page IIFE's `onSettingsChanged` handler now calls `reflect(all.homePage)`, updating the field and the status line together; structural test in `test/unit/settings-page-shared-scripts.test.js`.
