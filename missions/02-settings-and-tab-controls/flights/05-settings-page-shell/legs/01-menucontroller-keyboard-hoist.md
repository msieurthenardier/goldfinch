# Leg: menucontroller-keyboard-hoist

**Status**: completed
**Flight**: [Settings Page Shell + Address-Bar Chips](../flight.md)

## Objective
Hoist the near-identical APG keyboard contract (menu keydown + trigger keydown) shared by the container
(`▾`) and kebab (`⋮`) menus into the shared `menuController`, so a third popup consumer (the upcoming
site-info popup) registers against one keyboard contract instead of re-duplicating it.

## Context
- **Flight-3 carry-forward debt (DD7).** The container menu (`renderer.js` container keydown block) and the
  kebab menu (`renderer.js` kebab keydown block) carry **near-identical** Escape/Tab/ArrowDown/ArrowUp/
  Home/End keydown handlers (~40 lines duplicated), and their **trigger** keydowns (container `▾` trigger,
  kebab `⋮` trigger) are likewise duplicated (Enter/Space/ArrowDown → open-to-first; ArrowUp → open-to-last).
  Only `focusItem` (`renderer.js:focusItem`) is already shared. Flight 3 Rec 1 deferred this hoist; this leg
  pays it now, while there are exactly **two** menu call sites to reconcile and before the popup makes three.
- **Why now / why first.** The site-info popup (leg 5) registers with `menuController`. DD7's Architect
  correction: the popup is **NOT a roving `role=menu`** and does **not** force this hoist — so this leg is
  **discretionary debt-paydown**, sequenced **first** so any destabilization of the passing menu/tab suites
  surfaces before the rest of the flight builds on the controller.
- **Scope guard.** This leg reconciles only the **two real menus**' keydown + trigger-keydown into a
  controller-level contract. It does NOT touch the popup (leg 5), does NOT change any menu's roles/ARIA, and
  does NOT change observable keyboard behavior — it is a pure internal refactor.

## Inputs
What exists before this leg runs:
- `src/renderer/renderer.js` with `menuController` IIFE (`register` / `open` / `close` / `closeAll` /
  `current`), the `MenuEntry` typedef, `focusItem(items, i)`, and the two menus' separate trigger-keydown
  and menu-keydown listeners (container + kebab), all as committed on the flight/4 tip.
- Passing behavior suites: `unified-tab-controls`, `tab-keyboard-operability`, `menu-dismissal`,
  `kebab-menu`.

## Outputs
What exists after this leg completes:
- A controller-level APG keyboard contract in `menuController`, parameterized per registered entry by an
  items-getter and a restore target (the trigger). The container and kebab menus consume it; their
  duplicated menu-keydown and trigger-keydown blocks are removed.
- Identical observable keyboard behavior; all four regression suites still pass.

## Acceptance Criteria
- [ ] The menu-keydown logic (Escape/Tab → close + restore focus to trigger; ArrowDown/ArrowUp → roving
  move via `focusItem` with wrap; Home/End → first/last) exists **once** in `menuController`, driven per
  entry, not duplicated per menu.
- [ ] The trigger-keydown logic (Enter/Space/ArrowDown → open to first item; ArrowUp → open to last item,
  with `preventDefault` suppressing the synthetic click) exists **once** in `menuController`, driven per
  entry.
- [ ] The `MenuEntry` typedef and `register(...)` call sites carry whatever the controller-level handlers
  need (an items-getter such as `items: () => HTMLElement[]`; the trigger already present serves as the
  restore target). No call site still attaches its own inline Escape/Tab/Arrow/Home/End menu-keydown or its
  own inline trigger Enter/Space/Arrow keydown.
- [ ] No change to any menu's roles, ARIA attributes, `aria-expanded` toggling, positioning, or item
  construction (`onOpen`/`onClose` bodies unchanged except where they must expose an items-getter).
- [ ] `unified-tab-controls`, `tab-keyboard-operability`, `menu-dismissal`, and `kebab-menu` behavior tests
  all still pass (the regression gate).
- [ ] `npm run typecheck`, `npm run lint`, and `npm test` (offline gates) are green.

## Verification Steps
- `npm run lint && npm run typecheck && npm test` — all green.
- With the app on `:9222` (`npm run dev:debug`), re-run the four named behavior suites via
  `scripts/cdp-driver.mjs` (NOT the `chrome-devtools` MCP) and confirm each passes unchanged:
  `unified-tab-controls`, `tab-keyboard-operability`, `menu-dismissal`, `kebab-menu`.
- Manual keyboard spot-check of both menus: Tab to `▾` / `⋮` trigger → Enter opens to first item, ArrowUp
  opens to last; inside the menu ArrowDown/Up wrap, Home/End jump, Escape/Tab close and return focus to the
  trigger.
- `git diff --stat` shows a **net line reduction** in `renderer.js` (duplication removed), confined to the
  menu/controller region.

## Implementation Guidance

1. **Extend `register(...)` to attach the listeners (recommended shape).** `register` today only pushes to
   `entries` and returns the entry. Extend it to also attach the controller-level keydown listeners **per
   entry** — a `menu`-element keydown and a `trigger`-element keydown. **Attach per-`menu`/`trigger`
   element, NOT a single document-level handler** — it mirrors today's structure, keeps keydown scoped to
   the open menu, and has the narrowest blast radius against the `menu-dismissal` pointerdown/blur contract
   (which stays exactly as-is). Doing the attach inside `register` (rather than at each call site) is the
   clean "setup" step the design intends.

2. **Add the controller-level menu-keydown.** Given the entry, read its items via the entry's items-getter
   (`entry.items()`), find the active index, and implement Escape/Tab (close + `entry.trigger.focus()`),
   ArrowDown/ArrowUp (`focusItem(items, idx±1)`), Home/End (`focusItem(items, 0|len-1)`), each with
   `preventDefault`. **Guard `if (!items.length) return;`** before calling `focusItem` (the wrap formula
   `NaN`s on an empty list — cheap safety net even though an open menu always has items).
   - **`focusItem` is reachable by closure** from inside the IIFE because it is a hoisted `function`
     declaration. Do NOT convert `focusItem` to a `const` (that would break the hoist), and do not call it
     at IIFE parse time — only from inside the keydown handler, which runs after load.

3. **Add the controller-level trigger-keydown.** Attach an Enter/Space/ArrowDown → `open(entry, 0)` and
   ArrowUp → `open(entry, -1)` handler to each entry's `trigger`, with `preventDefault` to suppress the
   synthetic click (preserving "opens exactly once").

4. **Extend `MenuEntry`.** Add an **optional** items-getter field (`items?: () => HTMLElement[]`) to the
   typedef and to both menu `register({...})` calls. **Pass the function reference, not its result** —
   `items: containerItems` and `items: kebabItems`, NOT `items: containerItems()` (calling at register time
   captures an empty/closed-menu array). The controller keydown must **guard `if (!entry.items) return;`**
   so a non-menu consumer (leg 5's site-info popup) can `register` without an items-getter and the
   roving/arrow contract simply no-ops for it — forward-compat that avoids revisiting the typedef in leg 5.
   The `trigger` field already present is the restore target.

5. **Delete the duplicated inline blocks.** Remove the container menu-keydown listener, the container `▾`
   trigger-keydown listener, the kebab menu-keydown listener, and the kebab `⋮` trigger-keydown listener now
   that the controller owns them. Leave the kebab `click` toggle (`els.kebab` click) and all `onOpen`/
   `onClose` bodies intact.

6. **Preserve the wrappers.** `closeContainerMenu` / `closeKebabMenu` stay as the distinct thin public
   wrappers (do not collapse them into `onClose` — that recurses, per the existing comments).

## Edge Cases
- **Container items are rebuilt every open** (the menu's `innerHTML` is regenerated in `onOpen`), so the
  items-getter MUST query live (`containerItems()` re-queries the DOM) — do not cache an items array at
  register time.
- **`focusItem` wrap on negatives** is already handled (`((i % n) + n) % n`); reuse it, don't reimplement.
- **Mutual-exclusion / outside-dismiss / window-blur** are already controller-owned (pointerdown + blur
  listeners) — do NOT duplicate or move them; this leg only adds the keydown contract.
- **Kebab `click` toggle** must keep toggling off the controller's `current` (single source of truth), not a
  DOM class.

## Files Affected
- `src/renderer/renderer.js` — hoist menu-keydown + trigger-keydown into `menuController`; extend
  `MenuEntry` typedef + both `register` calls with an items-getter; delete the four duplicated inline
  keydown listeners.

## Adaptation (DD7 — discretionary)
If the hoist destabilizes any of the four regression suites **beyond a clean reconcile** (i.e. behavior
changes, not just a flaky run), **abandon the hoist** and keep the menus' keydown local as today. The
flight does not depend on this leg: the leg-5 popup ships with its own minimal local keydown regardless.
Record the decision (hoist landed / hoist dropped) in the flight log either way.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:** *(commit is deferred to the flight-level review
pass — this leg lands `landed`, not `completed`)*

- [ ] All acceptance criteria verified
- [ ] Tests passing (offline gates + the four regression suites)
- [ ] Update flight-log.md with leg progress entry (including hoist-landed vs hoist-dropped decision)
- [ ] Set this leg's status to `landed` (commit deferred to flight review)
- [ ] Do NOT commit; do NOT signal `[HANDOFF:review-needed]` (flight-level review batches all legs)
