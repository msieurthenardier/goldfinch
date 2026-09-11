# Squawk 0065: Document the vault-page-model.js pure-extraction pattern

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-11
**Completed**: —

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

*(written at completion — expected: add a short "Vault page — pure display
models" note to CLAUDE.md's Password-vault pattern, or to docs/vault.md, stating
that page display/decision logic goes in vault-page-model.js as pure functions
consumed by the controller and unit-tested in vault-page-model.test.js; cite the
existing exporters as exemplars. Docs only, no code change.)*

## Verification

*(written at completion — expected: the note exists and names the pattern +
exemplars; format:check green.)*

## Sign-Off

*(written at completion)*
