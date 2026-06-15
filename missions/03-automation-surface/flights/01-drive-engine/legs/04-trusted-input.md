# Leg: trusted-input

**Status**: completed
**Flight**: [Drive Engine (input / nav / tabs)](../flight.md)

## Objective

Build the engine's trusted-input capability — `click` / `type` / `scroll` / `key` via
`webContents.sendInputEvent` — on the chrome renderer and on a **foregrounded** guest, with the
pure key-name/event-shape mapping extracted and unit-tested, and the foreground-to-act bring-to-front
applied before acting on a guest (DD3).

## Context

- **SC2 / DD4** — deliver **trusted** input (click / type / scroll / key) that fires real handlers and
  native focus traversal, on **both** the chrome (`mainWindow.webContents`) and guest webviews.
  `sendInputEvent` is trusted input (fires real handlers + native focus traversal) — no
  `--remote-allow-origins=*`, no debugger (DD8).
- **DD3 — foreground-to-act** — only one tab is live at a time; to act on a guest the engine **brings
  it to front first** (an explicit `activateTab`), then sends input. The chrome renderer is always
  live, so chrome targets need no activation.
- **DD5** — input resolves the target through Leg 1 `resolveContents` (rejects internal / bad / dead),
  the load-bearing guard while ungated.
- **DD8** — `sendInputEvent` only; no `webContents.debugger` (the cdp-driver smoke harness in Leg 6 is
  the single CDP client; the engine must not contend for it).
- **Two open questions are resolved by a LIVE spike in Leg 6, not from docs** (flight Open Questions):
  1. the exact `sendInputEvent` recipe for a reliable synthetic **click** on a guest (single
     down+up vs needing a `mouseMove` first; modifier/last-button quirks);
  2. the **coordinate space** for input on a guest (`sendInputEvent` on a guest `webContents` uses
     coordinates relative to that guest's own viewport).
  This leg implements the **known-good starting recipe** (mirroring the CDP driver's working
  `mouseMoved → mousePressed → mouseReleased`, `scripts/cdp-driver.mjs:91-93`) and the pure mapping;
  Leg 6 confirms/tunes the recipe live and records the outcome. **The unit-testable core (mapping +
  event-shape construction) is fully built and tested here.**
- **CDP → Electron translation** — the working descriptors live in `scripts/cdp-driver.mjs:40-53`
  (`KEYS`) and `:88-111` (mouse/key dispatch), but those are **CDP** (`Input.dispatch*`) shapes.
  `webContents.sendInputEvent` uses a **different** shape (Electron Accelerator key codes, `mouseDown`/
  `mouseUp`/`mouseMove`/`mouseWheel`/`char` types, `modifiers: string[]`). The mapping in this leg is
  the Electron-native equivalent (e.g. CDP `ArrowRight` → Electron keyCode `'Right'`; CDP
  `mousePressed` → Electron `'mouseDown'`).
- **Pattern continuity** — injected handles (`fromId`, `chromeContents`, and an injected `activate`
  callback for the bring-to-front), mirroring `resolve.js`/`tabs.js`/`nav.js`. Decoupling `input.js`
  from `tabs.js` via an injected `activate` keeps both unit-testable; the glue (Leg 5) wires
  `activate = (wcId) => tabs.activateTab(wcId, deps)`.

## Inputs

What exists before this leg runs:
- `src/main/automation/resolve.js` (Leg 1) — `resolveContents`, `classifyContents`.
- `src/main/automation/tabs.js` (Leg 2) — `activateTab(wcId, deps)` (the bring-to-front the glue
  injects as `activate`).
- `scripts/cdp-driver.mjs:40-53` — the working **CDP** `KEYS` descriptor table to translate from.
- `scripts/cdp-driver.mjs:88-94` — the working **CDP** click sequence
  (`mouseMoved → mousePressed → mouseReleased`) — the recipe to mirror in Electron shape.
- Electron `^42` `webContents.sendInputEvent(inputEvent)` API (mouse: `mouseDown`/`mouseUp`/
  `mouseMove`/`mouseEnter`/`mouseLeave`/`mouseWheel`; keyboard: `keyDown`/`keyUp`/`char`).

## Outputs

What exists after this leg completes:
- `src/main/automation/input.js` — **new**: pure mapping/event-builders + `sendInput` primitive +
  `click` / `typeText` / `scroll` / `pressKey` helpers (foreground-to-act for guests).
- `test/unit/automation-input.test.js` — **new**: unit tests for the pure mapping/builders and the
  injected-deps orchestration (fake `wc.sendInputEvent` spy, fake `fromId`, fake `activate`).

## Acceptance Criteria

- [x] **AC1** — A pure `keyEvents(name)` maps a friendly key name to the Electron `sendInputEvent`
  keyboard event pair `[{type:'keyDown', keyCode, modifiers}, {type:'keyUp', keyCode, modifiers}]`,
  using **Electron Accelerator** key codes. It covers at least the cdp-driver set
  (`Tab, Enter, Escape, Space, ArrowRight, ArrowLeft, ArrowDown, ArrowUp, Home, End, Delete,
  Backspace`) translated to Electron codes (arrows → `Right`/`Left`/`Down`/`Up`), plus `ShiftTab`
  (Tab + `modifiers:['shift']`). Throws a clear error on an unknown key name (listing known names,
  mirroring `cdp-driver.mjs:108`).
- [x] **AC2** — A pure `mouseClickEvents(x, y, { button = 'left', clickCount = 1 } = {})` returns the
  ordered Electron event array `[{type:'mouseMove',…},{type:'mouseDown',…},{type:'mouseUp',…}]` (the
  known-good starting recipe). `mouseDown`/`mouseUp` carry `button`, `clickCount`, **and the `buttons`
  bitmask** (`buttons: 1` on down, `buttons: 0` on up — mirroring the working CDP recipe
  `cdp-driver.mjs:92-93`, so a page's `event.buttons` sees the press). A pure `charEvents(text)`
  returns one `{type:'char', keyCode: <char>}` per character (the character string in `keyCode`). A
  pure `scrollEvent(x, y, deltaX, deltaY)` returns
  `{type:'mouseWheel', x, y, deltaX, deltaY, wheelTicksX, wheelTicksY, canScroll: true}` —
  **`canScroll: true` is required** or Electron short-circuits the scroll (silently delivers nothing);
  `wheelTicksX/Y` are `deltaX/120` / `deltaY/120`.
- [x] **AC3** — `sendInput(wcId, event, { fromId, chromeContents })` is the **low-level single-event
  primitive**: it resolves the target via `resolveContents` (DD5 reject internal/bad/dead) then calls
  `wc.sendInputEvent(event)`. It does **not** foreground-to-act — callers driving a guest directly via
  `sendInput` must ensure the guest is foreground themselves; the `click`/`typeText`/`scroll`/`pressKey`
  helpers (AC4) are the DD3-correct entry points. No `webContents.debugger` anywhere in `input.js` (DD8).
- [x] **AC4** — `click(wcId, x, y, deps)`, `typeText(wcId, text, deps)`, `scroll(wcId, x, y, dx, dy,
  deps)`, `pressKey(wcId, name, deps)` each: resolve + classify the target; if it is a **guest** and an
  `activate` callback is injected, **await `activate(wcId)` (bring-to-front) before** sending input;
  for a **chrome** target, do **not** activate. Then send the built event(s) in order via
  `wc.sendInputEvent`.
- [x] **AC5** — `test/unit/automation-input.test.js` covers: `keyEvents` mapping + unknown-key throw +
  ShiftTab modifier; `mouseClickEvents`/`charEvents`/`scrollEvent` shapes and ordering; `sendInput`
  resolve-rejection passthrough (internal/bad/dead `wcId`); the **foreground-to-act** behavior
  (`activate` awaited for a guest target, NOT called for a chrome target — assert with a fake
  `activate` spy and a fake `chromeContents` identity); and that the correct ordered events reach the
  fake `wc.sendInputEvent`. Fake `wc`/`fromId`/`activate` — no live Electron. Full suite green.
- [x] **AC6** — `input.js` is `// @ts-check`, `'use strict';`, imports `resolveContents`/
  `classifyContents` from `./resolve`; no top-level `require('electron')` (handles injected); CommonJS
  export only.
- [x] **AC7** — `npm run typecheck` and `npm run lint` clean. **Live recipe validation
  (click-on-guest + coordinate space) is explicitly deferred to Leg 6's live smoke** — this leg's
  acceptance is unit-level; a header comment in `input.js` marks the mouse recipe as the documented
  starting point pending Leg 6 live tuning.

## Verification Steps

- `node --test test/unit/automation-input.test.js` — new tests pass.
- `npm test` — full unit suite green.
- `npm run typecheck` / `npm run lint` — clean.
- Manual read: confirm no `webContents.debugger`/`.debugger` in `input.js`; confirm guest targets are
  activated before input and chrome targets are not.
- (Deferred to Leg 6 live smoke) drive a click/type on a foregrounded guest and confirm real handlers
  fire (DOM read-back); deliver input to the chrome; **resolve the two live open questions** (click
  recipe reliability, guest coordinate origin) and record the confirmed recipe in the Leg 6 flight-log
  entry. If the live spike shows the starting recipe needs adjustment (e.g. an extra `mouseMove`,
  different `clickCount`, or a coordinate offset), that adjustment is made in Leg 6 (input is not
  "done" until it drives a live guest).

## Implementation Guidance

1. **Create `src/main/automation/input.js`** — header:
   ```js
   // @ts-check
   'use strict';
   const { resolveContents, classifyContents } = require('./resolve');
   // Trusted input via webContents.sendInputEvent (fires real handlers + native focus
   // traversal). Debugger-free (DD8). MOUSE RECIPE NOTE: mouseMove→mouseDown→mouseUp is the
   // known-good starting sequence (mirrors the working CDP driver, cdp-driver.mjs:91-93);
   // the live click-on-guest reliability + guest coordinate space are confirmed/tuned in Leg 6.
   ```

2. **Pure `KEY_MAP` + `keyEvents(name)`** — Electron Accelerator codes:
   ```js
   const KEY_MAP = {
     Tab: 'Tab', Enter: 'Enter', Escape: 'Escape', Space: 'Space',
     ArrowRight: 'Right', ArrowLeft: 'Left', ArrowDown: 'Down', ArrowUp: 'Up',
     Home: 'Home', End: 'End', Delete: 'Delete', Backspace: 'Backspace',
   };
   function keyEvents(name) {
     let keyCode, modifiers = [];
     if (name === 'ShiftTab') { keyCode = 'Tab'; modifiers = ['shift']; }
     else { keyCode = KEY_MAP[name]; }
     if (!keyCode) throw new Error('automation: unknown key ' + name + ' (known: ' + Object.keys(KEY_MAP).join(', ') + ', ShiftTab)');
     return [
       { type: 'keyDown', keyCode, modifiers },
       { type: 'keyUp', keyCode, modifiers },
     ];
   }
   ```

3. **Pure mouse/char/scroll builders**:
   ```js
   function mouseClickEvents(x, y, { button = 'left', clickCount = 1 } = {}) {
     return [
       { type: 'mouseMove', x, y },
       // buttons bitmask (1 down / 0 up) mirrors the working CDP recipe (cdp-driver.mjs:92-93)
       // so a page's event.buttons sees the press. Pending Leg 6 live confirmation.
       { type: 'mouseDown', x, y, button, clickCount, buttons: 1 },
       { type: 'mouseUp', x, y, button, clickCount, buttons: 0 },
     ];
   }
   // text only — for named keys (Enter/Tab/…) use pressKey/keyEvents, NOT charEvents.
   function charEvents(text) { return [...String(text)].map((ch) => ({ type: 'char', keyCode: ch })); }
   // canScroll:true is REQUIRED or Electron silently delivers no scroll. deltaX/Y are pixel deltas
   // (caller-supplied); wheelTicks are the conventional /120 tick counts.
   function scrollEvent(x, y, deltaX, deltaY) {
     return { type: 'mouseWheel', x, y, deltaX, deltaY, wheelTicksX: deltaX / 120, wheelTicksY: deltaY / 120, canScroll: true };
   }
   ```

4. **`sendInput` primitive + helpers**:
   ```js
   function sendInput(wcId, event, { fromId, chromeContents }) {
     const wc = resolveContents(wcId, { fromId, chromeContents });
     wc.sendInputEvent(event);
   }
   async function actOn(wcId, events, { fromId, chromeContents, activate }) {
     let wc = resolveContents(wcId, { fromId, chromeContents });
     if (classifyContents(wc, chromeContents) === 'guest' && typeof activate === 'function') {
       await activate(wcId);                      // DD3 foreground-to-act (guest only)
       // Re-resolve AFTER the async activate: the pre-activate handle may be stale by now,
       // and re-resolving re-applies the DD5 guard post-activation. Always resolve immediately
       // before acting (the discipline the rest of the module group follows).
       wc = resolveContents(wcId, { fromId, chromeContents });
     }
     for (const ev of events) wc.sendInputEvent(ev);
   }
   const click   = (wcId, x, y, deps, opts)        => actOn(wcId, mouseClickEvents(x, y, opts), deps);
   const typeText= (wcId, text, deps)              => actOn(wcId, charEvents(text), deps);
   const scroll  = (wcId, x, y, dx, dy, deps)      => actOn(wcId, [scrollEvent(x, y, dx, dy)], deps);
   const pressKey= (wcId, name, deps)              => actOn(wcId, keyEvents(name), deps);
   ```
   Note: `actOn` re-resolves once and classifies; activation is awaited before any event is sent so
   the guest is foreground when input lands. (`activate` re-resolving inside `tabs.activateTab` is
   cheap and acceptable.) Export the pure builders too (for tests).

5. **Export** `module.exports = { keyEvents, mouseClickEvents, charEvents, scrollEvent, sendInput, click, typeText, scroll, pressKey };`

6. **Tests** — fake `wc` with a `sendInputEvent` spy collecting events; fake `fromId` (guest, internal,
   dead, plus a `chromeContents` object reused as both the injected `chromeContents` and a `fromId`
   entry so classify returns `'chrome'`); fake `activate` spy. Assert:
   - `keyEvents('ArrowRight')` → keyCode `'Right'`; `keyEvents('ShiftTab')` → keyCode `'Tab'`,
     modifiers `['shift']`; `keyEvents('Nope')` throws.
   - `mouseClickEvents(10,20)` → 3 events in order: `mouseMove`, then `mouseDown` with `buttons:1`,
     then `mouseUp` with `buttons:0` (assert the bitmask explicitly, plus types/coords/button/clickCount).
   - `charEvents('hi')` → `[{type:'char',keyCode:'h'},{type:'char',keyCode:'i'}]` (assert the character
     is in `keyCode`); `charEvents('')` → `[]`. `scrollEvent(0,0,0,120)` → includes `canScroll:true`
     and `wheelTicksY:1`.
   - `click(guestId, x, y, deps)` → `activate` called once with `guestId` **before** the 3 sendInputEvent
     calls (assert ordering, e.g. via a shared call-log array).
   - `click(chromeId, …)` where the resolved wc === chromeContents → `activate` **not** called.
   - `sendInput(internalId, ev, deps)` / `click(internalId,…)` → throws (resolve guard), no input sent.

## Edge Cases

- **Click on a guest that is not foreground** — `actOn` brings it to front first (DD3). If `activate`
  is not injected (e.g. a future caller wiring), input is sent without activation — document that the
  glue (Leg 5) always injects `activate` for correctness; chrome never needs it.
- **`typeText` with an empty string** — `charEvents('')` → `[]`; `actOn` resolves/activates but sends
  no events. Harmless no-op; covered by the builder test.
- **Unknown key** — `keyEvents` throws before any send; `pressKey` surfaces it.
- **Coordinate space (guest)** — coordinates are passed through as the guest-viewport-relative values
  the caller provides; the live confirmation of the correct origin is a Leg 6 open question (do not
  invent an offset here — pass through and tune live).
- **Live recipe may change** — if Leg 6 finds the synthetic guest click needs a different sequence
  (e.g. a settle delay, an extra `mouseMove`, `clickCount` quirks), `mouseClickEvents` is the single
  place to adjust; the helpers and tests are structured around it.

## Files Affected
- `src/main/automation/input.js` — **new**: pure mapping/builders + `sendInput` + foreground-to-act helpers.
- `test/unit/automation-input.test.js` — **new**: unit tests.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified (unit-level; live recipe validation deferred to Leg 6)
- [x] Tests passing (`npm test`, `npm run typecheck`, `npm run lint`)
- [x] Update flight-log.md with leg progress entry (note the live recipe is pending Leg 6 tuning)
- [x] Set this leg's status to `landed` (batch commit at flight end — do NOT commit, do NOT `[COMPLETE:leg]`)
- [x] Do NOT check off the leg in flight.md yet (batch at flight end)
