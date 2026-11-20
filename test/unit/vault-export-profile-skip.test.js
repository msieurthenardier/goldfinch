'use strict';

// Squawk 0190: a whole-profile export must not fail entirely because one vault file is
// unreadable. It writes the readable vaults and REPORTS the skipped one (id + reason code
// only); it refuses (throws) when no vault at all could be read. Electron-free, FAST scrypt.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vs = require('../../src/main/vault/vault-store');

const FAST_SCRYPT = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MASTER = 'correct horse battery staple';
const jar = (id, name) => ({ id, name, color: '#000', partition: `persist:container:${id}`, retentionDays: 30 });
const JARS = [jar('work', 'Work'), jar('personal', 'Personal')];

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-vault-export-skip-'));
}
function makeStore(dir, logs = []) {
  return vs.load(dir, { scryptParams: FAST_SCRYPT, listJars: () => JARS, log: (m) => logs.push(m) });
}
function login(id, title) {
  return { id, type: 'login', title, username: 'u', password: `${title}-pw`, origin: 'https://example.com' };
}

async function buildProfile(logs) {
  const dir = tmpDir();
  const store = makeStore(dir, logs);
  await store.setup({ masterPassword: MASTER });
  store.saveItem('global', login('g1', 'GlobalItem'));
  store.saveItem('work', login('w1', 'WorkItem'));
  store.saveItem('personal', login('p1', 'PersonalItem'));
  return { dir, store };
}

test('export-profile: one corrupt vault is skipped and reported; the rest export and restore', async () => {
  const logs = [];
  const src = await buildProfile(logs);
  const dstDir = tmpDir();
  try {
    fs.writeFileSync(path.join(src.dir, 'vaults', 'work.gfvault'), '{ not a vault');
    const { bundle, carried, skipped } = src.store.exportProfile();

    assert.equal(bundle.vaults.length, 2);
    assert.deepEqual(carried, ['Global', 'Personal']);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0].id, 'work');
    assert.match(skipped[0].reason, /^[a-z-]+$/);
    assert.deepEqual(Object.keys(skipped[0]).sort(), ['id', 'reason']);
    const skipLogs = logs.filter((m) => m.includes('export-profile'));
    assert.equal(skipLogs.length, 1);
    assert.ok(!skipLogs[0].includes('WorkItem') && !skipLogs[0].includes('-pw'));
    assert.ok(!('skipped' in bundle), 'the skipped list is never part of the bundle');

    // Restore the bundle into a fresh destination: good vaults' items survive, the bad one is absent.
    const dest = makeStore(dstDir);
    await dest.setup({ masterPassword: 'dest pw' });
    const wire = JSON.parse(JSON.stringify(bundle));
    const mapping = {
      [wire.vaults[0].entryHandle]: { directive: 'existing', destination: 'global', mode: 'merge' },
      [wire.vaults[1].entryHandle]: { directive: 'existing', destination: 'personal', mode: 'merge' }
    };
    const res = await dest.restoreProfile(wire, { secret: Buffer.from(MASTER, 'utf8'), secretKind: 'master', mapping });
    assert.ok(res.results.every((r) => r.outcome === 'landed'));
    assert.deepEqual(
      dest.listItems('global').map((i) => i.title),
      ['GlobalItem']
    );
    assert.deepEqual(
      dest.listItems('personal').map((i) => i.title),
      ['PersonalItem']
    );
    assert.deepEqual(dest.listItems('work'), []);
  } finally {
    fs.rmSync(src.dir, { recursive: true, force: true });
    fs.rmSync(dstDir, { recursive: true, force: true });
  }
});

test('export-profile: a clean profile reports nothing skipped', async () => {
  const src = await buildProfile([]);
  try {
    const { bundle, skipped } = src.store.exportProfile();
    assert.equal(bundle.vaults.length, 3);
    assert.deepEqual(skipped, []);
  } finally {
    fs.rmSync(src.dir, { recursive: true, force: true });
  }
});

test('export-profile: when EVERY vault is unreadable the export refuses instead of writing an empty bundle', async () => {
  const src = await buildProfile([]);
  try {
    for (const id of ['global', 'work', 'personal']) {
      fs.writeFileSync(path.join(src.dir, 'vaults', `${id}.gfvault`), 'garbage');
    }
    assert.throws(
      () => src.store.exportProfile(),
      (e) => e instanceof vs.VaultFormatError
    );
  } finally {
    fs.rmSync(src.dir, { recursive: true, force: true });
  }
});
