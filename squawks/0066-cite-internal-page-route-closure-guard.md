# Squawk 0066: Cite internal-page-route-closure.test.js as a standing internal-page guard

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-11
**Completed**: 2026-09-11

## Report

The M19 F1 HAT produced `test/unit/internal-page-route-closure.test.js` — a
host-generic guard that walks the transitive relative-import closure of every
internal page's routed `.js` modules and fails if any module in the graph lacks
a route. It closes the whole "a routed module has an unrouted transitive import,
which 404s the ES-module graph and blanks the page" defect class (the HAT-fix-1
class). Right now it is just another test file; it should be CITED in CLAUDE.md's
internal-page pattern as the standing check any allowlist-widening change is
expected to pass, the way `csp-pins.test.js` is cited for the chrome-fetch /
media invariant, so future internal-page route additions are reviewed against it
by name rather than rediscovering the hazard.

## Evidence

- `test/unit/internal-page-route-closure.test.js` — the guard (host-generic;
  non-vacuously proven: it asserts the walk discovers `burner.js` transitively
  and that deleting the vault `/burner.js` route reproduces the HAT defect).
- `src/main/internal-page-map.js` — the route map the guard covers.
- CLAUDE.md — the "Internal goldfinch:// pages" and "New-shared-module
  checklist" sections where the citation belongs.
- Surfaced by the M19 F1 flight debrief (Architect recommendation).

## Corrective Action

Extended the existing "**Adding an internal page**" bullet in CLAUDE.md's
`### Internal goldfinch:// pages — trusted-embedder security model` section
with one added sentence citing `test/unit/internal-page-route-closure.test.js`
as the standing guard any route/allowlist widening is expected to pass —
described as walking the transitive relative-import closure of every internal
page's routed modules and failing if any module in the graph lacks its own
`internal-page-map.js` route, explicitly drawing the parallel to how
`csp-pins.test.js` is cited for the chrome-fetch invariant just above it in
the same section. Docs only — no code change. Landed in the same CLAUDE.md
edit pass as squawk 0065 (different bullets/sections, no overlap — confirmed
via `git diff CLAUDE.md`).

## Verification

The citation exists in `CLAUDE.md`'s "Adding an internal page" bullet.
`node --test --test-timeout=60000 test/unit/internal-page-route-closure.test.js`
— 3/3 pass (unmodified by this squawk). `npm run format` made no changes to
CLAUDE.md; `npm run format:check` passes green as part of the full-suite run.

## Sign-Off

**Reviewer**: independent Reviewer (Sonnet)
**Verdict**: confirmed
**Commit**: squawk: turnaround 2026-09-11 (Squawks: 0064, 0065, 0066, 0067, 0068)
