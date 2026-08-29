# Leg: sheet-docs

**Status**: completed
**Flight**: [Sheet Lifecycle Verification](../flight.md)

**Risk tier**: low — additive documentation only, no source/test changes, in
established doc patterns. Flight-end Reviewer covers it; no per-leg design review.

## Objective

Pay down the F34/M11 docs debt this flight owns as its closing step: add a
**chrome-indicator** subsection to `CLAUDE.md`, name the new `createSheetEntry`
shared factory where the sheet lifecycle is documented, and refresh
`docs/renderer-menu.md` so its "all via `menuController.register`" framing
reflects that sheets now register through `createSheetEntry`.

## Context

- **F34** (2026-08-27 report): "Flight 3 owns the sheet/chrome-indicator
  subsection as its closing step." The `### Menu-overlay sheet` subsection in
  `CLAUDE.md` already documents the sheet richly; the genuinely-owed piece is the
  **chrome-indicator pattern** (M11) — never given a dedicated section.
- **F35** (squawk 0028, completed): `docs/renderer-menu.md` Consumers now names
  all 16 template families. Only a light freshness pass is left: its preamble
  says sheets register "all via `menuController.register({...})`", which Leg 1
  routed through `createSheetEntry`.
- **Leg 1 outcome**: `createSheetEntry` is now the shared sheet-lifecycle factory
  (fourth export of `src/shared/modal-card-controller.js`), wrapping
  `menuController.register`. It is not yet named in any doc.

## Inputs

- `CLAUDE.md` — `### src/shared/ ESM modules` (line ~44), `### Menu-overlay
  sheet` (~129); no chrome-indicator section exists.
- The three indicator models (the pattern to document):
  `src/shared/automation-indicator-model.js` (`buildAutomationIndicatorModel` —
  the "robot" indicator, incl. the rainbow admin state),
  `src/shared/vault-indicator-model.js` (`buildVaultIndicatorModel`),
  `src/renderer/chrome/downloads-indicator-model.js` (`initialState`/`reduce`/
  `deriveModel`).
- `docs/renderer-menu.md` — Consumers preamble (~20) + "shared modal-card
  helper" mentions.

## Outputs

- A `CLAUDE.md` chrome-indicator subsection.
- `createSheetEntry` named in `CLAUDE.md`.
- `docs/renderer-menu.md` refreshed for the `createSheetEntry` seam.

## Acceptance Criteria

1. `CLAUDE.md` gains a chrome-indicator subsection that names all three indicator
   models and states the shared shape: a **pure, DOM-free decision model** (a
   `build*IndicatorModel` projection, or reducer→`deriveModel` for downloads)
   that maps a pushed broadcast snapshot to a render model, **never caches** (a
   pure projection of the latest push), never throws (defensive coercion), is
   unit-testable without DOM/clock, and is `import`ed by the chrome renderer.
2. `createSheetEntry` is named in `CLAUDE.md` as the shared sheet-lifecycle
   factory (in the `src/shared/` ESM modules list and/or the Menu-overlay sheet
   subsection), described as wrapping `menuController.register` with the
   show/hide/reportDismissed/focusReturn envelope and `onOpen`/`onClose` hooks.
3. `docs/renderer-menu.md`'s Consumers preamble (and any "shared modal-card
   helper" mention that now applies) reflects that register sites route through
   `createSheetEntry`; the 16-family list stays accurate (do not regress squawk
   0028's work).
4. **Docs only** — `git diff --stat` shows no changes under `src/`, `test/`, or
   any code/config file; only `CLAUDE.md` and `docs/renderer-menu.md`.
5. `prettier --check .` is clean (run `--write` on the two docs if it flags
   them); the full `node --test` suite stays green (guards any docs-contract
   pin); `npm run typecheck` and `eslint .` clean.

## Verification Steps

- `grep -n "chrome-indicator\|buildAutomationIndicatorModel\|buildVaultIndicatorModel\|deriveModel" CLAUDE.md` — the new subsection names all three.
- `grep -n "createSheetEntry" CLAUDE.md docs/renderer-menu.md` — named in both.
- `git diff --stat` — only the two doc files.
- `npx prettier --check .`; `node --test`; `npm run typecheck`; `npx eslint .`.

## Implementation Guidance

- Keep the chrome-indicator subsection in the house voice of the existing
  `CLAUDE.md` Patterns sections — dense, file-cited, one shape stated once with
  the three instances as examples. Note the automation indicator's rainbow/admin
  state (it is the operator-visible "automation is active" signal).
- This is a characterization of EXISTING code — do not propose changes to the
  indicator models or the sheet factory; document what is there.
- Do not rewrite the rich `### Menu-overlay sheet` subsection; add a short
  pointer to `createSheetEntry` where the lifecycle is described, or list it in
  the `src/shared/` ESM modules bullet.

## Files Affected

- `CLAUDE.md`
- `docs/renderer-menu.md`

## Citation Audit

- Indicator models verified 2026-08-28: `automation-indicator-model.js:80`
  `buildAutomationIndicatorModel`; `vault-indicator-model.js:26`
  `buildVaultIndicatorModel`; `downloads-indicator-model.js:37/47/171`
  `initialState`/`reduce`/`deriveModel`.
- `createSheetEntry` at `src/shared/modal-card-controller.js:138` (Leg 1).
- `CLAUDE.md` has no existing `chrome-indicator` section (grep empty, 2026-08-28).
- `docs/renderer-menu.md` Consumers preamble at ~line 20 (2026-08-28).

## Outcome

Landed 2026-08-28. Docs-only, two files (`CLAUDE.md`, `docs/renderer-menu.md`);
no source/test changes.

- **AC1** — `CLAUDE.md` gained a `### Chrome indicators (pure decision models)`
  subsection (after *Two-audience fan-out + chrome read channels*) naming all
  three models — `buildAutomationIndicatorModel`, `buildVaultIndicatorModel`,
  and the downloads `initialState`/`reduce`/`deriveModel` — and stating the shared
  shape once (pure, DOM-free, latest-push projection that never caches, defensive
  never-throws, unit-testable without DOM/clock, `import`ed by the chrome renderer).
  The automation model's rainbow **`admin`** state is called out as the
  operator-visible "automation active at the admin tier" signal. Pure
  characterization of existing code — no change proposed.
- **AC2** — `createSheetEntry` named in the `### Menu-overlay sheet` Architecture
  bullet (short pointer; the rich subsection not rewritten) as the shared
  sheet-lifecycle factory wrapping `menuController.register` with the
  show/hide/`reportDismissed`/`focusReturn` envelope and `onOpen`/`onClose` hooks.
- **AC3** — `docs/renderer-menu.md` Consumers preamble now routes the register
  sites through `createSheetEntry`; the 16-family list is intact (squawk 0028 not
  regressed). The `attachModalCard` "shared modal-card helper" mention was left
  as-is (distinct helper, not subsumed by `createSheetEntry`).
- **AC4** — `git diff --stat`: among non-artifact files, only `CLAUDE.md` and
  `docs/renderer-menu.md` (the `src/`+`test/` changes present are Leg 1's
  uncommitted work, untouched).
- **AC5** — `prettier --check .` clean; full `node --test` suite green (3988 pass,
  0 fail); `npm run typecheck` and `eslint .` clean.
