# Squawk 0074: `npm run a11y` is red on every chrome state — `#bookmarks-bar` region violation never accepted

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-09-15
**Completed**: 2026-09-15

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

Added the `(region, #bookmarks-bar)` pair to `ACCEPTED` in
`scripts/a11y-audit.mjs`, immediately beside its `#tabs`/`#brand`/
`#address-wrap` app-shell siblings, using the same "app-shell … sits outside
a landmark; accepted chrome exception" reason and a note citing Mission 15 /
squawk 0074. This is the option consistent with how `#tabs`/`#brand`/
`#address-wrap` were ruled: `#bookmarks-bar` is `role="group"` (not a
landmark) on the same frozen app-shell chrome as those three, so the
allowlist-entry precedent applies directly. Did NOT change the bar's role in
`src/renderer/index.html` — that would touch the frozen chrome DOM contract
(CLAUDE.md's Tab strip / bookmarks-bar sections) and the bookmarks-bar
behavior specs, which is out of this squawk's scope.

Checked `test/unit` for a test pinning `ACCEPTED`'s shape/contents
(`a11y-audit-exit-codes.test.js` pins the three `process.exit` codes;
`a11y-audit-sheet-skip.test.js` pins the sheet-skip mechanism;
`seam-contract.test.js` pins the evaluate-seam identifiers the audit script
drives) — none inspect `ACCEPTED` entries, so no existing test needed
extending, and per this squawk's scope no new test file was added.

## Verification

- `npm run lint` — clean (no output beyond the script header).
- `npm run format:check` — "All matched files use Prettier code style!"
  (no reformat needed).
- `npm test -- --test-timeout=60000` — 4565 tests, 0 failures.
- `npm run a11y` was NOT run here — it requires the live app (canonical
  admin dev launch), which this squawk's instructions say not to launch.
  The live exit-0 confirmation is deferred to Mission 20 Flight 2 leg 4's
  acceptance gate, where `npm run a11y` runs against the running app with
  an exit-0 AC.

## Sign-Off

**Reviewer**: Reviewer agent (Sonnet), batch review of squawks 0074 + 0076, 2026-09-15
**Verdict**: confirmed — corrective action correct, complete, confined to the reported surface; lint/format/tests green (4565/4565)
**Commit**: `squawk: turnaround 2026-09-15` on `flight/02-tls-trust` (turnaround shares the Mission 20 Flight 2 branch by operator ruling)
