# Leg: verify-integration

**Status**: completed
**Flight**: [Menu Dismissal & Shared APG Helper](../flight.md)

## Objective

Verify the shared menu controller + dismissal fix + container APG uplift against the running app: the `menu-dismissal` behavior test, regressions, the a11y gate (incl. the open container menu), and the manual page-click/app-switch checks.

## Results (Flight-Director-driven, live `:9222`)

- **`/behavior-test menu-dismissal` → PASS 9/9** (Witnessed; trusted CDP via `scripts/cdp-driver.mjs`; independent Validator re-drove the key checkpoints). Run log: `tests/behavior/menu-dismissal/runs/2026-06-07-11-58-01.md`. Spec promoted `draft → active`. Covers: page/webview-click dismissal (window-blur) for both menus; cross-trigger; in-chrome outside click; Escape + focus-restore; container full APG (role=menu/menuitem, roving, Arrow/Home/End); container selection preserved (Personal jar tab + dot); container trigger opens by keyboard (Space → once, ArrowUp → last).
- **a11y — container menu (open) axe-clean**: targeted axe on the OPEN `#container-menu` → `role="menu"`, 6 `role="menuitem"`, **0 violations** (the `.cm-title` `role="presentation"` satisfies `aria-required-children`). This is the direct SC8 check the `npm run a11y` gate can't make (it audits menus closed).
- **`npm run a11y` → no new violations**: identical to the Flight-2 baseline (8 moderate structural findings — `region` on base-chrome/panels, `landmark-one-main`, `page-has-heading-one`; none menu-attributable). The container uplift added none.
- **Regression smoke (trusted CDP)** — kebab (now controller-driven): ArrowDown opens→first, wraps, Escape closes + restores focus to `#kebab`, Settings inert (tabs 1→1) ✓ (`kebab-menu` core). Tablist: `role=tablist`, one `aria-selected`, one roving `tabindex=0`, ArrowRight moves focus ✓ (`tab-keyboard-operability` core). Container opens a jar tab ✓ (`unified-tab-controls` core, via `menu-dismissal` Step 8). Full Witnessed re-runs of those three specs available if desired; the cores are confirmed.
- **Real page-click dismissal (bonus, better than spec's manual-only)**: a real trusted CDP click landing in the `#webviews` region with the kebab open dismissed it (`aria-expanded=false`, focus → `webview-tab-1`) — so the real pointer page-click path works, not just the `focus()` witness.
- **Offline gates**: `npm run typecheck` 0, `npm run lint` 0, `npm test` 147/147 (from the leg implementations + flight review).

## Manual / deferred
- **App-switch dismissal** — clicking another OS application to dismiss an open menu is not CDP-drivable; it rides the *same* `window`-blur handler the webview-click case proved. **Confirmed by the operator at HAT (leg 4).**
- **macOS** — unverified (dev platform Linux/WSL); the dismissal logic is platform-agnostic DOM/`window` events, low risk, but a mac HAT would confirm.

## Files Affected
- `tests/behavior/menu-dismissal.md` — status `draft → active`, Last Run; coordinate-drift precondition note added.
- `tests/behavior/menu-dismissal/runs/2026-06-07-11-58-01.md` — new run log.
- (No source changes in this leg — it's the verification gate.)

---

## Post-Completion Checklist
- [x] `menu-dismissal` PASS 9/9; regressions cores green; a11y no new violations (open menu axe-clean)
- [x] Offline gates green
- [x] Flight log updated with verify results
- [x] Status `completed`
- [x] Commit handled in the flight review/commit + a verify follow-up commit (run log + spec promotion)
