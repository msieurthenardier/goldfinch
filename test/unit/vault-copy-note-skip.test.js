'use strict';

// Squawk 0223: when the destination id of a copy cannot be determined, the reveal gate's copy note is
// skipped (as before) but exactly one log line says why - reason code and channel, never an id or title.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registerVaultIpc } = require('../../src/main/register-vault-ipc');
const { registerInternalHandler } = require('../../src/main/internal-ipc');

function setup(added, outcome = 'copied', throwFirstList = false) {
  const handlers = {};
  const ipcMain = { handle: (c, fn) => (handlers[c] = fn) };
  const calls = [];
  let listCalls = 0;
  let items = [{ id: 'd0', title: 'SECRET-TITLE' }];
  const store = {
    isUnlocked: () => true,
    listItemsMeta: () => {
      if (throwFirstList && listCalls++ === 0) throw new Error('SECRET-TITLE boom');
      return items;
    },
    copyItem: () => {
      for (let i = 0; i < added; i++) items = [...items, { id: 'new' + i, title: 'SECRET-TITLE' }];
      return { outcome };
    }
  };
  registerVaultIpc({
    ipcMain,
    registerInternalHandler,
    revealGate: {
      confirm: async () => 'not-applicable',
      itemWritten() {},
      itemCopied: (...a) => calls.push(a),
      itemDeleted() {},
      dropAllGrants() {}
    },
    getVaultStore: () => store,
    jars: { list: () => [] }
  });
  const ev = {
    senderFrame: { origin: 'goldfinch://vault', url: 'goldfinch://vault/' },
    sender: { session: { __goldfinchInternal: true } }
  };
  return {
    call: () => handlers['internal-vault-item-copy'](ev, { sourceVaultId: 's', itemId: 'src', destVaultId: 'd' }),
    calls
  };
}

for (const [added, reason] of [
  [0, 'copy-note-no-new-id'],
  [2, 'copy-note-ambiguous-new-id']
]) {
  for (const outcome of ['copied', 'kept-both']) {
    test(`copy adding ${added} ids (${outcome}): reply unchanged, no itemCopied, one log line`, async (t) => {
      const warn = t.mock.method(console, 'warn', () => {});
      const h = setup(added, outcome);
      assert.deepEqual(await h.call(), { ok: true, outcome });
      assert.equal(h.calls.length, 0);
      assert.equal(warn.mock.callCount(), 1);
      const line = warn.mock.calls[0].arguments.join(' ');
      assert.equal(line, `[internal-vault-item-copy] ${reason}`);
      assert.ok(!/new\d|d0|SECRET/.test(line));
    });
  }
}

test('copy adding exactly one id: itemCopied called, no log', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const h = setup(1);
  assert.deepEqual(await h.call(), { ok: true, outcome: 'copied' });
  assert.equal(h.calls.length, 1);
  assert.equal(warn.mock.callCount(), 0);
});

for (const outcome of ['copied', 'kept-both']) {
  test(`before-snapshot throws (${outcome}): reply unchanged, no itemCopied, one no-baseline log line`, async (t) => {
    const warn = t.mock.method(console, 'warn', () => {});
    const h = setup(1, outcome, true);
    assert.deepEqual(await h.call(), { ok: true, outcome });
    assert.equal(h.calls.length, 0);
    assert.equal(warn.mock.callCount(), 1);
    const line = warn.mock.calls[0].arguments.join(' ');
    assert.equal(line, '[internal-vault-item-copy] copy-note-no-baseline');
    assert.ok(!/new\d|d0|SECRET|boom/.test(line));
  });
}
