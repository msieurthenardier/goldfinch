'use strict';

// Unit tests for VaultStore.importLogins / _importLogins (M19 F1 Leg 1 /
// DD2, DD4, DD9, DD11): lazy-vault creation, exactly-one-write discipline,
// double-import idempotence, the `changed` (imported)-copy landing,
// Replace/Merge semantics, per-row `failed` + write-sink-throw propagation,
// gating/lock refusals, the MAX_IMPORT_ITEMS/MAX_PAYLOAD_BYTES single-literal
// ownership (AC15b), and the no-plaintext byte-scan (AC17).
//
// Electron-free: real temp dirs + FAST scrypt (the vault-restore-merge.test.js
// idiom).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const vs = require('../../src/main/vault/vault-store');

const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MASTER = 'correct horse battery staple';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-vault-import-logins-'));
}
function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
// name==slug jar fixture (the byte-scan/fixture convention — M18 F3 debrief).
const WORK_JAR = { id: 'work', name: 'work', color: '#000', partition: 'persist:container:work', retentionDays: 30 };

function makeStore(dir, jars = [WORK_JAR]) {
  // Fixed clock (the vault-restore-merge.test.js note): _normalizeItem always
  // stamps updatedAt = now(), so a fixed clock makes createdAt/updatedAt
  // deterministic for equality checks.
  return vs.load(dir, { scryptParams: FAST_SCRYPT, listJars: () => jars, now: () => 1000 });
}

function candidateRow(overrides = {}) {
  return {
    line: 1,
    title: 'Example',
    origin: 'https://a.example',
    username: 'alice',
    password: 'hunter2',
    ...overrides
  };
}

function vaultPath(dir, vaultId) {
  return path.join(dir, 'vaults', `${vaultId}.gfvault`);
}

// ---------------------------------------------------------------------------
// AC9 — lazy-vault creation
// ---------------------------------------------------------------------------

test('AC9: importLogins into an uncreated global vault AND an uncreated persistent jar each lazy-create the .gfvault, cache the key, and land correctly-shaped items', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    // setup() itself always writes an (empty) global .gfvault — the "uncreated
    // global vault" scenario this AC asks for is therefore simulated by
    // removing that file directly (a real profile can never reach this state
    // through the app's own API, since deleteVault refuses GLOBAL_ID — this
    // is a white-box exercise of the lazy-branch code path, not a claim that
    // the state is otherwise reachable).
    fs.unlinkSync(vaultPath(dir, 'global'));
    assert.equal(fs.existsSync(vaultPath(dir, 'global')), false);
    assert.equal(fs.existsSync(vaultPath(dir, 'work')), false);

    const globalResult = store.importLogins('global', [
      candidateRow({ line: 1 }),
      candidateRow({ line: 2, origin: 'https://b.example', notes: 'a note' })
    ]);
    assert.equal(globalResult.written, true);
    assert.equal(fs.existsSync(vaultPath(dir, 'global')), true, 'lazy-created global .gfvault');

    const workResult = store.importLogins('work', [candidateRow({ line: 1 })]);
    assert.equal(workResult.written, true);
    assert.equal(fs.existsSync(vaultPath(dir, 'work')), true, 'lazy-created work .gfvault');

    const globalItems = store.listItems('global');
    assert.equal(globalItems.length, 2);
    for (const item of globalItems) {
      assert.equal(item.matchMode, 'registrable-domain');
      assert.equal(typeof item.id, 'string');
      assert.ok(item.id.length > 0);
      assert.equal(typeof item.createdAt, 'number');
      assert.equal(typeof item.updatedAt, 'number');
    }
    assert.equal(globalItems.find((i) => i.origin === 'https://a.example').notes, undefined, 'no note -> absent');
    assert.equal(globalItems.find((i) => i.origin === 'https://b.example').notes, 'a note');

    const workItems = store.listItems('work');
    assert.equal(workItems.length, 1);
    assert.equal(workItems[0].matchMode, 'registrable-domain');
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// AC10 — exactly ONE write per call
// ---------------------------------------------------------------------------

test('AC10: exactly ONE vault write per call — instance-method monkeypatch AND on-disk bytes change exactly once', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    store.saveItem('work', {
      type: 'login',
      title: 'Seed',
      origin: 'https://seed.example',
      username: 's',
      password: 'seed-pw'
    });
    const beforeBytes = fs.readFileSync(vaultPath(dir, 'work'));

    const candidates = [];
    for (let i = 0; i < 50; i++) {
      candidates.push(candidateRow({ line: i + 1, origin: `https://row${i}.example` }));
    }

    // writeFileAtomic is a destructured CJS import (vault-store.js:40) and
    // cannot be spied through its module — an INSTANCE-method monkeypatch on
    // _writeVault (wrapping the original) is the sole valid technique.
    const originalWriteVault = store._writeVault.bind(store);
    let writeCalls = 0;
    store._writeVault = (...args) => {
      writeCalls++;
      return originalWriteVault(...args);
    };

    const result = store.importLogins('work', candidates, { mode: 'merge' });
    assert.equal(writeCalls, 1, 'exactly one _writeVault call for a 50-row import');
    assert.equal(result.written, true);

    const afterBytes = fs.readFileSync(vaultPath(dir, 'work'));
    assert.notDeepEqual(afterBytes, beforeBytes, 'the on-disk bytes changed exactly once (the second signal)');
  } finally {
    rm(dir);
  }
});

test('AC10: zero writes and a byte-identical file when every candidate is duplicate (written: false)', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    store.importLogins('work', [candidateRow({ line: 1 })]); // lands one item.
    const beforeBytes = fs.readFileSync(vaultPath(dir, 'work'));

    const originalWriteVault = store._writeVault.bind(store);
    let writeCalls = 0;
    store._writeVault = (...args) => {
      writeCalls++;
      return originalWriteVault(...args);
    };

    const result = store.importLogins('work', [candidateRow({ line: 1 })], { mode: 'merge' });
    assert.equal(result.written, false);
    assert.deepEqual(result.results, [{ line: 1, outcome: 'duplicate' }]);
    assert.equal(writeCalls, 0, 'no write when nothing lands');
    assert.deepEqual(fs.readFileSync(vaultPath(dir, 'work')), beforeBytes, 'file is byte-identical');
  } finally {
    rm(dir);
  }
});

test('importLogins([]) on an uncreated destination performs no write and returns written: false', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    const result = store.importLogins('work', []);
    assert.deepEqual(result, { results: [], written: false });
    assert.equal(fs.existsSync(vaultPath(dir, 'work')), false, 'no file created for an empty import');
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// AC11 — double-import idempotence
// ---------------------------------------------------------------------------

test('AC11: importing the same 10-row candidate set twice with mode merge leaves listItems at 10 and the second call is all-duplicate, written: false', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    const candidates = [];
    for (let i = 0; i < 10; i++) {
      candidates.push(candidateRow({ line: i + 1, origin: `https://row${i}.example`, username: `user${i}` }));
    }

    const first = store.importLogins('work', candidates, { mode: 'merge' });
    assert.equal(first.written, true);
    assert.equal(store.listItems('work').length, 10);

    const second = store.importLogins('work', candidates, { mode: 'merge' });
    assert.equal(second.written, false);
    assert.equal(second.results.length, 10);
    assert.ok(second.results.every((r) => r.outcome === 'duplicate'));
    assert.equal(store.listItems('work').length, 10, 'no duplicates landed');
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// AC12 — `changed` lands as a marked copy; the original survives untouched
// ---------------------------------------------------------------------------

test('AC12: a changed row lands as a NEW item titled "<title> (imported)" with a fresh id; the pre-existing item is unchanged', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    const original = store.importLogins('work', [candidateRow({ line: 1, title: 'Original Title' })]).results;
    assert.equal(original[0].outcome, 'imported');
    const beforeItems = store.listItems('work');
    assert.equal(beforeItems.length, 1);
    const preExisting = beforeItems[0];

    const changedResult = store.importLogins(
      'work',
      [candidateRow({ line: 1, title: 'Original Title', password: 'a-new-password' })],
      { mode: 'merge' }
    );
    assert.equal(changedResult.written, true);
    assert.deepEqual(changedResult.results, [{ line: 1, outcome: 'changed' }]);

    const afterItems = store.listItems('work');
    assert.equal(afterItems.length, 2);
    const stillOriginal = afterItems.find((i) => i.id === preExisting.id);
    assert.deepEqual(stillOriginal, preExisting, 'the pre-existing item is byte-identical to before');
    const copy = afterItems.find((i) => i.id !== preExisting.id);
    assert.equal(copy.title, 'Original Title (imported)');
    assert.notEqual(copy.id, preExisting.id, 'a fresh id');
    assert.equal(copy.password, 'a-new-password');
  } finally {
    rm(dir);
  }
});

test('Edge case: re-importing after a changed landing is duplicate against its own copy — no third item', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    store.importLogins('work', [candidateRow({ line: 1 })]);
    store.importLogins('work', [candidateRow({ line: 1, password: 'changed-pw' })], { mode: 'merge' });
    assert.equal(store.listItems('work').length, 2, 'original + one (imported) copy');

    const rerun = store.importLogins('work', [candidateRow({ line: 1, password: 'changed-pw' })], { mode: 'merge' });
    assert.equal(rerun.written, false);
    assert.deepEqual(rerun.results, [{ line: 1, outcome: 'duplicate' }]);
    assert.equal(store.listItems('work').length, 2, 'no unbounded copies');
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// AC13 — mode requirement + Replace/Merge semantics
// ---------------------------------------------------------------------------

test('AC13: a non-empty destination with no/invalid mode throws VaultStateError and writes nothing', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    store.saveItem('work', {
      type: 'login',
      title: 'Seed',
      origin: 'https://seed.example',
      username: 's',
      password: 'seed-pw'
    });
    const before = fs.readFileSync(vaultPath(dir, 'work'));

    assert.throws(
      () => store.importLogins('work', [candidateRow()]),
      (e) => e instanceof vs.VaultStateError
    );
    assert.throws(
      () => store.importLogins('work', [candidateRow()], { mode: 'bogus' }),
      (e) => e instanceof vs.VaultStateError
    );
    assert.deepEqual(fs.readFileSync(vaultPath(dir, 'work')), before, 'nothing written on refusal');
  } finally {
    rm(dir);
  }
});

test('AC13: replace on a destination holding a login, a card, and a note leaves ONLY the imported logins, under the SAME vault key', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    store.saveItem('work', {
      type: 'login',
      title: 'Old Login',
      origin: 'https://old.example',
      username: 'o',
      password: 'old-pw'
    });
    store.saveItem('work', { type: 'card', title: 'My Card', number: '4111111111111111', cvv: '123', expiry: '01/30' });
    store.saveItem('work', { type: 'note', title: 'My Note', body: 'secret note' });
    assert.equal(store.listItems('work').length, 3);

    const beforeDoc = JSON.parse(fs.readFileSync(vaultPath(dir, 'work'), 'utf8'));

    const result = store.importLogins(
      'work',
      [candidateRow({ line: 1 }), candidateRow({ line: 2, origin: 'https://z.example' })],
      {
        mode: 'replace'
      }
    );
    assert.equal(result.written, true);

    const afterItems = store.listItems('work');
    assert.equal(afterItems.length, 2);
    assert.ok(afterItems.every((i) => i.type === 'login'));

    const afterDoc = JSON.parse(fs.readFileSync(vaultPath(dir, 'work'), 'utf8'));
    assert.deepEqual(
      afterDoc.envelopes,
      beforeDoc.envelopes,
      'the .gfvault envelopes are byte-identical before/after — same vault key'
    );
  } finally {
    rm(dir);
  }
});

test('AC13: merge on a destination holding 3 items keeps all 3 plus the new logins', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    store.saveItem('work', {
      type: 'login',
      title: 'Old Login',
      origin: 'https://old.example',
      username: 'o',
      password: 'old-pw'
    });
    store.saveItem('work', { type: 'card', title: 'My Card', number: '4111111111111111', cvv: '123', expiry: '01/30' });
    store.saveItem('work', { type: 'note', title: 'My Note', body: 'secret note' });

    const result = store.importLogins('work', [candidateRow({ line: 1 })], { mode: 'merge' });
    assert.equal(result.written, true);
    assert.equal(store.listItems('work').length, 4, 'all 3 pre-existing items plus 1 new login');
  } finally {
    rm(dir);
  }
});

test('AC13 edge case: an empty/uncreated destination accepts a missing mode', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    // Uncreated.
    assert.doesNotThrow(() => store.importLogins('work', [candidateRow({ line: 1 })]));
    // Now empty via replace-with-nothing is not directly reachable, but an
    // EXISTING doc with zero items (e.g. every prior item explicitly
    // deleted) also ignores mode — simulate by writing an empty vault
    // directly through saveItem+deleteItem.
    const saved = store.saveItem('global', {
      type: 'login',
      title: 'Temp',
      origin: 'https://t.example',
      username: 't',
      password: 't-pw'
    });
    store.deleteItem('global', saved.id);
    assert.equal(store.listItems('global').length, 0);
    assert.doesNotThrow(() => store.importLogins('global', [candidateRow({ line: 1 })]));
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// Flight-end review fix — Blocking #1: intra-file dedupe must hold
// UNCONDITIONALLY (Leg 1 ruling 6), including for an uncreated/empty/replace
// destination. Before the fix, `_importLogins` bypassed `planLogins`
// entirely in those three cases (`skipDedupe`) and stamped every candidate
// 'new' — a same-identity pair in ONE candidate batch both landed, instead
// of the second being classified `duplicate`/`changed` against the first.
// ---------------------------------------------------------------------------

test('Blocking #1a: first import into an UNCREATED jar vault with an intra-file duplicate pair (identical secrets) lands ONE item — imported + duplicate', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    assert.equal(fs.existsSync(vaultPath(dir, 'work')), false, 'work vault starts uncreated');

    const originalWriteVault = store._writeVault.bind(store);
    let writeCalls = 0;
    store._writeVault = (...args) => {
      writeCalls++;
      return originalWriteVault(...args);
    };

    const result = store.importLogins('work', [
      candidateRow({ line: 1 }),
      candidateRow({ line: 2 }) // same origin/username/password/notes as line 1.
    ]);

    assert.equal(result.written, true);
    assert.deepEqual(result.results, [
      { line: 1, outcome: 'imported' },
      { line: 2, outcome: 'duplicate' }
    ]);
    assert.equal(writeCalls, 1, 'exactly one write on a lazy-create path too');

    const items = store.listItems('work');
    assert.equal(items.length, 1, 'only one item landed for the duplicate pair');
    assert.equal(items[0].origin, 'https://a.example');
    assert.equal(items[0].title, 'Example', 'the surviving item is the unmarked original, not "(imported)"');
  } finally {
    rm(dir);
  }
});

test('Blocking #1b: an UNCREATED destination with an intra-file pair differing only in password lands TWO items — imported + changed', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    assert.equal(fs.existsSync(vaultPath(dir, 'work')), false, 'work vault starts uncreated');

    const result = store.importLogins('work', [
      candidateRow({ line: 1, title: 'Original Title' }),
      candidateRow({ line: 2, title: 'Original Title', password: 'a-different-password' })
    ]);

    assert.equal(result.written, true);
    assert.deepEqual(result.results, [
      { line: 1, outcome: 'imported' },
      { line: 2, outcome: 'changed' }
    ]);

    const items = store.listItems('work');
    assert.equal(items.length, 2);
    const original = items.find((i) => i.title === 'Original Title');
    const copy = items.find((i) => i.title === 'Original Title (imported)');
    assert.ok(original, 'the first row lands under its unmarked title');
    assert.ok(copy, 'the second row lands as a marked (imported) copy');
    assert.notEqual(original.id, copy.id);
    assert.equal(copy.password, 'a-different-password');
  } finally {
    rm(dir);
  }
});

test('Blocking #1c: mode replace into a populated destination with an intra-file duplicate pair discards the old items and lands exactly ONE new item — imported + duplicate', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    const seeded = store.saveItem('work', {
      type: 'login',
      title: 'Old Login',
      origin: 'https://old.example',
      username: 'o',
      password: 'old-pw'
    });
    assert.equal(store.listItems('work').length, 1);

    const originalWriteVault = store._writeVault.bind(store);
    let writeCalls = 0;
    store._writeVault = (...args) => {
      writeCalls++;
      return originalWriteVault(...args);
    };

    const result = store.importLogins(
      'work',
      [
        candidateRow({ line: 1 }),
        candidateRow({ line: 2 }) // same identity + secrets as line 1 — intra-file duplicate.
      ],
      { mode: 'replace' }
    );

    assert.equal(result.written, true);
    assert.deepEqual(result.results, [
      { line: 1, outcome: 'imported' },
      { line: 2, outcome: 'duplicate' }
    ]);
    assert.equal(writeCalls, 1, 'exactly one write for replace mode too');

    const items = store.listItems('work');
    assert.equal(items.length, 1, 'the old item is gone; exactly one new item for the duplicated identity');
    assert.notEqual(items[0].id, seeded.id);
    assert.equal(items[0].origin, 'https://a.example');
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// AC14 — per-row `failed`, and a write-sink throw propagates cleanly
// ---------------------------------------------------------------------------

test('AC14: a monkeypatched _normalizeItem that throws for one candidate yields exactly one failed, N-1 imported, ONE write', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });

    const candidates = [
      candidateRow({ line: 1, origin: 'https://a.example' }),
      candidateRow({ line: 2, origin: 'https://b.example' }),
      candidateRow({ line: 3, origin: 'https://boom.example' })
    ];

    const originalNormalize = store._normalizeItem.bind(store);
    store._normalizeItem = (item, existingCreatedAt) => {
      if (item.origin === 'https://boom.example') {
        throw new Error('injected normalize failure');
      }
      return originalNormalize(item, existingCreatedAt);
    };

    const originalWriteVaultForKey = store._writeVaultForKey.bind(store);
    let writeCalls = 0;
    store._writeVaultForKey = (...args) => {
      writeCalls++;
      return originalWriteVaultForKey(...args);
    };

    const result = store.importLogins('work', candidates);
    assert.equal(writeCalls, 1, 'exactly one write despite the per-row failure');
    const byLine = new Map(result.results.map((r) => [r.line, r]));
    assert.equal(byLine.get(1).outcome, 'imported');
    assert.equal(byLine.get(2).outcome, 'imported');
    assert.equal(byLine.get(3).outcome, 'failed');
    assert.equal(byLine.get(3).reason, 'injected normalize failure');
    assert.equal(store.listItems('work').length, 2, 'the failed row never landed');
  } finally {
    rm(dir);
  }
});

test('AC14: a write-sink throw (monkeypatched _writeVault) propagates, and listItems afterward equals the pre-call contents', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    store.saveItem('work', {
      type: 'login',
      title: 'Seed',
      origin: 'https://seed.example',
      username: 's',
      password: 'seed-pw'
    });
    const before = store.listItems('work');

    store._writeVault = () => {
      throw new Error('injected write-sink failure');
    };

    assert.throws(
      () => store.importLogins('work', [candidateRow({ line: 1 })], { mode: 'merge' }),
      (e) => /injected write-sink failure/.test(e.message)
    );

    // Restore the write sink and confirm nothing landed.
    delete store._writeVault;
    const after = store.listItems('work');
    assert.deepEqual(after, before, 'zero landed — the write never happened');
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// AC15 — gating + lock refusals
// ---------------------------------------------------------------------------

test('AC15: importLogins throws VaultLockedError when the manager is locked, and creates no file for an uncreated destination', () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    // Never set up — mrk is null, same VaultLockedError path as a locked
    // (previously-unlocked) store.
    assert.throws(
      () => store.importLogins('work', [candidateRow()]),
      (e) => e instanceof vs.VaultLockedError
    );
    assert.equal(fs.existsSync(vaultPath(dir, 'work')), false);
  } finally {
    rm(dir);
  }
});

test('AC15: importLogins refuses a burner/unknown target with VaultStateError and creates no file', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir); // listJars() -> [WORK_JAR] only — 'burner-xyz' is unknown.
    await store.setup({ masterPassword: MASTER });
    assert.throws(
      () => store.importLogins('burner-xyz', [candidateRow()]),
      (e) => e instanceof vs.VaultStateError
    );
    assert.equal(fs.existsSync(vaultPath(dir, 'burner-xyz')), false);
  } finally {
    rm(dir);
  }
});

test('AC15: a non-array candidates argument on a LOCKED store throws VaultStateError (the shape check precedes _requireMrk)', () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir); // never set up -> locked.
    assert.throws(
      () => store.importLogins('work', 'not-an-array'),
      (e) => e instanceof vs.VaultStateError && !(e instanceof vs.VaultLockedError)
    );
  } finally {
    rm(dir);
  }
});

test('AC15: importLogins refuses more than MAX_IMPORT_ITEMS candidates with VaultStateError', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir);
    await store.setup({ masterPassword: MASTER });
    const tooMany = new Array(vs.MAX_IMPORT_ITEMS + 1).fill(0).map((_, i) => candidateRow({ line: i }));
    assert.throws(
      () => store.importLogins('work', tooMany),
      (e) => e instanceof vs.VaultStateError
    );
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// AC15b — MAX_IMPORT_ITEMS / MAX_PAYLOAD_BYTES single-literal ownership
// ---------------------------------------------------------------------------

test('AC15b: exactly one `= 10000` and one `16 * 1024 * 1024` definition across src/main/vault/, both in browser-import.js', () => {
  const vaultDir = path.join(__dirname, '..', '..', 'src', 'main', 'vault');
  const files = fs.readdirSync(vaultDir).filter((f) => f.endsWith('.js'));

  let tenThousandHits = [];
  let sixteenMebiHits = [];
  for (const f of files) {
    const text = fs.readFileSync(path.join(vaultDir, f), 'utf8');
    const tenThousand = text.match(/=\s*10000\b/g) || [];
    const sixteenMebi = text.match(/16\s*\*\s*1024\s*\*\s*1024/g) || [];
    if (tenThousand.length > 0) tenThousandHits.push([f, tenThousand.length]);
    if (sixteenMebi.length > 0) sixteenMebiHits.push([f, sixteenMebi.length]);
  }

  assert.deepEqual(tenThousandHits, [['browser-import.js', 1]], 'exactly one = 10000 definition, in browser-import.js');
  assert.deepEqual(
    sixteenMebiHits,
    [['browser-import.js', 1]],
    'exactly one 16 * 1024 * 1024 definition, in browser-import.js'
  );
});

test('AC15b: requiring vault-store.js FIRST in a fresh process resolves MAX_IMPORT_ITEMS to 10000 (the cycle-free direction)', () => {
  const vaultStorePath = require.resolve('../../src/main/vault/vault-store');
  const script = `
    const vs = require(${JSON.stringify(vaultStorePath)});
    process.stdout.write(String(vs.MAX_IMPORT_ITEMS));
  `;
  const out = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' });
  assert.equal(out, '10000');
});

// ---------------------------------------------------------------------------
// AC17 — no-plaintext byte-scan
// ---------------------------------------------------------------------------

test('AC17: no goldfinch-written file under userData contains the fixture password, note, username, or title after an import', async () => {
  const dir = tmpDir();
  try {
    const store = makeStore(dir); // name==slug 'work' jar fixture.
    await store.setup({ masterPassword: MASTER });

    const SECRET_PASSWORD = 'byte-scan-secret-pw-9f3c';
    const SECRET_NOTE = 'byte-scan-secret-note-7a1d';
    const SECRET_USERNAME = 'byte-scan-secret-user-2b4e';
    const SECRET_TITLE = 'Byte Scan Secret Title 5e6f';

    store.importLogins('work', [
      candidateRow({
        line: 1,
        title: SECRET_TITLE,
        username: SECRET_USERNAME,
        password: SECRET_PASSWORD,
        notes: SECRET_NOTE
      })
    ]);
    store.importLogins('global', [
      candidateRow({
        line: 1,
        origin: 'https://global.example',
        title: SECRET_TITLE,
        username: SECRET_USERNAME,
        password: SECRET_PASSWORD,
        notes: SECRET_NOTE
      })
    ]);

    const needles = [SECRET_PASSWORD, SECRET_NOTE, SECRET_USERNAME, SECRET_TITLE].map((s) => Buffer.from(s, 'utf8'));
    const entries = fs.readdirSync(dir, { recursive: true });
    let scanned = 0;
    for (const entry of entries) {
      const full = path.join(dir, /** @type {string} */ (entry));
      if (!fs.statSync(full).isFile()) continue;
      scanned++;
      const bytes = fs.readFileSync(full);
      for (const needle of needles) {
        assert.equal(bytes.includes(needle), false, `${entry} must not contain plaintext fixture data`);
      }
    }
    assert.ok(scanned > 0, 'the scan actually walked files');
  } finally {
    rm(dir);
  }
});
