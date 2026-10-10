# Flight Log: Hard Reload

**Flight**: [Hard Reload](flight.md)

## Summary
Planned, executed and debriefed 2026-10-10. One leg (`hard-reload`), reviewed and committed (`c7d8840`, PR #251). Behavior test `hard-reload` passed 14/14, including 11 physical operator trials. Sortie `completed`.

---

## Leg Progress

### hard-reload
**Status**: landed (Developer, 2026-10-10). Not committed.

**Changes made**
- Classifier pair (lockstep): `keydown-action.js` and `sheet-accelerator.js` gain the F5 branch (`!alt`; unmodified -> `reload`, Shift/Ctrl/Meta -> `hard-reload`) and Shift+R/r -> `hard-reload`; JSDoc unions and header/comment text updated (F5 named beside F12 as modifier-less).
- `guest-forward-allowlist.js`: `'hard-reload'` in `WEB_CHROME_ACTIONS` only; `INTERNAL_CHROME_ACTIONS` and `isRepeatSafeAction` untouched; header enumeration updated.
- `shortcut-controller.js`: `case 'hard-reload'` shares the `reload` body, verb `reloadIgnoringCache`; stale chain comment updated. `navigation-controller.js`: `#reload` click takes `e`, Shift selects `reloadIgnoringCache` in the non-stop branch.
- `register-tab-ipc.js`: `reloadIgnoringCache` verb (mirrors `reload`, incl. empty-history `loadURL(effectiveUrl(entry))` fallback, reads no `args`).
- Automation: `nav.reload(wcId, deps, opts)` (strict `ignoreCache === true`), `engine.js` threads `opts`, `mcp-tools.js` schema/`call`/description + `PRESS_KEY_NAMES` gains `F5, F6` (F6 drift fix), `input.js` `KEY_MAP.F5`. `scope.js` already forwards `...rest`; no change needed.
- Docs: README shortcuts table; `docs/mcp-automation.md` `reload` row + `pressKey` names. CLAUDE.md unchanged (as expected).
- New fixture `tests/behavior/fixtures/hard-reload/server.mjs` (node:http only, 127.0.0.1:8766). `tests/behavior/hard-reload.md` left untouched (fixture matches spec).
- Tests: updated/added in all 11 named files plus `window-factory.test.js` and the harness (see below). The `sheet-accelerator` negative loop dropped `'R'`; `reload` left the shared `[42]` loop in `automation-mcp-tools.test.js`.

**Optional real-sheet window-factory test: FEASIBLE and added.** `test/unit/helpers/window-factory-harness.js` now takes `options.sheetAcceleratorAction` (default still `() => null`); `window-factory.test.js` emits `before-input-event` Ctrl+Shift+R on the created sheet view and asserts exactly one `chrome-shortcut-action { action: 'hard-reload' }` to the owning chrome.

**Gates**: `npm test` 5885 tests, 5881 pass, 0 fail, 4 todo (pre-existing); `npm run typecheck`, `npm run lint`, `npm run format:check` clean; `git diff --stat main -- src/renderer/renderer.js` empty.

**Live smoke (AC10)** — dev instance launched with ADMIN + DEV_MINT, attached via `scripts/lib/mcp-client.mjs`, fixture on :8766, then both stopped. Chrome C=wcId 1, `chromePid` 3047885. G=8. Baseline `__loadId` 1, `asset` 1. (loadId / asset before -> after):
- Ctrl+R (page, `r`): 1->2, 1->1 flat
- Ctrl+Shift+R (page, `R`): 2->3, 1->2 (+1), `last.cacheControl` = `no-cache` (pragma `no-cache`)
- Shift+F5 (page): 3->4, 2->3 (+1)
- Ctrl+F5 (page): 4->5, 3->4 (+1)
- F5 (page): 5->6, 4->4 flat
- Ctrl+Shift+`r` lowercase (page, extra): 6->7, 4->5 (+1)
- Ctrl+Shift+R, address bar focused, `pressKey(C)`: 7->8, 5->6 (+1)
- Ctrl+R chrome focus: 8->9, flat; F5 chrome focus (extra): 9->10, flat
- Shift+click `#reload` (dispatched MouseEvent shiftKey): 10->11, 6->7 (+1)
- plain `#reload` click: 11->12, flat
- MCP `reload({wcId})`: 12->13, flat; `reload({wcId, ignoreCache:true})`: 13->14, 7->8 (+1)
- `asset.js` `transferSize` after the final hard reload: 349 (non-zero, as expected after a network fetch). The cache-hit `transferSize === 0` corroborator was not sampled right after a plain reload.
- `captureWindow` (image block returned), `captureScreenshot(G)` (image block returned), `readDom(G)` (html shows `__loadId = 14`, title "hard-reload fixture") all worked; `enumerateTabs`, `enumerateWindows`, `getChromeTarget` all worked. Pixels were not inspected by eye (blocks returned, non-trivial size).
- End: `evaluate(C, "window.__hrMarker") === 1` and `chromePid` unchanged (3047885). **Synthetic path: chrome did not reload.** This is NOT "DD7 verified"; the real-keypress `[by-eye]` step stays with the Flight Director.
- Key case: the MCP `pressKey` passes through the name as given; `'R'` and lowercase `'r'` with `shift` both classified `hard-reload` (both tested, both +1). Which case a physical keypress delivers was not observable here.
- Wait-for-load guard (`readyState === 'complete'` and numeric `__loadId`) before each action; no step hit the stop state.

**Deviations**: none from the leg. Added small extras beyond the AC list: harness option above, F5-chrome-focus and lowercase `r` smoke steps, and `scope.js` needed no edit.

**Anomalies**: none found outside charter. Note: killing the dev instance required `kill` on the dev-launch and electron PIDs (a `pkill -f` pattern also terminated the calling shell once).

---

## Decisions

---

## Deviations

---

## Anomalies

---

## Session Notes

### 2026-10-10 — Planning
- Reported as "shift-refresh doesn't clear the cache". Checked as a squawk first; it failed criterion 3 (shared interfaces: the `tab-navigate` verb set, the `keydownToAction`/`sheet-accelerator` pair, the guest-forward allowlist) and the new-behavior rule, so it was planned as a sortie.
- Classifier probe: `keydownToAction` returns `reload` for Ctrl+`r`, `null` for Ctrl+Shift+`R`, `reload` for Ctrl+Shift+`r`, and `null` for F5 and Shift+F5.
- Electron default-menu probe (headless, `Menu.getApplicationMenu()`): the default menu is installed, with *Reload* `CmdOrCtrl+R` and *Force Reload* `Shift+CmdOrCtrl+R`. Recorded as the DD7 premise to verify live.
- Operator choices: Chrome trigger set (incl. Ctrl+F5) plus plain F5 → reload; MCP `reload` gets optional `ignoreCache`; no HAT leg.
- Architect design review (cycle 1): **approve with changes**. Trace (a)–(g) completed with no foreclosing layer. Incorporated: retarget `sheet-accelerator.test.js`'s Ctrl+Shift+`R` → `null` negative loop; pull `reload` out of `automation-mcp-tools.test.js`'s shared `[42]` call-shape loop (and pass `{ ignoreCache: true }` only when true); fixture nonce on `asset.js` so a persisted HTTP cache can't break a later run; wait-for-load guard in the spec (✕ state race); DD7 note that the default-menu roles likely no-op on `BaseWindow` and that DOM `preventDefault` isn't confirmed to suppress a native accelerator; DD3 notes on held keys, load-failure/crash panels and F5 in the sheet; JSDoc unions; README shortcuts table and allowlist header in the docs list; Alt+F5 negative and args-ignored tests. No second review cycle: the changes are test-inventory and fixture fixes, not design changes.

### Flight Director Notes
- 2026-10-10: Execution started via `/mission-control:agentic-workflow sortie 03`. Phase file `.flightops/agent-crews/leg-execution.md` loaded (valid: Crew / Interaction Protocol / Prompts). Sortie marked `in-flight`; branch `sortie/03-hard-reload` cut from `main` @ `2d9a1e6`. One autonomous leg (`01-hard-reload`), no HAT.
- Leg 01 risk tier: **HIGH**. It changes a shared interface with existing consumers (the `tab-navigate` verb set; the `keydownToAction`/`sheetAcceleratorAction` pair consumed by the chrome, guest and sheet paths) and a security-sensitive surface (the guest-forward allowlist). A Developer design review runs before implementation.
- Leg 01 design review (Developer, cycle 1): approve with changes; all medium items and the low items incorporated (see the leg's Citation Audit trailer). FD rulings on its questions:
  - DD7 real-keypress check → one `[by-eye]` operator step (spec step 15), not a HAT leg;
  - main-side internal refusal → stay at parity with `reload`;
  - F6 → added to `PRESS_KEY_NAMES` as a drift fix.
- Leg 01 marked `ready`.
- Leg 01 landed (Developer). FD ran `/mission-control:behavior-test hard-reload` in live mode: **pass, 14/14 checkpoints**.
  - Run log: `tests/behavior/hard-reload/runs/2026-10-10-20-29-57.md`.
  - At the operator's request, the `[by-eye]` step 15 ran as 11 controlled physical trials covering every DD2 trigger. All matched.
  - The address-bar Ctrl+Shift+R (trial 8) hard-reloaded once with the chrome marker and pid unchanged, so the **DD7 premise is verified on real input**: the default-menu Force Reload does not double-fire.
  - The spec was promoted to `active` and its row-15 table break fixed.
- Flight review (Reviewer, cycle 1): **[HANDOFF:confirmed]**, no blocking issues. The Reviewer re-ran the gates: `npm test` 5885 tests (5881 pass, 0 fail, 4 todo); typecheck, lint and format:check clean; `renderer.js` untouched. Two non-blocking nits, both already documented: no post-plain-reload `transferSize` sample in the smoke test (covered by the formal run), and held Ctrl+Shift+R repeating under chrome focus (DD3 parity).
- Leg 01 marked `completed`; commit next.
- 2026-10-10 debrief (`/mission-control:flight-debrief sortie 03`): Developer and Architect interviews done; human interview skipped (the operator was present for the whole run, and the log is complete). Debrief at `flight-debrief.md`. Squawks **0142** (`PRESS_KEY_NAMES`/`KEY_MAP` drift) and **0143** (shared reload fallback helper) logged and deferred. Sortie marked `completed` at the operator's confirmation. No maintenance nudge: missions 20–22 completed after the last maintenance report (2026-08-27).
