# Squawk 0066: Cite internal-page-route-closure.test.js as a standing internal-page guard

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-11
**Completed**: —

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

*(written at completion — expected: add one line to CLAUDE.md's internal-page
pattern / new-shared-module checklist citing
internal-page-route-closure.test.js as the standing guard for any route/
allowlist widening. Docs only.)*

## Verification

*(written at completion — expected: the citation exists in CLAUDE.md; the test
still passes; format:check green.)*

## Sign-Off

*(written at completion)*
