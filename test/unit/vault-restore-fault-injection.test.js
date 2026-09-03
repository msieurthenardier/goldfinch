'use strict';

// Unit tests for restoreProfile()'s PER-VAULT ATOMICITY + RERUN recovery
// (M18 F3 Leg 2 / flight DD3 ruling 4): an injected mid-list failure leaves
// earlier vaults landed, later vaults untouched, and — on a FRESH profile —
// the manager is left ABSENT (isSetUp() stays false) so a rerun re-adopts
// over the residue. Covers both the fresh and existing-profile paths (the
// `vault-key-rotation.test.js` fault-injection idiom, applied to the
// create-then-verify step).
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-vault-restore-fault-'));
}
function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function makeJarDeps(seed = [], opts = {}) {
  const containers = seed.map((c) => ({ ...c }));
  const failIds = new Set(opts.failVerifyFor ?? []);
  return {
    containers,
    listJars: () => containers,
    createJar: (name, color) => {
      const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'jar';
      const c = { id, name, color, partition: `persist:container:${id}`, retentionDays: 30 };
      containers.push(c);
      return c;
    },
    // Fault injection: verify FAILS for any jar whose NAME (not id) is in failVerifyFor —
    // mirrors jars.add's save() being fail-soft: the in-memory push still happened
    // (containers has the entry) but the durable write is reported as never having landed.
    verifyJarPersisted: (id) => {
      const c = containers.find((x) => x.id === id);
      if (c && failIds.has(c.name)) return false;
      return Boolean(c);
    }
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

async function makeSourceProfile(jarNames) {
  const dir = tmpDir();
  const seed = jarNames.map((n) => ({
    id: n.toLowerCase(),
    name: n,
    color: '#000',
    partition: `persist:container:${n.toLowerCase()}`,
    retentionDays: 30
  }));
  const deps = makeJarDeps(seed);
  const store = makeStore(dir, deps);
  await store.setup({ masterPassword: MASTER });
  store.saveItem('global', { type: 'login', title: 'Global', username: 'g', password: 'gp' });
  for (const n of jarNames) {
    store.saveItem(n.toLowerCase(), {
      type: 'login',
      title: n,
      username: n.toLowerCase(),
      password: `${n.toLowerCase()}-pw`
    });
  }
  const bundle = store.exportProfile();
  return { dir, store, bundle };
}

// ---------------------------------------------------------------------------
// FRESH profile: a mid-list 'new' verify failure leaves earlier vaults
// landed, later untouched, manager ABSENT — rerun re-adopts over the residue.
// ---------------------------------------------------------------------------

test('FRESH restore fault injection: a mid-list new-jar verify failure STOPS the loop — earlier vaults landed, later untouched, isSetUp() stays false; a rerun completes over the residue', async () => {
  const src = await makeSourceProfile(['Alpha', 'Bravo', 'Charlie']);
  try {
    const bundleJson = JSON.stringify(src.bundle);
    // bundle.vaults order is [global, Alpha, Bravo, Charlie] — fail verify for Bravo,
    // the SECOND jar directive, so Alpha (before) lands and Charlie (after) never runs.
    const freshDir = tmpDir();
    const deps = makeJarDeps([], { failVerifyFor: ['Bravo'] });
    try {
      const fresh = makeStore(freshDir, deps);
      const res = await fresh.restoreProfile(JSON.parse(bundleJson), {
        secret: Buffer.from(MASTER, 'utf8'),
        secretKind: 'master',
        mapping: {
          global: { directive: 'existing', destination: 'global' },
          alpha: { directive: 'new', newJar: { name: 'Alpha', color: '#000' } },
          bravo: { directive: 'new', newJar: { name: 'Bravo', color: '#000' } },
          charlie: { directive: 'new', newJar: { name: 'Charlie', color: '#000' } }
        }
      });

      assert.equal(
        fresh.isSetUp(),
        false,
        'the manager is ABSENT — vault-before-manager, no adopt on a mid-list failure'
      );
      const outcomes = new Map(res.results.map((r) => [r.sourceId, r]));
      assert.equal(outcomes.get('global').outcome, 'landed', 'earlier-in-order global landed');
      assert.equal(outcomes.get('alpha').outcome, 'landed', 'earlier-in-order alpha landed');
      assert.equal(outcomes.get('bravo').outcome, 'failed', 'the injected failure');
      assert.equal(outcomes.has('charlie'), false, 'later entries never reached — the loop stopped');

      // Residue on disk: the vault files for the landed entries exist even though
      // there is no manager — the flight's documented recovery shape.
      assert.ok(fs.existsSync(path.join(freshDir, 'vaults', 'global.gfvault')));
      const alphaId = deps.containers.find((c) => c.name === 'Alpha').id;
      assert.ok(fs.existsSync(path.join(freshDir, 'vaults', `${alphaId}.gfvault`)));
      assert.equal(fs.existsSync(path.join(freshDir, 'vaults', 'manager.json')), false);
      // Bravo's residue jar is in the registry (in-memory push survived the fail-soft
      // save) even though its vault never landed — "residue jars surface as mapping
      // destinations" on rerun.
      assert.ok(
        deps.containers.some((c) => c.name === 'Bravo'),
        'the residue jar stays in the registry until restart'
      );

      // RERUN: fix the fault (verify now succeeds for everyone) and complete over the
      // residue — the existing Alpha/Bravo jars are now 'existing' destinations.
      deps.verifyJarPersisted = () => true;
      const alphaExistingId = deps.containers.find((c) => c.name === 'Alpha').id;
      const bravoExistingId = deps.containers.find((c) => c.name === 'Bravo').id;
      const rerun = await fresh.restoreProfile(JSON.parse(bundleJson), {
        secret: Buffer.from(MASTER, 'utf8'),
        secretKind: 'master',
        mapping: {
          global: { directive: 'existing', destination: 'global', mode: 'replace' },
          alpha: { directive: 'existing', destination: alphaExistingId, mode: 'replace' },
          bravo: { directive: 'existing', destination: bravoExistingId },
          charlie: { directive: 'new', newJar: { name: 'Charlie', color: '#000' } }
        }
      });
      assert.equal(fresh.isSetUp(), true, 'the rerun completes the adopt');
      const rerunOutcomes = new Map(rerun.results.map((r) => [r.sourceId, r]));
      assert.equal(rerunOutcomes.get('bravo').outcome, 'landed');
      assert.equal(rerunOutcomes.get('charlie').outcome, 'landed');
      assert.equal(fresh.isUnlocked(), true);
      assert.equal(fresh.listItems(bravoExistingId)[0].password, 'bravo-pw');
    } finally {
      rm(freshDir);
    }
  } finally {
    rm(src.dir);
  }
});

// ---------------------------------------------------------------------------
// EXISTING profile: a mid-list failure leaves earlier vaults landed, later
// untouched — no manager involvement, but the SAME stop-on-failure shape.
// ---------------------------------------------------------------------------

test('EXISTING-profile restore fault injection: a mid-list new-jar verify failure leaves earlier vaults landed, later untouched — rerun recovers', async () => {
  const src = await makeSourceProfile(['Alpha', 'Bravo', 'Charlie']);
  try {
    const bundleJson = JSON.stringify(src.bundle);
    const destDir = tmpDir();
    const deps = makeJarDeps([], { failVerifyFor: ['Bravo'] });
    try {
      const dest = makeStore(destDir, deps);
      await dest.setup({ masterPassword: 'dest pw' });

      const res = await dest.restoreProfile(JSON.parse(bundleJson), {
        secret: Buffer.from(MASTER, 'utf8'),
        secretKind: 'master',
        mapping: {
          global: { directive: 'skip' },
          alpha: { directive: 'new', newJar: { name: 'Alpha', color: '#000' } },
          bravo: { directive: 'new', newJar: { name: 'Bravo', color: '#000' } },
          charlie: { directive: 'new', newJar: { name: 'Charlie', color: '#000' } }
        }
      });

      const outcomes = new Map(res.results.map((r) => [r.sourceId, r]));
      assert.equal(outcomes.get('alpha').outcome, 'landed');
      assert.equal(outcomes.get('bravo').outcome, 'failed');
      assert.equal(outcomes.has('charlie'), false, 'later entries never reached');
      assert.equal(dest.isSetUp(), true, 'the profile was already set up — unaffected by the residue');

      // Rerun completes it.
      deps.verifyJarPersisted = () => true;
      const bravoId = deps.containers.find((c) => c.name === 'Bravo').id;
      const rerun = await dest.restoreProfile(JSON.parse(bundleJson), {
        secret: Buffer.from(MASTER, 'utf8'),
        secretKind: 'master',
        mapping: {
          global: { directive: 'skip' },
          alpha: {
            directive: 'existing',
            destination: deps.containers.find((c) => c.name === 'Alpha').id,
            mode: 'replace'
          },
          bravo: { directive: 'existing', destination: bravoId },
          charlie: { directive: 'new', newJar: { name: 'Charlie', color: '#000' } }
        }
      });
      const rerunOutcomes = new Map(rerun.results.map((r) => [r.sourceId, r]));
      assert.equal(rerunOutcomes.get('bravo').outcome, 'landed');
      assert.equal(rerunOutcomes.get('charlie').outcome, 'landed');
      assert.equal(dest.listItems(bravoId)[0].password, 'bravo-pw');
    } finally {
      rm(destDir);
    }
  } finally {
    rm(src.dir);
  }
});

test('zeroize discipline: a mid-loop throw leaves zero live bundle-vault-key buffers (per-iteration finally, ruling 11) — pinned via a monkeypatched decryptItems that throws on the SECOND vault', async () => {
  const src = await makeSourceProfile(['Alpha', 'Bravo']);
  try {
    const vc = require('../../src/main/vault/vault-crypto');
    const original = vc.decryptItems;
    const seenKeys = [];
    let call = 0;
    vc.decryptItems = (blob, key, version) => {
      call++;
      if (call === 2) {
        // Capture the SAME buffer reference (not a copy!) so we can observe the
        // store's per-iteration `finally` zeroizing it despite this throw.
        seenKeys.push(key);
        throw new Error('injected mid-loop failure');
      }
      return original(blob, key, version);
    };
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
              alpha: { directive: 'new', newJar: { name: 'Alpha', color: '#000' } },
              bravo: { directive: 'new', newJar: { name: 'Bravo', color: '#000' } }
            }
          }),
          (e) => /injected mid-loop failure/.test(e.message)
        );
        assert.equal(seenKeys.length, 1);
        assert.ok(seenKeys[0].equals(Buffer.alloc(32, 0)), 'the per-iteration finally zeroized the vault key on throw');
      } finally {
        rm(destDir);
      }
    } finally {
      vc.decryptItems = original;
    }
  } finally {
    rm(src.dir);
  }
});
