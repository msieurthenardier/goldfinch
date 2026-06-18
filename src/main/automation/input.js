// @ts-check
'use strict';
const { resolveContents, classifyContents } = require('./resolve');
const { withDebuggerSession } = require('./cdp');
// Trusted input via webContents.sendInputEvent (fires real handlers + native focus
// traversal). MOUSE RECIPE NOTE: mouseMove→mouseDown→mouseUp is the known-good starting
// sequence (mirrors the recipe proven by the Flight 1-3 CDP apparatus, since removed); the
// live click-on-guest reliability + guest coordinate space are confirmed/tuned in Leg 6.
//
// DD8 NOTE: `scroll` now uses webContents.debugger via the shared cdp.js session helper
// (operator-approved boundary crossing). sendInputEvent mouseWheel produced ZERO movement
// on webview guests even with mouseMove + chunked deltas + canScroll (confirmed live).
// The fix is CDP Input.dispatchMouseEvent — the same in-process debugger mechanism
// readAxTree uses. The shared lock in cdp.js (attached Set) prevents a concurrent
// scroll + readAxTree on one wcId from both attaching. All other ops (click / typeText /
// pressKey / sendInput) remain sendInputEvent-based and debugger-free.

// ---------------------------------------------------------------------------
// Pure key-name → Electron Accelerator code map
// ---------------------------------------------------------------------------

const KEY_MAP = {
  Tab: 'Tab', Enter: 'Enter', Escape: 'Escape', Space: 'Space',
  ArrowRight: 'Right', ArrowLeft: 'Left', ArrowDown: 'Down', ArrowUp: 'Up',
  Home: 'Home', End: 'End', Delete: 'Delete', Backspace: 'Backspace',
};

// Canonical Electron modifier vocabulary. Electron `^42` sendInputEvent accepts
// both forms (control/ctrl, meta/cmd/command, alt/option, shift) natively — we
// normalize to ONE internal vocabulary so the contract is clean and typos throw
// rather than being silently dropped (a dropped modifier would false-pass a chord
// checkpoint). The MCP tool schema advertises only these canonical four; the alias
// map below is defensive for callers that pass the common variants directly.
const CANONICAL_MODIFIERS = ['control', 'shift', 'alt', 'meta'];
const MODIFIER_ALIASES = {
  control: 'control', ctrl: 'control',
  shift: 'shift',
  alt: 'alt', option: 'alt',
  meta: 'meta', cmd: 'meta', command: 'meta',
};

/**
 * Normalize a single modifier name to its canonical form, throwing on unknown.
 *
 * Aliases (ctrl→control, cmd/command→meta, option→alt) are lower-cased and mapped;
 * an unrecognized modifier throws (mirrors the unknown-key throw) so a typo cannot
 * silently produce a chord missing a modifier.
 *
 * @param {string} mod
 * @returns {string} canonical modifier name
 * @throws {Error} if the modifier is not a known alias of the canonical four
 */
function normalizeModifier(mod) {
  const canonical = MODIFIER_ALIASES[String(mod).toLowerCase()];
  if (!canonical) throw new Error(
    'automation: unknown modifier ' + mod +
    ' (known: ' + CANONICAL_MODIFIERS.join(', ') +
    '; aliases: ctrl, cmd, command, option)'
  );
  return canonical;
}

/**
 * Map a friendly key name (+ optional modifier chord) to the Electron
 * sendInputEvent keyboard event pair.
 *
 * Key resolution order: the `ShiftTab` composite first, then the `KEY_MAP`
 * friendly names (arrows → Right/Left/Down/Up, etc.), then — for chord use — a
 * single printable letter/digit (`/^[a-z0-9]$/i`) resolving to its Electron
 * Accelerator keyCode (letters uppercased, digits as-is, e.g. `M`/`1`). A name
 * that resolves through none of these throws.
 *
 * The optional `modifiers` list is normalized to the canonical vocabulary
 * (control/shift/alt/meta) — aliases map, unknowns throw — and merged + de-duped
 * with any intrinsic composite modifier (ShiftTab keeps `shift`). With no
 * modifiers passed, the output is byte-identical to the pre-chord behavior.
 *
 * @param {string} name  friendly key name, ShiftTab, or a single printable letter/digit
 * @param {string[]} [modifiers]  optional modifier keys held during the press
 * @returns {{ type: string, keyCode: string, modifiers: string[] }[]}
 * @throws {Error} if the key name does not resolve, or a modifier is unknown
 */
function keyEvents(name, modifiers = []) {
  let keyCode;
  const intrinsic = [];
  if (name === 'ShiftTab') { keyCode = 'Tab'; intrinsic.push('shift'); }
  else if (KEY_MAP[name]) { keyCode = KEY_MAP[name]; }
  else if (typeof name === 'string' && /^[a-z0-9]$/i.test(name)) {
    // Single printable letter/digit → Electron Accelerator keyCode for chord use.
    // Letters use the uppercase form (Accelerator convention); digits stay as-is.
    keyCode = name.toUpperCase();
  }
  if (!keyCode) throw new Error(
    'automation: unknown key ' + name +
    ' (known: ' + Object.keys(KEY_MAP).join(', ') +
    ', ShiftTab, or a single letter/digit)'
  );
  // Normalize + validate the caller's modifiers, then merge with the composite's
  // intrinsic modifier and de-dupe (preserving canonical order so an empty list
  // yields the same modifiers:[] as before — AC4 byte-identical).
  const requested = modifiers.map(normalizeModifier);
  const merged = [...intrinsic, ...requested];
  const finalModifiers = CANONICAL_MODIFIERS.filter((m) => merged.includes(m));
  return [
    { type: 'keyDown', keyCode, modifiers: finalModifiers },
    { type: 'keyUp', keyCode, modifiers: finalModifiers },
  ];
}

// ---------------------------------------------------------------------------
// Pure mouse / char event builders
// ---------------------------------------------------------------------------

/**
 * Build the ordered mouse event array for a synthetic click.
 *
 * mouseMove → mouseDown (buttons:1) → mouseUp (buttons:0).
 * The `buttons` bitmask mirrors the recipe proven by the Flight 1-3 CDP apparatus
 * (since removed) so a page's `event.buttons` sees the press. Confirmed live in
 * Flight-1 Leg 6: the buttons bitmask makes a page's `event.buttons` see the press.
 *
 * @param {number} x
 * @param {number} y
 * @param {{ button?: string, clickCount?: number }} [opts]
 * @returns {object[]}
 */
function mouseClickEvents(x, y, { button = 'left', clickCount = 1 } = {}) {
  return [
    { type: 'mouseMove', x, y },
    // buttons bitmask (1 down / 0 up) mirrors the recipe proven by the Flight 1-3 CDP apparatus
    // (since removed) so a page's event.buttons sees the press. Confirmed live in Flight-1 Leg 6.
    { type: 'mouseDown', x, y, button, clickCount, buttons: 1 },
    { type: 'mouseUp',   x, y, button, clickCount, buttons: 0 },
  ];
}

/**
 * Build one char event per character (text input only — for named keys use pressKey/keyEvents).
 *
 * The character string goes in `keyCode` (Electron char event convention).
 *
 * @param {string} text
 * @returns {{ type: 'char', keyCode: string }[]}
 */
function charEvents(text) {
  return [...String(text)].map((ch) => ({ type: 'char', keyCode: ch }));
}

// ---------------------------------------------------------------------------
// Low-level single-event primitive (no foreground-to-act)
// ---------------------------------------------------------------------------

/**
 * Low-level single-event primitive — resolve the target (DD5) then call
 * wc.sendInputEvent(event). Does NOT foreground-to-act; the click/typeText/
 * pressKey helpers (below) are the DD3-correct entry points for guests.
 * No webContents.debugger in sendInput itself (only scroll uses the debugger).
 *
 * @param {number} wcId
 * @param {object} event
 * @param {{ fromId: (id: number) => any, chromeContents?: any, allowInternal?: boolean }} deps
 */
function sendInput(wcId, event, deps) {
  const wc = resolveContents(wcId, deps);
  wc.sendInputEvent(event);
}

// ---------------------------------------------------------------------------
// Foreground-to-act helpers (DD3: bring guest to front before acting)
// ---------------------------------------------------------------------------

/**
 * Resolve + conditionally activate, then send all events in order.
 *
 * For a GUEST target with an injected `activate` callback: awaits activate(wcId)
 * (brings the guest to front, DD3), then re-resolves the webContents (stale-handle
 * guard — the pre-activate handle may be invalid after the async await), then sends
 * events.
 *
 * For a CHROME target: does not activate (the chrome renderer is always live).
 *
 * @param {number} wcId
 * @param {object[]} events
 * @param {{ fromId: (id: number) => any, chromeContents: any, activate?: (id: number) => Promise<void>, allowInternal?: boolean }} deps
 */
async function actOn(wcId, events, deps) {
  const { chromeContents, activate } = deps;
  // BOTH resolveContents calls (pre- and post-activate) forward the FULL deps so
  // allowInternal flows on each — otherwise admin's internal drive would re-throw
  // on the second resolve (DD6 / Leg 2).
  let wc = resolveContents(wcId, deps);
  if (classifyContents(wc, chromeContents) === 'guest' && typeof activate === 'function') {
    await activate(wcId);                      // DD3 foreground-to-act (guest only)
    // Re-resolve AFTER the async activate: the pre-activate handle may be stale by now,
    // and re-resolving re-applies the DD5 guard post-activation. Always resolve immediately
    // before acting (the discipline the rest of the module group follows).
    wc = resolveContents(wcId, deps);
  }
  for (const ev of events) wc.sendInputEvent(ev);
}

/**
 * Synthetic click at (x, y) in the target's viewport.
 * Coordinate space for guests is guest-viewport-relative — confirmed/tuned in Leg 6.
 *
 * @param {number} wcId
 * @param {number} x
 * @param {number} y
 * @param {{ fromId: (id: number) => any, chromeContents: any, activate?: (id: number) => Promise<void> }} deps
 * @param {{ button?: string, clickCount?: number }} [opts]
 */
const click = (wcId, x, y, deps, opts) => actOn(wcId, mouseClickEvents(x, y, opts), deps);

/**
 * Type text character-by-character via char events.
 * For named keys (Enter/Tab/…) use pressKey instead.
 *
 * @param {number} wcId
 * @param {string} text
 * @param {{ fromId: (id: number) => any, chromeContents: any, activate?: (id: number) => Promise<void> }} deps
 */
const typeText = (wcId, text, deps) => actOn(wcId, charEvents(text), deps);

/**
 * Scroll via the in-process CDP debugger (Input.dispatchMouseEvent / mouseWheel).
 *
 * sendInputEvent mouseWheel produces ZERO movement on webview guests (confirmed live:
 * screenshot hash unchanged across a no-op recapture baseline). The fix is to dispatch
 * the wheel event through the CDP Input domain — the same in-process webContents.debugger
 * mechanism readAxTree uses for the Accessibility domain (DD8-crossing, operator-approved).
 *
 * Sequence mirrors readAxTree:
 *   resolveContents (throws bad/dead/internal; allowInternal forwarded) →
 *   if guest + activate: await activate(wcId) + RE-RESOLVE (stale-handle guard) →
 *   withDebuggerSession (acquire shared lock, attach '1.3') →
 *   Input.dispatchMouseEvent { type:'mouseWheel', x, y, deltaX, deltaY } →
 *   detach in finally, release lock in finally.
 *
 * The CDP Input domain needs no `enable` call before dispatching.
 *
 * Return contract (mirrors readAxTree):
 *   - success → void (the MCP engine serializes void ops to {"ok":true})
 *   - locked / attach-failed → RETURNS the debugger-unavailable refusal object
 *     (a NORMAL result, not isError — callers check result.automation)
 *   - bad/dead/internal → THROWS via resolveContents (programmer / security error)
 *
 * Signature preserves `scroll(wcId, x, y, dx, dy, deps)` so engine.js / mcp-tools.js
 * wiring is unchanged. wc.debugger is on the resolved wc — no new deps needed.
 *
 * @param {number} wcId
 * @param {number} x
 * @param {number} y
 * @param {number} dx  pixel delta on X axis
 * @param {number} dy  pixel delta on Y axis
 * @param {{
 *   fromId: (id: number) => any,
 *   chromeContents: any,
 *   activate?: (id: number) => Promise<void>,
 *   allowInternal?: boolean,
 * }} deps
 * @returns {Promise<void | { automation: 'debugger-unavailable', reason: string, wcId: number }>}
 */
async function scroll(wcId, x, y, dx, dy, deps) {
  const { chromeContents, activate } = deps;
  let wc = resolveContents(wcId, deps);  // throws bad/dead/internal (DD6); allowInternal forwarded
  if (classifyContents(wc, chromeContents) === 'guest' && typeof activate === 'function') {
    await activate(wcId);                // DD5 foreground-to-act (guest only)
    // Re-resolve AFTER the async activate: the pre-activate handle may be stale, and
    // re-resolving re-applies the DD6 guard post-activation (the Flight-1 discipline).
    wc = resolveContents(wcId, deps);
  }
  // withDebuggerSession acquires the shared single-client lock (cdp.js `attached` Set),
  // attaches '1.3', runs the dispatch, and detaches in a finally. The shared lock means
  // a concurrent scroll + readAxTree on the same wcId cannot both attach.
  return withDebuggerSession(wcId, wc, async (/** @type {any} */ w) => {
    await w.debugger.sendCommand('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x,
      y,
      deltaX: dx,
      deltaY: dy,
    });
    // Success → return void; engine serializes void ops to {"ok":true}.
  });
}

/**
 * Press a named key, optionally as a modifier chord (keyDown + keyUp pair).
 *
 * @param {number} wcId
 * @param {string} name  friendly key name (Tab, Enter, ArrowRight, ShiftTab, …) or a single letter/digit for chords
 * @param {string[]|undefined} modifiers  optional modifier keys held during the press (e.g. ['control'] for Ctrl+M); undefined → none
 * @param {{ fromId: (id: number) => any, chromeContents: any, activate?: (id: number) => Promise<void> }} deps
 */
const pressKey = (wcId, name, modifiers, deps) => actOn(wcId, keyEvents(name, modifiers), deps);

// ---------------------------------------------------------------------------
// Exports — pure builders exposed for tests; helpers for the glue layer
// ---------------------------------------------------------------------------

module.exports = {
  keyEvents,
  mouseClickEvents,
  charEvents,
  sendInput,
  click,
  typeText,
  scroll,
  pressKey,
};
