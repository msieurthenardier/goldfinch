# Flight Log: Drive Engine (input / nav / tabs) + hidden-tab strategy

**Flight**: [Drive Engine (input / nav / tabs) + hidden-tab strategy](flight.md)

## Summary
Flight in progress — `/agentic-workflow` execution begun 2026-06-13. Foreground-to-act drive
engine (input / nav / tabs) under `src/main/automation/`. Verified by unit tests + dev-seam/cdp-driver
live smoke; no behavior-test spec (per the interim-verification note in flight.md).

---

## Leg Progress

### Leg 1 — engine-scaffold-and-resolve (2026-06-13)

Created `src/main/automation/` module group and `src/main/automation/resolve.js` with three exports:
- `isInternalContents(wc)` — pure predicate, strict `=== true` marker check, never throws.
- `classifyContents(wc, chromeContents)` — identity comparison, returns `'chrome'` or `'guest'`.
- `resolveContents(wcId, { fromId, chromeContents })` — dependency-injected resolver; three distinct throw paths: `bad-handle`, `no-such-contents` (null/undefined from `fromId`, or destroyed contents), and `internal-session` (DD5 load-bearing guard closing the bypass path).

Module is Electron-free at top (no `require('electron')`), mirroring `internal-ipc.js`. All Electron handles are injected. `// @ts-check` header present.

Created `test/unit/automation-resolve.test.js` with 19 tests covering the full predicate matrix (including truthy-but-not-`true` pins), classifier, and all resolver guard paths including the destroyed-contents case and message-distinguishability assertion.

Checks: `node --test test/unit/automation-resolve.test.js` 19/19 pass; `npm test` 240/240 pass (no regressions); `npm run typecheck` clean; `npm run lint` clean.

---

### Leg 2 — tab-lifecycle (2026-06-13)

Added the tab-lifecycle engine layer:

- Created `src/main/automation/tabs.js` with five exports: pure `mapEnumeratedTabs(rawTabs, { fromId, chromeContents })` (DD5 internal-session + null-wcId + unresolvable filter → DD2 shape), and async `enumerateTabs`, `openTab`, `closeTab`, `activateTab` all taking injected deps. Module is Electron-free (`// @ts-check`, `'use strict'`); imports `resolveContents`/`isInternalContents` from `./resolve`. `closeTab` and `activateTab` call `resolveContents` before dispatching (DD5 targeted-op guard). `openTab` uses `JSON.stringify` URL encoding for injection safety (AC6). `mapEnumeratedTabs` catches per-entry `fromId` throws and continues (never throws).

- Modified `src/renderer/renderer.js`: added `window.__goldfinchAutomation` hook (chrome renderer ONLY) with `listTabs`, `openTab`, `closeTabByWcId`, `activateTabByWcId`. Thin wrappers over existing `createTab`/`closeTab`/`activateTab`/`findTabByWcId`. `openTab` includes the dom-ready RACE GUARD (attach listener → re-check `tab.wcId` immediately) with named `OPEN_TAB_TIMEOUT_MS = 5000` constant. Added `// @ts-ignore` for the dynamic window property assignment (tsconfig's `checkJs:true` doesn't know the property; inline suppress is the minimal-surface fix). This is the ONE renderer source change this flight.

- Created `test/unit/automation-tabs.test.js` with 29 tests covering: `mapEnumeratedTabs` (null-wcId drop, string-wcId drop, unresolvable drop, destroyed drop, internal drop, mixed-list, null input, empty input, boolean coercion, fromId-throws per-entry continue); `enumerateTabs` end-to-end with fake execute (internal tab absent); `openTab` (JSON encoding, special-char safety, resolves-to-wcId, resolves-to-null on rejection, bad-url throws before dispatch for non-string/null); `closeTab` (valid dispatch, internal-wcId throws, no-such throws, bad-handle throws, destroyed throws); `activateTab` (same matrix).

Checks: `node --test test/unit/automation-tabs.test.js` 29/29 pass; `npm test` 269/269 pass (240 pre-existing + 29 new); `npm run typecheck` clean; `npm run lint` clean.

---

### Leg 3 — native-navigation (2026-06-13)

Added the native navigation engine layer:

- Created `src/main/automation/nav.js` with four exports: async `navigate(wcId, url, { fromId, chromeContents })` and sync `goBack`, `goForward`, `reload` (same deps signature). Module is Electron-free (`// @ts-check`, `'use strict'`); imports `isSafeTabUrl` from `../../shared/url-safety` and `resolveContents` from `./resolve`. `navigate` re-applies `isSafeTabUrl(url)` BEFORE `resolveContents` and `loadURL` — closing the DD6 main-process hostile-URL bypass that `will-navigate` does not cover. `goldfinch://` URLs, `file:`, `data:`, `javascript:`, non-strings all rejected at the URL gate with `bad-url` error before any side effect. Plain CommonJS export only (no dual global branch — `nav.js` is main-process only). No `webContents.debugger` (DD8).

- Created `test/unit/automation-nav.test.js` with 26 tests covering: URL gate (http/https/about:blank pass; goldfinch://, file:, data:, javascript:, non-strings throw `bad-url`); URL gate fires BEFORE resolve (unsafe URL + invalid wcId → `bad-url`, not `no-such-contents`); resolve guard passthrough (internal-session, bad wcId, destroyed wcId all throw correct errors; `loadURL` NOT called); `goBack`/`goForward`/`reload` dispatch to the correct `wc` method (and not the others); all three also reject internal/dead/bad handles.

Checks: `node --test test/unit/automation-nav.test.js` 26/26 pass; `npm test` 295/295 pass (269 pre-existing + 26 new); `npm run typecheck` clean; `npm run lint` clean.

---

### Leg 4 — trusted-input (2026-06-13)

Added the trusted-input engine layer:

- Created `src/main/automation/input.js` with nine exports: pure builders `keyEvents(name)`, `mouseClickEvents(x, y, opts)`, `charEvents(text)`, `scrollEvent(x, y, deltaX, deltaY)`; low-level primitive `sendInput(wcId, event, deps)` (resolve + single send, no activation); and foreground-to-act helpers `click`, `typeText`, `scroll`, `pressKey` (each resolves + classifies + awaits `activate(wcId)` for guests before sending, re-resolves post-activate for stale-handle safety). Module is Electron-free (`// @ts-check`, `'use strict'`); imports `resolveContents`/`classifyContents` from `./resolve`. No `webContents.debugger` anywhere (DD8). CommonJS export only.

  Key shape details implemented per spec:
  - `keyEvents`: Electron Accelerator codes (`ArrowRight` → `'Right'`, etc.); `ShiftTab` → keyCode `'Tab'` + `modifiers:['shift']`; clear error on unknown key (lists known names).
  - `mouseClickEvents`: ordered `mouseMove → mouseDown (buttons:1) → mouseUp (buttons:0)` — `buttons` bitmask mirrors the working CDP recipe (cdp-driver.mjs:92-93).
  - `charEvents`: character string in `keyCode` (Electron char event convention).
  - `scrollEvent`: includes `canScroll: true` (required or Electron silently delivers nothing) and `wheelTicksX/Y = delta/120`.
  - `actOn` (internal): re-resolves wc AFTER `await activate(wcId)` (stale-handle guard); chrome targets never activated.

- Created `test/unit/automation-input.test.js` with 46 tests covering: full `keyEvents` mapping (all 12 named keys + ShiftTab + unknown-key throw); `mouseClickEvents` ordering/types/coords/button/clickCount/buttons bitmask (both values asserted explicitly); `charEvents` character-in-keyCode/empty-string/special-chars; `scrollEvent` type/canScroll/wheelTicks/coords; `sendInput` resolve-rejection passthrough (internal/bad/dead wcId, no event sent); `click` foreground-to-act ordering (activate before sendInputEvent, asserted via shared call-log); `click` chrome target (activate NOT called); `click` internal wcId (throws, no events); `typeText` with text and with empty string; `scroll` canScroll:true; `pressKey` Enter and ArrowRight mappings and unknown-key synchronous throw.

  Notable: `pressKey` throws synchronously (not a rejected promise) when given an unknown key, because `keyEvents` throws before `actOn` is reached — test uses `assert.throws`, not `assert.rejects`.

**DEFERRED to Leg 6 (live smoke):** the live click-recipe reliability and guest coordinate-space validation. The `mouseMove→mouseDown→mouseUp` sequence and `buttons` bitmask are the known-good starting recipe (mirroring the CDP driver); Leg 6 confirms/tunes the recipe on a real guest and records the outcome. This leg's acceptance is unit-level only.

Checks: `node --test test/unit/automation-input.test.js` 46/46 pass; `npm test` 341/341 pass (295 pre-existing + 46 new); `npm run typecheck` clean; `npm run lint` clean.

---

### Leg 5 — dev-seam-and-integration (2026-06-13)

Wired the four engine modules into the single automation entry point and added the dev-only chrome-renderer seam:

- Created `src/shared/automation-dev.js` — pure `isAutomationDevEnabled(argv)` (dual-context: main + preload both `require` it). Returns `true` iff `argv` contains `--remote-debugging-port…` (any value, main process) or `--automation-dev` (injected marker, renderer process). Never throws; non-array input returns `false`.

- Created `src/main/automation/engine.js` — `createEngine(getMainWindow)` returns the single automation entry object (12 ops: `enumerateTabs`, `openTab`, `closeTab`, `activateTab`, `navigate`, `goBack`, `goForward`, `reload`, `click`, `typeText`, `scroll`, `pressKey`). Deps built freshly per call (picks up a recreated window). `activate` built on `base` (not the returned deps). `executeInRenderer` guards against null window. No `webContents.debugger` (DD8). Electron-bound glue — integration-verified in Leg 6, not unit-tested offline.

- Modified `src/main/main.js` — added `require('../shared/automation-dev')` and `require('./automation/engine')`; dev-gated `additionalArguments: ['--automation-dev']` in the chrome `BrowserWindow` `webPreferences` via conditional spread (consistent with the `frameOpts` pattern at ~98-101, key absent in non-dev); dev-gated `ipcMain.handle('automation:dev-invoke', ...)` registered once at startup in the existing `app.whenReady` site after `createWindow()`, with the `event.sender === mainWindow.webContents` chrome-renderer-only check.

- Modified `src/preload/chrome-preload.js` — added `require('../shared/automation-dev')`; dev-gated `automationDevInvoke` spread into the `goldfinch` bridge (absent in non-dev runs).

- Created `test/unit/automation-dev.test.js` — 17 unit tests covering `isAutomationDevEnabled`: true for `--remote-debugging-port=9222`, bare `--remote-debugging-port`, `--automation-dev`, mixed args; false for empty array, unrelated args, prefix-only matches, non-array types (`null`, `undefined`, string, number, object); never-throws coverage including non-string array elements.

**Typecheck friction (resolved):** `tabs.activateTab` returns `Promise<boolean>` but `input.js` declares `activate?: (id: number) => Promise<void>`. Fixed with a typed intermediate variable (`/** @type {(wcId: number) => Promise<void>} */`) + `Promise<any>` cast in `engine.js` — behaviorally correct (the boolean result is unused by `actOn`), no API widening needed.

Checks: `node --test test/unit/automation-dev.test.js` 17/17 pass; `npm test` 358/358 pass (341 pre-existing + 17 new); `npm run typecheck` clean; `npm run lint` clean.

---

### Leg 6 — verify-integration (2026-06-13) — FD-driven live smoke

**Static (AC1):** `npm test` 358/358 pass; `npm run typecheck` clean; `npm run lint` clean.

**Live smoke** — app launched under
`electron . --enable-logging --no-sandbox --disable-dev-shm-usage --remote-debugging-port=9222 --remote-allow-origins=*`
(WSLg `DISPLAY=:0`), driven through the dev seam via `scripts/cdp-driver.mjs eval "window.goldfinch.automationDevInvoke(<op>,<args>)"`.
FD-driven with cited machine reads (mission M02 standard). Evidence (uncommitted):
`/tmp/gf-smoke/drive-engine/2026-06-13-15-10-19/` (chrome screenshot + engine/raw enumerate JSON).

Results, all PASS:
- **Seam round-trip** — `enumerateTabs` returned the google guest (wcId 2), chrome correctly excluded; `typeof window.goldfinch.automationDevInvoke === 'function'`.
- **AC2 navigate** — `navigate(2,'https://example.com/')` → guest moved; engine enumerate + `webview.getURL()` both read back `https://example.com/`, title `Example Domain` (live UI updated).
- **AC3 trusted input on guest** — injected a test `<input>`; `click(2,204,123)` set the guest's `document.activeElement` to that input; `typeText(2,'hello')` produced `value="hello"` (real handlers fired).
- **AC6 spikes RESOLVED (no recipe change needed):**
  - **Click recipe** — the Leg-4 `mouseMove → mouseDown(buttons:1) → mouseUp(buttons:0)` sequence reliably actuated the control (focus changed). Confirmed working as-built; `input.js` unchanged.
  - **Coordinate space** — input was at guest-viewport rect `(50,100,308,46)`; a click at its center `(204,123)` focused it ⇒ **`sendInputEvent` coordinates on a guest are guest-viewport-relative** (no chrome offset). Confirmed.
- **AC4 chrome target** — `click(1,755,63)` focused the chrome `#address` input (no foreground activation for chrome); `typeText(1,'gold')` appended to its value. Chrome (wcId 1) drives correctly.
- **AC5 tab ops** — `openTab('https://example.org/')` returned the real wcId 3 (dom-ready race-guard worked) and made it active; `activateTab(2)` brought 2 to front and sent 3 to back (enumerate `active` flags flipped); `closeTab(3)` → enumerate back to 1 tab. `goBack(2)`→google, `goForward(2)`→example.com, `reload(2)` dispatched.
- **AC7 DD5 bypass path (load-bearing security)** — opened `goldfinch://settings` (wcId 4) via the chrome's own `#kebab-settings` handler. (a) **Absent** from engine `enumerateTabs` (showed only wcId 2) while **present** in the raw renderer `listTabs()` (wcId 4, jarId `internal`) — main-side filter confirmed. (b) `navigate(4,'https://example.com/')` AND `click(4,50,50)` **both rejected** with `automation: internal-session — wcId 4 belongs to the internal goldfinch://settings session and cannot be driven`; settings guest left untouched. The directly-supplied-internal-wcId bypass is closed.

**Teardown** — app killed; port 9222 freed; no stray processes. No anomalies. No `webContents.debugger` used (cdp-driver was the sole CDP client; DD8 held).

This is the last autonomous leg → flight proceeds to review + commit (Phase 2d).

---

### Flight Director Notes

- **2026-06-13 — Flight kickoff.** Operator invoked `/agentic-workflow flight 1, mission 3, goldfinch`.
  Loaded phase file `leg-execution.md` (well-formed: Crew / Interaction Protocol / Prompts present).
  Crew: Developer (Sonnet) + Reviewer (Sonnet). Branch `flight/01-drive-engine` cut from `main`.
- **Status transition `planning → in-flight`.** Flight spec was left at `planning` but is fully
  designed (DD1–DD9 documented, 6 autonomous legs + 1 optional HAT defined, validation approach set).
  The unchecked pre-flight items are intentionally deferred to leg-time spikes (input recipe,
  coordinate space) and the verify leg (live-smoke prereqs). Invoking the execution workflow on this
  named flight is the operator's go signal, so transitioned to `in-flight`.
- **Workflow shape.** Batch-implement model: leg design reviewed per leg; single code review + commit
  after the last autonomous leg (`verify-integration`). The optional `hat-and-alignment` leg is
  interactive — will surface to the operator at flight end rather than auto-execute.
- **Per-leg design review.** Each of Legs 1–6 got one Developer design-review pass (general-purpose,
  Sonnet) before implementation. All returned approve / approve-with-changes; no leg needed a second
  cycle or human escalation. Highest-value catches: Leg 4's `sendInputEvent` shape gaps (`mouseWheel`
  `canScroll`, `mouseDown/Up` `buttons` bitmask) — well-formed-but-silently-wrong errors a unit test
  can't catch, fixed pre-implementation and then **confirmed correct by the Leg 6 live smoke**.
- **Leg 4 single-review despite substantive changes.** The review's fixes were event-shape corrections
  (its own exact prescriptions, grounded in the working CDP recipe + Electron API). Rather than spend a
  second design-review cycle re-confirming a transcription, I relied on Leg 6's live smoke as the
  definitive backstop for input shapes — which validated them (click actuated, type landed, scroll
  shape unused-but-present). Decision recorded for traceability.
- **Leg 6 FD-driven (not subagent-spawned).** The live smoke needs a headed GUI + iterative judgment on
  the spike resolution; per the mission's "FD-driven runs with cited machine-read evidence" standard
  and to avoid a subagent hanging on a GUI launch, the Flight Director drove it directly via
  `cdp-driver.mjs`, capturing machine reads. No `input.js` fix was required (recipe worked as-built), so
  no Developer spawn was needed for a code change.

## Decisions
_Runtime decisions not in the original plan will be recorded here._

---

## Deviations
_Departures from the planned approach will be recorded here._

---

## Anomalies
_Unexpected issues will be recorded here._

---

## Session Notes

### 2026-06-13 — `render-strategy-spike` (DD9 gate) executed pre-flight

Ran a self-contained, throwaway Electron `^42` spike (an ad-hoc harness, since removed — faithful to
the real architecture: one `BrowserWindow`, real `<webview>` guests; mirrors `main.js:139`
`sandbox:false` for web webviews, since sandboxed guests crash on this WSL2 kernel's shm path, fixed
with `--no-sandbox --disable-dev-shm-usage`) to settle DD9 before the engine design locks. Evidence
(PNGs) in `/tmp/gf-spike/render-strategy/` (outside the repo, per ARTIFACTS); harness reproducible
from the table + notes below.

Results by axis (✅ pass / ❌ fail / ⚠️ unmeasurable here):

| Axis | (A) offscreen `-10000px` | (A) behind (occluded, on-screen) | (B) hidden `BrowserWindow` |
|------|--------------------------|----------------------------------|----------------------------|
| `capturePage` non-blank on bg | ❌ **hangs** (no frame produced) | ✅ full real content | ✅ full real content |
| `sendInputEvent` lands on bg | ✅ | ✅ | ✅ |
| same-tab front↔back, state preserved | ✅ (clicks 3→3, no teardown) | ✅ | n/a (window show/hide) |
| focus isolation from human fg | ⚠️ | ⚠️ single-window shares focus routing | ✅ by OS-window construction |
| preserves webview/tab-strip architecture | ✅ | ✅ | ❌ (tabs-as-windows) |

Key conclusions:
- **Offscreen-translation is OUT for capture**: a webview moved fully offscreen produces no frame, so
  `capturePage` hangs (input still lands). The render strategy must keep bg tabs **on-screen but
  occluded**, never translated offscreen.
- **(A) behind-layering WORKS** for capture + input + front/back with state preserved — and keeps the
  single-window tab-strip architecture and a cheap (z-order) bring-to-front. Confirmed by
  `03-bg-behind.png` (captured the occluded bg tab's full content while a different tab was in front).
- **(B) hidden window WORKS** for capture + input while never shown (`paintWhenInitiallyHidden:true` +
  `backgroundThrottling:false` + `sandbox:false`), and is focus-isolated by construction.
- **Focus interference is the deciding axis and is architectural, not measurable unattended**:
  `document.hasFocus()` is false for everything because the OS never focuses the app window in a
  headless run. By Chromium's single-window model, a `mouseDown` on a background webview focuses that
  frame and blurs the human's foreground tab — so a concurrently-typing human's physical keyboard would
  be routed to the agent's tab. (A) shares one window's focus route (a real risk for the concurrent-use
  requirement; possibly mitigable by main-process focus-restore after each agent action — unproven).
  (B) avoids this by giving each agent tab its own window. This needs a **real-human check**, not more
  unattended spiking.

**Decision (operator, 2026-06-13): Option C — foreground-to-act for v1.** Rather than build background
driving now, the agent brings a tab to the front to act on/screenshot it (the named v1 consumers are
headless/sandboxed). This collapses the DD9 complexity out of Flight 1 (no behind-layering, no
tri-state renderer, no `.bg-live` CSS, no focus-restore, no focus-interference risk) and reuses the
existing single-live-tab model. The spike is **not** wasted: it de-risked the future background-driving
path — both (A) behind-layering and (B) hidden window are proven viable on Electron `^42`, so concurrent
human+agent background work is a known future flight (prefer (A); validate single-window focus with a
real human), recorded in the mission Known Issues. DD3/DD9 in the flight spec reflect this; the spec
was simplified accordingly.
