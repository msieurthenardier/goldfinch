# Squawk 0038: Vault lock indicator has no "Lock now" context menu

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: —

## Report

GitHub issue #113, "Lock now" half. Right-clicking the vault lock indicator on the address-bar row does nothing. Add a context menu with a single **Lock now** action that calls the existing `vaultLock()` path, following the toolbar-mode sheet-menu precedent the other indicators use. Operator ruling 2026-08-27: the indicator **stays where it is and is not made pinnable** — the pinnable half of #113 is declined, and the `CLAUDE.md` tab-scoped-pin rule stands unamended. Close #113 with that note when this lands. (Logged as a squawk on operator ruling: one bounded affordance over an existing action with an established menu pattern, no design decision left.)

Source: maintenance report 2026-08-27, finding F56; operator decision 2026-08-27.

## Evidence

- `src/renderer/index.html` — `#vault-indicator`; no `contextmenu` handler bound to it in `src/renderer/chrome/vault-controller.js`
- `vaultLock()` exists (idle-lock and explicit lock paths, Mission 12)
- Toolbar-mode sheet menus: `src/renderer/menu-overlay.js` `menu` template; `src/shared/page-context-model.js` for the "Unpin …" precedent

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
**Reviewer**: —
**Verdict**: —
**Commit**: —
