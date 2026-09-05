'use strict';

// Unit tests for restoreProfile()'s per-vault DIRECTIVE / OUTCOME matrix
// (M18 F3 Leg 2 / flight DD2/DD3; RE-KEYED M18 F3 Leg 5 to the opaque
// entryHandle): existing (replace, collision-refused), new (create-then-verify,
// jar-id reconciliation), skip, mapping-validation edge cases, and the
// single-flight guard (DD3 ruling 7). Merge is its own suite
// (vault-restore-merge.test.js); fault injection is its own suite
// (vault-restore-fault-injection.test.js); export-side shape/gate coverage
// lives in vault-bundle-v2.test.js.
//
// Electron-free: real temp dirs + FAST scrypt.
//
// M18 F3 L5 note: `mapping` now keys on the bundle's OPAQUE `entryHandle`, not
// the old plaintext `sourceId` — a test can no longer write `mapping: {
// global: ..., work: ... }` directly. `makeSourceProfile()` below resolves
// and returns the entryHandles POSITIONALLY: `_exportProfile`'s own
// enumeration order is GLOBAL_ID first, then jars in `listJars()` order,
// skipping any lazy-absent vault (`vault-store.js`) — deterministic, so a
// fixture that saves into every declared jar can rely on `bundle.vaults[]`
// mirroring that order 1:1. Tests reference `src.entries.global` /
// `src.entries.work` instead of the raw strings.

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
  const { bundle } = store.exportProfile();
  // Positional resolution (see file header): global first, then 'work'.
  const entries = { global: bundle.vaults[0].entryHandle, work: bundle.vaults[1].entryHandle };
  return { dir, store, bundle, entries };
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
          [src.entries.global]: { directive: 'existing', destination: 'global' },
          [src.entries.work]: { directive: 'new', newJar: { name: 'Work', color: '#2196f3' } }
        }
      });
      assert.equal(res.fresh, true);
      const globalRow = res.results.find((r) => r.entryHandle === src.entries.global);
      const workRow = res.results.find((r) => r.entryHandle === src.entries.work);
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
          [src.entries.global]: { directive: 'skip' },
          [src.entries.work]: { directive: 'new', newJar: { name: 'Work', color: '#2196f3' } }
        }
      });
      const workRow = res.results.find((r) => r.entryHandle === src.entries.work);
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

test("FRESH restore: a single 'new' directive invokes the injected createJar EXACTLY ONCE, yielding exactly one destination jar (HAT fix 7 diagnosis — no double-create) — M18 F3 L4", async () => {
  // The operator's exact live-walk shape: a 3-vault bundle (global, personal, test) restored
  // onto a genuinely CLEAN profile with personal→new, test→skip, global→existing global. A
  // symptom reported at the HAT ("2 Personal jars, one empty") turned out to be a test-harness
  // artifact (a zombie process resurrecting a residue jar row — see the flight log's Leg 4 HAT
  // anomaly entry), not a store defect; this pins the invariant the trace confirmed: the store
  // (vault-store.js's `_restoreProfile`) calls its injected `createJar` dep at most once per
  // 'new' directive, in a single un-looped pass over the mapping — never once from main.js (it
  // only wires `createJar` as a constructor dependency, main.js:802, and never calls jars.add
  // itself) and never twice from the store.
  const srcDir = tmpDir();
  const srcDeps = makeJarDeps([
    { id: 'personal', name: 'Personal', color: '#2196f3', partition: 'persist:container:personal', retentionDays: 30 },
    { id: 'test', name: 'Test', color: '#4caf50', partition: 'persist:container:test', retentionDays: 30 }
  ]);
  let bundle;
  let entries;
  try {
    const src = makeStore(srcDir, srcDeps);
    await src.setup({ masterPassword: MASTER });
    src.saveItem('global', { type: 'login', title: 'Global', username: 'g', password: 'gp' });
    src.saveItem('personal', { type: 'login', title: 'PersonalItem', username: 'p', password: 'pp' });
    src.saveItem('test', { type: 'login', title: 'TestItem', username: 't', password: 'tp' });
    ({ bundle } = src.exportProfile());
    // Positional: global, then personal, then test (srcDeps.listJars() order).
    entries = {
      global: bundle.vaults[0].entryHandle,
      personal: bundle.vaults[1].entryHandle,
      test: bundle.vaults[2].entryHandle
    };
  } finally {
    rm(srcDir);
  }

  const freshDir = tmpDir();
  try {
    const freshDeps = makeJarDeps(); // a genuinely CLEAN registry — no residue jars.
    let createJarCalls = 0;
    const countingCreateJar = (name, color) => {
      createJarCalls++;
      return freshDeps.createJar(name, color);
    };
    const fresh = vs.load(freshDir, {
      scryptParams: FAST_SCRYPT,
      listJars: freshDeps.listJars,
      createJar: countingCreateJar,
      verifyJarPersisted: freshDeps.verifyJarPersisted
    });
    const res = await fresh.restoreProfile(JSON.parse(JSON.stringify(bundle)), {
      secret: Buffer.from(MASTER, 'utf8'),
      secretKind: 'master',
      mapping: {
        [entries.global]: { directive: 'existing', destination: 'global' },
        [entries.personal]: { directive: 'new', newJar: { name: 'Personal', color: '#2196f3' } },
        [entries.test]: { directive: 'skip' }
      }
    });
    assert.equal(res.fresh, true);
    assert.equal(createJarCalls, 1, 'createJar invoked exactly once for the single new directive');
    assert.equal(freshDeps.containers.length, 1, 'exactly one jar exists on the destination profile');
    assert.equal(freshDeps.containers[0].name, 'Personal');
    const personalRow = res.results.find((r) => r.entryHandle === entries.personal);
    assert.equal(personalRow.outcome, 'landed');
    assert.equal(
      personalRow.destination,
      freshDeps.containers[0].id,
      'the vault landed under the ONE jar that was created, not a second empty one'
    );
    assert.equal(fresh.listItems(personalRow.destination)[0].password, 'pp');
    assert.equal(res.results.find((r) => r.entryHandle === entries.test).outcome, 'skipped');
  } finally {
    rm(freshDir);
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
            [src.entries.global]: { directive: 'existing', destination: 'no-such-jar' },
            [src.entries.work]: { directive: 'skip' }
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
          [src.entries.global]: { directive: 'existing', destination: 'global' },
          [src.entries.work]: { directive: 'existing', destination: 'residue-work' }
        }
      });
      assert.equal(res.fresh, true);
      const workRow = res.results.find((r) => r.entryHandle === src.entries.work);
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
          [src.entries.global]: { directive: 'skip' },
          [src.entries.work]: { directive: 'new', newJar: { name: 'Work', color: '#2196f3' } }
        }
      });
      assert.equal(res.fresh, true);
      assert.equal(fresh.isSetUp(), true, 'manager was still written');
      assert.equal(
        fs.existsSync(path.join(freshDir, 'vaults', 'global.gfvault')),
        false,
        'global vault absent — lazy, representable'
      );
      const workRow = res.results.find((r) => r.entryHandle === src.entries.work);
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
        mapping: {
          [src.entries.global]: { directive: 'skip' },
          [src.entries.work]: { directive: 'existing', destination: 'work' }
        }
      });
      const workRow = res.results.find((r) => r.entryHandle === src.entries.work);
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
          [src.entries.global]: { directive: 'skip' },
          [src.entries.work]: { directive: 'existing', destination: 'work', mode: 'replace' }
        }
      });
      const workRow = res.results.find((r) => r.entryHandle === src.entries.work);
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
          [src.entries.global]: { directive: 'skip' },
          [src.entries.work]: { directive: 'new', newJar: { name: 'Imported Work', color: '#abcdef' } }
        }
      });
      const workRow = res.results.find((r) => r.entryHandle === src.entries.work);
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

test('mapping validation: an unknown entryHandle in the mapping → VaultStateError before any write', async () => {
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
            [src.entries.global]: { directive: 'skip' },
            [src.entries.work]: { directive: 'skip' },
            'does-not-exist': { directive: 'skip' }
          }
        }),
        (e) => e instanceof vs.VaultStateError && /unknown entryHandle/.test(e.message)
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
          mapping: { [src.entries.global]: { directive: 'skip' } } // 'work' omitted
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
            [src.entries.global]: { directive: 'skip' },
            [src.entries.work]: { directive: 'existing', destination: 'no-such-jar' }
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
          [src.entries.global]: { directive: 'existing', destination: 'global' },
          // A newJar name whose slug collides with the reserved 'global' base — the
          // injected createJar fake mirrors jars.js's remap-to-`jar-` behavior itself,
          // so this pins that the store defers entirely to the injected createJar.
          [src.entries.work]: { directive: 'new', newJar: { name: 'Global', color: '#fff' } }
        }
      });
      const workRow = res.results.find((r) => r.entryHandle === src.entries.work);
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
        mapping: {
          [src.entries.global]: { directive: 'existing', destination: 'global' },
          [src.entries.work]: { directive: 'skip' }
        }
      });
      await assert.rejects(
        fresh.restoreProfile(JSON.parse(JSON.stringify(src.bundle)), {
          secret: Buffer.from(MASTER, 'utf8'),
          secretKind: 'master',
          mapping: {
            [src.entries.global]: { directive: 'existing', destination: 'global' },
            [src.entries.work]: { directive: 'skip' }
          }
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
        mapping: {
          [src.entries.global]: { directive: 'skip' },
          [src.entries.work]: { directive: 'skip' }
        }
      });
      assert.equal(third.fresh, false);
    } finally {
      rm(freshDir);
    }
  } finally {
    rm(src.dir);
  }
});
