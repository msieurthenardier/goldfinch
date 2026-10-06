# Squawk 0130: Settings: Shields sub-toggles aren't dimmed when the master switch is off

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: 2026-10-06

## Report
In `goldfinch://settings` → Privacy & Shields, turning off the master Shields checkbox leaves Block trackers, Strip tracking params and Farble fingerprint looking active. The privacy panel dims them (`.shield-row.dim`), so the two surfaces are inconsistent.

## Evidence
`src/renderer/pages/settings.css:195`/`203` (`.shield-parent` / child rows, no master-off styling); `src/renderer/pages/settings.js` shields controller `applyConfig`.

## Corrective Action
Added a pure-CSS rule in `src/renderer/pages/settings.css`: `.shields-group:has(#shield-enabled:not(:checked)) .shield-row:not(.shield-parent) { opacity: 0.65 }`. It follows the live checkbox (no JS change; patch-in-place path untouched), keeps the checkboxes operable, and leaves the `p.shield-note` restart notes unaffected. Opacity is 0.65 rather than the panel's 0.4 because --fg (#e6e7ea) at 0.4 over --bg (#1e1f25) is 3.28:1 (fails AA); at 0.65 it is 6.37:1.

## Verification
Contrast computed: 0.4 -> 3.28:1, 0.65 -> 6.37:1 (>=4.5 AA). Source-pin test added to `test/unit/settings-page-shared-scripts.test.js` (no DOM harness exists for settings). Live visual check not performed. Gates: prettier, lint, typecheck, npm test (see report).

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the 2026-10-06 turnaround)
**Verdict**: confirmed, no blocking issues (`npm test` x3 green, lint/typecheck/format:check/audit clean). Electron 44.5.0 and SDK 1.31.0 also live-verified by the third-party-cookie-isolation run 2026-10-06-18-13-21 (pass).
**Commit**: the `squawk: turnaround 2026-10-06` commit on `squawk/turnaround-2026-10-06`
