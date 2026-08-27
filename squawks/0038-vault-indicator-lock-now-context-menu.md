# Squawk 0038: Vault lock indicator has no "Lock now" context menu

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: 2026-08-27

## Report

GitHub issue #113, "Lock now" half. Right-clicking the vault lock indicator on the address-bar row does nothing. Add a context menu with a single **Lock now** action that calls the existing `vaultLock()` path, following the toolbar-mode sheet-menu precedent the other indicators use. Operator ruling 2026-08-27: the indicator **stays where it is and is not made pinnable** — the pinnable half of #113 is declined, and the `CLAUDE.md` tab-scoped-pin rule stands unamended. Close #113 with that note when this lands. (Logged as a squawk on operator ruling: one bounded affordance over an existing action with an established menu pattern, no design decision left.)

Source: maintenance report 2026-08-27, finding F56; operator decision 2026-08-27.

## Evidence

- `src/renderer/index.html` — `#vault-indicator`; no `contextmenu` handler bound to it in `src/renderer/chrome/vault-controller.js`
- `vaultLock()` exists (idle-lock and explicit lock paths, Mission 12)
- Toolbar-mode sheet menus: `src/renderer/menu-overlay.js` `menu` template; `src/shared/page-context-model.js` for the "Unpin …" precedent

## Corrective Action

Added a right-click "Lock now" context menu to `#vault-indicator`, reusing the exact toolbar-mode page-context sheet the media/shields/devtools pin buttons already use for their "Unpin …" item (CLAUDE.md's Toolbar-pins pattern) — same sheet, same `page-context` menuType, same `chromePointToSheet`-anchored short-circuit, just a new `toolbarItem` value (`'vault'`) instead of an `UNPIN_LABELS` entry. Per operator ruling, the indicator itself is **not** made pinnable: no `toolbarPins` key, no Settings change, no relocation.

- `src/shared/page-context-model.js` — `pageContextModel`'s toolbar-mode short-circuit gets a `toolbarItem === 'vault'` branch: pushes a single `{ id: 'action:vault-lock', label: 'Lock now' }` item, **omitted** (not disabled) when `opts.vaultLocked` is true — nothing to lock, and a present-but-inert item would violate the house "no dead controls" convention. JSDoc types extended (`toolbarItem`, `opts.vaultLocked`).
- `src/renderer/chrome/vault-controller.js` — new `openToolbarContextMenu` dependency (optional, no-op default, matching the media/privacy-controller shape); a guarded `contextmenu` listener on `els.vaultIndicator` (`if (els.vaultIndicator)`, so the offline `els: { vaultIndicator: null }` harness in `vault-controller-capture.test.js` stays safe) calls `openToolbarContextMenu('vault', els.vaultIndicator)`; new `isVaultLocked()` (reads the stashed `lockState`, the DD10 freshness contract — never a re-fetch) and `lockNow()` (fire-and-forget `goldfinch.vaultLock()`, the SAME explicit vault-lock path the `goldfinch://vault` page's inline "Lock now" button drives via `bridge.lockVault()` → both bare `ipcMain.handle`s over the shared main-side `vaultLockNow()`); both exported from the controller's return object.
- `src/renderer/renderer.js` (four line-for-line edits, **net zero line-count change** — `RENDERER_LINE_BUDGET` was already at its ceiling, 1650/1650): (1) `vaultController` construction now passes `openToolbarContextMenu`, folded onto the existing `openVaultPage,` line; (2) `openPageContextOverlaySheet`'s single `pageContextModel(...)` call gains `vaultLocked: vaultController.isVaultLocked()` in its opts, folded onto its existing line; (3) the `page-context` dispatch switch gains `else if (id === 'action:vault-lock') vaultController.lockNow();`, folded onto the closing brace of the `action:unpin:` branch (no dispatch-body refocus override needed — unlike unpin, the vault indicator is never hidden by this action); (4) the chrome-focused keyboard-menu keydown handler's toolbar-pin double-fire exclusion gate gains `|| target === els.vaultIndicator`, folded onto its existing condition line. JSDoc for `pageCtx.toolbarItem` and `openToolbarContextMenu`'s `item` param extended to include `'vault'`.
- No new IPC/bridge method: `window.goldfinch.vaultLock()` (`src/preload/chrome-preload.js:401`, already declared in `renderer-globals.d.ts`) already invokes the existing `vault-lock` handle.

## Verification

- `timeout 180 npm test` → 3806/3806 pass, including 3 new `page-context-model.test.js` cases (`toolbarItem === 'vault'`: item present when unlocked, omitted when locked, defaults to present when `opts` is omitted) and 5 new `vault-controller-capture.test.js` cases (contextmenu wiring calls `openToolbarContextMenu('vault', anchorEl)` and suppresses the native menu; a null `vaultIndicator` element never throws wiring up; `isVaultLocked()` tracks the `onVaultLockState` broadcast, not a re-fetch; `lockNow()` calls `goldfinch.vaultLock()`; a rejected `vaultLock()` invoke never throws).
- `npm run lint` → clean.
- `npm run typecheck` → clean (required widening `openToolbarContextMenu`'s JSDoc param type to the same `'media'|'shields'|'devtools'|'vault'` union `renderer.js`'s real function uses, instead of a generic `string`).
- `wc -l src/renderer/renderer.js` → 1649 (before and after every edit — the `RENDERER_LINE_BUDGET` pin's 1650 split-count ceiling), confirmed via `test/unit/seam-contract.test.js`'s renderer.js line-budget test passing inside the full suite run above.

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the Developers' reasoning) — one review round, clean on the first pass; batch turnaround 2026-08-27 (batch 2)
**Verdict**: confirmed
**Commit**: `squawk: turnaround 2026-08-27 (batch 2)` on `squawk/turnaround-2026-08-27-2` (PR number recorded on the PR itself)

Batch gates at review: 3806/3806 tests, lint clean, typecheck clean.
