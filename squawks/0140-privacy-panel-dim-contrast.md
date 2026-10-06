# Squawk 0140: Privacy panel dimmed Shields rows fail WCAG AA contrast

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: 2026-10-06

## Report
The privacy panel dims Shields rows with `.shield-row.dim` at opacity 0.4 (master switch off, or a paused site). `--fg` `#e6e7ea` at 0.4 over `--bg` `#1e1f25` is about 3.28:1, below WCAG AA's 4.5:1. Squawk 0130 found this while matching the settings page to the panel, and chose 0.65 (about 6.37:1) there. Raise the panel's dim opacity to the same AA-passing value so the two surfaces match, and recheck the dimmed isolate count and notes.

## Evidence
`src/renderer/styles.css:2200` `.shield-row.dim`; squawk 0130's Verification (contrast computation).

## Corrective Action
`.shield-row.dim` opacity 0.4 -> 0.7 in `src/renderer/styles.css`. Not 0.65 as on the settings page: the panel Shields section sits on `--bg-3` (#32343d), not `--bg` (#1e1f25), and the `.shield-count` (--accent #f5c518) lives INSIDE the dimmed row (`shields-section.js`), so it needs 0.7. `.shield-note` is appended outside the row (verified) and is not dimmed; the `.pause` row is never dimmed.

## Verification
Contrast over --bg-3: --fg #e6e7ea 0.4 -> 2.96, 0.65 -> 5.24, 0.7 -> 5.81; --accent count 0.4 -> 2.47, 0.65 -> 4.14 (fails), 0.7 -> 4.55 (passes). Source-pin added: `test/unit/shield-row-dim-css-pin.test.js` (no prior test pinned 0.4). Live visual check not performed. Gates: see report.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the 2026-10-06 turnaround)
**Verdict**: confirmed, no blocking issues (`npm test` x3 green, lint/typecheck/format:check/audit clean). Electron 44.5.0 and SDK 1.31.0 also live-verified by the third-party-cookie-isolation run 2026-10-06-18-13-21 (pass).
**Commit**: the `squawk: turnaround 2026-10-06` commit on `squawk/turnaround-2026-10-06`
