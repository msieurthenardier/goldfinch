# Leg: menu-protocol-and-kebab

**Status**: completed
**Flight**: [Menu Overlay Sheet](../flight.md)

## Objective

Build the DD4 menu protocol end-to-end — the seven IPC channels, the `closeMenuOverlay(reason)`
single close path with the main-initiated close family, open-tokens, the DD5 find-bar interplay,
DD13 accelerator forwarding, and the DD8 resolver hardening — and migrate the **kebab (⋮) menu**
(static model, simplest consumer) onto the sheet behind the `GOLDFINCH_MENU_OVERLAY_DEV` gate,
with the sheet page rendering models and running the APG keyboard contract. Chrome keeps all old
menus fully functional (parallel-run); without the gate, zero behavior change. **CP2**: kebab
opens/dismisses over a live guest at parity (pixels + keyboard contract), old menus intact.

## Context

- **DD4 (flight)**: chrome owns state/model-building/actions; the sheet is presentation-only.
  Channel set (numbering per flight): (1) chrome→main `menu-overlay:open`
  `{menuType, model, anchor, startIndex, token}`; (2) chrome→main `menu-overlay:close`;
  (3) main→sheet `menu-overlay:init` (pending-init queue for the first-load race, F7 pattern);
  (4) sheet→main `menu-overlay:activated` `{id, token}`; (5) sheet→main `menu-overlay:dismissed`
  `{reason, token}`; (6) main→chrome `menu-overlay-activated` `{menuType, id}`; (7) main→chrome
  `menu-overlay-closed` `{menuType, reason, token}`.
- **Main-initiated close family (DD4)**: BaseWindow **blur** (no such listener exists yet — only
  closed/resize/maximize/unmaximize, `src/main/main.js:684-719`), tab lifecycle while open
  (`tab-close`, `tab-hide`, `tab-set-active` incl. MCP-driven activation), teardown
  (`render-process-gone`, window-closed). ALL routes through `closeMenuOverlay(reason)`: hide
  sheet, emit channel 7, run the DD5 find-restore hook. **Idempotent** (round-2 lock): app-switch
  fires BaseWindow blur AND sheet blur — chrome must see exactly one channel-7 close and the DD5
  restore must run once. Unit-tested.
- **Open-token (round-2 lock)**: chrome mints a monotonic token per open, carried in the model,
  echoed in channels 4/5/7; main drops stale sheet reports (token ≠ current); chrome drops stale
  channel-7 closes (per-menuType last-token compare). Closes the same-menuType keyboard-re-open
  race the click-only suppress window doesn't cover.
- **Trigger re-click-to-close race (DD4, mechanism confirmed here)**: mousedown on the trigger
  blurs the sheet → `dismissed{blur}` → channel 7 resets chrome state **before** chrome's `click`
  fires → click sees "closed" and re-opens (blink that never closes). Mechanism: chrome records
  `{menuType, at: performance.now()}` on every `menu-overlay-closed` with `reason:'blur'` and
  suppresses a trigger-click re-open of the **same menuType** within **300 ms**; other menus'
  triggers unaffected (composes with mutual exclusion).
- **Reason-resolved refocus (DD4, corrected in design review)**: `escape`/`activated` → **main
  first calls `getChromeContents()?.focus()`** (webContents-level — chrome-side `els.kebab.focus()`
  alone cannot move keyboard focus off the sheet in a multi-view `BaseWindow`; F7 precedent:
  `closeFindOverlaySession({refocusGuest})` does `wc.focus()` main-side), then chrome focuses the
  trigger element (context menu's `returnFocus` comes in Leg 4). `toggle` (trigger re-click close)
  → no explicit focus move (the physical click already OS-focused chrome). `blur` → NO refocus;
  `tab-switch`/`superseded`/`tab-close`/`tab-hide`/`teardown` → no refocus. `aria-expanded`
  resets on EVERY reason. Verification must corroborate with a real keystroke reaching chrome —
  `document.activeElement` alone can false-pass.
- **DD5 (wired NOW, not at cutover)**: sheet-show → `hideFindOverlay()`
  (`src/main/main.js:274`); every close → re-show iff the find session targets the active tab
  (`isFindOverlayActive`, `main.js:167`) — EXCEPT the tab-lifecycle reasons **`tab-switch`,
  `tab-hide`, and `tab-close`** (design review: `tab-hide` just hid the find overlay one line
  earlier and restore belongs to `tab-set-active`'s re-add — restoring here would paint the bar
  over a hidden guest and then double-handle; `tab-close` is safe today only by the
  `activeTabWcId` null-out ordering — skip it explicitly, don't rely on the accident). All three
  defer to the existing per-tab find-restore logic. **Ordering pin (window `closed`)**:
  `teardownFindOverlayView()` runs BEFORE `closeMenuOverlay('teardown')` — it nulls
  `findOverlayTabWcId`, so the teardown-reason restore naturally no-ops mid-window-teardown,
  while the sheet-crash `render-process-gone` teardown (find session still live) restores as
  desired. This wiring also fixes F7's "focus doesn't return to overlay after unfreeze" known
  item structurally.
- **DD13 (set locked here — the union)**: forwarded from the sheet's `before-input-event`:
  guest-class — F12, Ctrl+Shift+I (devtools), Ctrl+= / + / − / 0 (zoom), Ctrl+P (print), Ctrl+F
  (find), Ctrl+J (downloads) (the guest-captured set, `main.js:795-857`); chrome-class — Ctrl+T
  (new-tab), Ctrl+W (close-tab), Ctrl+L (focus-address), Ctrl+M (toggle-panel), Ctrl+R (reload),
  Ctrl+Shift+P (toggle-privacy) (`src/shared/keydown-action.js:40-73`). Unmodified
  Arrow/Home/End/Enter/Space/Escape/Tab stay with the sheet (APG wins). Resulting composite
  semantics (Ctrl+W closes tab → menu closes via the tab-lifecycle close path) fall out of the
  close family; the HAT verifies feel.
- **DD8 hardening (defense-in-depth, round-2 framing)**: jar keys CANNOT reach the sheet today —
  the scope façade (`src/main/automation/scope.js:120-129`) routes wcId-first ops through
  `resolveContentsForJar`, which throws `out-of-jar` on session identity
  (`src/main/automation/resolve.js:141-157`; pinned by
  `test/unit/automation-scope.test.js:142-191`). **Not a live vulnerability.** This leg adds the
  resolver-level rule anyway: wcIds that are neither in `tabViews` nor the chrome contents
  resolve only at the admin tier — via an injected `isTabViewWcId` predicate. Same-pass
  obligation: this is a second admin-only relaxation, so the "`allowInternal` is admin's SOLE
  relaxation" doc/comment sites (`resolve.js:69`, `resolve.js:92-94`, `engine.js:25-29`) update
  together. Unit tests assert the correct baseline (today's jar-tier refusal is `out-of-jar`).
- **DD2 anchor nuance**: coordinate identity holds for guest-relative coords only; the kebab's
  anchor comes from a **chrome** client rect and must be translated chrome→sheet (subtract the
  guest-region origin from `els.webviews.getBoundingClientRect()`; y clamps to 0 per DD12 — the
  kebab menu renders flush at the sheet's top edge, right-aligned, the accepted ~4px shift).
- **APG engine reuse**: `src/renderer/menu-controller.js` is DOM-pure and dual-export
  (`menu-controller.js:137-142`). The sheet page **loads the same file** via `<script>` (two
  documents, one source — reuse, not a fork); its global pointerdown/blur listeners
  (`menu-controller.js:114-123`) become the sheet's own outside-click/blur dismissal, and its
  menu-keydown contract (`:57-92`) gives roving/Escape for free. Chrome's copy keeps serving the
  old menus during parallel-run; retirement of the chrome-side global listeners is Leg 5.
- **Kebab today (all still live, untouched for the no-gate path)**: entry registration
  `src/renderer/renderer.js:139-159` (freeze calls at `:152`, `:157`); item actions `:166-182`;
  trigger click toggle `:184-187`; `positionKebabMenu` `:131-136`; items are the four static
  menuitems (Settings / Downloads / Print… / Exit).
- **Leg-1 stand-ins replaced**: `menuOverlayDevShown` + Ctrl+Shift+M stimulus
  (`main.js:358-360`, `:861-869`) are deleted; the manager's visibility becomes real menu-open
  state. The Leg-1 handler touches (`tab-set-active` `:1778`, `tab-set-bounds` `:1833`,
  `tab-hide` `:1741`, `tab-close` `:1711`, closed `:684`) are re-pointed at the close family.
  The `?probe=1` badge stays (dev-gated; deleted at Leg 5).
- Deferred: container/site-info dynamic models (Leg 3); context-menu params model, 1:1 coords,
  Shift+F10, toolbar-unpin, action channels for spelling/Inspect/clipboard (Leg 4); cutover +
  freeze deletion + a11y audit extension + spec/docs updates (Leg 5); behavior-test runs (Leg 6).

## Inputs

- Leg 1 landed (uncommitted, on `flight/08-menu-overlay-sheet`): manager
  (`src/main/menu-overlay-manager.js`, 147 lines), sheet page files, preload stub, fixture,
  `createSheetView` (`main.js:365`), manager construction (`main.js:386`).
- `src/main/main.js` (2,317 lines post-Leg-1): anchors listed in Context.
- `src/preload/chrome-preload.js:10` — `exposeInMainWorld('goldfinch', {...})` API surface to
  extend; `src/preload/find-overlay-preload.js` — channel-preload shape to mirror for the sheet.
- `src/renderer/renderer.js:2394-2460` — global chrome shortcut keydown handler
  (`keydownToAction` dispatch switch) to refactor into a shared `dispatchChromeAction(action)`.
- F7 protocol precedents in `main.js`: sender validation (`find-overlay:open` `:1868`,
  `find-overlay:close` `:1882`, `find-overlay:query` `:1909`), pending-init queue + focus
  delivery (`deliverOverlayInit` region `:285-341`).
- Apparatus (unchanged from Leg 1, incl. the **port-conflict workaround**: the operator's
  installed Windows Goldfinch may hold the harness MCP port 49152 — launch on a free port and
  drive via the SDK client pattern, `scripts/mcp-example-client.mjs`, admin key from the
  instance's own stdout; wiring litmus mandatory). `pressKey` on the **sheet's probed wcId**
  drives the APG keys; `readDom` on chrome + sheet wcIds corroborates.

## Outputs

- Modified: `src/main/menu-overlay-manager.js` (open-state + `openMenu` + `closeMenuOverlay` +
  injected close hooks), `src/main/main.js` (IPC handlers, close-family wiring, BaseWindow blur
  listener, DD13 forwarding, `isTabViewWcId` threading, Leg-1 stand-in removal),
  `src/renderer/menu-overlay.js`/`.html`/`.css` (model renderer + APG + reason attribution),
  `src/preload/menu-overlay-preload.js` (channels 3/4/5), `src/preload/chrome-preload.js`
  (gate flag + channels 1/2/6/7), `src/renderer/renderer.js` (kebab gate-branch, model builder,
  activation execution, reason-resolved refocus, suppress window, `dispatchChromeAction`
  refactor), `src/main/automation/resolve.js` + `engine.js` (+ scope ctx if needed) (DD8),
  `test/unit/automation-resolve.test.js` (DD8 cases).
- New: `test/unit/menu-overlay-manager.test.js` grows (close family, idempotency, tokens,
  model-replace); new pure-mapper test for the DD13 set (`test/unit/sheet-accelerator.test.js`)
  and the mapper module (`src/shared/sheet-accelerator.js`, dual-export like `keydown-action.js`).
- Behavior: gate ON → kebab renders from the sheet over the live guest (all other menus old
  path); gate OFF → today's behavior bit-for-bit.

## Acceptance Criteria

- [x] **AC1 — Channel set + sender validation (DD8).** All `menu-overlay:*` ipcMain handlers
  validate `event.sender` by identity (chrome contents for 1/2; the sheet's webContents for 4/5 —
  F7 pattern, `main.js:1868/:1882`); payload-declared identity never trusted. Channels 3/6/7 are
  `.send`s to the sheet/chrome respectively. Token in 1/3/4/5/7.
- [x] **AC2 — Manager close path.** `closeMenuOverlay(reason)` in the manager is the ONLY
  sheet-hide path for menu closes: hides (removeChildView via existing `hide()`), emits channel 7
  through an injected `sendToChrome`, runs injected `restoreFindOverlay(reason)` (skips restore
  on the tab-lifecycle reasons `tab-switch`/`tab-hide`/`tab-close`), and is **idempotent** (no-op when no menu open — double-blur safe, unit-tested).
  `openMenu(payload)` = show + hideFindOverlay hook + init delivery (pending-init queue when the
  sheet page hasn't loaded — F7 pattern) + `webContents.focus()` after init (the Leg-1 "never
  focus" contract is superseded by real menu semantics: focus enters the sheet ONLY via
  `openMenu`). Open-while-open = **model-replace** (no hide/re-show flicker) + channel 7 for the
  superseded menu with `reason:'superseded'`.
- [x] **AC3 — Close family complete.** New `mainWindow.on('blur')` → `closeMenuOverlay('blur')`;
  `tab-close` (active) → `'tab-close'`; `tab-hide` (active) → `'tab-hide'`; `tab-set-active` to a
  different tab (any driver, incl. MCP `activateTab`) → `'tab-switch'`;
  `render-process-gone`/window-closed teardown → `'teardown'` (channel 7 emitted before/with
  teardown so chrome state never orphans; in the `closed` handler `teardownFindOverlayView()`
  runs FIRST — the DD5 ordering pin). Window **minimize** is deliberately NOT in the close
  family: if the platform fires blur on minimize the menu closes via `'blur'`; if not (WSLg
  uncertainty), a menu surviving minimize-restore is an accepted variation, recorded here, HAT
  observes. Leg-1's `menuOverlayDevShown`/Ctrl+Shift+M are gone.
- [x] **AC4 — Kebab behind the gate at parity (CP2).** Gate ON: kebab click and trigger keydown
  (Enter/Space/ArrowDown→first, ArrowUp→last via `startIndex`) send channel 1 with the static
  model (Settings/Downloads/Print…/Exit), `aria-expanded="true"` while open; the sheet renders
  the menu right-aligned at the top edge at the translated anchor; **pixels**: menu composites
  over the LIVE guest (ticking fixture differs between two grabs under the open menu — the CP2
  anti-freeze check), guest full-height. Activation of each item round-trips channel 4→6 and
  executes the SAME four actions as today (`renderer.js:166-182` bodies, extracted into named
  functions shared with the old click handlers). Settings/Downloads/Print verified live; **Exit
  verified by code-identity only** (shared body — activating it live would kill the instance
  mid-run). Old menus: container /
  site-info / page-context / toolbar-unpin all still work via the freeze path with the gate ON;
  with the gate OFF the kebab itself works exactly as today.
- [x] **AC5 — APG keyboard contract in the sheet.** With the kebab open: ArrowDown/ArrowUp wrap,
  Home/End jump, roving tabindex (exactly one item `tabIndex=0`), Escape dismisses with
  `reason:'escape'`; menu container `role="menu"`, items `role="menuitem"`; labels rendered via
  `textContent` only (DD8 — no markup path for model strings).
- [x] **AC6 — Dismissal reasons + refocus.** Escape → channel 5 `{reason:'escape'}` → main
  focuses the chrome webContents AND chrome refocuses the kebab trigger — corroborated by a real
  keystroke reaching chrome afterward (not just `document.activeElement`); outside-click in the
  sheet → `{reason:'outside-click'}` → dismissed + swallowed (no forwarding), no refocus-steal;
  sheet blur (click chrome / app switch) → `{reason:'blur'}` (the page's DEFAULT reason — see
  guidance) → no refocus; trigger re-click → channel 2 `{reason:'toggle'}` → closed without
  blink-reopen (300 ms same-menuType suppress on `blur`-reason closes) and without focus theft;
  keyboard re-open immediately after a stale close works (token discipline). `aria-expanded`
  resets on every reason.
- [x] **AC7 — DD5 find interplay.** Find open with query text → open kebab (gate ON) → find bar
  hidden (pixels); dismiss (each of: Escape, outside-click) → find bar restored at correct
  bounds with text intact (pixels); close the kebab via tab-switch → no double-restore
  (tab-set-active's own logic governs); Ctrl+T forwarded with find live → no find-bar flash over
  the hidden guest (the `tab-hide` restore-skip). The **blur** dismissal flavor's restore is
  unit-tested (manager suite) and HAT-verified (Leg 6) — injected `evaluate` focus cannot move
  OS-level view focus, so a scripted "sheet blur" is not a trustworthy live stimulus (same
  apparatus limit the flight scopes click-interception to HAT).
- [x] **AC8 — DD13 forwarding.** `before-input-event` on the sheet's webContents forwards exactly
  the union set via a pure dual-export mapper (`sheet-accelerator.js`), main dispatching:
  guest-class ops replicate the existing guest-branch behavior against the ACTIVE guest
  (`applyZoom`/`print`/`toggleDevTools`/`open-find`/`open-downloads` sends); chrome-class actions
  ride a new main→chrome `chrome-shortcut-action` `{action}` channel handled by the extracted
  `dispatchChromeAction(action): boolean` (same switch bodies as the keydown handler — refactor,
  not duplicate; returns whether handled, and the keydown handler calls `preventDefault` only on
  `true`, preserving the conditional-preventDefault of internal-tab-guarded branches so gate-OFF
  behavior stays bit-for-bit).
  Ctrl+F while a menu is open closes the menu (`closeMenuOverlay('superseded')`) before find
  opens (DD5 conflict resolution). **Guest-class actions no-op when the active tab is internal**
  (`isInternalContents` guard; Ctrl+J exempt) — internal pages never zoom/print/devtools, per
  the invariant the original capture's `__goldfinchInternal` guard enforces. Live spot-checks:
  Ctrl+W (tab closes, menu closes via family), Ctrl+= (guest zooms, menu stays), Ctrl+F (menu
  closes, find opens), Ctrl+= over an internal tab with menu open (no zoom). Full mapping +
  internal-guard cases unit-tested.
- [x] **AC9 — DD8 resolver hardening + same-pass docs.** `resolveContents` accepts an optional
  injected `isTabViewWcId` and, when provided and `!allowInternal`, throws
  `automation: non-tab-contents` for a live wcId that is neither a `tabViews` member nor the
  chrome contents; both `createEngine` call sites in main.js thread
  `isTabViewWcId: (id) => tabViews.has(id)`; admin engines (`allowInternal:true`) are unaffected.
  The "SOLE relaxation" comment sites (`resolve.js:69`, `:92-94`, `engine.js:25-29`) are updated
  to name both admin relaxations. Unit tests: baseline (jar tier refuses a chrome-class
  non-tab wcId with `out-of-jar` — unchanged), new guard fires at non-admin tier with the
  predicate, admin unaffected, absent predicate = no behavior change.
- [x] **AC10 — Unit suites.** Manager tests cover open/close family end-to-end (idempotent close,
  token staleness drop, model-replace + superseded emission, DD5 hook invocation incl. the
  tab-switch/tab-hide/tab-close skips, `focusChrome` called for escape/activated only,
  pending-init queue); accelerator-mapper tests cover the full union + APG-key exclusions + the
  internal-tab guard cases; existing `menu-controller.test.js` untouched and green (chrome menus
  unchanged; the sheet loads the same file). JSDoc typedefs updated where deps grow
  (`resolveContents` deps gain `isTabViewWcId`; the manager's view typedef gains
  `webContents.focus`/`send`) so `npm run typecheck` stays green.
- [x] **AC11 — Zero regression without the gate.** Gate OFF: no `menu-overlay:*` traffic on any
  menu interaction; all five menus freeze-frame exactly as today; find/zoom/shortcuts unchanged.
- [x] **AC12 — Gates green.** `npm test`, `npm run typecheck`, `npm run lint`.

## Verification Steps

- Apparatus: launch as in Leg 1 (gate ON instance; SDK-client workaround if the harness port is
  held); wiring litmus; capture-path canary (find bar in pixels) before any pixel verdicts.
  Probe the sheet's wcId (F7 id-space walk); `readDom(sheetWcId)` returning the menu-overlay
  markup identifies it.
- AC4 (CP2): fixture tab → open kebab via MCP `evaluate` on chrome (`els.kebab.click()`), two
  grabs 2 s apart → menu over live ticking guest; `readDom(chromeWcId)` → `aria-expanded="true"`;
  activate "Settings" via pressKey Enter on sheet wcId → settings tab opens (channel 6 action).
  Gate-OFF relaunch: kebab is chrome DOM + freeze (still image tell), byte-parity behavior.
- AC5/AC6: pressKey ArrowDown×N/Home/End against sheet wcId + `readDom(sheetWcId)` roving state;
  Escape → `readDom(chromeWcId)` focus on `#kebab` + `aria-expanded="false"` **+ keystroke
  corroboration** (e.g. pressKey Ctrl+L on the CHROME wcId is not proof — instead send a plain
  printable key with no target and confirm it lands in the chrome address bar after Ctrl+L via
  the shortcut path, or equivalent: prove chrome has real keyboard focus); outside-click via
  `click` on sheet wcId at the fixture link coords → dismissed, `enumerateTabs` URL unchanged
  (dismiss-without-forwarding; OS-level interception stays HAT-scoped); re-click toggle via two
  `evaluate` `els.kebab.click()` calls ~100 ms apart → closed with `reason:'toggle'`, not
  blinked.
- AC7: Ctrl+F (pressKey, guest wcId) → type query → open kebab → grab (find hidden) → Escape →
  grab (find restored, text intact); repeat with outside-click; Ctrl+T with find live + menu
  open → new tab, no find-bar flash (tab-hide skip). Blur flavor: unit tests + HAT (see AC7 —
  scripted focus cannot fake OS blur).
- AC8: with kebab open — pressKey Ctrl+W on SHEET wcId → tab closes + menu closes; reopen, Ctrl+=
  → zoom chip changes, menu stays; Ctrl+F → menu closes, find opens. Mapper: `npm test`.
- AC9/AC10: `npm test` (new suites); grep `non-tab-contents` in resolve.js; grep updated comment
  text at the three doc sites.
- AC11: gate-OFF relaunch — open/dismiss all five menus; watch main's console for any
  `menu-overlay:*` log/traffic (add none — verify structurally via code path: gate branch).
- AC12: `npm test && npm run typecheck && npm run lint`.

## Implementation Guidance

1. **Manager growth** (keep Electron-free): state gains
   `currentMenu: {menuType, token} | null` and `pendingInit`. New deps injected from main.js:
   `{ sendToChrome(channel, payload), hideFindOverlay(), restoreFindOverlay(reason),
   focusChrome() }`.
   `openMenu({menuType, model, anchor, startIndex, token})`: if a menu is open → emit channel 7
   `{menuType: old.menuType, reason:'superseded', token: old.token}` (NO hide); set
   `currentMenu`; `show()`; `deps.hideFindOverlay()`; deliver `menu-overlay:init` via the view's
   webContents when ready, else queue (latest wins — F7 `pendingOverlayInit` shape,
   `main.js:227-236`); focus the sheet webContents AFTER init delivery.
   `closeMenuOverlay(reason, token?)`: if `token` provided and ≠ `currentMenu?.token` → drop
   (stale); if `!currentMenu` → no-op (idempotency); hide; emit channel 7
   `{menuType, reason, token}`; for reasons `escape`/`activated` call injected
   `focusChrome()` (main.js: `getChromeContents()?.focus()`) — the main-side half of the refocus
   contract; `deps.restoreFindOverlay(reason)` (impl skips `tab-switch`/`tab-hide`/`tab-close` —
   see step 2); null `currentMenu`. `render-process-gone` teardown calls `closeMenuOverlay('teardown')`
   BEFORE destroying. Channel 2 (`menu-overlay:close` from chrome) carries `{reason}` restricted
   to `'toggle'` (trigger re-click close — distinct in logs, no focus move) or `'superseded'`
   (programmatic/mutual-exclusion).
2. **Main IPC + close family**: `ipcMain.on('menu-overlay:open')` (sender=chrome →
   `menuOverlay.openMenu(payload)`), `('menu-overlay:close')` (sender=chrome →
   `closeMenuOverlay('superseded')` — programmatic), `('menu-overlay:activated')` (sender=sheet;
   drop stale token; `closeMenuOverlay('activated', token)` then forward channel 6 to chrome),
   `('menu-overlay:dismissed')` (sender=sheet; `closeMenuOverlay(reason, token)`).
   `restoreFindOverlay(reason)` impl in main.js:
   `if (reason === 'tab-switch' || reason === 'tab-hide' || reason === 'tab-close') return;
   if (isFindOverlayActive(activeTabWcId)) showFindOverlay();` (the three-reason skip set — in
   the `tab-hide` handler the close runs BEFORE `activeTabWcId` is nulled, so a two-reason skip
   would restore the bar over a hidden guest; reuse the existing helpers `main.js:167`, `:258`).
   The channel-2 handler validates `reason` against the `['toggle','superseded']` allowlist
   (default `'superseded'`) and passes it through. Replace the Leg-1 touches: `tab-hide`/`tab-close`
   actives → `closeMenuOverlay('tab-hide'|'tab-close')` (which hides); `tab-set-active`
   different-tab branch → `closeMenuOverlay('tab-switch')`; same-tab re-activation with a menu
   open → `menuOverlay.show()` re-add (the freeze-era analog; keeps z-order via re-add-last).
   Add `mainWindow.on('blur', () => closeMenuOverlay('blur'))` beside the resize handler.
3. **DD13**: wire `view.webContents.on('before-input-event')` inside `createSheetView`
   (main.js owns Electron there). On `input.type === 'keyDown'`, run
   `sheetAcceleratorAction({key: input.key, control: input.control, meta: input.meta,
   shift: input.shift})`; null → let the sheet page have it. Guest-class → replicate the guest
   branch bodies (`main.js:795-857`) against `getActiveTabContents()` — **guarded by
   `isInternalContents` (design review): guest-class actions no-op when the active tab is
   internal** (the original capture sat inside the `!__goldfinchInternal` guard, `main.js:794`,
   so F12/zoom/print/Ctrl+Shift+I are inert on internal tabs today and must stay so; Ctrl+J is
   tab-independent and exempt; Ctrl+F's main-side open already refuses trusted tabs but keep the
   guard symmetric). `find` first calls `closeMenuOverlay('superseded')` then sends `open-find`
   to chrome — but over an INTERNAL active tab, `find` is a **full no-op** (menu stays open,
   keystroke swallowed — symmetric with the guard; find is web-tab-only anyway); chrome-class →
   `getChromeContents()?.send('chrome-shortcut-action', { action })`.
   Always `event.preventDefault()` on a match; respect `isAutoRepeat` guards exactly as the
   guest branches do (print has none today — replicate deliberately, note in the mapper test).
   Mapper mirrors the guest branch's shift-tolerant `'='` (Ctrl+Shift+= → zoom-in).
4. **Chrome (renderer.js)**: read the gate once
   (`window.goldfinch.menuOverlayDev`, exposed from chrome-preload via `process.env`). Gate ON:
   do NOT `menuController.register` the kebab entry; instead wire `#kebab` click (toggle: if
   chrome-side open-state for kebab → `menuOverlayClose({reason:'toggle'})`; else open — UNLESS a
   `blur`-reason `menu-overlay-closed` for `kebab` arrived within the last 300 ms, in which case
   swallow the click: the suppress window gates the **re-open** branch, not the close branch —
   open-state was already reset by that channel-7 close)
   and trigger keydown (Enter/Space/ArrowDown→startIndex 0, ArrowUp→−1) to
   `menuOverlayOpen({menuType:'kebab', model: kebabModel(), anchor: kebabAnchor(), startIndex,
   token: ++menuOverlayToken})`. `kebabModel()` = `[{id:'settings',label:'Settings'},
   {id:'downloads',label:'Downloads'}, {id:'print',label:'Print…'}, {id:'exit',label:'Exit'}]`;
   `kebabAnchor()` translates the trigger rect: `const wv = els.webviews.getBoundingClientRect();
   const r = els.kebab.getBoundingClientRect();
   return { alignRight: Math.round(r.right - wv.left), y: 0 }` (DD12 clamp). Subscribe:
   `onMenuOverlayActivated(({menuType,id}) => ...)` executes the four existing bodies (extract
   them into named functions shared with the old click handlers — one source of truth);
   `onMenuOverlayClosed(({menuType,reason,token}) => ...)` drops stale tokens, resets
   `aria-expanded`, records blur-suppress, refocuses per reason map. Keep chrome-side open-state
   per menuType (for toggle + aria) driven ONLY by channels 1/7 (its own sends + closes).
5. **Sheet page (`menu-overlay.js` + html/css)**: load `menu-controller.js` via `<script>` before
   `menu-overlay.js`. On `menu-overlay:init`: build the menu DOM under `#menu-root`
   (`role="menu"` container; `button role="menuitem"` per item, `textContent` labels), position
   via the anchor (`right = sheetWidth - alignRight` CSS right-align; `top: 0`), register/open
   through the local `menuController` entry (menu === trigger, like the chrome context-menu
   entry; supply `items()` getter), `focusItem(items, startIndex === -1 ? last : startIndex)`.
   Reason attribution (**corrected in design review — blur cannot be captured by listener
   order**: `window` blur dispatches at-target, so registration order rules, and
   `menu-controller.js`'s own blur→closeAll at `:123` registers first): initialize
   `lastStimulus = 'blur'` and RESET it to `'blur'` after every send — unattributed closes
   default to the blur flavor. Capture-phase listeners set it only for keydown Escape →
   `'escape'`, keydown Tab → `'escape'` (parity: Tab returns focus to the trigger today,
   `menu-controller.js:68-72`), and pointerdown outside the menu node → `'outside-click'`
   (document-capture beats bubble listeners, so these two ARE reliably attributed). The entry's
   `onClose` sends `menu-overlay:dismissed {reason: lastStimulus, token}` (except when closing
   because of `activated` — item click sends `menu-overlay:activated {id, token}` and
   suppresses the dismissed send; **exactly one of activated/dismissed per token** — first send
   wins, guarded in page code). Supply a no-op `focusReturn` on the entry (trigger === menu) so
   Escape/Tab don't try to focus the hidden menu node. Style: fixed width for the kebab type (match today's
   `#kebab-menu` CSS), dark-theme literals (F7 pattern — the sheet doc doesn't load styles.css).
6. **Preloads**: `menu-overlay-preload.js` — `onInit(cb)`, `sendActivated(payload)`,
   `sendDismissed(payload)` via ipcRenderer (stay in the eslint node-globals block).
   `chrome-preload.js` — `menuOverlayDev` flag, `menuOverlayOpen(payload)`,
   `menuOverlayClose({reason})` (allowlist `'toggle'|'superseded'`, main defaults
   `'superseded'`), `onMenuOverlayActivated(cb)`, `onMenuOverlayClosed(cb)`.
7. **`sheet-accelerator.js`** (new, `src/shared/`, dual-export, `// @ts-check`): pure mapper
   returning `{scope:'guest'|'chrome', action, autoRepeatGuard?:boolean} | null`. Table-driven
   from the union set; exclude unmodified APG keys by construction (require `control||meta`
   except F12).
8. **DD8**: `resolveContents` signature gains optional `isTabViewWcId` in deps (default
   undefined → no behavior change); guard AFTER the internal-session check:
   `if (!allowInternal && typeof isTabViewWcId === 'function' && wc !== chromeContents &&
   !isTabViewWcId(wcId)) throw new Error('automation: non-tab-contents — ...')`. Thread from
   both `createEngine` call sites (search `createEngine(getChromeContents`) via engine deps.
   Update the three comment/doc sites in the same pass.
9. **Cleanup of Leg-1 stand-ins**: delete `menuOverlayDevShown`, the Ctrl+Shift+M branch, and
   their comments; `MENU_OVERLAY_DEV` stays (it now gates the kebab consumer + probe query).

## Edge Cases

- **Double blur on app switch** (BaseWindow blur + sheet blur): idempotent `closeMenuOverlay` +
  chrome stale-token drop → exactly one channel-7 effect. Unit-tested in the manager suite.
- **Parallel-run cross-mechanism exclusion**: sheet kebab open, user opens the OLD container
  menu → its freeze path fires `tab-hide` on the active tab → close family
  (`'tab-hide'`) closes the sheet menu and resets kebab state before the freeze still paints. No
  special wiring needed — verify once live.
- **Init race on first-ever open**: sheet page not yet loaded → pending-init queue (latest
  wins), focus delivered by the did-finish-load path (F7 AC7 precedent).
- **Menu open during window resize**: sheet bounds follow via `syncBounds`; menu is
  CSS-anchored inside the sheet so it rides along; anchor staleness across a resize is
  accepted (menu dismisses on most real-world resizes via blur anyway — note, don't engineer).
- **`activated` racing `dismissed`**: item click focuses/blurs — the sheet must send exactly one
  of activated/dismissed per open (guard in page code: first send wins per token).
- **Token wraparound / multi-window**: single window today; token is a plain counter — fine.
- **Sheet crash while menu open**: `render-process-gone` → `closeMenuOverlay('teardown')` →
  chrome aria/focus reset; next open rebuilds (Leg-1 machinery).
- **MCP `activateTab` while menu open**: rides `tab-set-active` → `'tab-switch'` close — the
  DD4 "never blurs the sheet" path — covered by AC3 live check.
- **Sheet DOM persists after main-initiated closes (by design)**: there is deliberately NO
  main→sheet close channel — the hidden view keeps its rendered menu; the next
  `menu-overlay:init` rebuilds it, and the page's late `dismissed{blur}` (fired when its
  menuController closes the entry) is dropped by the stale-token check. Do NOT "fix" this with
  a redundant channel; flag the persisted state for the Leg-5 a11y audit driver.

## Files Affected

- `src/main/menu-overlay-manager.js` — open/close state machine, tokens, DD5 hooks
- `src/main/main.js` — IPC handlers, close family, blur listener, DD13 forwarding in
  `createSheetView`, `isTabViewWcId` threading, Leg-1 stand-in removal
- `src/main/automation/resolve.js`, `src/main/automation/engine.js` — DD8 guard + doc sites
- `src/shared/sheet-accelerator.js` — new pure mapper
- `src/renderer/menu-overlay.{html,css,js}` — model renderer, APG via shared controller, reasons
- `src/preload/menu-overlay-preload.js`, `src/preload/chrome-preload.js` — channels + gate flag
- `src/renderer/renderer.js` — kebab gate-branch, shared action bodies, refocus map, suppress
  window, `dispatchChromeAction` extraction
- `test/unit/menu-overlay-manager.test.js`, `test/unit/sheet-accelerator.test.js` (new),
  `test/unit/automation-resolve.test.js` — suites per AC10/AC9

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]`** (batch flight: review + commit
are deferred to flight end — do NOT commit, do NOT set `completed`):

- [x] All acceptance criteria verified (CP2 verdict + evidence paths recorded in the flight log)
- [x] Tests passing (`npm test` 1006/1006, `npm run typecheck`, `npm run lint`)
- [x] Update flight-log.md with leg progress entry (including CP2 checkpoint verdict)
- [x] Set this leg's status to `landed` (in this file's header)

---

## Citation Audit

Verified against current code on `flight/08-menu-overlay-sheet` (post-Leg-1 working tree,
2026-07-02):

- `src/main/main.js:167` `isFindOverlayActive`, `:274` `hideFindOverlay`, `:258` `showFindOverlay`
  region, `:227-236` pending-init delivery, `:285-341` `deliverOverlayInit`/session open-close —
  **OK**
- `src/main/main.js:358-360` `MENU_OVERLAY_DEV` + `menuOverlayDevShown`, `:365` `createSheetView`,
  `:386` manager construction, `:684` `closed`, `:795` guest `before-input-event` (branch bodies
  through `:857`), `:861-869` Ctrl+Shift+M stand-in, `:1711` `tab-close`, `:1741` `tab-hide`,
  `:1778` `tab-set-active`, `:1833` `tab-set-bounds`, `:1868`/`:1882`/`:1909` `find-overlay:*`
  sender-validated handlers — **OK** (fresh grep this session)
- `src/renderer/renderer.js:131-136` `positionKebabMenu`, `:139-159` kebab entry (freeze `:152`,
  `:157`), `:166-182` item actions, `:184-187` trigger toggle, `:2394+` shortcut keydown handler
  (`keydownToAction` call at `:2402`) — **OK**
- `src/renderer/menu-controller.js:57-92` menu keydown contract, `:114-123` global
  pointerdown/blur, `:137-142` dual export — **OK**
- `src/shared/keydown-action.js:40-73` action map — **OK**
- `src/main/automation/resolve.js:69` "SOLE relaxation" doc, `:92-94` DD6 comment, `:95` guard,
  `:141-157` `resolveContentsForJar` (chrome-exclusion `:148-150`, session identity `:151`) —
  **OK**
- `src/main/automation/engine.js:25-29` allowInternal doc, `:40` `createEngine`, `:61` deps
  base — **OK**
- `src/main/automation/scope.js:111-129` `memberDeps` + wcId-first façade — **OK**
- `test/unit/automation-scope.test.js:142-191` out-of-jar pins — **OK**
- `src/preload/chrome-preload.js:10` `exposeInMainWorld` — **OK**

All citations verified against the post-Leg-1 tree at leg design time (Leg 1 shifted main.js
anchors; all re-derived fresh rather than carried from the flight spec).
