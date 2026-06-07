# Flight Log: Menu Dismissal & Shared APG Helper

**Flight**: [Menu Dismissal & Shared APG Helper](flight.md)

## Summary

Flight `in-flight` — executing via `/agentic-workflow`. Legs 1–2 (shared `menuController` + kebab
migration + robust outside-dismiss; container APG uplift) built, reviewed (Reviewer: confirmed;
typecheck 0, lint 0, test 147/147), and committed. Live verification (`menu-dismissal` + regressions
+ a11y + manual page-click/app-switch) and the optional HAT remain.

---

## Flight Director Notes

- **Branch**: `flight/3-menu-robustness` off `main` (planning artifacts carried over uncommitted).
- **Phase file**: `leg-execution.md` reused from Flight 2 (same file, well-formed; Developer + Reviewer
  on Sonnet; Accessibility Reviewer `Enabled:false` — a11y covered by `menu-dismissal` `[a11y]` markers
  + `npm run a11y`).
- **Execution model**: per-leg design + design-review; deferred-commit (single flight review + commit
  after the last autonomous leg).
- **Leg plan**: leg 1 `menu-controller` (autonomous; opens with the DD1 window-blur spike) + leg 2
  `migrate-container-menu` (autonomous) are the build legs; leg 3 `verify-integration` is the
  Flight-Director-driven gate (`menu-dismissal` behavior test + regressions + a11y + manual page-click/
  app-switch); leg 4 `hat-and-alignment` is interactive.
- **DD1 spike run first by FD**: the window-blur premise (does focusing a `<webview>` fire `window`
  blur on WSLg?) materially decides leg-1's dismissal mechanism (window-blur vs preload-forward
  divert), so the Flight Director runs the spike on the live app BEFORE designing/building leg 1 in
  detail — applying the Flight-2 debrief lesson that a divert spike must precede the dependent build.

## Leg Progress

### DD1 window-blur spike (Flight Director, pre-leg-1)
**Result: PREMISE CONFIRMED — no divert.** On the live app (`:9222`, WSLg), armed a `window` blur
listener, called `document.getElementById('webview-tab-1').focus()`, and observed `window.__blurFired
=== true` with `document.activeElement` = the webview element. So focusing/clicking a `<webview>` fires
`window` blur on the chrome renderer → the window-blur dismissal path (DD1) is viable. The
preload-forward fallback is NOT needed. (Real pointer page-click remains a manual HAT check per DD5;
the programmatic-focus witness fired blur as expected.)

### menu-controller (leg 1)
**Status**: landed

#### Design
- Leg artifact authored; citations verified clean.
- **Design review** (Developer, Sonnet): *approve with changes*. Caught a **high-severity
  infinite-recursion trap** — `onClose` must be the raw hide body, distinct from the public `closeX`
  wrapper (which delegates to `controller.close` → `onClose`). Fixed: raw hide bodies vs distinct thin
  wrappers. Also incorporated: pinned `pointerdown` for dismissal; triggers read `menuController.current`
  (single source of truth) not `classList`; kebab keydown stays per-entry (not controller-global) so the
  container isn't accidentally uplifted before leg 2; AC that outside-click/blur do NOT restore focus
  (only Escape/Tab); `window.prompt` New-container is a real must-verify; clicking `+` while the
  container menu is open closes it + opens a tab (accepted).
- **Scope deviation (design review, medium)**: DD4's removals (cross-calls + dual `document` listeners)
  and registering the container for dismissal/mutual-exclusion are **front-loaded into leg 1** (closes
  the intermediate-ReferenceError gap; lands the bug fix for both menus now). **Leg 2 is therefore
  APG-uplift-only** — flight.md leg-2 bullet + technical approach updated to match.
- Skipped 2nd design-review cycle: all changes are direct incorporations, no novel design.

#### Implementation
**Status**: landed. All in `src/renderer/renderer.js` (no `index.html`/`styles.css` touched).

Changes:
- **Shared `menuController`** — added an in-file IIFE (plain object/closure, `sourceType:"script"`,
  JSDoc-typed via a `MenuEntry` typedef) exposing `register`, `open(entry, startIndex)` (calls
  `closeAll()` first → mutual-exclusion, then `entry.onOpen?.(startIndex)`), `close(entry)`,
  `closeAll()`, and a `current` getter (the single source of truth).
- **Kebab migrated** — registered as `kebabEntry`; `onOpen(startIndex)` / `onClose` are the RAW
  show/hide bodies (show + position + aria + focusItem / hide + aria). Its APG keydown stays a
  per-entry listener on `els.kebabMenu` (kept local so registering the container doesn't uplift its
  keyboard before leg 2). Trigger click/keydown now read `menuController.current` and call
  `menuController.open(kebabEntry, …)` / `.close`.
- **Container registered** — `containerEntry`; `onOpen` builds dynamic items / jar dots / Burner /
  New-container, shows, inline-left anchor, aria, focuses first `.cm-item`; `onClose` is the raw hide
  body. Keyboard left Escape-only (APG uplift deferred to leg 2). `#new-tab-menu` click reads
  `menuController.current`.
- **Removed (DD4)** — both hand-wired cross-calls (`closeKebabMenu()` in open-container, `closeContainerMenu()`
  in open-kebab), BOTH old `document` `click` menu-close listeners, and the two per-trigger
  `e.stopPropagation()` dismissal-reliance calls. (The two remaining `stopPropagation` in the file are
  the media-pick checkbox + `iconBtn` — unrelated.)
- **Dismissal layer (once)** — one target-aware `document` `pointerdown` handler (ignores events inside
  the open menu or on its registered trigger, else `closeAll`) + `window` `blur` → `closeAll`. Neither
  restores focus to the trigger (only Escape/Tab keep their `.focus()` calls).

**Recursion avoided**: each public `closeKebabMenu`/`closeContainerMenu` is a thin wrapper delegating to
`menuController.close(entry)`, while `menuController.close` calls `entry.onClose()`. The `onClose` hooks
are the RAW `classList.add('hidden')` hide bodies — deliberately distinct functions from the public
wrappers — so there is no `close → onClose → closeX → close → …` loop. Verified by grep: wrappers call
`menuController.close(...)`; `onClose` bodies call `classList.add('hidden')` directly.

**Gates**: `npm run typecheck` → 0 errors; `npm run lint` → 0 problems; `npm test` → 147/147 pass.
Grep confirms: no old `document` menu-close listeners, no cross-calls, no `openKebabMenu`/`openContainerMenu`
references, wrappers are non-recursive. App not relaunched (live verification is the `verify-integration`
leg). No deviations from the leg spec.

---

### migrate-container-menu (leg 2)
**Status**: landed

#### Design
- Leg artifact authored (APG-uplift-only); citations verified clean against post-leg-1 code.
- **Design review** (Developer, Sonnet): *approve with changes*. Resolved the **Enter/Space hedge** →
  mirror the kebab verbatim (the reviewer verified `preventDefault` suppresses the synthetic click, since
  the kebab opens on Enter/Space without toggling closed — no double-open). Added the `containerItems()`
  `HTMLElement[]` cast (typecheck). Confirmed `role=presentation` on `.cm-title` + `role=menuitem` on
  `.cm-item` fully satisfies axe `aria-required-children` (the `.cm-dot`/`<em>` are non-issues —
  `menuitem` has no required owned children). Added a witnessed **container trigger-keyboard-open**
  checkpoint (`menu-dismissal` Step 9, esp. the risky Space case) + an AC that Enter/Space open exactly
  once. Skipped 2nd design-review cycle: direct incorporations.

#### Implementation
**Status**: landed. APG-uplift only; touched `src/renderer/index.html`, `src/renderer/renderer.js`,
and `CLAUDE.md`. No kebab/tablist/window-controls/leg-1 controller code touched.

Changes:
- **`index.html`** — `#container-menu` now carries `role="menu"` +
  `aria-label="Open new tab in a container"` (static attrs).
- **`containerItems()` helper** — added (mirrors `kebabItems()` incl. the `/** @type {HTMLElement[]} */`
  cast + `@returns {HTMLElement[]}` JSDoc), querying `els.containerMenu [role="menuitem"]`.
- **Builder (`containerEntry.onOpen`)** — gained a `startIndex = 0` param; `.cm-title` built as
  `role="presentation"`; every `.cm-item` (jars, Burner, add) gets `role="menuitem"`; the old
  `first.focus()` replaced with `focusItem(containerItems(), startIndex === -1 ? items.length-1 : startIndex)`
  — roving tabindex + focus via the SHARED `focusItem` (no duplicate roving logic). Roles/roving applied
  in `onOpen` after the rebuild (dynamic items).
- **Container menu keydown** — Escape-only handler replaced with the full APG set mirroring the kebab:
  Escape/Tab close + restore focus to `#new-tab-menu`; ArrowDown/Up wrap via `focusItem`; Home/End.
- **▾ trigger keydown** — added on `#new-tab-menu`, mirroring the kebab trigger verbatim: Enter/Space/
  ArrowDown → `menuController.open(containerEntry, 0)`; ArrowUp → `menuController.open(containerEntry, -1)`;
  all `preventDefault` (suppresses the synthetic click → opens exactly once; existing toggle click handler
  at the bottom of the file unchanged).
- **`CLAUDE.md`** — one-line note added to the renderer architecture bullet: both popup menus register
  with the shared `menuController` (open/close/dismissal/mutual-exclusion) and each runs APG roving-tabindex
  nav via the shared `focusItem`.

Preserved: dynamic jar items + colored dots, Burner, "New container…" (`window.prompt` → create + open),
createTab-on-select, inline-left anchor, and leg-1 dismissal/mutual-exclusion (untouched).

**Gates**: `npm run typecheck` → 0; `npm run lint` → 0; `npm test` → 147/147 pass. App not relaunched
(live a11y/APG/regression verification is the `verify-integration` leg). No deviations from the leg spec.

---

## Decisions

_Runtime decisions not in the original plan will be recorded here._

---

## Deviations

_Departures from the planned approach will be recorded here (esp. a DD1 divert to the
preload-forward fallback if the window-blur premise spike fails)._

---

## Anomalies

_Unexpected issues will be recorded here._

---

## Session Notes

- **Planning** — Created after Flight 2's debrief. Driven by an outside-dismiss correctness bug the
  operator surfaced: open menus don't close on page/webview clicks (webview is a separate web-contents
  the chrome `document` can't see) or on the other menu's trigger (per-trigger `stopPropagation`).
  Scoped (operator decision) as a menu-robustness flight that also discharges debrief Rec 4 (shared APG
  menu helper) and removes Flight-2's hand-wired mutual-exclusion; the `goldfinch://` internal scheme
  slips to Flight 4. Decisions: window-blur dismissal (premise-spiked, leg 1, divert→preload-forward);
  full shared APG controller (kebab migrated first, then container uplifted); optional HAT included.
