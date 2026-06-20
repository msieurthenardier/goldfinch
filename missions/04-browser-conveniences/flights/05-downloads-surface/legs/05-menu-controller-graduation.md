# Leg: menu-controller-graduation

**Status**: completed
**Flight**: [Downloads Surface](../flight.md)

## Objective

Graduate the in-`renderer.js` `menuController` IIFE (+ its roving-tabindex helper `focusItem` and its global
`pointerdown`/`blur` outside-dismiss listeners) into a standalone **`src/renderer/menu-controller.js`**
module, loaded via `<script>` alongside `keydown-action.js`/`url-safety.js` (the dual CJS/global export
pattern), document its APG contract + the accumulated consumer-specific constraints, add a **unit test** of
its state machine + keyboard contract (now possible as a separable module), and **regress all consumers**
(container picker, kebab — now with Downloads — site-info popup, page-context menu incl. toolbar Unpin).

## Context

- **DD8** — the Flight-4 debrief named `menuController` graduation overdue (4 consumers, accumulated
  workarounds: the additive `focusReturn?` option, the `trigger === menu` opener-skip, the `!entry.items`
  roving no-op for popup consumers, plus the inter-consumer `pageCtx` state). This flight adds a **5th
  consumer surface** (the kebab Downloads item, leg 3) and the controller is load-bearing with undocumented
  constraints — the extraction is timely here.
- This is a **maintenance refactor with no functional tie to downloads** — clearly labelled, behavior-
  preserving. The flight notes it is "the cleanest leg to defer to Flight 6 if the flight runs hot"; the
  flight is **not** running hot (legs 1–4 landed green), so it proceeds.
- **Behavior-preserving**: the code moves verbatim; consumers keep calling `menuController.*`/`focusItem`
  exactly as today. The only structural change is *where the code lives* and *how the symbols are reached*
  (file-scope → script-loaded globals, mirroring `keydownToAction`/`isInternalPageUrl`).

## Inputs

What exists before this leg runs (all in `src/renderer/renderer.js`):
- `:117`-`:126` the `MenuEntry` typedef.
- `:128`-`:221` the `menuController` IIFE — `entries`/`open` state, `openEntry`/`closeEntry`/`closeAll`/
  `register`/`current`. The `register` body wires: the trigger keydown opener (skipped when `entry.trigger
  === entry.menu`, `:157`), and the menu keydown APG contract (`!entry.items` no-op `:174`; Escape/Tab with
  `focusReturn?`-or-`trigger.focus()` `:176`-`:188`; Arrow/Home/End roving via `focusItem` `:190`-`:206`).
- `:230`-`:236` the global `pointerdown` outside-dismiss; `:239` the `window` `blur` close-all.
- `:340`-`:344` `focusItem(items, i)` — the roving-tabindex helper (wrap math + `tabIndex`/`focus`), called
  **both** inside the controller (`:196`-`:205`) **and** by three consumers (container `:308`, kebab `:364`,
  page-context `:718`).
- **Consumers (the regression set), all `menuController.register({...})`:**
  - `:265` `containerEntry` (trigger `els.newTabMenu`, has `items`).
  - `:354` `kebabEntry` (trigger `els.kebab`, has `items`; now includes the leg-3 Downloads item) + toggle
    `:402`-`:403`.
  - `:467` `siteInfoEntry` (the **no-`items`** popup — exercises the `!entry.items` no-op; trigger
    `els.addressChip`) + toggle `:491`-`:492`.
  - `:694` `pageContextEntry` (the custom page context menu; has `items` + `focusReturn`; `trigger ===
    menu`-style programmatic open). Opened from `:764` (context-menu IPC), `:800`/`:819`/`:851` (incl. the
    **toolbar Unpin** path migrated in Flight 4).
  - `:1288`-`:1289` container toggle.
- `src/renderer/index.html:213`-`:215` — script loads: `url-safety.js`, `keydown-action.js`, `renderer.js`
  (in that order). `menu-controller.js` inserts **before `renderer.js`**.
- `src/shared/keydown-action.js` / `src/shared/url-safety.js` — the **dual-export template** (CJS for
  tests + `globalThis.X` for the renderer): the tail `if (typeof module !== 'undefined' && module.exports)
  { module.exports = {...} } else { globalThis.X = X }`.
- `src/renderer/renderer-globals.d.ts` — the renderer global typedefs (legs 2/3 extended it); needs
  `menuController` + `focusItem` (+ `MenuEntry`) declared so `renderer.js` typechecks against the now-external
  globals.
- No existing `menu-controller` unit test; `renderer.js` itself is not unit-tested (needs DOM/Electron).

## Outputs

What exists after this leg completes:
- **`src/renderer/menu-controller.js`** (new) — `menuController`, `focusItem`, the `MenuEntry` typedef, and
  the global `pointerdown`/`blur` outside-dismiss listeners; dual CJS/global export.
- **`src/renderer/renderer.js`** — the IIFE / `focusItem` / listeners **removed**; consumers unchanged,
  now calling the script-loaded globals.
- **`src/renderer/index.html`** — `<script src="menu-controller.js">` before `renderer.js`.
- **`src/renderer/renderer-globals.d.ts`** — `menuController`/`focusItem`/`MenuEntry` declarations.
- **`docs/renderer-menu.md`** (new) — the APG contract + constraints documentation (with a one-line pointer
  added to CLAUDE.md's renderer section).
- **`test/unit/menu-controller.test.js`** (new) — state-machine + keyboard-contract tests via fake entries.

## Acceptance Criteria

- [ ] **Module extracted**: `src/renderer/menu-controller.js` exists and contains the `menuController`
  controller, `focusItem`, and the `pointerdown`/`blur` listeners, **moved verbatim** (no behavior change).
  It uses the dual-export tail: CJS `module.exports = { menuController, focusItem }` for tests +
  `globalThis.menuController = …; globalThis.focusItem = …` for the renderer. **`focusItem` stays a hoisted
  `function` declaration** (not reordered into a `const`) so the controller's runtime reference to it
  remains hoist-safe.
- [ ] **`MenuEntry` type lives ONLY in the d.ts** (the proven `AutomationActivity` pattern — no in-repo
  precedent for a `@typedef` inside a dual-export shared module): declare `MenuEntry` in
  `renderer-globals.d.ts` and have `menu-controller.js` reference it as an ambient global type. Do **not**
  carry a local `@typedef MenuEntry` in `menu-controller.js` (avoids a duplicate-identifier risk). Confirm
  `npm run typecheck` is clean.
- [ ] **Loaded before renderer**: `index.html` loads `menu-controller.js` after `keydown-action.js` and
  **before `renderer.js`**, so the globals exist when `renderer.js` registers its entries at eval time.
- [ ] **renderer.js cleaned**: the IIFE, `focusItem`, the `MenuEntry` typedef, and the two global listeners
  are removed from `renderer.js`; all consumer `register`/`open`/`close`/`closeAll`/`current`/`focusItem`
  call sites resolve to the globals and are otherwise unchanged.
- [ ] **All consumers regress green** (behavior-preserving): kebab (open/arrow-nav/Escape/Tab/outside-
  dismiss/mutual-exclusion, incl. the Downloads item), container picker, site-info popup (no-`items` no-op
  path), page-context menu + toolbar Unpin (programmatic open, `focusReturn`). Verified via `npm run a11y`
  (the menus are in the chrome sweep) + manual smoke (the menus aren't in the unit harness).
- [ ] **Documented**: `docs/renderer-menu.md` describes the APG roving-tabindex contract, the `focusReturn?`
  option (page-context menu, no persistent trigger), the `trigger === menu` opener-skip (programmatic-open
  consumers), the `!entry.items` roving no-op (popup consumers like site-info), and the global
  `pointerdown`/`blur` outside-dismiss semantics. CLAUDE.md's renderer section gets a one-line pointer to it.
- [ ] **Unit test**: `test/unit/menu-controller.test.js` exercises the controller via **fake entries**
  (objects with `addEventListener`-capturing `trigger`/`menu` stubs + `onOpen`/`onClose` spies), covering:
  mutual exclusion (opening B closes A), `closeAll`/`current`, the trigger-keydown opener (Enter/Space/
  ArrowDown→0, ArrowUp→-1) and its `trigger === menu` skip, and the menu-keydown contract (Escape/Tab →
  close + `focusReturn`-or-`trigger.focus()`; the `!entry.items` no-op). No real DOM / no jsdom / no new
  dependency.
- [ ] `node --test test/unit/*.test.js` passes (incl. the new test); `npm run typecheck` + `npm run lint`
  clean; `npm run a11y` 0 new violations.

## Verification Steps

- `node --test test/unit/menu-controller.test.js` — the state-machine + keyboard-contract assertions.
- `node --test test/unit/*.test.js` && `npm run typecheck` && `npm run lint` — all clean.
- `npm run a11y` — 0 new violations (menus exercised in the chrome sweep).
- `git diff --stat` — `renderer.js` shrinks by ~the moved block; `menu-controller.js` gains it; no net
  logic change in the consumers.
- Manual smoke (`npm run dev`): each menu opens/closes, arrow-navigates, Escape/Tab restores focus,
  clicking outside dismisses, opening one closes another; the page-context menu opens on right-click and
  Escape returns focus to the page; the toolbar Unpin works; the kebab Downloads item is reachable.

## Implementation Guidance

1. **Create `src/renderer/menu-controller.js`.** Move, verbatim:
   - the `menuController` IIFE (`:128`-`:221`),
   - `focusItem` (`:340`-`:344`) — keep as a `function` declaration (hoist-safe),
   - the `pointerdown` (`:230`-`:236`) and `blur` (`:239`) listeners.
   The `MenuEntry` `@typedef` (`renderer.js:117`-`:126`) is **NOT** moved into this module — it becomes a
   global type declared in `renderer-globals.d.ts` (step 4), referenced ambiently here. (Delete it from
   `renderer.js`.)
   Resolve the **coupling**: `focusItem` is referenced inside the controller's menu-keydown handler — moving
   both into this module removes the cross-file forward reference entirely (today it works only because both
   are file-scope in one classic script). Add the dual-export tail:
   ```js
   if (typeof module !== 'undefined' && module.exports) {
     module.exports = { menuController, focusItem };
   } else {
     /** @type {any} */ (globalThis).menuController = menuController;
     /** @type {any} */ (globalThis).focusItem = focusItem;
   }
   ```
   Keep `// @ts-check` and `'use strict'`. The two global listeners attach at script load — same timing as
   today (renderer.js attached them at its own eval). Order is safe: this script loads before renderer.js,
   and the listeners reference `menuController` (in-module) + `document`/`window` (always available).
2. **Trim `renderer.js`.** Delete the moved blocks. Leave **every consumer untouched** — `containerEntry`,
   `kebabEntry`, `siteInfoEntry`, `pageContextEntry`, the toggles (`:402`, `:491`, `:1288`), and the
   `focusItem` calls in the three `onOpen`s (`:308`, `:364`, `:718`) now resolve to the globals. Confirm no
   other `renderer.js` symbol depended on being in the same scope as the controller (it doesn't — consumers
   only use the public API + `focusItem`).
3. **`index.html`.** Add `<script src="menu-controller.js"></script>` between `keydown-action.js` (`:214`)
   and `renderer.js` (`:215`). (Same dir as `renderer.js`, so `src="menu-controller.js"`.)
4. **`renderer-globals.d.ts`.** `renderer.js` is typechecked via `checkJs:true` over `src/**` (NOT via a
   `// @ts-check` directive — don't add one), so the now-external symbols need ambient declarations: declare
   `menuController` (with the `register`/`open`/`close`/`closeAll`/`current` shape), `focusItem(items, i)`,
   and the `MenuEntry` type — the type lives **here only** (the `AutomationActivity` precedent in this file).
   Mirror how `keydownToAction`/`isInternalPageUrl`/`AutomationActivity` are declared.
5. **`docs/renderer-menu.md`.** Write the contract doc: the menu-button APG pattern; roving tabindex
   (`focusItem`); the `MenuEntry` fields and which are optional (`items?`, `onOpen?`, `onClose?`,
   `focusReturn?`); the three accumulated constraints (`trigger === menu` opener-skip; `!entry.items` roving
   no-op; `focusReturn?` vs default `trigger.focus()`); mutual-exclusion + outside-dismiss (`pointerdown`/
   `blur`); the "raw `onClose` vs public `closeX` wrapper — never collapse them (recursion)" rule. Add a
   one-line pointer in CLAUDE.md's renderer section ("Shared menu controller: see `docs/renderer-menu.md`").
6. **`test/unit/menu-controller.test.js`.** Require the CJS export. Build a `makeFakeEntry()` helper whose
   `trigger`/`menu` are plain objects with `addEventListener: (type, fn) => capture[type] = fn`, `contains`,
   and `focus` spy, and `onOpen`/`onClose`/`focusReturn` as recording spies. Register fakes and assert:
   - `open(A); open(B)` ⇒ A.onClose called, B.onOpen called, `current === B`.
   - `closeAll()` ⇒ current.onClose called, `current === null`.
   - trigger-keydown opener: dispatch the captured `keydown` with `{key:'ArrowDown'}` ⇒ onOpen(0);
     `{key:'ArrowUp'}` ⇒ onOpen(-1); and a fake with `trigger === menu` ⇒ **no** opener wired.
   - menu-keydown: `{key:'Escape'}` ⇒ onClose + (focusReturn if present else trigger.focus); `{key:'Tab'}`
     likewise; a no-`items` entry's menu-keydown ⇒ no throw, no roving.
   - the **with-`items` roving** path (`ArrowDown`/`Home`/`End`) calls real `focusItem`, which does
     `items[n].focus()` + sets `tabIndex` — so `entry.items()` fakes must be objects with a `focus` spy and
     a writable `tabIndex`, and the keydown fake needs `document.activeElement` resolvable (assert
     `focusItem` selected the expected index via the `.focus` spy).
   (DOM-dependent bits like real `.focus()`/`tabIndex` are covered by the spies — same electron-free spirit
   as `keydown-action.test.js`.)

## Edge Cases

- **Load order**: if `menu-controller.js` loaded *after* `renderer.js`, the consumer `register` calls (run
  at renderer eval) would hit an undefined global — hence the strict before-`renderer.js` placement. Verify
  the `index.html` order.
- **`focusItem` used by consumers**: the three `onOpen`s call the global `focusItem`; since it's exported
  on `globalThis` from the earlier-loaded script, they resolve at call time (runtime, after open). Fine.
- **Double-attached global listeners**: ensure the `pointerdown`/`blur` listeners are moved (not copied) —
  leaving copies in `renderer.js` would double-fire `closeAll`. (Idempotent, but sloppy.)
- **`MenuEntry` typedef references**: if any other `renderer.js` JSDoc references `MenuEntry`, it now comes
  from the d.ts global type — confirm typecheck resolves it.
- **No behavior change is the bar**: if a consumer's behavior shifts at all (focus order, dismissal), the
  extraction introduced a bug — diff the moved code character-for-character.

## Files Affected

- `src/renderer/menu-controller.js` — **new** (extracted controller + `focusItem` + listeners + dual export).
- `src/renderer/renderer.js` — moved blocks + the `MenuEntry` `@typedef` removed; consumers unchanged.
- `src/renderer/index.html` — `<script>` for `menu-controller.js` before `renderer.js`.
- `src/renderer/renderer-globals.d.ts` — `menuController`/`focusItem` globals + the `MenuEntry` type (here
  only).
- `docs/renderer-menu.md` — **new** contract doc; one-line pointer added to CLAUDE.md renderer section.
- `test/unit/menu-controller.test.js` — **new** state-machine + keyboard-contract tests.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (`node --test test/unit/*.test.js`, `npm run typecheck`, `npm run lint`)
- [ ] `npm run a11y` — 0 new violations
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight: (N/A — leg 5 of 6)
- [ ] Commit deferred per `/agentic-workflow` (flight-level review + commit after the last autonomous leg)

---

## Citation Audit

All citations verified clean against current code at leg design time (read directly this session):
`renderer.js:117`-`:126` (`MenuEntry` typedef), `:128`-`:221` (`menuController` IIFE), `:157` (`trigger ===
menu` skip), `:174` (`!entry.items` no-op), `:176`-`:188` (Escape/Tab + `focusReturn`), `:190`-`:206`
(roving via `focusItem`), `:230`-`:236` (`pointerdown`), `:239` (`blur`), `:340`-`:344` (`focusItem`); the
consumer `register` sites `:265` (container), `:354` (kebab), `:467` (site-info, no-`items`), `:694`
(page-context) + the toolbar-Unpin opens at `:800`/`:819`/`:851`, toggles `:402`/`:491`/`:1288`; the
`focusItem` consumer calls `:308`/`:364`/`:718`; `index.html:213`-`:215` (script load order). The dual-export
template is `src/shared/keydown-action.js` / `url-safety.js`. The leg-3 kebab Downloads item is a landed
deliverable (the 5th-consumer-surface trigger for this graduation).
