# Leg: create-sheet-entry-extraction

**Status**: completed
**Flight**: [Sheet Lifecycle Verification](../flight.md)

**Risk tier**: high — a shared refactor across 19 security-sensitive sheet
lifecycles (including the vault secret-scrub-on-close behavior) routed through
the shared `modal-card-controller.js` module consumed by many sheets. A silent
lifecycle regression here (a sheet that stops scrubbing, stops hiding, or stops
reporting dismissal) is a real security/UX fault. Design review required.

## Objective

Extract the hand-repeated `menuController.register({...})` sheet-lifecycle
scaffolding into an importable `createSheetEntry` factory in
`src/shared/modal-card-controller.js`, convert the convertible sheet
registration sites in `menu-overlay.js` to it, **and move each secret-show
sheet's scrub into its importable card-template module as a tested `scrub()`
method** — so every convertible sheet gains executable lifecycle verification
(F14), the secret-scrub invariant is pinned red-on-delete against real
importable code, and the duplication is removed (F23), with **no runtime
behavior change**.

> **Design-review incorporation (2026-08-28).** A design-review pass found that
> criterion 4 was unsatisfiable as first written: the secret scrub lived only as
> an inline closure inside the un-importable `menu-overlay.js` IIFE, so a
> mock-node `createSheetEntry` test could only assert the factory *invokes* the
> onClose it is handed — deleting the real sheet's scrub could never turn it red.
> The scrub is therefore relocated to the card-template modules (the importable
> seam). The other three findings (convertibility bar, envelope composition
> order, attachModalCard count) are incorporated below.

## Context

- **F14 / F23** (2026-08-27 maintenance report). `menu-overlay.js` is a bare
  `(() => { … })()` IIFE with no exports (2761 lines), so its sheets cannot be
  unit-imported. It registers 19 sheets via `menuController.register({...})`
  (+ 12 `attachModalCard` and 3 `attachBackdropPressGate` calls), each register
  site hand-repeating trigger/menu/focusReturn wiring and the show/hide/
  reportDismissed boilerplate.
- **Prior legs / DDs**: Ruled Lever B only (DD1). Secret sheets are unit-test
  covered only, never allowlist-widened (DD3). Page-context `menu` stays
  operator-only (DD4) — its lifecycle wiring may still be extracted, but its
  verification-of-record remains the `page-context-menu` behavior spec.
- **Existing shared module**: `src/shared/modal-card-controller.js` (175 lines,
  ESM) already exports `createSheetReport`, `attachModalCard`,
  `attachBackdropPressGate`, with unit tests in
  `test/unit/modal-card-controller.test.js`. `createSheetEntry` joins this
  module — the extraction target is the `register` scaffolding, not the
  backdrop/keyboard wiring that `attachModalCard` already owns.
- **Secret-scrub-on-close is real and load-bearing**: `vault-recovery-show`,
  `vault-accesskey-show`, `vault-adminkey-show` each `onClose() { …textContent
  = ''; }` ("scrub the DOM text — never retained past the display"). This is
  the behavior the flight's Verification requires pinned red-on-delete.

## Inputs

- `src/renderer/menu-overlay.js` — 19 `menuController.register` sites (template
  labels at lines 139, 454, 543, 662, 781, 896, 1009, 1099, 1185, 1305, 1408,
  1471, 1617, 1678, 1736, 1850, 1969, 2087, 2329) + 12 `attachModalCard` calls
  (887, 1000, 1287, 1399, 1452, 1583, 1661, 1721, 1835, 1954, 2072, 2446) + 3
  `attachBackdropPressGate` calls (654 `input-dialog`, 1091 `vault-picker`, 1177
  `cert-picker` — the sheets that do NOT use `attachModalCard`).
- `src/shared/vault-recovery-template.js`, `vault-accesskey-template.js`,
  `vault-adminkey-template.js` — the secret-show card templates that gain a
  tested `scrub()` method. **`vault-adminkey-template.js` has no test file
  today — Leg 1 adds one.**
- `src/shared/modal-card-controller.js` — the module `createSheetEntry` extends.
- `src/renderer/menu-controller.js` — owns `register(...)`; its contract is the
  thing `createSheetEntry` wraps (not changes).
- Existing tests: `test/unit/modal-card-controller.test.js`,
  `menu-controller.test.js`, `menu-overlay-manager.test.js`,
  `menu-overlay-value.test.js`, `sheet-accelerator.test.js`, the
  `chrome-shared-scripts.test.js` script-tag pins.

## Outputs

- `createSheetEntry` exported from `src/shared/modal-card-controller.js`.
- The convertible `register` sites in `menu-overlay.js` route through it; any
  non-convertible site (candidate: only the operator-only `menu`) is enumerated
  with justification and still carries its own executable lifecycle test.
- A tested `scrub()` method on each of the three secret-show card templates,
  called from `menu-overlay.js`'s onClose; a new `vault-adminkey-template.test.js`.
- New unit tests pinning the createSheetEntry lifecycle and the template scrubs.

## Acceptance Criteria

1. `createSheetEntry(opts)` is exported (ESM) from
   `src/shared/modal-card-controller.js` and is constructed in a unit test with
   an **injected** `menuController.register` and **mock nodes** — no real DOM,
   no menu-overlay IIFE load.
2. Every convertible `menuController.register` site in `menu-overlay.js` calls
   `createSheetEntry`; the shared show(`classList.remove('hidden')`) /
   hide(`classList.add('hidden')`) / `reportDismissed` / `focusReturn`
   scaffolding is no longer hand-repeated at those sites. Non-convertible sites
   are listed in the leg with a one-line reason each.
3. Unit tests exercise the lifecycle: opening the entry calls the sheet's
   `onOpen` and unhides its node; closing calls `onClose`, hides the node,
   reports dismissal, and runs `focusReturn`.
4. Each secret-show template (`vault-recovery-template.js`,
   `vault-accesskey-template.js`, `vault-adminkey-template.js`) exposes a
   `scrub()` method that clears its secret display node(s) (`keyValue` /
   `secretValue` / `keyIdValue`), and `menu-overlay.js`'s `onClose` for those
   three sheets calls `template.scrub()` instead of an inline `textContent = ''`.
   A unit test importing each template asserts `scrub()` empties the node(s) and
   goes **RED** when the scrub body is deleted — the "never retained past the
   display" invariant is pinned against real importable code, not by source-text
   presence and not merely by a mock-node factory test. (`vault-adminkey-template.js`
   gets a new test file for this.)
5. **No behavior change**: the full suite is green — including
   `menu-controller`, `menu-overlay-manager`, `modal-card-controller`,
   `menu-overlay-value`, `sheet-accelerator`, and the
   `chrome-shared-scripts.test.js` script-tag pins — and `npm run typecheck`,
   ESLint, and `prettier --check .` are clean.
6. No sheet in the F14 "none / never-run" columns remains verified by
   source-text presence alone. **Convertibility bar**: a sheet is convertible iff
   `createSheetEntry` can host its show/hide/reportDismissed/focusReturn envelope
   with its sheet-specific bits supplied as `onOpen`/`onClose` hooks — a
   sheet-specific hook does NOT make it non-convertible. Under this bar nearly
   every sheet converts (including `vault-picker`/`cert-picker`, which keep their
   own `attachBackdropPressGate` + roving contract, and `input-dialog`). Any
   sheet left unconverted (candidate: only the operator-only page-context `menu`,
   DD4) must be listed with a one-line reason AND must still carry its own
   executable lifecycle test — never source-text-only. The page-context `menu`
   remains operator-only for its verification-of-record (the `page-context-menu`
   behavior spec) regardless of whether its envelope is extracted.
7. `AUTOMATABLE_MENU_TYPES` (`resolve.js:53`) is unchanged — no allowlist
   widening (DD1/DD3); Flight 2's secret-sheet wall is untouched.

## Verification Steps

- `node --test test/unit/modal-card-controller.test.js` — createSheetEntry
  lifecycle tests pass.
- `node --test test/unit/vault-adminkey-template.test.js` (and the recovery/
  accesskey template tests) — `scrub()` empties the secret node(s).
- Temporarily delete a template `scrub()` body → its template test fails →
  restore. (This is the real red-on-delete pin — an importable-code test, not a
  mock-node factory test.)
- `grep -c menuController.register src/renderer/menu-overlay.js` and confirm each
  remaining raw site is on the documented non-convertible list.
- `node --test` (full suite) green; `npm run typecheck`; `npx eslint .`;
  `npx prettier --check .`.
- `npm run a11y` if any sheet DOM markup changed (extraction should not change
  markup — confirm).

## Implementation Guidance

- `createSheetEntry` wraps `menuController.register`: it should accept the
  sheet-specific `node` (and any distinct `trigger`/`menu`), plus optional
  `onOpen`/`onClose` hooks, and supply the repeated show/hide/reportDismissed/
  focusReturn behavior around them. Inject `register` and `reportDismissed`
  (don't reach for globals) so the factory is unit-testable in isolation.
- **Pin the exact envelope composition order — this is the primary regression
  vector.** Current sites vary: `input-dialog` onOpen is `value=''` →
  `remove('hidden')` → `focus`; `downloads`/`menu` focus AFTER unhide; secret
  onClose is `add('hidden')` → scrub → drop-ref → `reportDismissed`; `menu`
  onClose is `add('hidden')` → `hideOverflowIndicator()` → `reportDismissed`.
  Rather than hardcode a show/focus order the factory can't match everywhere,
  the safest seam is: `createSheetEntry` owns only hide (`add('hidden')`) and
  the trailing `reportDismissed`, and lets the `onOpen` hook own show+focus and
  the `onClose` hook own everything between hide and reportDismissed (scrub,
  drop-ref, `hideOverflowIndicator`). Document the chosen order in the module and
  verify it matches every converted site before/after.
- **Forward `onOpen` args to the hook.** `menu` (172), `vault-picker` (1044),
  and `cert-picker` (1127) are `onOpen(startIndex = 0)` and `register` calls
  `onOpen(startIndex)` — including the `startIndex === -1` "focus last" path
  (175). The factory's `onOpen` wrapper must pass its arguments through to the
  sheet hook, or the roving start-index is silently dropped.
- **Scrub seam shape.** The three `vault-*-template.js` are pure builder
  functions (`buildVaultRecoveryCard(document)` → refs), not stateful objects.
  Return a `scrub` closure in the built refs (closing over the created
  `keyValue`/`secretValue`/`keyIdValue` nodes) so `refs.scrub()` is importable
  and directly testable — do NOT add a free function that must be handed nodes.
  `menu-overlay.js`'s onClose then calls `refs.scrub()`. (accesskey's
  `keyIdValue` is documented non-secret but is cleared today — `scrub()` clears
  it too, preserving behavior.)
- `createSheetEntry` must **not** touch `lastStimulus` — `reportDismissed`
  already resets it to `'blur'` after send, and external handlers
  (`picker.close`, the downloads local-keydown) set it before calling
  `menuController.close`. Preserve that.
- **Pre-classified special contracts** (must be preserved, converted or not):
  `menu` (programmatic open, no-op `focusReturn`, extra `hideOverflowIndicator()`
  in onClose, operator-only per DD4); `suggestions` (`onOpen` must never move
  focus, DD-guarded); `vault-picker` / `cert-picker` / `input-dialog` (own
  `attachBackdropPressGate`, do not use `attachModalCard`; `vault-picker` is
  roving). These convert at the register-envelope level with their contract in
  the hooks — they are NOT exempt from having an executable lifecycle test.
- This is a **characterization refactor**: preserve each sheet's current
  behavior exactly. Do NOT add a new scrub-on-close where none exists (the
  vault-unlock/auth sheets scrub on submit + reset on open — leave that shape);
  only the three secret-show sheets scrub on close today, and that stays.
- Sheets with special contracts must keep them: the roving vault-picker does
  NOT use `attachModalCard` and has a roving-keyboard contract; `suggestions`
  `onOpen` must never move focus; the page-context `menu` opens programmatically
  with a no-op `focusReturn`. If `createSheetEntry` cannot host a contract
  cleanly, leave that site unconverted and document why — partial conversion is
  an acceptable variation per the flight's Adaptation Criteria, provided every
  sheet still ends with executable verification.
- Rename over delete-and-re-add if any existing test moves.

## Edge Cases

- A sheet whose `onClose` both scrubs a secret AND reports dismissal — order
  must be preserved (scrub before/independent of report; never skip scrub on an
  early return).
- Double-close / close-before-open: the factory must not throw on a hide of an
  already-hidden node (matches current `classList.add('hidden')` idempotence).
- `focusReturn` no-op sheets (menu, and any main-side-refocus sheet) must remain
  no-ops — do not introduce a focus move.

## Files Affected

- `src/shared/modal-card-controller.js` (add `createSheetEntry`)
- `src/renderer/menu-overlay.js` (convert register sites; secret onClose calls
  `template.scrub()`)
- `src/shared/vault-recovery-template.js`, `vault-accesskey-template.js`,
  `vault-adminkey-template.js` (add tested `scrub()`)
- `test/unit/modal-card-controller.test.js` (or a new `create-sheet-entry.test.js`)
- `test/unit/vault-recovery-template.test.js`, `vault-accesskey-template.test.js`
  (extend), and a NEW `test/unit/vault-adminkey-template.test.js`

## Citation Audit

- `resolve.js:53` `AUTOMATABLE_MENU_TYPES` — verified 2026-08-28.
- `modal-card-controller.js` exports `createSheetReport`/`attachModalCard`/
  `attachBackdropPressGate` — verified (lines 31/117/144), 175 lines.
- Sheet wiring counts (design-review-corrected 2026-08-28): 19 `register` + 12
  `attachModalCard` (887, 1000, 1287, 1399, 1452, 1583, 1661, 1721, 1835, 1954,
  2072, 2446) + 3 `attachBackdropPressGate` (654, 1091, 1177). Prior "21" was the
  raw grep line count (comments + import), not call sites.
- Secret-scrub-on-close in `onClose` — verified 2026-08-28 at menu-overlay.js
  1434-1439 (`vault-recovery-show`), 1642-1649 (`vault-accesskey-show`),
  1703-1709 (`vault-adminkey-show`); card templates
  `src/shared/vault-{recovery,accesskey,adminkey}-template.js` exist and hold no
  scrub today; `vault-adminkey-template.js` has no test file.
- `menuController.register` consumers: only the 19 menu-overlay.js sites (other
  repo `.register(` hits are unrelated registries). No external consumer breaks.
- menu-overlay.js template-label lines re-derived 2026-08-28 (drifted from the
  flight spec's F23 numbers; the flight text cites the pre-drift lines).

## Corrective Outcome (landed 2026-08-28)

Implemented exactly to the Acceptance Criteria; no scope growth, no design decisions
required beyond the leg.

- **AC1** — `createSheetEntry` is exported (ESM) from `modal-card-controller.js` and is
  constructed in `modal-card-controller.test.js` with an INJECTED `register` +
  `reportDismissed` and MOCK nodes (no real DOM, no menu-overlay IIFE load).
- **AC2 / AC6** — ALL 19 convertible `menuController.register` sites now call
  `createSheetEntry`; the show / hide / `reportDismissed` / `focusReturn` scaffolding is no
  longer hand-repeated. **Partition: 19 convertible → 19 converted; 0 non-convertible; 0
  raw sites remain.** The operator-only page-context `menu` (the only non-convertible
  candidate) converted cleanly at the register-envelope level — its `hideOverflowIndicator()`
  lives in the `onClose` hook — so no source-text-only site exists. DD4 continues to govern
  the `menu`'s verification-of-record (the `page-context-menu` behavior spec), which is
  independent of whether its envelope is extracted.
- **AC3** — lifecycle tests exercise open (hook runs, node unhides, `startIndex`/`-1`
  forwarded) and close (hide → `onClose` middle → `reportDismissed`, `focusReturn`).
- **AC4** — each secret-show template exposes a `scrub()` closure in its built refs
  (recovery → `keyValue`; accesskey → `secretValue` + `keyIdValue`; adminkey → `keyValue`);
  menu-overlay.js's onClose for the three calls `refs.scrub()`. Template tests assert
  `scrub()` empties the node(s) and go **RED** when the scrub body is deleted (verified for
  all three, then restored) — pinned against real importable code, incl. the NEW
  `test/unit/vault-adminkey-template.test.js`.
- **AC5** — full `node --test` suite green (3982 pass / 0 fail); `typecheck`, `eslint .`,
  `prettier --check .` clean.
- **AC7** — `AUTOMATABLE_MENU_TYPES` (`resolve.js:53`) untouched; no allowlist widening.

Envelope composition order (the primary regression vector) matched every converted site
before/after: factory owns hide + trailing report only; `onOpen` owns show+focus with the
roving start-index forwarded; `onClose` owns the middle; `lastStimulus` is never touched by
the factory. No sheet DOM markup changed, so `npm run a11y` was not required.

Deviation (recorded in the flight log): the AC8 source-scan pin in
`sheet-automation-gate-invariant.test.js` was retargeted from the inline
`recovery.keyValue.textContent = ''` needles to `recovery.scrub()` etc. to track the moved
seam — invariant preserved and now additionally backed by the red-on-delete template tests.
