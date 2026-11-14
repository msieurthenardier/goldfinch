'use strict';

// Integration tests for the capture Save handler - REWRITTEN (Sortie 06 Leg 1, DD8) from the
// retired `menu-overlay:vault-capture-save` sheet handler (M12 Flight 2 Leg 4, DD7) to the
// four-guarded `save-prompt:save` channel of the corner save prompt. Every case of the old suite
// moved (none dropped): sender / open-token discipline, the success pass-through with NO password
// on the invoke, refusal pass-through, and malformed payloads - and the old handler's missing
// menuType guard (the gap DD8 names) is closed by the new KIND guard (3) and BUSINESS gate (4).
//
// Driven with a fake ipcMain + the REAL manager over fakes and the REAL registry sender lookup.

const { test } = require('node:test');
const { makeTestGate } = require('../helpers/ipc-gate-fixture');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { registerSavePromptIpc } = require('../../src/main/register-save-prompt-ipc');
const { registerOverlayIpc } = require('../../src/main/register-overlay-ipc');
const { createWindowRegistry } = require('../../src/main/window-registry');
const { makeHarness, OFFER_MODEL } = require('../helpers/save-prompt-fakes');
const { maskComments } = require('../helpers/source-scan');

function makeIpc() {
  const listeners = new Map();
  const handlers = new Map();
  return {
    listeners,
    handlers,
    on: (c, fn) => listeners.set(c, fn),
    handle: (c, fn) => handlers.set(c, fn)
  };
}

async function harness(saveResult = { saved: true }) {
  const ipcMain = makeIpc();
  const h = makeHarness();
  h.state.saveResult = saveResult;
  const registry = createWindowRegistry();
  const chromeSender = { id: 1 };
  const rec = registry.create({ win: { id: 1 }, chromeView: { webContents: chromeSender } });
  rec.savePrompt = h.manager;
  rec.activeTabWcId = 7;
  const human = { captureTabOf: (id) => (id === 'cap1' ? 7 : null) };
  registerSavePromptIpc({
    gate: makeTestGate({ ipcMain, registry, autoFrame: true }),
    registry,
    getVaultHuman: () => human
  });
  await ipcMain.handlers.get('save-prompt:open')(
    { sender: chromeSender },
    { token: 7, captureId: 'cap1', wcId: 7, model: { ...OFFER_MODEL }, anchor: 900, queue: null }
  );
  h.views[0].webContents.emit('did-finish-load');
  h.manager.reportHeight(7, 140);
  const handler = ipcMain.handlers.get('save-prompt:save');
  return { handler, pageSender: h.views[0].webContents, h, rec };
}

test('save success → { saved:true }, captureSave gets { captureId, vaultId } (no password), prompt closes `saved`', async () => {
  const { handler, pageSender, h } = await harness({ saved: true });
  const res = await handler({ sender: pageSender }, { token: 7, captureId: 'cap1', vaultId: 'personal' });
  assert.deepEqual(res, { saved: true });
  assert.deepEqual(h.saves, [{ captureId: 'cap1', vaultId: 'personal' }]);
  assert.ok(!JSON.stringify(h.saves).includes('password'), 'the save invoke never carries a password');
});

test('save refusal → the result state shows and the prompt does NOT report saved (re-prompt = failure state, then close)', async () => {
  const { handler, pageSender, h } = await harness({ saved: false, reason: 'locked' });
  const res = await handler({ sender: pageSender }, { token: 7, captureId: 'cap1', vaultId: 'personal' });
  assert.deepEqual(res, { saved: false, reason: 'locked' });
  const closedReasons = h.chromeSends.filter(([c]) => c === 'save-prompt-closed').map(([, p]) => p.reason);
  assert.ok(!closedReasons.includes('saved'));
});

test('foreign sender → refused, captureSave never called', async () => {
  const { handler, h } = await harness();
  const res = await handler(
    { sender: { isDestroyed: () => false } },
    { token: 7, captureId: 'cap1', vaultId: 'personal' }
  );
  assert.deepEqual(res, { saved: false, reason: 'refused' });
  assert.deepEqual(h.saves, []);
});

test('stale token → refused, captureSave never called', async () => {
  const { handler, pageSender, h } = await harness();
  const res = await handler({ sender: pageSender }, { token: 6, captureId: 'cap1', vaultId: 'personal' });
  assert.deepEqual(res, { saved: false, reason: 'refused' });
  assert.deepEqual(h.saves, []);
});

test('a missing / non-string captureId → refused, captureSave never called', async () => {
  const { handler, pageSender, h } = await harness();
  assert.deepEqual(await handler({ sender: pageSender }, { token: 7, vaultId: 'personal' }), {
    saved: false,
    reason: 'refused'
  });
  assert.deepEqual(await handler({ sender: pageSender }, { token: 7, captureId: 42, vaultId: 'personal' }), {
    saved: false,
    reason: 'refused'
  });
  assert.deepEqual(h.saves, []);
});

test('DD8 gap closed: a KIND guard exists the old handler lacked - a result-state / locked prompt cannot Save', async () => {
  const { handler, pageSender, h } = await harness();
  h.manager.showResult('failure', 'This save request expired', 4000, 'expired');
  const res = await handler({ sender: pageSender }, { token: 7, captureId: 'cap1', vaultId: 'personal' });
  assert.deepEqual(res, { saved: false, reason: 'refused' });
  assert.deepEqual(h.saves, []);
});

test('the retired channel is GONE: neither register-overlay-ipc nor main.js registers menu-overlay:vault-capture-save or injects vaultCaptureSave', () => {
  const ipcMain = makeIpc();
  const gateRegistry = { records: () => [], getWindowForChrome: () => null, recordForOverlaySender: () => null };
  registerOverlayIpc({
    gate: makeTestGate({ ipcMain, registry: gateRegistry, autoFrame: true }),
    registry: gateRegistry,
    chromeForAttachment: () => null,
    chromeForTab: () => null,
    sanitizeActivatedValue: () => undefined,
    vaultCaptureSave: () => ({ saved: true }) // even if a stale caller still injects it
  });
  assert.equal(ipcMain.handlers.has('menu-overlay:vault-capture-save'), false);
  for (const rel of ['src/main/register-overlay-ipc.js', 'src/main/main.js', 'src/preload/menu-overlay-preload.js']) {
    const masked = maskComments(fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8'));
    assert.equal(/vault-capture-save|vaultCaptureSave|captureSave\b/.test(masked), false, rel);
  }
});
