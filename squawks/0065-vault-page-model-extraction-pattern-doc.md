# Squawk 0065: Document the vault-page-model.js pure-extraction pattern

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-11
**Completed**: 2026-09-11

## Report

The "pure display/decision logic for the vault page lives in
`src/shared/vault-page-model.js`, unit-tested without a DOM, the page
controller just maps over the result" pattern has now been demonstrated four
times — `restoreDestinationOptions` / `restoreOutcomeLines` (M18 F3), then this
mission's `browserImportDestinationOptions` / `browserImportSkipLines` /
`browserImportOutcomeLines` (M19 F1) — and is written down nowhere as a rule.
The M18 F3 debrief already flagged it as "demonstrated three times in comments
but written down nowhere"; M19 F1 demonstrated it a fourth time without closing
the gap. Write it down so it stops recurring as an undocumented convention.

## Evidence

- `src/shared/vault-page-model.js` — the six pure exporters
  (`restoreDestinationOptions`, `restoreOutcomeLines`,
  `browserImportDestinationOptions`, `browserImportSkipLines`,
  `browserImportOutcomeLines`, plus the nav/selection models).
- `test/unit/vault-page-model.test.js` — the DOM-free unit suite the pattern
  enables.
- Surfaced by the M19 F1 flight debrief (Developer + Architect interviews),
  carried forward from the M18 F3 debrief.

## Corrective Action

Added a new bullet, **"Vault page — pure display models,"** to CLAUDE.md's
`### Password vault` pattern section, immediately after the existing "Module
layout" bullet and before "MRK model": states that page display/decision logic
for `goldfinch://vault` lives in `src/shared/vault-page-model.js` as pure,
DOM-free functions consumed by the vault page/controller (which just maps over
the result) and unit-tested in `test/unit/vault-page-model.test.js` without a
DOM — names it as the `jar-page-model.js` precedent, and cites
`restoreDestinationOptions`/`restoreOutcomeLines` (M18 F3) and
`browserImportDestinationOptions`/`browserImportSkipLines`/
`browserImportOutcomeLines` (M19 F1) as exemplars. Docs only — no code change.
Landed in the same CLAUDE.md edit pass as squawk 0066 (different bullets, no
overlap — confirmed via `git diff CLAUDE.md`).

## Verification

The note exists in `CLAUDE.md` (`### Password vault` section, new bullet
starting "**Vault page — pure display models.**"), naming the pattern, the
consuming controller relationship, and all five cited exemplar functions.
`npm run format` made no changes to CLAUDE.md; `npm run format:check` passes
green as part of the full-suite run.

## Sign-Off

**Reviewer**: independent Reviewer (Sonnet)
**Verdict**: confirmed
**Commit**: squawk: turnaround 2026-09-11 (Squawks: 0064, 0065, 0066, 0067, 0068)
