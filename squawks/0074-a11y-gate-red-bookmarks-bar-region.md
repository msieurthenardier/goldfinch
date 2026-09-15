# Squawk 0074: `npm run a11y` is red on every chrome state — `#bookmarks-bar` region violation never accepted

**Status**: deferred
**Type**: defect
**Severity**: routine
**Reported**: 2026-09-15
**Completed**: —

## Report

`npm run a11y` exits 1 on EVERY chrome-mode state (base chrome, media panel,
privacy, lightbox, toolbar pins, downloads button, and the new
`load-failure` state alike) because axe's `region` rule flags
`#bookmarks-bar` — an app-shell element outside any landmark — and that
finding was never added to the curated `ACCEPTED` allowlist when the bar
shipped in Mission 15. The baseline-diff gate is therefore red regardless
of new work; Mission 20 Flight 1 leg 2 could only report "zero NEW findings"
(flight log, AC11) instead of a green run.

Reproduce: canonical admin dev launch, then `npm run a11y` — the summary
lists a `region` violation on `#bookmarks-bar` in every state.

## Evidence

- `scripts/a11y-audit.mjs` `ACCEPTED` — `#tabs`, `#brand`, `#address-wrap`
  each carry `id: 'region'` entries with the reason "app-shell … sits outside
  a landmark; accepted chrome exception"; there is no `#bookmarks-bar` entry
  (grep `bookmarks-bar` in the script returns nothing).
- `src/renderer/index.html:337` — `<div id="bookmarks-bar" class="hidden"
  role="group" aria-label="Bookmarks bar">`: `group` is not a landmark role,
  so axe's `region` rule fires whenever the bar is rendered.
- Flight log: `missions/20-no-silent-failures/flights/01-navigation-failure-surface/flight-log.md`
  (leg 2 AC11; FD ruling "AC11 accepted in substance").

## Corrective Action

_(written at completion)_ Either add the `(region, #bookmarks-bar)` pair to
`ACCEPTED` with the same app-shell reason as its siblings, or give the bar a
landmark role (`navigation` + its existing label) — pick the one consistent
with how `#tabs` was ruled; one read pass.

## Verification

`npm run a11y` exits 0 on the canonical dev launch with no `ACCEPTED`
entries beyond the one added (or none, if the role change is chosen).

## Sign-Off

_(written at completion)_

## Disposition

**Deferred**: out of Mission 20 Flight 1's scope (the flight added no bar
code) — revisit at the next squawk turnaround, and before Mission 20 Flight 2
audits its interstitial states (a green gate is the only honest AC there).
