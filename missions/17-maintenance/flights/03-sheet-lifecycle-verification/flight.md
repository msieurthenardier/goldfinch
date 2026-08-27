# Flight: Sheet Lifecycle Verification

**Status**: ready
**Mission**: [Codebase Health — 2026-08-27 Maintenance](../../mission.md)

## Contributing to Criteria

- [ ] No sheet in `menu-overlay.js` is verified by source-text presence alone (criterion 5)

---

## Pre-Flight

### Objective

Put executable verification under the 17 of 19 sheet lifecycles in
`menu-overlay.js` that have none today, by making the sheets drivable from
the behavior-test apparatus and/or extracting the shared registration
boilerplate into an importable module with isolated unit tests.

### Open Questions

- [ ] Lever choice: widen `AUTOMATABLE_MENU_TYPES` (test-scoped) so the
      vault/auth/cert-picker/downloads sheets can be read and captured by
      the Witnessed apparatus; extract `createSheetEntry` and unit-test it
      against mock nodes; or both. Extraction reduces the surface the
      widening has to cover.
- [ ] Which sheets are *structurally* operator-only (the M15/M16 debriefs
      named the page-context sheet) and stay so by ruling, with that
      ruling recorded rather than re-discovered per run?

### Design Decisions

*(to be written at flight design)*

### Prerequisites

- [x] Maintenance report 2026-08-27, findings F14 and F23 (the sheet-coverage table is the inventory)
- [ ] **Flight 2 landed** — this flight's widening touches the same
      secret-sheet gate Flight 2 hardens; any widening must be test-scoped
      and never default-on

### Pre-Flight Checklist

- [ ] Lever choice ruled; operator-only sheets listed
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

- [ ] CP1: lever(s) ruled; sheet list partitioned into drivable /
      unit-tested / operator-only-by-ruling
- [ ] CP2: no sheet in the "none" column of the F14 table remains
- [ ] CP3: stale `downloads` and `auth-basic` specs re-run green on the
      current build
- [ ] CP4: suite/typecheck/lint/a11y green; Flight 2's admin-refusal spec
      still green with the test-scoped widening off

### Adaptation Criteria

**Divert if**: the widening cannot be scoped away from the packaged build
without a build-time flag the project does not have — then Lever B alone,
with the widening becoming a separate ruled decision.

**Acceptable variations**: converting a subset of sheets to
`createSheetEntry` in this flight and the rest on next touch, provided
every sheet has *some* executable verification by CP2.

### Legs

- [ ] `sheet-verification-design` - lever ruling + partition
- [ ] `create-sheet-entry-extraction` - Lever B + unit tests
- [ ] `test-scoped-sheet-allowlist` - Lever A + specs + re-runs
- [ ] `sheet-docs` - CLAUDE.md subsection

---

## Post-Flight

### Completion Checklist

- [ ] All legs completed
- [ ] Code merged
- [ ] Tests passing
- [ ] Documentation updated

### Verification

The F14 coverage table re-derived at the flight debrief with every row in
a verified column; the `downloads` and `auth-basic` run logs dated after
this flight; unit tests for `createSheetEntry` that go red when the
secret-scrub call is deleted.
