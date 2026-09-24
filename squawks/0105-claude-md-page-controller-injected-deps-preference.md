# Squawk 0105: CLAUDE.md should state the injected-deps preference for page controllers

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-23
**Completed**: —

## Report

Page controllers under `src/renderer/pages/` split two ways on how they get
`src/shared/` pure functions. Injected deps (`vault-nav-controller.js`,
`vault-filter-controller.js`, `jars-section-controller.js`) can be executed in unit
tests against a mock DOM. A static flat-specifier import
(`vault-restore-controller.js`, `vault-browser-import-controller.js`) resolves only
through the internal-page map, so those files are source-scan tested only.
CLAUDE.md's Password-vault "Vault page — controller decomposition" bullet states no
preference. Add one sentence: future page controllers take their pure functions as
injected deps. Doc-only. Retrofitting the two existing controllers is out of scope
(it's a maintenance-flight candidate).

## Evidence

- `missions/22-find-it-in-the-vault/flights/01-vault-filter/flight-debrief.md`,
  Recommendation 2 and the Deviations table (DD7).
- `src/renderer/pages/vault-filter-controller.js`: header comment on why the
  matcher is injected.

## Corrective Action
*(written at completion)*

## Verification
*(written at completion)*

## Sign-Off
*(written at completion)*
**Reviewer**:
**Verdict**:
**Commit**:
