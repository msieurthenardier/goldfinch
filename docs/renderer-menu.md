# Renderer menu controller (`src/renderer/menu-controller.js`)

One small state machine owns open/close, mutual-exclusion, outside-dismiss, and the
APG keyboard contract for every menu surface. Since the M05 Flight-8 cutover it is loaded
**only by the menu-overlay sheet document** (`src/renderer/menu-overlay.html`, via `<script>`
**before** `menu-overlay.js` — so `menuController`/`focusItem` are globals by the time the
sheet page registers its template entries at eval time). It is dual-exported (CommonJS for
the unit test, `globalThis` for the sheet page) the same way as `src/shared/keydown-action.js`
/ `src/shared/url-safety.js`. The module itself is unchanged by the F8 migration — it moved
consumers, not code.

> **Division of labor (F8).** The browser chrome (`renderer.js`) keeps only **trigger-side**
> concerns: trigger keydown/click → `menu-overlay:open` with a `startIndex`, `aria-expanded`
> bookkeeping, and reason-resolved focus-return (driven by the `menu-overlay-closed` channel).
> The controller's open/close/roving machinery runs **inside the sheet document** against the
> rendered menu node. Cross-view concerns the controller cannot see (mutual exclusion across
> opens, tab-lifecycle closes, app blur) are owned by main's `closeMenuOverlay(reason)` family
> — see CLAUDE.md's "Menu-overlay sheet" section.

## Consumers

The sheet page (`src/renderer/menu-overlay.js`) registers one controller entry per template
(all via `menuController.register({...})`, every one with **`trigger === menu`** — the sheet
has no in-document trigger buttons; opens are programmatic on `menu-overlay:init`):

- **`menu` template** (kebab ⋮, container ▾, page-context incl. toolbar-Unpin mode,
  tab-context — one shared entry) — has `items` (the rendered `role="menuitem"` buttons; separators/notes are
  excluded by the getter, so roving skips them for free).
- **`info-popup` template** (site-info 🔒) — **no `items`** (the roving contract no-ops); the
  template's own `keydown` handler covers Escape/Tab dismissal.
- **`input-dialog` template** (new-container dialog) — **no `items`**; the dialog owns its own
  Tab-cycle (input → Create → Cancel) and Escape handling.

## The `MenuEntry` shape

Declared as a global type in `src/renderer/renderer-globals.d.ts` (it lives there only —
the module references it ambiently, mirroring `AutomationActivity`). Fields:

| Field | Required | Meaning |
|-------|----------|---------|
| `trigger` | yes | The element the menu hangs off / its opener button. In the sheet document every entry passes the menu node itself (`trigger === menu`). |
| `menu` | yes | The popup element (the `role="menu"` / popup container). |
| `items?` | no | Getter returning the current `role="menuitem"` elements. Present → APG roving-tabindex is active; absent → the roving/arrow contract no-ops. |
| `onOpen?` | no | RAW show body: build items, show, position, set aria, focus. Receives the `startIndex` (`0` = first, `-1` = last). |
| `onClose?` | no | RAW hide body. **Not** the public `closeX` wrapper — see the recursion rule below. |
| `focusReturn?` | no | Overrides the default `trigger.focus()` on Escape/Tab. In the sheet, in-document focus return is moot (focus returns to the *chrome* via main's `focusChrome()` + the chrome's channel-7 refocus policy); the field remains part of the contract. |

## APG roving-tabindex contract

The controller wires two keydown handlers per registration:

- **Trigger keydown (menu-button opener).** Enter / Space / ArrowDown open to the first
  item (`onOpen(0)`); ArrowUp opens to the last (`onOpen(-1)`). `preventDefault` suppresses
  the synthetic click so the menu opens exactly once. *(Skipped for every sheet entry — see
  the `trigger === menu` constraint below; the equivalent trigger-side keydown lives in the
  chrome and arrives as `startIndex` on channel 1/3.)*
- **Menu keydown (roving navigation).** Escape/Tab close + return focus; ArrowDown/ArrowUp/
  Home/End move the roving tabindex via `focusItem(items, i)`, which wraps (handles negatives
  and overflow), sets `tabIndex` to `0` on the focused item and `-1` on the rest, and calls
  `.focus()`.

`focusItem` is a hoisted `function` declaration so the controller's runtime reference to it
is hoist-safe regardless of source order.

## The three accumulated constraints

1. **`trigger === menu` opener-skip.** When a consumer's trigger node *is* its menu node,
   the trigger-keydown opener is **not** wired. Otherwise the opener would fire on the menu's
   own Arrow/Enter keydowns and `closeAll()` it mid-navigation. Such consumers open
   programmatically. Post-F8 this is **every** sheet template entry (opens arrive over
   `menu-overlay:init`); it originated with the chrome-era page context menu.
2. **`!entry.items` roving no-op.** A popup consumer (the `info-popup` and `input-dialog`
   templates) registers without an `items` getter; the menu-keydown handler returns early at
   `if (!entry.items) return`, so the roving/arrow contract simply does nothing for it. The
   template supplies its own Escape/Tab dismissal in its own handler.
3. **`focusReturn?` vs default `trigger.focus()`.** On Escape/Tab the controller calls
   `entry.focusReturn()` when present, else `entry.trigger.focus()`. In the sheet document
   this moves focus only *within the sheet*; the user-visible focus return (to the chrome
   trigger / address bar) is the chrome's channel-7 reason-resolved policy plus main's
   `focusChrome()` — the controller's half is necessary but not the whole story.

## Mutual exclusion + outside-dismiss

- **Mutual exclusion.** `open(entry)` calls `closeAll()` first, so opening any menu dismisses
  whatever else was open in the sheet document. `current` exposes the open entry (or `null`).
  *(Cross-open mutual exclusion between menu types is main's model-replace — a single sheet
  can only ever show one template; the controller's `closeAll` covers the in-document half.)*
- **`pointerdown` outside-dismiss.** A global `document` `pointerdown` listener closes the
  open menu when the event target is outside both the menu and its trigger. In the sheet —
  which covers the full guest region — this is exactly the "outside click over the guest"
  dismissal: the click lands in the transparent sheet, the listener closes the menu, and the
  click is swallowed (never forwarded to the guest). Outside-dismiss does **not** restore
  focus to the trigger — only Escape/Tab do.
- **`blur` close-all.** A global `window` `blur` listener closes any open menu when OS focus
  leaves the sheet's webContents (app switch; real pointer clicks landing in the chrome or
  another view). Main's `mainWindow.on('blur')` → `closeMenuOverlay('blur')` backstops the
  window-level case; `closeMenuOverlay` is idempotent, so the double-fire is harmless.

Both global listeners attach at module load (in the sheet document). They are **moved**, not
copied, from the chrome-era wiring — they do not double-fire, and the chrome retains no
pointerdown/blur dismissal listeners.

**Reason attribution sits alongside, not inside.** The sheet page (`menu-overlay.js`) reports
each dismissal to main with a reason (`menu-overlay:dismissed {reason, token}`). Because the
controller's own listeners registered first and cannot be raced for a flavor, the page keeps a
module-scoped `lastStimulus` that **defaults to `'blur'`** and is stamped by **capture-phase**
`keydown`/`pointerdown` listeners (Escape/Tab → `'escape'`, in-sheet outside press →
`'outside-click'`; capture beats the controller's at-target handling), then reset to `'blur'`
after every send — so unattributed closes report the blur flavor by construction. The
controller knows nothing of this; do not fold attribution into it.

## The recursion rule — raw `onClose` vs the public `closeX` wrapper

Each consumer's public `closeX` wrapper delegates *back into* the controller
(`menuController.close(entry)` / `closeAll`). `onClose` must be the **raw hide body**, never
the public wrapper: the controller's `closeEntry` calls `entry.onClose?.()`, so wiring the
wrapper as `onClose` would recurse (`close → onClose → closeX → close → …`). The public
wrapper and the raw `onClose` are deliberately two distinct functions. **Never collapse them.**

## Tests

`test/unit/menu-controller.test.js` exercises the controller against fake entries (no jsdom,
no new dependency): mutual exclusion, `closeAll`/`current`, the trigger-keydown opener and its
`trigger === menu` skip (the sheet-template registration shape), the menu-keydown contract
(Escape/Tab close + focusReturn-or-trigger, the `!items` no-op), and the with-items roving
path (ArrowDown/ArrowUp/Home/End) through the real `focusItem`.
