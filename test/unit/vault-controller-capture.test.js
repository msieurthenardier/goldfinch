'use strict';

// The chrome-side unlock-to-save branch of the vault capture flow.
//
// A login-form submit into a LOCKED vault holds the credential main-side and the
// chrome raises the master-password prompt. That SAME submit navigates the page, and
// when the submitted page loads it pulls OS focus into the guest — which used to blur
// the sheet, close the prompt, and drop the held credential, so the operator saw the
// prompt flash and could never save the password. The prompt therefore opens with the
// keep-focus opt-in (the sheet skips the incidental blur dismissal; main re-grabs
// focus); the ALREADY-UNLOCKED branch of the same flow has carried the equivalent
// opt-out on its own sheet entry since 0.11.1.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createVaultController } = require('../../src/renderer/chrome/vault-controller');

function harness({ unlocked = false } = {}) {
  const opens = [];
  const dismissed = [];
  const finalized = [];
  /** @type {Record<string, Function>} */
  const on = {};
  const goldfinch = new Proxy({
    getVaultLockState: () => Promise.resolve({ setUp: true, unlocked }),
    vaultCaptureDismiss: (id) => { dismissed.push(id); return Promise.resolve(); },
    vaultCaptureFinalize: (id) => { finalized.push(id); return Promise.resolve(null); },
  }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      // Every onVault* subscription: record the callback under its channel name.
      if (typeof prop === 'string' && prop.startsWith('on')) {
        return (cb) => { on[prop] = cb; };
      }
      return () => {};
    },
  });
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
  });
  return { controller, on, opens, dismissed, finalized };
}

test('a LOCKED capture raises the unlock prompt with the keep-focus opt-in', () => {
  const h = harness({ unlocked: false });
  h.on.onVaultCaptureOffer({
    captureId: 'abc123',
    model: { origin: 'https://example.com', username: 'someone', mode: 'locked' },
  });
  assert.equal(h.opens.length, 1);
  assert.equal(h.opens[0].menuType, 'vault-unlock');
  assert.deepEqual(h.opens[0].opts, { keepFocus: true },
    'the prompt must survive the submit navigation that spawned it');
});

test('an UNLOCKED capture opens the save sheet, untouched by the keep-focus branch', () => {
  const h = harness({ unlocked: true });
  h.on.onVaultCaptureOffer({
    captureId: 'abc123',
    model: {
      origin: 'https://example.com', username: 'someone', mode: 'save',
      defaultVaultId: 'global', choices: ['global'],
    },
  });
  assert.equal(h.opens.length, 1);
  assert.equal(h.opens[0].menuType, 'vault-capture');
  assert.equal(h.opens[0].opts, undefined, 'no options on the save sheet open');
  assert.equal(h.opens[0].model.captureId, 'abc123', 'captureId rides inside the model');
});

test('the unlock prompt still drops the held credential when it is genuinely dismissed', () => {
  const h = harness({ unlocked: false });
  h.on.onVaultCaptureOffer({
    captureId: 'abc123',
    model: { origin: 'https://example.com', username: 'someone', mode: 'locked' },
  });
  // Still locked → the operator declined (Escape / Cancel / X / backdrop / app-switch).
  // Keep-focus changes which closes can happen, never what a real close means.
  h.controller.handleClosed({ menuType: 'vault-unlock', reason: 'escape' });
  assert.deepEqual(h.dismissed, ['abc123']);
});

test('a successful unlock finalizes the held capture instead of dropping it', () => {
  const h = harness({ unlocked: false });
  h.on.onVaultCaptureOffer({
    captureId: 'abc123',
    model: { origin: 'https://example.com', username: 'someone', mode: 'locked' },
  });
  h.on.onVaultLockState({ setUp: true, unlocked: true });
  assert.deepEqual(h.finalized, ['abc123']);
  assert.deepEqual(h.dismissed, [], 'an unlocked capture is never dropped');
});
