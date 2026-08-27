# Squawk 0028: `docs/renderer-menu.md` Consumers list names 3 of 16 sheet template families

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: —

## Report

The doc's "Consumers" section lists `menu`, `info-popup`, `input-dialog` as what registers with `menu-controller.js`. `menu-overlay.js` today registers 19 sites across 16 template families — the `vault-*` family (9), `auth-basic`, `cert-picker`, `downloads`, `bookmark-edit`, `suggestions` are all absent from the enumeration. Extend the list (a line each is enough) so a reader following it finds the actual set.

Source: maintenance report 2026-08-27, finding F35.

## Evidence

- `docs/renderer-menu.md:20-33` — the Consumers section
- `src/renderer/menu-overlay.js` — 19 `menuController.register({` sites with `/* template: X */` labels

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
**Reviewer**: —
**Verdict**: —
**Commit**: —
