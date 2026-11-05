'use strict';

// Sortie 06 Leg 2 (flight DD7, AC2/AC5/AC7/AC10): vault-human's consent record and the ONE
// consented finalize write. Real store (FAST scrypt), the vault-capture.test.js idiom.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vs = require('../../src/main/vault/vault-store');
const { createVaultHuman } = require('../../src/main/vault/vault-human');

const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MASTER = 'correct horse battery staple';
const JARS = [
  { id: 'work', partition: 'persist:container:work' },
  { id: 'personal', partition: 'persist:container:personal' }
];
const A = 'https://a.example';
const enc = (s) => new TextEncoder().encode(s);
const IDENTITY_SECRETS = enc(JSON.stringify({ addressLine1: '1 Main St' }));

async function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gf-consent-'));
  const store = vs.load(dir, { scryptParams: FAST_SCRYPT, getAutoLockMinutes: () => 10, listJars: () => JARS });
  await store.setup({ masterPassword: MASTER });
  const entries = new Map([[10, { partition: 'persist:container:work', trusted: false }]]);
  const human = createVaultHuman({
    getVaultStore: () => store,
    fromId: (id) => (id === 10 ? { getURL: () => A + '/login' } : null),
    getTabEntry: (id) => entries.get(id),
    listJars: () => JARS,
    fillDelegate: () => {},
    fillCardDelegate: () => {},
    fillIdentityDelegate: () => {},
    now: () => 1000
  });
  const unlock = () => store.unlock(MASTER);
  return { store, human, unlock, entries, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function lockedLogin(h, extra = {}) {
  h.store.lockNow();
  return h.human.capture({
    wcId: 10,
    username: 'me@a',
    usernameDetected: true,
    passwordBytes: enc('pw-1'),
    ...extra
  });
}
const loginCount = (h, vault) => h.store.listItems(vault).filter((i) => i.type === 'login').length;

test('AC2: locked login / card offers carry choices + defaultVaultId; identity carries neither; no secret key', async () => {
  const h = await harness();
  try {
    const login = lockedLogin(h);
    assert.deepEqual(login.model, {
      origin: A,
      username: 'me@a',
      mode: 'locked',
      choices: ['work', 'global'],
      defaultVaultId: 'work'
    });
    const card = h.human.captureCard({ wcId: 10, numberBytes: enc('4242424242424242'), cvvBytes: enc('123') });
    assert.deepEqual(Object.keys(card.model).sort(), [
      'brand',
      'choices',
      'defaultVaultId',
      'kind',
      'last4',
      'mode',
      'origin'
    ]);
    assert.deepEqual(card.model.choices, ['work', 'global']);
    const ident = h.human.captureIdentity({ wcId: 10, identitySecretsBytes: IDENTITY_SECRETS, fullName: 'Ada' });
    assert.deepEqual(ident.model, { kind: 'identity', origin: A, mode: 'locked' });
    for (const o of [login, card, ident]) {
      for (const k of Object.keys(o.model)) assert.ok(!/pass|number|cvv|secret/i.test(k), k);
    }
  } finally {
    h.cleanup();
  }
});

test('AC10.1: no consent -> finalize writes nothing', async () => {
  const h = await harness();
  try {
    const held = lockedLogin(h);
    await h.unlock();
    const before = loginCount(h, 'work');
    const res = h.human.captureFinalize(held.captureId);
    assert.equal(res.model.mode, 'save');
    assert.equal(loginCount(h, 'work'), before);
  } finally {
    h.cleanup();
  }
});

test('consent + plain save: finalize writes through captureSave into the CONSENTED vault and answers saved', async () => {
  const h = await harness();
  try {
    for (const vaultId of ['work', 'global']) {
      const held = lockedLogin(h, { username: 'user-' + vaultId });
      assert.deepEqual(h.human.captureConsent({ captureId: held.captureId, vaultId }), { ok: true });
      await h.unlock();
      const res = h.human.captureFinalize(held.captureId);
      assert.deepEqual(res, { captureId: held.captureId, saved: true, vaultId, kind: 'login' });
      assert.equal(
        h.store.listItems(vaultId).filter((i) => i.username === 'user-' + vaultId).length,
        1,
        'written into the consented vault'
      );
      assert.equal(h.human.captureTabOf(held.captureId), null, 'the record is spent');
    }
  } finally {
    h.cleanup();
  }
});

test('consent + card plain save is written; consent + identity is NEVER written (re-ask)', async () => {
  const h = await harness();
  try {
    h.store.lockNow();
    const card = h.human.captureCard({ wcId: 10, numberBytes: enc('4242424242424242'), cvvBytes: enc('123') });
    assert.deepEqual(h.human.captureConsent({ captureId: card.captureId, vaultId: 'work' }), { ok: true });
    await h.unlock();
    const res = h.human.captureFinalize(card.captureId);
    assert.deepEqual(res, { captureId: card.captureId, saved: true, vaultId: 'work', kind: 'card' });

    h.store.lockNow();
    const ident = h.human.captureIdentity({ wcId: 10, identitySecretsBytes: IDENTITY_SECRETS, fullName: 'Ada' });
    assert.deepEqual(h.human.captureConsent({ captureId: ident.captureId, vaultId: null }), { ok: true });
    await h.unlock();
    const before = h.store.listItems('work').length + h.store.listItems('global').length;
    const r2 = h.human.captureFinalize(ident.captureId);
    assert.equal(r2.model.kind, 'identity');
    assert.equal(r2.saved, undefined);
    assert.equal(h.store.listItems('work').length + h.store.listItems('global').length, before);
  } finally {
    h.cleanup();
  }
});

test('AC10.2: consent + update disposition -> no write, consent cleared, model returned for a re-ask', async () => {
  const h = await harness();
  try {
    h.store.saveItem('work', { type: 'login', username: 'me@a', password: 'old', origin: A });
    const held = lockedLogin(h);
    assert.deepEqual(h.human.captureConsent({ captureId: held.captureId, vaultId: 'work' }), { ok: true });
    await h.unlock();
    const before = loginCount(h, 'work');
    const res = h.human.captureFinalize(held.captureId);
    assert.equal(res.model.mode, 'update');
    assert.equal(loginCount(h, 'work'), before);
    assert.equal(h.store.listItems('work').find((i) => i.username === 'me@a').password, 'old');
    // consent really cleared: a later explicit save is the only way (finalize again is cached)
    assert.equal(h.human.captureFinalize(held.captureId).saved, undefined);
  } finally {
    h.cleanup();
  }
});

test('AC10.11: a consented save whose disposition was DOWNGRADED (unprovenanced username) -> no write, re-ask', async () => {
  const h = await harness();
  try {
    h.store.saveItem('work', { type: 'login', username: null, password: 'old', origin: A });
    h.store.lockNow();
    const held = h.human.capture({
      wcId: 10,
      username: null,
      usernameDetected: true, // detected but unprovenanced -> update would downgrade to save
      passwordBytes: enc('new')
    });
    assert.deepEqual(h.human.captureConsent({ captureId: held.captureId, vaultId: 'work' }), { ok: true });
    await h.unlock();
    const before = loginCount(h, 'work');
    const res = h.human.captureFinalize(held.captureId);
    assert.equal(res.model.mode, 'save', 'the downgrade happened');
    assert.equal(res.saved, undefined);
    assert.equal(loginCount(h, 'work'), before, 'nothing written');
  } finally {
    h.cleanup();
  }
});

test('AC10.5: vaultId outside {jarId,global} -> refused and rec.consent unset (no write on finalize)', async () => {
  const h = await harness();
  try {
    const held = lockedLogin(h);
    for (const bad of ['personal', '', null, undefined, 7, {}]) {
      assert.deepEqual(h.human.captureConsent({ captureId: held.captureId, vaultId: bad }), {
        ok: false,
        reason: 'bad-vault'
      });
    }
    await h.unlock();
    const before = loginCount(h, 'work');
    assert.equal(h.human.captureFinalize(held.captureId).saved, undefined);
    assert.equal(loginCount(h, 'work'), before);
    // identity with a vault id is refused too
    h.store.lockNow();
    const ident = h.human.captureIdentity({ wcId: 10, identitySecretsBytes: IDENTITY_SECRETS, fullName: 'Ada' });
    assert.equal(h.human.captureConsent({ captureId: ident.captureId, vaultId: 'work' }).reason, 'bad-vault');
  } finally {
    h.cleanup();
  }
});

test('AC10.9: consent while the vault is already unlocked -> refused (unlocked), no consent set; gone record -> expired', async () => {
  const h = await harness();
  try {
    const held = lockedLogin(h);
    await h.unlock();
    assert.deepEqual(h.human.captureConsent({ captureId: held.captureId, vaultId: 'work' }), {
      ok: false,
      reason: 'unlocked'
    });
    const res = h.human.captureFinalize(held.captureId);
    assert.equal(res.saved, undefined, 'no consent was set, nothing written');
    assert.deepEqual(h.human.captureConsent({ captureId: 'nope', vaultId: 'work' }), { ok: false, reason: 'expired' });
    assert.deepEqual(h.human.captureConsent({ captureId: 5, vaultId: 'work' }), { ok: false, reason: 'expired' });
  } finally {
    h.cleanup();
  }
});

test('AC10.10: the consent lives on the record - every drop path evicts it; a recreated id has none', async () => {
  const h = await harness();
  try {
    const a = lockedLogin(h);
    h.human.captureConsent({ captureId: a.captureId, vaultId: 'work' });
    h.human.dropCapturesForTab(10);
    assert.equal(h.human.captureTabOf(a.captureId), null);
    await h.unlock();
    assert.deepEqual(h.human.captureFinalize(a.captureId), { reason: 'expired' });
    // a newly captured record (new id, even same tab/origin) carries no consent
    const b = lockedLogin(h);
    await h.unlock();
    const before = loginCount(h, 'work');
    assert.equal(h.human.captureFinalize(b.captureId).saved, undefined);
    assert.equal(loginCount(h, 'work'), before);
    // dismiss + dropAll too
    const c = lockedLogin(h);
    h.human.captureConsent({ captureId: c.captureId, vaultId: 'work' });
    h.human.captureDismiss(c.captureId);
    assert.equal(h.human.captureConsent({ captureId: c.captureId, vaultId: 'work' }).reason, 'expired');
  } finally {
    h.cleanup();
  }
});

test('AC10.12: a repeat finalize returns the cached disposition without re-running it (rotation update never degrades to save)', async () => {
  const h = await harness();
  try {
    h.store.saveItem('work', { type: 'login', username: null, password: 'OldPass1!', origin: A });
    h.store.lockNow();
    const held = h.human.capture({
      wcId: 10,
      username: null,
      usernameDetected: false,
      passwordBytes: enc('NewPass2!'),
      currentPasswordBytes: enc('OldPass1!')
    });
    await h.unlock();
    const first = h.human.captureFinalize(held.captureId);
    assert.equal(first.model.mode, 'update');
    const second = h.human.captureFinalize(held.captureId);
    assert.equal(second.model.mode, 'update', 'cached: currentPassword was zeroized once, not re-evaluated');
    assert.deepEqual(second, first);
  } finally {
    h.cleanup();
  }
});

test('captureConsent requires the record to still be locked-mode (a finalized record is refused)', async () => {
  const h = await harness();
  try {
    const held = lockedLogin(h);
    await h.unlock();
    h.human.captureFinalize(held.captureId);
    h.store.lockNow(); // drops all captures
    assert.equal(h.human.captureConsent({ captureId: held.captureId, vaultId: 'work' }).reason, 'refused');
  } finally {
    h.cleanup();
  }
});
