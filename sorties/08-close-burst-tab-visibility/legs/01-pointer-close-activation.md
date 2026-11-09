# Leg: pointer-close-activation

**Status**: completed
**Flight**: [Close-Burst Tab Visibility](../flight.md)

## Objective
Make every pointer close (✕ click, middle-click) of a tab end with the tab under the cursor active — exactly one tab switch per close, no hover switching, no change to any other close path — with unit coverage of the real listeners, a re-authored `tab-reorder.md` Step 9, and a CLAUDE.md note.

## Context
- Flight DD1 (close-only, no hover listeners/timers/state), DD2 (every pointer close incl. the #97 rightmost close; width freeze unchanged), DD3 (resolve after DOM removal via `document.elementFromPoint` → `closest('.tab')` → `dataset.id`, accepted only if `tabs.has`), DD4 (one activation; skip the `pop()` fallback when a target resolves; explicit same-id no-op because `activateTab` has no early-out), DD5 (IPC order `tabClose` → `tabSetActive`, same as today's active close; no main change), DD6 (only the two pointer sites pass a pointer), DD7 (verification + apparatus), DD8 (spec re-author).
- `src/renderer/renderer.js` is at its line budget (1504 of 1505) and is NOT touched. No new file; evaluate seam (41) unchanged.
- Squawk 0177 (keyboard-close neighbour fix) is open and NOT in progress; it edits the same fallback block later. Leave the `orderedTabIds().pop()` fallback exactly as it is.

## Inputs
- `src/renderer/chrome/tab-controller.js` — `btn` `click` handler (`if (/** @type {HTMLElement} */ (e.target).closest('.tab-close'))` … `freezeTabWidths(); // DD5` … `closeTab(id);`), `btn` `auxclick` handler (`if (e.button !== 1) return;`), `function closeTab(id)` (fallback `const next = orderedTabIds().pop();`), `function activateTab(id)`, `function isLastTab(id)`, `freezeTabWidths`/`releaseTabWidths`.
- `test/unit/tab-controller.test.js` — `createHarness()` (fake `document` is `{ createElement, addEventListener }`; `calls` array records bridge calls incl. `tabClose`, `tabSetActive`).
- `test/unit/helpers/fake-dom.js` — `FakeElement` (`listeners` Map; `click()` invokes the listener with NO event; no `closest`).
- `tests/behavior/tab-reorder.md` Step 9; `tests/behavior/tab-keyboard-operability.md` Out of Scope bullet "Mouse/pointer tab activation, close, and **drag reorder** … verified by the `tab-reorder` spec's click-model regression step".
- `tests/behavior/pointer-close-shows-tab.md` (draft, authored at planning).

## Outputs
- `tab-controller.js`: pointer-close activation per DD1–DD6.
- Unit tests covering the listeners and `closeTab` branches.
- `tab-reorder.md` Step 9 re-authored (+ any restatement of the old invariant in its banner/Intent); `tab-keyboard-operability.md` cross-reference updated.
- `CLAUDE.md` *Tab strip* bullet.
- Flight log entry with the live smoke results.

## Acceptance Criteria
- [x] **AC1 — pointer sites.** The ✕ `click` path calls `closeTab(id, { pointer: { x: e.clientX, y: e.clientY } })` when `e.detail > 0`, and `closeTab(id)` (no pointer) when `e.detail === 0`; the `auxclick` path (button 1 only) always passes the pointer. The existing freeze line (`if (tabs.size > 1 && !isLastTab(id)) freezeTabWidths();`) still runs BEFORE `closeTab` at both sites, unchanged.
- [x] **AC2 — resolution.** A local helper (e.g. `tabIdAtPoint(x, y)`) returns the id of the `.tab` under the point via `document.elementFromPoint(x, y)` → `closest('.tab')` → `dataset.id`, returning `null` when `document.elementFromPoint` is not a function, when nothing/no `.tab` is hit, or when the id is not in `tabs`. It is called only AFTER `tab.btn.remove()` and `tabs.delete(id)`.
- [x] **AC3 — one activation.** In `closeTab`, with a resolved target (truth table): closed tab WAS active → exactly one `activateTab(target)`; closed tab was BACKGROUND and target ≠ current active tab → exactly one `activateTab(target)`; closed tab was background and target === current active tab → no `activateTab` call. In every resolved-target case the `orderedTabIds().pop()` / `openNewTab()` fallback does not run. With no pointer or no resolved target → the existing code path runs unchanged. `stripIndex` capture and the `tabClose` send stay where they are (before removal), so `tabClose` precedes any `tabSetActive`.
- [x] **AC4 — unit tests** (`test/unit/tab-controller.test.js`), driving the REAL listeners (`btn.listeners.get('click')` / `get('auxclick')`) with hand-built events `{ target, clientX, clientY, detail, button, preventDefault() {} }` and a harness `document.elementFromPoint` hook. The event `target` must answer `closest('.tab-close')` (truthy for the ✕ path, `null` for the body path); targets returned by `elementFromPoint` must answer `closest('.tab')`. Cases (any `tabSetActive`-count assertion applies only to targets with a `wcId`; a viewless welcome target goes through `activateTab`'s `tabHide` branch instead):
  1. background ✕ close, target = right neighbour → neighbour active; exactly one `tabSetActive` (for the neighbour's wcId), after the `tabClose`;
  2. active-tab ✕ close mid-strip, target = right neighbour → neighbour active, exactly one `tabSetActive`, never one for the DOM-order-last tab;
  3. middle-click (`auxclick`, button 1, `detail` undefined) on a background tab → pointer passed, target active; `button: 2` → nothing closes;
  4. target already active (background close) → zero `tabSetActive` calls after the `tabClose`;
  5. `elementFromPoint` returns `null` / a non-tab element → background close leaves the active tab unchanged; active close takes the existing DOM-order-last fallback;
  6. `detail: 0` ✕ click → no `elementFromPoint` call; existing behavior;
  7. resolver hits the `.tab-close` child of a tab → resolves that tab (use a hand-built `{ closest: (sel) => (sel === '.tab' ? tab.btn : null) }` — the innerHTML-populated `_parts` children have `parent = null`);
  8. `closeTab(id)` with no opts (existing callers) → unchanged behavior and no `elementFromPoint` call;
  9. freeze-before-resolve: assert INSIDE the `elementFromPoint` hook (not afterwards) that the remaining tabs' `style.flex` is already non-empty on a mid-strip close;
  10. rightmost close (#97 — no freeze) by ✕ with the pointer resolving to the new last tab → that tab active, exactly one `tabSetActive`; and a rightmost background close resolving to nothing → active unchanged;
  11. pointer close of the ONLY tab → no target, existing `openNewTab()` path (no throw).
  All pre-existing tests still pass.
- [x] **AC5 — no hover switching (grep-AC).** `grep -nE "mouseenter|mouseover|pointerover|pointerenter|mousemove" src/renderer/chrome/tab-controller.js src/renderer/renderer.js` returns no hits (each hit, if any, judged exempt-or-real in the flight log). Also run the same pattern over `src/renderer/chrome/` and record the hits; any in other files (e.g. bookmarks bar, menus) are judged exempt unless they touch tab activation.
- [x] **AC6 — scope fence.** `git diff --stat` shows no change to `src/renderer/renderer.js`, `src/main/**`, `src/preload/**`, `shortcut-controller.js`, `window-controller.js`, `jars-client.js`; every other `closeTab(` caller still passes one argument (`grep -rn "closeTab(" src/renderer`).
- [x] **AC7 — specs.** `tests/behavior/tab-reorder.md` Step 9 is re-authored per flight DD8: two actions judged separately, each on a NON-last background tab; each records the post-removal `.tab` rect containing the click point and asserts that tab is the selected tab, and that the closed tab never became selected. Any banner/Intent text restating "background close never changes the active tab" is updated with a dated sortie-08 note — sweep `tab-reorder.md` for "never changed the active tab", "flash", and the "Steps 5–9 remain LIVE coverage" banner line. `tests/behavior/tab-keyboard-operability.md`'s pointer cross-reference still points at the right step and names the new behavior. `pointer-close-shows-tab.md` stays `draft` (first run is at HAT).
- [x] **AC8 — docs.** `CLAUDE.md` → *Tab strip* gains one short bullet: a pointer close (✕/middle-click) activates the tab under the cursor after removal (`closeTab(id, { pointer })`, passed only by the two pointer sites; one activation; no hover switching); every other close keeps the fallback.
- [x] **AC9 — gates.** `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check` all pass (run `npm run format` first).
- [x] **AC10 — live smoke** (project rule: exercise every apparatus primitive against the new state). Launch `npm run dev:automation` with `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1`, capture the admin key from the printed `AUTOMATION_DEV_MINT` line, attach via `scripts/lib/mcp-client.mjs` `connectAutomation()` (NEVER the registered `goldfinch-dev` MCP server). Open ≥5 tabs at distinct pages; then: `enumerateWindows`, `getChromeTarget`, `enumerateTabs`; chrome `evaluate` for `.tab`/`.tab-close` rects; `click` a background tab's ✕ mid-strip → the tab whose post-removal rect contains the point is active (`enumerateTabs` selected, `.tab.active` dataset id, `#address` value agree); click the same point again (active close) → next tab under the point active; `click(..., { button: 'middle' })` on a background non-last tab body → same rule; click the ✕ of the LAST tab in DOM order (#97, no freeze) and record whether the point resolved to a tab (then it is active) or to the pill/gap (then today's rule); `pressKey` Ctrl+W → existing DOM-order-last fallback; `readAxTree(chrome)` shows exactly one selected tab; `captureWindow()` shows the active tab's page in the guest slot; `captureScreenshot` of the active guest. **Premise check (flight Adaptation Criteria):** `elementFromPoint` right after removal reflects the post-removal layout — confirmed by the first close resolving to the slid-in neighbour. Record results + any deviation in the flight log; stop the app afterwards.

## Verification Steps
- AC1–AC4: read the diff; `node --test test/unit/tab-controller.test.js`; `npm test`.
- AC5: run the grep; paste output (expected empty) into the flight log.
- AC6: `git diff --stat`; `grep -rn "closeTab(" src/renderer`.
- AC7/AC8: read the spec and CLAUDE.md diffs.
- AC9: run the four commands.
- AC10: smoke script output summarized in the flight log.

## Implementation Guidance

1. **Pointer sites.** In the `btn` `click` handler's `.tab-close` branch, keep the freeze line, then
   `closeTab(id, e.detail > 0 ? { pointer: { x: e.clientX, y: e.clientY } } : undefined);`
   (or an equivalent two-call form). In `auxclick`, after `e.preventDefault()` and the freeze line, pass the pointer unconditionally. Mind the cast-to-local rule in CLAUDE.md if you need a cast inside a multi-line expression.
2. **Resolver.** Add `tabIdAtPoint(x, y)` inside `createTabController` near `isLastTab`:
   guard `typeof document.elementFromPoint !== 'function'` → `null`; `const el = document.elementFromPoint(x, y); const tabEl = el && typeof el.closest === 'function' ? el.closest('.tab') : null; const tid = tabEl?.dataset?.id; return tid && tabs.has(tid) ? tid : null;` (JSDoc-type it; the file is `// @ts-check`).
3. **`closeTab(id, opts)`.** Add an optional second param (JSDoc `@param {{ pointer?: { x: number, y: number } }} [opts]`). Leave everything up to and including `tabs.delete(id)` untouched. Then:
   ```js
   const wasActive = ctx.activeTabId === id;
   const target = opts && opts.pointer ? tabIdAtPoint(opts.pointer.x, opts.pointer.y) : null;
   if (target) {
     if (wasActive || target !== ctx.activeTabId) activateTab(target);
     return;
   }
   if (wasActive) { …existing fallback block, unchanged… }
   ```
   Keep the existing DD1 comment on the fallback. Add a short comment naming sortie 08 DD3/DD4 (one activation; never the fallback-then-switch flash). Note `ctx.activeTabId` still equals `id` when the closed tab was active (nothing clears it before this point) — `wasActive` must be computed from it, not after activation.
4. **Unit tests.** Extend `createHarness()` with an overridable `document.elementFromPoint` (default undefined so existing tests keep today's path). For targets, either add a minimal `closest(sel)` to `FakeElement` in `test/unit/helpers/fake-dom.js` (the helper models the parent as `this.parent`, maintained by `appendChild`/`insertBefore`/`remove`; walk `this` → `.parent`, matching a `.class` selector via `classList.contains`; additive only — four suites import the helper) or hand-build target objects in the test. Fetch listeners from `tab.btn.listeners`. Assert ordering and counts on `calls`.
5. **Specs.** Re-author `tab-reorder.md` Step 9 (keep the row number; add a dated "sortie 08" note in the Expected Results explaining the contract change). Update the banner/Intent wording that restates the old invariant. Update the `tab-keyboard-operability.md` Out of Scope bullet if its wording implies the old model.
6. **CLAUDE.md.** One bullet under *Tab strip* (keep it to 2–3 lines).
7. **Format, gates, smoke** per AC9/AC10.

## Edge Cases
- **Closing the only remaining tab** by pointer: no target can resolve (`tabs` is empty) → existing `openNewTab()` path.
- **Two tabs, close the background one by ✕**: the active tab may slide under the cursor → already-active no-op; or the point hits the gap/pill → no-op. Either way the survivor stays active.
- **Point in the 4px strip `gap`, on `#newtab-pill`, or in `#window-controls`** → no `.tab` → no target → existing behavior.
- **Viewless welcome record under the cursor** → activated like a click (`activateTab`'s `wcId === null` branch); accepted.
- **Live drag**: `closeTab` already cancels `dnd`; a pointer close during a drag is not reachable (native DnD suppresses clicks). No change.
- **Active-tab 64px floor** at pathological counts shifts neighbours a few px after activation — accepted trade-off (flight DD2); not compensated.

## Files Affected
- `src/renderer/chrome/tab-controller.js` — pointer sites, `tabIdAtPoint`, `closeTab(id, opts)`
- `test/unit/tab-controller.test.js` — harness hook + new tests
- `test/unit/helpers/fake-dom.js` — (optional) minimal `closest`
- `tests/behavior/tab-reorder.md` — Step 9 + banner/Intent note
- `tests/behavior/tab-keyboard-operability.md` — cross-reference wording
- `CLAUDE.md` — *Tab strip* bullet
- `sorties/08-close-burst-tab-visibility/flight-log.md` — leg entry, smoke results

## Design Review
2026-11-08, Developer (cycle 1): approve with changes — all clarifications, applied: `.parent` not `parentNode`; event targets need `closest`; case 7 hand-built target; case 3 `detail` undefined; case 9 asserted inside the hook; AC3 as a truth table; new cases 10 (#97 rightmost) and 11 (single tab); welcome-target `tabSetActive` caveat; AC5 broad grep; AC7 sweep phrases; AC10 rightmost-close bullet. Confirmed: nothing in `closeTab` runs after the fallback block (early return is safe); no `closeTab` typedef in `renderer-globals.d.ts`; existing direct `closeTab` unit calls (active-close fallback, welcome/last-tab) pass no opts and stay green.

## Citation Audit
2026-11-08: all citations are by symbol/snippet and were checked against the working tree on `sortie/08-close-burst-tab-visibility` (base `4ae46a8`): the click/auxclick handlers, `closeTab`'s `orderedTabIds().pop()` fallback, `isLastTab`, `freezeTabWidths`, harness `createHarness`/`calls`, `FakeElement.listeners`/`click()` (no `closest`), and `tab-keyboard-operability.md`'s pointer cross-reference all present. `renderer.js` is 1504 lines (budget 1505).

---

## Post-Completion Checklist
Completion steps — status transitions, flight-log update, checking off in the parent flight, and commit — are Flight Control protocol, driven by the execution workflow. Not repeated here.
