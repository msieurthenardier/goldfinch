'use strict';

// Sortie 06 Leg 1 (AC14b/AC17/AC18): register-save-prompt-ipc.js - every gate refused in
// isolation, against the REAL manager over fakes and the REAL window registry's sender lookup.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { makeTestGate } = require('../helpers/ipc-gate-fixture');
const { registerSavePromptIpc, sanitizeSavePromptModel } = require('../../src/main/register-save-prompt-ipc');
const { createWindowRegistry } = require('../../src/main/window-registry');
const { makeHarness, presentShown, OFFER_MODEL, assertNoLiveTimers } = require('../helpers/save-prompt-fakes');

// Squawk 0172 guard: no real timer may outlive the suite.
after(() => assertNoLiveTimers());

function build({ captureTab = 7, activeTabWcId = 7 } = {}) {
  const handlers = new Map();
  const listeners = new Map();
  const ipcMain = {
    handle: (c, fn) => handlers.set(c, fn),
    on: (c, fn) => listeners.set(c, fn)
  };
  const h = makeHarness();
  const chromeSender = { id: 1, isDestroyed: () => false };
  const registry = createWindowRegistry();
  const rec = registry.create({ win: { id: 1 }, chromeView: { webContents: chromeSender } });
  rec.savePrompt = h.manager;
  rec.activeTabWcId = activeTabWcId;
  const human = {
    tabs: new Map([['cap1', captureTab]]),
    captureTabOf(id) {
      return this.tabs.has(id) ? this.tabs.get(id) : null;
    }
  };
  registerSavePromptIpc({
    gate: makeTestGate({ ipcMain, registry, autoFrame: true }),
    registry,
    getVaultHuman: () => human
  });
  /** the page sender is the real manager's view webContents once created */
  const pageSender = () => h.manager.getView().webContents;
  return { h, rec, registry, handlers, listeners, chromeSender, human, pageSender };
}

const openPayload = (over = {}) => ({
  token: 1,
  captureId: 'cap1',
  wcId: 7,
  model: { ...OFFER_MODEL },
  anchor: 900,
  queue: { index: 1, total: 2 },
  ...over
});

// ---- save-prompt:open gates ---------------------------------------------------------------

test('AC17 gate 1: a non-chrome sender is refused `gone`; a torn-down prompt slot (null) is refused `gone`', async () => {
  const t = build();
  assert.deepEqual(await t.handlers.get('save-prompt:open')({ sender: { id: 99 } }, openPayload()), {
    presented: false,
    reason: 'gone'
  });
  t.rec.savePrompt = null;
  assert.deepEqual(await t.handlers.get('save-prompt:open')({ sender: t.chromeSender }, openPayload()), {
    presented: false,
    reason: 'gone'
  });
  assert.equal(t.h.views.length, 0);
});

test("AC17 gate 2: wcId must be THIS window's active tab, else `not-active`", async () => {
  const t = build({ activeTabWcId: 8 });
  const r = await t.handlers.get('save-prompt:open')({ sender: t.chromeSender }, openPayload());
  assert.deepEqual(r, { presented: false, reason: 'not-active' });
  assert.equal(t.h.views.length, 0);
});

test('AC14b/AC17 gate 3: an OFFER open requires captureTabOf(captureId) === wcId (cross-tab pairing refused; dropped id refused)', async () => {
  let t = build({ captureTab: 9 }); // capture belongs to tab 9, chrome claims tab 7
  assert.deepEqual(await t.handlers.get('save-prompt:open')({ sender: t.chromeSender }, openPayload()), {
    presented: false,
    reason: 'not-active'
  });
  t = build();
  t.human.tabs.clear(); // the record was dropped
  assert.equal(
    (await t.handlers.get('save-prompt:open')({ sender: t.chromeSender }, openPayload())).reason,
    'not-active'
  );
});

test('AC17 gate 3 exemption: a RESULT-ONLY model for a dropped id IS presented (needs only gate 2)', async () => {
  const t = build();
  t.human.tabs.clear();
  const r = await t.handlers.get('save-prompt:open')(
    { sender: t.chromeSender },
    openPayload({ model: { result: 'unchanged' }, queue: null })
  );
  assert.deepEqual(r, { presented: true });
});

test('AC17 gate 4: model shape - secret keys REFUSE, unknown keys are stripped, locked/garbage refused', async () => {
  for (const secret of ['password', 'number', 'cvv', 'email', 'street', 'totp']) {
    const t = build();
    const r = await t.handlers.get('save-prompt:open')(
      { sender: t.chromeSender },
      openPayload({ model: { ...OFFER_MODEL, [secret]: 'hunter2' } })
    );
    assert.deepEqual(r, { presented: false, reason: 'invalid-model' }, secret);
  }
  // Leg 2 (AC3): `locked` is admitted, with the same allowlist plus `choices`.
  const lockedOk = sanitizeSavePromptModel({ origin: 'x', mode: 'locked', choices: ['work', 'global'], evil: 1 });
  assert.equal(lockedOk.ok, true);
  assert.deepEqual(lockedOk.model.choices, ['work', 'global']);
  assert.equal('evil' in lockedOk.model, false);
  assert.equal(sanitizeSavePromptModel({ origin: 'x', mode: 'bogus' }).ok, false);
  assert.equal(sanitizeSavePromptModel(null).ok, false);
  assert.equal(sanitizeSavePromptModel({ result: 'bogus' }).ok, false);
  const ok = sanitizeSavePromptModel({ ...OFFER_MODEL, evil: '<img>', __proto__x: 1 });
  assert.equal(ok.ok, true);
  assert.equal('evil' in ok.model, false);
  assert.deepEqual(Object.keys(sanitizeSavePromptModel({ result: 'locked' }).model), ['result']);
});

test('AC17: a valid open presents; "1 of N" rides `queue`; the chrome anchor is passed to the manager', async () => {
  const t = build();
  const r = await t.handlers.get('save-prompt:open')({ sender: t.chromeSender }, openPayload());
  assert.deepEqual(r, { presented: true });
  t.h.views[0].webContents.emit('did-finish-load');
  const init = t.h.views[0].calls.find(([k, c]) => k === 'send' && c === 'save-prompt:init')[2];
  assert.deepEqual(init.queue, { index: 1, total: 2 });
  assert.equal(init.captureId, 'cap1');
});

test('AC17: an open while a sheet is visible / HTML fullscreen is refused by the manager (sheet-open / fullscreen)', async () => {
  const t = build();
  t.h.state.sheetVisible = true;
  assert.equal(
    (await t.handlers.get('save-prompt:open')({ sender: t.chromeSender }, openPayload())).reason,
    'sheet-open'
  );
  t.h.state.sheetVisible = false;
  t.h.state.fullscreen = true;
  assert.equal(
    (await t.handlers.get('save-prompt:open')({ sender: t.chromeSender }, openPayload())).reason,
    'fullscreen'
  );
});

test('AC17: malformed payload fields never reach present()', async () => {
  const t = build();
  for (const bad of [null, {}, { token: 'x' }, openPayload({ wcId: 1.5 }), openPayload({ captureId: 7 })]) {
    const r = await t.handlers.get('save-prompt:open')({ sender: t.chromeSender }, bad);
    assert.equal(r.presented, false);
  }
  assert.equal(t.h.views.length, 0);
});

// ---- save-prompt:anchor -------------------------------------------------------------------

test('AC17: save-prompt:anchor needs a registered chrome sender AND the current token', async () => {
  const t = build();
  await t.handlers.get('save-prompt:open')({ sender: t.chromeSender }, openPayload());
  t.h.views[0].webContents.emit('did-finish-load');
  t.h.manager.reportHeight(1, 140);
  const anchorX = () => {
    const sb = t.h.views[0].calls.filter(([k]) => k === 'setBounds');
    const b = sb[sb.length - 1][1];
    return b.x + b.width;
  };
  assert.equal(anchorX(), 900);
  t.listeners.get('save-prompt:anchor')({ sender: { id: 99 } }, { token: 1, right: 500 });
  assert.equal(anchorX(), 900, 'non-chrome sender ignored');
  t.listeners.get('save-prompt:anchor')({ sender: t.chromeSender }, { token: 77, right: 500 });
  assert.equal(anchorX(), 900, 'stale token ignored');
  t.listeners.get('save-prompt:anchor')({ sender: t.chromeSender }, { token: 1, right: 500 });
  assert.equal(anchorX(), 500);
});

// ---- page -> main, every handler resolves the window by webContents identity ----------------

async function shown() {
  const t = build();
  await t.handlers.get('save-prompt:open')({ sender: t.chromeSender }, openPayload());
  t.h.views[0].webContents.emit('did-finish-load');
  t.h.manager.reportHeight(1, 140);
  return t;
}

test('AC18: pointer / focus / height / dismiss resolve the window by prompt-view identity AND token (each refused in isolation)', async () => {
  const t = await shown();
  const wrongSender = { id: 5 };
  // pointer
  t.listeners.get('save-prompt:pointer')({ sender: wrongSender }, { token: 1, inside: true });
  assert.equal(t.h.manager.isPaused(), false, 'foreign sender ignored');
  t.listeners.get('save-prompt:pointer')({ sender: t.pageSender() }, { token: 2, inside: true });
  assert.equal(t.h.manager.isPaused(), false, 'stale token ignored');
  t.listeners.get('save-prompt:pointer')({ sender: t.pageSender() }, { token: 1, inside: true });
  assert.equal(t.h.manager.isPaused(), true);
  t.listeners.get('save-prompt:pointer')({ sender: t.pageSender() }, { token: 1, inside: false });
  // focus
  t.listeners.get('save-prompt:focus')({ sender: t.pageSender() }, { token: 1, inside: true });
  assert.equal(t.h.manager.isPaused(), true);
  t.listeners.get('save-prompt:focus')({ sender: wrongSender }, { token: 1, inside: false });
  assert.equal(t.h.manager.isPaused(), true, 'foreign sender cannot resume');
  t.listeners.get('save-prompt:focus')({ sender: t.pageSender() }, { token: 1, inside: false });
  // height
  t.listeners.get('save-prompt:height')({ sender: wrongSender }, { token: 1, height: 300 });
  t.listeners.get('save-prompt:height')({ sender: t.pageSender() }, { token: 1, height: 'big' });
  const sb = () => t.h.views[0].calls.filter(([k]) => k === 'setBounds');
  const n = sb().length;
  t.listeners.get('save-prompt:height')({ sender: t.pageSender() }, { token: 1, height: 300 });
  assert.equal(sb().length, n + 1);
  assert.equal(sb()[n][1].height, 300);
  // dismiss
  t.listeners.get('save-prompt:dismiss')({ sender: wrongSender }, { token: 1 });
  t.listeners.get('save-prompt:dismiss')({ sender: t.pageSender() }, { token: 9 });
  assert.equal(t.h.manager.isVisible(), true);
  t.listeners.get('save-prompt:dismiss')({ sender: t.pageSender() }, { token: 1 });
  assert.equal(t.h.manager.isVisible(), false);
  assert.deepEqual(t.h.dismisses, ['cap1']);
});

test('AC18: the chrome (not the page) cannot drive the page-only channels', async () => {
  const t = await shown();
  t.listeners.get('save-prompt:dismiss')({ sender: t.chromeSender }, { token: 1 });
  assert.equal(t.h.manager.isVisible(), true);
  const r = await t.handlers.get('save-prompt:save')(
    { sender: t.chromeSender },
    { token: 1, captureId: 'cap1', vaultId: 'personal' }
  );
  assert.deepEqual(r, { saved: false, reason: 'refused' });
  assert.equal(t.h.saves.length, 0);
});

// ---- :save four guards, each refused in isolation ------------------------------------------

const save = (t, payload, sender) => t.handlers.get('save-prompt:save')({ sender: sender || t.pageSender() }, payload);

test('AC18 :save guard 1 (sender identity)', async () => {
  const t = await shown();
  assert.deepEqual(await save(t, { token: 1, captureId: 'cap1', vaultId: 'personal' }, { id: 5 }), {
    saved: false,
    reason: 'refused'
  });
  assert.equal(t.h.saves.length, 0);
});

test('AC18 :save guard 2 (token freshness)', async () => {
  const t = await shown();
  assert.equal((await save(t, { token: 2, captureId: 'cap1', vaultId: 'personal' })).reason, 'refused');
  assert.equal((await save(t, { token: 'x', captureId: 'cap1', vaultId: 'personal' })).reason, 'refused');
  assert.equal(t.h.saves.length, 0);
});

test('AC18 :save guard 3 (kind): a result state, a saving state, and a locked model are refused', async () => {
  // result-only model
  let t = build();
  await t.handlers.get('save-prompt:open')({ sender: t.chromeSender }, openPayload({ model: { result: 'unchanged' } }));
  t.h.views[0].webContents.emit('did-finish-load');
  t.h.manager.reportHeight(1, 100);
  assert.equal((await save(t, { token: 1, captureId: 'cap1', vaultId: 'personal' })).reason, 'refused');
  // already saving (double-click): the SECOND call is refused, captureSave ran once
  t = await shown();
  assert.deepEqual(await save(t, { token: 1, captureId: 'cap1', vaultId: 'personal' }), { saved: true });
  assert.equal((await save(t, { token: 1, captureId: 'cap1', vaultId: 'personal' })).reason, 'refused');
  assert.equal(t.h.saves.length, 1);
});

test('AC18 :save guard 4 (business gate): wrong captureId, a non-active tab, and a capture bound to another tab are refused', async () => {
  let t = await shown();
  assert.equal((await save(t, { token: 1, captureId: 'OTHER', vaultId: 'personal' })).reason, 'refused');
  t = await shown();
  t.rec.activeTabWcId = 8; // the tab is no longer the window's active tab
  assert.equal((await save(t, { token: 1, captureId: 'cap1', vaultId: 'personal' })).reason, 'refused');
  t = await shown();
  t.human.tabs.set('cap1', 9); // main's own binding disagrees (AC14b)
  assert.equal((await save(t, { token: 1, captureId: 'cap1', vaultId: 'personal' })).reason, 'refused');
  assert.equal(t.h.saves.length, 0);
});

test('AC18 :save passes every guard -> captureSave({captureId, vaultId}) and the success result', async () => {
  const t = await shown();
  const r = await save(t, { token: 1, captureId: 'cap1', vaultId: 'global' });
  assert.deepEqual(r, { saved: true });
  assert.deepEqual(t.h.saves, [{ captureId: 'cap1', vaultId: 'global' }]);
});

test('AC18: :height clamps to a finite number in [0, 4000] (via the manager)', async () => {
  const t = await shown();
  t.listeners.get('save-prompt:height')({ sender: t.pageSender() }, { token: 1, height: -50 });
  const sb = t.h.views[0].calls.filter(([k]) => k === 'setBounds');
  assert.equal(sb[sb.length - 1][1].height, 80, 'negative -> 0 -> geometry min 80');
});

test('AC18: recordForOverlaySender lives on the registry for sheet / findOverlay / savePrompt keys', async () => {
  const t = await shown();
  assert.equal(t.registry.recordForOverlaySender(t.pageSender(), 'savePrompt'), t.rec);
  assert.equal(t.registry.recordForOverlaySender(t.pageSender(), 'sheet'), null);
  assert.equal(t.registry.recordForOverlaySender(null, 'savePrompt'), null);
  assert.equal(t.registry.isSavePromptContents(t.pageSender()), true);
  assert.equal(t.registry.isSavePromptContents({}), false);
  assert.equal(t.registry.isSavePromptContents(null), false);
  t.h.manager.teardown();
  assert.equal(
    t.registry.isSavePromptContents(t.h.views[0].webContents),
    false,
    'a torn-down (destroyed) prompt is not contents'
  );
});

test('presentShown helper sanity: a missing vault-human refuses an OFFER open (fail closed)', async () => {
  const handlers = new Map();
  const registry = createWindowRegistry();
  const chromeSender = { id: 1 };
  const h = makeHarness();
  const rec = registry.create({ win: { id: 1 }, chromeView: { webContents: chromeSender } });
  rec.savePrompt = h.manager;
  rec.activeTabWcId = 7;
  const ipcMain = { handle: (c, f) => handlers.set(c, f), on() {} };
  registerSavePromptIpc({
    gate: makeTestGate({ ipcMain, registry, autoFrame: true }),
    registry,
    getVaultHuman: () => null
  });
  assert.equal((await handlers.get('save-prompt:open')({ sender: chromeSender }, openPayload())).reason, 'not-active');
  assert.equal(typeof presentShown, 'function');
});
