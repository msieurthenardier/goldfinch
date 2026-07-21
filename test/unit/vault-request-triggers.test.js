'use strict';

// Integration tests for the cross-renderer setup/unlock request triggers (M12 Flight 3
// Leg 4 first-run-setup, DD5): internal-vault-request-setup / internal-vault-request-unlock
// in register-browser-ipc.js. Wired with the REAL registerInternalHandler so the origin
// gate is exercised end-to-end: a non-internal sender is REJECTED before the body runs; an
// internal sender forwards a BARE trigger (no secret) to the owning window's chrome via
// chromeForTab(event.sender.id). The two DISTINCT channels drive the two distinct chrome
// sheets (vault-set vs. vault-unlock).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { registerBrowserIpc } = require('../../src/main/register-browser-ipc');
const { registerInternalHandler } = require('../../src/main/internal-ipc');

// registerInternalHandler(ipcMain, channel, fn) calls ipcMain.handle(channel, wrapped).
// We drive the WRAPPED handler directly, so build the harness with an ipcMain.handle that
// records the wrapped fns.
function makeCapturingHarness() {
  const wrapped = new Map();
  const sends = [];
  const chrome = { send: (channel, payload) => sends.push([channel, payload]) };
  registerBrowserIpc({
    ipcMain: { handle: (channel, fn) => wrapped.set(channel, fn), on: () => {} },
    webContents: { fromId: () => null },
    chromeForTab: (id) => (id === 5 ? chrome : null),
    getTabContents: () => null,
    applyZoom: () => {},
    isInternalContents: () => false,
    toggleDevTools: () => false,
    registerInternalHandler,
    jars: { list: () => [], add: () => ({}) },
    registry: { getWindowForChrome: () => null },
    createWindow: () => ({ win: { id: 1 } }),
    broadcastJarsChanged: () => {},
    isSafeTabUrl: () => false,
    getChromeContents: () => chrome,
    session: { fromPartition: () => ({}) },
    registrableDomain: (h) => h,
    hostnameOf: (u) => new URL(u).hostname,
    shields: { active: () => false },
    getVaultHuman: () => ({}),
  });
  return { wrapped, sends, chrome };
}

const internalEvent = (id) => ({
  senderFrame: { origin: 'goldfinch://vault' },
  sender: { id, session: { __goldfinchInternal: true } },
});
const webEvent = (id) => ({
  senderFrame: { origin: 'https://evil.example' },
  sender: { id, session: {} },
});

test('all three request channels are registered through the internal origin gate', () => {
  const { wrapped } = makeCapturingHarness();
  assert.equal(wrapped.has('internal-vault-request-setup'), true);
  assert.equal(wrapped.has('internal-vault-request-unlock'), true);
  assert.equal(wrapped.has('internal-vault-request-mint'), true);
});

test('internal sender: request-setup forwards a bare vault-request-setup trigger to the owning chrome', () => {
  const { wrapped, sends } = makeCapturingHarness();
  const res = wrapped.get('internal-vault-request-setup')(internalEvent(5));
  assert.deepEqual(res, { ok: true });
  assert.deepEqual(sends, [['vault-request-setup', undefined]]);
});

test('internal sender: request-unlock forwards a DISTINCT vault-request-unlock trigger', () => {
  const { wrapped, sends } = makeCapturingHarness();
  wrapped.get('internal-vault-request-unlock')(internalEvent(5));
  assert.deepEqual(sends, [['vault-request-unlock', undefined]]);
});

test('internal sender: request-mint forwards vault-request-mint carrying the NON-SECRET target', () => {
  const { wrapped, sends } = makeCapturingHarness();
  const res = wrapped.get('internal-vault-request-mint')(internalEvent(5), 'work');
  assert.deepEqual(res, { ok: true });
  assert.deepEqual(sends, [['vault-request-mint', { target: 'work' }]]);
});

test('non-internal sender is REJECTED before the body runs (no forward)', () => {
  const { wrapped, sends } = makeCapturingHarness();
  assert.throws(
    () => wrapped.get('internal-vault-request-setup')(webEvent(9)),
    /forbidden: non-internal sender for internal-vault-request-setup/,
  );
  assert.throws(
    () => wrapped.get('internal-vault-request-unlock')(webEvent(9)),
    /forbidden: non-internal sender for internal-vault-request-unlock/,
  );
  assert.throws(
    () => wrapped.get('internal-vault-request-mint')(webEvent(9), 'work'),
    /forbidden: non-internal sender for internal-vault-request-mint/,
  );
  assert.deepEqual(sends, [], 'a rejected request forwards nothing to chrome');
});

test('an unresolvable owning chrome no-ops gracefully (still returns ok)', () => {
  const { wrapped, sends } = makeCapturingHarness();
  // sender id 6 does not resolve a chrome (chromeForTab returns null) — the optional chain
  // no-ops; the handler still returns { ok: true }.
  const res = wrapped.get('internal-vault-request-setup')(internalEvent(6));
  assert.deepEqual(res, { ok: true });
  assert.deepEqual(sends, []);
});
