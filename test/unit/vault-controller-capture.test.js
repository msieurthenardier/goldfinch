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

// Minimal fake DOM element for the vault-indicator contextmenu/click-wiring cases below:
// records the listener so a test can fire a synthetic event. classList/setAttribute are
// no-op stubs — renderVaultIndicator (driven by onVaultLockState) touches both.
function fakeVaultIndicatorEl() {
  /** @type {Record<string, Function>} */
  const listeners = {};
  return {
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
    fire(type, evt) {
      listeners[type] && listeners[type](evt);
    },
    classList: { toggle() {} },
    setAttribute() {}
  };
}

function harness({
  unlocked = false,
  finalizeResult = null,
  // M21 F3 L2 (multi-hold): an optional PER-ID finalize resolver, for tests that need
  // two different locked-mode offers to finalize into two DIFFERENT models (AC6/AC7).
  // Falls back to the single shared `finalizeResult` when omitted — every pre-existing
  // test keeps working unchanged.
  finalizeFor = null,
  vaultIndicatorEl = null,
  vaultLockRejects = false
} = {}) {
  const opens = [];
  const dismissed = [];
  const finalized = [];
  const toasts = [];
  const vaultLockCalls = [];
  const toolbarContextMenuCalls = [];
  const openVaultPageCalls = [];
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
        const result = finalizeFor ? finalizeFor(id) : finalizeResult;
        return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
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
    openVaultPage: () => openVaultPageCalls.push(true),
    openToolbarContextMenu: (item, anchorEl) => toolbarContextMenuCalls.push({ item, anchorEl }),
    openOverlayMenu: (menuType, model, anchor, startIndex, opts) => {
      opens.push({ menuType, model, opts });
      return true;
    },
    toast: (title, body) => toasts.push([title, body])
  });
  return {
    controller,
    on,
    opens,
    dismissed,
    finalized,
    toasts,
    vaultLockCalls,
    toolbarContextMenuCalls,
    openVaultPageCalls
  };
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
  //
  // M18 F3 L1 (DD8), rename-not-silent-edit: 'blur' and 'vault-lock' are now SAFETY-NET
  // pins rather than production-reachable paths for vault-unlock specifically —
  // vault-unlock is IN the blur-survival allowlist (main's closeMenuOverlay ignores
  // reason 'blur' for it, so the sheet's own close handler here never sees it fire in
  // production) and is EXEMPT from the new close-on-lock reason (locking is its
  // precondition, not its invalidation, so main never sends 'vault-lock' for it either).
  // handleClosed itself is reason-agnostic by design, so both assertions stay as
  // defensive pins against a future regression re-wiring either path, rather than being
  // silently dropped.
  for (const reason of ['escape', 'outside-click', 'blur', 'vault-lock', 'activated', 'tab-close', 'superseded']) {
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

// ---------------------------------------------------------------------------
// Vault indicator left-click (squawk 0099, flight DD10).
// ---------------------------------------------------------------------------

test('left-click while locked raises the unlock sheet exactly once and does not set pendingVaultFlow', () => {
  const indicator = fakeVaultIndicatorEl();
  const h = harness({ unlocked: false, vaultIndicatorEl: indicator });
  h.on.onVaultLockState({ setUp: true, unlocked: false });
  indicator.fire('click');
  assert.equal(h.opens.length, 1);
  assert.deepEqual(h.opens[0], { menuType: 'vault-unlock', model: [], opts: undefined });
  assert.equal(h.openVaultPageCalls.length, 0);

  // pendingVaultFlow must be unset: a subsequent unlock broadcast must NOT spring the
  // fill picker (the onVaultRequestUnlock shape, not onVaultGesture's locked branch).
  h.on.onVaultLockState({ setUp: true, unlocked: true });
  assert.equal(h.opens.length, 1, 'unlock success must open no additional sheet (no picker)');
});

test('left-click while unlocked opens the vault page exactly once and opens no sheet', () => {
  const indicator = fakeVaultIndicatorEl();
  const h = harness({ unlocked: true, vaultIndicatorEl: indicator });
  h.on.onVaultLockState({ setUp: true, unlocked: true });
  indicator.fire('click');
  assert.equal(h.openVaultPageCalls.length, 1);
  assert.equal(h.opens.length, 0);
});

test('left-click when not set up does nothing (defense in depth; the indicator is hidden then)', () => {
  const indicator = fakeVaultIndicatorEl();
  const h = harness({ unlocked: false, vaultIndicatorEl: indicator });
  h.on.onVaultLockState({ setUp: false, unlocked: false });
  indicator.fire('click');
  assert.equal(h.opens.length, 0);
  assert.equal(h.openVaultPageCalls.length, 0);
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

// ---------------------------------------------------------------------------
// Multi-hold (M21 F3 L2, DD1 + its amendment): the chrome-side presentation
// queue (already-unlocked offers) and the locked-mode pending-unlock drain.
// ---------------------------------------------------------------------------

const SAVE_MODEL_A = {
  origin: 'https://a.example',
  username: 'a',
  mode: 'save',
  defaultVaultId: 'work',
  choices: ['work']
};
const SAVE_MODEL_B = {
  kind: 'card',
  origin: 'https://b.example',
  mode: 'save',
  defaultVaultId: 'work',
  choices: ['work']
};

test('AC5: two already-unlocked offers open exactly one sheet; the second opens only after the first closes', () => {
  const h = harness({ unlocked: true });
  h.on.onVaultCaptureOffer({ captureId: 'cap1', model: SAVE_MODEL_A });
  h.on.onVaultCaptureOffer({ captureId: 'cap2', model: SAVE_MODEL_B });
  assert.equal(h.opens.length, 1, 'AC5: never a model-replace — the second offer waits its turn');
  assert.equal(h.opens[0].model.captureId, 'cap1');

  h.controller.handleClosed({ menuType: 'vault-capture', reason: 'escape' });
  assert.equal(h.opens.length, 2, 'AC9: closing the first presents the next queued offer');
  assert.equal(h.opens[1].model.captureId, 'cap2');
});

test('AC5b: advance() is idempotent — an unrelated onVaultLockState broadcast while a sheet is open (nothing queued) is a harmless no-op', () => {
  const h = harness({ unlocked: true });
  h.on.onVaultCaptureOffer({ captureId: 'cap1', model: SAVE_MODEL_A });
  assert.equal(h.opens.length, 1);
  // A duplicate / unrelated lock-state re-broadcast (recovery/admin unlock, or another
  // tab) with nothing queued in pendingCaptureUnlock must never double-open — safety
  // comes from advance()'s internal sheetOpen guard, not from restricting callers.
  h.on.onVaultLockState({ setUp: true, unlocked: true });
  assert.equal(h.opens.length, 1, 'no extra open fired');
});

test('AC5c: every OCCLUSION-class close reason (blur / tab-hide / tab-switch) drops the WHOLE queue and never advances', () => {
  for (const reason of ['blur', 'tab-hide', 'tab-switch']) {
    const h = harness({ unlocked: true });
    h.on.onVaultCaptureOffer({ captureId: 'cap1', model: SAVE_MODEL_A });
    h.on.onVaultCaptureOffer({ captureId: 'cap2', model: SAVE_MODEL_B });
    h.controller.handleClosed({ menuType: 'vault-capture', reason });
    assert.deepEqual(h.dismissed, ['cap1', 'cap2'], `reason '${reason}': AC5d — both captureIds dismissed`);
    assert.equal(h.opens.length, 1, `reason '${reason}': AC5c — an occlusion-class close never advances`);
  }
});

test('AC5c: every RESOLUTION-class close reason (escape / outside-click / tab-close) dismisses only the shown offer and presents the next', () => {
  for (const reason of ['escape', 'outside-click', 'tab-close']) {
    const h = harness({ unlocked: true });
    h.on.onVaultCaptureOffer({ captureId: 'cap1', model: SAVE_MODEL_A });
    h.on.onVaultCaptureOffer({ captureId: 'cap2', model: SAVE_MODEL_B });
    h.controller.handleClosed({ menuType: 'vault-capture', reason });
    assert.deepEqual(h.dismissed, ['cap1'], `reason '${reason}': only the offer that WAS showing is dismissed`);
    assert.equal(h.opens.length, 2, `reason '${reason}': the next queued offer presents`);
    assert.equal(h.opens[1].model.captureId, 'cap2');
  }
});

test('AC9: an "activated" close (a successful save) skips the dismiss (main already dropped the record) but still presents the next queued offer', () => {
  const h = harness({ unlocked: true });
  h.on.onVaultCaptureOffer({ captureId: 'cap1', model: SAVE_MODEL_A });
  h.on.onVaultCaptureOffer({ captureId: 'cap2', model: SAVE_MODEL_B });
  h.controller.handleClosed({ menuType: 'vault-capture', reason: 'activated' });
  assert.deepEqual(h.dismissed, [], 'a save already dropped the record main-side — no dismiss invoke');
  assert.equal(h.opens.length, 2, 'the next queued offer still presents');
  assert.equal(h.opens[1].model.captureId, 'cap2');
});

test('AC5d: a blur with two offers queued dismisses both captureIds and leaves the queue empty — nothing re-opens later', () => {
  const h = harness({ unlocked: true });
  h.on.onVaultCaptureOffer({ captureId: 'cap1', model: SAVE_MODEL_A });
  h.on.onVaultCaptureOffer({ captureId: 'cap2', model: SAVE_MODEL_B });
  h.controller.handleClosed({ menuType: 'vault-capture', reason: 'blur' });
  assert.deepEqual(h.dismissed, ['cap1', 'cap2']);
  assert.equal(h.opens.length, 1, 'nothing re-opens after the drop');
  // Prove the queue is genuinely EMPTY, not merely un-advanced: an unrelated later
  // lock-state broadcast must not resurrect anything.
  h.on.onVaultLockState({ setUp: true, unlocked: true });
  assert.equal(h.opens.length, 1, 'still nothing re-opens later');
});

test('AC6: two LOCKED-mode offers, one unlock, both reach a sheet — serially, each finalizing/resolving before the next is finalized', async () => {
  const h = harness({
    unlocked: false,
    finalizeFor: (id) =>
      id === 'cap1' ? { captureId: 'cap1', model: SAVE_MODEL_A } : { captureId: 'cap2', model: SAVE_MODEL_B }
  });
  offerLocked(h, 'cap1');
  offerLocked(h, 'cap2');
  assert.equal(h.opens.length, 1, 'AC7: the unlock prompt opens ONCE per drain, not once per offer');

  h.on.onVaultLockState({ setUp: true, unlocked: true });
  await settle();
  assert.equal(h.opens.length, 2, 'the FIRST locked offer reached a save sheet');
  assert.equal(h.opens[1].menuType, 'vault-capture');
  assert.equal(h.opens[1].model.captureId, 'cap1');
  assert.deepEqual(h.finalized, ['cap1'], 'the SECOND locked offer is not finalized until the first sheet closes');

  h.controller.handleClosed({ menuType: 'vault-capture', reason: 'activated' });
  await settle();
  assert.equal(h.opens.length, 3, 'the SECOND locked offer ALSO reached a sheet');
  assert.equal(h.opens[2].menuType, 'vault-capture');
  assert.equal(h.opens[2].model.captureId, 'cap2');
  assert.deepEqual(h.finalized, ['cap1', 'cap2']);
});

test('AC7: the unlock prompt opens exactly once for two locked-mode offers (asserted via the open COUNT)', () => {
  const h = harness({ unlocked: false });
  offerLocked(h, 'cap1');
  offerLocked(h, 'cap2');
  const unlockOpens = h.opens.filter((o) => o.menuType === 'vault-unlock');
  assert.equal(unlockOpens.length, 1);
});

test('AC8: an abandoned unlock drops EVERY queued locked-mode record, not just the one that opened the prompt', () => {
  const h = harness({ unlocked: false });
  offerLocked(h, 'cap1');
  offerLocked(h, 'cap2');
  assert.equal(h.opens.length, 1, 'still just the one unlock prompt (AC7)');
  h.controller.handleClosed({ menuType: 'vault-unlock', reason: 'escape' });
  assert.deepEqual(h.dismissed, ['cap1', 'cap2']);
});

// ---------------------------------------------------------------------------
// Post-landing fix (Leg 2 defect, Flight Director-classified in-scope): a
// 'superseded' close of vault-capture (an UNRELATED menu — kebab, suggestions,
// address-bar — taking over while a save-password sheet is open) used to be
// carved out of the whole close-handling block, leaving `sheetOpen` stuck
// `true` forever and every future offer permanently queued with nothing to
// advance it. Under this leg's OWN serial design (openCaptureSheet has exactly
// one caller, advance(), which no-ops while sheetOpen is true) a vault-capture
// sheet can never model-replace another vault-capture sheet — so 'superseded'
// reaching this branch can ONLY mean an unrelated menu took over, i.e. it is
// occlusion-class, exactly where OCCLUSION_CLOSE_REASONS already puts it.
// ---------------------------------------------------------------------------

test('regression: a "superseded" close of vault-capture (an unrelated menu taking over) drops the shown record, dismisses the queue, and does NOT wedge future presentation', () => {
  const h = harness({ unlocked: true });
  h.on.onVaultCaptureOffer({ captureId: 'cap1', model: SAVE_MODEL_A });
  assert.equal(h.opens.length, 1, 'the first offer opened a sheet');

  // An unrelated menu (kebab, suggestions, …) supersedes the open vault-capture sheet.
  h.controller.handleClosed({ menuType: 'vault-capture', reason: 'superseded' });
  assert.deepEqual(h.dismissed, ['cap1'], 'the shown record is dismissed, not left held');

  // A brand-new offer arriving afterward MUST still be able to present — this is the
  // bug: with sheetOpen stuck true, advance() would refuse forever.
  h.on.onVaultCaptureOffer({ captureId: 'cap2', model: SAVE_MODEL_B });
  assert.equal(h.opens.length, 2, 'a later offer must still be able to open a sheet');
  assert.equal(h.opens[1].menuType, 'vault-capture');
  assert.equal(h.opens[1].model.captureId, 'cap2');
});

test('a "superseded" close of vault-capture dismisses the displayed record AND every queued offer, opening nothing', () => {
  const h = harness({ unlocked: true });
  h.on.onVaultCaptureOffer({ captureId: 'cap1', model: SAVE_MODEL_A });
  h.on.onVaultCaptureOffer({ captureId: 'cap2', model: SAVE_MODEL_B });
  assert.equal(h.opens.length, 1, 'AC5: the second offer queues rather than opening');

  h.controller.handleClosed({ menuType: 'vault-capture', reason: 'superseded' });
  assert.deepEqual(h.dismissed, ['cap1', 'cap2'], 'the shown record AND the queued sibling are both dismissed');
  assert.equal(h.opens.length, 1, 'nothing opens over the menu that just took over');

  // Prove the queue is genuinely empty, not merely un-advanced: an unrelated later
  // lock-state broadcast must not resurrect anything.
  h.on.onVaultLockState({ setUp: true, unlocked: true });
  assert.equal(h.opens.length, 1, 'still nothing re-opens later');
});

test('invariant: while a vault-capture sheet is open, a further offer is QUEUED, never opened — openOverlayMenu("vault-capture", …) fires at most once until a close', () => {
  const h = harness({ unlocked: true });
  h.on.onVaultCaptureOffer({ captureId: 'cap1', model: SAVE_MODEL_A });
  h.on.onVaultCaptureOffer({ captureId: 'cap2', model: SAVE_MODEL_B });
  const captureOpens = () => h.opens.filter((o) => o.menuType === 'vault-capture');
  assert.equal(captureOpens().length, 1, 'the second offer must not open a second vault-capture sheet');

  h.controller.handleClosed({ menuType: 'vault-capture', reason: 'superseded' });
  assert.equal(captureOpens().length, 1, 'a superseded close still opens nothing new');

  // Once the queue is genuinely empty (dismissed above) and sheetOpen is reset, a
  // fresh offer is free to open its own sheet — proving the guard is a serialization
  // invariant, not a permanent lock.
  h.on.onVaultCaptureOffer({ captureId: 'cap3', model: SAVE_MODEL_A });
  assert.equal(captureOpens().length, 2, 'a fresh offer after the close can open its own sheet');
});
