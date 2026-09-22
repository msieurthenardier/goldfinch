'use strict';

// Chrome-side Generate-in-picker unit tests (Mission 21, Flight 4, Leg 3 —
// generate-in-picker, DD5/AC10/AC11). Covers `vault-controller.js`'s
// `onVaultGesture` branches (unlocked+canGenerate, locked+canGenerate — no
// store read, and the unchanged "any other combination" cases), the
// post-unlock continuation re-showing the Generate row, and
// `handleActivation`'s GENERATE_ID/UNLOCK_ID branches.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createVaultController } = require('../../src/renderer/chrome/vault-controller');

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function harness({ reachableItems = [] } = {}) {
  const opens = [];
  const openVaultPageCalls = [];
  const vaultFillGeneratedCalls = [];
  const vaultReachableItemsCalls = [];
  let vaultFillGeneratedResult = { filled: true };
  /** @type {Record<string, Function>} */
  const on = {};
  const goldfinch = new Proxy(
    {
      // The controller's own boot-time fetch (subscribe-then-fetch, DD10 freshness
      // contract). Resolved to the SAFE default so it can never race ahead of a
      // test's own explicit onVaultLockState push below — every test calls
      // `await flush()` right after construction to let this settle FIRST.
      getVaultLockState: () => Promise.resolve({ setUp: false, unlocked: false }),
      vaultReachableItems: (wcId) => {
        vaultReachableItemsCalls.push(wcId);
        return Promise.resolve(reachableItems);
      },
      vaultFillGenerated: (payload) => {
        vaultFillGeneratedCalls.push(payload);
        return Promise.resolve(vaultFillGeneratedResult);
      }
    },
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (typeof prop === 'string' && prop.startsWith('on')) {
          return (cb) => {
            on[prop] = cb;
          };
        }
        return () => {};
      }
    }
  );
  const controller = createVaultController({
    els: { vaultIndicator: null },
    goldfinch,
    jarsClient: { containers: [] },
    isSafeColor: () => false,
    openVaultPage: () => openVaultPageCalls.push(true),
    openOverlayMenu: (menuType, model, anchor, startIndex, opts) => {
      opens.push({ menuType, model, anchor, startIndex, opts });
      return true;
    },
    toast: () => {}
  });
  return {
    controller,
    on,
    opens,
    openVaultPageCalls,
    vaultFillGeneratedCalls,
    vaultReachableItemsCalls,
    setFillGeneratedResult: (r) => {
      vaultFillGeneratedResult = r;
    }
  };
}

test('AC10: unlocked + canGenerate=true prepends { action: "generate" } ahead of the real items', async () => {
  const h = harness({ reachableItems: [{ vaultId: 'global', id: 'i1', title: 'GitHub' }] });
  await flush(); // let the boot fetch settle first
  h.on.onVaultLockState({ setUp: true, unlocked: true });
  h.on.onVaultGesture({ wcId: 5, generate: { canGenerate: true, constraints: { minLength: 8 } } });
  await flush();

  assert.equal(h.opens.length, 1);
  assert.equal(h.opens[0].menuType, 'vault-picker');
  assert.deepEqual(h.opens[0].model, [{ action: 'generate' }, { vaultId: 'global', id: 'i1', title: 'GitHub' }]);
  assert.deepEqual(h.vaultReachableItemsCalls, [5]);
});

test('AC10: unlocked + no generate (or canGenerate=false) behaves exactly as today — no generate row', async () => {
  const h = harness({ reachableItems: [{ vaultId: 'global', id: 'i1', title: 'GitHub' }] });
  await flush();
  h.on.onVaultLockState({ setUp: true, unlocked: true });
  h.on.onVaultGesture({ wcId: 5 });
  await flush();
  assert.deepEqual(h.opens[0].model, [{ vaultId: 'global', id: 'i1', title: 'GitHub' }]);

  h.opens.length = 0;
  h.on.onVaultGesture({ wcId: 5, generate: { canGenerate: false, constraints: {} } });
  await flush();
  assert.deepEqual(h.opens[0].model, [{ vaultId: 'global', id: 'i1', title: 'GitHub' }]);
});

test('AC10: locked + canGenerate=true opens Generate+Unlock rows with NO store read', async () => {
  const h = harness();
  await flush();
  h.on.onVaultLockState({ setUp: true, unlocked: false });
  h.on.onVaultGesture({ wcId: 5, generate: { canGenerate: true, constraints: { minLength: 8 } } });

  assert.equal(h.opens.length, 1);
  assert.equal(h.opens[0].menuType, 'vault-picker');
  assert.deepEqual(h.opens[0].model, [{ action: 'generate' }, { action: 'unlock' }]);
  assert.deepEqual(h.vaultReachableItemsCalls, [], 'the store must never be read while locked');
});

test("AC10: locked + no generate (today's behavior) raises the plain unlock sheet", async () => {
  const h = harness();
  await flush();
  h.on.onVaultLockState({ setUp: true, unlocked: false });
  h.on.onVaultGesture({ wcId: 5 });

  assert.equal(h.opens.length, 1);
  assert.equal(h.opens[0].menuType, 'vault-unlock');
});

test('AC10: the Generate row re-shows after Unlock -> a successful unlock re-opens the full picker with it', async () => {
  const h = harness({ reachableItems: [{ vaultId: 'global', id: 'i1', title: 'GitHub' }] });
  await flush();
  h.on.onVaultLockState({ setUp: true, unlocked: false });
  h.on.onVaultGesture({ wcId: 5, generate: { canGenerate: true, constraints: { minLength: 8 } } });
  assert.equal(h.opens[0].menuType, 'vault-picker');

  // Choose Unlock (handleActivation's UNLOCK_ID branch).
  h.controller.handleActivation({ menuType: 'vault-picker', id: 'unlock-saved-logins' });
  assert.equal(h.opens[1].menuType, 'vault-unlock');

  // Successful unlock -> the continuation re-opens the picker, now with real items
  // AND the generate row (survived on pendingVaultFlow.generate).
  h.on.onVaultLockState({ setUp: true, unlocked: true });
  await flush();

  const finalOpen = h.opens[h.opens.length - 1];
  assert.equal(finalOpen.menuType, 'vault-picker');
  assert.deepEqual(finalOpen.model, [{ action: 'generate' }, { vaultId: 'global', id: 'i1', title: 'GitHub' }]);
});

test("AC11: GENERATE_ID dispatches vaultFillGenerated with the flow's wcId + constraints, then clears the flow", async () => {
  const h = harness();
  await flush();
  h.on.onVaultLockState({ setUp: true, unlocked: true });
  h.on.onVaultGesture({ wcId: 5, generate: { canGenerate: true, constraints: { minLength: 12 } } });
  await flush();

  const handled = h.controller.handleActivation({ menuType: 'vault-picker', id: 'generate-password' });
  assert.equal(handled, true);
  assert.deepEqual(h.vaultFillGeneratedCalls, [{ wcId: 5, constraints: { minLength: 12 } }]);

  // Flow is cleared: a second GENERATE_ID with no pending flow is a safe no-op.
  h.vaultFillGeneratedCalls.length = 0;
  h.controller.handleActivation({ menuType: 'vault-picker', id: 'generate-password' });
  assert.deepEqual(h.vaultFillGeneratedCalls, []);
});

test('AC11: a resolved { filled: false } from vaultFillGenerated raises no sheet', async () => {
  const h = harness();
  await flush();
  h.on.onVaultLockState({ setUp: true, unlocked: true });
  h.on.onVaultGesture({ wcId: 5, generate: { canGenerate: true, constraints: {} } });
  await flush();
  h.setFillGeneratedResult({ filled: false, reason: 'unsatisfiable' });
  h.opens.length = 0;

  h.controller.handleActivation({ menuType: 'vault-picker', id: 'generate-password' });
  await flush();
  assert.deepEqual(h.opens, []);
});

test('AC11: UNLOCK_ID sets the flow to unlocking and opens vault-unlock, keeping wcId + generate', async () => {
  const h = harness();
  await flush();
  h.on.onVaultLockState({ setUp: true, unlocked: false });
  h.on.onVaultGesture({ wcId: 9, generate: { canGenerate: true, constraints: { minLength: 8 } } });
  h.opens.length = 0;

  const handled = h.controller.handleActivation({ menuType: 'vault-picker', id: 'unlock-saved-logins' });
  assert.equal(handled, true);
  assert.equal(h.opens[0].menuType, 'vault-unlock');
});

test("pick:<i> on an action row's own index is a no-op (never crashes / never fills a bogus item)", async () => {
  const h = harness({ reachableItems: [] });
  await flush();
  h.on.onVaultLockState({ setUp: true, unlocked: true });
  h.on.onVaultGesture({ wcId: 5, generate: { canGenerate: true, constraints: {} } });
  await flush();
  // The model is [{action:'generate'}] — pick:0 would resolve that very entry,
  // which has no vaultId/id; the fill dispatch must not throw.
  assert.doesNotThrow(() => h.controller.handleActivation({ menuType: 'vault-picker', id: 'pick:0' }));
});
