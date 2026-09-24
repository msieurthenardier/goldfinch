# Squawk 0106: CLAUDE.md internal-page checklist omits the eslint module entry for a new page controller

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-23
**Completed**: —

## Report

Every new ESM page controller under `src/renderer/pages/` needs two things: an
`eslint.config.mjs` `sourceType: 'module'` entry, and an exact `internal-page-map.js`
route (the route-closure test enforces the latter). CLAUDE.md's "Adding an internal
page" / new-module guidance names the route but not the eslint entry. Mission 22 F1's
leg Files Affected list missed it, and the Developer found it by lint failure. Add
the eslint entry to that checklist line. Doc-only.

## Evidence

- `missions/22-find-it-in-the-vault/flights/01-vault-filter/flight-debrief.md`,
  Recommendation 3.
- `eslint.config.mjs`: the module-sourceType allowlist gained
  `vault-filter-controller.js` in the M22 F1 diff.

## Corrective Action
*(written at completion)*

## Verification
*(written at completion)*

## Sign-Off
*(written at completion)*
**Reviewer**:
**Verdict**:
**Commit**:
