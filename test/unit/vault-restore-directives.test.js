'use strict';

// Unit tests for restoreProfile()'s per-vault DIRECTIVE / OUTCOME matrix
// (M18 F3 Leg 2 / flight DD2/DD3): existing (replace, collision-refused),
// new (create-then-verify, jar-id reconciliation), skip, mapping-validation
// edge cases, and the single-flight guard (DD3 ruling 7). Merge is its own
// suite (vault-restore-merge.test.js); fault injection is its own suite
// (vault-restore-fault-injection.test.js); export-side shape/gate coverage
// lives in vault-bundle-v2.test.js.
//
// Electron-free: real temp dirs + FAST scrypt.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vs = require('../../src/main/vault/vault-store');

const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MASTER = 'correct horse battery staple';

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-vault-restore-dir-'));
}
function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// Mirrors jars.js's reserved-id remap (isReservedId → `jar-` prefix) so a
// newJar name that slugs to a reserved base (e.g. 'Global') behaves exactly
// as the real jars.add()/slug() would — this suite injects a FAKE, not the
// real module (Electron-free discipline), but the fake must match its
// contract for the reconciliation tests to mean anything.
const RESERVED_IDS = new Set(['burner', 'admin', 'internal', 'default', 'global']);
function isReservedSlug(id) {
  return RESERVED_IDS.has(id) || id.startsWith('burner-');
}

function makeJarDeps(seed = []) {
  const containers = seed.map((c) => ({ ...c }));
  return {
    containers,
    listJars: () => containers,
    createJar: (name, color) => {
      let base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'jar';
      if (isReservedSlug(base)) base = `jar-${base}`;
      let id = base;
      let n = 1;
      while (containers.some((c) => c.id === id)) id = `${base}-${n++}`;
      const c = { id, name, color, partition: `persist:container:${id}`, retentionDays: 30 };
      containers.push(c);
      return c;
    },
    verifyJarPersisted: (id) => containers.some((c) => c.id === id)
  };
}

function makeStore(dir, deps) {
  return vs.load(dir, {
    scryptParams: FAST_SCRYPT,
    listJars: deps.listJars,
    createJar: deps.createJar,
    verifyJarPersisted: deps.verifyJarPersisted
  });
}

async function makeSourceProfile() {
  const dir = tmpDir();
  const deps = makeJarDeps([
    { id: 'work', name: 'Work', color: '#2196f3', partition: 'persist:container:work', retentionDays: 30 }
  ]);
  const store = makeStore(dir, deps);
  await store.setup({ masterPassword: MASTER });
  store.saveItem('global', { type: 'login', title: 'Global', username: 'g', password: 'gp' });
  store.saveItem('work', { type: 'login', title: 'WorkItem', username: 'w', password: 'wp' });
  const bundle = store.exportProfile();
  return { dir, store, bundle };
}

// ---------------------------------------------------------------------------
// FRESH profile: 'new', 'skip', global→'existing' — the only legal directives
// ---------------------------------------------------------------------------

test("FRESH restore: 'new' creates the destination jar THEN writes; result maps source → destination explicitly", async () => {
  const src = await makeSourceProfile();
  try {
    const freshDir = tmpDir();
    const deps = makeJarDeps();
    try {
      const fresh = makeStore(freshDir, deps);
      const res = await fresh.restoreProfile(JSON.parse(JSON.stringify(src.bundle)), {
        secret: Buffer.from(MASTER, 'utf8'),
        secretKind: 'master',
        mapping: {
          global: { directive: 'existing', destination: 'global' },
          work: { directive: 'new', newJar: { name: 'Work', color: '#2196f3' } }
        }
      });
      assert.equal(res.fresh, true);
      const globalRow = res.results.find((r) => r.sourceId === 'global');
      const workRow = res.results.find((r) => r.sourceId === 'work');
      assert.equal(globalRow.outcome, 'landed');
      assert.equal(globalRow.destination, 'global');
      assert.equal(workRow.outcome, 'landed');
      assert.equal(
        deps.containers.some((c) => c.id === workRow.destination),
        true,
        'the jar was actually created'
      );
      assert.equal(fresh.listItems(workRow.destination)[0].password, 'wp');
      assert.equal(typeof res.recoveryKeyDisplay, 'string');
    } finally {
      rm(freshDir);
    }
  } finally {
    rm(src.dir);
  }
});

test("FRESH restore: jar-id RECONCILIATION — a bundle jar's slug colliding with an existing (unrelated) jar lands under the '-N' uniquified id, and results[].destination names it", async () => {
  const src = await makeSourceProfile();
  try {
    const freshDir = tmpDir();
    // An UNRELATED pre-existing jar already claims the 'work' slug.
    const deps = makeJarDeps([
      { id: 'work', name: 'Someone Else', color: '#000', partition: 'persist:container:work', retentionDays: 30 }
    ]);
    try {
      const fresh = makeStore(freshDir, deps);
      const res = await fresh.restoreProfile(JSON.parse(JSON.stringify(src.bundle)), {
        secret: Buffer.from(MASTER, 'utf8'),
        secretKind: 'master',
        mapping: {
          global: { directive: 'skip' },
          work: { directive: 'new', newJar: { name: 'Work', color: '#2196f3' } }
        }
      });
      const workRow = res.results.find((r) => r.sourceId === 'work');
      assert.equal(workRow.outcome, 'landed');
      assert.notEqual(workRow.destination, 'work', 'the source id does not survive into the destination profile');
      assert.equal(workRow.destination, 'work-1', "createJar's own uniquifier is what the store's deps drive");
      assert.equal(fresh.listItems(workRow.destination)[0].password, 'wp');
    } finally {
      rm(freshDir);
    }
  } finally {
    rm(src.dir);
  }
});

test("FRESH restore: ruling 3's ban on non-global 'existing' destinations falls out of _resolveTarget — a truly fresh profile's empty jar registry admits ONLY 'global', refused BEFORE any write", async () => {
  const src = await makeSourceProfile();
  try {
    const freshDir = tmpDir();
    // A TRULY fresh profile — no residue jars in the registry (the ordinary case;
    // the adopt-rerun residue exception is covered separately, below).
    const deps = makeJarDeps();
    try {
      const fresh = makeStore(freshDir, deps);
      await assert.rejects(
        fresh.restoreProfile(JSON.parse(JSON.stringify(src.bundle)), {
          secret: Buffer.from(MASTER, 'utf8'),
          secretKind: 'master',
          mapping: {
            global: { directive: 'existing', destination: 'no-such-jar' },
            work: { directive: 'skip' }
          }
        }),
        (e) => e instanceof vs.VaultStateError
      );
      assert.equal(fresh.isSetUp(), false, 'nothing written for a refused mapping');
    } finally {
      rm(freshDir);
    }
  } finally {
    rm(src.dir);
  }
});

test("FRESH restore: the adopt-rerun RESIDUE exception (ruling 4) — a jar left over from a PRIOR failed fresh adopt is a legal 'existing' destination even though isSetUp() is still false", async () => {
  const src = await makeSourceProfile();
  try {
    const freshDir = tmpDir();
    // Simulates the residue state directly: a jar already exists in the registry
    // (as ruling 4 says a failed create-then-verify step can leave one) but the
    // manager was never written — isSetUp() is still false.
    const deps = makeJarDeps([
      {
        id: 'residue-work',
        name: 'Residue Work',
        color: '#2196f3',
        partition: 'persist:container:residue-work',
        retentionDays: 30
      }
    ]);
    try {
      const fresh = makeStore(freshDir, deps);
      assert.equal(fresh.isSetUp(), false);
      const res = await fresh.restoreProfile(JSON.parse(JSON.stringify(src.bundle)), {
        secret: Buffer.from(MASTER, 'utf8'),
        secretKind: 'master',
        mapping: {
          global: { directive: 'existing', destination: 'global' },
          work: { directive: 'existing', destination: 'residue-work' }
        }
      });
      assert.equal(res.fresh, true);
      const workRow = res.results.find((r) => r.sourceId === 'work');
      assert.equal(workRow.outcome, 'landed');
      assert.equal(workRow.destination, 'residue-work', 'mapped onto the residue jar, not a duplicate');
      assert.equal(fresh.isSetUp(), true, 'this run completed the adopt');
      assert.equal(fresh.listItems('residue-work')[0].password, 'wp');
    } finally {
      rm(freshDir);
    }
  } finally {
    rm(src.dir);
  }
});

test("FRESH restore: 'skip everything except one jar vault' is legal (the degenerate lazy-global case) — manager still written, global vault file simply absent", async () => {
  const src = await makeSourceProfile();
  try {
    const freshDir = tmpDir();
    const deps = makeJarDeps();
    try {
      const fresh = makeStore(freshDir, deps);
      const res = await fresh.restoreProfile(JSON.parse(JSON.stringify(src.bundle)), {
        secret: Buffer.from(MASTER, 'utf8'),
        secretKind: 'master',
        mapping: {
          global: { directive: 'skip' },
          work: { directive: 'new', newJar: { name: 'Work', color: '#2196f3' } }
        }
      });
      assert.equal(res.fresh, true);
      assert.equal(fresh.isSetUp(), true, 'manager was still written');
      assert.equal(
        fs.existsSync(path.join(freshDir, 'vaults', 'global.gfvault')),
        false,
        'global vault absent — lazy, representable'
      );
      const workRow = res.results.find((r) => r.sourceId === 'work');
      assert.equal(workRow.outcome, 'landed');
      assert.equal(fresh.listItems(workRow.destination)[0].password, 'wp');
    } finally {
      rm(freshDir);
    }
  } finally {
    rm(src.dir);
  }
});

// ---------------------------------------------------------------------------
// EXISTING profile: 'existing' (replace / collision-refused), 'new', 'skip'
// ---------------------------------------------------------------------------

test("EXISTING restore: 'existing' with NO mode against an occupied destination → collision-refused, NO write", async () => {
  const src = await makeSourceProfile();
  try {
    const destDir = tmpDir();
    const deps = makeJarDeps([
      { id: 'work', name: 'Dest Work', color: '#000', partition: 'persist:container:work', retentionDays: 30 }
    ]);
    try {
      const dest = makeStore(destDir, deps);
      await dest.setup({ masterPassword: 'dest pw' });
      dest.saveItem('work', { type: 'login', title: 'Existing', username: 'e', password: 'ep' });
      const before = fs.readFileSync(path.join(destDir, 'vaults', 'work.gfvault'));

      const res = await dest.restoreProfile(JSON.parse(JSON.stringify(src.bundle)), {
        secret: Buffer.from(MASTER, 'utf8'),
        secretKind: 'master',
        mapping: { global: { directive: 'skip' }, work: { directive: 'existing', destination: 'work' } }
      });
      const workRow = res.results.find((r) => r.sourceId === 'work');
      assert.equal(workRow.outcome, 'collision-refused');
      assert.deepEqual(fs.readFileSync(path.join(destDir, 'vaults', 'work.gfvault')), before, 'destination untouched');
      assert.equal(dest.listItems('work')[0].title, 'Existing', 'original data intact');
    } finally {
      rm(destDir);
    }
  } finally {
    rm(src.dir);
  }
});

test("EXISTING restore: 'existing' with mode:'replace' whole-vault-overwrites the destination", async () => {
  const src = await makeSourceProfile();
  try {
    const destDir = tmpDir();
    const deps = makeJarDeps([
      { id: 'work', name: 'Dest Work', color: '#000', partition: 'persist:container:work', retentionDays: 30 }
    ]);
    try {
      const dest = makeStore(destDir, deps);
      await dest.setup({ masterPassword: 'dest pw' });
      dest.saveItem('work', { type: 'login', title: 'ToBeReplaced', username: 'e', password: 'ep' });

      const res = await dest.restoreProfile(JSON.parse(JSON.stringify(src.bundle)), {
        secret: Buffer.from(MASTER, 'utf8'),
        secretKind: 'master',
        mapping: {
          global: { directive: 'skip' },
          work: { directive: 'existing', destination: 'work', mode: 'replace' }
        }
      });
      const workRow = res.results.find((r) => r.sourceId === 'work');
      assert.equal(workRow.outcome, 'landed');
      const items = dest.listItems('work');
      assert.equal(items.length, 1, 'replace is whole-vault — the old item is gone');
      assert.equal(items[0].title, 'WorkItem');
      assert.equal(items[0].password, 'wp');

      // Re-key confirmed: readable after a restart under the DESTINATION master.
      dest.lockNow();
      await dest.unlock(Buffer.from('dest pw', 'utf8'));
      assert.equal(dest.listItems('work')[0].password, 'wp');
    } finally {
      rm(destDir);
    }
  } finally {
    rm(src.dir);
  }
});

test("EXISTING restore: 'new' onto a set-up profile creates a fresh jar and lands the vault", async () => {
  const src = await makeSourceProfile();
  try {
    const destDir = tmpDir();
    const deps = makeJarDeps();
    try {
      const dest = makeStore(destDir, deps);
      await dest.setup({ masterPassword: 'dest pw' });

      const res = await dest.restoreProfile(JSON.parse(JSON.stringify(src.bundle)), {
        secret: Buffer.from(MASTER, 'utf8'),
        secretKind: 'master',
        mapping: {
          global: { directive: 'skip' },
          work: { directive: 'new', newJar: { name: 'Imported Work', color: '#abcdef' } }
        }
      });
      const workRow = res.results.find((r) => r.sourceId === 'work');
      assert.equal(workRow.outcome, 'landed');
      assert.equal(
        deps.containers.some((c) => c.id === workRow.destination),
        true
      );
      assert.equal(dest.listItems(workRow.destination)[0].password, 'wp');
    } finally {
      rm(destDir);
    }
  } finally {
    rm(src.dir);
  }
});

// ---------------------------------------------------------------------------
// Mapping validation edge cases — loud, pre-write (DD2's "every row demands
// an explicit directive")
// ---------------------------------------------------------------------------

test('mapping validation: an unknown sourceId in the mapping → VaultStateError before any write', async () => {
  const src = await makeSourceProfile();
  try {
    const destDir = tmpDir();
    const deps = makeJarDeps();
    try {
      const dest = makeStore(destDir, deps);
      await dest.setup({ masterPassword: 'dest pw' });
      await assert.rejects(
        dest.restoreProfile(JSON.parse(JSON.stringify(src.bundle)), {
          secret: Buffer.from(MASTER, 'utf8'),
          secretKind: 'master',
          mapping: {
            global: { directive: 'skip' },
            work: { directive: 'skip' },
            'does-not-exist': { directive: 'skip' }
          }
        }),
        (e) => e instanceof vs.VaultStateError && /unknown sourceId/.test(e.message)
      );
    } finally {
      rm(destDir);
    }
  } finally {
    rm(src.dir);
  }
});

test('mapping validation: a bundle vault with NO mapping entry → VaultStateError before any write (an omission is never an implicit skip)', async () => {
  const src = await makeSourceProfile();
  try {
    const destDir = tmpDir();
    const deps = makeJarDeps();
    try {
      const dest = makeStore(destDir, deps);
      await dest.setup({ masterPassword: 'dest pw' });
      await assert.rejects(
        dest.restoreProfile(JSON.parse(JSON.stringify(src.bundle)), {
          secret: Buffer.from(MASTER, 'utf8'),
          secretKind: 'master',
          mapping: { global: { directive: 'skip' } } // 'work' omitted
        }),
        (e) => e instanceof vs.VaultStateError && /missing a directive/.test(e.message)
      );
    } finally {
      rm(destDir);
    }
  } finally {
    rm(src.dir);
  }
});

test('mapping validation: an unknown/burner destination on an existing profile → VaultStateError before any write', async () => {
  const src = await makeSourceProfile();
  try {
    const destDir = tmpDir();
    const deps = makeJarDeps();
    try {
      const dest = makeStore(destDir, deps);
      await dest.setup({ masterPassword: 'dest pw' });
      await assert.rejects(
        dest.restoreProfile(JSON.parse(JSON.stringify(src.bundle)), {
          secret: Buffer.from(MASTER, 'utf8'),
          secretKind: 'master',
          mapping: {
            global: { directive: 'skip' },
            work: { directive: 'existing', destination: 'no-such-jar' }
          }
        }),
        (e) => e instanceof vs.VaultStateError
      );
    } finally {
      rm(destDir);
    }
  } finally {
    rm(src.dir);
  }
});

test('mapping validation: a reserved-id-space newJar name is covered by the existing slug() reservation (jar-<reserved> remap)', async () => {
  const src = await makeSourceProfile();
  try {
    const freshDir = tmpDir();
    const deps = makeJarDeps();
    try {
      const fresh = makeStore(freshDir, deps);
      const res = await fresh.restoreProfile(JSON.parse(JSON.stringify(src.bundle)), {
        secret: Buffer.from(MASTER, 'utf8'),
        secretKind: 'master',
        mapping: {
          global: { directive: 'existing', destination: 'global' },
          // A newJar name whose slug collides with the reserved 'global' base — the
          // injected createJar fake mirrors jars.js's remap-to-`jar-` behavior itself,
          // so this pins that the store defers entirely to the injected createJar.
          work: { directive: 'new', newJar: { name: 'Global', color: '#fff' } }
        }
      });
      const workRow = res.results.find((r) => r.sourceId === 'work');
      assert.equal(workRow.outcome, 'landed');
      assert.notEqual(workRow.destination, 'global', 'never aliases the sentinel global vault');
    } finally {
      rm(freshDir);
    }
  } finally {
    rm(src.dir);
  }
});

// ---------------------------------------------------------------------------
// Single-flight guard (DD3 ruling 7)
// ---------------------------------------------------------------------------

test('single-flight guard: a concurrent second restoreProfile call throws VaultBusyError; released on success AND on throw', async () => {
  const src = await makeSourceProfile();
  try {
    const freshDir = tmpDir();
    const deps = makeJarDeps();
    try {
      const fresh = makeStore(freshDir, deps);
      const first = fresh.restoreProfile(JSON.parse(JSON.stringify(src.bundle)), {
        secret: Buffer.from(MASTER, 'utf8'),
        secretKind: 'master',
        mapping: { global: { directive: 'existing', destination: 'global' }, work: { directive: 'skip' } }
      });
      await assert.rejects(
        fresh.restoreProfile(JSON.parse(JSON.stringify(src.bundle)), {
          secret: Buffer.from(MASTER, 'utf8'),
          secretKind: 'master',
          mapping: { global: { directive: 'existing', destination: 'global' }, work: { directive: 'skip' } }
        }),
        (e) => e instanceof vs.VaultBusyError
      );
      await first;
      assert.equal(fresh._restoreInFlight, false, 'released on success');

      // Released on throw too — a validation failure still clears the flag.
      await assert.rejects(fresh.restoreProfile({ format: 'nope' }, { secret: Buffer.from('x'), mapping: {} }));
      assert.equal(fresh._restoreInFlight, false, 'released on throw');
      // And a THIRD call is not spuriously refused.
      const third = await fresh.restoreProfile(JSON.parse(JSON.stringify(src.bundle)), {
        secret: Buffer.from(MASTER, 'utf8'),
        secretKind: 'master',
        mapping: { global: { directive: 'skip' }, work: { directive: 'skip' } }
      });
      assert.equal(third.fresh, false);
    } finally {
      rm(freshDir);
    }
  } finally {
    rm(src.dir);
  }
});
