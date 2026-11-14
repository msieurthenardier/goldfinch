'use strict';

// Test helper (Mission 23 Flight 1, leg `vault-fill-trust`): `createVaultHuman` whose three
// context-requiring ops (`reachableItems`, `fillHuman`, `fillGenerated`) mint a FRESH picker context at the
// tab's current committed origin before each call. The legacy fill suites test the gates DOWNSTREAM of the
// context (lock, burner, jar scope, origin match, type dispatch, delegates); the context gate itself, the
// origin-equality-at-fill check per type, and the lifecycle are pinned in `vault-picker-context.test.js`
// and `vault-human-context.test.js`, which pass explicit ids. A tab with no committed origin (a closed
// tab) gets a placeholder-origin context, so its fill is refused by the origin check, as in production.

const { createVaultHuman } = require('../../src/main/vault/vault-human');
const { committedOriginOf } = require('../../src/main/vault/committed-origin');

/** @param {any} deps  the usual `createVaultHuman` deps (must include `fromId`) */
function createAutoContextHuman(deps) {
  const human = createVaultHuman(deps);
  /** @param {number} wcId */
  const mint = (wcId) => {
    const wc = deps.fromId(wcId);
    const origin = wc ? committedOriginOf(wc.getURL()) : null;
    return human.mintContext({ wcId, origin: origin || 'https://no-origin.invalid', certOverride: false }).id;
  };
  return {
    ...human,
    reachableItems: (/** @type {number} */ wcId) => human.reachableItems(wcId, mint(wcId)),
    // Leg `vault-picker-controls`: a card / identity on a site it was never confirmed for answers
    // `confirm-needed` first. The legacy suites test the gates DOWNSTREAM of that rule, so the helper plays the
    // chrome's confirmation view: on `confirm-needed` it repeats the call with `confirm: true` on the SAME
    // context. The rule itself is pinned in `vault-human-confirm.test.js` with explicit calls.
    fillHuman: (/** @type {any} */ sel) => {
      const contextId = mint(sel.wcId);
      const first = human.fillHuman({ ...sel, contextId });
      return first.reason === 'confirm-needed' ? human.fillHuman({ ...sel, contextId, confirm: true }) : first;
    },
    fillGenerated: (/** @type {any} */ arg) => human.fillGenerated({ ...arg, contextId: mint(arg.wcId) })
  };
}

module.exports = { createAutoContextHuman };
