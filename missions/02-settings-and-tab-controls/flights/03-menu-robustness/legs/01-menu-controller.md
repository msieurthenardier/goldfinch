# Leg: menu-controller

**Status**: completed
**Flight**: [Menu Dismissal & Shared APG Helper](../flight.md)

## Objective

Build a shared in-file menu controller in `renderer.js` that owns open/close, robust outside-dismiss (`document` target-aware handler + `window` blur), and mutual-exclusion for **both** dropdown menus; migrate the kebab menu's keyboard/roving onto it and route the container menu's open/close/dismissal through it — landing the dismissal bug fix for both menus. (The container's *keyboard* APG uplift is leg 2.)

## Context

- **DD1 (confirmed)** — the Flight Director's pre-leg spike confirmed focusing a `<webview>` fires `window` blur on the chrome renderer (`flight-log.md` → DD1 window-blur spike). So the dismissal layer is: one target-aware `document` handler (in-chrome clicks) + `window.addEventListener('blur', closeAll)` (page/webview clicks + app-switch). **No divert needed.**
- **DD2** — one in-file controller; **kebab keyboard migrated first** (already APG → behavior-preserving). Both menus are registered for open/close/dismissal/mutual-exclusion in this leg so the **bug fix lands for both now**; the container's *keyboard* (roles/roving/arrow-nav) is uplifted in leg 2.
- **DD4** — remove the hand-wired mutual-exclusion cross-calls (`renderer.js:101` `closeKebabMenu()` in `openContainerMenu`, `:180` `closeContainerMenu()` in `openKebabMenu`), the two separate `document` click listeners (`:240`, `:509`), and the per-trigger `stopPropagation` *reliance* — all subsumed by the controller (open-closes-others; one target-aware document handler).
- **Architect (medium)** — keep both mutual-exclusion call sites consistent within this leg so there's no intermediate `ReferenceError` (both menus route through the controller here).

## Inputs

What exists before this leg (on `main`, carried to the flight branch):
- `src/renderer/renderer.js` — kebab menu (`openKebabMenu`/`closeKebabMenu`/`kebabItems`/`focusItem`/`positionKebabMenu` + trigger/menu keydown + `document` listener, `renderer.js:162-240`); container menu (`openContainerMenu`/`closeContainerMenu` + Escape-only keydown + `document` listener, `:100-145`); `els.kebab`/`els.kebabMenu`/`els.newTabMenu`/`els.containerMenu` in the `els` block.
- `src/renderer/index.html` — `#kebab` + `#kebab-menu` (with two static `role="menuitem"`), `#new-tab-menu` (`aria-haspopup="menu"`), `#container-menu` (no role yet).
- `src/renderer/styles.css` — `.cm-*`, `#kebab-menu`/`#container-menu` chrome.

## Outputs

- A shared controller object in `renderer.js` (e.g. `menuController` with `register(...)`, `open(entry, startIndex)`, `close(entry)`, `closeAll()`).
- Kebab registered + fully driven by the controller (open/close/roving/APG keydown).
- Container registered for open/close/dismissal/mutual-exclusion (keyboard uplift deferred to leg 2).
- One target-aware `document` dismissal handler + one `window` blur handler; the two old `document` listeners and the hand-wired cross-calls removed.
- `npm run typecheck`/`lint`/`test` green.

## Acceptance Criteria
- [ ] A single shared controller in `renderer.js` manages both menus. Opening either menu **closes any other open menu** (mutual-exclusion via the controller's `open()`, NOT hand-wired cross-calls).
- [ ] **Outside-dismiss works for the kebab via both paths**: clicking a neutral in-chrome area (e.g. address bar) closes it (target-aware `document` handler), AND focusing/clicking the page `<webview>` closes it (`window` blur handler).
- [ ] The kebab menu's existing behavior is **preserved** through the controller: opens on click + Enter/Space/ArrowDown (→first) / ArrowUp (→last); ArrowDown/Up wrap; Home/End; Escape closes + restores focus to `#kebab`; Tab/Shift+Tab close + restore focus; Settings inert no-op; Exit → `window.goldfinch.appQuit()`.
- [ ] The container menu still opens/closes and **also dismisses on outside click + window-blur** and participates in mutual-exclusion (its keyboard remains Escape-only this leg — APG uplift is leg 2; its dynamic items / jar dots / Burner / New-container / createTab-on-select / Escape+focus-restore / inline-left anchor all still work).
- [ ] The hand-wired cross-calls (`renderer.js:101`, `:180`), both old `document` click listeners (`:240`, `:509`), and per-trigger `stopPropagation` *reliance* are removed; no intermediate `ReferenceError` (both menus route through the controller within this leg). **Each menu's public `closeX` wrapper and its `onClose` raw-hide body are distinct functions (no recursion).**
- [ ] Outside-click and `window` blur dismissal **do not restore focus to the trigger**; only Escape and Tab/Shift+Tab restore focus (kebab → `#kebab`, container → `#new-tab-menu`).
- [ ] Any new `els.*`/controller state carries JSDoc types as needed; `npm run typecheck` → 0; `npm run lint` → 0; `npm test` → all pass.

## Verification Steps
- `npm run typecheck` / `npm run lint` / `npm test` — all green.
- The live behavior verification (kebab dismissal via page-click/window-blur, cross-trigger, regressions) is the `verify-integration` leg's `menu-dismissal` + `kebab-menu` runs; this leg's own check is the offline gates + a code read confirming the dual listeners/cross-calls are gone and both menus route through the controller.
- (FD already confirmed the window-blur primitive; the controller's `window` blur → `closeAll` wiring is what this leg adds.)

## Implementation Guidance

1. **Controller shape** (in-file, `sourceType:"script"` — a plain object/closure, no modules):
   ```js
   const menuController = (() => {
     /** @type {{trigger:HTMLElement, menu:HTMLElement, onOpen?:Function}[]} */
     const entries = [];
     let open = null; // currently-open entry or null
     function openEntry(entry, startIndex = 0) {
       closeAll();                 // mutual-exclusion
       entry.onOpen?.(startIndex); // menu-specific: build items, show, position, focus, aria
       open = entry;
     }
     function closeEntry(entry) { entry.onClose?.(); if (open === entry) open = null; }
     function closeAll() { if (open) closeEntry(open); }
     function register(entry) { entries.push(entry); return entry; }
     return { register, open: openEntry, close: closeEntry, closeAll, get current(){ return open; } };
   })();
   ```
   - Exact API is the Developer's call; the must-haves: `open` closes others first; `closeAll` for the dismissal handlers; per-entry open/close hooks so each menu keeps its own build/position/focus logic.

2. **Migrate the kebab** — register an entry whose `onOpen(startIndex)` is the **raw** show body (the current `openKebabMenu` minus its `closeContainerMenu()` cross-call: `classList.remove('hidden')`, `positionKebabMenu`, `aria-expanded='true'`, `focusItem`) and whose `onClose` is the **raw** hide body (the current `closeKebabMenu` body: `classList.add('hidden')` + `aria-expanded='false'`). The kebab's **keydown stays a per-entry listener on `els.kebabMenu`** (Arrow/Home/End/Escape/Tab — do NOT make it controller-global, or registering the container would accidentally uplift its keyboard before leg 2). Trigger handlers call `menuController.open(kebabEntry, …)` / `.close(kebabEntry)`.
   - **⚠ Recursion trap (design review, high)**: the public `closeKebabMenu` becomes a thin wrapper `() => menuController.close(kebabEntry)`, and `menuController.close` calls `entry.onClose()`. So **`onClose` must be the RAW hide body, NOT `closeKebabMenu`** — if `onClose` calls the wrapper, you get `close → onClose → closeKebabMenu → close → …` stack overflow. The wrapper and `onClose` must be two different functions. Same rule for the container.

3. **Register the container** — `onOpen` is the **raw** `openContainerMenu` body minus its `closeKebabMenu()` cross-call (build dynamic items, show, inline-left anchor, aria-expanded, focus first `.cm-item`); `onClose` is the **raw** `closeContainerMenu` body (`classList.add('hidden')` + `newTabMenu aria-expanded='false'`). Route `#new-tab-menu`'s click through `menuController.open(containerEntry)`/`.close`. Public `closeContainerMenu` becomes the thin wrapper `() => menuController.close(containerEntry)` (distinct from `onClose` — same recursion rule). **Do NOT uplift the container keyboard here** (leg 2) — leave only its existing Escape-only keydown listener (`renderer.js:140-145`).

4. **Remove the hand-wired bits (DD4)**:
   - Delete `closeKebabMenu()` call at `openContainerMenu` start (`:101`) and `closeContainerMenu()` at `openKebabMenu` start (`:180`) — mutual-exclusion now comes from `menuController.open` → `closeAll`.
   - Delete both `document.addEventListener('click', …)` menu-close listeners (`:240`, `:509`).
   - For trigger clicks: instead of `e.stopPropagation()` to dodge the global handler, the single dismissal handler must **ignore events whose target is inside the open menu or is a registered trigger** (target-aware). Drop the `stopPropagation`-for-dismissal reliance (keep it only if needed for an unrelated reason).
   - **Triggers read `menuController.current`, not `classList.contains('hidden')`** (design-review suggestion): the toggle becomes `menuController.current === kebabEntry ? close : open` — keeps the controller's `current` the single source of truth, no DOM-class/controller drift.

5. **Add the dismissal layer (once), using `pointerdown`** (pinned — fires before focus shifts; the `menu-dismissal` CDP clicks dispatch `pointerdown→click`, so this fires):
   ```js
   document.addEventListener('pointerdown', (e) => {
     const cur = menuController.current;
     if (!cur) return;
     const t = /** @type {Node} */ (e.target);
     if (cur.menu.contains(t) || cur.trigger.contains(t)) return; // inside the open menu or its trigger
     // a click on the OTHER trigger is handled by that trigger's own open() (which closeAll()s first)
     menuController.closeAll();
   });
   window.addEventListener('blur', () => menuController.closeAll()); // page/webview click + app-switch
   ```
   - **Outside-dismiss + blur do NOT restore focus to the trigger** — only Escape/Tab do (those keydown paths keep their `els.kebab.focus()` / `els.newTabMenu.focus()` calls). An outside click shouldn't yank focus back into the chrome.

6. **Run gates**; fix typecheck (JSDoc on the controller's `current` union `entry|null`) as needed.

## Edge Cases
- **Activation clicks**: selecting a menu item (Settings/Exit/container item) already closes the menu in its handler; ensure the dismissal `pointerdown` handler doesn't double-fire or race (item clicks are inside `cur.menu` → ignored by the guard).
- **`window.prompt` (New container…)**: the prompt steals focus → may fire `window` blur → `closeAll`. That's fine (the menu closes; the prompt then runs). **Must-verify (not a formality — design review):** confirm the New-container flow still creates the container + opens a tab, since this leg's dismissal layer newly interacts with the prompt's focus shift.
- **Clicking `+` (`#new-tab`) while the container menu is open**: `+` is not exempt (not the registered `▾` trigger, not inside the menu), so the `pointerdown` handler closes the container menu and `+` opens a default tab. **This is accepted/intended** (clicking the new-tab button both dismisses the menu and does its job).
- **Address-bar focus does NOT fire window blur** (same document) → in-chrome clicks rely on the `document` handler, not blur. (Confirmed by FD spike reasoning.)
- **Devtools/app-switch blur**: closes open menus — acceptable/desirable.
- **No menu open**: both handlers early-return (`!cur`).

## Files Affected
- `src/renderer/renderer.js` — add the controller; migrate kebab; register container; remove dual listeners + cross-calls; add dismissal layer.
- (No `index.html`/`styles.css` changes this leg — container role attrs are leg 2.)

---

## Post-Completion Checklist

**Do NOT commit (deferred-commit flight). Then signal `[HANDOFF:review-needed]`:**
- [ ] All acceptance criteria verified; offline gates green
- [ ] Update flight-log.md with a leg progress entry
- [ ] Set this leg's status to `landed`
- [ ] Do NOT check off the leg in flight.md, do NOT commit — single review + commit after the last autonomous leg

---

## Citation Audit

Verified against current code (on the flight branch, == `main` for these files) at leg-design time:
`renderer.js:100-145` (container menu), `:162-240` (kebab menu incl. `document` listener at `:240`),
`:101`/`:180` (hand-wired cross-calls), `:509` (container `document` listener), `:203`/`:506`
(per-trigger `stopPropagation`), `:249` (webview creation). The DD1 window-blur premise is
FD-spike-confirmed (flight log).
