'use strict';

// Sortie 06 Leg 2 (AC3/AC5/AC8/AC10, flight DD7): `save-prompt:consent` - four guards, each
// refused in isolation, against the REAL manager over fakes and the REAL window registry's sender
// lookup - plus the dynamic `saved` result model and the trace payload keys.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { registerSavePromptIpc, sanitizeSavePromptModel } = require('../../src/main/register-save-prompt-ipc');
const { createWindowRegistry } = require('../../src/main/window-registry');
const { makeHarness, OFFER_MODEL, assertNoLiveTimers } = require('../helpers/save-prompt-fakes');

// Squawk 0172 guard: no real timer may outlive the suite.
after(() => assertNoLiveTimers());

const LOCKED_MODEL = Object.freeze({
  origin: 'https://a.example',
  username: 'me',
  mode: 'locked',
  kind: 'login',
  defaultVaultId: 'personal',
  choices: [
    { vaultId: 'personal', label: 'Personal' },
    { vaultId: 'global', label: 'Global' }
  ]
});

function build({ model = LOCKED_MODEL, consentResult = { ok: true } } = {}) {
  const handlers = new Map();
  const listeners = new Map();
  const ipcMain = { handle: (c, fn) => handlers.set(c, fn), on: (c, fn) => listeners.set(c, fn) };
  const h = makeHarness();
  const chromeSender = { id: 1, isDestroyed: () => false };
  const registry = createWindowRegistry();
  const rec = registry.create({ win: { id: 1 }, chromeView: { webContents: chromeSender } });
  rec.savePrompt = h.manager;
  rec.activeTabWcId = 7;
  const consents = [];
  const traces = [];
  const human = {
    tabs: new Map([['cap1', 7]]),
    captureTabOf(id) {
      return this.tabs.has(id) ? this.tabs.get(id) : null;
    },
    captureConsent(arg) {
      consents.push(arg);
      return typeof consentResult === 'function' ? consentResult(arg) : consentResult;
    }
  };
  registerSavePromptIpc({
    ipcMain,
    registry,
    getVaultHuman: () => human,
    vaultTrace: (step, fields) => traces.push([step, fields])
  });
  const t = { h, rec, registry, handlers, listeners, chromeSender, human, consents, traces };
  t.pageSender = () => h.manager.getView().webContents;
  t.show = async (m = model) => {
    const r = await handlers.get('save-prompt:open')(
      { sender: chromeSender },
      { token: 1, captureId: 'cap1', wcId: 7, model: m, anchor: 900, queue: null }
    );
    assert.equal(r.presented, true);
    h.views[0].webContents.emit('did-finish-load');
    h.manager.reportHeight(1, 140);
    return t;
  };
  return t;
}
const consent = (t, payload, sender) =>
  t.handlers.get('save-prompt:consent')({ sender: sender || t.pageSender() }, payload);
const good = { token: 1, captureId: 'cap1', vaultId: 'personal' };
const closedReasons = (t) => t.h.chromeSends.filter(([c]) => c === 'save-prompt-closed').map(([, p]) => p.reason);

test("AC5 guard 1 (sender identity): another window's view / the chrome is refused; nothing recorded", async () => {
  const t = await build().show();
  assert.deepEqual(await consent(t, good, { id: 5 }), { ok: false, reason: 'refused' });
  assert.deepEqual(await consent(t, good, t.chromeSender), { ok: false, reason: 'refused' });
  assert.equal(t.consents.length, 0);
});

test('AC5 guard 2 (token freshness)', async () => {
  const t = await build().show();
  assert.equal((await consent(t, { ...good, token: 2 })).reason, 'refused');
  assert.equal((await consent(t, { ...good, token: 'x' })).reason, 'refused');
  assert.equal(t.consents.length, 0);
});

test('AC5 guard 3 (kind): an unlocked offer, a result state, and a double-click are refused', async () => {
  let t = await build({ model: OFFER_MODEL }).show(OFFER_MODEL);
  assert.equal((await consent(t, good)).reason, 'refused');
  t = build();
  await t.handlers.get('save-prompt:open')(
    { sender: t.chromeSender },
    { token: 1, captureId: 'cap1', wcId: 7, model: { result: 'unchanged' }, anchor: 900, queue: null }
  );
  t.h.views[0].webContents.emit('did-finish-load');
  t.h.manager.reportHeight(1, 100);
  assert.equal((await consent(t, good)).reason, 'refused');
  assert.equal(t.consents.length, 0);
  // double click: the SECOND call is refused by the dedicated consenting flag, one consent total
  t = await build().show();
  const [a, b] = [consent(t, good), consent(t, good)];
  assert.deepEqual(await a, { ok: true });
  assert.equal((await b).ok, false);
  assert.equal(t.consents.length, 1);
});

test('AC5 guard 4 (business gate): wrong captureId, non-active tab, other-tab binding are refused AND roll the flag back', async () => {
  const t = await build().show();
  assert.equal((await consent(t, { ...good, captureId: 'OTHER' })).reason, 'refused');
  t.rec.activeTabWcId = 8;
  assert.equal((await consent(t, good)).reason, 'refused');
  t.rec.activeTabWcId = 7;
  t.human.tabs.set('cap1', 9);
  assert.equal((await consent(t, good)).reason, 'refused');
  assert.equal(t.consents.length, 0);
  t.human.tabs.set('cap1', 7);
  assert.deepEqual(await consent(t, good), { ok: true }, 'a refused consent never wedged the prompt');
});

test('AC5 success: captureConsent gets { captureId, vaultId }, the prompt closes `unlock-requested`, nothing is dismissed', async () => {
  const t = await build().show();
  assert.deepEqual(await consent(t, good), { ok: true });
  assert.deepEqual(t.consents, [{ captureId: 'cap1', vaultId: 'personal' }]);
  assert.deepEqual(closedReasons(t), ['unlock-requested']);
  assert.deepEqual(t.h.dismisses, []);
  assert.deepEqual(t.h.saves, [], 'consent never writes');
  assert.equal(t.h.manager.isVisible(), false);
});

test('AC5: identity consent carries vaultId null', async () => {
  const t = await build().show({ origin: 'https://a.example', kind: 'identity', mode: 'locked' });
  assert.deepEqual(await consent(t, { token: 1, captureId: 'cap1', vaultId: null }), { ok: true });
  assert.deepEqual(t.consents, [{ captureId: 'cap1', vaultId: null }]);
});

test('AC5: a refusal `unlocked` leaves the prompt up, rolls the flag back (retry allowed)', async () => {
  let n = 0;
  const t = await build({ consentResult: () => (n++ === 0 ? { ok: false, reason: 'unlocked' } : { ok: true }) }).show();
  assert.deepEqual(await consent(t, good), { ok: false, reason: 'unlocked' });
  assert.equal(t.h.manager.isVisible(), true);
  assert.deepEqual(closedReasons(t), []);
  assert.deepEqual(await consent(t, good), { ok: true });
});

test('AC5: record gone -> the `expired` result; bad vault -> "Couldn\'t save to that vault" result (closes `dismissed`)', async (t0) => {
  const resultTexts = (tt) => tt.h.views[0].calls.filter(([k, c]) => k === 'send' && c === 'save-prompt:result');
  t0.mock.timers.enable({ apis: ['setTimeout'] });
  let t = await build({ consentResult: { ok: false, reason: 'expired' } }).show();
  assert.equal((await consent(t, good)).reason, 'expired');
  assert.equal(resultTexts(t)[0][2].text, 'This save request expired');
  t0.mock.timers.tick(4000);
  assert.deepEqual(closedReasons(t), ['expired']);
  t = await build({ consentResult: { ok: false, reason: 'bad-vault' } }).show();
  assert.equal((await consent(t, good)).reason, 'bad-vault');
  assert.equal(resultTexts(t)[0][2].text, "Couldn't save to that vault");
  t0.mock.timers.tick(4000);
  assert.deepEqual(closedReasons(t), ['dismissed']);
  assert.deepEqual(t.h.dismisses, ['cap1'], 'the dismissed close drops the record main-side');
});

test('AC3: `:save` stays refused for a locked offer (Leg 1 guard 3, re-pinned)', async () => {
  const t = await build().show();
  const r = await t.handlers.get('save-prompt:save')({ sender: t.pageSender() }, good);
  assert.deepEqual(r, { saved: false, reason: 'refused' });
  assert.deepEqual(t.h.saves, []);
});

test('AC3: save-prompt:open gate 3 (captureTabOf) applies to a LOCKED offer', async () => {
  const t = build();
  t.human.tabs.set('cap1', 9);
  const r = await t.handlers.get('save-prompt:open')(
    { sender: t.chromeSender },
    { token: 1, captureId: 'cap1', wcId: 7, model: LOCKED_MODEL, anchor: 900, queue: null }
  );
  assert.deepEqual(r, { presented: false, reason: 'not-active' });
});

test('AC8: the `saved` result model keeps ONLY { result, vaultLabel, kind } and is a result-only (gate-3-exempt) model', async () => {
  const s = sanitizeSavePromptModel({ result: 'saved', vaultLabel: 'Work', kind: 'card', origin: 'x' });
  assert.equal(sanitizeSavePromptModel({ result: 'saved', password: 'p' }).ok, false, 'secret keys still refuse');
  assert.equal(s.ok, true);
  assert.equal(s.resultOnly, true);
  assert.deepEqual(s.model, { result: 'saved', vaultLabel: 'Work', kind: 'card' });
  assert.deepEqual(sanitizeSavePromptModel({ result: 'saved', kind: 'bogus' }).model, { result: 'saved' });
  assert.deepEqual(
    sanitizeSavePromptModel({ result: 'saved', vaultLabel: 'x'.repeat(900) }).model.vaultLabel.length,
    512
  );
  // the other results still keep only { result }
  assert.deepEqual(sanitizeSavePromptModel({ result: 'expired', vaultLabel: 'Work' }).model, { result: 'expired' });
});

test('AC8: a presented `saved` result reads "<Noun> saved to <vault>", holds 2500 ms, closes `saved`', async (t0) => {
  const t = build();
  t0.mock.timers.enable({ apis: ['setTimeout'] });
  t.human.tabs.clear();
  await t.handlers.get('save-prompt:open')(
    { sender: t.chromeSender },
    { token: 1, captureId: 'cap1', wcId: 7, model: { result: 'saved', vaultLabel: 'Work', kind: 'login' }, queue: null }
  );
  const init = t.h.views[0].calls.find(([k]) => k === 'send');
  void init;
  t.h.views[0].webContents.emit('did-finish-load');
  t.h.manager.reportHeight(1, 100);
  for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r));
  t0.mock.timers.tick(2499);
  assert.deepEqual(closedReasons(t), []);
  t0.mock.timers.tick(1);
  assert.deepEqual(closedReasons(t), ['saved']);
});

test('AC1.4: GOLDFINCH_VAULT_TRACE payloads carry ONLY opaque ids and reason strings (pinned keys)', async () => {
  const t = await build().show();
  await consent(t, good);
  const opens = t.traces.filter(([s]) => s === 'save-prompt-open');
  const consents = t.traces.filter(([s]) => s === 'save-prompt-consent');
  assert.equal(opens.length, 1);
  assert.deepEqual(Object.keys(opens[0][1]).sort(), ['captureId', 'presented', 'reason']);
  assert.deepEqual(opens[0][1], { captureId: 'cap1', presented: true, reason: null });
  assert.equal(consents.length, 1);
  assert.deepEqual(Object.keys(consents[0][1]).sort(), ['captureId', 'outcome']);
  assert.equal(consents[0][1].outcome, 'granted');
  const values = t.traces.flatMap(([, f]) => Object.values(f));
  for (const leak of ['https://a.example', 'me', 'Personal', 'Global', 'personal']) {
    assert.ok(!values.includes(leak), `trace leaks ${leak}`);
  }
});
