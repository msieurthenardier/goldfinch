# Flight Log: First-class DevTools

**Flight**: [First-class DevTools](flight.md)
**Mission**: [Standard Browser Conveniences](../../mission.md)

This log captures runtime decisions, deviations, and anomalies during execution.

## Flight Director Notes

### 2026-06-19 — Flight kickoff
- Loaded crew phase file `.flightops/agent-crews/leg-execution.md` (Developer + Reviewer, both Sonnet;
  structure valid). Mission 04 `active`; flight was `ready` → set `in-flight`.
- Branch `flight/03-first-class-devtools` cut from `main` at f07b0f8 (post-0.5.4 / CI-audit-fix).
  Flight 3 planning artifacts carried untracked into this branch per the F1/F2 pattern (they ride
  into the flight commit).
- Plan: 3 autonomous legs (`devtools-launch`, `devtools-toolbar-pin`, `verify-integration`) reviewed
  per-design; single code review + commit deferred to flight end (skill protocol). Optional
  `hat-and-alignment` is operator-driven, offered after the autonomous legs land.
- Carry-forward watch items baked into the spec: leg-1 starts with the `<webview>` event-delivery
  spike (Flight-2 D1 class); detached-window + live CDP conflict are macOS-authoritative (DD8).

### 2026-06-19 — Flight-level review (deferred-commit, after all 3 autonomous legs)
- Each leg got a per-design review (Developer, 1 cycle each, all *approve with changes* — fixes applied
  before implementation; notably Leg-1 guard-ownership + auto-repeat, Leg-2 stale main.js citations +
  the guaranteed settings-store test regression, Leg-3 a11y find-bar cleanup + CLAUDE.md scope widening).
- Single flight-level code review over ALL uncommitted changes (Reviewer, fresh context): **[HANDOFF:
  confirmed]**, no blocking issues. Gates re-run by the Reviewer: `npm test` 841/0, typecheck clean, lint
  clean (a11y skipped in review — needs live GUI; recorded green incl. the new `devtools-button` state
  during Leg 3). Verified: single open/close code path (DD1), internal guard on both paths (DD5), TOCTOU
  (handlers act on passed wcId), F12 placement + auto-repeat guard, aria-pressed not aria-expanded,
  activateTab async-race re-check, settings forward-compat (devtools:false, no version bump), tool count 26.
- Non-blocking notes accepted: (1) CLAUDE.md "Pin-state propagation" sentence still listed only
  toggleMedia/togglePrivacy — folded a one-line fix into the flight commit; (2) F12+any-modifier also
  toggles (conventional, harmless); (3) the devtools-cdp-conflict banner reconciliation is operator-
  overridable (flagged below).
- **Operator flag (carry to debrief):** Leg 3 reconciled `tests/behavior/devtools-cdp-conflict.md`'s
  stale M03-era banners under M04-F3/DD7 authority and set status `active — macOS-authoritative; WSLg
  inconclusive tolerated`. One prior banner said "deferred to Flight 6" — if the operator intended it to
  stay deferred, override; the live flight spec directed the re-stage. Prior M03 run log preserved.

### 2026-06-19 — HAT pivot: DD5 reframed — pinnable toolbar buttons are TAB-SCOPED (operator)
- **Pivot (supersedes DD5's reasoning, recorded not rewritten):** DD5 chose "inert, not hidden, not
  disabled" on internal tabs and justified it as *avoiding* active-tab-type coupling
  (`applyToolbarPins` stays pin-driven only). The HAT surfaced the opposite truth: the pinnable toolbar
  buttons (Media, Shields, DevTools) are **all inherently tab-scoped** — they act on the *active tab's*
  content — so coupling their **enabled/disabled** state to the active tab type is the CORRECT model, not
  a violation. Operator decision (AskUserQuestion): **dim/disable all three on `goldfinch://` internal
  tabs.** This intentionally couples button state to tab type — the reverse of DD5's stated rationale.
  (DD5's *visibility* contract still holds: `applyToolbarPins` stays pin-driven; the new disabled-state is
  a SEPARATE tab-activation-driven mechanism, not folded into pin visibility.)
- **Durable architecture principle (carry to debrief + CLAUDE.md):** keep the toolbar's pinnable area
  **tab-scoped only** — do NOT intermingle tab-scoped and application-scoped controls there. The kebab
  menu is the lone app-scoped exception. Any future **app-scoped** buttons belong elsewhere (e.g. a menu
  bar), not in the pinnable toolbar. This guides the eventual context-menu / downloads / WebContentsView
  work.
- Scope note: this pulls the **M02** Media/Shields controls into a Flight-3 polish change (their
  disabled-on-internal state is new). Justified by the principle above; implemented in HAT leg 4.

### Leg 1 — devtools-launch (landed 2026-06-19)

**Spike: `devtools-opened`/`devtools-closed` event delivery for `<webview>` guests — POSITIVE (CONCLUSIVE under WSLg).**

- **Method**: temporarily attached `contents.on('devtools-opened'/'devtools-closed', …)` at the guest
  `app.on('web-contents-created')` site AND `wv.addEventListener('devtools-opened'/'devtools-closed', …)`
  in `wireWebview`, each with a `console.log`, plus a one-shot dev-seam auto-driver (gated on
  `GOLDFINCH_DEVTOOLS_SPIKE`) that on the first guest `dom-ready` calls `contents.openDevTools({mode:'detach'})`,
  waits, reads `isDevToolsOpened()`, then `contents.closeDevTools()`. Launched headless-ish under WSLg
  (`DISPLAY=:0`, WSLg X0) via `npm run dev`, captured stdout.
- **Raw observation** (order as logged):
  - `SPIKE: calling openDevTools({mode:detach})`
  - `SPIKE: GUEST contents devtools-opened FIRED`  ← `contents.on` (main-process guest webContents)
  - `SPIKE: WEBVIEW tag devtools-opened FIRED`     ← `wv.addEventListener` (renderer `<webview>` tag)
  - `SPIKE: isDevToolsOpened()=true`
  - `SPIKE: calling closeDevTools`
  - `SPIKE: GUEST contents devtools-closed FIRED`  ← `contents.on`
  - `SPIKE: WEBVIEW tag devtools-closed FIRED`     ← `wv.addEventListener`
  - `SPIKE: post-close isDevToolsOpened()=false`
- **Result**: BOTH `devtools-opened` and `devtools-closed` fire reliably on BOTH the guest
  `webContents` (`contents.on`) AND the renderer `<webview>` tag (`wv.addEventListener`).
  `isDevToolsOpened()` is authoritative (`true` after open, `false` after close). The detached DevTools
  window DID materialize under WSLg in this run (events + state confirm the open/close round-trip).
  **This contrasts with the Flight-2 D1 carry-forward** (`found-in-page` fired ONLY on the `<webview>`
  tag, never on the guest webContents) — DevTools events are NOT subject to the same one-sided delivery.
- **Wiring decision (per the leg's pinned seam shape, POSITIVE branch)**: wire the **guest
  `contents.on('devtools-opened'/'devtools-closed')`** side in `main.js` and forward to the chrome
  renderer as `mainWindow.webContents.send('devtools-state-changed', { wcId, open })` (mirrors the
  `zoom-changed` broadcast — keeps the listener main-side, one hop, no extra renderer plumbing). Added
  the matching `onDevtoolsStateChanged` bridge to `chrome-preload.js`. **Leg 2 can subscribe to
  `devtools-state-changed` for live button updates** (incl. a DevTools-window-initiated close, which the
  on-demand `isDevtoolsOpen` reconcile alone would miss until next tab activation). The `<webview>`-tag
  listener was the redundant alternative and was NOT wired (one source is enough). All spike
  instrumentation was removed before landing.

**Changes made:**
- `src/main/devtools.js` *(new)* — shared, electron-free open/close mechanics: `setDevTools(wc, open)`
  (`wc.openDevTools({mode:'detach'})` / `wc.closeDevTools()`) and `toggleDevTools(wc)` (read
  `isDevToolsOpened()` → flip → return post-state). Assumes a pre-guarded wc (guard ownership pinned to
  the callers).
- `src/main/automation/observe.js` — `openDevTools`/`closeDevTools` ops now delegate the mechanics to
  `setDevTools(wc, true/false)`; their own `isInternalContents` throw + void op contract preserved. The
  existing `automation-observe.test.js` op tests stay green unchanged (still assert `{mode:'detach'}` +
  the internal-session refusal message).
- `src/preload/chrome-preload.js` — `toggleDevtools`/`isDevtoolsOpen` two-way `invoke` bridges +
  `onDevtoolsStateChanged` subscribe bridge (mirroring `getZoom`/`onZoomChanged`).
- `src/main/main.js` — `ipcMain.handle('toggle-devtools'/'is-devtools-open')` acting on the **passed
  `webContentsId`** (TOCTOU guard — never `activeTab()`), dead/internal guards return `false`, delegating
  to the shared helper; imports `toggleDevTools` + the shared `isInternalContents` predicate; `F12`
  (between the keyDown filter and the modifier gate, `isAutoRepeat`-guarded) + `Ctrl+Shift+I` (gated
  section, `isAutoRepeat`-guarded) added to the guest `before-input-event`; guest
  `devtools-opened`/`devtools-closed` listener forwarding `devtools-state-changed`.
- `src/renderer/renderer.js` — `F12` (before the `if (!mod) return;` gate) + `Ctrl+Shift+I` (new
  `else if` chain member, key-letter-disambiguated from `Shift+P`) in the chrome keydown handler, with
  `activeTab`/`isInternalTab`/open-lightbox guards, calling `window.goldfinch.toggleDevtools`.
- `src/renderer/renderer-globals.d.ts` — added `toggleDevtools`/`isDevtoolsOpen`/`onDevtoolsStateChanged`
  to the `GoldfinchBridge` interface (required for typecheck once the renderer calls them).
- `test/unit/devtools.test.js` *(new, 8 tests)* — shared-helper coverage: `setDevTools` open/close
  mechanics, `toggleDevTools` closed→open / open→closed return values, authoritative-post-state read
  (does not assume the flip), and a three-toggle round-trip.

**Results**: `npm test` 840 pass / 0 fail (832 prior + 8 new); `npm run typecheck` clean; `npm run lint`
clean. MCP tool count unchanged at 26 (the `listTools returns exactly the 26 tools` test stays green —
no new MCP tool; the human path reuses `webContents` methods via chrome IPC). Smoke boot under WSLg
clean (no runtime errors from the new handlers/listeners).

### Leg 2 — devtools-toolbar-pin (landed 2026-06-19)

Added the pinnable `#toggle-devtools` toolbar button (third `toolbarPins` item, default UNPINNED),
consuming the Leg-1 seam (`toggleDevtools` / `isDevtoolsOpen` / `onDevtoolsStateChanged`).

**Changes made:**
- `src/main/settings-store.js` — `DEFAULTS.toolbarPins.devtools = false`; `@typedef Settings`
  toolbarPins type → `{ media, shields, devtools }`. Validator/normalizer/version untouched (the
  `{...DEFAULTS.toolbarPins, ...v}` normalizer + `freshDefaults` spread auto-populate `devtools` for
  pre-leg config files — forward-compat proven by Media/Shields).
- `src/renderer/index.html` — `#toggle-devtools` icon-btn placed after `#toggle-privacy`, before the
  automation indicator. Lucide "code" glyph (ISC, inline CSP-safe path data). Uses
  `aria-pressed="false"` (toggle reflecting the external DevTools window's open state — NOT
  `aria-expanded`, which the Media/Shields panel toggles use), `aria-label="DevTools"`, `title`
  naming the `F12` shortcut.
- `src/renderer/renderer.js` — `els.toggleDevtools` lookup; `applyToolbarPins` gains the
  `els.toggleDevtools.classList.toggle('hidden', !pins.devtools)` line + JSDoc type → `{ media,
  shields, devtools }` (pin-state-driven only, no tab-type coupling — DD5; the automation indicator
  is left untouched); `setDevtoolsPressed(open)` helper (sets `aria-pressed` + `.active`); click
  handler → `toggleDevtools({webContentsId})` guarded by `isInternalTab`/`wcId` (inert on internal),
  reflecting the authoritative post-toggle return; `contextmenu` → `toolbarContextMenu('devtools')`;
  `onDevtoolsStateChanged` subscription (fire-and-forget, matching the existing
  `onZoomChanged`/`onSettingsChanged` no-teardown pattern — the chrome renderer does not reload like
  the settings page) that updates pressed state when the event's `wcId` matches the active tab;
  `activateTab` reconcile via `isDevtoolsOpen` with the `activeTabId === tab.id` async-race re-check
  (internal/no-wcId → forced pressed false).
- `src/renderer/pages/settings.html` — third `appearance-row` with `#pin-devtools`
  (`aria-pressed="false"`, `aria-label="Pin DevTools to toolbar"`, the shared Lucide pin glyph),
  label "DevTools".
- `src/renderer/pages/settings.js` — `btns.devtools`, per-button guard, `current` init (`devtools:
  false`), both `Array<'media'|'shields'|'devtools'>` loop casts (apply + click-wire), and the two
  `{ media, shields }` JSDoc/param annotations extended to include `devtools`.
- `src/main/main.js` — `toolbar-context-menu` allow-guard extended to accept `'devtools'`; the Unpin
  label map gains `devtools → 'DevTools'`. The `settings.set` + broadcast body was already
  key-generic — no change.
- `test/unit/settings-store.test.js` — updated SIX existing `deepEqual` assertions on the full pins
  map to include `devtools: false` (see deviation below — three MORE than the leg's citation audit
  flagged); added a new `devtools default false + persistence round-trip` test (pre-leg file lacking
  `devtools` normalizes to `false`; `devtools:true` write survives reload).

**Results**: `npm test` 841 pass / 0 fail (832 Leg-1 baseline + 8 Leg-1 devtools-helper + 1 new pins
round-trip). `npm run typecheck` clean; `npm run lint` clean. `npm run a11y`
(`--tags=wcag2a,wcag2aa,wcag21a,wcag21aa`, run live over the MCP automation surface under WSLg) — "No
NEW violations". MCP tool count unchanged at 26 (the `listTools returns exactly the 26 tools` test
stays green — no automation-surface change this leg). The toggle/state/internal-inert/right-click
behaviors are verified by code; the live DevTools-window round-trip is the optional HAT / Leg-3 scope.

### Leg 3 — verify-integration (landed 2026-06-19)

Spec-authoring + docs + a11y-harness + regression-sweep leg. **No production source changes** (no
`mcp-tools.js` touch). Per DD8 the macOS-authoritative `devtools-cdp-conflict` live run is NOT executed
here — the spec is re-staged/authored only.

**Changes made:**
- `tests/behavior/toolbar-pins.md` — Title/Intent now name DevTools as the **third pinnable item**
  (default **UNPINNED**, DD4; toggle button with `aria-pressed`, not `aria-expanded`; inert-not-hidden on
  internal). Step 1 probe now asserts `#toggle-devtools` present-but-`.hidden` (default unpinned).
  Added DevTools steps **10–14**: (10) pin via Settings → Appearance from the unpinned baseline; (11)
  persistence (`toolbarPins.devtools===true`) + live button un-hide + `aria-pressed` (closed); (12)
  unpinned `F12`/`Ctrl+Shift+I` still opens DevTools (via `is-devtools-open`/`isDevToolsOpened()`); (13)
  inert-not-hidden on internal `goldfinch://` tabs (DD5); (14) right-click "Unpin DevTools"
  (HAT-only, like Media/Shields native menu). Added a restart-persistence variant and Out-of-Scope
  cross-refs (the live window + CDP conflict → `devtools-cdp-conflict`, macOS-authoritative). Live
  button-state assertions used **without** a max-staleness caveat — justified by the Leg-1 POSITIVE spike
  (`devtools-state-changed` wired). Spec text only — **not run** here.
- `tests/behavior/devtools-cdp-conflict.md` — **re-staged**. Status →
  `active — macOS-authoritative; WSLg inconclusive tolerated`. The three stale M03-era banners
  (ARCHIVED-Flight-9 / AUTHORED-ONLY-Flight-3-deferred-to-Flight-6 / UNBLOCKED-Flight-9) reconciled into
  ONE coherent M04-Flight-3 re-stage note. **Act path (steps 3/4) rewritten** to open/close DevTools via
  the **human affordance** (`F12`/`#toggle-devtools` → `toggle-devtools` IPC → `wc.openDevTools({mode:'detach'})`),
  driven by HAT or the admin chrome target's keydown/toggle global — **NOT** the MCP
  `openDevTools`/`closeDevTools` tools (those are now the *prior* vector). Step 1 probe no longer requires
  those MCP tools; observe path (`readAxTree` refusal vs array; `evaluate`/`injectScript` keep working)
  unchanged. Preconditions/Observables/apparatus updated for the human-affordance act path + the
  macOS-authoritative venue. **The prior MCP-`openDevTools` run log
  (`runs/2026-06-17-16-25-30.md`) was NOT edited or deleted — preserved and referenced as a prior-finding.**
- `scripts/a11y-audit.mjs` — added a **6th audit state `devtools-button`** after the find-bar state:
  `closeFind(activeTab())` (clear the transient find bar) → `applyToolbarPins({media,shields,devtools:true})`
  (un-hide the button) → `runAxe(…, 'devtools-button')`. Audits the button's static a11y; does NOT open
  DevTools (no detached window in the gate). Comment notes the state does not restore the default pin map
  (harmless — client closes right after).
- `README.md` — `F12` + `Ctrl+Shift+I` rows in the Keyboard-shortcuts table; a DevTools note
  (web-content-only/inert-on-internal, native detached window, pinnable button default-unpinned, shortcuts
  work regardless of pin state).
- `CLAUDE.md` — TWO edits: (a) corrected the stale `toolbarPins` note — map is now
  `{ media:true, shields:true, devtools:false }` and the "future 3rd item filled in as `true`" forward-compat
  sentence rewritten (the normalizer copies each key's **own** default; there is no general "filled in as
  true" rule — DevTools defaults `false`). (b) Added a **DevTools-affordance note** (human path
  `toggleDevtools`/`isDevtoolsOpen` IPC → `src/main/devtools.js` helper; agent path reuses the helper;
  `F12`/`Ctrl+Shift+I` capture sites; pin item default `false`; live `devtools-state-changed` button state;
  `cdp.js` single-client-lock cross-ref).

**Regression sweep — RESULT: inspection-only (no isolated handler unit test exists).** Grepped `test/`
for `before-input-event`, `keydown`, `Ctrl+Shift`, `zoom-apply`, `open-find` — **no matches**; no unit
test exercises the `before-input-event` / chrome-keydown branches (these are inlined Electron handlers, as
Leg 1 noted). `npm test` therefore does NOT cover the `Ctrl+Shift+I`-vs-`Ctrl+Shift+P` discrimination —
recorded as **inspection-only**. Code inspection confirmed:
- `src/main/main.js` `before-input-event`: `F12` branch (~:370) sits **between** the keyDown filter and the
  `!(input.control||input.meta)` modifier gate (:375); `Ctrl+Shift+I` (:405) is in the **gated** section.
  The zoom (:376), print, and find branches all follow the gate **unchanged** — F12 did not displace them.
- `src/renderer/renderer.js` keydown: `F12` branch (:2252) sits **before** the `if (!mod) return;` gate
  (:2260); `Ctrl+Shift+I` (:2298) is a chain `else if` **after** `Ctrl+Shift+P` (:2295) — the `I` vs `P`
  key letter disambiguates, so chain order is safe and there is **no collision**. The zoom/find/tab
  (`t`/`w`/`l`/`m`/`r`) branches are intact.
`npm test` 841 pass / 0 fail (unchanged from Leg 2 — confirms no production regression).

**Banner-reconciliation FLAG (operator-overridable).** The `devtools-cdp-conflict` spec's three prior
status banners referenced **goldfinch M03** flight numbers (Flight 9 run, Flight 3 / Flight 6 sequencing)
and contradicted each other under M04. They were reconciled into one current M04-Flight-3 re-stage note
**under the authority of this flight's spec (DD7)**, which directs re-staging the Act path onto the new
non-CDP human affordance. One stale banner had said the spec was "deferred to Flight 6" — **if the operator
intended it to stay deferred, they can override**; the live M04 F3 flight spec directs the re-stage.

**Verification results:** `npm test` 841 pass / 0 fail; `npm run typecheck` clean; `npm run lint` clean;
`npm run a11y` (`--tags=wcag2a,wcag2aa,wcag21a,wcag21aa`, live admin MCP surface under WSLg) — **"No NEW
violations"** including the new `devtools-button` state. **MCP tool count = 26** (mechanical:
`grep -cE "name:\s*['\"]" src/main/automation/mcp-tools.js` → 26). The `devtools-button` state was
positively confirmed over the MCP surface (pinning un-hides `#toggle-devtools`; accessible name
"DevTools", `aria-pressed="false"`, no `aria-expanded`; `closeFind`/`activeTab`/`applyToolbarPins` all
reachable globals).

**Deviation from leg spec (env, minor):** the leg's a11y verification assumed `GOLDFINCH_MCP_PORT=49707`;
on this machine port 49707 could not bind (the dev-pin is bind-exactly-or-fail-loudly). Ran the live app +
a11y on **49717** instead — no functional impact. Launched electron instances were cleaned up afterward;
the `:8000` media fixture server was already running pre-session and was left as-is.

### Leg 4 — hat-and-alignment (completed 2026-06-19)

Operator-driven guided HAT on WSLg (FD launched the app, operator drove the GUI, FD drove the H9 MCP
probes). **Outcome: PASS — operator signed off ("ship it").** Full per-step record in the leg artifact
(`legs/04-hat-and-alignment.md`).

- **H1–H8, H10 PASS.** H3 carries a documented caveat (a 2nd `F12` from *inside* the focused detached
  DevTools window doesn't toggle — Chromium-native window focus; macOS-authoritative). H8 changed by
  operator decision (dim-all-3, see the DD5-reframe pivot in FD Notes).
- **H9 — recorded finding (WSLg-inconclusive).** DevTools open on the web tab (opened via the new `F12`
  affordance) → `readAxTree` STILL succeeded (no `attach-failed`), `evaluate` worked, close left it
  working. Reproduces the M03 WSLg finding via the new human path; the CDP single-client refusal stays
  unit-tested-only; definitive live obs is macOS-authoritative (DD8). Not a fail (recorded finding by
  spec/DD7).
- **Three inline fixes** (all gates green — 841 tests / typecheck / lint), committed with the flight:
  (1) `#toggle-devtools.active` pressed-state CSS; (2) DevTools glyph centering (added to the toolbar
  flex-centering selector group); (3) dim/disable all 3 pinnable buttons on internal tabs (`activateTab`,
  reusing `.icon-btn:disabled`) + the tab-scoped-toolbar principle in CLAUDE.md.

## Deviations

### Leg 2 — six settings-store deepEqual assertions needed updating, not three (minor)

The leg's citation audit flagged THREE existing `deepEqual` assertions on the full `toolbarPins` map
that the new `devtools:false` default would break (`~:335-336`, `~:351-352`, `~:367-368/372`). On
running `npm test` after the edits, THREE MORE failed at higher line numbers the audit did not list:
the "load stored partial map merges with defaults" test (`:486-488`, three assertions in one), "load
malformed toolbarPins falls back to default" (`:504-505`), and "getAll returns a fresh nested object"
(`:524-525`). All six were updated to include `devtools: false` in their expected objects. No
production-code impact — the test file simply had more full-map assertions than the design-time audit
enumerated. Net: `npm test` green.

### Leg 2 — a11y gate does NOT exercise the new button (expected, per the leg's coverage caveat)

`npm run a11y` passed with no new violations, but DevTools defaults to UNPINNED, so `#toggle-devtools`
carries `.hidden` in the only toolbar-bearing audit state (`base-chrome`) and axe-core skips hidden
elements — the sweep does not audit the button. Per the leg's reviewer caveat, the button's a11y for
Leg 2 (accessible name "DevTools", valid `aria-pressed`, no `aria-expanded`) is satisfied by static
inspection of the markup; a pin-the-button audit state in `a11y-audit.mjs` is Leg-3 scope. The green
a11y run is the no-regression check, not button validation.

### Leg 1 — IPC-handler unit tests deferred to code inspection (minor)

The leg's verification steps suggest a unit test that calls the `toggle-devtools` handler logic with a
non-active `wcId` (TOCTOU) and a fake internal contents (internal-guard). The two new IPC handlers are
inlined in `main.js` exactly like their siblings (`zoom-apply`/`get-zoom`/`print`), which require
`electron` and are NOT unit-tested in isolation in this codebase (no existing harness imports `main.js`).
Rather than introduce a new electron-mock harness or extract the handlers solely for testability — both
out of altitude for this leg and inconsistent with the sibling handlers — the TOCTOU + dead/internal
guards are verified by **code inspection** (handlers read `webContents.fromId(webContentsId)`; `activeTab`
is renderer-only and not in main-process scope; the dead/internal guards are byte-for-byte the
sibling pattern), and the genuinely new MECHANICS (`setDevTools`/`toggleDevTools`) carry full unit
coverage in `test/unit/devtools.test.js`. The internal-session predicate already has its own coverage in
`automation-resolve.test.js`. Net: every new code path is either unit-tested (the helper, the predicate)
or a verbatim reuse of an already-shipped, inspected pattern (the handler shell).

### Leg 1 — positive spike (NOT a divert; an acceptable variation realized)

DD3 / the Adaptation Criteria pre-authorized the NEGATIVE branch (no event wiring, on-demand only) as the
expected fallback given the Flight-2 event-delivery class. The spike came back POSITIVE, so the
live-update event seam (`devtools-state-changed` + `onDevtoolsStateChanged`) WAS wired. This is the
design's better-case branch, not a deviation from intent — recorded here so Leg 2 knows the live event
exists and need not rely solely on the on-activation `isDevtoolsOpen` reconcile.

## Anomalies

*(populated during execution)*
