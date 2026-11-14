'use strict';

// Chrome-side sequence of leg `vault-picker-controls` (Mission 23 Flight 1), driven through the REAL
// `createVaultController` with a MOCK BRIDGE. The bridge (the `goldfinch.*` object) is a SUBSTITUTE for the
// real chrome-preload / main IPC: what main does with `contextId`, `confirm` and the acknowledge call is pinned
// in `vault-human-confirm.test.js`; this file pins only what the chrome SENDS and OPENS at each step.
//
//   - every picker open carries the destination, and a picker with no destination is not opened;
//   - a certificate-flagged gesture opens the WARNING view first on every branch (unlocked, locked, locked +
//     generate), reads nothing and raises no unlock sheet until Continue; Continue acknowledges in main, then
//     runs the branch the gesture would have run (from a stale flow, nothing runs);
//   - gesture -> pick -> `confirm-needed` -> confirmation view (title, secondary fields, Fill, Cancel) -> Fill
//     sends `confirm: true` (the ONLY sender); Cancel is a dismissal that abandons the flow; a lock while the
//     confirmation is up re-raises the unlock sheet and the picker that follows is the plain one, whose pick
//     carries no `confirm`.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createVaultController } = require('../../src/renderer/chrome/vault-controller');

const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
const CTX = { contextId: 'ctx-1', destination: 'shop.example', certificate: false };
const CARD_ROW = { vaultId: 'work', id: 'c1', type: 'card', title: 'Visa', brand: 'Visa', last4: '4242' };
const LOGIN_ROW = { vaultId: 'work', id: 'l1', type: 'login', title: 'Shop', username: 'me' };
const IDENTITY_ROW = { vaultId: 'global', id: 'i1', type: 'identity', title: 'Home', fullName: 'Ada Lovelace' };
const GEN = { canGenerate: true, constraints: { minLength: 8, maxLength: null, passwordRules: null } };

function harness({ fillResults = [], ackResults = [], rows = [CARD_ROW, LOGIN_ROW] } = {}) {
  const opens = [];
  const reachable = [];
  const fills = [];
  const acks = [];
  const fillQueue = [...fillResults];
  const ackQueue = [...ackResults];
  const on = {};
  const goldfinch = new Proxy(
    {
      getVaultLockState: () => Promise.resolve({ setUp: false, unlocked: false }),
      getVaultAutomationHeld: () => Promise.resolve({ held: false }),
      vaultReachableItems: (p) => {
        reachable.push(p);
        return Promise.resolve(rows.map((r) => ({ ...r })));
      },
      vaultFillHuman: (p) => {
        fills.push(p);
        return Promise.resolve(fillQueue.length ? fillQueue.shift() : { filled: true });
      },
      vaultCertificateAcknowledge: (p) => {
        acks.push(p);
        return Promise.resolve(ackQueue.length ? ackQueue.shift() : { ok: true });
      },
      vaultFillGenerated: () => Promise.resolve({ filled: true })
    },
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (typeof prop === 'string' && prop.startsWith('on')) return (cb) => (on[prop] = cb);
        return () => {};
      }
    }
  );
  const controller = createVaultController({
    els: { vaultIndicator: null },
    goldfinch,
    jarsClient: { containers: [] },
    isSafeColor: () => false,
    openVaultPage: () => {},
    openOverlayMenu: (menuType, model, anchor, startIndex, opts) => {
      opens.push({ menuType, model, opts });
      return true;
    },
    toast: () => {}
  });
  const lock = (unlocked) => on.onVaultLockState({ setUp: true, unlocked });
  const gesture = (extra = {}) => on.onVaultGesture({ wcId: 5, ...CTX, ...extra });
  const act = (id) => controller.handleActivation({ menuType: 'vault-picker', id });
  const last = () => opens.at(-1);
  return { controller, on, opens, reachable, fills, acks, lock, gesture, act, last };
}

// ---- destination -----------------------------------------------------------------------------------

test('every picker open carries the destination: unlocked, locked generate/unlock, after an unlock', async () => {
  const h = harness();
  await flush();
  h.lock(true);
  h.gesture();
  await flush();
  assert.equal(h.last().menuType, 'vault-picker');
  assert.deepEqual(h.last().opts, { destination: 'shop.example' });

  h.lock(false);
  h.gesture({ generate: GEN });
  assert.deepEqual(h.last().model, [{ action: 'generate' }, { action: 'unlock' }]);
  assert.deepEqual(h.last().opts, { destination: 'shop.example' });
  h.act('unlock-saved-logins');
  assert.equal(h.last().menuType, 'vault-unlock');
  h.lock(true);
  await flush();
  assert.equal(h.last().menuType, 'vault-picker');
  assert.deepEqual(h.last().opts, { destination: 'shop.example' }, 'the picker after the unlock');
});

test('with no destination the chrome does not open a picker (no read, no sheet); the unlock sheet is not a picker', async () => {
  for (const destination of [undefined, '', null, 5]) {
    const h = harness();
    await flush();
    h.lock(true);
    h.gesture({ destination });
    await flush();
    assert.equal(h.opens.length, 0, `unlocked, destination ${String(destination)}: nothing opened`);
    h.lock(false);
    h.gesture({ destination, generate: GEN });
    await flush();
    assert.equal(h.opens.length, 0, 'locked generate picker: nothing opened');
    h.gesture({ destination, certificate: true });
    await flush();
    assert.equal(h.opens.length, 0, 'the warning view is a picker too');
    assert.deepEqual(h.reachable, []);
  }
});

// ---- certificate warning --------------------------------------------------------------------------------

test('certificate: the warning view comes FIRST on the unlocked branch; Continue acknowledges in main, then the picker opens', async () => {
  const h = harness();
  await flush();
  h.lock(true);
  h.gesture({ certificate: true });
  await flush();
  assert.deepEqual(
    h.opens.map((o) => o.menuType),
    ['vault-picker']
  );
  assert.deepEqual(h.last().model, [{ action: 'certificate-continue' }]);
  assert.deepEqual(h.last().opts, { destination: 'shop.example' });
  assert.deepEqual(h.reachable, [], 'nothing read before Continue');
  assert.deepEqual(h.acks, []);
  h.act('certificate-continue');
  await flush();
  assert.deepEqual(h.acks, [{ wcId: 5, contextId: 'ctx-1' }]);
  assert.deepEqual(h.reachable, [{ wcId: 5, contextId: 'ctx-1' }]);
  assert.equal(h.opens.length, 2);
  assert.equal(h.last().model.length, 2, 'the real picker (a card and a login)');
});

test('certificate: the LOCKED branch shows the warning first (not the unlock sheet); Continue then raises the unlock sheet', async () => {
  const h = harness();
  await flush();
  h.lock(false);
  h.gesture({ certificate: true });
  await flush();
  assert.deepEqual(
    h.opens.map((o) => o.menuType),
    ['vault-picker'],
    'no unlock sheet yet'
  );
  assert.deepEqual(h.last().model, [{ action: 'certificate-continue' }]);
  h.act('certificate-continue');
  await flush();
  assert.deepEqual(
    h.opens.map((o) => o.menuType),
    ['vault-picker', 'vault-unlock']
  );
  // ...and the unlock still continues to the picker, which still carries the destination.
  h.lock(true);
  await flush();
  assert.equal(h.last().menuType, 'vault-picker');
  assert.deepEqual(h.last().opts, { destination: 'shop.example' });
});

test('certificate: the locked generate branch shows the warning first, with no generate row; Continue then opens the two-row picker', async () => {
  const h = harness();
  await flush();
  h.lock(false);
  h.gesture({ certificate: true, generate: GEN });
  assert.deepEqual(h.last().model, [{ action: 'certificate-continue' }], 'no items, no generate row');
  h.act('certificate-continue');
  await flush();
  assert.deepEqual(h.last().model, [{ action: 'generate' }, { action: 'unlock' }]);
});

test('certificate: a failed acknowledgement runs nothing; a flow replaced meanwhile is not run by the stale answer', async () => {
  const h = harness({ ackResults: [{ ok: false }] });
  await flush();
  h.lock(true);
  h.gesture({ certificate: true });
  h.act('certificate-continue');
  await flush();
  assert.equal(h.opens.length, 1, 'refused acknowledgement: still only the warning');
  assert.deepEqual(h.reachable, []);

  // A second gesture replaces the flow before the acknowledge resolves.
  const h2 = harness();
  await flush();
  h2.lock(true);
  h2.gesture({ certificate: true });
  h2.act('certificate-continue'); // ack is in flight (a microtask away)
  h2.gesture({ contextId: 'ctx-2', certificate: true }); // replaces pendingVaultFlow synchronously
  await flush();
  assert.equal(h2.reachable.length, 0, 'the stale acknowledgement did not run the old branch');
  // Continue with no warning flow does nothing at all.
  const h3 = harness();
  await flush();
  h3.act('certificate-continue');
  await flush();
  assert.deepEqual(h3.acks, []);
});

test('certificate: an unflagged gesture never shows the warning', async () => {
  const h = harness();
  await flush();
  h.lock(true);
  h.gesture({ certificate: false });
  await flush();
  assert.ok(!h.opens.some((o) => JSON.stringify(o.model).includes('certificate-continue')));
  assert.deepEqual(h.acks, []);
});

// ---- confirmation ---------------------------------------------------------------------------------------

test('gesture -> pick card -> confirm-needed -> confirmation view -> Fill sends confirm:true (the only sender)', async () => {
  const h = harness({ fillResults: [{ filled: false, reason: 'confirm-needed' }, { filled: true }] });
  await flush();
  h.lock(true);
  h.gesture();
  await flush();
  h.act('pick:0'); // the card row
  await flush();
  assert.deepEqual(
    h.fills,
    [{ wcId: 5, vaultId: 'work', itemId: 'c1', contextId: 'ctx-1' }],
    'the first pick carries no confirm'
  );
  assert.equal('confirm' in h.fills[0], false);
  assert.equal(h.last().menuType, 'vault-picker');
  assert.deepEqual(h.last().model, [
    { action: 'confirm-summary', type: 'card', title: 'Visa', brand: 'Visa', last4: '4242', fullName: undefined },
    { action: 'confirm-fill' },
    { action: 'confirm-cancel' }
  ]);
  assert.deepEqual(h.last().opts, { destination: 'shop.example' }, 'the confirmation carries the destination');
  h.act('confirm-fill');
  await flush();
  assert.equal(h.fills.length, 2);
  assert.deepEqual(h.fills[1], { wcId: 5, vaultId: 'work', itemId: 'c1', contextId: 'ctx-1', confirm: true });
  assert.equal(h.opens.length, 2, 'nothing else opened after the filled answer');
});

test('an identity confirmation carries its title and full name (non-secret fields only)', async () => {
  const h = harness({ rows: [IDENTITY_ROW], fillResults: [{ filled: false, reason: 'confirm-needed' }] });
  await flush();
  h.lock(true);
  h.gesture();
  await flush();
  h.act('pick:0');
  await flush();
  assert.deepEqual(h.fills, [{ wcId: 5, vaultId: 'global', itemId: 'i1', contextId: 'ctx-1' }]);
  assert.deepEqual(h.last().model[0], {
    action: 'confirm-summary',
    type: 'identity',
    title: 'Home',
    brand: undefined,
    last4: undefined,
    fullName: 'Ada Lovelace'
  });
  assert.deepEqual(h.last().model.slice(1), [{ action: 'confirm-fill' }, { action: 'confirm-cancel' }]);
});

test('a login pick fills without ever opening a confirmation view (main only asks for card / identity)', async () => {
  const h = harness({ rows: [LOGIN_ROW] });
  await flush();
  h.lock(true);
  h.gesture();
  await flush();
  h.act('pick:0');
  await flush();
  assert.equal(h.fills.length, 1);
  assert.equal(h.opens.length, 1, 'only the picker itself');
});

test('Cancel is a dismissal: the flow is abandoned and a stale Fill does nothing', async () => {
  const h = harness({ fillResults: [{ filled: false, reason: 'confirm-needed' }] });
  await flush();
  h.lock(true);
  h.gesture();
  await flush();
  h.act('pick:0');
  await flush();
  // The sheet reports the dismissal (escape flavor) - the chrome abandons the flow.
  h.controller.handleClosed({ menuType: 'vault-picker', reason: 'escape' });
  h.act('confirm-fill');
  await flush();
  assert.equal(h.fills.length, 1, 'no second fill call');
});

test('an activation or a model replace of the picker is NOT abandonment (the confirmation reopens through them)', async () => {
  const h = harness({ fillResults: [{ filled: false, reason: 'confirm-needed' }, { filled: true }] });
  await flush();
  h.lock(true);
  h.gesture();
  await flush();
  h.act('pick:0');
  await flush();
  h.controller.handleClosed({ menuType: 'vault-picker', reason: 'activated' });
  h.controller.handleClosed({ menuType: 'vault-picker', reason: 'superseded' });
  h.act('confirm-fill');
  await flush();
  assert.equal(h.fills.length, 2);
});

test('a lock while the confirmation is up: Fill answers locked -> unlock sheet -> the PLAIN picker; its pick carries no confirm', async () => {
  const h = harness({
    fillResults: [
      { filled: false, reason: 'confirm-needed' },
      { filled: false, reason: 'locked' },
      { filled: false, reason: 'confirm-needed' }
    ]
  });
  await flush();
  h.lock(true);
  h.gesture();
  await flush();
  h.act('pick:0');
  await flush();
  h.lock(false);
  h.act('confirm-fill');
  await flush();
  assert.equal(h.fills[1].confirm, true);
  assert.equal(h.last().menuType, 'vault-unlock');
  h.lock(true);
  await flush();
  assert.equal(h.last().menuType, 'vault-picker');
  assert.equal(h.last().model.length, 2, 'the plain picker (card + login), not the confirmation view');
  h.act('pick:0');
  await flush();
  assert.equal('confirm' in h.fills[2], false, 'the re-pick sends no confirm: main asks again');
  assert.deepEqual(h.last().model[1], { action: 'confirm-fill' }, 'and the confirmation view is shown again');
});

test('Fill with no confirming flow (never asked, or a stale view) sends nothing', async () => {
  const h = harness();
  await flush();
  h.act('confirm-fill');
  h.lock(true);
  h.gesture();
  await flush();
  h.act('confirm-fill'); // phase is 'picking', not 'confirming'
  await flush();
  assert.deepEqual(h.fills, []);
});

test('the Cancel id is never an activation the chrome handles (it is a sheet-side dismissal)', () => {
  const src = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../../src/renderer/chrome/vault-controller.js'),
    'utf8'
  );
  assert.doesNotMatch(src, /CONFIRM_CANCEL_ID/);
});

test('the acknowledge channel is exposed by the chrome preload, declared in the globals, and sent by the controller', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.join(__dirname, '../..');
  assert.match(
    fs.readFileSync(path.join(root, 'src/preload/chrome-preload.js'), 'utf8'),
    /vaultCertificateAcknowledge: \(payload\) => ipcRenderer\.invoke\('vault-certificate-acknowledge', payload\)/
  );
  assert.match(
    fs.readFileSync(path.join(root, 'src/renderer/renderer-globals.d.ts'), 'utf8'),
    /vaultCertificateAcknowledge\(payload/
  );
  assert.match(
    fs.readFileSync(path.join(root, 'src/renderer/chrome/vault-controller.js'), 'utf8'),
    /goldfinch\.vaultCertificateAcknowledge\(/
  );
});
