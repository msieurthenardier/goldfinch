# Flight: Custom Page Context Menu + Spellcheck

**Status**: completed
**Mission**: [Standard Browser Conveniences](../../mission.md)

## Contributing to Criteria
- [ ] **SC6 — Custom page context menu.** Right-clicking page content opens an **on-brand,
  keyboard-operable** custom context menu (not the native OS menu) with context-appropriate actions
  (link / image / selection / editable-field, and an **Inspect** entry point). The existing toolbar
  right-click (**Unpin**) is migrated onto the same component, retiring the native menu and closing the
  M02 Known Issue. (*behavior-test-backed / a11y*)
- [ ] **SC3 — Spellcheck.** Misspelled words typed into editable web fields are flagged, and spelling
  suggestions are reachable (through the new context menu). (*behavior-test-backed*)
- [x] **Debrief carry-forward #2 — inline-Electron-handler test seam** (Flight 3 debrief Rec 2): the
  chrome-side keydown shortcut dispatch gets a pure, unit-tested `(key,mods)→action` mapper. *(Scoped
  into Leg 3 `keydown-test-seam`; see DD5. Earlier planning text said "Leg 5" from a pre-split 5-leg
  sizing — corrected to match the live leg list.)*
- [x] **Debrief carry-forward #5 — `freePortInRange` flake** (Flight 3 debrief Rec 5 / Action Item):
  one-line assertion fix at `test/unit/automation-port.test.js`. *(Folded into Leg 3 `keydown-test-seam`;
  see DD5.)*

---

## Pre-Flight

### Objective

Give Goldfinch a **custom, on-brand, keyboard-operable page context menu** for web content and turn on
**in-field spellcheck** whose suggestions surface through that menu. This is the mission's heaviest
non-DevTools flight: it adds a new **guest `context-menu` event → chrome-renderer IPC** path (carrying
rich params incl. `dictionarySuggestions`), builds the menu as the **4th `menuController` consumer**,
**migrates the toolbar Unpin off the native Electron menu** (retiring it, closing the M02 Known Issue),
and turns on **opt-in spellcheck** with a deliberate dictionary-egress posture. It also pays down two
Flight-3 debrief carry-forwards that touch the keyboard/test surface (#2 the handler test seam, #5 the
`freePortInRange` flake).

This flight inherits the Flight-3 debrief lessons as up-front design decisions:
1. **`<webview>` event delivery is per-event-class — spike it** (debrief KL#1): `found-in-page` fired
   renderer-tag-only; `devtools-*` fired both-sided. Leg 1 spikes the `context-menu` event before
   depending on a delivery side (DD2/DD8).
2. **Premise-audit the behavior-test apparatus on both axes** (act + observe): done at planning — the
   `click {button:'right'}` op dispatches a *real* native context-menu event; the menu is observable via
   the chrome target. No reactive test seam needed (DD8).
3. **Renderer keyboard logic is operator-found and under-tested** (debrief Rec 2): the keydown dispatch
   gets a pure testable mapper (DD5) + the optional HAT as the safety net for menu feel.

### Open Questions
- [x] **Spellcheck dictionary-CDN egress** → **default-OFF + Settings opt-in; on opt-in, accept the
  documented one-time Google CDN dictionary fetch per language** (Linux/Windows; macOS uses the native
  speller, no fetch). No bundling, no installer growth; the egress is documented in the privacy notes.
  (operator, DD1)
- [x] **`menuController` graduation** → **extend in place** (4th consumer); it is DOM-coupled and cannot
  live in the electron-free `src/shared`. Graduation seeded as future renderer-maintenance. (architect,
  DD3)
- [x] **Sizing** → **one flight, 6 autonomous legs + optional HAT** (SC6 and SC3 are coupled — spelling
  suggestions render *inside* the context menu; the independent keydown-test-seam is its own leg per the
  architect review). (architect, DD7-sizing)
- [x] **Test-seam depth (#2)** → **renderer-only pure `(key,mods)→action` mapper, unit-tested**;
  main-side `before-input-event` stays inline with a behavior-test net. NOT one unified fn across the
  Electron/DOM event shapes. (architect, DD5)
- [x] **Does spellcheck / the context menu warrant MCP tools?** → **No.** Both are page-driven, not
  agent-driven; SC8 explicitly excludes them. No new MCP tools; tool count stays **26**. (DD7)
- [x] **Context menu on internal `goldfinch://` pages?** → **No-op** (no custom menu), mirroring the
  other web-only controls and the trust-boundary constraint. (DD6)

### Design Decisions

**DD1 — Spellcheck is opt-in (default OFF), gated at the SESSION layer so the toggle applies to
already-open tabs; on opt-in, accept the documented one-time CDN dictionary fetch.** Add a `spellcheck`
boolean to `settings-store.js` `DEFAULTS` (default `false`). It rides the existing merge-with-repair
normalizer (`load()`; the `toolbarPins.devtools` precedent) — **no `SCHEMA_VERSION` bump, no migration**;
only the `@typedef Settings` annotation gains the key (typecheck).

**Runtime-semantics fix (architect [HIGH]):** `webPreferences.spellcheck` is set once at
`will-attach-webview` and is **immutable after attach** — gating on it would make a runtime toggle apply
to *new tabs only*. Instead **gate at the session layer**: the feature is toggled via
`session.setSpellCheckerLanguages(...)`, which is **session-scoped** and therefore reaches
already-attached guests. ON → `setSpellCheckerLanguages(['en-US'])` on the **web sessions only**
(`defaultSession`, `PAGE_PARTITION 'persist:goldfinch'`, + per-jar via the `session-created` hook
`src/main/main.js:1071`); OFF → `setSpellCheckerLanguages([])`. **Never** the `__goldfinchInternal`
session (`src/main/main.js:1101`); set `webPreferences.spellcheck = false` on the **internal branch** of
`will-attach-webview` (`src/main/main.js:276-281`) as defense-in-depth, and leave the web branch
(`:282-284`) at Electron's default.
- **Leg-2 first-step verification (premise-audit, don't assume):** confirm (a) Electron `^42`'s
  `webPreferences.spellcheck` default for web guests, and (b) that `setSpellCheckerLanguages` toggles
  squiggles on an **already-open** guest without reload. Wire per the result. **Pre-authorized fallback:**
  if live application proves not to work, ship "applies to new tabs; reload to enable on open tabs" and
  document it in the toggle help + the behavior spec — do NOT silently leave the behavior spec's
  "wait-for-squiggle" step failing on a pre-opt-in tab.
- On Linux/Windows the first editable-focus after enabling triggers a one-time per-language Hunspell
  `.bdic` GET from the Chromium CDN (`redirector.gvt1.com/edgedl/chrome/dict/…`); **this egress is
  accepted and documented** in README privacy notes + CLAUDE.md (only after explicit opt-in). On macOS
  Electron uses the native `NSSpellChecker` — no fetch. Suggestions surface through the context menu
  (DD2); a chosen suggestion round-trips chrome→main→guest `contents.replaceMisspelling(word)`.
- Rationale: honors "spellcheck must not silently leak egress" (mission Constraint) — nothing fetches
  until opt-in, then documented; session-layer gating makes the toggle live; zero installer growth, zero
  new deps. (operator)
- Trade-off: opted-in Linux/Windows users make one documented third-party GET to Google per language.
  Re-evaluate bundling if the privacy posture tightens.

**DD2 — Custom page context menu: guest `context-menu` event (main) → IPC → chrome renderer, rendered
via `menuController`.** The Electron `context-menu` event fires on the **main-process guest
`webContents`** with rich `params` (`linkURL`, `imageURL`, `selectionText`, `isEditable`,
`misspelledWord`, `dictionarySuggestions`, `x`, `y`, `editFlags`). Wire it in the
`app.on('web-contents-created')` block (`src/main/main.js:337-427`, inside the existing
`!__goldfinchInternal` guard at `:362`, alongside `before-input-event`/`devtools-state-changed`); `event.preventDefault()` the
native menu; forward the params to the chrome renderer via `mainWindow.webContents.send('page-context-menu',
{ wcId, params })` (mirroring the `zoom-changed`/`devtools-state-changed` broadcast). The chrome renderer
renders a new `#page-context-menu` DOM node (mirroring `#kebab-menu`/`#container-menu`) at the cursor
position with context-appropriate sections. **Leg-1 spike (DD8) confirms the delivery side first.**
- Rationale: reuses the established guest-event→broadcast pattern; keeps the menu in the on-brand chrome
  DOM (not the native OS menu), keyboard-operable and behavior-testable.
- Trade-off: a new IPC channel + a correction round-trip channel (`replaceMisspelling`).

**DD3 — `menuController` extended in place as the 4th consumer; NOT graduated to a shared module.**
`menuController` (`renderer.js:126-209`) is renderer-DOM-coupled (closes over `document`, wires global
`pointerdown`/`blur` listeners) — it cannot live in the electron-free `src/shared`. Register the context
menu via `menuController.register({trigger, menu, items, onOpen, onClose})`, reusing the APG keyboard
contract (Enter/Space/Arrow/Esc/Tab/Home/End, roving tabindex) unchanged. The context menu's
differences (cursor-position open, dynamic items, no persistent trigger button) are handled in its
`onOpen`/`items`. Graduation (extract to a renderer module + lift the global listeners) is seeded as a
future renderer-maintenance item — more warranted now (4 consumers) but out of this flight's altitude.
- Rationale: the reuse you need is available in place; graduation raises blast radius across the 3
  existing consumers for no functional gain this flight. (architect)
- Trade-off: the eventual module extraction is deferred.

**DD4 — Migrate the toolbar Unpin (Media/Shields/DevTools) off the native menu onto the custom
component.** Replace `Menu.buildFromTemplate`+`menu.popup` (`main.js:985-996`) and the three renderer
`contextmenu` listeners (`renderer.js:988/1567/1591` → `window.goldfinch.toolbarContextMenu`) with a
custom menu rendering driven by the same component (a toolbar-mode invocation with a single "Unpin
{Media|Shields|DevTools}" item). Retire the `toolbar-context-menu` IPC handler + the `toolbarContextMenu`
preload bridge. Closes the M02 Known Issue (native-menu clumsiness against the dark/gold chrome).
- Rationale: SC6 explicitly requires retiring the native menu; consolidating both right-click surfaces
  on one component is the point.
- **Write-path fix (architect [HIGH]):** the renderer CANNOT use the existing settings-write IPC —
  `internal-settings-set` (`src/main/main.js:792`) is origin-gated to `goldfinch://settings`
  (`__goldfinchInternal`), and the chrome preload deliberately exposes only `settingsGet`/
  `onSettingsChanged` (`chrome-preload.js:35-37`). Leg 4 adds a **new narrow chrome-trusted one-way IPC
  `unpinToolbarItem(item)`** + preload bridge, mirroring the trust model of the retiring
  `toolbar-context-menu` send (same domain as `window-minimize`/`app-quit`; no origin check; NOT a
  general settings-write surface — keep the boundary narrow). Main's handler does `settings.set('toolbarPins',
  {…, [item]: false})` + `broadcastToChromeAndInternal('settings-changed', …)` — the **same** write+broadcast
  the native handler did, so the live two-way pin sync (`applyToolbarPins` reacting to `settings-changed`,
  `renderer.js:1746-1748`) is preserved with no staleness hole.
- Trade-off: one new narrow chrome IPC + bridge replacing the retired `toolbarContextMenu` send.

**DD5 — Keydown dispatch test seam (#2): a renderer-only pure `(key,mods)→action` mapper, unit-tested;
main-side stays inline + behavior-test net.** Extract `keydownToAction({key, ctrl, meta, shift,
lightboxOpen}) → 'devtools'|'zoom-in'|'zoom-out'|'zoom-reset'|'find'|'new-tab'|…|null` (a pure function,
no DOM). **Extraction target is the GLOBAL chrome shortcut handler at `src/renderer/renderer.js:2256`
ONLY** — the lightbox-scoped keydown handler at `:1287` (which maps `+`/`-`/`0` to *image scale*, different
semantics) is **deliberately excluded** (architect [low]). It gets real offline unit tests (closes the
renderer half of the 3-flight blind spot + the growing collision surface). The main-side
`before-input-event` (`src/main/main.js:357`) stays inline (consistent with shipped siblings; the
`isAutoRepeat`/F12-before-the-gate/Ctrl+Shift+I-vs-P asymmetries are Electron-specific and load-bearing) —
verified by the behavior-test net, not a forced shared fn. The context menu's **internal** keyboard nav
(arrows/Esc/Enter/Home/End) is `menuController`'s APG contract, NOT `keydownToAction`; the **Shift+F10 /
ContextMenu-key "open menu"** invocation is menu-specific (handled where the menu is wired), so the menu
component does **not** depend on this mapper — the test-seam leg is independent. Also fold the
**`freePortInRange` one-liner** (#5): `assert.ok(result === null || result === port + 1)` at
`test/unit/automation-port.test.js`.
- Rationale: tests the asymmetry instead of hiding it; pays down debt on the surface this flight already
  touches (keyboard). (architect)
- Trade-off: the main-side branch remains inspection+behavior-test-verified, not unit-tested.

**DD6 — Web-content-only; the menu is inert/absent on internal pages; Inspect routes through the
existing web-only DevTools path.** The whole `context-menu` wiring sits inside the `!__goldfinchInternal`
guard (`src/main/main.js:362`), so internal guests never get the custom menu (default behavior /
nothing). **Inspect routes through the existing `toggle-devtools` IPC handler** (Flight 3,
`src/main/main.js`), which resolves the guest by `wcId` and applies `isInternalContents` — never opens
DevTools on `goldfinch://`. NOTE (architect [low]): `src/main/devtools.js` itself is **guard-free** (it
documents "assumes a pre-guarded wc"), so the guard lives in the IPC handler, not the helper — Inspect
must go through the handler, not call the helper directly. The correction round-trip
(`replaceMisspelling`) likewise resolves the target by the originating guest `wcId` and refuses the
internal session (`isInternalContents`) — it must not become a write-into-arbitrary-webContents primitive
(the Flight-3 TOCTOU discipline).
- Rationale: mission trust-boundary constraint (DevTools + context menu target web content only).

**DD7 — No new MCP tools; tool count stays 26.** Spellcheck and the context menu are page-driven, not
agent-driven (mission SC8 + Open Question). Record the SC8 exclusion explicitly. The
`mcp-tools.js` surface is untouched.
- Rationale: agent parity applies to capabilities an agent could reasonably drive; these aren't them.

**DD8 — Behavior-test apparatus = the M03 automation surface; both axes audited at planning.** *Act*:
`click {button:'right'}` (`input.js` `mouseClickEvents` supports `button` via `sendInputEvent` — a
**real** native `context-menu` event with genuine `dictionarySuggestions`) + `typeText` (real
misspellings into an editable field). *Observe* (read path): the chrome-rendered `#page-context-menu`
via `getChromeTarget` → `readDom`/`captureScreenshot` (the menu lives in the chrome renderer), and/or the
forwarded `page-context-menu` params payload. **Spike (Leg 1):** confirm the `context-menu` event fires
on the guest `webContents` with the full rich payload (and whether it also surfaces on the `<webview>`
tag — if so prefer the renderer-direct path). Pre-authorized fallback: guest-only → main→IPC as designed.
The spellcheck `dictionarySuggestions` populate only after the dict loads (the one-time CDN fetch on
Linux); the test waits for the squiggle/suggestions. macOS native-speller verification of suggestions is
macOS-authoritative; the squiggle-flagging + menu rendering + Linux suggestions are WSLg-testable.
- Rationale (both axes cited): act = `click {button:'right'}` + `typeText`; observe = chrome
  `getChromeTarget`+`readDom`/screenshot + the IPC params. No reactive test seam needed.

### Prerequisites
- [ ] M03 automation surface runnable (`npm run dev:automation`); `click` (with `button:'right'`),
  `typeText`, `getChromeTarget`, `readDom`, `captureScreenshot`, `evaluate` available — landed (M03).
- [ ] `menuController` + the 3 existing consumers (container/kebab/site-info) — landed (M02).
- [ ] The native `toolbar-context-menu` path (`main.js:985-996`, renderer `:988/1567/1591`,
  preload `:19`) — present, to be retired by Leg 4.
- [ ] Flight-3 DevTools helper (`src/main/devtools.js`) for the Inspect item — landed.
- [ ] A real display for the HAT; spellcheck **macOS** native-speller path is macOS-authoritative (per
  the mission's platform plan); Linux CDN-dict + squiggle + menu are WSLg-testable.
- [ ] Accessibility gate runnable (`npm run a11y`); a context-menu-open audit state may be added
  (Flight-2/3 state-driver precedent).

### Pre-Flight Checklist
- [x] All open questions resolved (DD1–DD8)
- [x] Design decisions documented
- [x] Prerequisites identified
- [x] Validation approach defined (behavior specs `page-context-menu` + `spellcheck`; unit tests for the
  keydown mapper + settings; a11y gate; HAT for feel)
- [x] Legs defined (6 + optional HAT)
- [x] Architect design review incorporated (pre-draft consult + 1 spec-review cycle — *approve with
  changes*; all applied: DD1 session-layer gating for live runtime toggle [HIGH], DD4 new narrow
  chrome-trusted `unpinToolbarItem` IPC [HIGH], keydown-test-seam split into its own leg + Leg-3 decoupled
  [med], DD5 scoped to `renderer.js:2256` only [low], DD6 Inspect via the `toggle-devtools` IPC not
  `devtools.js` [low], full src paths + `web-contents-created` `:337` anchor, `toolbar-pins.md` update +
  a11y chrome-side state-driver noted)

---

## In-Flight

### Technical Approach

**`context-menu-ipc`.** Wire the guest `context-menu` event in `web-contents-created`
(`src/main/main.js:337-427`, inside `!__goldfinchInternal`); `event.preventDefault()`; forward
`{wcId, params}` to the chrome renderer (`mainWindow.webContents.send('page-context-menu', …)`); add the
`replaceMisspelling`/edit-action correction channel (chrome→main→guest, target by `wcId`, internal
refused). **First step: the spike** — confirm delivery side + payload (DD8).

**`spellcheck-enable` (parallel with `context-menu-ipc`).** `settings-store` `spellcheck:false` default +
`@typedef`. **First step: verify the DD1 premise** (Electron `^42` `webPreferences.spellcheck` default +
live `setSpellCheckerLanguages` on open guests). Session-layer gate: `setSpellCheckerLanguages(['en-US'])`
ON / `[]` OFF on web sessions in `app.whenReady` (`src/main/main.js:1085-1102`) + the `session-created`
hook for jars; `webPreferences.spellcheck=false` on the internal `will-attach-webview` branch; Settings
opt-in toggle (chrome read via `settingsGet`/`onSettingsChanged`; the write goes through the settings
page or a chrome-trusted toggle IPC); accept-CDN egress documented. Squiggles render with zero context
menu; only *suggestions* need the menu component.

**`keydown-test-seam` (parallel; independent).** Extract the pure `keydownToAction` mapper from the
global chrome shortcut handler (`src/renderer/renderer.js:2256` only) + offline unit tests; fold the
`freePortInRange` one-liner. Lands before `context-menu-component` for tidy sequencing (no hard dep — the
menu's keyboard nav is `menuController`, not the mapper).

**`context-menu-component` (needs `context-menu-ipc` + menuController).** New `#page-context-menu` DOM
node; `menuController.register` (4th consumer, in place); context-appropriate sections (link: open/copy;
image: open/copy/save; selection: copy/search; editable: cut/copy/paste/undo/redo + **spelling
suggestions**; always: **Inspect** → the existing `toggle-devtools` IPC path). Cursor-position open;
**focus-return target + Shift+F10 / ContextMenu-key invocation** (menu-specific) for a11y; no-op on
internal; correction → `replaceMisspelling`.

**`migrate-toolbar-unpin` (needs `context-menu-component`).** Replace the native menu
(`src/main/main.js:985-996`) + the 3 renderer `contextmenu` listeners with a toolbar-mode invocation of
the custom component; add the new narrow chrome-trusted `unpinToolbarItem(item)` IPC + bridge (DD4); retire
the `toolbar-context-menu` IPC + `toolbarContextMenu` bridge; preserve the live pin two-way sync.

**`verify-integration`.** Behavior specs `page-context-menu` + `spellcheck` (authored + run); update
`tests/behavior/toolbar-pins.md` for the migrated unpin path; README (context-menu + spellcheck + the
documented egress) + CLAUDE.md notes; `npm run a11y` (+ a chrome-side menu-open state-driver fn if the
open state needs auditing); regression sweep of the keydown/`before-input-event` handlers. **No MCP
tool-count change.**

### Checkpoints
- [ ] Right-click on web content opens the on-brand custom menu (not native), context-appropriate, at the
  cursor; keyboard-operable (arrows/Esc/Enter + Shift+F10 invocation); no-op on `goldfinch://`.
- [ ] Toolbar right-click Unpin (Media/Shields/DevTools) uses the custom component; native menu retired;
  pin state still persists + syncs live.
- [ ] Inspect opens DevTools for the active web tab via the existing web-only path (inert on internal).
- [ ] Spellcheck opt-in flags misspelled words in editable fields; right-click surfaces suggestions;
  choosing one corrects the word; OFF by default; no fetch until opt-in.
- [ ] `page-context-menu` + `spellcheck` behavior specs green (WSLg for menu/squiggle/Linux-suggestions;
  macOS-authoritative for the native-speller suggestion path); `npm run a11y` clean; keydown mapper
  unit-tested; `freePortInRange` flake fixed; docs updated; **tool count 26**.

### Adaptation Criteria

**Divert if**:
- The `context-menu` event does not deliver the rich params on any reachable side (spike fails both
  guest `webContents` and `<webview>` tag) — re-plan the param path before building the menu.

**Acceptable variations** (pre-authorized):
- The `context-menu` event surfaces on the `<webview>` tag too → prefer the renderer-direct path over the
  main→IPC round-trip (DD8 fallback).
- Spellcheck suggestion verification on macOS deferred (native-speller path is macOS-authoritative); the
  squiggle + menu + Linux-CDN suggestions carry the WSLg acceptance.
- `menuController` graduated this flight only if the operator explicitly asks — as a dedicated standalone
  leg with a 4-consumer regression net (default: in place, DD3).

### Legs

> **Note:** Tentative; planned and created one at a time as the flight progresses.

- [x] `context-menu-ipc` — guest `context-menu` event capture (`web-contents-created`, internal-guarded)
  + `event.preventDefault()` + `page-context-menu` param IPC to the chrome renderer + the correction
  round-trip channel (`replaceMisspelling`, target-by-`wcId`, internal-refused). **First step: the ~5-min
  spike** — does `context-menu` fire on the guest `webContents` with the full rich payload
  (`dictionarySuggestions`/`misspelledWord`/`isEditable`/`linkURL`/`imageURL`/`selectionText`), and/or on
  the `<webview>` tag? Wire the confirmed side (DD2/DD8).
- [x] `spellcheck-enable` — `settings-store` `spellcheck:false` default + `@typedef`. **First step:
  verify Electron `^42`'s `webPreferences.spellcheck` default + that `setSpellCheckerLanguages` toggles an
  already-open guest live** (DD1 premise-audit). Session-layer gating: `setSpellCheckerLanguages(['en-US'])`
  ON / `[]` OFF on web sessions (+ `session-created` jar hook), never internal; `webPreferences.spellcheck=false`
  on the internal `will-attach-webview` branch (defense). Settings opt-in toggle (+ controller); accept-CDN
  egress documented. (Parallel with `context-menu-ipc` + `keydown-test-seam`.)
- [x] `keydown-test-seam` — extract the pure `keydownToAction` mapper from the global chrome shortcut
  handler (`src/renderer/renderer.js:2256` ONLY; exclude the lightbox `:1287` handler) + offline unit
  tests (debrief #2); fold the `freePortInRange` one-liner (debrief #5,
  `test/unit/automation-port.test.js`). **Independent — parallelizable with `context-menu-ipc` +
  `spellcheck-enable`, lands before `context-menu-component`.**
- [x] `context-menu-component` — `#page-context-menu` DOM; `menuController` 4th consumer (in place);
  context-appropriate sections incl. **Inspect** (→ the existing `toggle-devtools` IPC path, NOT
  `devtools.js` directly) and **spelling suggestions**; cursor-position open; focus-return + Shift+F10/
  ContextMenu-key invocation (menu-specific, not via the mapper); a11y (roles, roving, name); no-op on
  internal; correction → guest `replaceMisspelling`. [needs `context-menu-ipc`]
- [x] `migrate-toolbar-unpin` — move Media/Shields/DevTools Unpin onto the custom component; **new narrow
  chrome-trusted `unpinToolbarItem(item)` IPC + preload bridge** (the renderer cannot use the
  internal-origin-gated settings-write — DD4); retire the native `toolbar-context-menu` handler +
  `toolbarContextMenu` bridge; preserve live pin sync; closes the M02 Known Issue. [needs
  `context-menu-component`]
- [x] `verify-integration` — behavior specs `tests/behavior/page-context-menu.md` + `tests/behavior/spellcheck.md`
  (authored + run on WSLg; macOS-authoritative bits noted); **update `tests/behavior/toolbar-pins.md`** for
  the migrated unpin path; README (context menu, spellcheck, documented CDN egress) + CLAUDE.md notes;
  `npm run a11y` — to audit the menu-open state it needs a **chrome-side state-driver fn** (like
  `openLightbox`/`togglePanel`; the audit can't fire a guest `context-menu` event), add one if warranted;
  regression sweep of the keydown/`before-input-event` handlers. **No MCP tool-count change (26).**
- [x] `hat-and-alignment` *(optional)* — guided HAT: the menu's feel/placement/keyboard (incl. Shift+F10
  + focus-return), each context section (link/image/selection/editable/Inspect), the toolbar-Unpin
  migration, and spellcheck (squiggles + right-click suggestions + correction) — fixing issues inline.
  *(Completed 2026-06-19: 6 inline fixes incl. cursor positioning, menu UX, arrow-dismiss, correction
  first-click, spellcheck relocation, a11y `.ps-list`; `npm run a11y` GREEN; SC6/SC3 operator-accepted.)*

---

## Post-Flight

### Completion Checklist
- [x] All legs completed (6 autonomous legs landed + reviewed; `[HANDOFF:confirmed]`)
- [ ] Code merged (draft PR opened; merge after HAT)
- [~] Tests passing — unit suite **879 pass / 0 fail** incl. the keydown mapper + settings; typecheck +
  lint clean; tool count 26. The `page-context-menu` + `spellcheck` **behavior specs are authored
  (`draft`) but not yet executed** — the `/behavior-test` runs + `npm run a11y` open-menu sweep are
  HAT-scope (WSLg can't render squiggles / drive the a11y harness non-interactively). SC3/SC6 hold open
  until those pass.
- [x] Docs updated (README context-menu + spellcheck + documented CDN egress; CLAUDE.md page-context-menu
  + spellcheck architecture notes; the stale toolbar-unpin section rewritten)

### Verification
- **SC6** — right-click web content → on-brand keyboard-operable custom menu with context-appropriate
  actions + Inspect; toolbar Unpin migrated onto it; native menu retired (M02 Known Issue closed);
  `page-context-menu` behavior spec green; `npm run a11y` clean.
- **SC3** — opt-in spellcheck flags misspellings in editable fields; suggestions reachable via the menu;
  corrections apply; OFF by default with no fetch until opt-in; `spellcheck` behavior spec green on WSLg
  (native-speller suggestion path macOS-authoritative).
