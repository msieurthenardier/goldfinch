# Renderer menu controller (`src/renderer/menu-controller.js`)

One small state machine owns open/close, mutual-exclusion, outside-dismiss, and the
APG keyboard contract for every dropdown/popup menu in the browser chrome. It is loaded
via `<script>` **before** `renderer.js` (so `menuController`/`focusItem` are globals by the
time `renderer.js` registers its entries at eval time) and dual-exported (CommonJS for the
unit test, `globalThis` for the renderer) the same way as `src/shared/keydown-action.js` /
`src/shared/url-safety.js`.

## Consumers

Five surfaces register with the controller (all via `menuController.register({...})`):

- **Container picker** (`▾` new-tab menu) — has `items`.
- **Kebab overflow** (`⋮`, Settings, Downloads, Print…, Exit) — has `items`.
- **Site-info popup** (address-chip) — **no `items`** (the roving contract no-ops).
- **Page context menu** (right-click web content; also toolbar-Unpin mode) — has `items`
  **and** `focusReturn`, opened **programmatically** (`trigger === menu`).

## The `MenuEntry` shape

Declared as a global type in `src/renderer/renderer-globals.d.ts` (it lives there only —
the module references it ambiently, mirroring `AutomationActivity`). Fields:

| Field | Required | Meaning |
|-------|----------|---------|
| `trigger` | yes | The element the menu hangs off / its opener button. |
| `menu` | yes | The popup element (the `role="menu"` / popup container). |
| `items?` | no | Getter returning the current `role="menuitem"` elements. Present → APG roving-tabindex is active; absent → the roving/arrow contract no-ops. |
| `onOpen?` | no | RAW show body: build items, show, position, set aria, focus. Receives the `startIndex` (`0` = first, `-1` = last). |
| `onClose?` | no | RAW hide body. **Not** the public `closeX` wrapper — see the recursion rule below. |
| `focusReturn?` | no | Overrides the default `trigger.focus()` on Escape/Tab (for menus with no persistent trigger button). |

## APG roving-tabindex contract

The controller wires two keydown handlers per registration:

- **Trigger keydown (menu-button opener).** Enter / Space / ArrowDown open to the first
  item (`onOpen(0)`); ArrowUp opens to the last (`onOpen(-1)`). `preventDefault` suppresses
  the synthetic click so the menu opens exactly once.
- **Menu keydown (roving navigation).** Escape/Tab close + return focus; ArrowDown/ArrowUp/
  Home/End move the roving tabindex via `focusItem(items, i)`, which wraps (handles negatives
  and overflow), sets `tabIndex` to `0` on the focused item and `-1` on the rest, and calls
  `.focus()`.

`focusItem` is a hoisted `function` declaration so the controller's runtime reference to it
is hoist-safe regardless of source order.

## The three accumulated constraints

1. **`trigger === menu` opener-skip.** When a consumer's trigger node *is* its menu node
   (the page context menu — its own trigger, no separate menu-button), the trigger-keydown
   opener is **not** wired. Otherwise the opener would fire on the menu's own Arrow/Enter
   keydowns and `closeAll()` it mid-navigation. Such consumers open programmatically
   (right-click / Shift+F10 / toolbar contextmenu).
2. **`!entry.items` roving no-op.** A popup consumer (the site-info popup) registers without
   an `items` getter; the menu-keydown handler returns early at `if (!entry.items) return`,
   so the roving/arrow contract simply does nothing for it. The popup supplies its own
   Escape/Tab dismissal in its own handler.
3. **`focusReturn?` vs default `trigger.focus()`.** On Escape/Tab the controller calls
   `entry.focusReturn()` when present, else `entry.trigger.focus()`. The page context menu
   uses `focusReturn` (it has no persistent trigger button to return focus to); the toolbar
   consumers omit it and keep `trigger.focus()`.

## Mutual exclusion + outside-dismiss

- **Mutual exclusion.** `open(entry)` calls `closeAll()` first, so opening any menu dismisses
  whatever else was open. `current` exposes the open entry (or `null`).
- **`pointerdown` outside-dismiss.** A global `document` `pointerdown` listener closes the
  open menu when the event target is outside both the menu and its trigger. `pointerdown`
  fires before focus shifts and the dismissal CDP clicks dispatch pointerdown→click, so this
  catches in-chrome clicks. Outside-dismiss does **not** restore focus to the trigger — only
  Escape/Tab do.
- **`blur` close-all.** A global `window` `blur` listener closes any open menu on page/webview
  clicks (a separate web-contents the chrome document can't see) and on app-switch.

Both global listeners attach at module load (same timing as before the extraction — `renderer.js`
attached them at its own eval). They are **moved**, not copied, so they do not double-fire.

## The recursion rule — raw `onClose` vs the public `closeX` wrapper

Each consumer's public `closeX` wrapper delegates *back into* the controller
(`menuController.close(entry)` / `closeAll`). `onClose` must be the **raw hide body**, never
the public wrapper: the controller's `closeEntry` calls `entry.onClose?.()`, so wiring the
wrapper as `onClose` would recurse (`close → onClose → closeX → close → …`). The public
wrapper and the raw `onClose` are deliberately two distinct functions. **Never collapse them.**

## Tests

`test/unit/menu-controller.test.js` exercises the controller against fake entries (no jsdom,
no new dependency): mutual exclusion, `closeAll`/`current`, the trigger-keydown opener and its
`trigger === menu` skip, the menu-keydown contract (Escape/Tab close + focusReturn-or-trigger,
the `!items` no-op), and the with-items roving path (ArrowDown/ArrowUp/Home/End) through the
real `focusItem`.
