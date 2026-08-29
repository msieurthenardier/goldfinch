# Flight Log: Sheet Lifecycle Verification

**Flight**: [Sheet Lifecycle Verification](flight.md)

## Summary

Flight design ruled 2026-08-28: Lever B only (extract `createSheetEntry`,
unit-test all 19 sheet lifecycles). Lever A (test-scoped allowlist widening)
cut; admin "god mode" deferred to a future feature flight. In-flight on
`flight/03-sheet-lifecycle-verification`.

---

## Leg Progress

### Leg 1 — create-sheet-entry-extraction (landed)

- **`createSheetEntry` added** to `src/shared/modal-card-controller.js` (a fourth export
  beside `createSheetReport` / `attachModalCard` / `attachBackdropPressGate`). It wraps an
  INJECTED `register` (+ injected `reportDismissed`) — no `menuController` global, no real
  DOM — so it is unit-testable with mock nodes. Envelope composition order pinned exactly:
  the factory owns ONLY hide (`classList.add('hidden')`) + the trailing `reportDismissed`;
  the `onOpen` hook owns show+focus (forwarding the roving `startIndex`, incl. the `-1`
  focus-last path); the `onClose` hook owns the middle (scrub / field-reset / drop-ref /
  `hideOverflowIndicator`). The factory does not touch `lastStimulus`; `focusReturn` defaults
  to a no-op (matching every current site — all were `focusReturn: () => {}`).
- **Convertible/non-convertible partition: ALL 19 register sites converted; ZERO left raw.**
  Under AC6's bar (a sheet is convertible iff `createSheetEntry` can host its
  show/hide/report/focusReturn envelope with sheet-specific bits in the hooks), every sheet
  qualified — including the roving `vault-picker`/`cert-picker` (kept their own
  `attachBackdropPressGate` + roving `items` contract in the hook), `input-dialog`,
  `suggestions` (onOpen shows only, never focuses — DD2), `capture`/secret sheets
  (`dismissible: false` forwarded), and the operator-only page-context `menu` (DD4). The
  `menu` was the only non-convertible candidate; its envelope hosts cleanly (onClose keeps
  `hideOverflowIndicator()` as its middle), so it too converted — DD4 governs only its
  verification-of-record (the `page-context-menu` behavior spec), not whether its wiring is
  extracted. No raw `menuController.register` sites remain, so no source-text-only site
  exists to justify.
- **Secret-scrub relocated to the importable seam.** Each of the three secret-show card
  templates (`vault-recovery-template.js`, `vault-accesskey-template.js`,
  `vault-adminkey-template.js`) now returns a `scrub()` closure in its built refs
  (accesskey's clears BOTH `secretValue` and `keyIdValue`, preserving today's behavior);
  menu-overlay.js's onClose for those three calls `refs.scrub()` instead of inline
  `textContent = ''`. Pure builder functions kept pure — a returned closure, not a free
  function handed nodes.
- **Tests.** Added 10 `createSheetEntry` lifecycle tests (mock nodes, injected
  register/reportDismissed) to `test/unit/modal-card-controller.test.js` — open runs the
  hook + forwards `startIndex`/`-1`; close order is hide → middle → report; plain-sheet
  path; idempotent hide; focusReturn default+passthrough; items/dismissible passthrough;
  no-lastStimulus-touch. Added a red-on-delete `scrub()` test to the recovery and accesskey
  template suites and a NEW `test/unit/vault-adminkey-template.test.js` (full structure +
  scrub). Verified all three scrub tests go RED when the scrub body is emptied, then
  restored.
- **`resolve.js` / `AUTOMATABLE_MENU_TYPES` untouched** (DD1/DD3) — Flight 2's secret-sheet
  wall unchanged.
- **Checks:** full `node --test` suite green (3988 pass, 0 fail); `typecheck`, `eslint .`,
  `prettier --check .` all clean. No sheet DOM markup changed (template edits add only a
  `scrub` closure + a refs field — no `createElement`/attribute changes), so `npm run a11y`
  was not required per the leg's conditional step.

### Leg 2 — sheet-docs (landed)

- **Docs-only, two files touched** (`CLAUDE.md`, `docs/renderer-menu.md`) — no source/test edits. Paid
  down the F34/M11 chrome-indicator docs debt this flight owns as its closing step, and named Leg 1's
  `createSheetEntry` seam where the sheet lifecycle is documented.
- **New `### Chrome indicators (pure decision models)` subsection in `CLAUDE.md`** (placed after
  *Two-audience fan-out + chrome read channels*, the pushed-broadcast context the indicators consume).
  Characterizes the EXISTING shared shape once — a pure, DOM-free decision model that maps a pushed
  broadcast snapshot to a render model, never caches (latest-push projection), never throws (defensive
  coercion), unit-testable without DOM/clock, `import`ed by the chrome renderer — then names all three
  instances: `automation-indicator-model.js`'s `buildAutomationIndicatorModel` (incl. the rainbow
  **`admin`** state as the operator-visible "automation active at admin tier" signal, and the
  `isSafeColor` defense-in-depth downgrade), `vault-indicator-model.js`'s `buildVaultIndicatorModel`
  (the `vault-lock-state` `{setUp, unlocked}` projection), and `downloads-indicator-model.js`'s
  `initialState`/`reduce`/`deriveModel` (the one accumulating instance; time-injected expiry). No code
  change proposed — pure characterization of what is there.
- **`createSheetEntry` named** in `CLAUDE.md`'s `### Menu-overlay sheet` Architecture bullet (short
  pointer — the rich subsection was NOT rewritten) as the shared sheet-lifecycle factory wrapping
  `menuController.register` with the show/hide/`reportDismissed`/`focusReturn` envelope + `onOpen`/
  `onClose` hooks, injected-`register` so each lifecycle unit-tests with mock nodes.
- **`docs/renderer-menu.md` Consumers preamble refreshed**: the "all via `menuController.register({...})`"
  line now states each entry is composed through `createSheetEntry`, which wraps that register call. The
  16-family list below the preamble is untouched (squawk 0028 not regressed). The separate "shared
  modal-card helper" mention (line ~45) was left as-is — it refers to `attachModalCard` (Tab-cycle/Escape),
  a distinct helper in the same module that `createSheetEntry` does not subsume, so it does not "now apply".
- **Checks:** `prettier --check .` clean; full `node --test` suite green (3988 pass, 0 fail — unchanged
  from Leg 1); `typecheck` and `eslint .` clean. `git diff --stat` among non-artifact files shows only
  `CLAUDE.md` + `docs/renderer-menu.md` (the `src/`+`test/` changes in the tree are Leg 1's uncommitted
  work, left untouched).

---

## Decisions

- **DD1–DD4 ruled** (see flight.md Design Decisions). Lever B is the whole
  flight; Lever A cut; jar tier already complete (no change); secret sheets
  unit-test-only; page-context `menu` operator-only.

---

## Deviations

- **`test/unit/sheet-automation-gate-invariant.test.js` updated (beyond the leg's enumerated
  Files Affected).** Its AC8 source-scan pin (DD1e co-residency premise) matched the inline
  scrub expressions `recovery.keyValue.textContent = ''` etc.; the sanctioned refactor
  relocated those to `refs.scrub()`, so the pin's needles were retargeted to
  `recovery.scrub()` / `accessKey.scrub()` / `adminKey.scrub()` (still required to sit inside
  an `onClose()` body). This is a mechanical follow of the moved seam — no behavior or
  invariant change: the pin still guarantees each secret card scrubs on the close path, and
  the new template tests additionally guarantee (red-on-delete) that `scrub()` empties the
  node. The co-residency premise is now strictly better covered than before.

- **Post-review citation fix.** The flight-end review found the scrub-closure comments in
  `src/shared/vault-recovery-template.js`, `vault-accesskey-template.js`, and
  `vault-adminkey-template.js` (plus `test/unit/vault-adminkey-template.test.js`) cited
  "(DD5)"/"(DD4)" as the source of the "never retained past the display" invariant — this
  flight's own DD1–DD4 (see flight.md) don't govern it. Corrected all five citations to
  "(M15 F3 DD1f)", the documented eager-close-scrub security invariant (see CLAUDE.md's
  Menu-overlay sheet section). Comments/citations only; no logic or assertion changes.

---

## Anomalies

---

## Session Notes

### Flight Director Notes

- **Phase file loaded**: `.flightops/agent-crews/leg-execution.md` (structure
  valid: Crew / Interaction Protocol / Prompts present).
- **Recon vs current code** (flight premises F14/F23): confirmed. 19 sheets
  registered in `menu-overlay.js` (bare IIFE, no exports, 2761 lines);
  `AUTOMATABLE_MENU_TYPES` = `{bookmarks-overflow, bookmark-edit}`
  (`resolve.js:53`), gating sheet reads at `:200/:214`; 19 `register` + 21
  `attachModalCard`, 0 `createSheetEntry`. Sheet lock (guard 3) refuses the
  secret sheet **at every tier including admin** (`resolve.js:210` — "never
  automatable (any tier)").
- **Lever ruling (design leg `sheet-verification-design`)**: operator walked
  the two levers and the security model in detail. Key findings surfaced in
  discussion: (a) the sheet lock is a third gate independent of the admin and
  jar tiers, and admin's `allowInternal` does NOT lift it; (b) a jar agent
  (jar key + jar vault key) is already operationally complete — it fills via
  `answerAuth`, never needs to read auth sheets (`vault-context.js:426`);
  (c) widening the allowlist for secret sheets would let automation screenshot
  master-password plaintext, reopening the exposure Flight 2 walled.
  **Ruled: Lever B only.** Rationale in DD1.
- **Lever A cut**: the allowlist-widening leg (`test-scoped-sheet-allowlist`)
  and its checkpoints CP3/CP4-widening are dropped. Lever B delivers criterion
  5 for all 19 sheets with no read-surface change and no live-agent/flake
  exposure.
- **God mode deferred**: operator ruled admin "everything-is-game" mode
  desirable for the isolated-autonomous-agent use case, mitigated by the
  rainbow-robot indicator + additional visual indicators + a key-revocation
  kill switch, accepting the residual daily-driver risk (isolation is
  convention, not code-enforced). FD call: this is a **capability feature**,
  not maintenance verification, and contradicts the mission's "test-scoped,
  never default-on" constraint — so it is **out of Flight 3 scope**, recorded
  as a future feature flight (kin to Flight 4). Not scaffolded here; surfaced
  to the operator to choose a vehicle when Mission 17 completes.
- **Leg plan**: two remaining legs — `create-sheet-entry-extraction` (Lever B,
  high-risk: shared refactor of 19 security-sensitive sheet lifecycles →
  design review) and `sheet-docs` (CLAUDE.md subsection, low-risk).
