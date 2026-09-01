'use strict';

// Unit tests for src/main/vault/vault-txn.js — the journal-first staged-commit
// multi-file transaction primitive + idempotent load-time recovery (Mission 18,
// Flight 2, Leg 2 / flight DD2) — and its store-constructor integration.
//
// Electron-free (temp dirs, FAST_SCRYPT, on-disk byte probes). Three layers:
//   • API semantics + defensive invariants (journal-first, writeFileAtomic for
//     every write, one-journal rule, name-family validation, no secrets in the
//     journal document);
//   • the KILL MATRIX — monkeypatch the shared node:fs singleton (the
//     vault-atomic-write.test.js idiom) to throw on the Nth renameSync /
//     writeSync / fsyncSync / unlinkSync across a real multi-member
//     transaction, then prove recovery yields a directory that is ENTIRELY OLD
//     or ENTIRELY NEW (byte-exact), opens with the corresponding credentials,
//     and leaves no journal/staged/temp files;
//   • CONSTRUCTED residue states written directly to disk — the classes the
//     in-process monkeypatch cannot produce (flight DD2 residue honesty) —
//     plus double-crash (recovery itself killed, re-run) and recovery
//     idempotence.
//
// The transaction fixtures hand-build the "new state" file set via vault-crypto
// (a full re-wrapped manager + vaults under a fresh MRK and a NEW master
// password) — per the leg's Verification, this suite does not need the leg-3
// rotation op.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const txn = require('../../src/main/vault/vault-txn');
const vs = require('../../src/main/vault/vault-store');
const vc = require('../../src/main/vault/vault-crypto');

const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const OLD_MASTER = 'old master password';
const NEW_MASTER = 'entirely different new master';
const JARS = [{ id: 'work' }];

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-txn-'));
}
function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
function makeStore(dir, overrides = {}) {
  return vs.load(dir, {
    scryptParams: FAST_SCRYPT,
    getAutoLockMinutes: () => 10,
    listJars: () => JARS,
    ...overrides
  });
}

/** Byte snapshot of a directory: Map<name, Buffer>. */
function snapshot(dir) {
  return new Map(
    fs
      .readdirSync(dir)
      .sort()
      .map((n) => [n, fs.readFileSync(path.join(dir, n))])
  );
}

// The expected post-recovery vault-file set for the fixture below.
const EXPECTED_FILES = ['global.gfvault', 'manager.json', 'work.gfvault'];

// ---------------------------------------------------------------------------
// Fixture: a REAL two-vault OLD profile (setup + saveItem) and a hand-built
// full re-wrapped NEW state (fresh MRK + fresh vault keys + new master, wrapped
// at manager v2 without admin — the full-envelope-set-rewrite shape a rotation
// writes). Members: manager.json + global.gfvault + work.gfvault.
// ---------------------------------------------------------------------------

async function buildFixture(dir) {
  const store = makeStore(dir);
  await store.setup({ masterPassword: OLD_MASTER });
  store.saveItem('global', { type: 'login', title: 'OLD-GLOBAL', username: 'u', password: 'p' });
  store.saveItem('work', { type: 'login', title: 'OLD-WORK', username: 'u', password: 'p' });
  store.lockNow();

  const newMrk = vc.newVaultKey();
  const rec = vc.generateRecoveryKey();
  const masterEnv = await vc.wrapMaster(newMrk, NEW_MASTER, { version: 2, params: FAST_SCRYPT });
  const recoveryEnv = vc.wrapRecovery(newMrk, rec.material, { version: 2 });
  rec.material.fill(0);
  const newManager = JSON.stringify({
    format: 'gfmanager',
    version: 2,
    kdf: FAST_SCRYPT,
    mrk: { master: masterEnv, recovery: recoveryEnv }
  });
  const mrkAad = Buffer.from(`gfvault/mrk-env/v${vc.VERSION}`, 'utf8');
  function newVaultDoc(vaultId, title) {
    const key = vc.newVaultKey();
    const env = { keyId: 'mrk', type: 'mrk', ...vc.wrapVaultKey(key, newMrk, mrkAad) };
    const items = [{ id: 'x1', type: 'login', title, username: 'u', password: 'p', createdAt: 1, updatedAt: 1 }];
    const doc = vc.serializeVault({ vaultId, envelopes: [env], items: vc.encryptItems(items, key) });
    key.fill(0);
    return doc;
  }
  const members = [
    { finalName: 'manager.json', content: Buffer.from(newManager, 'utf8') },
    { finalName: 'global.gfvault', content: Buffer.from(newVaultDoc('global', 'NEW-GLOBAL'), 'utf8') },
    { finalName: 'work.gfvault', content: Buffer.from(newVaultDoc('work', 'NEW-WORK'), 'utf8') }
  ];
  newMrk.fill(0);

  const vdir = path.join(dir, 'vaults');
  return {
    vdir,
    members,
    oldBytes: snapshot(vdir),
    newBytes: new Map(members.map((m) => [m.finalName, Buffer.from(m.content)]))
  };
}

function runTxn(fixture) {
  const handle = txn.beginTransaction(fixture.vdir, fixture.members);
  txn.commit(handle);
  return handle;
}

/**
 * The AC1/AC2 core assertion: the directory holds EXACTLY the expected vault
 * files, byte-identical to the OLD set or the NEW set (never mixed); a fresh
 * store load (which re-runs recovery) opens with the corresponding master and
 * decrypts the corresponding items. Returns true iff the NEW state survived.
 */
async function assertEntirelyOldOrNew(dir, fixture, label) {
  assert.deepEqual(
    fs.readdirSync(fixture.vdir).sort(),
    EXPECTED_FILES,
    `${label}: only the expected vault files remain`
  );
  const current = snapshot(fixture.vdir);
  const isNew = current.get('manager.json').equals(fixture.newBytes.get('manager.json'));
  const expected = isNew ? fixture.newBytes : fixture.oldBytes;
  const side = isNew ? 'new' : 'old';
  for (const name of EXPECTED_FILES) {
    assert.ok(current.get(name).equals(expected.get(name)), `${label}: ${name} is entirely ${side} — never mixed`);
  }
  const store = makeStore(dir); // fresh load — constructor recovery must be a clean no-op now
  await store.unlock(isNew ? NEW_MASTER : OLD_MASTER);
  assert.deepEqual(
    store.listItems('global').map((i) => i.title),
    [isNew ? 'NEW-GLOBAL' : 'OLD-GLOBAL'],
    `${label}: global items decrypt with the surviving credentials`
  );
  assert.deepEqual(
    store.listItems('work').map((i) => i.title),
    [isNew ? 'NEW-WORK' : 'OLD-WORK'],
    `${label}: work items decrypt with the surviving credentials`
  );
  store.lockNow();
  return isNew;
}

/** Run recover twice and assert the second run changes nothing (idempotence). */
function recoverTwiceAssertIdempotent(vdir, label) {
  txn.recover(vdir);
  const first = snapshot(vdir);
  txn.recover(vdir);
  const second = snapshot(vdir);
  assert.deepEqual([...second.keys()], [...first.keys()], `${label}: double-run recover leaves the same file set`);
  for (const [name, bytes] of first) {
    assert.ok(second.get(name).equals(bytes), `${label}: double-run recover leaves ${name} byte-identical`);
  }
}

// ---------------------------------------------------------------------------
// fs monkeypatch helpers (the vault-atomic-write.test.js shared-singleton idiom)
// ---------------------------------------------------------------------------

class InducedCrash extends Error {}

/** Count how many times `syscall` fires during `fn` (no fault injected). */
function countCalls(syscall, fn) {
  const original = fs[syscall];
  let calls = 0;
  fs[syscall] = (...args) => {
    calls += 1;
    return original.apply(fs, args);
  };
  try {
    fn();
  } finally {
    fs[syscall] = original;
  }
  return calls;
}

/**
 * Run `fn` with `syscall` throwing InducedCrash on its Nth call. Best-effort
 * call sites (dir fsync, cleanup) may SWALLOW the induced throw — then `fn`
 * completes and `crashed` is false while the fault still fired.
 */
function withCrashAt(syscall, n, fn) {
  const original = fs[syscall];
  let calls = 0;
  fs[syscall] = (...args) => {
    calls += 1;
    if (calls === n) throw new InducedCrash(`induced ${syscall} crash at call #${n}`);
    return original.apply(fs, args);
  };
  try {
    fn();
    return { crashed: false };
  } catch (err) {
    if (!(err instanceof InducedCrash)) throw err;
    return { crashed: true };
  } finally {
    fs[syscall] = original;
  }
}

// ---------------------------------------------------------------------------
// API semantics + defensive invariants
// ---------------------------------------------------------------------------

test('begin+commit lands all members atomically: journal written FIRST, every write via writeFileAtomic, nothing left over', async () => {
  const dir = tmpDir();
  try {
    const fixture = await buildFixture(dir);

    // Record renameSync during begin: writeFileAtomic finishes each write with
    // a tmp→dest rename, so the observed order pins (a) journal FIRST, then the
    // staged files, and (b) every source matching the atomic temp pattern —
    // i.e. journal AND staged files all go through writeFileAtomic.
    const renames = [];
    const originalRename = fs.renameSync;
    fs.renameSync = (src, dest) => {
      renames.push({ src, dest });
      return originalRename.call(fs, src, dest);
    };
    let handle;
    try {
      handle = txn.beginTransaction(fixture.vdir, fixture.members);
    } finally {
      fs.renameSync = originalRename;
    }

    assert.equal(renames.length, 4, 'begin performs exactly journal + three staged atomic writes');
    assert.equal(path.basename(renames[0].dest), txn.uncommittedJournalName(handle.id), 'the journal is written FIRST');
    for (const [i, m] of handle.members.entries()) {
      assert.equal(path.basename(renames[i + 1].dest), m.stagedName, `member ${i} staged after the journal`);
    }
    for (const r of renames) {
      assert.match(path.basename(r.src), /\.tmp-[0-9a-f]{12}$/, 'every begin write goes through writeFileAtomic');
    }

    // Nothing observable changed at any final name yet.
    for (const name of EXPECTED_FILES) {
      assert.ok(
        fs.readFileSync(path.join(fixture.vdir, name)).equals(fixture.oldBytes.get(name)),
        `${name} untouched before commit`
      );
    }

    txn.commit(handle);
    assert.equal(handle.committed, true);
    assert.throws(() => txn.commit(handle), txn.VaultTxnError, 'a handle commits exactly once');

    assert.equal(
      await assertEntirelyOldOrNew(dir, fixture, 'clean commit'),
      true,
      'a clean commit lands the NEW state'
    );
  } finally {
    rm(dir);
  }
});

test('the journal document is plain JSON naming the members — no content, no secrets, no ciphertext', async () => {
  const dir = tmpDir();
  try {
    const fixture = await buildFixture(dir);
    const handle = txn.beginTransaction(fixture.vdir, fixture.members);
    const raw = fs.readFileSync(path.join(fixture.vdir, txn.uncommittedJournalName(handle.id)), 'utf8');
    const doc = JSON.parse(raw);
    assert.deepEqual(Object.keys(doc).sort(), ['format', 'id', 'members', 'version'], 'txn id + member list only');
    assert.equal(doc.id, handle.id);
    for (const m of doc.members) {
      assert.deepEqual(Object.keys(m).sort(), ['finalName', 'stagedName'], 'members carry NAMES only — never content');
    }
    // No member content leaks into the journal (byte probe against each staged payload).
    for (const member of fixture.members) {
      assert.ok(!raw.includes(member.content.toString('utf8')), 'journal holds no member payload bytes');
    }
    txn.commit(handle);
  } finally {
    rm(dir);
  }
});

test('beginTransaction validates members loudly (empty set, non-basename, duplicate, name-family collision, bad content)', async () => {
  const dir = tmpDir();
  try {
    fs.mkdirSync(path.join(dir, 'vaults'), { recursive: true });
    const vdir = path.join(dir, 'vaults');
    const ok = { finalName: 'manager.json', content: Buffer.from('x') };
    assert.throws(() => txn.beginTransaction(vdir, []), txn.VaultTxnError);
    assert.throws(() => txn.beginTransaction(vdir, [{ finalName: '../escape', content: 'x' }]), txn.VaultTxnError);
    assert.throws(() => txn.beginTransaction(vdir, [{ finalName: 'a/b', content: 'x' }]), txn.VaultTxnError);
    assert.throws(
      () => txn.beginTransaction(vdir, [ok, { finalName: 'manager.json', content: 'y' }]),
      txn.VaultTxnError
    );
    // A member whose name collides with the machinery's own name family is refused.
    assert.throws(
      () => txn.beginTransaction(vdir, [{ finalName: 'txn-aaaabbbbcccc.journal', content: 'x' }]),
      txn.VaultTxnError
    );
    assert.throws(
      () => txn.beginTransaction(vdir, [{ finalName: 'f.stage-aaaabbbbcccc', content: 'x' }]),
      txn.VaultTxnError
    );
    assert.throws(
      () => txn.beginTransaction(vdir, [{ finalName: 'f.tmp-aaaabbbbcccc', content: 'x' }]),
      txn.VaultTxnError
    );
    assert.throws(() => txn.beginTransaction(vdir, [{ finalName: 'f', content: 42 }]), txn.VaultTxnError);
    assert.deepEqual(fs.readdirSync(vdir), [], 'every refusal writes nothing');
  } finally {
    rm(dir);
  }
});

test('DEFENSIVE INVARIANT: beginTransaction refuses while ANY journal (either state) exists', async () => {
  const dir = tmpDir();
  try {
    const fixture = await buildFixture(dir);
    const handle = txn.beginTransaction(fixture.vdir, fixture.members);
    assert.throws(() => txn.beginTransaction(fixture.vdir, fixture.members), txn.VaultTxnError, 'uncommitted blocks');
    // Flip to the committed name (the crash-inside-commit state): still refused.
    fs.renameSync(
      path.join(fixture.vdir, txn.uncommittedJournalName(handle.id)),
      path.join(fixture.vdir, txn.committedJournalName(handle.id))
    );
    assert.throws(() => txn.beginTransaction(fixture.vdir, fixture.members), txn.VaultTxnError, 'committed blocks');
  } finally {
    rm(dir);
  }
});

test('DEFENSIVE INVARIANT: recover finding two journals is an impossible state and throws loudly', async () => {
  const dir = tmpDir();
  try {
    const fixture = await buildFixture(dir);
    const handle = txn.beginTransaction(fixture.vdir, fixture.members);
    // A second journal can only exist through corruption — recovery must never guess.
    const rogue = { format: 'gfvault-txn', version: 1, id: 'ffffeeeedddd', members: [] };
    fs.writeFileSync(path.join(fixture.vdir, 'txn-ffffeeeedddd.journal.committed'), JSON.stringify(rogue), 'utf8');
    assert.throws(() => txn.recover(fixture.vdir), txn.VaultTxnError);
    // The store constructor propagates the same loud refusal (never guesses either).
    assert.throws(() => makeStore(dir), txn.VaultTxnError);
    void handle;
  } finally {
    rm(dir);
  }
});

test('recover on a missing vaults/ dir is a silent no-op (fresh profile)', () => {
  const dir = tmpDir();
  try {
    txn.recover(path.join(dir, 'vaults')); // must not throw, must not create the dir
    assert.ok(!fs.existsSync(path.join(dir, 'vaults')));
    // ... and constructing a store on a fresh profile still works (AC4).
    const store = makeStore(dir);
    assert.equal(store.isSetUp(), false);
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// AC1 — the kill matrix. For each induced failure point, recovery + a fresh
// load yields entirely-old-or-entirely-new with working credentials and no
// stray journal/staged/temp files.
// ---------------------------------------------------------------------------

for (const syscall of ['renameSync', 'writeSync', 'fsyncSync', 'unlinkSync']) {
  test(`kill matrix: ${syscall} throwing at every Nth call — old-or-new, never mixed (AC1)`, async () => {
    // Dry run to enumerate every kill point for this syscall.
    const dryDir = tmpDir();
    let total;
    try {
      const dryFixture = await buildFixture(dryDir);
      total = countCalls(syscall, () => runTxn(dryFixture));
    } finally {
      rm(dryDir);
    }
    assert.ok(total > 0, `${syscall} participates in the transaction sequence`);

    let sawOld = false;
    let sawNew = false;
    for (let n = 1; n <= total; n++) {
      const dir = tmpDir();
      try {
        const fixture = await buildFixture(dir);
        const { crashed } = withCrashAt(syscall, n, () => runTxn(fixture));
        const label = `${syscall} #${n}/${total}${crashed ? '' : ' (best-effort site, swallowed)'}`;
        recoverTwiceAssertIdempotent(fixture.vdir, label);
        const isNew = await assertEntirelyOldOrNew(dir, fixture, label);
        if (isNew) sawNew = true;
        else sawOld = true;
      } finally {
        rm(dir);
      }
    }

    // Commit-discriminator sanity per syscall family: rename kills straddle the
    // commit point (both outcomes must occur); every writeSync kill is
    // pre-commit (old only); the sole transaction unlinkSync is the
    // post-rename journal removal (new only).
    if (syscall === 'renameSync' || syscall === 'fsyncSync') {
      assert.ok(sawOld && sawNew, `${syscall} matrix exercises both rollback and roll-forward`);
    } else if (syscall === 'writeSync') {
      assert.ok(sawOld && !sawNew, 'every writeSync kill point is pre-commit — rollback only');
    } else {
      assert.ok(sawNew && !sawOld, 'the unlinkSync kill point is post-commit — roll-forward only');
    }
  });
}

// ---------------------------------------------------------------------------
// AC2 — constructed residue states (written directly to disk; the classes the
// monkeypatch idiom cannot produce), each recovered deterministically and
// idempotently.
// ---------------------------------------------------------------------------

// Each entry arranges a residue state given a fresh begin()'s handle, and
// names the state's expected survivor.
const RESIDUE_STATES = [
  {
    name: 'uncommitted journal + ZERO staged files (killed between journal and staging)',
    expect: 'old',
    arrange(vdir, handle) {
      for (const m of handle.members) fs.unlinkSync(path.join(vdir, m.stagedName));
    }
  },
  {
    name: 'uncommitted journal + PARTIAL staged files',
    expect: 'old',
    arrange(vdir, handle) {
      fs.unlinkSync(path.join(vdir, handle.members[1].stagedName));
    }
  },
  {
    name: 'uncommitted journal + FULL staged files (killed immediately before the commit rename)',
    expect: 'old',
    arrange() {}
  },
  {
    name: 'committed journal + ZERO renames done',
    expect: 'new',
    arrange(vdir, handle) {
      fs.renameSync(
        path.join(vdir, txn.uncommittedJournalName(handle.id)),
        path.join(vdir, txn.committedJournalName(handle.id))
      );
    }
  },
  {
    name: 'committed journal + PARTIAL renames done',
    expect: 'new',
    arrange(vdir, handle) {
      fs.renameSync(
        path.join(vdir, txn.uncommittedJournalName(handle.id)),
        path.join(vdir, txn.committedJournalName(handle.id))
      );
      const m = handle.members[0];
      fs.renameSync(path.join(vdir, m.stagedName), path.join(vdir, m.finalName));
    }
  },
  {
    name: 'committed journal + ALL renames done, journal removal crashed (clean ENOENT-tolerant no-op roll-forward)',
    expect: 'new',
    arrange(vdir, handle) {
      fs.renameSync(
        path.join(vdir, txn.uncommittedJournalName(handle.id)),
        path.join(vdir, txn.committedJournalName(handle.id))
      );
      for (const m of handle.members) {
        fs.renameSync(path.join(vdir, m.stagedName), path.join(vdir, m.finalName));
      }
    }
  }
];

for (const state of RESIDUE_STATES) {
  test(`residue: ${state.name} → recovers deterministically + idempotently (AC2)`, async () => {
    const dir = tmpDir();
    try {
      const fixture = await buildFixture(dir);
      const handle = txn.beginTransaction(fixture.vdir, fixture.members);
      state.arrange(fixture.vdir, handle);
      recoverTwiceAssertIdempotent(fixture.vdir, state.name);
      const isNew = await assertEntirelyOldOrNew(dir, fixture, state.name);
      assert.equal(isNew, state.expect === 'new', `${state.name}: the ${state.expect} state survives`);
    } finally {
      rm(dir);
    }
  });
}

test('residue: the .tmp sweep removes ONLY writeFileAtomic-pattern orphans — near-miss names and vault files survive', async () => {
  const dir = tmpDir();
  try {
    const fixture = await buildFixture(dir);
    // Orphans a hard kill inside writeFileAtomic would leave (12-hex suffix)...
    fs.writeFileSync(path.join(fixture.vdir, 'manager.json.tmp-aaaabbbbcccc'), 'orphan', 'utf8');
    fs.writeFileSync(path.join(fixture.vdir, 'global.gfvault.tmp-001122334455'), 'orphan', 'utf8');
    // ...and near-miss names the sweep must NOT touch (non-hex / short suffix).
    fs.writeFileSync(path.join(fixture.vdir, 'keep.tmp-NOTHEXHEXHEX'), 'keep', 'utf8');
    fs.writeFileSync(path.join(fixture.vdir, 'keep.tmp-abc'), 'keep', 'utf8');

    txn.recover(fixture.vdir);

    const names = fs.readdirSync(fixture.vdir).sort();
    assert.deepEqual(
      names,
      ['global.gfvault', 'keep.tmp-NOTHEXHEXHEX', 'keep.tmp-abc', 'manager.json', 'work.gfvault'],
      'exact-pattern orphans swept; near-miss names and vault files kept'
    );
    for (const name of EXPECTED_FILES) {
      assert.ok(
        fs.readFileSync(path.join(fixture.vdir, name)).equals(fixture.oldBytes.get(name)),
        `${name} untouched by the sweep`
      );
    }
  } finally {
    rm(dir);
  }
});

test("residue: DISJOINT-NAMING PIN — the sweep never deletes a committed transaction's staged files (AC2)", async () => {
  const dir = tmpDir();
  try {
    const fixture = await buildFixture(dir);
    const handle = txn.beginTransaction(fixture.vdir, fixture.members);
    // Committed journal + staged files alongside + a genuine .tmp orphan: the
    // sweep must remove the orphan while roll-forward consumes every staged
    // file — if staged names matched the temp pattern, this would destroy the
    // committed transaction's payload.
    fs.renameSync(
      path.join(fixture.vdir, txn.uncommittedJournalName(handle.id)),
      path.join(fixture.vdir, txn.committedJournalName(handle.id))
    );
    fs.writeFileSync(path.join(fixture.vdir, 'orphan.tmp-ffff00001111'), 'orphan', 'utf8');

    recoverTwiceAssertIdempotent(fixture.vdir, 'disjoint-naming pin');
    const isNew = await assertEntirelyOldOrNew(dir, fixture, 'disjoint-naming pin');
    assert.equal(isNew, true, 'the committed transaction rolls forward intact — staged files were never swept');
  } finally {
    rm(dir);
  }
});

// ---------------------------------------------------------------------------
// Double-crash: recovery ITSELF killed at every syscall it performs, then
// re-run — same deterministic result (AC2; unlinkSync covers rollback's staged
// deletes and journal removal, renameSync covers roll-forward).
// ---------------------------------------------------------------------------

test('double-crash: rollback recovery killed at every unlinkSync, re-run still yields the OLD state', async () => {
  // Dry-count the unlink calls a full rollback performs (3 staged + journal).
  const dryDir = tmpDir();
  let total;
  try {
    const dryFixture = await buildFixture(dryDir);
    txn.beginTransaction(dryFixture.vdir, dryFixture.members);
    total = countCalls('unlinkSync', () => txn.recover(dryFixture.vdir));
  } finally {
    rm(dryDir);
  }
  assert.equal(total, 4, 'rollback unlinks three staged files + the journal');

  for (let n = 1; n <= total; n++) {
    const dir = tmpDir();
    try {
      const fixture = await buildFixture(dir);
      txn.beginTransaction(fixture.vdir, fixture.members);
      const { crashed } = withCrashAt('unlinkSync', n, () => txn.recover(fixture.vdir));
      assert.equal(crashed, true, `rollback unlink #${n} crash propagates (loud, not swallowed)`);
      recoverTwiceAssertIdempotent(fixture.vdir, `rollback double-crash #${n}`);
      const isNew = await assertEntirelyOldOrNew(dir, fixture, `rollback double-crash #${n}`);
      assert.equal(isNew, false, `rollback double-crash #${n}: the OLD state survives`);
    } finally {
      rm(dir);
    }
  }
});

test('double-crash: roll-forward recovery killed at every renameSync, re-run still yields the NEW state', async () => {
  const dryDir = tmpDir();
  let total;
  try {
    const dryFixture = await buildFixture(dryDir);
    const h = txn.beginTransaction(dryFixture.vdir, dryFixture.members);
    fs.renameSync(
      path.join(dryFixture.vdir, txn.uncommittedJournalName(h.id)),
      path.join(dryFixture.vdir, txn.committedJournalName(h.id))
    );
    total = countCalls('renameSync', () => txn.recover(dryFixture.vdir));
  } finally {
    rm(dryDir);
  }
  assert.equal(total, 3, 'roll-forward renames the three staged members');

  for (let n = 1; n <= total; n++) {
    const dir = tmpDir();
    try {
      const fixture = await buildFixture(dir);
      const handle = txn.beginTransaction(fixture.vdir, fixture.members);
      fs.renameSync(
        path.join(fixture.vdir, txn.uncommittedJournalName(handle.id)),
        path.join(fixture.vdir, txn.committedJournalName(handle.id))
      );
      const { crashed } = withCrashAt('renameSync', n, () => txn.recover(fixture.vdir));
      assert.equal(crashed, true, `roll-forward rename #${n} crash propagates`);
      recoverTwiceAssertIdempotent(fixture.vdir, `roll-forward double-crash #${n}`);
      const isNew = await assertEntirelyOldOrNew(dir, fixture, `roll-forward double-crash #${n}`);
      assert.equal(isNew, true, `roll-forward double-crash #${n}: the NEW state survives`);
    } finally {
      rm(dir);
    }
  }
});

// ---------------------------------------------------------------------------
// AC4 — recovery runs on EVERY store construction: the constructor alone
// repairs residue before the load-loudly manager read.
// ---------------------------------------------------------------------------

test('store construction alone rolls BACK an uncommitted journal, then loads and unlocks the OLD profile (AC4)', async () => {
  const dir = tmpDir();
  try {
    const fixture = await buildFixture(dir);
    txn.beginTransaction(fixture.vdir, fixture.members); // crash before commit
    const store = makeStore(dir); // constructor recovery — no explicit recover() call
    assert.deepEqual(fs.readdirSync(fixture.vdir).sort(), EXPECTED_FILES, 'constructor recovery cleaned the residue');
    await store.unlock(OLD_MASTER);
    assert.deepEqual(
      store.listItems('global').map((i) => i.title),
      ['OLD-GLOBAL']
    );
    store.lockNow();
  } finally {
    rm(dir);
  }
});

test('store construction alone rolls FORWARD a committed journal, then loads and unlocks the NEW profile (AC4)', async () => {
  const dir = tmpDir();
  try {
    const fixture = await buildFixture(dir);
    const handle = txn.beginTransaction(fixture.vdir, fixture.members);
    fs.renameSync(
      path.join(fixture.vdir, txn.uncommittedJournalName(handle.id)),
      path.join(fixture.vdir, txn.committedJournalName(handle.id))
    ); // crash immediately after the commit rename
    const store = makeStore(dir);
    assert.deepEqual(fs.readdirSync(fixture.vdir).sort(), EXPECTED_FILES, 'constructor recovery finished the commit');
    await store.unlock(NEW_MASTER);
    assert.deepEqual(
      store.listItems('global').map((i) => i.title),
      ['NEW-GLOBAL']
    );
    store.lockNow();
  } finally {
    rm(dir);
  }
});
