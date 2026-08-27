# Squawk 0031: `npm run a11y` exits 1 for both "apparatus not configured" and "violations found"

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: —

## Report

Mission 09's debrief flagged that `scripts/a11y-audit.mjs` uses exit code 1 for setup failures (`fail()`) and for real axe violations, so "not run" can be misread as green-or-red by a caller. Unchanged since. Reserve a distinct non-1 exit (e.g. 2) for `fail()` so the two outcomes are distinguishable; update the script's usage text.

Source: maintenance report 2026-08-27, finding F44 (known, M09).

## Evidence

- `scripts/a11y-audit.mjs:99-101` — `fail()` → `process.exit(1)`, used at `:160, :184, :188, :233, :319`
- `scripts/a11y-audit.mjs:572` — "new violations found" branch → `process.exit(1)`

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
**Reviewer**: —
**Verdict**: —
**Commit**: —
