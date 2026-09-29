# Squawk 0106: CLAUDE.md internal-page checklist omits the eslint module entry for a new page controller

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-23
**Completed**: 2026-09-29

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
Added the eslint requirement to CLAUDE.md's "New-shared-module checklist" bullet (the one checklist a new page-controller author follows; not duplicated in "Adding an internal page"). Verified mechanism first: `eslint.config.mjs`'s module-`sourceType` block lists each `src/renderer/pages/*.js` file explicitly (jars-*, settings, vault-*), whereas `chrome/**/*.js`, `renderer.js` and `menu-overlay.js` are covered by a glob/named entry.

## Verification
Read `eslint.config.mjs` to confirm the explicit allowlist; `npm run format:check` — passes.

## Sign-Off

**Reviewer**: Reviewer agent (independent, batch review — turnaround 2026-09-29)
**Verdict**: confirmed
**Commit**: squawk: turnaround 2026-09-29 (branch `squawk/turnaround-2026-09-29`)
