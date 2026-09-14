# Squawk 0070: Document the injected-deps page-controller extraction pattern in CLAUDE.md

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-14
**Completed**: —

## Report

The vault page has now been decomposed into three injected-deps controllers with
near-identical shape — `vault-nav-controller.js`, `vault-browser-import-controller.js`
(M19 F1), `vault-restore-controller.js` (M19 F2) — but the PATTERN is written
down nowhere: a `create*Controller(deps)` factory owning its own modal cluster,
closure-owned state exposed via getter/loader methods, live mutable page state
read via injected getters, and a single-purpose injected callback for a
secondary state coupling (the `setNotice` handoff). This is the same
"demonstrated repeatedly, documented never" gap the M19 F1 debrief flagged for
the `vault-page-model.js` pure-extraction pattern (squawk 0065). It also has an
active DRIFT to fix in the write-up: the two controllers read the same page
state through DIFFERENT getter shapes — `vault-browser-import-controller.js` takes
one `getPresence()`, `vault-restore-controller.js` takes two
`getJarRows()`/`getJarVaultPresence()`. Name ONE canonical shape so a fourth
consumer copies a contract, not whichever sibling it reads first.

Surfaced by the M19 F2 flight debrief (Architect + Developer, both).

## Evidence

- `src/renderer/pages/vault-{nav,browser-import,restore}-controller.js` — the
  three instances of the pattern.
- The getter drift: `vault-browser-import-controller.js`'s `getPresence` vs.
  `vault-restore-controller.js`'s `getJarRows`/`getJarVaultPresence`.
- CLAUDE.md — the Password vault "Module layout" section, where the note belongs.
- M19 F2 debrief, recommendation 3.

## Corrective Action

*(written at completion — expected: a concise "Vault page — controller
decomposition" note in CLAUDE.md's Password vault section stating the
`create*Controller(deps)` factory shape, the closure-owned-state + getter/loader
idiom, the injected-getter live-read convention, and the single canonical
getter shape (pick one — a single `getState()`/`getPresence()` is the simpler
contract). Doc only; the code reconciliation of the two existing controllers is
a separate follow-on touch, not part of this doc squawk.)*

## Verification

*(written at completion — expected: the note exists and names the three
controllers + the canonical shape; format:check green.)*

## Sign-Off

*(written at completion)*
