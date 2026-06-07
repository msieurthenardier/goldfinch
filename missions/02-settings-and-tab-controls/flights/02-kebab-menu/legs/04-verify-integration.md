# Leg: verify-integration

**Status**: ready
**Flight**: [Kebab Menu](../flight.md)

## Objective

Verify the kebab menu against the running app: extend the behavior-test apparatus with the keys this flight needs, run the `kebab-menu` behavior test plus the tab regressions and the a11y gate, and manually confirm Exit quits — closing out SC3, SC4, and SC8.

## Context

- **Flight DD6** — the `kebab-menu` behavior test is Witnessed (Executor + independent Validator) over trusted CDP on the live `:9222` renderer, via the committed `scripts/cdp-driver.mjs` (attach-don't-launch) or a connected Playwright MCP. **The `chrome-devtools` MCP does NOT qualify** (launches its own browser → false pass).
- **Apparatus gap (Architect + DD6)** — `cdp-driver.mjs` KEYS (`cdp-driver.mjs:40-51`) ships only horizontal `ArrowRight`/`ArrowLeft`; the kebab's vertical APG nav needs `ArrowDown`/`ArrowUp`. This leg adds them (the one autonomous code change here).
- **Manual splits** — **Exit** quitting tears down the harness → manual (win/linux; macOS deferred to a mac HAT). The a11y baseline carries **2 known pre-existing `scrollable-region-focusable`** violations (mission Known Issues) — assert "no *new* violations from the kebab," not zero.
- This is a verification leg: its acceptance is largely "tests pass," not new product code.

## Inputs

- Legs 1–3 implemented (uncommitted, or committed at flight review — see Flight Director Notes): the kebab menu, Exit wiring, and docs.
- `scripts/cdp-driver.mjs` — the committed CDP driver with KEYS at `cdp-driver.mjs:40-51` (no vertical arrows yet).
- `tests/behavior/kebab-menu.md` — the behavior-test spec (status `draft`).
- A running app on `:9222` (`npm run dev:debug`) with a renderer target — **operator-provided** (GUI/desktop runtime; dev platform Linux/WSL).
- `npm run a11y` (axe over CDP) operational; the offline gates (`npm test`/`typecheck`/`lint`).

## Outputs

- `cdp-driver.mjs` KEYS includes `ArrowDown` (vk 40) and `ArrowUp` (vk 38).
- A committed run log at `tests/behavior/kebab-menu/runs/{ts}.md` with the `kebab-menu` verdict.
- The `kebab-menu` spec promoted `draft → active` on pass.
- Confirmation that `tab-keyboard-operability` and `unified-tab-controls` still pass, `npm run a11y` shows no new violations, and Exit quits (manual).

## Acceptance Criteria
- [ ] `scripts/cdp-driver.mjs` KEYS contains `ArrowDown` and `ArrowUp` descriptors (matching the existing entry shape — `key`/`code`/`windowsVirtualKeyCode`/`nativeVirtualKeyCode`; vk 40 and 38). `node scripts/cdp-driver.mjs key ArrowDown` no longer errors.
- [ ] **`/behavior-test kebab-menu` passes** against the running app (Witnessed; trusted CDP on `:9222`; NOT chrome-devtools MCP). Run log committed under `tests/behavior/kebab-menu/runs/`.
- [ ] **Regression: `/behavior-test tab-keyboard-operability` still passes** (the kebab is outside the tablist; roving-tabindex contract intact).
- [ ] **Regression: `/behavior-test unified-tab-controls` still passes** (the container menu is untouched).
- [ ] **`npm run a11y`** shows **no new** WCAG A/AA violations attributable to the kebab button or its menu (the 2 known pre-existing `scrollable-region-focusable` findings are the accepted baseline, not a regression).
- [ ] **Manual**: with the app running, kebab → **Exit** terminates the app (win/linux). macOS deferred to a mac HAT (flight/mission deferral).
- [ ] Offline gates green: `npm test` (147/147), `npm run typecheck` (0), `npm run lint` (0).
- [ ] On pass, the `kebab-menu` spec status is promoted `draft → active`.

## Verification Steps
- `node scripts/cdp-driver.mjs key ArrowDown` and `… key ArrowUp` — both succeed (no "unknown key" error).
- Operator starts the app: `npm run dev:debug`; confirm `curl http://127.0.0.1:9222/json` lists a renderer target.
- `/behavior-test kebab-menu` — Flight Director drives the run skill (spawns Executor + Validator); confirm pass and the committed run log.
- `/behavior-test tab-keyboard-operability` and `/behavior-test unified-tab-controls` — confirm still pass.
- `npm run a11y` — review the violation list; confirm only the 2 known pre-existing entries, none from the kebab.
- Manually open the kebab and choose Exit — the app quits.
- `npm test && npm run typecheck && npm run lint` — all green.

## Implementation Guidance

1. **Extend the apparatus** (`scripts/cdp-driver.mjs`, in KEYS at `cdp-driver.mjs:40-51`) — add, matching the existing descriptor shape:
   ```js
   ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40, nativeVirtualKeyCode: 40 },
   ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', windowsVirtualKeyCode: 38, nativeVirtualKeyCode: 38 },
   ```
   - This is the only code change in this leg; it carries near-zero risk (a data-table addition) and makes the kebab's APG nav drivable.

2. **Probe the environment** (operator-assisted): start `npm run dev:debug`; confirm `:9222` answers and a renderer target (the `index.html` window) exists.

3. **Run the behavior test**: the Flight Director invokes `/behavior-test kebab-menu` (the run skill orchestrates its own Executor + Validator crew — do NOT spawn a Developer for this). On pass, the run log lands at `tests/behavior/kebab-menu/runs/{ts}.md` (committed) with evidence at the gitignored ephemeral path.

4. **Run regressions + a11y**: `/behavior-test tab-keyboard-operability`, `/behavior-test unified-tab-controls`, and `npm run a11y`.

5. **Manual Exit check**: open the kebab, choose Exit, confirm the app terminates (win/linux). Note macOS deferral.

6. **Promote the spec**: on pass, set `tests/behavior/kebab-menu.md` status `draft → active` and update its Last Run.

## Edge Cases
- **`:9222` dead / only guest targets** — halt; preconditions not met (the behavior-test spec's Step 1 probe guards this).
- **Playwright MCP "registered but not connected"** (Flight-1 trap) — fall back to `scripts/cdp-driver.mjs`; do NOT use chrome-devtools MCP.
- **Fixture port collisions** — the kebab test needs no HTTP fixture (it drives chrome only), so the `:8000`/`:8080` collision risk from prior flights does not apply here.
- **a11y "new vs known"** — compare against the 2 documented pre-existing findings; if a *third* appears on a kebab surface, that's a regression to fix.

## Files Affected
- `scripts/cdp-driver.mjs` — add `ArrowDown`/`ArrowUp` to KEYS.
- `tests/behavior/kebab-menu.md` — status `draft → active` + Last Run (on pass).
- `tests/behavior/kebab-menu/runs/{ts}.md` — new run log (created by the run skill).

---

## Post-Completion Checklist

- [ ] All acceptance criteria verified (behavior test + regressions + a11y + manual Exit + offline gates)
- [ ] Update flight-log.md with the verification results (verdicts, a11y summary, manual Exit outcome)
- [ ] Set this leg's status to `landed`
- [ ] Commit handling per the flight's deferred-commit model (see Flight Director Notes) — the apparatus-prep code is part of the flight review/commit; the run log is committed when produced

---

## Citation Audit

Citations verified against current code at leg-design time: `cdp-driver.mjs:40-51` (KEYS table — only
horizontal arrows present, confirming the gap). Behavior-test slugs (`kebab-menu`,
`tab-keyboard-operability`, `unified-tab-controls`) confirmed present under `tests/behavior/`.
