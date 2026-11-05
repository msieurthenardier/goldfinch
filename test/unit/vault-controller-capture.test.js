'use strict';

// The chrome-side save-moment flow: the queue that presents offers in the CORNER SAVE PROMPT
// (Sortie 06 Leg 1, flight DD1/DD5/DD6/DD8 - rewritten from the retired `vault-capture` sheet
// tests, case by case), plus the INTERIM locked path.
//
// A form submit into a LOCKED vault holds the credential main-side. In Leg 1 the chrome still
// raises the master-password prompt (keep-focus opt-in: the SAME submit navigates the page and
// the loading guest pulls OS focus - which used to blur the sheet and drop the held credential).
// After a successful unlock the held record is finalized and the RESOLVED model - or, when there
// is nothing to save, a RESULT-ONLY model - is presented in the corner prompt. Leg 2 replaces the
// auto-raise with consent.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createVaultController } = require('../../src/renderer/chrome/vault-controller');
const { SAVE_PROMPT_CLOSE_REASONS } = require('../../src/shared/save-prompt-close-effects');

// Minimal fake DOM element for the vault-indicator contextmenu/click-wiring cases below:
// records the listener so a test can fire a synthetic event. classList/setAttribute are
// no-op stubs - renderVaultIndicator (driven by onVaultLockState) touches both.
function fakeVaultIndicatorEl(rect = { right: 900, width: 28 }) {
  /** @type {Record<string, Function>} */
  const listeners = {};
  return {
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
    fire(type, evt) {
      listeners[type] && listeners[type](evt);
    },
    getBoundingClientRect: () => rect,
    classList: { toggle() {} },
    setAttribute() {}
  };
}

function harness({
  unlocked = false,
  finalizeResult = null,
  // An optional PER-ID finalize resolver, for tests that need two different locked-mode
  // offers to finalize into two DIFFERENT models. Falls back to `finalizeResult` when omitted.
  finalizeFor = null,
  vaultIndicatorEl = null,
  vaultLockRejects = false,
  dismissThrows = false,
  containers = [],
  // savePromptOpen answer: an object, or (payload) => object. Default: presented.
  promptAnswer = { presented: true }
} = {}) {
  const opens = []; // overlay-menu opens (sheets)
  const prompts = []; // savePromptOpen payloads
  const anchors = []; // savePromptAnchor payloads
  const dismissed = [];
  const finalized = [];
  const toasts = [];
  const vaultLockCalls = [];
  const toolbarContextMenuCalls = [];
  const openVaultPageCalls = [];
  /** @type {Record<string, Function>} */
  const on = {};
  const state = { promptAnswer };
  const goldfinch = new Proxy(
    {
      getVaultLockState: () => Promise.resolve({ setUp: true, unlocked }),
      vaultCaptureDismiss: (id) => {
        if (dismissThrows) throw new Error('dismiss exploded');
        dismissed.push(id);
        return Promise.resolve();
      },
      vaultCaptureFinalize: (id) => {
        finalized.push(id);
        const result = finalizeFor ? finalizeFor(id) : finalizeResult;
        return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
      },
      savePromptOpen: (payload) => {
        prompts.push(payload);
        const a = typeof state.promptAnswer === 'function' ? state.promptAnswer(payload) : state.promptAnswer;
        return Promise.resolve(a);
      },
      savePromptAnchor: (payload) => anchors.push(payload),
      vaultLock: () => {
        vaultLockCalls.push(true);
        return vaultLockRejects ? Promise.reject(new Error('ipc gone')) : Promise.resolve({ ok: true });
      }
    },
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        // Every onVault* / onSavePrompt* subscription: record the callback under its name.
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
    jarsClient: { containers },
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
    prompts,
    anchors,
    dismissed,
    finalized,
    toasts,
    state,
    vaultLockCalls,
    toolbarContextMenuCalls,
    openVaultPageCalls
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

const SAVE_MODEL_A = {
  origin: 'https://a.example',
  username: 'a',
  mode: 'save',
  defaultVaultId: 'work',
  choices: ['work', 'global']
};
const SAVE_MODEL_B = {
  kind: 'card',
  origin: 'https://b.example',
  mode: 'save',
  defaultVaultId: 'work',
  choices: ['work']
};

// Fire an offer (main already gated it to the active tab, and now stamps `wcId`).
function offer(h, captureId, model, wcId = 7) {
  h.on.onVaultCaptureOffer({ captureId, model, wcId });
}
// Fire a locked-vault capture offer and return its captureId.
function offerLocked(h, captureId = 'abc123', wcId = 7) {
  offer(h, captureId, { origin: 'https://example.com', username: 'someone', mode: 'locked' }, wcId);
  return captureId;
}
// The prompt closed (main -> chrome `save-prompt-closed`), for the most recent open's token.
function promptClosed(h, reason, captureId) {
  const last = h.prompts[h.prompts.length - 1];
  h.on.onSavePromptClosed({ token: last.token, captureId: captureId || last.captureId, reason });
}

// ---------------------------------------------------------------------------
// The LOCKED path (Sortie 06 Leg 2): the offer presents in the corner with "Unlock & save"; the
// operator's consent (`save-prompt-closed` `unlock-requested`) queues it for the post-unlock drain
// and opens the unlock sheet in the next task. (These cases were the Leg 1 INTERIM-path tests -
// auto-raise at arrival - inverted and renamed, not deleted.)
// ---------------------------------------------------------------------------

const LOCKED_MODEL = {
  origin: 'https://example.com',
  username: 'someone',
  mode: 'locked',
  choices: ['work', 'global'],
  defaultVaultId: 'work'
};
function offerLockedModel(h, captureId = 'abc123', wcId = 7, model = LOCKED_MODEL) {
  offer(h, captureId, model, wcId);
  return captureId;
}
// The operator clicked "Unlock & save": main closes the shown prompt `unlock-requested`; the
// chrome opens the unlock sheet in the NEXT task (the `settle` flushes it).
async function consentLocked(h, captureId = 'abc123', wcId = 7) {
  offerLockedModel(h, captureId, wcId);
  await settle();
  promptClosed(h, 'unlock-requested', captureId);
  await settle();
  return captureId;
}

test('a LOCKED offer presents in the corner (locked model) and raises NO sheet - never openOverlayMenu(vault-unlock) on arrival', async () => {
  const h = harness({ unlocked: false });
  offerLockedModel(h);
  await settle();
  assert.deepEqual(h.opens, [], 'no unlock sheet on offer arrival (Variant B regression gate, unit level)');
  assert.equal(h.prompts.length, 1);
  assert.equal(h.prompts[0].model.mode, 'locked');
  assert.deepEqual(h.finalized, []);
});

test('AC6: `unlock-requested` populates pendingCaptureUnlock at CONSENT and opens the unlock sheet (keepFocus) in the NEXT task', async () => {
  const h = harness({ unlocked: false });
  offerLockedModel(h);
  await settle();
  promptClosed(h, 'unlock-requested');
  assert.deepEqual(h.opens, [], 'not synchronously: the prompt is hidden first (setTimeout 0)');
  await settle();
  assert.equal(h.opens.length, 1);
  assert.equal(h.opens[0].menuType, 'vault-unlock');
  assert.deepEqual(h.opens[0].opts, { keepFocus: true }, 'the sheet must survive the submit navigation blur');
  assert.deepEqual(h.dismissed, [], 'consent dismisses nothing');
});

test('AC6.4: no queued offer is presented in the setTimeout-0 gap after unlock-requested', async () => {
  const h = harness({ unlocked: true });
  h.on.onVaultLockState({ setUp: true, unlocked: false });
  offerLockedModel(h, 'cap1');
  await settle();
  offer(h, 'cap2', SAVE_MODEL_A, 7); // queued behind the shown locked prompt
  await settle();
  const before = h.prompts.length;
  promptClosed(h, 'unlock-requested', 'cap1');
  assert.equal(h.prompts.length, before, 'synchronously after the close: nothing presented');
  await Promise.resolve();
  assert.equal(h.prompts.length, before, 'still nothing in the gap');
});

test('AC6.3: if the vault is already unlocked by the time the next task runs, the sheet is skipped and the drain runs', async () => {
  const h = harness({ unlocked: false, finalizeResult: { reason: 'unchanged' } });
  offerLockedModel(h);
  await settle();
  promptClosed(h, 'unlock-requested');
  h.on.onVaultLockState({ setUp: true, unlocked: true }); // unlocked by another route in the gap
  await settle();
  assert.deepEqual(h.opens, [], 'no unlock sheet raised');
  assert.deepEqual(h.finalized, ['abc123']);
});

test('the unlock sheet still drops the consented credential when it is genuinely dismissed', async () => {
  const h = harness({ unlocked: false });
  await consentLocked(h);
  // Still locked -> the operator declined (Escape / Cancel / X / backdrop / app-switch).
  h.controller.handleClosed({ menuType: 'vault-unlock', reason: 'escape' });
  assert.deepEqual(h.dismissed, ['abc123']);
});

test('a successful unlock finalizes the consented capture instead of dropping it', async () => {
  const h = harness({ unlocked: false });
  await consentLocked(h);
  h.on.onVaultLockState({ setUp: true, unlocked: true });
  assert.deepEqual(h.finalized, ['abc123']);
  assert.deepEqual(h.dismissed, [], 'an unlocked capture is never dropped');
});

test('every unlock-sheet close that reaches the chrome while still locked drops the consented credential', async () => {
  // 'blur' and 'vault-lock' are SAFETY-NET pins rather than production-reachable paths for
  // vault-unlock (it is in the blur-survival allowlist and exempt from close-on-lock);
  // handleClosed is reason-agnostic by design, so both stay as defensive pins.
  for (const reason of ['escape', 'outside-click', 'blur', 'vault-lock', 'activated', 'tab-close', 'superseded']) {
    const h = harness({ unlocked: false });
    await consentLocked(h);
    h.controller.handleClosed({ menuType: 'vault-unlock', reason });
    assert.deepEqual(h.dismissed, ['abc123'], `reason '${reason}' must still drop the record`);
  }
});

test('AC8: after unlock the finalize result `saved` is presented as the `saved` result (label via the client)', async () => {
  const h = harness({
    unlocked: false,
    containers: [{ id: 'work', name: 'Work' }],
    finalizeResult: { captureId: 'abc123', saved: true, vaultId: 'work', kind: 'login' }
  });
  await consentLocked(h, 'abc123', 9);
  h.on.onVaultLockState({ setUp: true, unlocked: true });
  await settle();
  assert.equal(h.prompts.length, 2, 'the locked offer, then the saved result');
  assert.deepEqual(h.prompts[1].model, { result: 'saved', vaultLabel: 'Work', kind: 'login' });
  assert.equal(h.prompts[1].wcId, 9);
});

test('AC8: a returned MODEL after unlock (update / identity re-ask) is presented as an unlocked offer', async () => {
  const h = harness({
    unlocked: false,
    finalizeResult: { captureId: 'abc123', model: { ...SAVE_MODEL_A, mode: 'update' } }
  });
  await consentLocked(h, 'abc123', 9);
  h.on.onVaultLockState({ setUp: true, unlocked: true });
  await settle();
  assert.equal(h.prompts.length, 2);
  assert.equal(h.prompts[1].model.mode, 'update');
  assert.deepEqual(h.toasts, []);
});

test('AC8: each finalize reason with no model is presented as a RESULT state; `refused` presents nothing and drops the entry', async () => {
  for (const reason of ['unchanged', 'expired', 'tab-changed', 'locked']) {
    const h = harness({ unlocked: false, finalizeResult: { reason } });
    await consentLocked(h);
    h.on.onVaultLockState({ setUp: true, unlocked: true });
    await settle();
    assert.equal(h.prompts.length, 2, `reason '${reason}'`);
    assert.deepEqual(h.prompts[1].model, { result: reason });
    assert.deepEqual(h.toasts, [], 'the toast layer is invisible behind a guest - never used');
  }
  // an unrecognized/absent reason and a rejected invoke both speak as `error`
  for (const finalizeResult of [{}, new Error('ipc gone')]) {
    const h = harness({ unlocked: false, finalizeResult });
    await consentLocked(h);
    h.on.onVaultLockState({ setUp: true, unlocked: true });
    await settle();
    assert.deepEqual(h.prompts[1].model, { result: 'error' });
  }
  const h = harness({ unlocked: false, finalizeResult: { reason: 'refused' } });
  await consentLocked(h);
  h.on.onVaultLockState({ setUp: true, unlocked: true });
  await settle();
  assert.equal(h.prompts.length, 1, 'refused: nothing presented');
  assert.deepEqual(h.dismissed, ['abc123'], 'and the entry is dropped (vaultCaptureDismiss)');
});

test('AC21: if the unlock sheet is still visible the corner open is refused (sheet-open) and RETRIED when it closes', async () => {
  const h = harness({
    unlocked: false,
    finalizeResult: { captureId: 'abc123', model: SAVE_MODEL_A }
  });
  await consentLocked(h);
  h.state.promptAnswer = { presented: false, reason: 'sheet-open' };
  h.on.onVaultLockState({ setUp: true, unlocked: true });
  await settle();
  assert.equal(h.prompts.length, 2, 'first post-unlock attempt refused');
  // the unlock sheet closes ('activated'): handleClosed(ANY menuType) retries
  h.state.promptAnswer = { presented: true };
  h.controller.handleClosed({ menuType: 'vault-unlock', reason: 'activated' });
  await settle();
  assert.equal(h.prompts.length, 3, 'retried on the sheet close');
  assert.equal(h.prompts[2].captureId, 'abc123');
  assert.deepEqual(h.dismissed, [], 'a refused head is KEPT, not dropped');
});

test('AC8 (abandon): an abandoned unlock still drops EVERY consented pendingCaptureUnlock record', async () => {
  const h = harness({ unlocked: false });
  await consentLocked(h, 'cap1');
  await consentLocked(h, 'cap2');
  assert.equal(h.opens.length, 2);
  h.controller.handleClosed({ menuType: 'vault-unlock', reason: 'escape' });
  assert.deepEqual(h.dismissed.sort(), ['cap1', 'cap2']);
});

test('a finalize is never fired while the vault is still locked (handleClosed of an unrelated menu cannot flash "locked")', async () => {
  const h = harness({ unlocked: false, finalizeResult: { reason: 'locked' } });
  await consentLocked(h);
  h.controller.handleClosed({ menuType: 'kebab', reason: 'toggle' });
  await settle();
  assert.deepEqual(h.finalized, []);
  assert.equal(h.prompts.length, 1, 'only the locked offer itself was ever presented');
});

// ---------------------------------------------------------------------------
// A7 consented variant, convert-in-place (AC9), finalizing guard (AC7), active-tab discard
// ---------------------------------------------------------------------------

test('A7 edge: an expired consented entry for a tab that is no longer active is silently discarded (main answers not-active)', async () => {
  const h = harness({ unlocked: false });
  await consentLocked(h, 'abc123', 7);
  h.on.onVaultCaptureDropped({ captureId: 'abc123' }); // DD5: the tab was switched away
  h.state.promptAnswer = { presented: false, reason: 'not-active' };
  h.on.onVaultLockState({ setUp: true, unlocked: true });
  await settle();
  assert.equal(h.prompts.length, 2, 'the attempt was made');
  h.state.promptAnswer = { presented: true };
  h.controller.handleClosed({ menuType: 'kebab', reason: 'toggle' });
  await settle();
  assert.equal(h.prompts.length, 2, 'dropped, never retried or shown');
});

test('AC9: an unlock by ANY route converts the VISIBLE locked prompt in place (finalize once, head of queue, model-replace)', async () => {
  const h = harness({
    unlocked: false,
    finalizeResult: { captureId: 'abc123', model: { ...SAVE_MODEL_A, mode: 'save' } }
  });
  offerLockedModel(h);
  await settle();
  assert.equal(h.prompts.length, 1);
  h.on.onVaultLockState({ setUp: true, unlocked: true }); // no sheet involved
  await settle();
  assert.deepEqual(h.finalized, ['abc123'], 'finalized exactly once, without consent');
  assert.equal(h.prompts.length, 2, 'the converted model replaces the visible prompt');
  assert.equal(h.prompts[1].captureId, 'abc123');
  assert.equal(h.prompts[1].model.mode, 'save');
  // a repeat unlock broadcast does not finalize again
  h.on.onVaultLockState({ setUp: true, unlocked: true });
  await settle();
  assert.deepEqual(h.finalized, ['abc123']);
});

test('AC9.5: unlock via a SHEET - the lock-state push beats the sheet close: sheet-open keeps the head, retried on the close', async () => {
  const h = harness({
    unlocked: false,
    finalizeResult: { captureId: 'abc123', model: { ...SAVE_MODEL_A, mode: 'save' } }
  });
  offerLockedModel(h);
  await settle();
  h.state.promptAnswer = { presented: false, reason: 'sheet-open' };
  h.on.onVaultLockState({ setUp: true, unlocked: true });
  await settle();
  assert.equal(h.prompts.length, 2, 'attempted, refused');
  h.state.promptAnswer = { presented: true };
  h.controller.handleClosed({ menuType: 'vault-unlock', reason: 'activated' });
  await settle();
  assert.equal(h.prompts.length, 3);
  assert.equal(h.prompts[2].model.mode, 'save');
  assert.deepEqual(h.finalized, ['abc123'], 'still one finalize');
});

test('AC9: a QUEUED locked model is finalized first when advance() reaches it - a locked model is never presented while unlocked', async () => {
  const h = harness({
    unlocked: false,
    finalizeFor: (id) => ({ captureId: id, model: { ...SAVE_MODEL_B, mode: 'save' } })
  });
  offer(h, 'first', SAVE_MODEL_A, 7);
  await settle();
  offerLockedModel(h, 'second'); // queued behind the shown first offer
  await settle();
  h.on.onVaultLockState({ setUp: true, unlocked: true });
  promptClosed(h, 'saved', 'first');
  await settle();
  const second = h.prompts.filter((p) => p.captureId === 'second');
  assert.equal(second.length, 1);
  assert.notEqual(second[0].model.mode, 'locked');
  assert.deepEqual(h.finalized, ['second']);
});

test('AC9: the unlock may happen in ANOTHER window - window B converts its own visible locked prompt on the broadcast', async () => {
  const a = harness({ unlocked: false });
  const b = harness({
    unlocked: false,
    finalizeResult: { captureId: 'bcap', model: { ...SAVE_MODEL_A, mode: 'save' } }
  });
  offerLockedModel(b, 'bcap');
  await settle();
  // window A's unlock fires the broadcast to EVERY chrome
  for (const w of [a, b]) w.on.onVaultLockState({ setUp: true, unlocked: true });
  await settle();
  assert.deepEqual(b.finalized, ['bcap']);
  assert.equal(b.prompts.length, 2);
  assert.equal(b.prompts[1].model.mode, 'save');
  assert.deepEqual(a.finalized, []);
});

test('AC7: the chrome never issues two concurrent finalizes for one captureId', async () => {
  const calls = [];
  let release;
  const gate = new Promise((r) => (release = r));
  const h = harness({
    unlocked: false,
    finalizeFor: (id) => {
      calls.push(id);
      return gate;
    }
  });
  offerLockedModel(h);
  await settle();
  h.on.onVaultLockState({ setUp: true, unlocked: true }); // convert the visible prompt
  h.on.onVaultLockState({ setUp: true, unlocked: true }); // a second broadcast mid-flight
  await settle();
  assert.deepEqual(calls, ['abc123'], 'one finalize in flight');
  release({ captureId: 'abc123', model: SAVE_MODEL_A });
  await settle();
  assert.deepEqual(calls, ['abc123']);
});

test('AC1 (hardening): a throw inside the present chain resets `opening` - the queue never wedges', async () => {
  const h = harness({
    unlocked: true,
    dismissThrows: true,
    promptAnswer: (p) => (p.captureId === 'r1' ? { presented: false, reason: 'gone' } : { presented: true })
  });
  h.on.onVaultLockState({ setUp: true, unlocked: true });
  offer(h, 'r1', SAVE_MODEL_A, 7); // refused 'gone' -> dismissCapture throws inside the .then
  await settle();
  offer(h, 'r2', SAVE_MODEL_A, 7);
  await settle();
  assert.deepEqual(
    h.prompts.map((p) => p.captureId),
    ['r1', 'r2'],
    'the next offer still presents'
  );
});

// ---------------------------------------------------------------------------
// AC19: the queue on the prompt (DD6)
// ---------------------------------------------------------------------------

test('AC19: unlocked offers present ONE prompt at a time; the next only after the first closes; "1 of N" rides `queue` (N = offers still waiting incl. the head)', async () => {
  const h = harness({ unlocked: true });
  offer(h, 'cap1', SAVE_MODEL_A);
  offer(h, 'cap2', SAVE_MODEL_B);
  offer(h, 'cap3', SAVE_MODEL_A);
  await settle();
  assert.equal(h.prompts.length, 1, 'never a model-replace - the later offers wait their turn');
  assert.equal(h.prompts[0].captureId, 'cap1');
  assert.deepEqual(h.prompts[0].queue, { index: 1, total: 1 }, 'cap1 opened before its siblings arrived');

  promptClosed(h, 'saved');
  await settle();
  assert.equal(h.prompts.length, 2, 'closing the first presents the next queued offer');
  assert.equal(h.prompts[1].captureId, 'cap2');
  assert.deepEqual(h.prompts[1].queue, { index: 1, total: 2 }, 'cap2 + cap3 are waiting');
});

test('AC19: advance() is idempotent - an unrelated lock-state broadcast while a prompt is showing does nothing', async () => {
  const h = harness({ unlocked: true });
  offer(h, 'cap1', SAVE_MODEL_A);
  await settle();
  h.on.onVaultLockState({ setUp: true, unlocked: true });
  h.controller.handleClosed({ menuType: 'kebab', reason: 'toggle' });
  await settle();
  assert.equal(h.prompts.length, 1, 'no extra open fired');
});

test('AC19: advance() is single-flight while a savePromptOpen invoke is in flight', async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const h = harness({ unlocked: true, promptAnswer: () => gate });
  offer(h, 'cap1', SAVE_MODEL_A);
  offer(h, 'cap2', SAVE_MODEL_B);
  h.controller.handleClosed({ menuType: 'kebab', reason: 'toggle' });
  assert.equal(h.prompts.length, 1, 'only one open in flight');
  release({ presented: true });
  await settle();
  assert.equal(h.prompts.length, 1);
});

test('AC19 DD6 table: saved / dismissed / timeout / expired each ADVANCE to the next queued offer without a chrome dismiss', async () => {
  for (const reason of ['saved', 'dismissed', 'timeout', 'expired']) {
    const h = harness({ unlocked: true });
    offer(h, 'cap1', SAVE_MODEL_A);
    offer(h, 'cap2', SAVE_MODEL_B);
    await settle();
    promptClosed(h, reason);
    await settle();
    assert.equal(h.prompts.length, 2, `${reason}: advanced`);
    assert.deepEqual(
      h.dismissed,
      [],
      `${reason}: main already dealt with the shown capture (dismissShown runs main-side)`
    );
  }
});

test("AC19 DD6 table: tab-switch / tab-hide / tab-close / tab-moved drop that tab's queued entries (no dismiss calls) and advance to other tabs' offers", async () => {
  for (const reason of ['tab-switch', 'tab-hide', 'tab-close', 'tab-moved']) {
    const h = harness({ unlocked: true });
    offer(h, 'cap1', SAVE_MODEL_A, 7);
    offer(h, 'cap2', SAVE_MODEL_B, 7); // same tab: dropped
    offer(h, 'cap3', SAVE_MODEL_A, 8); // other tab: survives
    await settle();
    promptClosed(h, reason);
    await settle();
    assert.deepEqual(h.dismissed, [], `${reason}: main's dropCapturesForTab already dropped them`);
    assert.equal(h.prompts.length, 2, reason);
    assert.equal(h.prompts[1].captureId, 'cap3', `${reason}: the other tab's offer is next`);
  }
});

test('AC19 DD6 table: vault-lock and teardown CLEAR both queues (locked entries included) and present nothing', async () => {
  for (const reason of ['vault-lock', 'teardown']) {
    const h = harness({ unlocked: true });
    offer(h, 'cap1', SAVE_MODEL_A);
    offer(h, 'cap2', SAVE_MODEL_B);
    await settle();
    promptClosed(h, reason);
    await settle();
    assert.equal(h.prompts.length, 1, `${reason}: nothing re-opens`);
    // prove the queue is genuinely empty: an unrelated later broadcast resurrects nothing
    h.on.onVaultLockState({ setUp: true, unlocked: true });
    h.controller.handleClosed({ menuType: 'kebab', reason: 'toggle' });
    await settle();
    assert.equal(h.prompts.length, 1, `${reason}: still nothing`);
  }
});

test('AC19: an UNKNOWN close reason is treated as `dismissed` (advance), and a stale-token close is ignored', async () => {
  const h = harness({ unlocked: true });
  offer(h, 'cap1', SAVE_MODEL_A);
  offer(h, 'cap2', SAVE_MODEL_B);
  await settle();
  h.on.onSavePromptClosed({ token: h.prompts[0].token + 999, captureId: 'cap1', reason: 'saved' });
  await settle();
  assert.equal(h.prompts.length, 1, 'stale token ignored');
  promptClosed(h, 'some-future-reason');
  await settle();
  assert.equal(h.prompts.length, 2, 'unknown reason advanced like `dismissed`');
  assert.ok(!SAVE_PROMPT_CLOSE_REASONS.has('some-future-reason'));
});

test('AC19 deferral: a head refused for `sheet-open` stays at the HEAD and retries on ANY menuType close', async () => {
  const h = harness({ unlocked: true, promptAnswer: { presented: false, reason: 'sheet-open' } });
  offer(h, 'cap1', SAVE_MODEL_A);
  await settle();
  assert.equal(h.prompts.length, 1);
  assert.deepEqual(h.dismissed, []);
  h.state.promptAnswer = { presented: true };
  h.controller.handleClosed({ menuType: 'suggestions', reason: 'blur' }); // an address-bar dropdown closing
  await settle();
  assert.equal(h.prompts.length, 2, 'retried');
  assert.equal(h.prompts[1].captureId, 'cap1');
});

test('AC19/AC17: `not-active`, `fullscreen` and `gone` DROP the head (dismiss + advance); `invalid-model` too', async () => {
  for (const reason of ['not-active', 'fullscreen', 'gone', 'invalid-model']) {
    const h = harness({
      unlocked: true,
      promptAnswer: (p) => (p.captureId === 'cap1' ? { presented: false, reason } : { presented: true })
    });
    offer(h, 'cap1', SAVE_MODEL_A);
    offer(h, 'cap2', SAVE_MODEL_B);
    await settle();
    assert.deepEqual(h.dismissed, ['cap1'], `${reason}: head dropped via vaultCaptureDismiss`);
    assert.equal(h.prompts.length, 2, `${reason}: advanced to the next`);
    assert.equal(h.prompts[1].captureId, 'cap2');
  }
});

test('AC19: a rejected savePromptOpen invoke drops the head like `gone` (never wedges the queue)', async () => {
  const h = harness({
    unlocked: true,
    promptAnswer: () => {
      throw new Error('ipc gone');
    }
  });
  offer(h, 'cap1', SAVE_MODEL_A);
  await settle();
  assert.deepEqual(h.dismissed, ['cap1']);
});

test('AC14: `vault-capture-dropped` removes the id from BOTH queues; an unknown id is a no-op', async () => {
  const h = harness({ unlocked: true });
  offer(h, 'cap1', SAVE_MODEL_A);
  offer(h, 'cap2', SAVE_MODEL_B);
  offer(h, 'cap3', SAVE_MODEL_A);
  await settle();
  h.on.onVaultCaptureDropped({ captureId: 'cap2' });
  h.on.onVaultCaptureDropped({ captureId: 'nope' });
  h.on.onVaultCaptureDropped({});
  promptClosed(h, 'saved');
  await settle();
  assert.equal(h.prompts[1].captureId, 'cap3', 'cap2 was forgotten');
  // locked queue entries are forgotten too
  const h2 = harness({ unlocked: false });
  offerLocked(h2, 'lock1');
  h2.on.onVaultCaptureDropped({ captureId: 'lock1' });
  h2.on.onVaultLockState({ setUp: true, unlocked: true });
  assert.deepEqual(h2.finalized, [], 'a dropped locked entry is never finalized');
});

test('regression (sheet-era wedge): an unrelated menu opening/closing around a visible prompt never wedges future presentation', async () => {
  const h = harness({ unlocked: true });
  offer(h, 'cap1', SAVE_MODEL_A);
  await settle();
  // sheet-era 'superseded' closes cannot reach the prompt (its own channel); the prompt closes by its own reason
  h.controller.handleClosed({ menuType: 'vault-capture', reason: 'superseded' });
  promptClosed(h, 'dismissed');
  offer(h, 'cap2', SAVE_MODEL_B);
  await settle();
  assert.equal(h.prompts.length, 2);
  assert.equal(h.prompts[1].captureId, 'cap2');
});

// ---------------------------------------------------------------------------
// AC20: vault choice labels
// ---------------------------------------------------------------------------

test('AC20: choices map to { vaultId, label }; a deleted jar becomes a DISABLED "Unknown vault"; update mode carries vaultLabel', async () => {
  const h = harness({ unlocked: true, containers: [{ id: 'work', name: 'Work' }] });
  offer(h, 'cap1', { ...SAVE_MODEL_A, choices: ['work', 'global', 'gone-jar'] });
  await settle();
  assert.deepEqual(h.prompts[0].model.choices, [
    { vaultId: 'work', label: 'Work' },
    { vaultId: 'global', label: 'Global' },
    { vaultId: 'gone-jar', label: 'Unknown vault', disabled: true }
  ]);
  const h2 = harness({ unlocked: true, containers: [{ id: 'work', name: 'Work' }] });
  offer(h2, 'cap1', {
    origin: 'https://a.example',
    username: 'a',
    mode: 'update',
    defaultVaultId: 'work',
    choices: []
  });
  await settle();
  assert.equal(h2.prompts[0].model.vaultLabel, 'Work');
});

test('AC11: the anchor is measured from #vault-indicator (CSS px right edge) and sent with the open; re-sent on resize/observer while presented', async () => {
  const indicator = fakeVaultIndicatorEl({ right: 840, width: 28 });
  const h = harness({ unlocked: true, vaultIndicatorEl: indicator });
  offer(h, 'cap1', SAVE_MODEL_A);
  await settle();
  assert.equal(h.prompts[0].anchor, 840);
  // a hidden indicator (pin-toggle: width 0) yields a null anchor
  const hidden = fakeVaultIndicatorEl({ right: 0, width: 0 });
  const h2 = harness({ unlocked: true, vaultIndicatorEl: hidden });
  offer(h2, 'cap1', SAVE_MODEL_A);
  await settle();
  assert.equal(h2.prompts[0].anchor, null);
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
// unlockNow() / indicatorAction() (Flight 4 Leg 5 HAT fix): the locked toolbar
// right-click menu used to OMIT its one item entirely (an empty dropdown); the
// operator ruling replaces it with a single "Unlock now" item that shares the
// left-click's locked body exactly — no pendingVaultFlow, so a successful
// unlock never springs the fill picker.
// ---------------------------------------------------------------------------

test('unlockNow() raises the unlock sheet exactly once and does not set pendingVaultFlow', () => {
  const h = harness({ unlocked: false });
  h.on.onVaultLockState({ setUp: true, unlocked: false });
  h.controller.unlockNow();
  assert.equal(h.opens.length, 1);
  assert.deepEqual(h.opens[0], { menuType: 'vault-unlock', model: [], opts: undefined });

  // pendingVaultFlow must be unset: a subsequent unlock broadcast must NOT spring the
  // fill picker (same assertion as the left-click test above).
  h.on.onVaultLockState({ setUp: true, unlocked: true });
  assert.equal(h.opens.length, 1, 'unlock success must open no additional sheet (no picker)');
});

test('unlockNow() when not set up does nothing (defense in depth)', () => {
  const h = harness({ unlocked: false });
  h.on.onVaultLockState({ setUp: false, unlocked: false });
  h.controller.unlockNow();
  assert.equal(h.opens.length, 0);
});

test("indicatorAction('lock') routes to lockNow()", () => {
  const h = harness({ unlocked: true });
  h.controller.indicatorAction('lock');
  assert.deepEqual(h.vaultLockCalls, [true]);
  assert.equal(h.opens.length, 0);
});

test("indicatorAction('unlock') routes to unlockNow()", () => {
  const h = harness({ unlocked: false });
  h.on.onVaultLockState({ setUp: true, unlocked: false });
  h.controller.indicatorAction('unlock');
  assert.equal(h.opens.length, 1);
  assert.deepEqual(h.opens[0], { menuType: 'vault-unlock', model: [], opts: undefined });
  assert.deepEqual(h.vaultLockCalls, []);
});

test('indicatorAction() ignores any action other than lock/unlock (validated no-op)', () => {
  const h = harness({ unlocked: false });
  h.on.onVaultLockState({ setUp: true, unlocked: false });
  h.controller.indicatorAction('bogus');
  h.controller.indicatorAction(undefined);
  assert.equal(h.opens.length, 0);
  assert.deepEqual(h.vaultLockCalls, []);
});
