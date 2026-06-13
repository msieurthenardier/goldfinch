// @ts-check
'use strict';
const { resolveContents, classifyContents } = require('./resolve');
// Trusted input via webContents.sendInputEvent (fires real handlers + native focus
// traversal). Debugger-free (DD8). MOUSE RECIPE NOTE: mouseMove→mouseDown→mouseUp is the
// known-good starting sequence (mirrors the working CDP driver, cdp-driver.mjs:91-93);
// the live click-on-guest reliability + guest coordinate space are confirmed/tuned in Leg 6.

// ---------------------------------------------------------------------------
// Pure key-name → Electron Accelerator code map
// ---------------------------------------------------------------------------

const KEY_MAP = {
  Tab: 'Tab', Enter: 'Enter', Escape: 'Escape', Space: 'Space',
  ArrowRight: 'Right', ArrowLeft: 'Left', ArrowDown: 'Down', ArrowUp: 'Up',
  Home: 'Home', End: 'End', Delete: 'Delete', Backspace: 'Backspace',
};

/**
 * Map a friendly key name to the Electron sendInputEvent keyboard event pair.
 *
 * Uses Electron Accelerator key codes (arrows → Right/Left/Down/Up, etc.).
 * ShiftTab is a special composite (keyCode:'Tab', modifiers:['shift']).
 *
 * @param {string} name  friendly key name
 * @returns {{ type: string, keyCode: string, modifiers: string[] }[]}
 * @throws {Error} if the key name is not in KEY_MAP and is not 'ShiftTab'
 */
function keyEvents(name) {
  let keyCode, modifiers = [];
  if (name === 'ShiftTab') { keyCode = 'Tab'; modifiers = ['shift']; }
  else { keyCode = KEY_MAP[name]; }
  if (!keyCode) throw new Error(
    'automation: unknown key ' + name +
    ' (known: ' + Object.keys(KEY_MAP).join(', ') + ', ShiftTab)'
  );
  return [
    { type: 'keyDown', keyCode, modifiers },
    { type: 'keyUp', keyCode, modifiers },
  ];
}

// ---------------------------------------------------------------------------
// Pure mouse / char / scroll event builders
// ---------------------------------------------------------------------------

/**
 * Build the ordered mouse event array for a synthetic click.
 *
 * mouseMove → mouseDown (buttons:1) → mouseUp (buttons:0).
 * The `buttons` bitmask mirrors the working CDP recipe (cdp-driver.mjs:92-93)
 * so a page's `event.buttons` sees the press. Pending Leg 6 live confirmation.
 *
 * @param {number} x
 * @param {number} y
 * @param {{ button?: string, clickCount?: number }} [opts]
 * @returns {object[]}
 */
function mouseClickEvents(x, y, { button = 'left', clickCount = 1 } = {}) {
  return [
    { type: 'mouseMove', x, y },
    // buttons bitmask (1 down / 0 up) mirrors the working CDP recipe (cdp-driver.mjs:92-93)
    // so a page's event.buttons sees the press. Pending Leg 6 live confirmation.
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

/**
 * Build a single mouseWheel event.
 *
 * `canScroll: true` is REQUIRED or Electron silently delivers no scroll.
 * `wheelTicksX/Y` are the conventional delta/120 tick counts.
 *
 * @param {number} x
 * @param {number} y
 * @param {number} deltaX  pixel delta on X axis
 * @param {number} deltaY  pixel delta on Y axis
 * @returns {object}
 */
function scrollEvent(x, y, deltaX, deltaY) {
  return {
    type: 'mouseWheel', x, y, deltaX, deltaY,
    wheelTicksX: deltaX / 120, wheelTicksY: deltaY / 120,
    canScroll: true,
  };
}

// ---------------------------------------------------------------------------
// Low-level single-event primitive (no foreground-to-act)
// ---------------------------------------------------------------------------

/**
 * Low-level single-event primitive — resolve the target (DD5) then call
 * wc.sendInputEvent(event). Does NOT foreground-to-act; the click/typeText/
 * scroll/pressKey helpers (below) are the DD3-correct entry points for guests.
 * No webContents.debugger anywhere in this module (DD8).
 *
 * @param {number} wcId
 * @param {object} event
 * @param {{ fromId: (id: number) => any, chromeContents: any }} deps
 */
function sendInput(wcId, event, { fromId, chromeContents }) {
  const wc = resolveContents(wcId, { fromId, chromeContents });
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
 * @param {{ fromId: (id: number) => any, chromeContents: any, activate?: (id: number) => Promise<void> }} deps
 */
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
 * Synthetic scroll wheel event.
 *
 * @param {number} wcId
 * @param {number} x
 * @param {number} y
 * @param {number} dx  pixel delta on X axis
 * @param {number} dy  pixel delta on Y axis
 * @param {{ fromId: (id: number) => any, chromeContents: any, activate?: (id: number) => Promise<void> }} deps
 */
const scroll = (wcId, x, y, dx, dy, deps) => actOn(wcId, [scrollEvent(x, y, dx, dy)], deps);

/**
 * Press a named key (keyDown + keyUp pair).
 *
 * @param {number} wcId
 * @param {string} name  friendly key name (Tab, Enter, ArrowRight, ShiftTab, …)
 * @param {{ fromId: (id: number) => any, chromeContents: any, activate?: (id: number) => Promise<void> }} deps
 */
const pressKey = (wcId, name, deps) => actOn(wcId, keyEvents(name), deps);

// ---------------------------------------------------------------------------
// Exports — pure builders exposed for tests; helpers for the glue layer
// ---------------------------------------------------------------------------

module.exports = {
  keyEvents,
  mouseClickEvents,
  charEvents,
  scrollEvent,
  sendInput,
  click,
  typeText,
  scroll,
  pressKey,
};
