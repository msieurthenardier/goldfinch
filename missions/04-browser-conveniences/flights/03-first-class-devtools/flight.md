# Flight: First-class DevTools

**Status**: completed
**Mission**: [Standard Browser Conveniences](../../mission.md)

## Contributing to Criteria
- [x] **SC5 — First-class DevTools.** The operator can open Chromium DevTools for the **active web
  tab** as a first-class tool: a **pinnable toolbar button** (via the existing `toolbarPins`
  mechanism, pin state persisted across restart, pinnable/unpinnable from right-click and from
  Settings → Appearance), **plus** a conventional shortcut (`F12` / `Ctrl+Shift+I`) that works
  **even when unpinned**. DevTools opens in Chromium's **native detached window** (not embedded —
  `<webview>` guests have no native host region; docked DevTools awaits the `WebContentsView`
  migration). DevTools targets **web content only** — never `goldfinch://` internal pages or the
  chrome. Its interaction with the automation **debugger single-client lock** is **surfaced with no
  opaque failure** (the M03 `debugger-unavailable` refusal), and this flight finally **stages the
  M03 `devtools-cdp-conflict` observation** now that a non-CDP open affordance exists.

---

## Pre-Flight

### Objective

Give Goldfinch a **first-class, user-facing way to open DevTools** for the active web tab. Today
DevTools is reachable *only* through the M03 automation/MCP tools (`openDevTools`/`closeDevTools`) —
there is no button or shortcut. This flight adds: a **pinnable toolbar button** (the third
`toolbarPins` item, alongside Media and Shields), **`F12` / `Ctrl+Shift+I`** shortcuts that work
whether or not the button is pinned, opening Chromium's **native detached window**, **web-content
only** (inert on `goldfinch://`). It deliberately *reuses* the M03 open/close logic and the existing
`toolbarPins` + native right-click seams rather than reinventing them, and it **re-stages the
`devtools-cdp-conflict` behavior test** — which M03 left inconclusive precisely because there was no
non-CDP way to open DevTools.

This flight inherits three carry-forward lessons applied as up-front design decisions:
1. **Query Chromium truth on demand for session-owned implicit state** (Flight 1 KL#2): DevTools
   open/closed state is read from `wc.isDevToolsOpened()`, not a cached renderer flag.
2. **Verify the `<webview>`-guest event-delivery frame before depending on it** (Flight 2 D1): a
   5-min spike confirms whether `devtools-opened`/`devtools-closed` fire on the *main-process guest
   `webContents`* (`found-in-page` did **not**, last flight) — the design degrades gracefully to
   on-demand `isDevToolsOpened()` if they don't.
3. **Renderer logic is where the bugs live and they're operator-found** (Flight 1 KL#4): the
   button/shortcut/pin renderer logic gets the optional HAT as its safety net.

### Open Questions
- [x] **DevTools default pin state** → **`false` (unpinned)**. Power-user tool; Media/Shields stay
  pinned (core to the thesis); shortcuts work regardless; opt-in via right-click / Settings. (DD4,
  operator)
- [x] **Debugger-lock UX scope** → **stage the existing automation refusal; no new UI** (Option A).
  The `debugger-unavailable`/`attach-failed` refusal is a correct, Chromium-hard-constraint behavior
  already built in M03; a human-facing "agent blocked by your DevTools" notice belongs with a future
  automation-activity surface, not this conveniences flight. (DD7, operator)
- [x] **`F12` capture (no modifier)** → the main `before-input-event` handler early-returns on
  `!(input.control||input.meta)`, so `F12` needs a branch **before** that modifier gate; `Ctrl+Shift+I`
  fits the gated path. Renderer chrome-focused fallback mirrors. (DD2)
- [x] **Button open/closed state source of truth** → `wc.isDevToolsOpened()` queried on demand;
  `devtools-opened`/`devtools-closed` events wired for live update **only if** the leg-1 spike
  confirms they fire on the guest `webContents`. (DD3)
- [x] **Behavior-test apparatus / WSLg** → M03 automation surface; the **detached DevTools window +
  the live CDP conflict are macOS-authoritative** (the `devtools-cdp-conflict` spec was already
  inconclusive under WSLg; Flight 2 confirmed this class). Pin/shortcut logic is unit + HAT on WSLg.
  (DD8)

### Design Decisions

**DD1 — User-facing open/close runs main-side via a shared helper; the renderer drives it by a
two-way IPC carrying an explicit `wcId`, not through the MCP transport.** Factor the open/close core
out of the M03 MCP ops (`observe.js` `openDevTools`/`closeDevTools`, `wc.openDevTools({mode:'detach'})`
/ `wc.closeDevTools()` + the op-local `isInternalContents` guard) into a shared main-side helper. The
renderer calls **`window.goldfinch.toggleDevtools(wcId)` — an `ipcRenderer.invoke` (two-way)** that
returns the **post-toggle `wc.isDevToolsOpened()`** so the renderer sets `aria-pressed` from the
authoritative state (architect Q1: two-way `invoke` over zoom's one-way `send`+`get-zoom`, because the
button must reflect real open/closed state). A companion **`isDevtoolsOpen(wcId)` invoke** serves the
on-activation reconcile (DD3). **The IPC carries the explicit `wcId` captured at call time; main acts
on that `wcId` — never on `activeTab()` at receipt** (architect [medium] — forecloses a TOCTOU where
the active tab changes mid-round-trip). Three files: `src/preload/chrome-preload.js` (the
`toggleDevtools`/`isDevtoolsOpen` bridge, mirroring `zoomApply`/`getZoom`), `src/main/main.js`
(`ipcMain.handle`), `src/renderer/renderer.js` (the callers). Main resolves the guest contents, applies
the `isInternalContents` guard, then toggles via `isDevToolsOpened()` → open/close. The MCP ops call
the same helper.
- Rationale: one code path for the actual open/close + guard; the MCP tool stays the **agent** entry,
  the IPC is the **human** entry — the renderer must NOT go through the loopback MCP transport (auth +
  agent surface). Detached mode only (`<webview>` can't host docked DevTools — the `WebContentsView`
  migration constraint, BACKLOG.md).
- Trade-off: a small refactor of the M03 ops to extract the helper (covered by their existing tests).

**DD2 — `F12` (no modifier) + `Ctrl+Shift+I`, captured main-side in `before-input-event` with a
renderer chrome-focused fallback.** Page-focused (web content has focus): the main
`before-input-event` handler (`main.js:357`) gets an `F12` branch placed **before** the
`!(input.control||input.meta)` early-return, plus a `Ctrl+Shift+I` branch in the gated section
(`input.control && input.shift && (input.key==='I'||input.key==='i')`) → `event.preventDefault()` +
`toggle-devtools` to the renderer (or open directly main-side). Chrome-focused fallback
(`renderer.js:2198` document keydown): add `F12` (needs its own branch before the `if (!mod) return`
gate) and `Ctrl+Shift+I`, guarded by `isInternalTab` + the open-lightbox check (mirroring `Ctrl+F`).
- Rationale: `F12` is the universal DevTools key; `Ctrl+Shift+I` the conventional alternate; mirrors
  the Flight-1/2 zoom/print/find capture pattern.
- Trade-off: `F12` is the first **modifier-less** shortcut intercepted — a small special-case in both
  handlers (a documented exception to the "modifier-gated" convention).

**DD3 — DevTools open/closed state is read on demand from `wc.isDevToolsOpened()`; the
`devtools-opened`/`devtools-closed` events are a live-update enhancement gated on a spike.** The
button is a toggle and reflects open/closed via `aria-pressed`/active styling. Source of truth:
`wc.isDevToolsOpened()` queried on tab activation and after a toggle (Flight 1 KL#2 — never cache
session-owned implicit state). **Leg-1 spike**: confirm whether `devtools-opened`/`devtools-closed`
fire on the **main-process guest `webContents`** for `<webview>` guests (Flight 2 D1 proved
`found-in-page` does **not**). **The spike must name which side fires it** (architect): the events are
declared on `WebContents`, so they may fire on the **main-process guest `webContents`** (wire
`contents.on('devtools-opened'/'devtools-closed', …)` at the guest-attach site in `main.js`) and/or be
mirrored to the renderer **`<webview>` tag** (wire `wv.addEventListener` in `wireWebview`) — the spike
confirms which, and the wiring goes there. If neither fires reliably, the on-demand `isDevtoolsOpen`
query suffices (the button may lag a user closing DevTools from the DevTools window's own control until
the next tab activation — acceptable).
- **Cache-freshness contract**: *source of truth* = `wc.isDevToolsOpened()` (main, queried live).
  *Rebuild triggers* = (a) post-toggle (the `toggleDevtools` invoke returns the new state), (b) tab
  activation (`isDevtoolsOpen(wcId)` invoke in the `activateTab` path), (c) optional live events if the
  spike confirms them. *Max staleness* = until next activation (only on a DevTools-window-initiated
  close with events absent). *Never cached*: the open/closed boolean is read, not stored.
- Rationale: forecloses the stale-state class that bit Flight 1 (zoom label) and Flight 2 (find
  count); degrades gracefully per the Flight-2 event-delivery lesson.

**DD4 — DevTools pin defaults to `false` (unpinned).** `settings-store.js` `DEFAULTS.toolbarPins`
gains `devtools: false`. The `toolbarPins` validator (any boolean-valued object) and normalizer
(`{...DEFAULTS.toolbarPins, ...v}` spread) need **no logic change** and **no schema-version bump** —
the normalizer + the `freshDefaults`/`getAll` spreads auto-populate `devtools` for existing settings
files. **Required code changes for typecheck (architect [medium]):** update the `@typedef Settings`
`toolbarPins` type in `settings-store.js` (`{ media, shields }` → `{ media, shields, devtools }`) and
the `applyToolbarPins` JSDoc param type in `renderer.js` — otherwise `npm run typecheck` fails on the
new key. Shortcuts work regardless of pin state; the button is opt-in.
- Rationale: power-user tool; uncluttered default toolbar; Media/Shields (thesis-core) stay pinned.
  (operator)

**DD5 — Web-content-only on both the human and agent paths.** Main `before-input-event` already
skips `__goldfinchInternal` sessions; the renderer open paths + fallback guard `isInternalTab`
(`renderer.js:608`); the main IPC open/close handler carries the op-local `isInternalContents` guard
(`resolve.js:28`), matching the MCP ops. `F12`/`Ctrl+Shift+I` on a `goldfinch://` tab open nothing;
the button is **inert** on internal tabs (no-op click) — **decided: inert, NOT hidden** (architect Q2).
Inert keeps `applyToolbarPins` stateless (pin-driven visibility only, no active-tab-type coupling);
the click/shortcut no-op via the `isInternalTab`/`isInternalContents` guard, exactly as the
zoom/find shortcuts already no-op on internal tabs without hiding chrome.
- Rationale: SC5 + the mission trust-boundary constraint — DevTools must never inspect the privileged
  internal pages or the chrome.

**DD6 — Pin/unpin reuses the `toolbarPins` seam end-to-end; the native right-click menu is reused,
NOT migrated.** `#toggle-devtools` plugs into `applyToolbarPins` (`renderer.js:1681`, the `.hidden`
toggle), the Settings → Appearance `#pin-devtools` toggle + the `settings.js` controller key-loop
(`:190`), and the existing native `toolbar-context-menu` IPC handler (`main.js:926`) gains a
`devtools` item. The native-menu clumsiness is the standing **M02 Known Issue** whose migration to
the custom context menu is **Flight 4's** scope — this flight deliberately does not touch it.
- Rationale: consistency with Media/Shields; minimal new surface; respects the flight boundary
  ("reuse existing seams, don't reinvent").

**DD7 — Debugger single-client lock: surface the EXISTING refusal; no new UI; stage it via the
behavior test.** Chromium allows one CDP client per `webContents`. Open native DevTools ⇒ it is that
client ⇒ the automation ops that attach the debugger (`readAxTree`, `scroll` via
`cdp.js withDebuggerSession`) return the discriminated `{debugger-unavailable, reason:'attach-failed'}`
(a normal result, M03). The CDP-free ops (`evaluate`, `injectScript`, `captureScreenshot`, `readDom`)
keep working; closing DevTools restores. This flight adds **no new lock UI** and **no new op code** —
its contribution is the **non-CDP open affordance** that removes M03's confound and lets
`devtools-cdp-conflict` be staged for real. "No code change" means production code only: the
**behavior-spec file does need textual edits** (architect) — its status, and the `Act` path rewritten
to open DevTools via the **new human affordance** (button/shortcut → IPC), the canonical SC5 vector
(the prior Flight-9 MCP-`openDevTools` run log is kept as a prior-finding, not deleted).
- Rationale: the refusal is correct and hard-constraint-driven; alternatives (two clients — impossible;
  force-detach the user's DevTools — hostile; queue — pointless) are worse. (operator, Option A)

**DD8 — Behavior-test apparatus = the M03 automation surface; SC5's live DevTools-window + CDP-conflict
are macOS-authoritative.** *Act*: open DevTools via the **new human affordance** (button/shortcut →
IPC → `wc.openDevTools`), then drive `readAxTree` / `evaluate` over the **MCP surface**. *Observe* (read
path): the MCP discriminated result — `readAxTree` → `debugger-unavailable`, `evaluate` → success —
plus `wc.isDevToolsOpened()` for window state. The detached-window materialization + the live conflict
are **macOS-authoritative** (the spec was inconclusive under WSLg; Flight 2 confirmed the class); on
WSLg they're smoke / inconclusive-tolerated. Pin/shortcut/button-a11y are unit + HAT on WSLg.
- Rationale (both axes audited): act path = `openDevTools` (IPC) + `readAxTree`/`evaluate` (MCP);
  observe path = the discriminated MCP results + `isDevToolsOpened()`. No reactive test-seam needed.

### Prerequisites
- [ ] M03 automation surface runnable (`npm run dev:automation`); `openDevTools`/`closeDevTools`,
  `readAxTree`, `evaluate` available — landed (M03 F9).
- [ ] `toolbarPins` mechanism + Settings → Appearance pin toggles (Media/Shields) — landed.
- [ ] `tests/behavior/toolbar-pins.md` (draft) and `tests/behavior/devtools-cdp-conflict.md`
  (archived/inconclusive) exist — to be extended / re-staged by this flight.
- [ ] A real display for the HAT; **a macOS session** for the authoritative DevTools-window + CDP
  conflict verification (per DD8 / the mission's "macOS confirmed later" plan).
- [ ] Accessibility gate runnable (`npm run a11y`); the find-bar 5th state-driver precedent
  (Flight 2) for adding a DevTools-button audit state if needed.

### Pre-Flight Checklist
- [x] All open questions resolved (DD2–DD8)
- [x] Design decisions documented
- [x] Prerequisites identified (M03 surface, toolbarPins, the two behavior specs, macOS for live SC5)
- [x] Validation approach defined (`toolbar-pins` extended for DevTools; `devtools-cdp-conflict`
  re-staged macOS-authoritative; HAT for the button/shortcut/window; a11y gate)
- [x] Legs defined (3 + optional HAT)
- [x] Architect design review incorporated (1 cycle — *approve with changes*; all applied: settings
  `@typedef`/`applyToolbarPins` JSDoc updates for typecheck [med], explicit-`wcId` TOCTOU guard on the
  toggle IPC [med], `chrome-preload.js` bridge cited + two-way `invoke` IPC decided [low], button
  inert-not-hidden on internal [Q], `devtools-cdp-conflict` status string + human-affordance act path
  [Q], native `toolbar-context-menu` allow-guard update, spike names both event-wiring sites)

---

## In-Flight

### Technical Approach

**Launch mechanism (main-side, shared helper).** Extract `openDevTools`/`closeDevTools` core from the
M03 MCP ops into a shared main-side helper (`{mode:'detach'}` + `isInternalContents` guard). Add a
renderer→main `toggle-devtools` IPC (preload bridge mirroring the zoom/find surface) carrying the
active tab's `wcId`; main resolves, guards internal, and toggles via `wc.isDevToolsOpened()` →
open/close. The MCP ops call the same helper (one code path).

**Shortcuts.** `F12` (no modifier) + `Ctrl+Shift+I`: main `before-input-event` (`main.js:357`) — `F12`
branch before the modifier gate, `Ctrl+Shift+I` in the gated section. Renderer chrome-focused fallback
(`renderer.js:2198`) — both, with `isInternalTab` + open-lightbox guards (the `Ctrl+F` pattern). Both
route to the same toggle.

**Toolbar button + pin.** `#toggle-devtools` in `index.html` (mirror `#toggle-media`/`#toggle-privacy`,
`aria-pressed` reflecting open state); `applyToolbarPins` gains the `devtools` `.hidden` toggle;
`settings-store` `DEFAULTS.toolbarPins.devtools=false`; Settings → Appearance `#pin-devtools` toggle
(`settings.html`) + the `settings.js` controller key-loop (`['media','shields','devtools']`); the
native `toolbar-context-menu` handler (`main.js:926`) gains a `devtools` unpin item. Button click
toggles DevTools via the launch mechanism.

**Open-state.** `wc.isDevToolsOpened()` on tab activation + post-toggle drives the button; a leg-1
spike decides whether `devtools-opened`/`devtools-closed` events (wired per-webview in `wireWebview`)
also drive live updates (DD3).

**Automation conflict (no code change — staging only).** The M03 `cdp.js` refusal already exists; this
flight's user affordance lets `devtools-cdp-conflict` be staged: open DevTools (human), then
`readAxTree` → `debugger-unavailable`, `evaluate` → works, close → restores.

### Checkpoints
- [x] `F12` / `Ctrl+Shift+I` open DevTools (detached) on a web tab — page-focused and chrome-focused;
  no-op on `goldfinch://`.
- [x] Pinnable `#toggle-devtools`: pin/unpin via right-click + Settings → Appearance, **persists
  across restart**; unpinned shortcuts still work; button reflects open/closed state (no stale state).
- [x] DevTools targets web content only (button inert + shortcuts no-op on internal tabs).
- [ ] `devtools-cdp-conflict` staged: DevTools open ⇒ `readAxTree` → `debugger-unavailable`,
  `evaluate`/`injectScript` still work, closing restores (**macOS-authoritative** — re-staged; live
  conflict verification deferred to macOS).
- [x] `toolbar-pins` extended green for DevTools; `npm run a11y` clean; docs updated; no MCP tool-count
  change (no new tools — the human path reuses `webContents` methods via IPC).

### Adaptation Criteria

**Divert if**:
- The detached DevTools window does not materialize even on macOS — SC5's window bit is then blocked;
  document it and defer docked/in-window DevTools to the `WebContentsView` migration mission (its
  headline unlock). The button/shortcut/pin still land as the user affordance.
- `devtools-opened`/`devtools-closed` do **not** fire on the guest `webContents` (the Flight-2
  event-delivery class) — fall back to `isDevToolsOpened()` on-demand only (no live event wiring);
  button reconciles on tab activation. (This is an *acceptable variation*, pre-authorized by DD3, not
  a true divert.)

**Acceptable variations**:
- Exact `#toggle-devtools` icon/placement refined during HAT.
- Whether DevTools open/close is issued from main directly or round-tripped through the renderer toggle
  (as long as one shared helper does the actual open/close + guard).

### Legs

> **Note:** Tentative; planned and created one at a time as the flight progresses.

- [x] `devtools-launch` — shared main-side open/close helper (factored from the M03 ops, `{mode:'detach'}`
  + `isInternalContents` guard); **`src/preload/chrome-preload.js`** `toggleDevtools(wcId)` +
  `isDevtoolsOpen(wcId)` bridges (two-way `ipcRenderer.invoke`, mirroring `getZoom`) + the `main.js`
  `ipcMain.handle` handlers (act on the **passed `wcId`**, not `activeTab()` — TOCTOU guard); `F12`
  (no-modifier branch, placed before the modifier gate) + `Ctrl+Shift+I` capture in `before-input-event`
  (`main.js:357`) + the renderer chrome fallback (`renderer.js:2198`) with `isInternalTab`/lightbox
  guards; web-content-only on both paths (button inert, not hidden, on internal); open-state via
  `wc.isDevToolsOpened()` on activation/post-toggle. **First step: a ~5-min spike** — do
  `devtools-opened`/`devtools-closed` fire on the **main-process guest `webContents`** (`contents.on`
  at the guest-attach site) and/or the renderer **`<webview>` tag** (`wv.addEventListener` in
  `wireWebview`)? Wire whichever fires; else on-demand `isDevtoolsOpen` only (DD3, Adaptation Criteria).
- [x] `devtools-toolbar-pin` — `#toggle-devtools` button (`index.html`, mirror Media/Shields,
  `aria-pressed` = open state); `applyToolbarPins` devtools toggle + **its JSDoc param type**;
  `settings-store` `DEFAULTS.toolbarPins.devtools=false` + **the `@typedef Settings` `toolbarPins` type**
  (validator/normalizer logic unchanged, no version bump — but the type annotations MUST gain `devtools`
  or `npm run typecheck` fails); Settings → Appearance `#pin-devtools` toggle (`settings.html`) +
  `settings.js` controller key-loop; native `toolbar-context-menu` handler (`main.js:926`) — add
  `devtools` to its `item !== …` allow-guard + the unpin item; button click toggles via the leg-1
  launch; persistence across restart; a11y (button name + pressed state).
- [x] `verify-integration` — extend `tests/behavior/toolbar-pins.md` for DevTools (pin/unpin/persist +
  unpinned-shortcut, mirroring Media/Shields); **re-stage** `tests/behavior/devtools-cdp-conflict.md`
  (status → **`active — macOS-authoritative; WSLg inconclusive tolerated`**; rewrite the `Act` path to
  open DevTools via the **new human affordance** (button/shortcut → IPC), keeping the prior Flight-9
  MCP-`openDevTools` run log as a prior-finding; assert `readAxTree` → `debugger-unavailable` while
  `evaluate` works; close → restores); README keyboard-shortcuts table (`F12`, `Ctrl+Shift+I`);
  `CLAUDE.md` DevTools-affordance note if warranted; `npm run a11y` (add a DevTools-button audit state
  to `a11y-audit.mjs` if the open/pressed state needs auditing, per the Flight-2 driver precedent);
  regression sweep of the `before-input-event`/keydown handlers. **No MCP tool-count change.**
- [ ] `hat-and-alignment` *(optional)* — guided HAT: pin/unpin/persist; `F12`/`Ctrl+Shift+I` (web- and
  chrome-focused); the detached DevTools window opening; internal-tab no-op; and the live CDP conflict
  (`readAxTree` refused while DevTools open, `evaluate` working) — fixing issues inline until the
  operator is satisfied. (macOS recommended for the window + conflict bits.)

---

## Post-Flight

### Completion Checklist
- [x] All legs completed
- [ ] Code merged
- [x] Tests passing (unit; `toolbar-pins` extended green; `devtools-cdp-conflict` staged —
  macOS-authoritative; a11y 0 new violations)
- [x] Docs updated (README shortcuts table; `CLAUDE.md` if warranted)

### Verification
- **SC5** — `F12`/`Ctrl+Shift+I` + the pinnable `#toggle-devtools` button open native detached DevTools
  for the active web tab, web-content-only, pin state persisted (HAT-confirmed; DevTools window
  macOS-authoritative); the `devtools-cdp-conflict` behavior test shows the `debugger-unavailable`
  refusal with `evaluate` still working (macOS-authoritative); `toolbar-pins` extended green;
  `npm run a11y` clean.
