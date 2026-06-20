# Leg: downloads-entry

**Status**: completed
**Flight**: [Downloads Surface](../flight.md)

## Objective

Add the **entry points** to the downloads page: a **`Downloads` item in the kebab overflow menu** (mirrors
`#kebab-settings`) and the conventional **`Ctrl+J`** shortcut — working both when the chrome shell has focus
(renderer keydown fallback) and when a web page has focus (main-side `before-input-event` capture) — with no
toolbar button (downloads is app-level; pins are tab-level).

## Context

- **DD2** — entry = kebab item (`#kebab-downloads`) + `Ctrl+J`, **no `toolbarPins` change**. The
  page-focused `before-input-event` handler is wrapped in `!__goldfinchInternal` (`main.js:378`), so it
  never fires while an internal page has focus → `Ctrl+J` from within an internal tab relies on the
  renderer fallback; the `isInternalTab` guard is about **not re-opening downloads from within an internal
  tab**, not the capture path.
- **Depends on leg 2** (landed): `isInternalPageUrl('goldfinch://downloads')` now returns true, so the
  trusted `createTab('goldfinch://downloads', …)` path resolves (the `will-navigate` internal-allowlist
  guard at `main.js:366`-`:368` admits it). Without leg 2 the entry would be blocked.
- The established patterns this leg mirrors exactly:
  - **Kebab item**: `#kebab-settings` markup (`index.html:44`) + its click handler
    (`renderer.js:377`-`:380`: `closeKebabMenu()` then `createTab('goldfinch://settings', null, { trusted:
    true })`).
  - **`Ctrl+F` two-path shortcut** (the template for `Ctrl+J`): pure mapper `keydownToAction`
    (`src/shared/keydown-action.js`) → renderer dispatch (`renderer.js:2657` `case 'find'`, chrome-focus
    fallback) **plus** main-side `before-input-event` (`main.js:413` `Ctrl+F` → `mainWindow.webContents.send('open-find')`)
    consumed by `window.goldfinch.onOpenFind(() => openFind())` (`renderer.js:2282`), bridged at
    `chrome-preload.js:114`.
- **Out of scope**: the page itself (leg 2, done), the MCP tool (leg 4), `menuController` graduation (leg
  5). **Docs** (README `Ctrl+J` shortcut row; CLAUDE.md kebab prose) are **owned by leg 6** — do not edit
  them here (avoid a double-edit), but the new item/shortcut must be ready for leg 6 to document.

## Inputs

What exists before this leg runs:
- `src/renderer/index.html:43`-`:46` — `#kebab-menu` with `#kebab-settings` (tabindex 0), `#kebab-print`,
  `#kebab-exit` (tabindex -1), each `role="menuitem"`.
- `src/renderer/renderer.js:336` `kebabItems()` — returns `[...els.kebabMenu.querySelectorAll('[role="menuitem"]')]`
  **dynamically**, so a new `role="menuitem"` button is picked up by the roving-tabindex/menuController
  automatically (no registration change). `:354` `kebabEntry = menuController.register({ … items:
  kebabItems … })`; `:372` `closeKebabMenu()`; `:377`-`:388` the three item click handlers.
- `src/shared/keydown-action.js` — pure `keydownToAction({key,ctrl,meta,shift,lightboxOpen})`; the
  not-lightbox-gated chain is `t`→new-tab, `w`→close-tab, `l`→focus-address, `m`→toggle-panel,
  `Shift+P`→toggle-privacy, `r`→reload. Returns `null` for no match.
- `src/renderer/renderer.js:2618`-`:2692` — the global `keydown` dispatch `switch (action)`; `:2664` `case
  'new-tab'` is the simplest app-level template; `:2638` `case 'devtools'` shows the `isInternalTab` guard
  pattern.
- `src/main/main.js:378`-`:429` — the guest `before-input-event` handler (inside `!__goldfinchInternal`);
  `:413` is the `Ctrl+F` → `open-find` branch to mirror; `:391` the `input.control || input.meta` gate.
- `src/preload/chrome-preload.js:111`/`:114` — `onOpenTab`/`onOpenFind` bridges; `:114` is the mirror
  target.
- `test/unit/keydown-action.test.js` — the mapper's unit tests, to extend for `Ctrl+J`.

## Outputs

What exists after this leg completes:
- `src/renderer/index.html` — a `#kebab-downloads` `role="menuitem"` button in `#kebab-menu`.
- `src/shared/keydown-action.js` — `Ctrl+J`/`Ctrl+j` → a new `'downloads'` action.
- `src/renderer/renderer.js` — the `#kebab-downloads` click handler; the `case 'downloads'` dispatch; the
  `onOpenDownloads` consumer; an `openDownloads()` helper shared by both paths.
- `src/main/main.js` — a `Ctrl+J` branch in the guest `before-input-event` handler → `mainWindow.webContents.send('open-downloads')`.
- `src/preload/chrome-preload.js` — an `onOpenDownloads` bridge.
- `test/unit/keydown-action.test.js` — extended for the `Ctrl+J` → `'downloads'` mapping.

## Acceptance Criteria

- [ ] **Kebab item:** `#kebab-menu` contains a `Downloads` `role="menuitem"` button (`#kebab-downloads`);
  clicking it closes the kebab and opens `goldfinch://downloads` as a **trusted tab** (mirrors
  `#kebab-settings`). It participates in the kebab's roving-tabindex/arrow-key nav (picked up by
  `kebabItems()` automatically).
- [ ] **`Ctrl+J` mapper:** `keydownToAction` returns `'downloads'` for `Ctrl+J` and `Ctrl+j` (and with
  `meta` on mac), and `null` for a bare `j`/`J` (no modifier). Decide lightbox-gating consistently with the
  app-level chain (NOT gated, like `new-tab`) — documented in the mapper comment.
- [ ] **`Ctrl+J` — chrome focus:** with the chrome shell focused, `Ctrl+J` opens the downloads page
  (renderer dispatch `case 'downloads'`), **no-op when the active tab is already an internal tab** (DD2
  guard — don't stack a second internal tab).
- [ ] **`Ctrl+J` — web-page focus:** with a web page focused, `Ctrl+J` is captured main-side
  (`before-input-event`) and opens the downloads page via `mainWindow.webContents.send('open-downloads')` →
  `onOpenDownloads` consumer. Chromium's default `Ctrl+J` (if any) is suppressed (`event.preventDefault()`).
  **The branch MUST guard `!input.isAutoRepeat`** (required, not optional) — main-side `before-input-event`
  repeats keyDown while held, and this path has no `isInternalTab` guard, so a held `Ctrl+J` would stack
  downloads tabs (mirrors the F12/`Ctrl+Shift+I` branches at `main.js:386`/`:421`).
- [ ] **Typecheck:** `keydownToAction`'s `@returns` union includes `'downloads'` (the file is `@ts-check`;
  the new `case 'downloads'` would otherwise fail `npm run typecheck`).
- [ ] **No toolbar/pins change:** `toolbarPins` and the toolbar markup are untouched.
- [ ] **Single open path:** both the kebab click and the two `Ctrl+J` paths converge on one
  `openDownloads()` helper (DRY); behavior is identical.
- [ ] `node --test test/unit/*.test.js` passes (incl. the extended keydown-action tests); `npm run
  typecheck` + `npm run lint` clean.
- [ ] `npm run a11y` — 0 new violations in the chrome sweep (the kebab gained a focusable menuitem).

## Verification Steps

- `node --test test/unit/keydown-action.test.js` — `Ctrl+J`/`Ctrl+j`/`Cmd+J` → `'downloads'`; bare `j` →
  `null`; lightbox-open `Ctrl+J` → `'downloads'` (not gated) — or whichever gating the AC fixes, asserted.
- `node --test test/unit/*.test.js` && `npm run typecheck` && `npm run lint` — all clean.
- `npm run a11y` — 0 new violations.
- Manual smoke (`npm run dev`): open the kebab → a `Downloads` item is present and arrow-key reachable →
  click opens `goldfinch://downloads`. Press `Ctrl+J` with a web page focused → downloads opens. Press
  `Ctrl+J` with the address bar / chrome focused → downloads opens. Press `Ctrl+J` while already on an
  internal tab → no second tab stacks. No toolbar button appears.

## Implementation Guidance

1. **Mapper (`keydown-action.js`).** Add to the not-lightbox-gated chain (near the `t`/`w`/`l`/`m` lines):
   `if (key === 'j' || key === 'J') return 'downloads';`. Extend the return-type JSDoc union with
   `'downloads'`. Update the header comment's chain description. Keep the dual CJS/global export tail.
2. **Renderer `openDownloads()` helper + dispatch (`renderer.js`).** Add a small helper near the kebab
   handlers:
   ```js
   function openDownloads() {
     createTab('goldfinch://downloads', null, { trusted: true });
   }
   ```
   - Kebab click (beside the other handlers, `:377`-`:388`):
     ```js
     els.kebabMenu.querySelector('#kebab-downloads')?.addEventListener('click', () => {
       closeKebabMenu();
       openDownloads();
     });
     ```
   - Dispatch `case 'downloads'` in the `switch` (`:2635`-`:2691`): **guard against stacking** — if the
     active tab is already internal, no-op; else open:
     ```js
     case 'downloads': {
       e.preventDefault();
       const t = activeTab();
       if (t && isInternalTab(t)) return;   // already on an internal page — don't stack (DD2)
       openDownloads();
       return;
     }
     ```
   - Consumer for the web-focus path (beside `onOpenFind`, `:2282` / `onOpenTab`, `:2614`):
     `window.goldfinch.onOpenDownloads(() => openDownloads());` — note this path has **no active-internal
     guard**: it only fires when a *web page* had focus, so the active tab is web by construction.
3. **Main-side capture (`main.js` `before-input-event`, after the `Ctrl+F` branch ~`:417`).** Mirror find:
   ```js
   if (input.key === 'j' || input.key === 'J') {
     event.preventDefault();
     if (mainWindow) mainWindow.webContents.send('open-downloads');
     return;
   }
   ```
   This sits inside the `input.control || input.meta` gate (`:391`) and the outer `!__goldfinchInternal`
   skip — exactly like `Ctrl+F`. **The `isAutoRepeat` guard is REQUIRED** (a held `Ctrl+J` would otherwise
   stack tabs; this path has no `isInternalTab` guard): wrap as
   `if ((input.key === 'j' || input.key === 'J') && !input.isAutoRepeat) { event.preventDefault(); if
   (mainWindow) mainWindow.webContents.send('open-downloads'); return; }`.
4. **Preload bridge (`chrome-preload.js`, beside `:114`).**
   `onOpenDownloads: (cb) => ipcRenderer.on('open-downloads', () => cb()),`.
5. **Kebab markup (`index.html`).** Add after `#kebab-settings` (`:44`):
   `<button id="kebab-downloads" class="cm-item" role="menuitem" tabindex="-1">Downloads</button>`.
   Order: Settings, **Downloads**, Print…, Exit. `tabindex="-1"` (the roving-tabindex sets 0 on the
   focused item; first-item default is handled by `focusItem`).
6. **Tests (`keydown-action.test.js`).** Add cases for `Ctrl+J`→`'downloads'`, `Ctrl+j`→`'downloads'`,
   `Cmd/meta+J`→`'downloads'`, bare `j`→`null`, and the chosen lightbox behavior.

## Edge Cases

- **Held `Ctrl+J`** (main-side `before-input-event` repeats keyDown): use the `isAutoRepeat` guard so a
  held chord doesn't stack tabs (mirrors the devtools/F12 branches).
- **`Ctrl+J` while already on `goldfinch://downloads`:** the chrome-focus dispatch no-ops via the
  `isInternalTab` guard; the web-focus path can't occur (a web page isn't focused). Acceptable: no second
  downloads tab.
- **Kebab roving-tabindex:** `kebabItems()` is dynamic, so no menuController registration change is needed;
  verify arrow-up/down wraps across all four items including Downloads.
- **`j` as a normal keystroke in a web field:** the mapper only matches with `ctrl||meta`, so typing `j`
  is unaffected; the main-side branch is behind the modifier gate too.

## Files Affected

- `src/renderer/index.html` — `#kebab-downloads` menuitem.
- `src/shared/keydown-action.js` — `Ctrl+J` → `'downloads'`.
- `src/renderer/renderer.js` — `openDownloads()` helper, kebab click handler, `case 'downloads'`,
  `onOpenDownloads` consumer.
- `src/main/main.js` — `Ctrl+J` branch in the guest `before-input-event` handler.
- `src/preload/chrome-preload.js` — `onOpenDownloads` bridge.
- `test/unit/keydown-action.test.js` — extended.
- *(Docs — README `Ctrl+J` row, CLAUDE.md kebab prose — are **leg 6's** scope; not edited here.)*

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (`node --test test/unit/*.test.js`, `npm run typecheck`, `npm run lint`)
- [ ] `npm run a11y` — 0 new violations
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight: (N/A — leg 3 of 6)
- [ ] Commit deferred per `/agentic-workflow` (flight-level review + commit after the last autonomous leg)

---

## Citation Audit

All citations verified clean against current code at leg design time (read directly this session):
`index.html:43`-`:46` (kebab markup), `renderer.js:336` (`kebabItems` dynamic query), `:354` (kebab
register), `:372` (`closeKebabMenu`), `:377`-`:388` (item click handlers), `:2282` (`onOpenFind`
consumer), `:2614` (`onOpenTab` consumer), `:2618`-`:2692` (keydown dispatch switch), `:2657` (`case
'find'`), `:2664` (`case 'new-tab'`); `keydown-action.js` (`keydownToAction` chain + dual export);
`main.js:378`-`:429` (guest `before-input-event`), `:413` (`Ctrl+F`→`open-find`), `:366`-`:368`
(`will-navigate` internal allowlist now admitting `goldfinch://downloads` via leg 2); `chrome-preload.js:111`/`:114`
(`onOpenTab`/`onOpenFind`). Leg-2 dependency (`isInternalPageUrl` accepts `downloads`) is a deliverable of
the landed leg 2.
