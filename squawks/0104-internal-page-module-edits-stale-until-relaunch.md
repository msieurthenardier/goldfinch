# Squawk 0104: Edited internal-page ES modules stay stale in a running dev session until relaunch

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-09-23
**Completed**: —

## Report

In a long-running `npm run dev:automation` session, editing a `goldfinch://`
internal page's ES module on disk and then reloading the page
(`location.reload()`, including `reload(true)`) keeps executing the OLD module.
A cache-busted `import('/<module>.js?bust=…')` returns the new source, while the
plain specifier returns the old one, so the stale copy is renderer-side (the
module map or HTTP cache for the internal session), not the main-process
resolver. Found during Mission 22 F1's HAT (H3): a controller edit took effect
only after a full app relaunch. Oddly, an earlier edit in the same session (H1)
did appear after a reload, so the trigger isn't fully characterized.

Impact: dev-workflow only (a packaged build never edits `src/` at runtime), but
it silently shows a developer or operator old behavior during a live HAT.
Options: send `Cache-Control: no-store` on internal responses in dev (see
`src/main/main.js` `handleInternal`, where the CSP is stamped), or document "relaunch
after editing internal-page JS" in `docs/dev-testing.md`. Choose one after a
quick repro. If the fix touches the internal-page response headers
(security-reviewed surface), escalate rather than change them inline.

## Evidence

- `missions/22-find-it-in-the-vault/flights/01-vault-filter/flight-log.md`,
  hat-and-alignment H3 entry: the reload-vs-cache-busted-import observation on
  `/vault-filter-controller.js`.
- `src/main/main.js` `handleInternal` reads the file per request via `net.fetch`
  and stamps `INTERNAL_CSP`. No explicit cache headers were observed on that path
  (unverified: confirm at repro).

## Corrective Action
*(written at completion)*

## Verification
*(written at completion)*

## Sign-Off
*(written at completion)*
**Reviewer**:
**Verdict**:
**Commit**:
