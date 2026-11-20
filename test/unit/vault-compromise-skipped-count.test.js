'use strict';

// Squawk 0229: a compromise rotation that skipped vaults (squawk 0191) tells the operator
// HOW MANY were left under the old master key, on the recovery-show card. Only a count
// crosses main: vault ids and reason codes stay in the store's log. Pins each hop:
// compromiseRotateReply (main.js's delegate result), both sheet handlers (stash + the
// recovery-show push), the pending-reveal store and its resurface, the card line, and the
// menu-overlay.js render wiring (a source scan, because the sheet script is not loadable).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { withOverlaySenderLookup } = require('../helpers/fake-overlay-registry');
const { makeTestGate } = require('../helpers/ipc-gate-fixture');
const { registerOverlayIpc } = require('../../src/main/register-overlay-ipc');
const { compromiseRotateReply } = require('../../src/main/vault/vault-sheet-errors');
const { createSuppressionHolder } = require('../../src/main/vault/autolock-suppression');
const { createCompromiseRevealStore } = require('../../src/main/vault/pending-compromise-reveals');
const { resurfaceCompromiseReveal } = require('../../src/main/vault/resurface-compromise-reveal');
const { createDocument } = require('./helpers/jars-page-dom');
const { buildVaultRecoveryCard, skippedVaultsLine } = require('../../src/shared/vault-recovery-template.js');

const STORE_RES = {
  recoveryKey: 'KEY-1',
  revoked: { admin: false, vaultIds: [] },
  skipped: [
    { id: 'secret-vault-id', reason: 'unreadable-format' },
    { id: 'other-vault-id', reason: 'no-unwrap' }
  ]
};

test('compromiseRotateReply reduces skipped to a count: no ids, no reasons', () => {
  const reply = compromiseRotateReply(STORE_RES);
  assert.equal(reply.skippedCount, 2);
  assert.equal(reply.ok, true);
  assert.equal(reply.recoveryKey, 'KEY-1');
  assert.equal('skipped' in reply, false);
  const text = JSON.stringify(reply);
  assert.ok(!text.includes('secret-vault-id') && !text.includes('unreadable-format'));
  assert.equal(compromiseRotateReply({ recoveryKey: 'K', revoked: null }).skippedCount, 0);
  assert.equal(compromiseRotateReply({ recoveryKey: 'K', revoked: null, skipped: [] }).skippedCount, 0);
});

function harness(reply, menuType) {
  const handlers = new Map();
  const ipcMain = { on: () => {}, handle: (ch, fn) => handlers.set(ch, fn) };
  const sheetSender = { isDestroyed: () => false };
  const win = { id: 1, isDestroyed: () => false };
  const sheet = {
    getView: () => ({ webContents: sheetSender }),
    getCurrentMenu: () => ({ token: 7, menuType }),
    closeMenuOverlay: () => {}
  };
  const rec = { sheet, win };
  const registry = withOverlaySenderLookup({ records: () => [rec], getWindowForChrome: () => null });
  const sent = [];
  const stashed = [];
  registerOverlayIpc({
    gate: makeTestGate({ ipcMain, registry, autoFrame: true }),
    registry,
    chromeForAttachment: (w) => (w === win ? { id: 100, send: (ch, p) => sent.push([ch, p]) } : null),
    chromeForTab: () => null,
    sanitizeActivatedValue: () => undefined,
    vaultCompromiseRotate: async () => reply,
    stashCompromiseReveal: (chromeId, reveal) => stashed.push(reveal),
    ackVaultReveal: () => true
  });
  return { handlers, sheetSender, sent, stashed };
}

const CASES = [
  [
    'menu-overlay:vault-compromise',
    'vault-compromise',
    () => ({ oldSecret: new Uint8Array([1]), newSecret: new Uint8Array([2]) })
  ],
  [
    'menu-overlay:vault-compromise-recover',
    'vault-compromise-recover',
    () => ({ recoverySecret: new Uint8Array([1]), newSecret: new Uint8Array([2]) })
  ]
];

for (const [channel, menuType, secrets] of CASES) {
  test(`${channel}: the count rides the stash and the recovery-show push; no ids`, async () => {
    const h = harness(compromiseRotateReply(STORE_RES), menuType);
    const out = await h.handlers.get(channel)({ sender: h.sheetSender }, { token: 7, ...secrets() });
    assert.deepEqual(out, { ok: true }, 'the invoke reply is unchanged');
    assert.equal(h.stashed[0].skippedCount, 2);
    assert.deepEqual(h.sent, [['vault-recovery-show', { recoveryKey: 'KEY-1', replacing: true, skippedCount: 2 }]]);
    assert.ok(!JSON.stringify([h.sent, h.stashed]).includes('secret-vault-id'));
  });

  test(`${channel}: zero skipped leaves the push exactly as before`, async () => {
    const h = harness(compromiseRotateReply({ recoveryKey: 'KEY-1', revoked: null, skipped: [] }), menuType);
    await h.handlers.get(channel)({ sender: h.sheetSender }, { token: 7, ...secrets() });
    assert.deepEqual(h.sent, [['vault-recovery-show', { recoveryKey: 'KEY-1', replacing: true }]]);
  });

  test(`${channel}: a non-integer count from the delegate is dropped`, async () => {
    const h = harness({ ok: true, recoveryKey: 'KEY-1', revoked: null, skippedCount: '3' }, menuType);
    await h.handlers.get(channel)({ sender: h.sheetSender }, { token: 7, ...secrets() });
    assert.deepEqual(h.sent, [['vault-recovery-show', { recoveryKey: 'KEY-1', replacing: true }]]);
  });
}

test('the pending-reveal store keeps the count and resurface re-sends it', () => {
  const reveals = createCompromiseRevealStore(createSuppressionHolder({ setSuspended: () => {} }));
  reveals.stash(7, 'KEY-1', 'compromise', 2);
  const sent = [];
  resurfaceCompromiseReveal({ chromeId: 9, liveChromeIds: new Set([9]), reveals, send: (p) => sent.push(p) });
  assert.deepEqual(sent, [{ recoveryKey: 'KEY-1', replacing: true, skippedCount: 2 }]);

  reveals.stash(8, 'KEY-2', 'compromise');
  const sent2 = [];
  resurfaceCompromiseReveal({ chromeId: 9, liveChromeIds: new Set([9]), reveals, send: (p) => sent2.push(p) });
  assert.deepEqual(sent2, [{ recoveryKey: 'KEY-2', replacing: true }]);
});

test('skippedVaultsLine: fixed sentence from a count, singular and plural, nothing otherwise', () => {
  assert.equal(
    skippedVaultsLine(1),
    '1 vault could not be rotated and it still opens only with the old master key. Restore it from a backup bundle or delete it.'
  );
  assert.equal(
    skippedVaultsLine(3),
    '3 vaults could not be rotated and they still open only with the old master key. Restore them from a backup bundle or delete them.'
  );
  for (const bad of [0, -1, 1.5, '2', null, undefined, NaN, {}]) assert.equal(skippedVaultsLine(bad), '');
});

test('the card has a hidden skipped line that scrub clears', () => {
  const card = buildVaultRecoveryCard(createDocument());
  assert.equal(card.skippedLede.hidden, true);
  card.skippedLede.textContent = skippedVaultsLine(2);
  card.skippedLede.hidden = false;
  card.scrub();
  assert.equal(card.skippedLede.textContent, '');
  assert.equal(card.skippedLede.hidden, true);
});

// Source scans: main.js and menu-overlay.js cannot be loaded under node --test.
function source(rel) {
  const text = fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
  return text;
}

test('source pin: main.js vaultCompromiseRotate returns compromiseRotateReply(res)', () => {
  const src = source('src/main/main.js');
  const m = /vaultCompromiseRotate:\s*async[\s\S]*?compromiseRotateReply\(res\)/.exec(src);
  assert.ok(m, 'vaultCompromiseRotate must return compromiseRotateReply(res)');
  assert.ok(!/return\s*\{\s*ok:\s*true,\s*recoveryKey:\s*res\.recoveryKey/.test(src), 'no hand-built success reply');
});

test('source pin: menu-overlay.js renderRecovery sets the skipped line from model.skippedCount', () => {
  const src = source('src/renderer/menu-overlay.js');
  const m =
    /function renderRecovery\(model\)\s*\{[\s\S]*?skippedVaultsLine\(model && model\.skippedCount\)[\s\S]*?skippedLede\.textContent\s*=\s*skippedText[\s\S]*?\n {2}\}/.exec(
      src
    );
  assert.ok(m, 'renderRecovery must render skippedVaultsLine(model.skippedCount) into skippedLede');
});

test('source pin: the chrome forwards skippedCount into the recovery-show model', () => {
  const src = source('src/renderer/chrome/vault-controller.js');
  assert.ok(/onVaultRecoveryShow\(\(\{ recoveryKey, replacing, skippedCount \}\)/.test(src));
  assert.ok(/model\.skippedCount\s*=\s*skippedCount/.test(src));
});
