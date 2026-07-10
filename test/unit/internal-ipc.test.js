'use strict';

// Unit tests for src/main/internal-ipc.js
//
// Electron-free: the module does NOT require('electron') at the top, so these
// tests run under plain `node --test` with no Electron stub.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { isTrustedInternalSender, registerInternalHandler } = require('../../src/main/internal-ipc');

// ---------------------------------------------------------------------------
// isTrustedInternalSender — predicate matrix
// ---------------------------------------------------------------------------

test('isTrustedInternalSender: settings origin + true → true', () => {
  assert.equal(isTrustedInternalSender('goldfinch://settings', true), true);
});

test('isTrustedInternalSender: downloads origin + internal session (true) → true', () => {
  // Flight 5: the allowlist now admits the second internal page.
  assert.equal(isTrustedInternalSender('goldfinch://downloads', true), true);
});

test('isTrustedInternalSender: jars origin + internal session (true) → true', () => {
  // Flight 3 (F3): the allowlist now admits the third internal page.
  assert.equal(isTrustedInternalSender('goldfinch://jars', true), true);
});

test('isTrustedInternalSender: jars origin + non-internal session (false) → false', () => {
  assert.equal(isTrustedInternalSender('goldfinch://jars', false), false);
});

test('isTrustedInternalSender: web origin (https://evil.test) + internal session → false', () => {
  assert.equal(isTrustedInternalSender('https://evil.test', true), false);
});

test('isTrustedInternalSender: allowlisted (downloads) origin + non-internal session (false) → false', () => {
  assert.equal(isTrustedInternalSender('goldfinch://downloads', false), false);
});

test('isTrustedInternalSender: exact origin + false → false', () => {
  assert.equal(isTrustedInternalSender('goldfinch://settings', false), false);
});

test('isTrustedInternalSender: exact origin + truthy-but-not-true (1) → false (pins strict ===true)', () => {
  assert.equal(isTrustedInternalSender('goldfinch://settings', 1), false);
});

test('isTrustedInternalSender: wrong origin (https://evil.test) + true → false', () => {
  assert.equal(isTrustedInternalSender('https://evil.test', true), false);
});

test('isTrustedInternalSender: wrong host (goldfinch://other) + true → false', () => {
  assert.equal(isTrustedInternalSender('goldfinch://other', true), false);
});

test('isTrustedInternalSender: trailing slash (goldfinch://settings/) + true → false', () => {
  assert.equal(isTrustedInternalSender('goldfinch://settings/', true), false);
});

test('isTrustedInternalSender: null origin → false', () => {
  assert.equal(isTrustedInternalSender(null, true), false);
});

test('isTrustedInternalSender: undefined origin → false', () => {
  assert.equal(isTrustedInternalSender(undefined, true), false);
});

// ---------------------------------------------------------------------------
// registerInternalHandler — fake ipcMain + fake events
//
// Security-critical: these tests catch extraction bugs that the predicate matrix
// can't catch on its own — e.g. reading event.senderFrame.url instead of .origin,
// or event.sender.__goldfinchInternal instead of event.sender.session.__goldfinchInternal.
// ---------------------------------------------------------------------------

/**
 * Build a minimal fake ipcMain. The registered fn is stored so tests can call it directly.
 */
function makeFakeIpcMain() {
  return {
    _handlers: {},
    handle(channel, fn) {
      this._handlers[channel] = fn;
    },
    invoke(channel, event, ...args) {
      const fn = this._handlers[channel];
      if (!fn) throw new Error('no handler registered for ' + channel);
      return fn(event, ...args);
    }
  };
}

/**
 * Build a trusted event: origin is the exact Chromium string, session carries the marker.
 */
function trustedEvent() {
  return {
    senderFrame: { origin: 'goldfinch://settings', url: 'goldfinch://settings/' },
    sender: { session: { __goldfinchInternal: true } }
  };
}

test('registerInternalHandler: trusted event forwards to handler and returns its value', () => {
  const ipcMain = makeFakeIpcMain();
  registerInternalHandler(ipcMain, 'test-channel', (_e, x) => x * 2);

  const result = ipcMain.invoke('test-channel', trustedEvent(), 21);
  assert.equal(result, 42);
});

test('registerInternalHandler: wrong origin rejects (throws)', () => {
  const ipcMain = makeFakeIpcMain();
  registerInternalHandler(ipcMain, 'test-channel', () => 'should not reach');

  const badEvent = {
    senderFrame: { origin: 'https://evil.test', url: 'https://evil.test/page' },
    sender: { session: { __goldfinchInternal: true } }
  };
  assert.throws(
    () => ipcMain.invoke('test-channel', badEvent),
    (err) => err instanceof Error && err.message.includes('forbidden')
  );
});

test('registerInternalHandler: null senderFrame rejects (frame destroyed mid-IPC)', () => {
  const ipcMain = makeFakeIpcMain();
  registerInternalHandler(ipcMain, 'test-channel', () => 'should not reach');

  const noFrameEvent = {
    senderFrame: null,
    sender: { session: { __goldfinchInternal: true } }
  };
  assert.throws(
    () => ipcMain.invoke('test-channel', noFrameEvent),
    (err) => err instanceof Error && err.message.includes('forbidden')
  );
});

test('registerInternalHandler: missing __goldfinchInternal flag rejects', () => {
  const ipcMain = makeFakeIpcMain();
  registerInternalHandler(ipcMain, 'test-channel', () => 'should not reach');

  const noFlagEvent = {
    senderFrame: { origin: 'goldfinch://settings', url: 'goldfinch://settings/' },
    sender: { session: {} } // no __goldfinchInternal
  };
  assert.throws(
    () => ipcMain.invoke('test-channel', noFlagEvent),
    (err) => err instanceof Error && err.message.includes('forbidden')
  );
});

test('registerInternalHandler: marker on sender (not session) is insufficient — rejects', () => {
  // Catches a common extraction bug: reading event.sender.__goldfinchInternal instead
  // of event.sender.session.__goldfinchInternal.
  const ipcMain = makeFakeIpcMain();
  registerInternalHandler(ipcMain, 'test-channel', () => 'should not reach');

  const wrongPathEvent = {
    senderFrame: { origin: 'goldfinch://settings', url: 'goldfinch://settings/' },
    sender: {
      __goldfinchInternal: true,  // marker on sender, NOT on sender.session
      session: {}
    }
  };
  assert.throws(
    () => ipcMain.invoke('test-channel', wrongPathEvent),
    (err) => err instanceof Error && err.message.includes('forbidden')
  );
});

test('registerInternalHandler: truthy-but-not-true __goldfinchInternal (1) rejects — raw value flows to predicate', () => {
  // Pins that the wrapper passes the RAW session marker to isTrustedInternalSender
  // rather than pre-coercing with !!. A truthy value like 1 would survive !! coercion
  // and pass the wrapper, but the predicate's strict === true would then be unreachable
  // as a meaningful guard. With raw extraction, the predicate itself decides.
  const ipcMain = makeFakeIpcMain();
  registerInternalHandler(ipcMain, 'test-channel', () => 'should not reach');

  const truthyMarkerEvent = {
    senderFrame: { origin: 'goldfinch://settings', url: 'goldfinch://settings/' },
    sender: { session: { __goldfinchInternal: 1 } } // truthy but !== true
  };
  assert.throws(
    () => ipcMain.invoke('test-channel', truthyMarkerEvent),
    (err) => err instanceof Error && err.message.includes('forbidden')
  );
});

test('registerInternalHandler: handler receives forwarded args correctly', () => {
  const ipcMain = makeFakeIpcMain();
  registerInternalHandler(ipcMain, 'test-channel', (_e, a, b, c) => [a, b, c]);

  const result = ipcMain.invoke('test-channel', trustedEvent(), 'x', 'y', 'z');
  assert.deepEqual(result, ['x', 'y', 'z']);
});
