# Leg: kebab-menu-ui

**Status**: completed
**Flight**: [Kebab Menu](../flight.md)

## Objective

Add a kebab (⋮) button as the last control in the toolbar row (right of the Shield button) that opens an APG-compliant `role="menu"` popup with exactly two items — **Settings** (inert placeholder) and **Exit** (placeholder handler this leg, wired in leg 2) — fully operable by mouse and keyboard.

## Context

- **Flight DD1** — the kebab lives in `#toolbar` as its last child, immediately right of `#toggle-privacy`. Position is pinned explicitly (Flight-1 debrief lesson: under-pinned placement cascades).
- **Flight DD2** — Settings is an inert placeholder this flight; the `goldfinch://` page mechanism arrives in Flight 3+. Its handler is a documented no-op, not a broken call.
- **Flight DD5** — reuse the container menu's open/close/focus mechanics and `.cm-*` styling, but build **proper APG `role="menu"`/`role="menuitem"` + roving tabindex + arrow-nav fresh** (the container menu has none of these). The kebab is on the dark toolbar, so the global gold focus ring (`styles.css:256-267`) is visible — give the kebab `class="icon-btn"` to inherit it with no new CSS.
- **Outside-close trap (DD5)** — the container-menu trigger calls `e.stopPropagation()` (`src/renderer/renderer.js:417 — "e.stopPropagation();"`) ahead of the global `document.addEventListener('click', () => closeContainerMenu())` (`src/renderer/renderer.js:420`). The kebab needs the identical discipline; its outside-close handler must not interfere with the container menu's.

## Inputs

What exists before this leg runs:
- `src/renderer/index.html` — `#toolbar` ends with `#toggle-media` then `#toggle-privacy` (`index.html:60-65`); `#container-menu` is a sibling popup of `#tabstrip` (`index.html:42`).
- `src/renderer/renderer.js` — the `els` object with JSDoc casts (`renderer.js:7-55`); the container-menu pattern `openContainerMenu`/`closeContainerMenu` (`renderer.js:98-151`); the click wiring + outside-close (`renderer.js:415-420`).
- `src/renderer/styles.css` — `#toolbar` flex row (`styles.css:277-284`); `.icon-btn` (`styles.css:285-300`); the global focus ring covering `.icon-btn`/`.text-btn`/`.cm-item:focus-visible` (`styles.css:256-267`); the `#container-menu` + `.cm-*` menu styling (`styles.css:981-1035`).

## Outputs

What exists after this leg completes:
- A `#kebab` button in `#toolbar` (last child) and a `#kebab-menu` popup with two `role="menuitem"` items.
- `els.kebab` and `els.kebabMenu` added to the `els` object with matching JSDoc casts.
- Full open/close + APG keyboard behavior wired; Settings = inert no-op; Exit = placeholder no-op (real wiring in leg 2).
- `npm run typecheck`, `npm run lint`, `npm test` all green.

## Acceptance Criteria
- [ ] A `<button id="kebab" class="icon-btn" aria-haspopup="menu" aria-expanded="false">` is the **last child of `#toolbar`**, immediately after `#toggle-privacy`, with an accessible name (e.g. `aria-label="More"` and a `title`).
- [ ] A `#kebab-menu` popup exists with `role="menu"`, containing **exactly two** `role="menuitem"` controls with accessible names **"Settings"** (first) and **"Exit"** (second). No third item. The two items are **static markup** in `index.html` (they never change), not rebuilt on open.
- [ ] `#kebab-menu` is a **body-level sibling** of `#container-menu` (NOT nested inside `#toolbar` or any `position:relative`/`position:absolute` ancestor), so its `position:absolute` offset parent is `<body>` at viewport origin and the dynamic `top`/`right` math resolves correctly.
- [ ] The kebab carries `class="icon-btn"`, inheriting the global focus ring (`styles.css:256-267`); the rendered visible-ring delta is verified in the `kebab-menu` behavior test (leg 4).
- [ ] Clicking the kebab toggles the menu open/closed; `aria-expanded` tracks state; the trigger click calls `e.stopPropagation()` so the global outside-click handler doesn't immediately re-close it.
- [ ] Opening the menu (mouse or keyboard) moves focus to the first item ("Settings"); focus is never stranded on `<body>`.
- [ ] APG keyboard nav works: `Enter`/`Space`/`ArrowDown` on the focused trigger opens the menu focused on the **first** item; `ArrowUp` on the focused trigger opens the menu focused on the **last** item (APG menu-button); with the menu open, `ArrowDown`/`ArrowUp` move focus between the two items (wrapping), `Home` focuses Settings, `End` focuses Exit; `Enter`/`Space` activate the focused item.
- [ ] `Escape` while the menu is open closes it, sets `aria-expanded="false"`, and restores focus to the kebab trigger.
- [ ] Clicking outside the open menu closes it (without breaking the container menu's own outside-close).
- [ ] Selecting **Settings** closes the menu and does nothing else (inert no-op; no navigation, no new tab) — a `// TODO(Flight 3+): open goldfinch://settings once the internal-page path exists` comment marks the seam.
- [ ] Selecting **Exit** closes the menu (its real quit wiring lands in leg 2 — a placeholder no-op or a clearly-marked stub is acceptable this leg).
- [ ] `els.kebab` and `els.kebabMenu` are added with the same `/** @type {HTMLButtonElement} */` / `/** @type {HTMLElement} */` JSDoc cast style as the surrounding `els` entries (`renderer.js:7-55`).
- [ ] The kebab menu does NOT alter the tab strip, the `#tabs` `tablist`, the container menu, or window controls.
- [ ] `npm run typecheck` → 0 errors; `npm run lint` → 0 problems; `npm test` → all pass.

## Verification Steps
- `npm run typecheck` — 0 errors (confirms the new `els.*` JSDoc casts are correct).
- `npm run lint` — 0 problems.
- `npm test` — all unit tests pass (no offline regression).
- Inspect `src/renderer/index.html`: `#kebab` is the final child of `#toolbar`, after `#toggle-privacy`; `#kebab-menu` has `role="menu"` and two `role="menuitem"` items.
- Manual smoke (deferred to the verify leg's running app, but if the app is up): click ⋮ → menu opens with Settings/Exit; Tab to ⋮ + Enter → opens + first item focused; ArrowDown/ArrowUp move; Escape closes + focus returns to ⋮; click outside closes; Settings is inert.
- Full keyboard + a11y + behavior-test verification is the `kebab-menu` behavior test, run in the `verify-integration` leg.

## Implementation Guidance

1. **Add the kebab button to `#toolbar`** (`src/renderer/index.html`, after `#toggle-privacy` at `index.html:63-65`):
   ```html
   <button
     id="kebab"
     class="icon-btn"
     title="More"
     aria-label="More"
     aria-haspopup="menu"
     aria-expanded="false"
   >⋮</button>
   ```
   - The literal `⋮` (U+22EE) is acceptable (the toolbar already uses text glyphs `◀ ▶ ⟳`); a CSS-drawn three-dot icon is an acceptable variation (flight open question) — keep it simple.

2. **Add the popup with STATIC items** as a **body-level sibling of `#container-menu`** (place it right after `#container-menu` at `index.html:42`). The two items never change, so author them declaratively (reviewer's simplification — simpler than rebuild-on-open, keeps the a11y tree stable, and while `.hidden` the menu is `display:none` so axe skips it):
   ```html
   <div id="kebab-menu" class="hidden" role="menu" aria-label="More menu">
     <button id="kebab-settings" class="cm-item" role="menuitem" tabindex="0">Settings</button>
     <button id="kebab-exit" class="cm-item" role="menuitem" tabindex="-1">Exit</button>
   </div>
   ```
   - **Body-level placement is a hard requirement** (medium-issue from design review): `#kebab-menu` is `position:absolute`, so its offset parent must be `<body>` at (0,0) for the dynamic `top`/`right` math (step 6) to resolve in viewport coordinates. Do NOT nest it inside `#toolbar` or any positioned ancestor. `#container-menu` is itself a direct `<body>` child — put `#kebab-menu` beside it.
   - Reusing `.cm-item` for styling is intentional (DD5 borrows the `.cm-*` look); the items still carry their own `role="menuitem"`/roving `tabindex`, so the structural divergence from the container menu (which has neither) is preserved.

3. **Register `els` entries** (`src/renderer/renderer.js`, in the `els` object `renderer.js:7-55`). The file is typecheck-gated (jsconfig `checkJs`), so the casts are required:
   ```js
   kebab: /** @type {HTMLButtonElement} */ (document.getElementById('kebab')),
   kebabMenu: /** @type {HTMLElement} */ (document.getElementById('kebab-menu')),
   ```

4. **Open/close** — toggle visibility + manage focus and roving tabindex (no innerHTML rebuild — items are static):
   ```js
   /** @returns {HTMLElement[]} */
   function kebabItems() {
     return /** @type {HTMLElement[]} */ ([...els.kebabMenu.querySelectorAll('[role="menuitem"]')]);
   }
   /** @param {HTMLElement[]} items @param {number} i */
   function focusItem(items, i) {
     const n = ((i % items.length) + items.length) % items.length; // wrap, handles negatives
     items.forEach((el, j) => (el.tabIndex = j === n ? 0 : -1));    // roving tabindex
     items[n].focus();
   }
   /** @param {number} [startIndex] index to focus on open (default 0; pass items.length-1 for last) */
   function openKebabMenu(startIndex = 0) {
     els.kebabMenu.classList.remove('hidden');
     positionKebabMenu();                         // anchor under the kebab button (step 6)
     els.kebab.setAttribute('aria-expanded', 'true');
     const items = kebabItems();
     focusItem(items, startIndex === -1 ? items.length - 1 : startIndex);
   }
   function closeKebabMenu() {
     els.kebabMenu.classList.add('hidden');
     els.kebab.setAttribute('aria-expanded', 'false');
   }
   ```

5. **Wire activation, keyboard + click** (mirror the `renderer.js:415-420` discipline; the ternary-as-statement form copies `:418` and is lint-safe):
   ```js
   // Activation: native click on the focused <button> menuitem fires these.
   els.kebabMenu.querySelector('#kebab-settings')?.addEventListener('click', () => {
     closeKebabMenu();
     // TODO(Flight 3+): open goldfinch://settings once the internal-page path exists
   });
   els.kebabMenu.querySelector('#kebab-exit')?.addEventListener('click', () => {
     closeKebabMenu();
     // TODO(leg 2 wire-exit): window.goldfinch.appQuit()
   });

   els.kebab.addEventListener('click', (e) => {
     e.stopPropagation();                          // don't let the global outside-close re-close it
     els.kebabMenu.classList.contains('hidden') ? openKebabMenu() : closeKebabMenu();
   });
   els.kebab.addEventListener('keydown', (e) => {
     if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
       e.preventDefault(); openKebabMenu(0);       // open → first item
     } else if (e.key === 'ArrowUp') {
       e.preventDefault(); openKebabMenu(-1);      // open → last item (APG menu-button)
     }
   });
   els.kebabMenu.addEventListener('keydown', (e) => {
     const items = kebabItems();
     const idx = items.indexOf(/** @type {HTMLElement} */ (document.activeElement));
     if (e.key === 'Escape') { e.preventDefault(); closeKebabMenu(); els.kebab.focus(); }
     else if (e.key === 'ArrowDown') { e.preventDefault(); focusItem(items, idx + 1); }
     else if (e.key === 'ArrowUp') { e.preventDefault(); focusItem(items, idx - 1); }
     else if (e.key === 'Home') { e.preventDefault(); focusItem(items, 0); }
     else if (e.key === 'End') { e.preventDefault(); focusItem(items, items.length - 1); }
   });
   document.addEventListener('click', () => closeKebabMenu());   // outside-click closes
   ```

6. **Position the popup under the kebab** — the container menu hardcodes `top:36px` under the *tabstrip* (`styles.css:981-986`), the wrong row for a toolbar control. Anchor `#kebab-menu` dynamically to the kebab button's rect (it sits near the toolbar's right edge):
   ```js
   function positionKebabMenu() {
     const r = els.kebab.getBoundingClientRect();
     els.kebabMenu.style.top = r.bottom + 4 + 'px';
     els.kebabMenu.style.right = (window.innerWidth - r.right) + 'px';
     els.kebabMenu.style.left = 'auto';
   }
   ```
   - This resolves in viewport coordinates **only because `#kebab-menu` is a body-level child** (step 2). Add a CSS rule for `#kebab-menu` reusing the container-menu chrome (background, border, radius, shadow, padding, min-width, `z-index`) — copy the visual block from `#container-menu` (`styles.css:981-993`) minus the tabstrip-specific `top`/`left` (set inline here). Right-align so it doesn't overflow the viewport (min window width is 900px per `main.js`).

7. **Do not touch** the container menu, `#tabs`, the tablist, or window controls. The kebab is additive.

## Edge Cases
- **Both menus open**: opening the kebab while the container menu is open (or vice versa) — the global `document` click handlers close both on outside clicks; acceptable that opening one doesn't force-close the other, but verify neither traps focus. (Low priority; note if it looks wrong.)
- **Viewport right edge**: right-anchoring keeps the menu on-screen; confirm it isn't clipped at narrow widths (min window width is 900px per `main.js`).
- **Roving tabindex correctness**: only one menuitem has `tabIndex=0` at a time; on close, the next open re-initializes focus to the first item.
- **Activation closing**: both items call `closeKebabMenu()` in their handler so the menu closes on selection.

## Files Affected
- `src/renderer/index.html` — add `#kebab` button (last `#toolbar` child) + `#kebab-menu` popup with two static `role="menuitem"` items, as a body-level sibling of `#container-menu`.
- `src/renderer/renderer.js` — `els.kebab` + `els.kebabMenu`; `openKebabMenu`/`closeKebabMenu`/`positionKebabMenu` + helpers; click/keydown wiring; outside-close.
- `src/renderer/styles.css` — `#kebab-menu` popup chrome (reuse `#container-menu` visual block).

---

## Post-Completion Checklist

**Do NOT commit (deferred-commit flight). Complete these, then signal `[HANDOFF:review-needed]`:**

- [ ] All acceptance criteria verified
- [ ] `npm run typecheck` / `npm run lint` / `npm test` pass
- [ ] Update flight-log.md with a leg progress entry
- [ ] Set this leg's status to `landed` (in this file's header)
- [ ] Do NOT check off the leg in flight.md yet, do NOT commit — the flight uses a single review + commit after the last autonomous leg

---

## Citation Audit

All source citations verified against current code at leg-design time (clean, no drift):
`index.html:42` (`#container-menu`), `index.html:60-65` (`#toggle-media`/`#toggle-privacy`),
`renderer.js:7-55` (`els`), `renderer.js:98-151` (container-menu pattern),
`renderer.js:415-420` (click wiring + `:417 "e.stopPropagation();"` + `:420` outside-close),
`styles.css:256-267` (global focus ring), `styles.css:277-284` (`#toolbar`),
`styles.css:285-300` (`.icon-btn`), `styles.css:981-1035` (`#container-menu` + `.cm-*`).
