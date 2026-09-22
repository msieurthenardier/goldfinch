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
  { id: 'personal', partition: 'persist:container:personal' }
];
const A = 'https://a.example';
const A_HOST = 'a.example';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-capture-'));
}
function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
function bytesOf(str) {
  return new TextEncoder().encode(str);
}

// A controllable injected timer: setTimeout records the callback (no wall clock);
// fireAll runs every pending callback; clearTimeout removes one. `pending` is the live
// set so a test can assert arm/clear.
function makeTimer() {
  let seq = 0;
  const pending = new Map();
  return {
    pending,
    setTimeout: (fn, ms) => {
      const id = ++seq;
      pending.set(id, { fn, ms });
      return { id, unref() {} };
    },
    clearTimeout: (h) => {
      if (h && pending.has(h.id)) pending.delete(h.id);
    },
    fireAll: () => {
      for (const [id, e] of [...pending]) {
        pending.delete(id);
        e.fn();
      }
    }
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
    [20, { partition: 'burner:1', trusted: false }]
  ]);

  const human = createVaultHuman({
    getVaultStore: () => store,
    fromId: (id) => (urls[id] != null ? { getURL: () => urls[id] } : null),
    getTabEntry: (id) => entries.get(id),
    listJars: () => JARS,
    fillDelegate: () => {},
    setTimeout: timer.setTimeout,
    clearTimeout: timer.clearTimeout,
    now: () => 1000
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
      origin: A,
      username: 'me@a',
      mode: 'save',
      defaultVaultId: 'work',
      choices: ['work', 'global']
    });
    // No password anywhere on the offer (model OR captureId).
    assert.ok(!JSON.stringify(offer).includes('s3cret'), 'no password in the offer/model');
    // The incoming array is zeroized (its bytes were copied into the main-side record).
    assert.ok(
      bytes.every((b) => b === 0),
      'incoming password array zeroized after capture'
    );
  } finally {
    rm(dir);
  }
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
  } finally {
    rm(dir);
  }
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
  } finally {
    rm(dir);
  }
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
  } finally {
    rm(dir);
  }
});

test('capture: empty-string username with no null-username item → SAVE (username null)', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    store.saveItem('work', { type: 'login', username: 'someone@a', password: 'x', origin: A });
    const offer = human.capture({ wcId: 10, username: '', passwordBytes: bytesOf('new') });
    assert.equal(offer.model.username, null);
    assert.equal(offer.model.mode, 'save', 'a null-username capture does not match a named item');
  } finally {
    rm(dir);
  }
});

test('capture: UNCHANGED login (same username AND same password) → NO offer (no pointless update)', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    store.saveItem('work', { type: 'login', title: 'Work', username: 'me@a', password: 'unchanged', origin: A });
    const bytes = bytesOf('unchanged');
    const offer = human.capture({ wcId: 10, username: 'me@a', passwordBytes: bytes });
    assert.equal(offer, null, 're-logging in with the exact saved credential offers nothing');
    // The held record was created then dropped; the incoming array is still wiped.
    assert.ok(
      bytes.every((b) => b === 0),
      'incoming password array zeroized even when the offer is dropped'
    );
  } finally {
    rm(dir);
  }
});

test('capture: same username, CHANGED password → UPDATE (the offer is NOT suppressed)', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    store.saveItem('work', { type: 'login', username: 'me@a', password: 'old-pw', origin: A });
    const offer = human.capture({ wcId: 10, username: 'me@a', passwordBytes: bytesOf('new-pw') });
    assert.ok(offer, 'a changed password still offers an update');
    assert.equal(offer.model.mode, 'update');
    assert.equal(offer.model.defaultVaultId, 'work');
  } finally {
    rm(dir);
  }
});

test("captureFinalize: an unchanged login discovered AFTER unlock → { reason: 'unchanged' } (no offer)", async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    store.saveItem('work', { type: 'login', username: 'me@a', password: 'unchanged', origin: A });
    store.lockNow();
    const locked = human.capture({ wcId: 10, username: 'me@a', passwordBytes: bytesOf('unchanged') });
    assert.equal(locked.model.mode, 'locked', 'held for unlock while the vault is locked');
    await store.unlock(MASTER);
    // Disposition (needs unlock) now finds the credential unchanged → no capture sheet.
    // NOT a bare null: the operator typed their master password for this save, so the
    // chrome needs a reason to show ("already saved") rather than silently doing nothing.
    assert.deepEqual(human.captureFinalize(locked.captureId), { reason: 'unchanged' });
  } finally {
    rm(dir);
  }
});

/* --- DD4 (Mission 21, Flight 4, Leg 2 — password-field-roles): rotation
   disposition by provenanced current-password match — AC12/AC13/AC14/AC15 */

test('AC14(a): no username field, ONE reachable login whose password equals current → UPDATE to it', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    store.saveItem('work', { type: 'login', username: null, password: 'OldPass1!', origin: A });
    const offer = human.capture({
      wcId: 10,
      username: null,
      usernameDetected: false,
      passwordBytes: bytesOf('NewPass2!'),
      currentPasswordBytes: bytesOf('OldPass1!')
    });
    assert.ok(offer);
    assert.equal(offer.model.mode, 'update');
    assert.equal(offer.model.defaultVaultId, 'work');
  } finally {
    rm(dir);
  }
});

test("AC14(b): TWO reachable logins sharing the current password → today's origin+username rule, never an update by guess", async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    store.saveItem('work', { type: 'login', username: 'alice', password: 'SharedPw!', origin: A });
    store.saveItem('global', { type: 'login', username: 'bob', password: 'SharedPw!', origin: A });
    const offer = human.capture({
      wcId: 10,
      username: null,
      usernameDetected: false,
      passwordBytes: bytesOf('NewPass2!'),
      currentPasswordBytes: bytesOf('SharedPw!')
    });
    assert.ok(offer);
    assert.equal(
      offer.model.mode,
      'save',
      'two password-matched candidates fall through to the origin+username rule — neither is guessed'
    );
  } finally {
    rm(dir);
  }
});

test("AC14(c): a PROVENANCED username that disagrees with the single password-matched row → today's rule (never the password-matched item)", async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    store.saveItem('work', { type: 'login', username: 'alice', password: 'OldPass1!', origin: A });
    const offer = human.capture({
      wcId: 10,
      username: 'bob', // provenanced, disagrees with the matched row's 'alice'
      usernameDetected: true,
      passwordBytes: bytesOf('NewPass2!'),
      currentPasswordBytes: bytesOf('OldPass1!')
    });
    assert.ok(offer);
    assert.equal(offer.model.mode, 'save', "a disagreeing provenanced username excludes the row from DD4's candidates");
  } finally {
    rm(dir);
  }
});

test('AC14(d): detected-but-UNPROVENANCED username + a password match against a NULL-username stored row → UPDATE survives applyUsernameDowngrade (matchedByPassword exemption)', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    // The STORED login itself has no username (a genuinely username-less
    // change-password rotation, saved before this leg, or from a form that
    // never carried one) — reassigning rec.username to the matched row's OWN
    // username leaves it null, so ONLY the matchedByPassword exemption (not
    // the reassignment) is what keeps applyUsernameDowngrade from firing:
    // without it, `rec.username == null && rec.usernameDetected === true` is
    // exactly DD3c's own downgrade trigger.
    store.saveItem('work', { type: 'login', username: null, password: 'OldPass1!', origin: A });
    const offer = human.capture({
      wcId: 10,
      username: null, // read-only prefilled field, never typed into — unprovenanced
      usernameDetected: true,
      passwordBytes: bytesOf('NewPass2!'),
      currentPasswordBytes: bytesOf('OldPass1!')
    });
    assert.ok(offer);
    assert.equal(
      offer.model.mode,
      'update',
      "DD3c's downgrade (username detected but unprovenanced) must NOT undo a password-matched update"
    );
    assert.equal(offer.model.username, null);
  } finally {
    rm(dir);
  }
});

test('AC14(d)b: detected-but-UNPROVENANCED username + a password match against a NAMED stored row → UPDATE, username reassigned', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    store.saveItem('work', { type: 'login', username: 'alice', password: 'OldPass1!', origin: A });
    const offer = human.capture({
      wcId: 10,
      username: null, // read-only prefilled field, never typed into — unprovenanced
      usernameDetected: true,
      passwordBytes: bytesOf('NewPass2!'),
      currentPasswordBytes: bytesOf('OldPass1!')
    });
    assert.ok(offer);
    assert.equal(offer.model.mode, 'update');
    assert.equal(offer.model.username, 'alice', "rec.username was reassigned to the matched row's own username");
  } finally {
    rm(dir);
  }
});

test('AC14(e): the same password match through the LOCKED path (capture → captureFinalize after unlock) → UPDATE', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    store.saveItem('work', { type: 'login', username: null, password: 'OldPass1!', origin: A });
    store.lockNow();
    const held = human.capture({
      wcId: 10,
      username: null,
      usernameDetected: false,
      passwordBytes: bytesOf('NewPass2!'),
      currentPasswordBytes: bytesOf('OldPass1!')
    });
    assert.equal(held.model.mode, 'locked');
    await store.unlock(MASTER);
    const finalized = human.captureFinalize(held.captureId);
    assert.ok(finalized.captureId);
    assert.equal(finalized.model.mode, 'update');
  } finally {
    rm(dir);
  }
});

test("AC14(g)/design-review-HIGH: captureSave persists the MATCHED row's username, not null — an update, not a duplicate item", async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    store.saveItem('work', { type: 'login', username: 'alice', password: 'old', origin: A });
    const beforeCount = store.listItems('work').length;

    const offer = human.capture({
      wcId: 10,
      username: null,
      usernameDetected: false,
      passwordBytes: bytesOf('new'),
      currentPasswordBytes: bytesOf('old')
    });
    assert.ok(offer);
    assert.equal(offer.model.mode, 'update');
    assert.equal(offer.model.username, 'alice', "rec.username reassigned to the matched row's username after dispose");

    const saved = human.captureSave({ captureId: offer.captureId, vaultId: 'work' });
    assert.deepEqual(saved, { saved: true });

    const items = store.listItems('work');
    assert.equal(items.length, beforeCount, 'an UPDATE, not a new item');
    const item = items.find((i) => i.password === 'new');
    assert.ok(item, 'the rotated password was persisted');
    assert.equal(item.username, 'alice', 'the stored username survived the update — not silently blanked to null');
  } finally {
    rm(dir);
  }
});

test("AC12: never match an EMPTY current-password value (an empty currentPasswordBytes never runs DD4's match)", async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    // A login whose stored password happens to be the empty string, with a
    // username that does NOT tie to the capture's own (so the ONLY way this
    // could resolve 'update' is a DD4 match against the empty stored value).
    store.saveItem('work', { type: 'login', username: 'someone-else', password: '', origin: A });
    const offer = human.capture({
      wcId: 10,
      username: null,
      usernameDetected: false,
      passwordBytes: bytesOf('NewPass2!'),
      currentPasswordBytes: new Uint8Array(0) // explicitly EMPTY, not absent
    });
    assert.ok(offer);
    assert.equal(
      offer.model.mode,
      'save',
      "an empty currentPasswordBytes must never match a login's own empty stored password"
    );
  } finally {
    rm(dir);
  }
});

test("AC12: no currentPassword at all never triggers the DD4 match path (today's rule alone decides)", async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    store.saveItem('work', { type: 'login', username: 'someone-else', password: 'anything', origin: A });
    const offer = human.capture({
      wcId: 10,
      username: null,
      usernameDetected: false,
      passwordBytes: bytesOf('NewPass2!')
      // no currentPasswordBytes at all
    });
    assert.ok(offer);
    assert.equal(offer.model.mode, 'save');
  } finally {
    rm(dir);
  }
});

test("AC15: capture()'s unlocked branch zeroizes+DELETES rec.currentPassword once disposition is computed", async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    const offer = human.capture({
      wcId: 10,
      username: 'me@a',
      usernameDetected: true,
      passwordBytes: bytesOf('new-pw'),
      currentPasswordBytes: bytesOf('old-pw')
    });
    assert.ok(offer, 'a save offer was returned (no stored login yet)');
    const dropped = human.dropCapturesForTab(10);
    assert.equal(dropped.length, 1);
    assert.equal(
      dropped[0].currentPassword,
      undefined,
      'currentPassword was DELETED (not merely zeroized-in-place) once disposition was computed'
    );
  } finally {
    rm(dir);
  }
});

test("AC15: captureFinalize's login dispatch also zeroizes+DELETES rec.currentPassword", async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    store.lockNow();
    const held = human.capture({
      wcId: 10,
      username: 'me@a',
      usernameDetected: true,
      passwordBytes: bytesOf('new-pw'),
      currentPasswordBytes: bytesOf('old-pw')
    });
    assert.equal(held.model.mode, 'locked');
    await store.unlock(MASTER);
    const finalized = human.captureFinalize(held.captureId);
    assert.ok(finalized.captureId);
    const dropped = human.dropCapturesForTab(10);
    assert.equal(dropped.length, 1);
    assert.equal(dropped[0].currentPassword, undefined);
  } finally {
    rm(dir);
  }
});

test("AC15b: capture()'s GATE-REFUSAL early return zeroizes an incoming currentPasswordBytes, symmetric with passwordBytes", async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir, { setup: false }); // not set up -> gate refusal
    const currentBytes = bytesOf('old-pw');
    const offer = human.capture({
      wcId: 10,
      username: 'me@a',
      usernameDetected: true,
      passwordBytes: bytesOf('new-pw'),
      currentPasswordBytes: currentBytes
    });
    assert.equal(offer, null);
    assert.ok(
      currentBytes.every((b) => b === 0),
      'the incoming currentPasswordBytes array is zeroized even on a gate refusal'
    );
  } finally {
    rm(dir);
  }
});

/* ------------------------------------------------------------------- gate (integration) */

test('capture GATE: not set up → null (no offer), incoming array still zeroized', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir, { setup: false });
    const bytes = bytesOf('pw');
    assert.equal(human.capture({ wcId: 10, username: 'me@a', passwordBytes: bytes }), null);
    assert.ok(
      bytes.every((b) => b === 0),
      'password array zeroized even when dropped'
    );
  } finally {
    rm(dir);
  }
});

test('capture LOCKED: holds the credential + returns a mode:locked offer (unlock-to-save), incoming array wiped', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    store.lockNow();
    const bytes = bytesOf('pw');
    const offer = human.capture({ wcId: 10, username: 'me@a', passwordBytes: bytes });
    assert.ok(offer && typeof offer.captureId === 'string', 'a record is held even while locked');
    assert.equal(offer.model.mode, 'locked', 'the chrome is told to prompt an unlock first');
    assert.equal(offer.model.origin, A);
    assert.equal(offer.model.username, 'me@a');
    // No disposition (save/update) is computed while locked — it is deferred to finalize.
    assert.equal(offer.model.defaultVaultId, undefined);
    // The incoming deserialized array is still wiped (the password is COPIED into the held record).
    assert.ok(bytes.every((b) => b === 0));
  } finally {
    rm(dir);
  }
});

test('captureFinalize: after unlock, resolves the deferred SAVE/UPDATE offer; then captureSave persists', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    store.lockNow();
    const locked = human.capture({ wcId: 10, username: 'me@a', passwordBytes: bytesOf('the-pass') });
    assert.equal(locked.model.mode, 'locked');

    // Still locked → finalize refuses (nothing to show yet).
    assert.deepEqual(
      human.captureFinalize(locked.captureId),
      { reason: 'locked' },
      'finalize refuses, with a reason, while still locked'
    );

    // Unlock, then finalize → a normal SAVE offer (no saved login for this origin).
    await store.unlock(MASTER);
    const final = human.captureFinalize(locked.captureId);
    assert.equal(final.captureId, locked.captureId);
    assert.equal(final.model.mode, 'save');
    assert.equal(final.model.defaultVaultId, 'work');
    assert.deepEqual(final.model.choices, ['work', 'global']);

    // The Save then persists the held credential as a new login.
    assert.deepEqual(human.captureSave({ captureId: locked.captureId, vaultId: 'work' }), { saved: true });
    const saved = store.listItems('work').find((i) => i.username === 'me@a');
    assert.ok(saved && saved.password === 'the-pass', 'the held password was persisted after unlock');
  } finally {
    rm(dir);
  }
});

test("captureFinalize: unknown / already-dropped captureId → { reason: 'expired' }", async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    assert.deepEqual(human.captureFinalize('nope'), { reason: 'expired' });
  } finally {
    rm(dir);
  }
});

test('capture GATE: burner tab → null (no offer), never falls back to global (DD9)', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    const bytes = bytesOf('pw');
    assert.equal(human.capture({ wcId: 20, username: 'me@a', passwordBytes: bytes }), null);
    assert.ok(bytes.every((b) => b === 0));
  } finally {
    rm(dir);
  }
});

test('capture GATE: closed tab (fromId null / no origin) → null', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    assert.equal(human.capture({ wcId: 30, username: 'me@a', passwordBytes: bytesOf('pw') }), null);
  } finally {
    rm(dir);
  }
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
      {
        type: items[0].type,
        title: items[0].title,
        origin: items[0].origin,
        username: items[0].username,
        password: items[0].password
      },
      { type: 'login', title: A_HOST, origin: A, username: 'me@a', password: 'the-pass' }
    );
  } finally {
    rm(dir);
  }
});

test('captureSave (save): defaults to the active jar but global is selectable', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    const offer = human.capture({ wcId: 10, username: 'me@a', passwordBytes: bytesOf('gp') });
    assert.deepEqual(human.captureSave({ captureId: offer.captureId, vaultId: 'global' }), { saved: true });
    assert.equal(store.listItems('global').find((i) => i.username === 'me@a').password, 'gp');
    assert.equal(store.listItems('work').length, 0, 'nothing landed in the jar when global was chosen');
  } finally {
    rm(dir);
  }
});

test('captureSave (save): a vaultId NOT in the offer choices is refused, nothing saved', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    const offer = human.capture({ wcId: 10, username: 'me@a', passwordBytes: bytesOf('pw') });
    // 'personal' is a real jar but not among this offer's choices ([work, global]).
    assert.deepEqual(human.captureSave({ captureId: offer.captureId, vaultId: 'personal' }), {
      saved: false,
      reason: 'invalid-vault'
    });
    assert.equal(store.listItems('personal').length, 0);
    assert.equal(store.listItems('work').length, 0);
  } finally {
    rm(dir);
  }
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
  } finally {
    rm(dir);
  }
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
      notes: 'recovery codes: 1234'
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
  } finally {
    rm(dir);
  }
});

test('captureSave (N1): a saveItem throw still zeroizes+drops the held record and clears the timer', async () => {
  const dir = tmpDir();
  try {
    const { store, human, timer } = await makeHarness(dir);
    const offer = human.capture({ wcId: 10, username: 'me@a', passwordBytes: bytesOf('pw') });
    assert.equal(timer.pending.size, 1, 'the drop timer is armed on capture');
    // Simulate a disk error on persist.
    store.saveItem = () => {
      throw new Error('disk full');
    };
    assert.throws(() => human.captureSave({ captureId: offer.captureId, vaultId: 'work' }), /disk full/);
    // The record was dropped (zeroized) in the finally — not left alive until the 2-min timeout.
    assert.deepEqual(
      human.captureSave({ captureId: offer.captureId, vaultId: 'work' }),
      { saved: false },
      'record dropped on save error'
    );
    assert.equal(timer.pending.size, 0, 'the drop timer is cleared on save error');
  } finally {
    rm(dir);
  }
});

test('captureSave: re-checks unlock — an idle-lock between offer and save → { saved:false, reason:locked }', async () => {
  const dir = tmpDir();
  try {
    const { store, human } = await makeHarness(dir);
    const offer = human.capture({ wcId: 10, username: 'me@a', passwordBytes: bytesOf('pw') });
    store.lockNow(); // idle-locked after the offer was raised
    assert.deepEqual(human.captureSave({ captureId: offer.captureId, vaultId: 'work' }), {
      saved: false,
      reason: 'locked'
    });
  } finally {
    rm(dir);
  }
});

test('captureSave: unknown / already-dropped captureId → { saved:false }', async () => {
  const dir = tmpDir();
  try {
    const { human } = await makeHarness(dir);
    assert.deepEqual(human.captureSave({ captureId: 'nope', vaultId: 'work' }), { saved: false });
  } finally {
    rm(dir);
  }
});

/* --------------------------------------------------- held-record drop on every exit path */

test('drop on SAVE: the record is gone (a second save no-ops) and the timer is cleared', async () => {
  const dir = tmpDir();
  try {
    const { human, timer } = await makeHarness(dir);
    const offer = human.capture({ wcId: 10, username: 'me@a', passwordBytes: bytesOf('pw') });
    assert.equal(timer.pending.size, 1, 'the drop timer is armed on capture');
    human.captureSave({ captureId: offer.captureId, vaultId: 'work' });
    assert.deepEqual(
      human.captureSave({ captureId: offer.captureId, vaultId: 'work' }),
      { saved: false },
      'record dropped after save'
    );
    assert.equal(timer.pending.size, 0, 'the drop timer is cleared on save');
  } finally {
    rm(dir);
  }
});

test('drop on DISMISS: captureDismiss zeroizes+drops the record and clears the timer', async () => {
  const dir = tmpDir();
  try {
    const { human, timer } = await makeHarness(dir);
    const offer = human.capture({ wcId: 10, username: 'me@a', passwordBytes: bytesOf('pw') });
    human.captureDismiss(offer.captureId);
    assert.deepEqual(
      human.captureSave({ captureId: offer.captureId, vaultId: 'work' }),
      { saved: false },
      'record dropped after dismiss'
    );
    assert.equal(timer.pending.size, 0, 'the drop timer is cleared on dismiss');
    // Idempotent: dismissing an already-dropped id is a harmless no-op.
    human.captureDismiss(offer.captureId);
  } finally {
    rm(dir);
  }
});

test('drop on SUPERSESSION: a new capture for the same tab evicts the prior record (last-wins)', async () => {
  const dir = tmpDir();
  try {
    const { human, timer } = await makeHarness(dir);
    const first = human.capture({ wcId: 10, username: 'a@a', passwordBytes: bytesOf('p1') });
    const second = human.capture({ wcId: 10, username: 'b@a', passwordBytes: bytesOf('p2') });
    assert.notEqual(first.captureId, second.captureId);
    // The prior record is gone; only the newest survives.
    assert.deepEqual(
      human.captureSave({ captureId: first.captureId, vaultId: 'work' }),
      { saved: false },
      'prior record evicted'
    );
    assert.equal(timer.pending.size, 1, 'exactly one live timer (the prior was cleared, the new armed)');
    assert.deepEqual(
      human.captureSave({ captureId: second.captureId, vaultId: 'work' }),
      { saved: true },
      'newest record is alive'
    );
  } finally {
    rm(dir);
  }
});

test('drop on TIMEOUT: firing the injected drop timer evicts the record (no wall-clock wait)', async () => {
  const dir = tmpDir();
  try {
    const { human, timer } = await makeHarness(dir);
    const offer = human.capture({ wcId: 10, username: 'me@a', passwordBytes: bytesOf('pw') });
    assert.equal(timer.pending.size, 1);
    timer.fireAll(); // the ~2-min safety timeout elapses
    assert.deepEqual(
      human.captureSave({ captureId: offer.captureId, vaultId: 'work' }),
      { saved: false },
      'record dropped on timeout'
    );
    assert.equal(timer.pending.size, 0);
  } finally {
    rm(dir);
  }
});
