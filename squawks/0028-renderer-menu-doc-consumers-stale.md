# Squawk 0028: `docs/renderer-menu.md` Consumers list names 3 of 16 sheet template families

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: 2026-08-27

## Report

The doc's "Consumers" section lists `menu`, `info-popup`, `input-dialog` as what registers with `menu-controller.js`. `menu-overlay.js` today registers 19 sites across 16 template families — the `vault-*` family (9), `auth-basic`, `cert-picker`, `downloads`, `bookmark-edit`, `suggestions` are all absent from the enumeration. Extend the list (a line each is enough) so a reader following it finds the actual set.

Source: maintenance report 2026-08-27, finding F35.

## Evidence

- `docs/renderer-menu.md:20-33` — the Consumers section
- `src/renderer/menu-overlay.js` — 19 `menuController.register({` sites with `/* template: X */` labels

## Corrective Action

Re-derived the consumer list directly from `src/renderer/menu-overlay.js` rather than
trusting the report's count: 19 `menuController.register({` sites, each under its own
`/* template: X */` label, with a `TEMPLATES` registry (`:2368`) confirming 19 distinct
template names — **not** 16 families as the report's own prose stated (its own
enumerated list already named 19). Of those, 11 are `vault-*` (not 9 as the report
guessed): `vault-unlock`, `vault-picker`, `vault-capture`, `vault-set`,
`vault-recovery-show`, `vault-stepup`, `vault-accesskey-show`, `vault-adminkey-show`,
`vault-import`, `vault-change-master`, `vault-recover`. The remaining 8 are `menu`,
`info-popup`, `input-dialog`, `suggestions`, `auth-basic`, `cert-picker`, `downloads`,
`bookmark-edit`.

Extended `docs/renderer-menu.md`'s Consumers section (`docs/renderer-menu.md:20-33`)
with new entries for all 16 previously-unlisted templates, kept as one line each
(the 11 `vault-*` members grouped into a single family line), grouped after the
existing `menu`/`info-popup`/`input-dialog` entries (whose wording was left
untouched): a `vault-*` family line, then `auth-basic`, `cert-picker`, `downloads`,
`bookmark-edit`, `suggestions` — each noting whether it registers `items` (only
`vault-picker` and `cert-picker` do, both roving row lists; every other template in
scope registers without `items`).

Checked whether the doc names an `AUTOMATABLE_MENU_TYPES`/"drivable" menuType list
elsewhere that could drift against `src/main/automation/resolve.js`'s
`AUTOMATABLE_MENU_TYPES` set (`bookmarks-overflow`, `bookmark-edit`) — the doc has no
such list (its only "automat-" hit is the unrelated `AutomationActivity` type
reference), so no fix was needed there.

## Verification

- `grep -n "template:" src/renderer/menu-overlay.js | wc -l` → 19; cross-checked
  against the `TEMPLATES` registry object and the `menuController.register({` call
  sites — 19 unique templates, 11 of them `vault-*`.
- `npx prettier --check docs/renderer-menu.md` → passes ("All matched files use
  Prettier code style!"), no pre-existing formatting drift in this file.
- Diff scoped to `docs/renderer-menu.md`'s Consumers section only; no source files
  touched.

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the Developers' reasoning) — one review round, clean on the first pass; batch turnaround 2026-08-27 (batch 3)
**Verdict**: confirmed
**Commit**: `squawk: turnaround 2026-08-27 (batch 3)` on `squawk/turnaround-2026-08-27-3` (PR number recorded on the PR itself)

Batch gates at review: 3792/3792 tests (no code changed), lint clean, typecheck clean.
