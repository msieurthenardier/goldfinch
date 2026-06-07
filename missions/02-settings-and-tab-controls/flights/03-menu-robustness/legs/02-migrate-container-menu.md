# Leg: migrate-container-menu

**Status**: completed
**Flight**: [Menu Dismissal & Shared APG Helper](../flight.md)

## Objective

Lift the container (`▾`) menu to the kebab's APG level — `role="menu"`/`menuitem`, roving tabindex, and full Arrow/Home/End/Tab keyboard navigation — reusing the shared `focusItem` helper, while preserving every existing container behavior. (Dismissal + mutual-exclusion already landed in leg 1.)

## Context

- **DD3** — the container menu is registered with the controller (leg 1) for open/close/dismissal/
  mutual-exclusion but still has only an **Escape** keydown and **no roles/roving**. This leg adds the
  APG keyboard parity. **APG uplift only** — leg 1 already removed the cross-calls + dual listeners, so
  this leg does NOT re-remove anything.
- **`.cm-title` must not break `role="menu"` (Architect)** — once `#container-menu` is `role="menu"`,
  its non-item header `<div class="cm-title">` (`renderer.js:178`) trips axe `aria-required-children`
  unless it carries `role="presentation"`. Apply `role="menuitem"` + roving **only to `.cm-item`**.
- **Reuse the shared `focusItem` helper** (`renderer.js:249`) — it's generic over an items array; the
  container just supplies its own `[role="menuitem"]` list (mirror `kebabItems()` at `:245`).
- **Mirror the kebab's keyboard** (`renderer.js:263-330`): trigger opens to first (Enter/Space/
  ArrowDown) or last (ArrowUp); menu keydown does ArrowDown/Up (wrap) + Home/End + Escape + Tab, all
  restoring focus to the trigger on Escape/Tab.

## Inputs

What exists before this leg (after leg 1):
- `src/renderer/renderer.js` — `containerEntry` (`renderer.js:173-214`): `onOpen` builds dynamic items
  (jars + Burner + "＋ New container…"), shows, inline-left anchor, aria-expanded, focuses first
  `.cm-item`; `onClose` raw hide. The container keydown is **Escape-only** (`:221-226`). The shared
  `focusItem(items, i)` (`:249`) and the kebab's keyboard pattern (`:263-330`) to mirror.
- `src/renderer/index.html` — `#container-menu` (currently **no `role`**); `#new-tab-menu`
  (`aria-haspopup="menu"`, `aria-expanded` toggled by the controller).
- `src/renderer/styles.css` — `.cm-*` styling (unchanged; `:focus-visible` ring already covers
  `.cm-item`).

## Outputs

- `#container-menu` is `role="menu"`; its `.cm-item`s are `role="menuitem"` with roving tabindex; the
  `.cm-title` is `role="presentation"`.
- Container menu has full APG keyboard nav (Arrow/Home/End/Tab) + the ▾ trigger opens to first/last;
  Escape/Tab restore focus to `#new-tab-menu`.
- All existing container behavior preserved (dynamic items, jar dots, Burner, New-container prompt,
  createTab-on-select, dismissal, mutual-exclusion, anchor).
- `npm run typecheck`/`lint`/`test` green; `npm run a11y` shows no new violations from the uplift.

## Acceptance Criteria
- [ ] `#container-menu` carries `role="menu"` (with an `aria-label`); each `.cm-item` button is
  `role="menuitem"` with roving tabindex (exactly one `tabindex="0"` at a time); the `.cm-title` header
  is `role="presentation"` (so axe `aria-required-children` does NOT fire).
- [ ] Container APG keyboard works: opening focuses the first item; `ArrowDown`/`ArrowUp` move between
  items (wrap); `Home`/`End` jump to first/last; `Escape` closes + restores focus to `#new-tab-menu`;
  `Tab`/`Shift+Tab` close + restore focus to `#new-tab-menu`.
- [ ] The `▾` trigger (`#new-tab-menu`) opens the menu to the **first** item on `Enter`/`Space`/
  `ArrowDown` and to the **last** item on `ArrowUp` (mirroring the kebab trigger). `Enter`/`Space` open
  it **exactly once** (the `preventDefault` suppresses the synthetic click — no toggle-closed).
- [ ] The shared `focusItem` helper is reused (not a duplicate roving implementation).
- [ ] **All existing container behavior preserved**: dynamic jar items + colored dots, Burner tab,
  "＋ New container…" (`window.prompt` → create + open), createTab-on-select, mutual-exclusion +
  outside/blur dismissal (from leg 1), inline-left anchor.
- [ ] `npm run typecheck` → 0; `npm run lint` → 0; `npm test` → all pass.

## Verification Steps
- `npm run typecheck` / `npm run lint` / `npm test` — all green.
- Code read: `#container-menu` `role="menu"`; `.cm-item` get `role="menuitem"` + roving in the builder;
  `.cm-title` `role="presentation"`; container keydown mirrors the kebab; `focusItem` reused.
- Live a11y + APG + preserved-behavior verification is the `verify-integration` leg
  (`menu-dismissal` Steps 7–8 + `unified-tab-controls` regression + `npm run a11y`).

## Implementation Guidance

1. **`role="menu"` on the popup** (`src/renderer/index.html`) — add `role="menu"` and
   `aria-label="Open new tab in a container"` to `#container-menu` (static element). (Or set in
   `onOpen`; the static attr is cleaner.)

2. **Roles/roving in the builder** (`containerEntry.onOpen`, `renderer.js:176-209`):
   - Title: build it as `<div class="cm-title" role="presentation">Open new tab in…</div>`.
   - Each `.cm-item` button (jars, Burner, add): set `b.setAttribute('role', 'menuitem')`.
   - After all items are appended, apply roving tabindex via the shared helper:
     ```js
     const items = containerItems();
     focusItem(items, startIndex === -1 ? items.length - 1 : startIndex);
     ```
     where `containerItems()` mirrors `kebabItems()` **including the typecheck cast** (or `tsc` flags
     the `focusItem` calls, since `focusItem` is `@param {HTMLElement[]}`):
     ```js
     /** @returns {HTMLElement[]} */
     function containerItems() {
       return /** @type {HTMLElement[]} */ ([...els.containerMenu.querySelectorAll('[role="menuitem"]')]);
     }
     ```
     This replaces the current `first.focus()` (`:207-208`) — `focusItem` sets roving (`0`/`-1`) AND focuses.
   - Give `onOpen` a `startIndex = 0` param (like `openKebabMenu`) so the trigger can open to last.

3. **Container menu keydown** (replace the Escape-only handler at `renderer.js:221-226` with the full
   APG set, mirroring the kebab menu keydown at `:309-330`):
   ```js
   els.containerMenu.addEventListener('keydown', (e) => {
     const items = containerItems();
     const idx = items.indexOf(/** @type {HTMLElement} */ (document.activeElement));
     if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); closeContainerMenu(); els.newTabMenu.focus(); }
     else if (e.key === 'ArrowDown') { e.preventDefault(); focusItem(items, idx + 1); }
     else if (e.key === 'ArrowUp') { e.preventDefault(); focusItem(items, idx - 1); }
     else if (e.key === 'Home') { e.preventDefault(); focusItem(items, 0); }
     else if (e.key === 'End') { e.preventDefault(); focusItem(items, items.length - 1); }
   });
   ```

4. **▾ trigger keydown** (add to `#new-tab-menu`, mirroring the kebab trigger at `:300-308`):
   ```js
   els.newTabMenu.addEventListener('keydown', (e) => {
     if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') { e.preventDefault(); menuController.open(containerEntry, 0); }
     else if (e.key === 'ArrowUp') { e.preventDefault(); menuController.open(containerEntry, -1); }
   });
   ```
   - **Resolved (design review): mirror the kebab exactly — keep Enter/Space here with `preventDefault`.**
     `#new-tab-menu` is a native `<button>` whose click handler toggles (`renderer.js:599-600`), identical
     to the kebab (`:294-298`). The kebab demonstrably opens on Enter/Space *without* toggling closed, so
     `preventDefault` reliably suppresses the synthetic click in this build — no double-open. Do NOT scope
     to Arrow-keys-only; keep the two triggers identical.

5. **CLAUDE.md** — add a one-line note on the shared `menuController` (both menus register; owns
   open/close/dismissal/mutual-exclusion/APG keyboard) if it fits the renderer architecture section.

6. **Run gates** + a quick `npm run a11y` sanity if the app is up (the verify leg does the formal pass).

## Edge Cases
- **Dynamic rebuild**: items are rebuilt every open, so roles/roving must be applied in `onOpen` after
  the build (not once at startup).
- **`.cm-item.add` ("New container…")**: it's a menuitem; activating it runs `window.prompt` then
  closes the menu + creates a tab — preserved.
- **Enter/Space double-open**: a native button fires `click` on Enter/Space; ensure the new trigger
  keydown doesn't *also* open a second time (scope trigger keydown to Arrow keys if the click path
  already handles Enter/Space — verify).
- **`focusItem` on an empty list**: there's always ≥1 item (Burner + add are always present), so no
  divide-by-zero in the wrap math.

## Files Affected
- `src/renderer/index.html` — `role="menu"` + `aria-label` on `#container-menu`.
- `src/renderer/renderer.js` — `containerItems()`; roles/roving in the builder; `role=presentation` on
  the title; full APG container keydown; ▾ trigger keydown; `onOpen` `startIndex`.
- `CLAUDE.md` *(optional)* — shared `menuController` note.

---

## Post-Completion Checklist

**Do NOT commit (deferred-commit flight). Then signal `[HANDOFF:review-needed]`:**
- [ ] All acceptance criteria verified; offline gates green
- [ ] Update flight-log.md with a leg progress entry
- [ ] Set this leg's status to `landed`
- [ ] Do NOT check off the leg in flight.md, do NOT commit — single review + commit after the last autonomous leg

---

## Citation Audit

Verified against current code (post-leg-1, flight branch) at leg-design time: `renderer.js:173-214`
(`containerEntry` + builder), `:221-226` (container Escape-only keydown), `:245-262` (`kebabItems` +
`focusItem`), `:263-330` (kebab entry + keyboard pattern to mirror), `:178` (`.cm-title`); `index.html`
`#container-menu` (no role yet) / `#new-tab-menu` (`aria-haspopup="menu"`).
