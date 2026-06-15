'use strict';

// Unit tests for src/main/automation/input.js
//
// Electron-free: input.js does NOT require('electron') at the top, so these
// tests run under plain `node --test` with no Electron stub.
// Fake wc / fromId / activate stand in for the real Electron handles.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  keyEvents,
  mouseClickEvents,
  charEvents,
  sendInput,
  click,
  typeText,
  pressKey,
} = require('../../src/main/automation/input');

// ---------------------------------------------------------------------------
// Helpers — build fake wc objects and deps
// ---------------------------------------------------------------------------

function makeGuestWc(id) {
  return {
    id,
    session: { __goldfinchInternal: false },
    isDestroyed() { return false; },
    /** @type {object[]} */
    _received: [],
    /** @param {object} ev */
    sendInputEvent(ev) { this._received.push(ev); },
  };
}

function makeInternalWc(id) {
  return {
    id,
    session: { __goldfinchInternal: true },
    isDestroyed() { return false; },
    _received: [],
    sendInputEvent(ev) { this._received.push(ev); },
  };
}

function makeDestroyedWc(id) {
  return {
    id,
    session: { __goldfinchInternal: false },
    isDestroyed() { return true; },
    _received: [],
    sendInputEvent(ev) { this._received.push(ev); },
  };
}

/**
 * Build a fake fromId lookup backed by a map of id → fake wc.
 * @param {Record<number, object>} map
 */
function makeFakeFromId(map) {
  return (/** @type {number} */ id) => map[id] ?? null;
}

// ---------------------------------------------------------------------------
// keyEvents — mapping, ShiftTab, unknown-key throw
// ---------------------------------------------------------------------------

test('keyEvents: Tab → keyCode "Tab", no modifiers', () => {
  const evs = keyEvents('Tab');
  assert.equal(evs.length, 2);
  assert.equal(evs[0].type, 'keyDown');
  assert.equal(evs[0].keyCode, 'Tab');
  assert.deepEqual(evs[0].modifiers, []);
  assert.equal(evs[1].type, 'keyUp');
  assert.equal(evs[1].keyCode, 'Tab');
  assert.deepEqual(evs[1].modifiers, []);
});

test('keyEvents: Enter → keyCode "Enter"', () => {
  assert.equal(keyEvents('Enter')[0].keyCode, 'Enter');
});

test('keyEvents: Escape → keyCode "Escape"', () => {
  assert.equal(keyEvents('Escape')[0].keyCode, 'Escape');
});

test('keyEvents: Space → keyCode "Space"', () => {
  assert.equal(keyEvents('Space')[0].keyCode, 'Space');
});

test('keyEvents: ArrowRight → Electron Accelerator code "Right"', () => {
  const evs = keyEvents('ArrowRight');
  assert.equal(evs[0].keyCode, 'Right');
  assert.equal(evs[1].keyCode, 'Right');
});

test('keyEvents: ArrowLeft → "Left"', () => {
  assert.equal(keyEvents('ArrowLeft')[0].keyCode, 'Left');
});

test('keyEvents: ArrowDown → "Down"', () => {
  assert.equal(keyEvents('ArrowDown')[0].keyCode, 'Down');
});

test('keyEvents: ArrowUp → "Up"', () => {
  assert.equal(keyEvents('ArrowUp')[0].keyCode, 'Up');
});

test('keyEvents: Home → "Home"', () => {
  assert.equal(keyEvents('Home')[0].keyCode, 'Home');
});

test('keyEvents: End → "End"', () => {
  assert.equal(keyEvents('End')[0].keyCode, 'End');
});

test('keyEvents: Delete → "Delete"', () => {
  assert.equal(keyEvents('Delete')[0].keyCode, 'Delete');
});

test('keyEvents: Backspace → "Backspace"', () => {
  assert.equal(keyEvents('Backspace')[0].keyCode, 'Backspace');
});

test('keyEvents: ShiftTab → keyCode "Tab", modifiers ["shift"] (both keyDown and keyUp)', () => {
  const evs = keyEvents('ShiftTab');
  assert.equal(evs.length, 2);
  assert.equal(evs[0].type, 'keyDown');
  assert.equal(evs[0].keyCode, 'Tab');
  assert.deepEqual(evs[0].modifiers, ['shift']);
  assert.equal(evs[1].type, 'keyUp');
  assert.equal(evs[1].keyCode, 'Tab');
  assert.deepEqual(evs[1].modifiers, ['shift']);
});

test('keyEvents: unknown key → throws with "automation: unknown key" and lists known names', () => {
  assert.throws(
    () => keyEvents('Nope'),
    (err) => {
      return err instanceof Error &&
        err.message.includes('automation: unknown key') &&
        err.message.includes('Nope') &&
        err.message.includes('Tab') &&       // sanity-check some known names are listed
        err.message.includes('ShiftTab');
    }
  );
});

test('keyEvents: unknown key (empty string) → throws', () => {
  assert.throws(() => keyEvents(''), (err) => err instanceof Error && err.message.includes('automation: unknown key'));
});

// ---------------------------------------------------------------------------
// mouseClickEvents — ordering, types, coords, button/clickCount, buttons bitmask
// ---------------------------------------------------------------------------

test('mouseClickEvents: returns 3 events in order mouseMove → mouseDown → mouseUp', () => {
  const evs = mouseClickEvents(10, 20);
  assert.equal(evs.length, 3);
  assert.equal(evs[0].type, 'mouseMove');
  assert.equal(evs[1].type, 'mouseDown');
  assert.equal(evs[2].type, 'mouseUp');
});

test('mouseClickEvents: coordinates propagate to all three events', () => {
  const evs = mouseClickEvents(42, 99);
  assert.equal(evs[0].x, 42); assert.equal(evs[0].y, 99);
  assert.equal(evs[1].x, 42); assert.equal(evs[1].y, 99);
  assert.equal(evs[2].x, 42); assert.equal(evs[2].y, 99);
});

test('mouseClickEvents: buttons bitmask — mouseDown carries buttons:1 (press)', () => {
  const evs = mouseClickEvents(10, 20);
  assert.equal(evs[1].buttons, 1, 'mouseDown must carry buttons:1');
});

test('mouseClickEvents: buttons bitmask — mouseUp carries buttons:0 (release)', () => {
  const evs = mouseClickEvents(10, 20);
  assert.equal(evs[2].buttons, 0, 'mouseUp must carry buttons:0');
});

test('mouseClickEvents: default button is "left", clickCount is 1', () => {
  const evs = mouseClickEvents(0, 0);
  assert.equal(evs[1].button, 'left');
  assert.equal(evs[1].clickCount, 1);
  assert.equal(evs[2].button, 'left');
  assert.equal(evs[2].clickCount, 1);
});

test('mouseClickEvents: custom button and clickCount propagate', () => {
  const evs = mouseClickEvents(5, 5, { button: 'right', clickCount: 2 });
  assert.equal(evs[1].button, 'right');
  assert.equal(evs[1].clickCount, 2);
  assert.equal(evs[2].button, 'right');
  assert.equal(evs[2].clickCount, 2);
});

test('mouseClickEvents: mouseMove has no button/clickCount/buttons (move-type event)', () => {
  const evs = mouseClickEvents(0, 0);
  assert.equal(evs[0].button, undefined);
  assert.equal(evs[0].clickCount, undefined);
  assert.equal(evs[0].buttons, undefined);
});

// ---------------------------------------------------------------------------
// charEvents — character in keyCode, one event per char
// ---------------------------------------------------------------------------

test('charEvents: "hi" → two char events with character in keyCode', () => {
  const evs = charEvents('hi');
  assert.equal(evs.length, 2);
  assert.equal(evs[0].type, 'char');
  assert.equal(evs[0].keyCode, 'h');
  assert.equal(evs[1].type, 'char');
  assert.equal(evs[1].keyCode, 'i');
});

test('charEvents: empty string → []', () => {
  const evs = charEvents('');
  assert.deepEqual(evs, []);
});

test('charEvents: single char → one event', () => {
  const evs = charEvents('A');
  assert.equal(evs.length, 1);
  assert.equal(evs[0].keyCode, 'A');
});

test('charEvents: special chars propagate as-is', () => {
  const evs = charEvents('!@');
  assert.equal(evs[0].keyCode, '!');
  assert.equal(evs[1].keyCode, '@');
});

// scrollEvent and scrollEvents were removed when scroll was reimplemented via CDP
// (Input.dispatchMouseEvent). Tests for the new CDP-based scroll live in
// automation-scroll.test.js (mirrors the readAxTree test pattern with a fake wc.debugger).

// ---------------------------------------------------------------------------
// sendInput — resolve-rejection passthrough (no activation)
// ---------------------------------------------------------------------------

test('sendInput: valid guest wcId → wc.sendInputEvent called with the event', () => {
  const wc = makeGuestWc(10);
  const deps = { fromId: makeFakeFromId({ 10: wc }), chromeContents: null };
  const ev = { type: 'keyDown', keyCode: 'Enter', modifiers: [] };
  sendInput(10, ev, deps);
  assert.equal(wc._received.length, 1);
  assert.deepEqual(wc._received[0], ev);
});

test('sendInput: internal-session wcId → throws internal-session, no event sent', () => {
  const internalWc = makeInternalWc(99);
  const deps = { fromId: makeFakeFromId({ 99: internalWc }), chromeContents: null };
  assert.throws(
    () => sendInput(99, { type: 'char', keyCode: 'x' }, deps),
    (err) => err instanceof Error && err.message.includes('automation: internal-session')
  );
  assert.equal(internalWc._received.length, 0);
});

test('sendInput: bad-handle (string wcId) → throws bad-handle', () => {
  const deps = { fromId: makeFakeFromId({}), chromeContents: null };
  assert.throws(
    // @ts-expect-error — intentionally passing wrong type
    () => sendInput('10', { type: 'char', keyCode: 'x' }, deps),
    (err) => err instanceof Error && err.message.includes('automation: bad-handle')
  );
});

test('sendInput: no-such-contents (unknown wcId) → throws no-such-contents', () => {
  const deps = { fromId: makeFakeFromId({}), chromeContents: null };
  assert.throws(
    () => sendInput(42, { type: 'char', keyCode: 'x' }, deps),
    (err) => err instanceof Error && err.message.includes('automation: no-such-contents')
  );
});

test('sendInput: destroyed wcId → throws no-such-contents, no event sent', () => {
  const destroyed = makeDestroyedWc(55);
  const deps = { fromId: makeFakeFromId({ 55: destroyed }), chromeContents: null };
  assert.throws(
    () => sendInput(55, { type: 'char', keyCode: 'x' }, deps),
    (err) => err instanceof Error && err.message.includes('automation: no-such-contents')
  );
  assert.equal(destroyed._received.length, 0);
});

// ---------------------------------------------------------------------------
// click — foreground-to-act behavior (DD3)
// ---------------------------------------------------------------------------

test('click: guest target — activate called once with wcId BEFORE sendInputEvent calls', async () => {
  const guestWc = makeGuestWc(20);
  const callLog = [];

  const activate = async (/** @type {number} */ id) => { callLog.push({ what: 'activate', id }); };
  // Wrap sendInputEvent to track ordering
  const originalSend = guestWc.sendInputEvent.bind(guestWc);
  guestWc.sendInputEvent = (ev) => { callLog.push({ what: 'sendInputEvent', type: ev.type }); originalSend(ev); };

  const deps = {
    fromId: makeFakeFromId({ 20: guestWc }),
    chromeContents: null,  // guestWc is not === chromeContents, so classified as guest
    activate,
  };

  await click(20, 10, 10, deps);

  // activate must come before any sendInputEvent
  const activateIdx = callLog.findIndex((e) => e.what === 'activate');
  const firstSendIdx = callLog.findIndex((e) => e.what === 'sendInputEvent');
  assert.ok(activateIdx !== -1, 'activate must be called');
  assert.ok(firstSendIdx !== -1, 'sendInputEvent must be called');
  assert.ok(activateIdx < firstSendIdx, 'activate must be called before the first sendInputEvent');

  // activate called exactly once with the guest wcId
  const activateCalls = callLog.filter((e) => e.what === 'activate');
  assert.equal(activateCalls.length, 1);
  assert.equal(activateCalls[0].id, 20);

  // 3 events sent: mouseMove, mouseDown, mouseUp
  assert.equal(guestWc._received.length, 3);
  assert.equal(guestWc._received[0].type, 'mouseMove');
  assert.equal(guestWc._received[1].type, 'mouseDown');
  assert.equal(guestWc._received[2].type, 'mouseUp');
});

test('click: chrome target — activate NOT called (chrome is always live)', async () => {
  const chromeWc = makeGuestWc(1);  // same object will be chromeContents
  const activateCalls = [];
  const activate = async (id) => { activateCalls.push(id); };

  const deps = {
    fromId: makeFakeFromId({ 1: chromeWc }),
    chromeContents: chromeWc,  // classify as 'chrome'
    activate,
  };

  await click(1, 5, 5, deps);

  assert.equal(activateCalls.length, 0, 'activate must NOT be called for a chrome target');
  assert.equal(chromeWc._received.length, 3, 'events must still be sent');
});

test('click: internal-session wcId → throws, activate not called, no events sent', async () => {
  const internalWc = makeInternalWc(77);
  const activateCalls = [];
  const activate = async (id) => { activateCalls.push(id); };

  const deps = { fromId: makeFakeFromId({ 77: internalWc }), chromeContents: null, activate };

  await assert.rejects(
    () => click(77, 0, 0, deps),
    (err) => err instanceof Error && err.message.includes('automation: internal-session')
  );
  assert.equal(activateCalls.length, 0);
  assert.equal(internalWc._received.length, 0);
});

// ---------------------------------------------------------------------------
// typeText — correct events, foreground-to-act
// ---------------------------------------------------------------------------

test('typeText: sends one char event per character to guest after activation', async () => {
  const guestWc = makeGuestWc(30);
  const activateCalls = [];
  const activate = async (id) => { activateCalls.push(id); };
  const deps = { fromId: makeFakeFromId({ 30: guestWc }), chromeContents: null, activate };

  await typeText(30, 'ab', deps);

  assert.equal(activateCalls.length, 1);
  assert.equal(guestWc._received.length, 2);
  assert.equal(guestWc._received[0].type, 'char');
  assert.equal(guestWc._received[0].keyCode, 'a');
  assert.equal(guestWc._received[1].keyCode, 'b');
});

test('typeText: empty string — activates but sends no events', async () => {
  const guestWc = makeGuestWc(31);
  const activateCalls = [];
  const activate = async (id) => { activateCalls.push(id); };
  const deps = { fromId: makeFakeFromId({ 31: guestWc }), chromeContents: null, activate };

  await typeText(31, '', deps);

  assert.equal(activateCalls.length, 1, 'activate is called even for empty text (resolve happens first)');
  assert.equal(guestWc._received.length, 0);
});

// scrollEvents and the old sendInputEvent-based scroll helper were removed when scroll was
// reimplemented via CDP (Input.dispatchMouseEvent). Tests for the new CDP-based scroll live in
// automation-scroll.test.js (mirrors the readAxTree test pattern with a fake wc.debugger).

// ---------------------------------------------------------------------------
// pressKey — correct events sent to correct target
// ---------------------------------------------------------------------------

test('pressKey: "Enter" sends keyDown+keyUp pair to guest', async () => {
  const guestWc = makeGuestWc(50);
  const deps = { fromId: makeFakeFromId({ 50: guestWc }), chromeContents: null };

  await pressKey(50, 'Enter', deps);

  assert.equal(guestWc._received.length, 2);
  assert.equal(guestWc._received[0].type, 'keyDown');
  assert.equal(guestWc._received[0].keyCode, 'Enter');
  assert.equal(guestWc._received[1].type, 'keyUp');
  assert.equal(guestWc._received[1].keyCode, 'Enter');
});

test('pressKey: "ArrowRight" maps to Electron code "Right"', async () => {
  const guestWc = makeGuestWc(51);
  const deps = { fromId: makeFakeFromId({ 51: guestWc }), chromeContents: null };

  await pressKey(51, 'ArrowRight', deps);

  assert.equal(guestWc._received[0].keyCode, 'Right');
  assert.equal(guestWc._received[1].keyCode, 'Right');
});

test('pressKey: unknown key name → throws before any send', () => {
  // keyEvents throws synchronously before actOn is reached, so pressKey itself
  // throws synchronously (not a rejected promise) when given an unknown key.
  const guestWc = makeGuestWc(52);
  const deps = { fromId: makeFakeFromId({ 52: guestWc }), chromeContents: null };

  assert.throws(
    () => pressKey(52, 'NotAKey', deps),
    (err) => err instanceof Error && err.message.includes('automation: unknown key')
  );
  assert.equal(guestWc._received.length, 0);
});
