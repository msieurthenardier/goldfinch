'use strict';

// Mission 23 Flight 1 (leg `vault-fill-trust`): the picker context id main minted when it accepted the
// gesture must survive EVERY hop of the chrome's vault flow and reach the chrome-facing calls, because main
// refuses `vaultReachableItems` / `vaultFillHuman` / `vaultFillGenerated` without it. Each test drives one
// hop from `onVaultGesture` and asserts the id reaches the call.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createVaultController } = require('../../src/renderer/chrome/vault-controller');

const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};
// Leg `vault-picker-controls`: the fixture context is UNFLAGGED - a flagged one now opens the certificate
// warning view first on every branch (covered in `vault-controller-picker-controls.test.js`), which is not the
// hop these tests follow.
const CTX = { contextId: 'ctx-77', destination: 'example.com:8443', certificate: false };
const ITEM = { vaultId: 'global', id: 'i1', title: 'GitHub', type: 'login' };

function harness({ fillHumanResults = [] } = {}) {
  const opens = [];
  const reachable = [];
  const fills = [];
  const generated = [];
  const results = [...fillHumanResults];
  const on = {};
  const goldfinch = new Proxy(
    {
      getVaultLockState: () => Promise.resolve({ setUp: false, unlocked: false }),
      getVaultAutomationHeld: () => Promise.resolve({ held: false }),
      vaultReachableItems: (payload) => {
        reachable.push(payload);
        return Promise.resolve([ITEM]);
      },
      vaultFillHuman: (payload) => {
        fills.push(payload);
        return Promise.resolve(results.length ? results.shift() : { filled: true });
      },
      vaultFillGenerated: (payload) => {
        generated.push(payload);
        return Promise.resolve({ filled: true });
      }
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
    openOverlayMenu: (menuType, model) => {
      opens.push({ menuType, model });
      return true;
    },
    toast: () => {}
  });
  return { controller, on, opens, reachable, fills, generated };
}
const act = (h, id) => h.controller.handleActivation({ menuType: 'vault-picker', id });
const GEN = { canGenerate: true, constraints: { minLength: 8, maxLength: null, passwordRules: null } };

test('hop: the UNLOCKED picker reads reachable items with the id, and the pick fills with it', async () => {
  const h = harness();
  await flush();
  h.on.onVaultLockState({ setUp: true, unlocked: true });
  h.on.onVaultGesture({ wcId: 5, ...CTX });
  await flush();
  assert.deepEqual(h.reachable, [{ wcId: 5, contextId: 'ctx-77' }]);
  act(h, 'pick:0');
  await flush();
  assert.deepEqual(h.fills, [{ wcId: 5, vaultId: 'global', itemId: 'i1', contextId: 'ctx-77' }]);
});

test('hop: a LOCKED gesture raises the unlock sheet; after the unlock the picker that follows reads with the id and the pick fills with it', async () => {
  const h = harness();
  await flush();
  h.on.onVaultLockState({ setUp: true, unlocked: false });
  h.on.onVaultGesture({ wcId: 5, ...CTX });
  assert.equal(h.opens.at(-1).menuType, 'vault-unlock');
  assert.deepEqual(h.reachable, [], 'nothing read while locked');
  h.on.onVaultLockState({ setUp: true, unlocked: true });
  await flush();
  assert.deepEqual(h.reachable, [{ wcId: 5, contextId: 'ctx-77' }], 'the picker following the unlock carries the id');
  act(h, 'pick:0');
  await flush();
  assert.deepEqual(h.fills, [{ wcId: 5, vaultId: 'global', itemId: 'i1', contextId: 'ctx-77' }]);
});

test('hop: the LOCKED generate/unlock two-row picker (no store read) keeps the id for the Generate row', async () => {
  const h = harness();
  await flush();
  h.on.onVaultLockState({ setUp: true, unlocked: false });
  h.on.onVaultGesture({ wcId: 5, ...CTX, generate: GEN });
  assert.deepEqual(h.opens.at(-1).model, [{ action: 'generate' }, { action: 'unlock' }]);
  assert.deepEqual(h.reachable, []);
  act(h, 'generate-password');
  await flush();
  assert.deepEqual(h.generated, [{ wcId: 5, contextId: 'ctx-77', constraints: GEN.constraints }]);
});

test('hop: the UNLOCK row of the two-row picker keeps the id through the unlock to the full picker, then Generate and pick both carry it', async () => {
  const h = harness();
  await flush();
  h.on.onVaultLockState({ setUp: true, unlocked: false });
  h.on.onVaultGesture({ wcId: 5, ...CTX, generate: GEN });
  act(h, 'unlock-saved-logins');
  assert.equal(h.opens.at(-1).menuType, 'vault-unlock');
  h.on.onVaultLockState({ setUp: true, unlocked: true });
  await flush();
  assert.deepEqual(h.reachable, [{ wcId: 5, contextId: 'ctx-77' }]);
  assert.deepEqual(h.opens.at(-1).model, [{ action: 'generate' }, ITEM]);
  act(h, 'generate-password');
  await flush();
  assert.deepEqual(h.generated, [{ wcId: 5, contextId: 'ctx-77', constraints: GEN.constraints }]);
});

test('hop: the `locked` re-raise after a pick keeps the id; the re-opened picker reads and the second pick fills with the same id', async () => {
  const h = harness({ fillHumanResults: [{ filled: false, reason: 'locked' }, { filled: true }] });
  await flush();
  h.on.onVaultLockState({ setUp: true, unlocked: true });
  h.on.onVaultGesture({ wcId: 5, ...CTX });
  await flush();
  act(h, 'pick:0');
  await flush();
  assert.equal(h.fills[0].contextId, 'ctx-77');
  assert.equal(h.opens.at(-1).menuType, 'vault-unlock', 'locked between pick and fill re-raises the unlock sheet');
  h.on.onVaultLockState({ setUp: true, unlocked: true });
  await flush();
  assert.deepEqual(h.reachable.at(-1), { wcId: 5, contextId: 'ctx-77' }, 'the post-unlock picker carries the id again');
  act(h, 'pick:0');
  await flush();
  assert.deepEqual(h.fills.at(-1), { wcId: 5, vaultId: 'global', itemId: 'i1', contextId: 'ctx-77' });
  assert.equal(h.fills.length, 2);
});

test('a new gesture replaces the flow with its own id; Manage clears it; a recovered chrome (a fresh controller) has no id to send', async () => {
  const h = harness();
  await flush();
  h.on.onVaultLockState({ setUp: true, unlocked: true });
  h.on.onVaultGesture({ wcId: 5, ...CTX });
  await flush();
  h.on.onVaultGesture({ wcId: 6, contextId: 'ctx-78', destination: 'other.test', certificate: false });
  await flush();
  act(h, 'pick:0');
  await flush();
  assert.deepEqual(h.fills, [{ wcId: 6, vaultId: 'global', itemId: 'i1', contextId: 'ctx-78' }], 'last wins');

  // Manage passwords clears the flow: a later pick has nothing to send.
  h.on.onVaultGesture({ wcId: 5, ...CTX });
  await flush();
  act(h, 'manage-passwords');
  act(h, 'pick:0');
  await flush();
  assert.equal(h.fills.length, 1);

  // Chrome recovery reloads the chrome: the new controller never saw the gesture, so a pick sends nothing.
  const recovered = harness();
  await flush();
  recovered.on.onVaultLockState({ setUp: true, unlocked: true });
  act(recovered, 'pick:0');
  await flush();
  assert.deepEqual(recovered.fills, []);
  assert.deepEqual(recovered.generated, []);
});
