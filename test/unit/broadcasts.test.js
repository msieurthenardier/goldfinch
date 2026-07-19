'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createBroadcasters } = require('../../src/main/broadcasts');

function contents(name, { destroyed = false, internal = false } = {}) {
  const sends = [];
  return {
    name,
    sends,
    session: { __goldfinchInternal: internal },
    isDestroyed: () => destroyed,
    send: (channel, payload) => sends.push({ channel, payload })
  };
}

function setup() {
  const chromeA = contents('chrome-a');
  const chromeB = contents('chrome-b');
  const internal = contents('internal', { internal: true });
  const guest = contents('guest');
  const records = [
    { win: { id: 1 }, chromeView: { webContents: chromeA } },
    { win: { id: 2 }, chromeView: { webContents: chromeB } }
  ];
  const broadcasters = createBroadcasters({
    registry: { records: () => records },
    webContents: { getAllWebContents: () => [chromeA, chromeB, internal, guest] },
    isInternalContents: (wc) => wc.session.__goldfinchInternal === true,
    closedTabStack: { size: () => 3 },
    buildMoveTargets: (all, current) => all.filter((record) => record !== current).map((record) => record.win.id)
  });
  return { ...broadcasters, chromeA, chromeB, internal, guest, records };
}

test('closed-tab stack pushes are chrome-only and never leak to internal or guest contents', () => {
  const h = setup();
  h.broadcastClosedTabStackChanged();
  assert.deepEqual(h.chromeA.sends, [{ channel: 'closed-tab-stack-changed', payload: { size: 3 } }]);
  assert.deepEqual(h.chromeB.sends, h.chromeA.sends);
  assert.deepEqual(h.internal.sends, []);
  assert.deepEqual(h.guest.sends, []);
});

test('move-target pushes are computed per record and exclude the receiving window', () => {
  const h = setup();
  h.broadcastMoveTargetsChanged();
  assert.deepEqual(h.chromeA.sends[0], { channel: 'move-targets-changed', payload: { targets: [2] } });
  assert.deepEqual(h.chromeB.sends[0], { channel: 'move-targets-changed', payload: { targets: [1] } });
});

test('shared broadcasts include every chrome and internal page exactly once, never web guests', () => {
  const h = setup();
  h.broadcastToChromeAndInternal('settings-changed', { ok: true });
  assert.equal(h.chromeA.sends.length, 1);
  assert.equal(h.chromeB.sends.length, 1);
  assert.equal(h.internal.sends.length, 1);
  assert.deepEqual(h.guest.sends, []);
});

test('all broadcasters drop destroyed chrome/internal contents', () => {
  const deadChrome = contents('dead-chrome', { destroyed: true });
  const deadInternal = contents('dead-internal', { destroyed: true, internal: true });
  const h = createBroadcasters({
    registry: { records: () => [{ win: { id: 1 }, chromeView: { webContents: deadChrome } }] },
    webContents: { getAllWebContents: () => [deadInternal] },
    isInternalContents: (wc) => wc.session.__goldfinchInternal === true,
    closedTabStack: { size: () => 1 },
    buildMoveTargets: () => []
  });
  h.broadcastClosedTabStackChanged();
  h.broadcastMoveTargetsChanged();
  h.broadcastToChromeAndInternal('x', null);
  assert.deepEqual(deadChrome.sends, []);
  assert.deepEqual(deadInternal.sends, []);
});
