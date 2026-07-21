'use strict';

// Integration + unit tests for the capture ops on createVaultHuman (Mission 12,
// Flight 2, Leg 4 capture-save, DD7/DD9) — capture / captureSave / captureDismiss,
// driven against a REAL vault store (faithful persistence + disposition under the MRK)
// with fake webContents/registry handles and an INJECTED, controllable drop-timer so
// the ~2-min timeout is exercised with no wall-clock wait. Verifies:
//   - the GATE: dropped (no offer, null) when not set up / locked / burner;
//   - the DISPOSITION: update on an exact origin+username match, else save; the
//     active-jar match preferred over global on a username tie; '' → null username;
//   - captureSave: save → a new login via saveItem; update → the same id overwritten;
//     the re-check-locked race; save requires vaultId ∈ choices;
//   - the OFFER MODEL + the SAVE never carry the password (it lives only in the record);
//   - the held record is dropped on EVERY exit path (save / dismiss / supersession /
//     timeout) and the incoming password array is zeroized.
//
// Electron-free (the vault-human.test.js / vault-store.test.js FAST-scrypt pattern).

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
  { id: 'personal', partition: 'persist:container:personal' },
];
const A = 'https://a.example';
const A_HOST = 'a.example';

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-capture-')); }
function rm(dir) { fs.rmSync(dir, { recursive: true, force: true }); }
function bytesOf(str) { return new TextEncoder().encode(str); }

// A controllable injected timer: setTimeout records the callback (no wall clock);
// fireAll runs every pending callback; clearTimeout removes one. `pending` is the live
// set so a test can assert arm/clear.
function makeTimer() {
  let seq = 0;
  const pending = new Map();
  return {
    pending,
    setTimeout: (fn, ms) => { const id = ++seq; pending.set(id, { fn, ms }); return { id, unref() {} }; },
    clearTimeout: (h) => { if (h && pending.has(h.id)) pending.delete(h.id); },
    fireAll: () => { for (const [id, e] of [...pending]) { pending.delete(id); e.fn(); } },
  };
}

// A real, set-up, unlocked store + a createVaultHuman wired to fakes + the injected
// timer. wcId map: 10 → work-jar tab @ A, 20 → burner tab @ A, 30 → closed (fromId null).
async function makeHarness(dir, { setup = true } = {}) {
  const timer = makeTimer();
  const store = vs.load(dir, { scryptParams: FAST_SCRYPT, getAutoLockMinutes: () => 10, listJars: () => JARS });
  if (setup) await store.setup({ masterPassword: MASTER });

  const urls = { 10: A + '/login', 20: A + '/login' };
  const entries = new Map([
    [10, { partition: 'persist:container:work', trusted: false }],
    [20, { partition: 'burner:1', trusted: false }],
  ]);

  const human = createVaultHuman({
    getVaultStore: () => store,
    fromId: (id) => (urls[id] != null ? { getURL: () => urls[id] } : null),
    getTabEntry: (id) => entries.get(id),
    listJars: () => JARS,
    fillDelegate: () => {},
    setTimeout: timer.setTimeout,
    clearTimeout: timer.clearTimeout,
    now: () => 1000,
  });
  return { store, human, timer };
}

/* ------------------------------------------------------------- disposition (unit) */

test('capture: no saved login for the origin → SAVE (default active jar, choices [jar, global])', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    const bytes = bytesOf('s3cret');
    const offer = human.capture({ wcId: 10, username: 'me@a', passwordBytes: bytes });

    assert.ok(offer, 'an offer was returned');
    assert.deepEqual(offer.model, {
      origin: A, username: 'me@a', mode: 'save', defaultVaultId: 'work', choices: ['work', 'global'],
    });
    // No password anywhere on the offer (model OR captureId).
    assert.ok(!JSON.stringify(offer).includes('s3cret'), 'no password in the offer/model');
    // The incoming array is zeroized (its bytes were copied into the main-side record).
    assert.ok(bytes.every((b) => b === 0), 'incoming password array zeroized after capture');
  } finally { rm(dir); }
});

test('capture: exact origin+username match → UPDATE (fixed vault, no choices)', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    store.saveItem('work', { type: 'login', title: 'Work', username: 'me@a', password: 'old', origin: A });
    const offer = human.capture({ wcId: 10, username: 'me@a', passwordBytes: bytesOf('new') });

    assert.equal(offer.model.mode, 'update');
    assert.equal(offer.model.defaultVaultId, 'work');
    assert.deepEqual(offer.model.choices, []);
  } finally { rm(dir); }
});

test('capture: PREFERS the active-jar match over global on a username tie', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    // Both the global and the work vault hold a login for the same user @ A.
    const g = store.saveItem('global', { type: 'login', username: 'shared@a', password: 'g-old', origin: A });
    const w = store.saveItem('work', { type: 'login', username: 'shared@a', password: 'w-old', origin: A });

    const offer = human.capture({ wcId: 10, username: 'shared@a', passwordBytes: bytesOf('typed') });
    assert.equal(offer.model.mode, 'update');
    assert.equal(offer.model.defaultVaultId, 'work', 'the active-jar copy wins the tie, not global');

    // On save, the WORK item is the one overwritten; global is untouched.
    assert.deepEqual(human.captureSave({ captureId: offer.captureId, vaultId: 'work' }), { saved: true });
    const workItems = store.listItems('work');
    const globalItems = store.listItems('global');
    assert.equal(workItems.find((i) => i.id === w.id).password, 'typed');
    assert.equal(globalItems.find((i) => i.id === g.id).password, 'g-old', 'global copy untouched');
  } finally { rm(dir); }
});

test('capture: empty-string username normalizes to null and matches a null-username item → UPDATE', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    // A password-only login already stored (no username).
    store.saveItem('work', { type: 'login', username: null, password: 'old', origin: A });
    const offer = human.capture({ wcId: 10, username: '', passwordBytes: bytesOf('new') });

    assert.equal(offer.model.username, null, "'' normalized to null in the model");
    assert.equal(offer.model.mode, 'update', "'' matches a stored null-username item");
  } finally { rm(dir); }
});

test('capture: empty-string username with no null-username item → SAVE (username null)', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    store.saveItem('work', { type: 'login', username: 'someone@a', password: 'x', origin: A });
    const offer = human.capture({ wcId: 10, username: '', passwordBytes: bytesOf('new') });
    assert.equal(offer.model.username, null);
    assert.equal(offer.model.mode, 'save', 'a null-username capture does not match a named item');
  } finally { rm(dir); }
});

/* ------------------------------------------------------------------- gate (integration) */

test('capture GATE: not set up → null (no offer), incoming array still zeroized', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir, { setup: false });
    const bytes = bytesOf('pw');
    assert.equal(human.capture({ wcId: 10, username: 'me@a', passwordBytes: bytes }), null);
    assert.ok(bytes.every((b) => b === 0), 'password array zeroized even when dropped');
  } finally { rm(dir); }
});

test('capture GATE: locked → null (no offer)', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    store.lockNow();
    const bytes = bytesOf('pw');
    assert.equal(human.capture({ wcId: 10, username: 'me@a', passwordBytes: bytes }), null);
    assert.ok(bytes.every((b) => b === 0));
  } finally { rm(dir); }
});

test('capture GATE: burner tab → null (no offer), never falls back to global (DD9)', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    const bytes = bytesOf('pw');
    assert.equal(human.capture({ wcId: 20, username: 'me@a', passwordBytes: bytes }), null);
    assert.ok(bytes.every((b) => b === 0));
  } finally { rm(dir); }
});

test('capture GATE: closed tab (fromId null / no origin) → null', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    assert.equal(human.capture({ wcId: 30, username: 'me@a', passwordBytes: bytesOf('pw') }), null);
  } finally { rm(dir); }
});

/* -------------------------------------------------------------- captureSave (integration) */

test('captureSave (save): creates a new login via saveItem, title = origin hostname', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    const offer = human.capture({ wcId: 10, username: 'me@a', passwordBytes: bytesOf('the-pass') });
    assert.deepEqual(human.captureSave({ captureId: offer.captureId, vaultId: 'work' }), { saved: true });

    const items = store.listItems('work');
    assert.equal(items.length, 1);
    assert.deepEqual(
      { type: items[0].type, title: items[0].title, origin: items[0].origin, username: items[0].username, password: items[0].password },
      { type: 'login', title: A_HOST, origin: A, username: 'me@a', password: 'the-pass' }
    );
  } finally { rm(dir); }
});

test('captureSave (save): defaults to the active jar but global is selectable', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    const offer = human.capture({ wcId: 10, username: 'me@a', passwordBytes: bytesOf('gp') });
    assert.deepEqual(human.captureSave({ captureId: offer.captureId, vaultId: 'global' }), { saved: true });
    assert.equal(store.listItems('global').find((i) => i.username === 'me@a').password, 'gp');
    assert.equal(store.listItems('work').length, 0, 'nothing landed in the jar when global was chosen');
  } finally { rm(dir); }
});

test('captureSave (save): a vaultId NOT in the offer choices is refused, nothing saved', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    const offer = human.capture({ wcId: 10, username: 'me@a', passwordBytes: bytesOf('pw') });
    // 'personal' is a real jar but not among this offer's choices ([work, global]).
    assert.deepEqual(human.captureSave({ captureId: offer.captureId, vaultId: 'personal' }), { saved: false, reason: 'invalid-vault' });
    assert.equal(store.listItems('personal').length, 0);
    assert.equal(store.listItems('work').length, 0);
  } finally { rm(dir); }
});

test('captureSave (update): overwrites the SAME item id, preserving createdAt', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    const orig = store.saveItem('work', { type: 'login', title: 'Work', username: 'me@a', password: 'old', origin: A });
    const offer = human.capture({ wcId: 10, username: 'me@a', passwordBytes: bytesOf('rotated') });
    // The sheet supplies defaultVaultId for update; main IGNORES it and uses the fixed vault.
    assert.deepEqual(human.captureSave({ captureId: offer.captureId, vaultId: 'work' }), { saved: true });

    const items = store.listItems('work');
    assert.equal(items.length, 1, 'still exactly one item (upsert by id, not a duplicate)');
    assert.equal(items[0].id, orig.id, 'same id overwritten');
    assert.equal(items[0].password, 'rotated');
    assert.equal(items[0].createdAt, orig.createdAt, 'createdAt preserved on update');
  } finally { rm(dir); }
});

test('captureSave (update): MERGES onto the existing item — totp seed + custom title survive, password updated', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    // A stored login that carries a TOTP seed, a user-customized title, and notes — none
    // of which capture owns. A capture-update MUST preserve all of them (bug: a wholesale
    // rewrite would permanently drop the totp seed — unrecoverable data loss).
    const orig = store.saveItem('work', {
      type: 'login',
      title: 'My Custom Work Login',
      username: 'me@a',
      password: 'old',
      origin: A,
      totp: 'JBSWY3DPEHPK3PXP',
      notes: 'recovery codes: 1234',
    });
    const offer = human.capture({ wcId: 10, username: 'me@a', passwordBytes: bytesOf('rotated') });
    assert.equal(offer.model.mode, 'update');
    assert.deepEqual(human.captureSave({ captureId: offer.captureId, vaultId: 'work' }), { saved: true });

    const items = store.listItems('work');
    assert.equal(items.length, 1, 'still exactly one item (upsert by id)');
    const it = items[0];
    assert.equal(it.id, orig.id, 'same id overwritten');
    assert.equal(it.password, 'rotated', 'password updated');
    assert.equal(it.username, 'me@a', 'username carried forward');
    assert.equal(it.origin, A, 'origin carried forward');
    assert.equal(it.totp, 'JBSWY3DPEHPK3PXP', 'totp seed PRESERVED (not destroyed by the update)');
    assert.equal(it.title, 'My Custom Work Login', 'custom title PRESERVED (not overwritten with the hostname)');
    assert.equal(it.notes, 'recovery codes: 1234', 'notes preserved');
    assert.equal(it.createdAt, orig.createdAt, 'createdAt preserved');
  } finally { rm(dir); }
});

test('captureSave (N1): a saveItem throw still zeroizes+drops the held record and clears the timer', async () => {
  const dir = tmpDir();
  try {
    const { store, human, timer } = await makeHarness(dir);
    const offer = human.capture({ wcId: 10, username: 'me@a', passwordBytes: bytesOf('pw') });
    assert.equal(timer.pending.size, 1, 'the drop timer is armed on capture');
    // Simulate a disk error on persist.
    store.saveItem = () => { throw new Error('disk full'); };
    assert.throws(() => human.captureSave({ captureId: offer.captureId, vaultId: 'work' }), /disk full/);
    // The record was dropped (zeroized) in the finally — not left alive until the 2-min timeout.
    assert.deepEqual(
      human.captureSave({ captureId: offer.captureId, vaultId: 'work' }),
      { saved: false },
      'record dropped on save error'
    );
    assert.equal(timer.pending.size, 0, 'the drop timer is cleared on save error');
  } finally { rm(dir); }
});

test('captureSave: re-checks unlock — an idle-lock between offer and save → { saved:false, reason:locked }', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    const offer = human.capture({ wcId: 10, username: 'me@a', passwordBytes: bytesOf('pw') });
    store.lockNow(); // idle-locked after the offer was raised
    assert.deepEqual(human.captureSave({ captureId: offer.captureId, vaultId: 'work' }), { saved: false, reason: 'locked' });
  } finally { rm(dir); }
});

test('captureSave: unknown / already-dropped captureId → { saved:false }', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    assert.deepEqual(human.captureSave({ captureId: 'nope', vaultId: 'work' }), { saved: false });
  } finally { rm(dir); }
});

/* --------------------------------------------------- held-record drop on every exit path */

test('drop on SAVE: the record is gone (a second save no-ops) and the timer is cleared', async () => {
  const dir = tmpDir();
  try {
    const { human, timer } = await makeHarness(dir);
    const offer = human.capture({ wcId: 10, username: 'me@a', passwordBytes: bytesOf('pw') });
    assert.equal(timer.pending.size, 1, 'the drop timer is armed on capture');
    human.captureSave({ captureId: offer.captureId, vaultId: 'work' });
    assert.deepEqual(human.captureSave({ captureId: offer.captureId, vaultId: 'work' }), { saved: false }, 'record dropped after save');
    assert.equal(timer.pending.size, 0, 'the drop timer is cleared on save');
  } finally { rm(dir); }
});

test('drop on DISMISS: captureDismiss zeroizes+drops the record and clears the timer', async () => {
  const dir = tmpDir();
  try {
    const { human, timer } = await makeHarness(dir);
    const offer = human.capture({ wcId: 10, username: 'me@a', passwordBytes: bytesOf('pw') });
    human.captureDismiss(offer.captureId);
    assert.deepEqual(human.captureSave({ captureId: offer.captureId, vaultId: 'work' }), { saved: false }, 'record dropped after dismiss');
    assert.equal(timer.pending.size, 0, 'the drop timer is cleared on dismiss');
    // Idempotent: dismissing an already-dropped id is a harmless no-op.
    human.captureDismiss(offer.captureId);
  } finally { rm(dir); }
});

test('drop on SUPERSESSION: a new capture for the same tab evicts the prior record (last-wins)', async () => {
  const dir = tmpDir();
  try {
    const { human, timer } = await makeHarness(dir);
    const first = human.capture({ wcId: 10, username: 'a@a', passwordBytes: bytesOf('p1') });
    const second = human.capture({ wcId: 10, username: 'b@a', passwordBytes: bytesOf('p2') });
    assert.notEqual(first.captureId, second.captureId);
    // The prior record is gone; only the newest survives.
    assert.deepEqual(human.captureSave({ captureId: first.captureId, vaultId: 'work' }), { saved: false }, 'prior record evicted');
    assert.equal(timer.pending.size, 1, 'exactly one live timer (the prior was cleared, the new armed)');
    assert.deepEqual(human.captureSave({ captureId: second.captureId, vaultId: 'work' }), { saved: true }, 'newest record is alive');
  } finally { rm(dir); }
});

test('drop on TIMEOUT: firing the injected drop timer evicts the record (no wall-clock wait)', async () => {
  const dir = tmpDir();
  try {
    const { human, timer } = await makeHarness(dir);
    const offer = human.capture({ wcId: 10, username: 'me@a', passwordBytes: bytesOf('pw') });
    assert.equal(timer.pending.size, 1);
    timer.fireAll(); // the ~2-min safety timeout elapses
    assert.deepEqual(human.captureSave({ captureId: offer.captureId, vaultId: 'work' }), { saved: false }, 'record dropped on timeout');
    assert.equal(timer.pending.size, 0);
  } finally { rm(dir); }
});
