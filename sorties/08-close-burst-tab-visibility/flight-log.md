# Flight Log: Close-Burst Tab Visibility

**Flight**: [Close-Burst Tab Visibility](flight.md)

## Summary
Sortie planned 2026-11-08 from an operator report (can't see the tab being closed during a run of pointer closes). Charter agreed; operator rulings: real activation (no preview), close-burst only (same lifecycle as the DD5 width freeze), last hovered tab stays active when the mouse leaves the strip. Keyboard-close rightmost fallback split out as a squawk. Flight design in progress.

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

---

## Decisions

### Charter narrowed to close-only activation (planning, 2026-11-08)
**Context**: The agreed charter had hover-to-activate during a "close burst" bounded by the DD5 width freeze, ending on strip mouseleave. Flight design surfaced that (a) the #97 rightmost close never freezes, so a freeze-bound burst never starts from the right end, and (b) hover switching needs a dwell policy to avoid flashing every tab swept over.
**Decision**: Operator rulings — every pointer close participates (not only frozen ones); "it should really only show the adjacent tab", confirmed as NO hover switching at all. The feature is now: after each ✕/middle-click close, activate the tab under the cursor. No burst state, no timers, no leave/blur lifecycle. HAT leg included.
**Impact**: Charter criteria 2–3 rewritten (hover never switches; no-target → today's behavior); burst-lifecycle constraint removed. One implementation leg + HAT.

---

## Deviations

---

## Anomalies

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
