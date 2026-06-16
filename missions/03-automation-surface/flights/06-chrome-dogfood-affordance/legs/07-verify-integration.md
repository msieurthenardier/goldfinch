# Leg: verify-integration

**Status**: completed
**Flight**: [Chrome-driving affordance + behavior-spec dogfooding (scoped)](../flight.md)

> **RESULT (2026-06-16): PASS.** All three migrated specs run green on the admin MCP surface (FD-driven focused live pass, cited evidence); full unit+typecheck+lint green (630/630); `dev:debug`/`:9222` un-migrated regression clear.

## Objective
Confirm the migrated subset (`tab-keyboard-operability`, `kebab-menu`, `settings-shell`) passes live on the admin MCP surface (dogfooding proof), the full gate suite stays green, and the un-migrated Group-B specs' `dev:debug`/`:9222` apparatus is unbroken.

## Context
- **DD4** (flight): the live runs of the migrated subset are the SC11-part-1 (scoped) dogfooding proof. Operator elected a **FD-driven focused live pass** (leg-7 question) — drive each spec's core distinguishing checkpoints with cited machine-read evidence (the M02 standard), since the leg-2 spike already proved the chrome-drive primitives.
- Apparatus: an admin MCP client (Bearer the auto-minted admin key) over the clean `dev:automation` instance on `127.0.0.1:49707` (no `:9222`).

## Acceptance Criteria
- [x] **AC1 (migrated specs pass live)** — `tab-keyboard-operability`, `kebab-menu`, `settings-shell` each driven on the admin MCP surface (`getChromeTarget` + drive/observe tools, NOT `cdp-driver.mjs`/`:9222`); core checkpoints pass; run logs committed under `tests/behavior/{slug}/runs/2026-06-16-08-04-29.md`.
- [x] **AC2 (full gates green)** — `npm test` 630/630, `npm run typecheck` clean, `npm run lint` clean.
- [x] **AC3 (dev:debug regression clear)** — `package.json`'s `dev:debug` script is unchanged from `main` (no F6 edit to `--remote-allow-origins=*`); the un-migrated Group-B specs (`core-browsing-shields`, `menu-dismissal`, `farbling-correctness`, …) still reference `:9222` untouched, so their apparatus is intact (per the F6→F7 constraint, `:9222` retirement is Flight 7).

## Results (per spec — FD-driven focused live pass)
- **tab-keyboard-operability — PASS**: 3 distinct tabs opened; click-anchor → focused `tab`; `ArrowRight`/`Home`/`End` move focus + selection (one `aria-selected`, address changes); `Delete` closes the focused tab (4→3) with focus to a sibling; 1 `tablist` / 3 `tab` / 1 selected. Run log: `tests/behavior/tab-keyboard-operability/runs/2026-06-16-08-04-29.md`.
- **kebab-menu — PASS**: trusted click opens the menu with exactly **[Settings, Exit]** (`menu` role); `Escape` closes + restores focus to the "More" trigger. Run log: `tests/behavior/kebab-menu/runs/2026-06-16-08-04-29.md`.
- **settings-shell — PASS**: kebab→Settings opens `goldfinch://settings/` (admin-enumerable internal guest, wcId 6); guest shell = "Settings — Goldfinch", 6 sections / 6 h2 / 962 AX nodes / 6 nav links; chrome chip shows the internal identity. Run log: `tests/behavior/settings-shell/runs/2026-06-16-08-04-29.md`.

## Notes / deferred-to-HAT
Focused pass per operator election. Not every checkpoint of each spec was driven (e.g. tab-keyboard Steps 6/8, kebab keyboard-open + focus-ring delta, settings-shell nav-lock + chip-popup) — these are good leg-8 HAT candidates (operator-driven); the primitives they rely on are spike-proven and the core of each spec passed. One coordinate-tuning artifact recorded: the Settings menu-item needed x=1300 (x=1265 missed) — normal for blind coordinate clicks, covered by the migrated specs' `captureWindow`-locate rule.

## Files Affected
- `tests/behavior/tab-keyboard-operability/runs/2026-06-16-08-04-29.md` (new run log)
- `tests/behavior/kebab-menu/runs/2026-06-16-08-04-29.md` (new run log)
- `tests/behavior/settings-shell/runs/2026-06-16-08-04-29.md` (new run log)

---

## Post-Completion Checklist
- [x] Migrated subset driven live on the admin surface — all PASS
- [x] Run logs committed
- [x] Full gates green (630/630 + typecheck + lint)
- [x] dev:debug/:9222 regression clear
- [ ] Update flight-log.md (FD)
- [ ] Set leg status `landed` ✅ (done)
- [ ] Check off in flight.md (at flight commit)
