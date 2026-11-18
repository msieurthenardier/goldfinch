'use strict';

// Mission 24 Flight 2 (leg `grant-swap-proof`): can an admin-scripted goldfinch://vault document use the
// UNGATED item writes (save / delete / copy) to defeat the reveal gate? Driven through the real
// registerVaultIpc handlers, a real VaultStore and a real reveal gate (fake dialog).
//
//   chain 3 (grant swap): confirm a harmless item B, re-shape B and copy S over it under B's id, reveal B
//                         again - the per-item grant still covers (vaultId, B.id) and S's secret comes out.
//   chain 2 (title spoof): rename S to a harmless title, then ask for S - the dialog names the new title.
//
// The chain-2 / chain-3 tests assert the CORRECT behaviour and fail until the item writes drop grants and
// the dialog names the pre-write title. The control must keep passing.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vs = require('../../src/main/vault/vault-store');
const { registerVaultIpc } = require('../../src/main/register-vault-ipc');
const { registerInternalHandler } = require('../../src/main/internal-ipc');
const { makeTestRevealGate } = require('../helpers/reveal-gate-fixture');
const { CHANGED_NOTE } = require('../../src/main/reveal-gate');

const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const JARS = [{ id: 'work' }];
const flush = () => new Promise((r) => setImmediate(r));

/** An internal-page event from tab `id`'s main frame (passes registerInternalHandler AND the gate). */
function internalEvent(rg, id = 7) {
  const e = rg.event(id);
  return { sender: { ...e.sender, session: { __goldfinchInternal: true } }, senderFrame: e.senderFrame };
}

async function mk(t, rgOpts) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-reveal-writes-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = vs.load(dir, {
    scryptParams: FAST_SCRYPT,
    listJars: () => JARS,
    now: () => 1000,
    getAutoLockMinutes: () => 10
  });
  await store.setup({ masterPassword: 'correct horse battery staple' });
  const rg = makeTestRevealGate(rgOpts);
  const handlers = new Map();
  registerVaultIpc({
    ipcMain: { handle: (c, fn) => handlers.set(c, fn) },
    revealGate: rg.gate,
    registerInternalHandler,
    getVaultStore: () => store,
    jars: { list: () => [{ id: 'work', name: 'Work' }] }
  });
  const ev = internalEvent(rg, 7);
  const call = (channel, payload) => handlers.get(channel)(ev, payload);
  /** Start a reveal, answer the dialog it raises (if any) with `answer`, return { reply, raised }. */
  async function reveal(vaultId, itemId, answer) {
    const before = rg.dialogs.length;
    const p = call('internal-vault-reveal', { vaultId, itemId });
    await flush();
    const raised = rg.dialogs.length - before;
    if (raised > 0) rg.dialogs[rg.dialogs.length - 1].answer(answer);
    return { reply: await p, raised };
  }
  return { store, rg, call, reveal };
}

const login = (o) => ({
  type: 'login',
  matchMode: 'exact',
  username: 'alice',
  origin: 'https://s.example',
  ...o
});

/** S in the global vault, B in the jar vault. */
function seed(store) {
  store.saveItem('global', login({ id: 'S', title: 'Bank', password: 'pw-SECRET' }));
  store.saveItem(
    'work',
    login({ id: 'B', title: 'Harmless', origin: 'https://b.example', username: 'bob', password: 'pw-harmless' })
  );
}

/** The page's fewest writes: re-shape B so S collides with it, then copy S over B under B's id. */
async function swap(h) {
  const saved = await h.call('internal-vault-item-save', {
    vaultId: 'work',
    item: login({ id: 'B', title: 'Harmless' }),
    unchangedSecrets: ['password']
  });
  const copied = await h.call('internal-vault-item-copy', {
    sourceVaultId: 'global',
    itemId: 'S',
    destVaultId: 'work',
    resolution: 'replace',
    matchId: 'B'
  });
  return { saved, copied };
}

test("chain 3: a grant for B does not survive a copy that puts S under B's id", async (t) => {
  const h = await mk(t, { admin: true });
  seed(h.store);
  const first = await h.reveal('work', 'B', 1);
  assert.equal(first.raised, 1);
  assert.equal(first.reply.item.password, 'pw-harmless');

  const { copied } = await swap(h);
  assert.equal(copied.outcome, 'replaced', 'precondition: the copy replaced B');
  assert.equal(
    h.store.revealItem('work', 'B').password,
    'pw-SECRET',
    "precondition: the copy put S's secret under B's id"
  );

  const second = await h.reveal('work', 'B', 0);
  assert.equal(
    second.raised,
    1,
    `reveal after replace raised no dialog and returned ${JSON.stringify(second.reply.item && second.reply.item.password)} (stale grant)`
  );
  assert.deepEqual(second.reply, { refused: 'not-confirmed' }, 'denied reveal after replace must be refused');
  // The copied secrets arrive with their own title, and the page cannot hide them behind B's.
  const d = h.rg.dialogs[h.rg.dialogs.length - 1].options;
  assert.match(d.message, /Bank/, `the new dialog must name S's title: ${d.message}`);
  assert.doesNotMatch(d.message, /Harmless/);
  // The note travels with the copied secrets: their own title, so the "changed" line (the table's row).
  assert.ok(d.detail.includes(CHANGED_NOTE), d.detail);
  // A further rename of B through save still shows S's title.
  await h.call('internal-vault-item-save', {
    vaultId: 'work',
    item: login({ id: 'B', title: 'Harmless', origin: 'https://s.example' }),
    unchangedSecrets: ['password']
  });
  const third = await h.reveal('work', 'B', 0);
  assert.equal(third.raised, 1);
  const d2 = h.rg.dialogs[h.rg.dialogs.length - 1].options;
  assert.match(d2.message, /Bank/);
  assert.ok(d2.detail.includes(CHANGED_NOTE), d2.detail);
  assert.doesNotMatch(d2.message, /Harmless/);
});

test('chain 3 variant: a grant for B does not survive deleting B', async (t) => {
  const h = await mk(t, { admin: true });
  seed(h.store);
  assert.equal((await h.reveal('work', 'B', 1)).raised, 1);
  assert.deepEqual(await h.call('internal-vault-item-delete', { vaultId: 'work', itemId: 'B' }), { deleted: true });
  const key = 'work\u0000B';
  assert.equal(
    h.rg.marks.hasGrant(7, key),
    false,
    'grant for (work, B) still held by document 7 after the item was deleted'
  );
});

test('chain 2: the dialog names the title from before the automation-time rename', async (t) => {
  const h = await mk(t, { admin: true });
  seed(h.store);
  await h.call('internal-vault-item-save', {
    vaultId: 'global',
    item: login({ id: 'S', title: 'Test' }),
    unchangedSecrets: ['password']
  });
  const p = h.call('internal-vault-reveal', { vaultId: 'global', itemId: 'S' });
  await flush();
  assert.equal(h.rg.dialogs.length, 1, 'a reveal must raise one dialog');
  const { message, detail } = h.rg.dialogs[0].options;
  h.rg.dialogs[0].answer(0);
  await p;
  assert.match(message, /Bank/, `dialog named the rewritten title instead of "Bank": ${message}`);
  assert.ok(detail.includes(CHANGED_NOTE), `dialog detail does not carry CHANGED_NOTE: ${detail}`);
});

test("chain A: rename S, then Replace-copy S over B - B's dialog names S's original title", async (t) => {
  const h = await mk(t, { admin: true });
  seed(h.store);
  await h.call('internal-vault-item-save', {
    vaultId: 'global',
    item: login({ id: 'S', title: 'Harmless' }),
    unchangedSecrets: ['password']
  });
  await h.call('internal-vault-item-save', {
    vaultId: 'work',
    item: login({ id: 'B', title: 'Harmless' }),
    unchangedSecrets: ['password']
  });
  const copied = await h.call('internal-vault-item-copy', {
    sourceVaultId: 'global',
    itemId: 'S',
    destVaultId: 'work',
    resolution: 'replace',
    matchId: 'B'
  });
  assert.equal(copied.outcome, 'replaced');
  const r = await h.reveal('work', 'B', 0);
  assert.equal(r.raised, 1);
  const { message, detail } = h.rg.dialogs[0].options;
  assert.match(message, /Bank/, message);
  assert.doesNotMatch(message, /Harmless/);
  assert.ok(detail.includes(CHANGED_NOTE), detail);
});

test("chain B: rename S, then copy S into another vault as new N - N's dialog names S's original title", async (t) => {
  const h = await mk(t, { admin: true });
  seed(h.store);
  await h.call('internal-vault-item-save', {
    vaultId: 'global',
    item: login({ id: 'S', title: 'Harmless' }),
    unchangedSecrets: ['password']
  });
  const copied = await h.call('internal-vault-item-copy', {
    sourceVaultId: 'global',
    itemId: 'S',
    destVaultId: 'work'
  });
  assert.ok(['copied', 'kept-both'].includes(copied.outcome), JSON.stringify(copied));
  const nId = h.store.listItemsMeta('work').find((m) => m.id !== 'B').id;
  const r = await h.reveal('work', nId, 0);
  assert.equal(r.raised, 1);
  const { message, detail } = h.rg.dialogs[0].options;
  assert.match(message, /Bank/, message);
  assert.ok(detail.includes(CHANGED_NOTE), detail);
});

test('control: gate not applying - copying an un-noted item records no note and raises no dialog', async (t) => {
  const h = await mk(t);
  seed(h.store);
  const copied = await h.call('internal-vault-item-copy', {
    sourceVaultId: 'global',
    itemId: 'S',
    destVaultId: 'work'
  });
  assert.ok(['copied', 'kept-both'].includes(copied.outcome));
  const nId = h.store.listItemsMeta('work').find((m) => m.id !== 'B').id;
  assert.equal(h.rg.marks.writeNote(`work\u0000${nId}`), null);
  assert.equal(h.rg.dialogs.length, 0);
});

test("control: with the gate not applying, save + copy + reveal are today's replies with no dialog", async (t) => {
  const h = await mk(t);
  seed(h.store);
  assert.deepEqual((await h.reveal('work', 'B', 1)).raised, 0);
  const { saved, copied } = await swap(h);
  assert.equal(saved.item.id, 'B');
  assert.equal(saved.item.title, 'Harmless');
  assert.deepEqual(copied, { ok: true, outcome: 'replaced' });
  const r = await h.reveal('work', 'B', 0);
  assert.equal(r.raised, 0);
  assert.equal(r.reply.item.password, 'pw-SECRET');
  assert.equal(h.rg.dialogs.length, 0);
});

test('wiring pin: a successful profile restore drops every grant (main.js import commit)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/main/main.js'), 'utf8');
  assert.match(
    src,
    /getVaultStore\(\)\.restoreProfile\([\s\S]{0,300}?\}\);\s*revealGate\.dropAllGrants\(\);/,
    'revealGate.dropAllGrants() must follow restoreProfile in vaultImportCommit'
  );
  assert.equal((src.match(/revealGate\.dropAllGrants\(\)/g) || []).length, 1);
});
