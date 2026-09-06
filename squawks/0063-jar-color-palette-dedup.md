# Squawk 0063: JAR_COLOR_PALETTE duplicated in vault.js — dedup via a jar-page-model.js import

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-06
**Completed**: —

## Report

`vault.js` defines `JAR_COLOR_PALETTE` (≈14 lines incl. its comment) as
a byte-for-byte duplicate of `PALETTE` in
`src/shared/jar-page-model.js`. The duplication exists only because the
vault internal page can't import `jar-page-model.js` — its route in
`src/main/internal-page-map.js` (vault route, ~:55-70) has no entry for
that module. Two costs: (a) drift risk — the two palettes can silently
diverge; (b) `vault.js` is at its hard 2820-line budget ceiling
(seam-contract metric), and reclaiming these ~14 lines is the cheapest
headroom buy-back before the next vault-page flight.

Surfaced by the Flight 3 (Mission 18) debrief (Developer interview) as
recommended prep work.

## Evidence

- `src/renderer/pages/vault.js` — `JAR_COLOR_PALETTE` (~:786-798),
  used by the mapping modal's dot-swatch picker (HAT fix 4).
- `src/shared/jar-page-model.js:32-45` — canonical `PALETTE`, identical
  values.
- `src/main/internal-page-map.js` (vault route ~:55-70) — no
  `jar-page-model.js` entry, which is why the import isn't possible
  today.

## Corrective Action

*(written at completion)*

## Verification

*(written at completion — expected: add the `jar-page-model.js`
allowlist entry to the vault route in internal-page-map.js, import
`PALETTE` in vault.js and delete the local `JAR_COLOR_PALETTE`, confirm
the mapping-modal swatch picker still renders the same colors, and that
`vault.js` drops below the 2820 budget; full suite + lint + typecheck +
format green.)*

## Sign-Off

*(written at completion)*

## Note

This touches `internal-page-map.js` — the internal-page module
allowlist, a security-adjacent surface. The change is additive (grants
the vault page read access to one PURE, already-shipped shared model
that the jars page already loads) and low-risk, but the squawk's
completion review must confirm it stays a widening-of-an-allowlist and
nothing more. If it turns out to need any other allowlist/route change
or design decision, escalate rather than expand.
