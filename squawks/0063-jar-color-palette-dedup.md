# Squawk 0063: JAR_COLOR_PALETTE duplicated in vault.js — dedup via a jar-page-model.js import

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-06
**Completed**: 2026-09-09

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

Landed as the first step of Mission 19 Flight 1 Leg 2
(`import-ui-and-vault-page-decomposition`), per its own Note's
instruction that the completion review happen at that leg. Added
`'/jar-page-model.js': shared('jar-page-model.js')` to the vault route
in `src/main/internal-page-map.js` (a single-entry allowlist widening —
confirmed nothing else in the map changed, per
`test/unit/vault-browser-import-invariants.test.js`'s AC10 fixture
test). Added `import { PALETTE } from './jar-page-model.js'` to
`vault.js` (flat specifier + `// @ts-ignore`, the internal-page import
rule). Deleted the local `JAR_COLOR_PALETTE` constant + its explanatory
comment (20 lines) and pointed the one use site
(`buildColorSwatchGrid`'s call in the mapping modal) at `PALETTE`
instead. Reworded `buildColorSwatchGrid`'s docstring, which had
referenced `JAR_COLOR_PALETTE` by name, so the identifier no longer
appears anywhere in the file (code or comments).

Two collateral edits the squawk file itself didn't name, caught in the
leg's design review: (a) `test/unit/vault-restore-workflow-invariants.test.js`'s
swatch-prefill regex named `JAR_COLOR_PALETTE` three times — retargeted
to `PALETTE` (a rename, not a behavior change); (b) the same file's
docstring reference above.

## Verification

- `JAR_COLOR_PALETTE` no longer appears in `vault.js`: `grep -n
  JAR_COLOR_PALETTE src/renderer/pages/vault.js` returns nothing —
  pinned permanently by `test/unit/vault-browser-import-invariants.test.js`'s
  AC13 tests.
- The mapping-modal swatch picker still renders the same 12-color
  palette (byte-identical values — `PALETTE` and the deleted
  `JAR_COLOR_PALETTE` were already verbatim copies) —
  `test/unit/vault-restore-workflow-invariants.test.js`'s swatch-prefill
  tests (retargeted to `PALETTE`) stay green: `node --test
  test/unit/vault-restore-workflow-invariants.test.js` — 21/21 pass.
- `vault.js` line count (the `seam-contract.test.js` metric,
  `split(/\r?\n/).length`): measured **2803** after this squawk's edits
  ALONE (JAR_COLOR_PALETTE's 20-line comment+const block deleted, the
  2-line `PALETTE` import added — net -18 off the file's 2820-line
  starting point) — the working headroom Leg 2's browser-import UI
  wiring then built on top of. The FINAL landed `vault.js`, after Leg
  2's wiring, measures **2819** lines — under the unchanged
  `VAULT_PAGE_LINE_BUDGET` (2820) pin, with 1 line of headroom
  remaining (short of the leg's own soft ≤2815 target, stated honestly
  per this squawk's own Corrective Action convention).
- Full green bar (part of the Leg 2 flight-log entry): `npm test`
  4421/4421 pass; `npm run typecheck` clean; `npm run lint` clean; `npm
  run format` then `npm run format:check` clean.

## Sign-Off

**Reviewer**: flight-end Reviewer
**Verdict**: confirmed — the flight-end Reviewer's independent pass
(2026-09-09, two cycles) verified the `internal-page-map.js` change is a
single-entry allowlist widening and nothing more, per this squawk's Note.
**Commit**: the Mission 19 Flight 1 landing commit on
`flight/01-chrome-password-import` (sha recorded in the flight log's
"Flight commit" note)

## Note

This touches `internal-page-map.js` — the internal-page module
allowlist, a security-adjacent surface. The change is additive (grants
the vault page read access to one PURE, already-shipped shared model
that the jars page already loads) and low-risk, but the squawk's
completion review must confirm it stays a widening-of-an-allowlist and
nothing more. If it turns out to need any other allowlist/route change
or design decision, escalate rather than expand.
