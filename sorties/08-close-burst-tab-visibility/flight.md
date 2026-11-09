# Sortie: Close-Burst Tab Visibility

**Status**: in-flight

## Charter

### Outcome
When the operator closes tabs one after another with the mouse, the tab that slides under the cursor is the one on screen, so they can see what they are about to close next.

### Why Now
Operator report (2026-11-08): while closing a run of tabs, the previously focused tab stays on screen. The DD5 deferred-reflow freeze (`tab-controller.js` `freezeTabWidths`/`releaseTabWidths`) keeps the next ✕ under the cursor, but the page behind it is never visible, so closing a run of tabs is guesswork. Today `closeTab()` only activates another tab when the closed tab was the active one, and closing a background tab never changes the visible tab.

### Success Criteria
- [ ] After every ✕ or middle-click close, the tab now under the cursor becomes the active tab — its page is shown and the address bar and tab highlight match it — with exactly one tab switch per close (no intermediate flash of another tab)
- [ ] Moving the mouse along the strip never changes the active tab (no hover switching)
- [ ] When no tab is under the cursor after a pointer close, the active tab is chosen exactly as today
- [ ] Existing close behavior is otherwise unchanged: mid-strip pointer closes still freeze widths, the issue #97 rightmost-tab case still works, and keyboard / context-menu / automation closes behave as before

### Constraints
- Real activation through the existing `activateTab` path (operator ruling 2026-11-08) — visible and active never diverge; no "preview" state.
- Only a pointer close changes the visible tab (operator ruling 2026-11-08: "it should really only show the adjacent tab"); no hover switching, no dwell timers, no burst lifecycle state.
- The width freeze (DD5, issue #97 carve-out) is unchanged.
- No guest-slot animation (`WebContentsView` native-surface invariant).
- Renderer-only. `src/renderer/renderer.js` is at its 1505-line budget and is not touched.
- Out of scope: the keyboard-close fallback that activates the rightmost tab rather than a neighbour — squawk 0177.

*Charter amended 2026-11-08 during flight design (operator rulings): the original draft had hover-to-activate during a "close burst" bounded by the width freeze; the operator narrowed it to close-only activation, which removes criterion "leaving the strip ends the burst" and the burst lifecycle constraint. See flight log → Decisions.*

---

## Pre-Flight

### Objective
Make every pointer close (✕ click or middle-click on a tab) end with the tab under the cursor active. `closeTab` gains an optional pointer argument used only by the two pointer-close sites in `tab-controller.js`; after the closed tab's button leaves the DOM (and after the width freeze, when one applies), the chrome resolves the tab under the event's `clientX/clientY` and activates it directly — one activation, never the rightmost-tab fallback followed by a second switch. With nothing under the cursor, today's behavior runs unchanged. All other `closeTab` callers are untouched.

### Open Questions
- [x] Real activation or preview? → DD1 (real activation; operator)
- [x] Hover switching? → DD1 (none; operator: "only show the adjacent tab")
- [x] Does the rightmost-tab (#97, unfrozen) close participate? → DD2 (yes — every pointer close resolves under the cursor; operator chose "every pointer close")
- [x] Does activation steal focus or trigger loads? → no: `activateTab` moves no focus; main's `tab-set-active` re-focuses the incoming guest only if the OUTGOING guest held focus (`register-tab-ipc.js`, `wasPageFocused`), which a strip click never leaves true; there is no lazy tab loading
- [x] HAT leg? → yes (operator)

### Design Decisions

**DD1 — Close-only activation; no hover behavior.** The only new behavior is at the moment of a pointer close. No `mouseenter`/`mouseover`/`pointerover`/`pointerenter`/`mousemove` listener is added to tabs or the strip, no timer, no armed/burst state.
- Rationale: operator ruling. The tab that slides into the closed tab's slot (the right neighbour, mid-strip under the DD5 freeze; the new last tab or nothing in the #97 case) is "the adjacent tab" the operator wants to see. No state means nothing to arm, leak or wedge (cf. issue #97's wedged freeze).
- Trade-off: moving the mouse to a different tab's ✕ does not preview it; the operator reads its title or clicks it.

**DD2 — Every pointer close participates, with or without a width freeze.** Both `btn` `click` (✕ target) and `auxclick` (button 1) pass the event's pointer coordinates to `closeTab`. The freeze decision (`tabs.size > 1 && !isLastTab(id)`) is unchanged and still runs BEFORE `closeTab`.
- Rationale: closing from the right end is a common run; in the #97 case the strip reflows immediately and the new last tab's ✕ expands toward the cursor, so whatever tab is under the cursor after the reflow is the right one to show.
- Trade-off: after a rightmost close the cursor may land on the `+` pill or the trailing gap — then DD4's no-target branch applies. In a squeezed strip the new last tab expands toward the cursor and becomes active even when the closed tab was a background tab — intended ("every pointer close").
- Accepted trade-off (design review): at pathological tab counts a tab frozen BELOW the active-tab 64px `min-width` floor (`styles.css`, `.tab.active`; `responsive-tab-strip.md` Step 5) grows when it becomes active, shifting the tabs to its right by a few pixels, so the next ✕ may sit slightly off the cursor. The freeze is not changed to compensate; HAT checks a 20+-tab strip.

**DD3 — Resolve the target AFTER the DOM removal, from the event's coordinates.** `closeTab(id, opts)` accepts an optional `{ pointer: { x, y } }`. After `tab.btn.remove()` + `tabs.delete(id)`, it resolves `document.elementFromPoint(x, y)?.closest?.('.tab')`, reads `dataset.id`, and accepts it only if `tabs.has(thatId)` (so a stale/foreign node never resolves). `document` is already an injected dep of `createTabController` (unit tests stub `elementFromPoint` on the fake document — no new dep).
- Rationale: the post-removal layout (frozen widths mid-strip, reflowed at the right end) is exactly what the operator sees under the cursor. `elementFromPoint` forces a synchronous layout, so the read reflects the removal. `dataset.id` lives on the `.tab` button itself (`btn.dataset.id = id`), so `closest('.tab')` from the ✕, the title or the row resolves it.
- "Under the cursor" is the contract, not "the right neighbour": with equal widths (the normal case) it IS the right neighbour; with unequal widths (an active tab on its 64px floor, a dragged tab) the point may fall on a later tab (that tab is activated — correct by the charter) or in the strip's 4px `gap` (no target → DD4's no-target branch).
- A keyboard-synthesized `click` (`e.detail === 0`, e.g. AT default action) carries no real pointer position: the ✕ button is `tabindex="-1"` so this is unlikely, but the pointer arg is passed only when `e.detail > 0` (click) — `auxclick` always comes from a real button. No pointer → today's behavior.
- Trade-off: one forced layout per pointer close (negligible: one per user click).

**DD4 — Exactly one activation per close.** Inside `closeTab`, when a pointer target resolves:
  - target is a different tab than `ctx.activeTabId` (or the closed tab was active) → `activateTab(target)` and skip the `orderedTabIds().pop()` fallback entirely;
  - target is already the active tab → no activation call (no redundant `tabSetActive`). This must be an explicit check in `closeTab`: `activateTab` has no same-id early-out (it re-toggles classes and re-sends `tabSetActive` unconditionally).
  - a target that is a viewless welcome record (`wcId === null`) is activated like any click activation (`activateTab`'s `tabHide` branch) — accepted unchanged.
  When no target resolves: today's code path, byte-for-byte (closed-was-active → `pop()` fallback / `openNewTab()`; background close → nothing).
- Rationale: running the fallback and then switching again would flash the rightmost tab — exactly the "can't see what's on screen" problem. The fallback's `openNewTab()` arm is unreachable when a target resolves (a target means another tab exists).
- Trade-off: `closeTab` grows a branch. The fallback itself stays as-is (squawk 0177 owns its neighbour fix).

**DD5 — IPC ordering is today's active-close ordering.** `tabClose(wcId, stripIndex)` is still sent before the `tabSetActive` that `activateTab` sends — the same sender and the same order the existing active-close path already uses, so main sees no new sequence. For a background close, main now additionally receives a `tab-set-active` for the newly active tab, which is an ordinary tab switch (closes the menu sheet / corner save prompt for the outgoing tab per the squawk-0100 order, re-arms find for the incoming tab).
- Rationale: no main-side change; every switch side effect is the existing one.
- Shared-mechanism audit (project rule): features sharing the tab-switch path — find overlay restore (DD9), suggestions reset, save prompt drop on tab switch, menu-overlay `tab-switch` close, load-failure/crash/welcome panel projection, hang notice, privacy/media panels, DevTools pressed-state, bookmarks bar, toolbar affordances — all run through `activateTab` exactly as on a click activation; no new entry into any of them.

**DD6 — Scope fence: only the two pointer sites pass a pointer.** `renderer.js`'s seam wrapper `(id) => tabController.closeTab(id)`, `shortcut-controller.js` (Ctrl+W / Delete), `window-controller.js`, `jars-client.js`, the tab-context menu batch closes, the script-closed path and the automation `closeTab` op all keep calling `closeTab(id)` with no second argument. The evaluate seam (`SEAM_COUNT` 41) is unchanged. The two pointer sites call the controller-LOCAL `closeTab` directly (inside `createTabController`); the `renderer.js:120` wrapper drops any second argument and is not on their path, so no seam or `renderer.js` change is implied. The automation close path (`closeTabByWcId`) never passes opts.

**DD7 — Verification and apparatus.** Unit tests in `test/unit/tab-controller.test.js` (fake `document.elementFromPoint`), plus a new behavior spec `pointer-close-shows-tab` (drafted with this flight) and a re-authored `tab-reorder.md` Step 9.
- **Act axis**: admin MCP `click(chromeWcId, x, y)` / `click(..., { button: 'middle' })` on rect-derived coordinates — trusted mouseMove→down→up, the same apparatus `responsive-tab-strip.md` Steps 6–7 and `tab-reorder.md` Step 9 already use (`src/main/automation/input.js` `mouseClickEvents`). `pressKey` for the keyboard-close control row.
- **Observe axis**: `enumerateTabs`/`readAxTree` `selected` state, chrome `evaluate` of `document.querySelector('.tab.active')?.dataset.id`, `#address` `.value`, `.tab` rects; `captureWindow()` for the rendered guest (the active tab's page actually shown — DOM correct ≠ render correct).
- **Not automatable**: "no intermediate flash" (DD4) is a sub-frame visual; it is pinned by a unit test (exactly one `tabSetActive` per close, never one for the rightmost tab first) and watched by eye at HAT. "Hover never switches" (DD1) is a grep-AC (no hover-family listener on `.tab`/`#tabs`/`#tabstrip`) plus a HAT by-eye check — there is no move-only MCP primitive (`click` always clicks).
- **Live smoke** (project rule): the leg's smoke exercises every apparatus primitive against the new state — `enumerateWindows`, `enumerateTabs`, `getChromeTarget`, `click` (left + middle), `pressKey`, chrome `evaluate`, `readAxTree`, `captureWindow`, `captureScreenshot` of the newly active guest.

**DD8 — Spec re-author (external reader contract).** `tests/behavior/tab-reorder.md` Step 9 asserts a background ✕/middle close leaves the active tab unchanged. That contract changes deliberately: re-author Step 9 so it asserts (a) the closed tab is never activated en route (it is gone, never `selected`), and (b) afterwards the selected tab is the tab under the click coordinate. `responsive-tab-strip.md` Steps 6–7 assert widths only; they remain valid and gain no assertion here (the new spec owns activation). Step 6 of `tab-reorder.md` (keyboard Delete → DOM-last) is untouched — it is squawk 0177's.
- Re-author details (design review): Step 9 has TWO actions (✕ click, then middle-click), each judged separately; each records the post-removal `.tab` rect containing the click point and asserts that tab is selected. Pin both targets to NON-last tabs (a last-tab middle-click has no freeze and would need Step 7's branch logic). Also update any restatement of the old invariant in `tab-reorder.md`'s banner/Intent ("click-model" text) and the cross-reference at `tests/behavior/tab-keyboard-operability.md:58` that points at this step as the pointer-model check.

### Prerequisites
- [x] No active mission covers this outcome (all 22 missions completed)
- [x] No open sortie overlaps (sorties 01–07: none touch `closeTab`)
- [ ] Squawk 0177 is NOT in progress concurrently (both edit the same `closeTab` fallback block; the `tab-moved-away` handler carries a duplicate of that fallback) — verify at execution start. **Sequencing rule**: if 0177 lands first, DD4's no-target branch is whatever neighbour rule 0177 installed (not "today's `pop()`"), and `pointer-close-shows-tab` Steps 7–8 expect the right neighbour instead of the DOM-order-last tab; the leg re-reads `closeTab` before editing. If this sortie lands first, 0177 re-reads the new `closeTab` and leaves the pointer branch intact.
- [ ] Admin MCP apparatus available: `npm run dev:automation` with `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1`, admin key captured per launch, `connectAutomation()` env-key scripts (operator standing preference — never the registered `goldfinch-dev` MCP server); local HTTP fixture with distinct page titles/colors

### Pre-Flight Checklist
- [x] All open questions resolved
- [x] Design decisions documented
- [x] Prerequisites verified
- [x] Validation approach defined
- [x] Legs defined

---

## In-Flight

### Technical Approach
1. **`tab-controller.js`, the two pointer-close sites** (`btn` `click` with a `.tab-close` target; `btn` `auxclick` with `e.button === 1`): keep the existing freeze line, then call `closeTab(id, { pointer: { x: e.clientX, y: e.clientY } })` (click only when `e.detail > 0`).
2. **`closeTab(id, opts)`**: unchanged up to and including `tabs.delete(id)`. Then, if `opts?.pointer`, resolve `pointerTarget` per DD3. Branch per DD4: a resolved target supersedes the `ctx.activeTabId === id` fallback; no target → existing code unchanged. Keep the `stripIndex`-before-removal capture and the `tabClose` send exactly where they are.
3. **Resolver as a small local helper** (`tabIdAtPoint(x, y)`) inside `createTabController`, guarded for a document without `elementFromPoint` (returns `null`) so the unit harness and any non-DOM caller degrade to today's behavior.
4. **Tests** (`test/unit/tab-controller.test.js`): the harness `document` today is `{ createElement, addEventListener }` and `FakeElement.click()` calls listeners with NO event, so (a) add an `elementFromPoint` hook to the harness `document` returning a chosen tab's `btn` (or its `.tab-close` child, or a non-tab element, or `null`); (b) give the fake targets a `closest` method (extend `test/unit/helpers/fake-dom.js` minimally, or stub on the test's fake target); (c) drive the REAL listeners — `btn.listeners.get('click')` / `get('auxclick')` — with hand-built events `{ target, clientX, clientY, detail, button, preventDefault }`, so the `detail > 0` guard, the coordinates, the `.tab-close` target check and the `button !== 1` filter are all exercised. Assert on the existing `calls` array: `tabClose` precedes `tabSetActive`, and count `tabSetActive` calls. Pin freeze-before-`closeTab` order (widths frozen when the resolver runs). Cases: background ✕ close → target activated, one `tabSetActive`; active-tab ✕ close mid-strip → target activated, never the rightmost tab, exactly one `tabSetActive` after the `tabClose`; middle-click close → same; target already active → zero `tabSetActive`; no target + background close → no activation; no target + active close → today's `pop()` fallback; keyboard-synth click (`detail: 0`) → no pointer path; `closeTab(id)` with no opts → unchanged (callers' contract). Plus a grep-AC: `grep -nE "mouseenter|mouseover|pointerover|pointerenter|mousemove" src/renderer/chrome/tab-controller.js src/renderer/renderer.js` returns no hits (zero today; the existing `#tabstrip` `mouseleave` freeze release is deliberately outside the pattern); any hit is judged exempt-or-real per the grep-AC convention.
5. **Specs**: create `tests/behavior/pointer-close-shows-tab.md` (drafted at planning, status `draft` → `active` after its first run); re-author `tab-reorder.md` Step 9 per DD8.
6. **Docs**: `CLAUDE.md` → *Tab strip*: one bullet — a pointer close (✕/middle-click) activates the tab under the cursor after removal (`closeTab(id, { pointer })`, passed ONLY by the two pointer sites; one activation; no hover switching); every other close keeps the fallback. Keep it short. `renderer.js` untouched and no new file, so `RENDERER_LINE_BUDGET` and `SEAM_COUNT` are unaffected.

### Checkpoints
- [x] Unit tests green (`npm test`), `npm run typecheck`, `npm run lint`, `npm run format:check`
- [x] Live smoke against the running app exercises every apparatus primitive (DD7)
- [ ] `pointer-close-shows-tab` run passes; `tab-reorder` Step 9 (re-authored) passes
- [ ] HAT: operator closes runs of tabs by ✕ and middle-click, mid-strip and from the right end, and confirms the page under the cursor is always the one shown with no flash

### Adaptation Criteria

**Divert if**:
- `elementFromPoint` immediately after removal does not reflect the post-removal layout live (premise check in the leg's smoke) — re-plan the resolution point (e.g. rAF) with the operator, since a deferred activation reopens the flash question
- Main-side `tab-set-active` after a background `tabClose` produces any visible artifact (guest not shown, stale bounds) — that is a main-path change and needs design review

**Acceptable variations**:
- Helper naming/placement inside `tab-controller.js`
- Exact wording of the CLAUDE.md bullet and the spec rows

### Legs
- [x] `pointer-close-activation` - Pointer-close resolves and activates the tab under the cursor (DD1–DD6), unit tests, grep-AC, `tab-reorder.md` Step 9 re-author, CLAUDE.md bullet, live smoke (DD7)
- [ ] `hat-and-alignment` - Guided HAT session: operator closes runs of tabs by hand (✕ and middle-click, mid-strip and from the right end, a comfortable strip AND a squeezed 20+-tab strip for the 64px-floor shift, one close with the cursor in the 4px gap); watches for any flash and confirms hovering never switches; run `pointer-close-shows-tab`; fix what surfaces (behavior changes route through the fix-vs-feature gate)

---

## Post-Flight

### Completion Checklist
- [ ] All legs completed
- [ ] Code merged
- [ ] Tests passing
- [ ] Documentation updated

### Verification
- `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check` green
- Behavior specs: `pointer-close-shows-tab` (new) and `tab-reorder` (Step 9 re-authored) pass on the admin MCP apparatus
- HAT sign-off: operator confirms by eye that every pointer close shows the tab under the cursor, with no flash and no hover switching
