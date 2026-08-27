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

// Minimal fake DOM element for the vault-indicator contextmenu-wiring cases below:
// records the listener so a test can fire a synthetic 'contextmenu' event.
function fakeVaultIndicatorEl() {
  /** @type {Record<string, Function>} */
  const listeners = {};
  return {
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
    fire(type, evt) {
      listeners[type] && listeners[type](evt);
    }
  };
}

function harness({ unlocked = false, finalizeResult = null, vaultIndicatorEl = null, vaultLockRejects = false } = {}) {
  const opens = [];
  const dismissed = [];
  const finalized = [];
  const toasts = [];
  const vaultLockCalls = [];
  const toolbarContextMenuCalls = [];
  /** @type {Record<string, Function>} */
  const on = {};
  const goldfinch = new Proxy(
    {
      getVaultLockState: () => Promise.resolve({ setUp: true, unlocked }),
      vaultCaptureDismiss: (id) => {
        dismissed.push(id);
        return Promise.resolve();
      },
      vaultCaptureFinalize: (id) => {
        finalized.push(id);
        return finalizeResult instanceof Error ? Promise.reject(finalizeResult) : Promise.resolve(finalizeResult);
      },
      vaultLock: () => {
        vaultLockCalls.push(true);
        return vaultLockRejects ? Promise.reject(new Error('ipc gone')) : Promise.resolve({ ok: true });
      }
    },
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        // Every onVault* subscription: record the callback under its channel name.
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
    els: { vaultIndicator: vaultIndicatorEl },
    goldfinch,
    jarsClient: { containers: [] },
    isSafeColor: () => false,
    openVaultPage: () => {},
    openToolbarContextMenu: (item, anchorEl) => toolbarContextMenuCalls.push({ item, anchorEl }),
    openOverlayMenu: (menuType, model, anchor, startIndex, opts) => {
      opens.push({ menuType, model, opts });
      return true;
    },
    toast: (title, body) => toasts.push([title, body])
  });
  return { controller, on, opens, dismissed, finalized, toasts, vaultLockCalls, toolbarContextMenuCalls };
}

// Fire a locked-vault capture offer and return its captureId.
function offerLocked(h, captureId = 'abc123') {
  h.on.onVaultCaptureOffer({
    captureId,
    model: { origin: 'https://example.com', username: 'someone', mode: 'locked' }
  });
  return captureId;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

test('a LOCKED capture raises the unlock prompt with the keep-focus opt-in', () => {
  const h = harness({ unlocked: false });
  h.on.onVaultCaptureOffer({
    captureId: 'abc123',
    model: { origin: 'https://example.com', username: 'someone', mode: 'locked' }
  });
  assert.equal(h.opens.length, 1);
  assert.equal(h.opens[0].menuType, 'vault-unlock');
  assert.deepEqual(
    h.opens[0].opts,
    { keepFocus: true },
    'the prompt must survive the submit navigation that spawned it'
  );
});

test('an UNLOCKED capture opens the save sheet, untouched by the keep-focus branch', () => {
  const h = harness({ unlocked: true });
  h.on.onVaultCaptureOffer({
    captureId: 'abc123',
    model: {
      origin: 'https://example.com',
      username: 'someone',
      mode: 'save',
      defaultVaultId: 'global',
      choices: ['global']
    }
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
    model: { origin: 'https://example.com', username: 'someone', mode: 'locked' }
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
    model: { origin: 'https://example.com', username: 'someone', mode: 'locked' }
  });
  h.on.onVaultLockState({ setUp: true, unlocked: true });
  assert.deepEqual(h.finalized, ['abc123']);
  assert.deepEqual(h.dismissed, [], 'an unlocked capture is never dropped');
});

// ---------------------------------------------------------------------------
// Close handling for the unlock prompt raised over a held capture.
// ---------------------------------------------------------------------------

test('every unlock-prompt close that reaches the chrome drops the held credential', () => {
  // 'superseded' is included: a NEWER capture's prompt is the same menuType, so its
  // stale-token close never reaches here (overlay-menus.js drops it) — what does reach
  // here is a supersede by an unrelated menu, where the prompt is gone and the held
  // password should not linger.
  for (const reason of ['escape', 'outside-click', 'blur', 'activated', 'tab-close', 'superseded']) {
    const h = harness({ unlocked: false });
    offerLocked(h);
    h.controller.handleClosed({ menuType: 'vault-unlock', reason });
    assert.deepEqual(h.dismissed, ['abc123'], `reason '${reason}' must still drop the record`);
  }
});

// ---------------------------------------------------------------------------
// No save sheet → say why. The operator typed their master password expressly
// to save this password; silence made a correct no-op ("already saved")
// indistinguishable from a dropped credential.
// ---------------------------------------------------------------------------

test('each finalize reason produces its own operator-visible message', async () => {
  const cases = [
    ['unchanged', 'Nothing to save'],
    ['expired', 'Password not saved'],
    ['tab-changed', 'Password not saved'],
    ['locked', 'Password not saved'],
    [undefined, 'Password not saved'] // an unrecognized/absent reason still speaks
  ];
  for (const [reason, title] of cases) {
    const h = harness({ unlocked: false, finalizeResult: reason ? { reason } : {} });
    offerLocked(h);
    h.on.onVaultLockState({ setUp: true, unlocked: true });
    await settle();
    assert.equal(h.opens.length, 1, `reason '${reason}': no save sheet opens`);
    assert.equal(h.toasts.length, 1, `reason '${reason}': exactly one message`);
    assert.equal(h.toasts[0][0], title);
    assert.ok(h.toasts[0][1].length > 0, 'the message has a body');
  }
  // The 'unchanged' body must not read as a failure — nothing was lost.
  const h = harness({ unlocked: false, finalizeResult: { reason: 'unchanged' } });
  offerLocked(h);
  h.on.onVaultLockState({ setUp: true, unlocked: true });
  await settle();
  assert.match(h.toasts[0][1], /already saved/i);
});

test('a rejected finalize invoke speaks too, instead of failing silently', async () => {
  const h = harness({ unlocked: false, finalizeResult: new Error('ipc gone') });
  offerLocked(h);
  h.on.onVaultLockState({ setUp: true, unlocked: true });
  await settle();
  assert.equal(h.toasts.length, 1);
  assert.equal(h.toasts[0][0], 'Password not saved');
});

test('a successful finalize opens the save sheet and says nothing', async () => {
  const h = harness({
    unlocked: false,
    finalizeResult: {
      captureId: 'abc123',
      model: {
        origin: 'https://example.com',
        username: 'someone',
        mode: 'save',
        defaultVaultId: 'work',
        choices: ['work', 'global']
      }
    }
  });
  offerLocked(h);
  h.on.onVaultLockState({ setUp: true, unlocked: true });
  await settle();
  assert.equal(h.opens.at(-1).menuType, 'vault-capture');
  assert.deepEqual(h.toasts, [], 'the sheet IS the feedback — no toast on success');
});

// ---------------------------------------------------------------------------
// Vault indicator "Lock now" context menu (squawk 0038, GitHub #113 "Lock now"
// half — the pinnable half is DECLINED by operator ruling: no toolbarPins entry,
// no Settings change, the indicator itself never moves).
// ---------------------------------------------------------------------------

test('right-click on the vault indicator opens the toolbar-mode sheet via openToolbarContextMenu', () => {
  const indicator = fakeVaultIndicatorEl();
  const h = harness({ unlocked: true, vaultIndicatorEl: indicator });
  let prevented = false;
  indicator.fire('contextmenu', {
    preventDefault: () => {
      prevented = true;
    }
  });
  assert.ok(prevented, 'the native OS context menu is suppressed');
  assert.deepEqual(h.toolbarContextMenuCalls, [{ item: 'vault', anchorEl: indicator }]);
});

test('no vaultIndicator element (offline harness / not-yet-attached DOM) never throws wiring up', () => {
  assert.doesNotThrow(() => harness({ vaultIndicatorEl: null }));
});

test('isVaultLocked reflects the stashed lock-state broadcast, not a re-fetch', () => {
  const h = harness({ unlocked: false });
  assert.equal(h.controller.isVaultLocked(), true, 'locked before any broadcast (initial default)');
  h.on.onVaultLockState({ setUp: true, unlocked: true });
  assert.equal(h.controller.isVaultLocked(), false, 'unlocked after the broadcast');
  h.on.onVaultLockState({ setUp: true, unlocked: false });
  assert.equal(h.controller.isVaultLocked(), true, 'locked again after a re-lock broadcast');
});

test('lockNow() calls the existing explicit vault-lock bridge path (goldfinch.vaultLock)', () => {
  const h = harness({ unlocked: true });
  h.controller.lockNow();
  assert.deepEqual(h.vaultLockCalls, [true]);
});

test("a rejected lockNow() invoke never throws (fire-and-forget, like the vault page's own Lock now button)", async () => {
  const h = harness({ unlocked: true, vaultLockRejects: true });
  assert.doesNotThrow(() => h.controller.lockNow());
  await settle();
  assert.deepEqual(h.vaultLockCalls, [true], 'the bridge call was still made');
});
