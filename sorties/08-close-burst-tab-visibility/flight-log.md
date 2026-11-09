# Flight Log: Close-Burst Tab Visibility

**Flight**: [Close-Burst Tab Visibility](flight.md)

## Summary
Sortie planned 2026-11-08 from an operator report (can't see the tab being closed during a run of pointer closes). Charter agreed; operator rulings: real activation (no preview), close-burst only (same lifecycle as the DD5 width freeze), last hovered tab stays active when the mouse leaves the strip. Keyboard-close rightmost fallback split out as a squawk. Flight design complete; executed 2026-11-08. Leg 01 (pointer-close activation) + HAT leg 02, which surfaced and fixed two squeezed-strip defects (DD9: the sliding-in tab takes the closed tab's width; the tab ✕ is right-aligned at every width). Operator signed off. Squawks logged: 0177 (keyboard close → rightmost), 0178 (second Ctrl+W can close the window). Behavior spec `pointer-close-shows-tab` deferred to the debrief (apparatus limit).

---

## Leg Progress

### Leg 01 pointer-close-activation — landed (2026-11-08)
**Changes Made**
- `src/renderer/chrome/tab-controller.js`: ✕ `click` passes `{ pointer }` only when `e.detail > 0`; `auxclick` (button 1) always passes it; freeze lines unchanged and still precede `closeTab`. New `tabIdAtPoint(x, y)` helper (guards missing `elementFromPoint`, requires `tabs.has`). `closeTab(id, opts)`: after `tab.btn.remove()` + `tabs.delete(id)`, `wasActive`/`target` resolved; target -> single `activateTab(target)` (skipped when background close and target already active) and early return; otherwise the existing fallback block is unchanged (`orderedTabIds().pop()` untouched; squawk 0177 owns it).
- `test/unit/tab-controller.test.js`: 11 new tests driving the real `click`/`auxclick` listeners (AC4 cases 1-11, plus a null / non-tab / stale-id loop in case 5). No `fake-dom.js` change (hand-built targets). Suite: 50 tests in this file pass.
- `tests/behavior/tab-reorder.md` Step 9 re-authored (two actions, NON-last background tabs, selected tab == tab under the click point) + banner note; `tab-keyboard-operability.md` cross-reference updated; `CLAUDE.md` Tab strip bullet added. `pointer-close-shows-tab.md` left `draft`.
- Not touched: `renderer.js` (1504 lines), `src/main/**`, `src/preload/**`, shortcut/window/jars controllers.

**Gates**: `npm test` 6340 pass / 0 fail / 4 todo; `npm run typecheck`, `npm run lint`, `npm run format:check` clean.

**Grep-AC (AC5)**: `grep -nE "mouseenter|mouseover|pointerover|pointerenter|mousemove" src/renderer/chrome/tab-controller.js src/renderer/renderer.js` -> no hits. Over `src/renderer/chrome/`: only `media-controller.js:342` (window `mousemove`, toast/idle logic) and `:608,643,666` (toast hover-pause `mouseenter`) - exempt, unrelated to tab activation.
**AC6**: `git diff --stat` touches only tab-controller.js, its test, CLAUDE.md and the two specs; `grep -rn "closeTab(" src/renderer`: every other caller passes one argument.

**Live smoke (AC10)**, dev mode, `DEV_MINT`+`ADMIN`, env-key script via `connectAutomation()`; the dev profile restored ~12 pre-existing tabs, 6 fixture tabs added (18 total). Primitives used: `enumerateWindows`, `getChromeTarget`, `enumerateTabs`, `openTab`, chrome `evaluate` (rects, `.tab.active`, `#address`), `click` (left, middle), `pressKey`, `readAxTree`, `captureWindow`, `captureScreenshot`.
- **Premise check PASSED**: first background ✕ close mid-strip (tab-2 closed, tab-18 had been active) -> tab-3, the slid-in neighbour whose post-removal rect contains the point, became active; `enumerateTabs` active, `.tab.active` id and `#address` agreed.
- Same point clicked again (active close) -> tab-4 (next under the point) active.
- Middle-click on a background non-last tab body -> tab under the point (tab-5) active.
- Rightmost ✕ (#97, no freeze): the point resolved to the new last tab (tab-17), which became active.
- Ctrl+W on the active tab-17 -> tab-16 (DOM-order-last fallback, unchanged).
- `readAxTree(chrome)` returned; the crude regex count (15) matched tab-bearing nodes, not a precise selected count - the `enumerateTabs` single-active and `.tab.active` checks are the authoritative one-active evidence.
- `captureWindow`/`captureScreenshot`: right after the pointer closes they returned `capture-timeout` because the newly active tab was a heavy restored page (news.google). Re-run on the settled fixture tab: both returned images. A control (plain click activation, no close) onto a heavy page (theguardian) also timed out / `UnknownVizError` on `captureScreenshot` while `captureWindow` worked - environmental to heavy restored pages, not caused by this change.
- App and fixture server stopped.

### hat-and-alignment
**Status**: completed
**Started**: 2026-11-08
**Completed**: 2026-11-08

#### Notes
Operator HAT in progress (steps H1–H7, leg 02 artifact).
- H1 (mid-strip ✕ run): first pass on blank `/paaa` dev-profile tabs "seems to be working" but hard to judge; FD served 10 distinct-color fixture pages (scratchpad, 127.0.0.1:8766) and opened them via the admin MCP `openTab`. Re-run on fixtures: **pass**.
- H2 (middle-click run): first attempt was a wording mix-up (operator clicked the middle OF the tab = plain click/activate, nothing closed). FD verified the auxclick path with an MCP middle-click (`mousedown/mouseup/auxclick` b1 d1 → Brown closed, Yellow active) and left a temporary capture-phase event logger on `#tabs` (`window.__hatEv`, chrome-session only, gone on reload). Operator re-ran with the middle mouse button: **pass**.
- H3 (hover never switches): **pass**.
- H4 (right-end ✕ run, #97 no-freeze reflow): **pass**. Lesson: say "middle mouse button (wheel click)" in HAT steps.
- H5 fix (DD9, 2026-11-08): `freezeTabWidths(closingId)` pins the closed tab's right neighbour at the CLOSED tab's rendered width; both pointer sites pass `id`, other callers unchanged, #97 carve-out intact. Files: `src/renderer/chrome/tab-controller.js`, `test/unit/tab-controller.test.js` (3 new DD9 tests; leg 01 freeze-before-resolve test unchanged and green), `tests/behavior/responsive-tab-strip.md` (Step 6 note), `tests/behavior/pointer-close-shows-tab.md` (new Step 4b), `CLAUDE.md` (Tab strip bullet). Gates: see FD handoff (format/test/typecheck/lint/format:check all run by developer). Live re-verify pending (FD).
- H5 second finding (HAT, measured live): in the 57-77px band the title is hidden so `.tab-close` packed left and its offset varied with content (inactive 71px no-favicon tab: 26-42px; active 78px floor tab with favicon: 52-68px), leaving the sliding-in tab's ✕ ~25px from the cursor. Fix: `margin-left: auto` on `.tab .tab-close` (`src/renderer/styles.css`) so the ✕ is at the right end at every width. Files: `src/renderer/styles.css`, `test/unit/tab-close-css-pin.test.js` (new source-scan pin), `tests/behavior/pointer-close-shows-tab.md` (Step 4b sentence). Gates: format, test, typecheck, lint, format:check all green.

---

## Decisions

### Charter narrowed to close-only activation (planning, 2026-11-08)
**Context**: The agreed charter had hover-to-activate during a "close burst" bounded by the DD5 width freeze, ending on strip mouseleave. Flight design surfaced that (a) the #97 rightmost close never freezes, so a freeze-bound burst never starts from the right end, and (b) hover switching needs a dwell policy to avoid flashing every tab swept over.
**Decision**: Operator rulings — every pointer close participates (not only frozen ones); "it should really only show the adjacent tab", confirmed as NO hover switching at all. The feature is now: after each ✕/middle-click close, activate the tab under the cursor. No burst state, no timers, no leave/blur lifecycle. HAT leg included.
**Impact**: Charter criteria 2–3 rewritten (hover never switches; no-target → today's behavior); burst-lifecycle constraint removed. One implementation leg + HAT.

### HAT H5 finding → DD9: sliding-in tab takes the vacated width (2026-11-08)
**Context**: H5 (squeezed 24-tab strip) — operator: "awkward … the cursor not being over the x … there is no way to fast close tabs (except middle click)". MCP repro: active Yellow (78px floor) closed at x=418; frozen neighbour Green was 55px (ended at x≈413), so the point resolved to Teal (the tab after), which activated, grew to 78px, ✕ at 469–485; three further clicks hit Teal's body (activate only).
**Decision**: Operator approved amending the "freeze unchanged" constraint: on a pointer close, the right neighbour is frozen at the closed tab's rendered width (DD9). Classified a FIX (restores the "adjacent tab" ruling and the ✕-stays-under-cursor run), single surface (`tab-controller.js`). Narrow background tabs having no ✕ noted by the operator as minor; existing M09 F1 design, out of scope.
**Impact**: Fix developer spawn + flight-end re-review; H5 re-run after the fix.

---

## Deviations

---

## Anomalies

### Automation-only: a view swap releases the DD5 freeze at the REAL pointer position (apparatus fact)
**Observed**: Live DD9 re-verify (app restarted with the fix): the adjacent tab (Teal) was correctly activated, but the freeze was gone right after the close. A capture-phase logger on `#tabstrip` showed `click@354,23` then ~16 ms later `pointerleave`/`mouseleave` at `862,682` — a point in the guest area, where the operator's REAL OS pointer was resting. MCP `click` (`sendInputEvent`) never moves the real pointer; when `tab-set-active` swaps the guest view, the compositor (WSLg/Wayland) re-delivers leave/enter at the real pointer position, and `#tabstrip` `mouseleave` releases the freeze. The pre-fix repro held the freeze (pointer presumably parked over the strip then).
**Severity**: degraded (apparatus only — a human's real pointer is over the strip during a close run, so no leave is generated; to be confirmed by the operator's H5 re-run)
**Resolution**: Freeze-dependent automation must park the REAL pointer over `#tabstrip` (operator) or treat a post-close release as apparatus noise. Pre-existing for active-tab pointer closes (any `tab-set-active`); sortie 08 makes every pointer close switch tabs, so it shows on every close under automation. Carry to the debrief; amend `pointer-close-shows-tab.md` preconditions at HAT close-out.

- Leg 01 smoke: `captureScreenshot` of a heavy restored page (news.google / theguardian) in the dev profile times out or returns `UnknownVizError` even on plain-click activation (no close involved). Environmental/pre-existing; not investigated. Flagged for the Flight Director.
- Dev-profile restored ~12 tabs from earlier sessions, so smoke tab ids were tab-1.. tab-18 rather than a clean 5-6 tab strip; harmless for the checks.

---

## Session Notes

### Flight Director Notes
- 2026-11-08: `/mission-control:agentic-workflow sortie 08` started. Loaded `.flightops/agent-crews/leg-execution.md` (Developer: Sonnet; Reviewer: Sonnet; a11y reviewer disabled). Branch `sortie/08-close-burst-tab-visibility` from `main` @ `4ae46a8`. Sortie status → `in-flight`. 2 legs (1 autonomous + HAT).
- Leg 01 `pointer-close-activation` designed. **Risk tier: HIGH** — it changes the shared `closeTab` function (many callers) and deliberately reverses a behavior pinned by an external reader (`tab-reorder.md` Step 9). Running the Developer design review.

### 2026-11-08 — Design review (Architect, cycle 1): approve with changes
No high-severity issues. Traces confirmed: MCP `click` sets `clickCount: 1` (so `e.detail === 1`, the DD3 guard passes under automation); main's `tab-close` for the active wcId only hides find/closes the sheet, never activates; one `tabSetActive` per close under DD4. Incorporated: unit tests must drive the real click/auxclick listeners with hand-built events (harness `elementFromPoint` + `closest`); "under the cursor" not "right neighbour" (4px gap / unequal widths); explicit same-id check (`activateTab` has no early-out); 64px active-floor shift at pathological counts accepted as a trade-off and added to HAT; squawk 0177 sequencing rule; DD8 re-author details incl. `tab-keyboard-operability.md:58`; grep-AC pattern pinned; spec Step 5 was vacuous (target already active) — rewritten, plus Step 5b for the already-active branch. Changes were clarifications and spec/test-contract fixes, no design change — second review cycle skipped.
- Leg 01 design review (Developer, cycle 1): approve with changes, all clarifications — applied; no second cycle (no substantive design change). Leg 01 → `ready`. Spawning implementation Developer.
- Leg 01 landed ([LAND:leg]). Flight-end Reviewer (Sonnet): [HANDOFF:confirmed], no blocking issues; gates re-run green (npm test 6340 pass / 0 fail / 4 todo; typecheck, lint, format:check clean). Non-blocking nits accepted as-is: (1) the "no resolvable target" unit test builds a harness per variant (fine); (2) Leg Progress placeholder for the HAT leg — added when leg 02 is designed. Leg 01 → `completed`. Committing leg 01 + squawk 0177 log; HAT leg 02 follows with the operator.
- Smoke anomaly triage (FD): `captureWindow`/`captureScreenshot` timeouts on heavy restored dev-profile pages reproduce on plain-click activation → environmental, not this change; the HAT walk re-checks rendered truth by eye on fixture tabs.
- Leg 01 committed (`6dec29e`, squawk 0177 log `4f36ced`); draft PR #285 opened. Leg 02 HAT designed (interactive — no Developer/Reviewer cycle); app launched in dev mode (`dev:automation` + DEV_MINT + ADMIN) for the operator.
- DD9 fix (Developer) reviewed: Reviewer [HANDOFF:confirmed], gates green (npm test 6347 / 0 fail; typecheck, lint, format:check clean). App restarted on the fix (SIGTERM → relaunch dev:automation, session restored, topped up to 24 fixture tabs). MCP repro: adjacent tab now resolved (Teal, not the next-next tab) — DD9 confirmed; freeze-release artifact recorded under Anomalies. H5 handed back to the operator for the by-hand re-run.
- H5 second finding (✕ offset varies in the 57–77px band): fix-vs-feature call = look-and-feel FIX, single surface (chrome CSS) — inline. `.tab .tab-close { margin-left: auto }` + source-scan pin `test/unit/tab-close-css-pin.test.js`. Reviewer [HANDOFF:confirmed] (npm test 6348 / 6344 pass / 0 fail / 4 todo; typecheck, lint, format:check clean). App restarted on the fix (note: `pkill -f scripts/dev-launch.mjs` also matches the invoking shell's own command line — kill the electron main pid directly). Live: inactive 71px ✕ at offset 45–61, active 78px at 52–68 — right-aligned everywhere; residual 7px floor shift with 9px overlap. H5 re-run handed to the operator.
- H5 re-run (27 tabs, background ~37px, active 78px floor) after DD9 + right-aligned ✕: operator **"sufficient, the very next tab after closing one resizes as it becomes active, but after that it works."** → **pass**, with the accepted floor trade-off (the first tab to become active grows to the 78px floor; subsequent closes in the run line up).
- H6 (Ctrl+W unchanged): operator — "ctrl + w the second time closed the app" (clean exit 0, no crash). Not on this sortie's path (keyboard close + main tab-close/tab-set-active untouched); likely pre-existing: no app menu is set, so Electron's default Window › Close (`CmdOrCtrl+W`) catches a Ctrl+W no webContents handles; hypothesis = page-focused close leaves focus on no view (`wasPageFocused` reads the nulled `activeTabWcId`). Logged as **squawk 0178** (open, routine, needs repro) per the out-of-scope rule. App relaunched to confirm H6's single-Ctrl+W behavior.
- H6 re-run (strip-focused, single Ctrl+W): tab closed, DOM-order-last tab active — **pass** (unchanged behavior; squawk 0177 owns the neighbour fix).
- H7: operator sign-off — **pass**. Behavior-spec run deferred to the debrief (operator ruling): `pointer-close-shows-tab` stays `draft` with a real-pointer-parked precondition added. Leg 02 → `completed`; sortie → `landed`. [COMPLETE:flight] after commit + PR ready.
