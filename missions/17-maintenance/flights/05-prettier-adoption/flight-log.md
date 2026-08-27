# Flight Log: Prettier Adoption

**Flight**: [Prettier Adoption](flight.md)

## Summary

*(not started)*

---

## Reconnaissance Report

Source: [squawk 0039](../../../../squawks/0039-prettier-drift-not-enforced.md)
(escalated 2026-08-27). Verified 2026-08-27 by a revert-safe spike at the
flight's base commit (`f142f90`, tree clean before and after): `npm run
format` under the existing `.prettierrc`, then `npm test`.

| Item | Classification | Evidence | Recommendation |
|---|---|---|---|
| 318 files fail `prettier --check` | confirmed-live | `npx prettier --check .` → "318 files" at `f142f90` | Leg 1 |
| `renderer.js` 1650 budget breaks | confirmed-live | by the pin's metric (`split(/\r?\n/).length`, = `wc -l` + 1): 1650 → 1829 after format — today's pin has zero headroom; `seam-contract.test.js` budget test red | Leg 1, DD2 (re-base to the measured 1829) |
| `bookmarks-bar.js` budget | already-satisfied | 1040 → 1077 by the pin's metric, under the 1100 pin | none |
| *(line numbers below are **post-format** addresses from the spike's failing-test output; files are shorter pre-format — locate pins by `test(...)` title)* | | | |
| `cert-picker-template.test.js:129` | confirmed-live | fails after format (matcher literal) | Leg 1, DD3 |
| `move-authority.test.js:95` | confirmed-live | same | Leg 1, DD3 |
| `move-tab-synchrony.test.js:376` | confirmed-live | same | Leg 1, DD3 |
| `search-engines.test.js:387` | confirmed-live | same | Leg 1, DD3 |
| `session-restore-wiring.test.js:181` | confirmed-live | same | Leg 1, DD3 |
| `sheet-automation-gate-invariant.test.js:251` | confirmed-live | same | Leg 1, DD3 |
| `tab-adopt-by-drop.test.js:178, 354` | confirmed-live | exact multi-line literal `.replace()` mutation pins guarded by `assertMutated` — convert targets to regex (DD3 shape 1) | Leg 1, DD3 |
| `tab-adopt-by-drop.test.js:205` ("renderer bookends") | confirmed-live | no `.replace()` — Prettier splits the literal `'e.preventDefault(); return;'`; its `gate < declare` ordering assertion rides the re-targeted anchor (DD3 shape 3) | Leg 1, DD3 |
| `tab-drag-invariants.test.js:258, 402, 455` | confirmed-live | slice-window pins asserting absence (`/\bawait\b/` in an `indexOf`→`indexOf` window) — re-anchor AND keep a positive control (DD3 shape 2) | Leg 1, DD3 |
| Option (a) "tune `.prettierrc` toward house style" | already-decided (not achievable) | `printWidth` 100/120/140/160 → 355/318/321/325 files, `renderer.js` 1871/1828/1787/1774 (`wc -l`); `arrowParens`/`bracketSameLine`/`quoteProps`/`objectWrap`/`experimentalTernaries`/combo → 1810–1828. Prettier always expands one-line function bodies and splits over-width import lists | DD1; operator chose (b) |
| CI wiring (`format:check` in both CI definitions) | confirmed-live | `ci/tasks/lint.yml` and `.github/workflows/ci.yml` run `npm run lint` only | Leg 2, DD5 |
| `.prettierignore` gaps | already-satisfied | excludes bundle, lockfile, `*.md`, `missions/`, `maintenance/`, `tests/`; no `.dat`/asset touched | none |

Totals: 13 failing assertions in 9 test files (12 matchers + the budget pin) at `printWidth: 120`
(16 at 100, 12 at 160). Test count at base: 3792.

Design-review corrections (Architect, 2026-08-27): budget metric and numbers
(above); pin addresses labelled post-format; DD3 split into three pin
shapes; DD4 changed to two PRs so the blame-ignore sha is real; DD5 notes
`set-pipeline` is not needed and adds the `lint.yml` header + `ci/README.md`
row; Leg 2 *adds* the CLAUDE.md note (none exists). Confirmed by the
Architect: DD1 (live pipe through Prettier 3.9.6); the seam anchor
`Object.assign(/** @type {any} */ (globalThis), {` survives formatting so
`extractSeamIdentifiers` is unaffected; `styles.css` is already
Prettier-clean so `bookmarks-bar-css-pin.test.js` is untouched.

---

## Leg Progress

---

## Decisions

---

## Deviations

---

## Anomalies

---

## Session Notes
