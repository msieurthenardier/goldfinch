# Flight: Sheet Lifecycle Verification

**Status**: landed
**Mission**: [Codebase Health — 2026-08-27 Maintenance](../../mission.md)

## Contributing to Criteria

- [x] No sheet in `menu-overlay.js` is verified by source-text presence alone (criterion 5)

---

## Pre-Flight

### Objective

Put executable verification under the 17 of 19 sheet lifecycles in
`menu-overlay.js` that have none today, by making the sheets drivable from
the behavior-test apparatus and/or extracting the shared registration
boilerplate into an importable module with isolated unit tests.

### Open Questions

- [x] Lever choice — **ruled: Lever B only** (see DD1). Lever A (test-scoped
      allowlist widening) is cut; the extraction gives all 19 sheets
      executable verification without touching the automation read surface.
- [x] Operator-only sheets — **ruled** (see DD4): the page-context `menu`
      stays operator-only (covered by the existing `page-context-menu`
      behavior spec); every other sheet converts to `createSheetEntry` and
      gains unit-test lifecycle coverage.

### Design Decisions

*(Ruled in the flight-design conversation 2026-08-28; see flight log Flight
Director Notes for the discussion trail.)*

**DD1 — Lever B (extraction + unit tests) is the whole flight; Lever A
(allowlist widening) is cut.** `createSheetEntry` is extracted into an
importable module and every sheet's lifecycle (open/close ordering, focus
return, secret-scrub-on-close) is unit-tested against mock nodes. This
delivers criterion 5 for all 19 sheets **without touching the automation
read surface at all** — no `AUTOMATABLE_MENU_TYPES` change, no new launch
flag, no live-agent dependency (and so no exposure to the recurring
behavior-test flake). It also resolves F23 (the 19×`register` +
21×`attachModalCard` duplication) in the same pass. Rationale: the unit
tests exercise the *code path*, not live secrets, so the secret sheets get
real verification (the scrub call is asserted) with zero secret-exposure
risk; rendered-state verification of the non-secret sheets was judged not
worth inventing a widening mechanism for.

**DD2 — The jar tier is already complete; Flight 3 changes nothing about
it.** A jar-scoped agent holding a jar automation key + that jar's vault key
drives its own tabs (`resolveContentsForJar` throws `out-of-jar` on any
foreign tab) and authenticates to its sites via the `answerAuth`/`fill` path
(jar-membership + origin checked) — it *fills* credentials rather than
reading auth sheets, so it needs no sheet-read access to function. Confirmed
against `vault-context.js:426` `resolveTarget`.

**DD3 — Secret sheets stay unit-test-only; no tier reads them in Flight 3.**
The vault-secret family (`vault-set`, `vault-recover`, `vault-change-master`,
`vault-accesskey-show`, `vault-adminkey-show`, and the master-password sheet)
is verified by Lever B unit tests and is never added to
`AUTOMATABLE_MENU_TYPES`. Flight 2's secret-sheet wall (`resolve.js:210`,
refused at any tier) is untouched.

**DD4 — Operator-only partition.** The page-context `menu` sheet stays
operator-only (ruled inconclusive-at-runtime by the 2026-08-27 sweep; covered
by the existing `page-context-menu` behavior spec). All other sheets convert
to `createSheetEntry` and gain unit-test lifecycle coverage.

**Deferred — admin "god mode" (recorded, out of Flight 3 scope).** The
operator ruled during lever discussion that an admin "everything-is-game" mode
(admin reach lifting even the secret-sheet wall for the isolated-autonomous-
agent use case) is desirable, mitigated by the existing rainbow-robot admin
indicator, additional "all-access" visual indicators, and a key-revocation
**kill switch** — and that the capability outweighs the residual daily-driver
risk (admin is env-gated and *can* run on a packaged build; isolation is
convention, not enforced). This is a **capability change, not maintenance
verification**, and departs from this mission's "test-scoped, never default-on"
constraint. It is therefore **not** part of Flight 3 — captured as a future
feature flight (kin to the Flight 4 vault trust-boundary work), to be designed
with the isolation gate, indicators, and kill switch as first-class parts.

### Prerequisites

- [x] Maintenance report 2026-08-27, findings F14 and F23 (the sheet-coverage table is the inventory)
- [x] **Flight 2 landed** — this flight's widening touches the same
      secret-sheet gate Flight 2 hardens; any widening must be test-scoped
      and never default-on

### Pre-Flight Checklist

- [x] Lever choice ruled (DD1: Lever B only); operator-only sheets listed (DD4)
- Other items N/A — maintenance flight.

---

## In-Flight

### Technical Approach

**Inventory (F14).** `menu-overlay.js` registers 19 sheets via
`menuController.register({...})` with `/* template: X */` labels:
`menu`, `info-popup`, `input-dialog`, `suggestions`, `vault-unlock`,
`auth-basic`, `vault-picker`, `cert-picker`, `vault-capture`, `vault-set`,
`vault-recovery-show`, `vault-stepup`, `vault-accesskey-show`,
`vault-adminkey-show`, `vault-import`, `vault-change-master`,
`vault-recover`, `downloads`, `bookmark-edit`. `AUTOMATABLE_MENU_TYPES`
(`src/main/automation/resolve.js:53`) is `{bookmarks-overflow,
bookmark-edit}`, gating sheet `readDom`/`readAxTree`/`captureScreenshot`
at `:200`. Verification state: 8 sheets have no behavior spec
(`vault-set` … `vault-recover`); 4 have specs never run (`vault-capture`,
`cert-picker`, the two `vault-unlock`-interior specs); 2 have only
pre-gate runs (`downloads` 2026-07-08, `auth-basic` 2026-07-28); the
page-context `menu` is ruled operator-only. The file is a bare IIFE with
no exports — it cannot be unit-imported.

**Lever A — test-scoped allowlist widening.** Make `AUTOMATABLE_MENU_TYPES`
extensible under an explicit test-mode flag (never in a packaged or
default dev launch — Flight 2's refusal must hold otherwise), so the
Witnessed apparatus can read and capture the vault/auth/cert/downloads
sheets. Then author one behavior spec per newly drivable sheet family and
**re-run** the stale `downloads` and `auth-basic` specs rather than trust
them.

**Lever B — `createSheetEntry` extraction (F23).** The 19 register sites
(`menu-overlay.js:159, 457, 792, 1008, 1098, 1188, 1294, 1391, 1461, 1590,
1651, 1709, 1812, 1921, 2036, 2272`, +3) and 12 `attachModalCard` sites
hand-repeat trigger/menu/dismissible/onOpen/onClose/focusReturn wiring.
Extract `createSheetEntry({node, cycle, dismissible, onOpen, onClose})`
into an importable module (ESM, no globals), convert the sheets to it, and
unit-test the entry's lifecycle — open/close ordering, focus return,
secret-scrub-on-close for the vault family — against mock nodes, which
sidesteps the IIFE problem without a full DOM harness. Keep the
`chrome-shared-scripts.test.js` script-tag pins green.

**Closing leg — docs (F34 partial).** Add the menu-overlay /
chrome-indicator subsection to CLAUDE.md (owed since M11) and refresh
`docs/renderer-menu.md`'s Consumers list if squawk 0028 has not already.

### Checkpoints

- [x] CP1: lever ruled (Lever B, DD1); sheets partitioned — all convert to
      `createSheetEntry` + unit tests except the operator-only page-context
      `menu` (DD4)
- [x] CP2: no sheet in the "none" column of the F14 table remains — every
      converted sheet has a lifecycle unit test
- [ ] CP3: *(N/A — Lever A cut; no allowlist widening, so no stale specs to
      re-run under a widened allowlist)*
- [x] CP4: suite/typecheck/lint green (a11y where UI pages touched);
      `AUTOMATABLE_MENU_TYPES` unchanged, so Flight 2's admin-refusal spec is
      untouched

### Adaptation Criteria

**Divert if**: the widening cannot be scoped away from the packaged build
without a build-time flag the project does not have — then Lever B alone,
with the widening becoming a separate ruled decision.

**Acceptable variations**: converting a subset of sheets to
`createSheetEntry` in this flight and the rest on next touch, provided
every sheet has *some* executable verification by CP2.

### Legs

- [x] `sheet-verification-design` - lever ruling + partition *(ruled in the
      flight-design conversation 2026-08-28; see Design Decisions)*
- [x] `create-sheet-entry-extraction` - Lever B: extract `createSheetEntry`,
      convert the 19 sheets, unit-test each lifecycle (F23 + F14)
- [x] `sheet-docs` - CLAUDE.md menu-overlay/chrome-indicator subsection (F34 partial)

*(Cut: `test-scoped-sheet-allowlist` — Lever A was not chosen; see DD1 and the
flight log Flight Director Notes.)*

---

## Post-Flight

### Completion Checklist

- [x] All legs completed
- [ ] Code merged
- [x] Tests passing
- [x] Documentation updated

### Verification

The F14 coverage table re-derived at the flight debrief with every row in
a verified column; the `downloads` and `auth-basic` run logs dated after
this flight; unit tests for `createSheetEntry` that go red when the
secret-scrub call is deleted.
