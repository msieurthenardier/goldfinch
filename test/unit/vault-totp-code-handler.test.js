'use strict';

// Integration tests for the M12 Flight 3 Leg 3 live-TOTP path:
//   - internal-vault-totp-code (register-vault-ipc.js) returns { code, secondsRemaining }
//     ONLY — never the seed — through the REAL registerInternalHandler guard;
//   - the enroll round-trip: a raw otpauth saved via internal-vault-item-save is stored
//     as the CANONICAL otpauth:// string and computes a live code;
//   - the COMPAT guarantee: F1's automation vault-context.totp still returns a code for
//     an item enrolled via this leg's normalizeTotpField (canonical-string storage).
// Electron-free; a real on-disk vault store with FAST scrypt.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { registerVaultIpc } = require('../../src/main/register-vault-ipc');
const { registerInternalHandler } = require('../../src/main/internal-ipc');
const vs = require('../../src/main/vault/vault-store');
const vc = require('../../src/main/vault/vault-crypto');
const { createVaultContext } = require('../../src/main/vault/vault-context');

const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MASTER = 'correct horse battery staple';
const REAL_JARS = [{ id: 'work' }, { id: 'personal' }];
const B32 = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const RAW_OTPAUTH = `otpauth://totp/ACME:alice?secret=${B32}&issuer=ACME`;

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-vaulttotp-')); }
function rm(dir) { fs.rmSync(dir, { recursive: true, force: true }); }

function makeFakeIpcMain() {
  return {
    _handlers: {},
    handle(channel, fn) { this._handlers[channel] = fn; },
    invoke(channel, event, ...args) {
      const fn = this._handlers[channel];
      if (!fn) throw new Error('no handler for ' + channel);
      return fn(event, ...args);
    }
  };
}

function vaultEvent() {
  return {
    senderFrame: { origin: 'goldfinch://vault', url: 'goldfinch://vault/' },
    sender: { session: { __goldfinchInternal: true } }
  };
}

async function realHarness() {
  const dir = tmpDir();
  const store = vs.load(dir, { scryptParams: FAST_SCRYPT, getAutoLockMinutes: () => 10, listJars: () => REAL_JARS });
  await store.setup({ masterPassword: MASTER });
  const ipcMain = makeFakeIpcMain();
  registerVaultIpc({ ipcMain, registerInternalHandler, getVaultStore: () => store, jars: { list: () => REAL_JARS } });
  return { dir, store, ipcMain };
}

test('register-vault-ipc registers internal-vault-totp-code', async () => {
  const { dir, ipcMain } = await realHarness();
  try {
    assert.ok('internal-vault-totp-code' in ipcMain._handlers);
  } finally { rm(dir); }
});

test('internal-vault-totp-code rejects a non-internal sender (forbidden)', async () => {
  const { dir, ipcMain } = await realHarness();
  try {
    const webEvent = {
      senderFrame: { origin: 'https://evil.test', url: 'https://evil.test/' },
      sender: { session: { __goldfinchInternal: true } }
    };
    assert.throws(
      () => ipcMain.invoke('internal-vault-totp-code', webEvent, { vaultId: 'global', itemId: 'x' }),
      (err) => err instanceof Error && err.message.includes('forbidden')
    );
  } finally { rm(dir); }
});

test('internal-vault-totp-code returns { code, secondsRemaining } and NEVER the seed', async () => {
  const { dir, store, ipcMain } = await realHarness();
  try {
    const saved = store.saveItem('global', {
      type: 'login', title: 'Bank', username: 'me', origin: 'https://bank',
      password: 'pw', totp: vc.normalizeTotpField(RAW_OTPAUTH),
    });
    const res = ipcMain.invoke('internal-vault-totp-code', vaultEvent(), { vaultId: 'global', itemId: saved.id });
    // exactly { code, secondsRemaining } — the seed must not appear.
    assert.deepEqual(Object.keys(res).sort(), ['code', 'secondsRemaining']);
    assert.match(res.code, /^\d{6}$/);
    assert.ok(res.secondsRemaining >= 1 && res.secondsRemaining <= 30);
    // grep-AC: no seed / otpauth / secret leaks through the result.
    const json = JSON.stringify(res);
    assert.equal(json.includes(B32), false, 'result must not carry the base32 seed');
    assert.equal(json.toLowerCase().includes('otpauth'), false, 'result must not carry the otpauth uri');
    assert.equal(json.toLowerCase().includes('secret'), false, 'result must not carry a secret field');
  } finally { rm(dir); }
});

test('internal-vault-totp-code returns { code: null } for an item with no totp', async () => {
  const { dir, store, ipcMain } = await realHarness();
  try {
    const saved = store.saveItem('global', { type: 'login', title: 'NoTotp', username: 'me', origin: 'https://x', password: 'pw' });
    assert.deepEqual(ipcMain.invoke('internal-vault-totp-code', vaultEvent(), { vaultId: 'global', itemId: saved.id }), { code: null });
    // an absent item id → also { code: null }.
    assert.deepEqual(ipcMain.invoke('internal-vault-totp-code', vaultEvent(), { vaultId: 'global', itemId: 'nope' }), { code: null });
  } finally { rm(dir); }
});

test('internal-vault-totp-code returns { locked: true } when the store is locked', async () => {
  const { dir, store, ipcMain } = await realHarness();
  try {
    store.lockNow();
    assert.deepEqual(ipcMain.invoke('internal-vault-totp-code', vaultEvent(), { vaultId: 'global', itemId: 'x' }), { locked: true });
  } finally { rm(dir); }
});

test('ENROLL ROUND-TRIP: a raw otpauth saved via internal-vault-item-save is stored CANONICAL and computes a code', async () => {
  const { dir, store, ipcMain } = await realHarness();
  try {
    // Enroll through the save handler (a NEW login carrying the RAW otpauth in totp).
    const res = ipcMain.invoke('internal-vault-item-save', vaultEvent(), {
      vaultId: 'global',
      item: { type: 'login', title: 'Bank', username: 'me', origin: 'https://bank', password: 'pw', totp: RAW_OTPAUTH, notes: '' },
      unchangedSecrets: [],
    });
    const id = res.item.id;
    // Stored value is the CANONICAL otpauth string (not the raw input, not an object).
    const stored = store.revealItem('global', id).totp;
    assert.equal(typeof stored, 'string');
    assert.ok(stored.startsWith('otpauth://totp/'), `stored totp should be canonical, got ${stored}`);
    // And the live-code op computes a real code from it.
    const code = ipcMain.invoke('internal-vault-totp-code', vaultEvent(), { vaultId: 'global', itemId: id });
    assert.match(code.code, /^\d{6}$/);
  } finally { rm(dir); }
});

test('a malformed totp enrollment THROWS at save (rejected invoke) and stores nothing', async () => {
  const { dir, store, ipcMain } = await realHarness();
  try {
    assert.throws(() => ipcMain.invoke('internal-vault-item-save', vaultEvent(), {
      vaultId: 'global',
      item: { type: 'login', title: 'Bad', username: 'me', origin: 'https://x', password: 'pw', totp: `otpauth://totp/x?secret=${B32}&period=0`, notes: '' },
      unchangedSecrets: [],
    }), (err) => err instanceof Error);
    // nothing persisted.
    assert.equal(store.listItemsMeta('global').length, 0);
  } finally { rm(dir); }
});

test('an UNCHANGED totp on edit is preserved verbatim (not re-normalized)', async () => {
  const { dir, store, ipcMain } = await realHarness();
  try {
    const canonical = vc.normalizeTotpField(RAW_OTPAUTH);
    const orig = store.saveItem('global', { type: 'login', title: 'Old', username: 'me', origin: 'https://x', password: 'pw', totp: canonical, notes: '' });
    // Edit the title, mark totp unchanged (the editor sends '' placeholder for it).
    ipcMain.invoke('internal-vault-item-save', vaultEvent(), {
      vaultId: 'global',
      item: { id: orig.id, type: 'login', title: 'New', username: 'me', origin: 'https://x', password: '', totp: '', notes: '' },
      unchangedSecrets: ['password', 'totp', 'notes'],
    });
    // The stored totp is the ORIGINAL canonical string, untouched.
    assert.equal(store.revealItem('global', orig.id).totp, canonical);
  } finally { rm(dir); }
});

test('COMPAT: F1 automation vault-context.totp returns a code for a leg-3-enrolled (canonical-string) item', () => {
  // Enroll exactly as this leg does — normalizeTotpField produces the STORED string.
  const canonical = vc.normalizeTotpField(RAW_OTPAUTH);
  const item = { id: 'x', type: 'login', title: 'A', origin: 'https://a', username: 'me', totp: canonical };
  const AT = 59_000;

  // Build the real per-session vault context over a fake stateless store returning
  // the leg-3-enrolled item — the SAME parseOtpauth(item.totp) read path F1 ships.
  const ctx = createVaultContext({
    vaultStore: {
      openAllWithAdminKey: () => new Map([['global', Buffer.from('session-key')]]),
      readVaultItems: (vaultId) => (vaultId === 'global' ? [item] : []),
      unlockVaultWithAccessKey: () => { throw new Error('unused'); },
    },
    now: () => AT,
  });
  ctx.unlock('admin', 'admin-priv-b64');
  const res = ctx.totp('x');
  assert.equal(res.id, 'x');
  assert.match(res.code, /^\d{6}$/);
  // …and it is the SAME code the crypto core computes from the canonical string.
  const p = vc.parseOtpauth(canonical);
  assert.equal(res.code, vc.totp(p.secret, p, AT));
});
