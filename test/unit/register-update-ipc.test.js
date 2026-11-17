'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registerUpdateIpc } = require('../../src/main/register-update-ipc');
const { eventFrom, guestEvent, makeTestGate } = require('../helpers/ipc-gate-fixture');
const { registerInternalHandler } = require('../../src/main/internal-ipc');

const RELEASE = 'https://github.com/msieurthenardier/goldfinch/releases/tag/v0.19.16';

function setup({ releaseUrl = RELEASE, pausedSecond = false } = {}) {
  const handlers = new Map();
  const ipcMain = { handle: (c, fn) => handlers.set(c, fn), on() {} };
  const chromeA = { id: 'chrome-a' };
  const chromeB = { id: 'chrome-b' };
  const recordA = { id: 1, name: 'A' };
  const recordB = { id: 2, name: 'B', chromeRecoveryPaused: pausedSecond };
  const guests = new Map([
    [101, recordA],
    [102, recordB]
  ]);
  const registry = {
    getWindowForChrome: (s) => (s === chromeA ? recordA : s === chromeB ? recordB : null),
    getWindowForGuest: (id) => guests.get(id) || null,
    // A last-focused accessor that must never be consulted:
    getLastFocused: () => {
      throw new Error('last-focused accessor used');
    }
  };
  const sends = [];
  const state = { current: '0.19.15', available: '0.19.16', releaseUrl, checkEnabled: true };
  const gate = makeTestGate({ ipcMain, registry });
  registerUpdateIpc({
    ipcMain,
    gate,
    registerInternalHandler,
    registry,
    getState: () => state,
    queueChromeSend: (record, build) => sends.push([record.id, ...build()])
  });
  const internalEvent = (id) => ({
    sender: { id, session: { __goldfinchInternal: true } },
    senderFrame: { origin: 'goldfinch://settings' }
  });
  return { handlers, chromeA, chromeB, sends, state, internalEvent };
}

test('registers exactly the three channels', () => {
  const h = setup();
  assert.deepEqual([...h.handlers.keys()].sort(), [
    'internal-update-open-release-page',
    'update:get-state',
    'update:open-release-page'
  ]);
});

test('update:get-state answers the chrome and an internal page with a COPY, takes no arguments', async () => {
  const h = setup();
  const fromChrome = await h.handlers.get('update:get-state')(eventFrom(h.chromeA), { evil: true });
  assert.deepEqual(fromChrome, h.state);
  fromChrome.available = 'tampered';
  assert.equal(h.state.available, '0.19.16');
  const fromInternal = await h.handlers.get('update:get-state')(h.internalEvent(101));
  assert.deepEqual(fromInternal, h.state);
});

test('a web tab guest is refused on all three channels', async () => {
  const h = setup();
  const web = guestEvent(101);
  await assert.rejects(async () => h.handlers.get('update:get-state')(web));
  assert.equal(await h.handlers.get('update:open-release-page')(web), false);
  await assert.rejects(async () => h.handlers.get('internal-update-open-release-page')(web));
  assert.deepEqual(h.sends, []);
});

test('the chrome open sends exactly the app-built address to the sender window and returns true', async () => {
  const h = setup();
  assert.equal(await h.handlers.get('update:open-release-page')(eventFrom(h.chromeA)), true);
  assert.deepEqual(h.sends, [[1, 'open-external-urls', { urls: [RELEASE] }]]);
});

test('page-supplied arguments change nothing about what is opened', async () => {
  const h = setup();
  for (const arg of [
    'https://evil.example/',
    { url: 'https://evil.example/', urls: ['x'] },
    42,
    null,
    ['https://evil.example/']
  ]) {
    h.sends.length = 0;
    assert.equal(await h.handlers.get('update:open-release-page')(eventFrom(h.chromeA), arg, arg), true);
    assert.deepEqual(h.sends, [[1, 'open-external-urls', { urls: [RELEASE] }]]);
    h.sends.length = 0;
    assert.equal(await h.handlers.get('internal-update-open-release-page')(h.internalEvent(101), arg, arg), true);
    assert.deepEqual(h.sends, [[1, 'open-external-urls', { urls: [RELEASE] }]]);
  }
});

test('no release available: false and nothing sent, on both', async () => {
  const h = setup({ releaseUrl: null });
  assert.equal(await h.handlers.get('update:open-release-page')(eventFrom(h.chromeA)), false);
  assert.equal(await h.handlers.get('internal-update-open-release-page')(h.internalEvent(101)), false);
  assert.deepEqual(h.sends, []);
});

test('the internal variant routes to the SENDER window with two windows open', async () => {
  const h = setup();
  assert.equal(await h.handlers.get('internal-update-open-release-page')(h.internalEvent(102)), true);
  assert.equal(await h.handlers.get('internal-update-open-release-page')(h.internalEvent(101)), true);
  assert.deepEqual(h.sends, [
    [2, 'open-external-urls', { urls: [RELEASE] }],
    [1, 'open-external-urls', { urls: [RELEASE] }]
  ]);
  h.sends.length = 0;
  assert.equal(await h.handlers.get('update:open-release-page')(eventFrom(h.chromeB)), true);
  assert.deepEqual(h.sends, [[2, 'open-external-urls', { urls: [RELEASE] }]]);
});

test('an unresolvable window or a recovery-paused chrome answers false and sends nothing', async () => {
  const h = setup({ pausedSecond: true });
  assert.equal(await h.handlers.get('internal-update-open-release-page')(h.internalEvent(999)), false);
  assert.equal(await h.handlers.get('internal-update-open-release-page')(h.internalEvent(102)), false);
  assert.equal(await h.handlers.get('update:open-release-page')(eventFrom(h.chromeB)), false);
  // a sender that is not a window chrome is refused by the gate (refusal value false)
  assert.equal(await h.handlers.get('update:open-release-page')(eventFrom({ id: 'stranger' })), false);
  assert.deepEqual(h.sends, []);
});

test('the internal handler refuses a non-internal sender', async () => {
  const h = setup();
  await assert.rejects(async () =>
    h.handlers.get('internal-update-open-release-page')({
      sender: { id: 101, session: {} },
      senderFrame: { origin: 'https://x.test' }
    })
  );
});

test('source: neither open channel calls the reveal gate or a last-focused accessor, and the registrar names the reason', () => {
  const src = require('node:fs').readFileSync(require.resolve('../../src/main/register-update-ipc'), 'utf8');
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, ''), /revealGate|getLastFocused|getChromeContents/);
  assert.match(src, /Neither open channel calls the reveal gate/);
});
