'use strict';

// Unit tests for restoreProfile()'s MERGE semantics (M18 F3 Leg 2 / flight
// DD4): id identity, keep-both on divergence, zero data loss, non-interactive
// (`mergeReport: { imported, skippedIdentical, conflictCopies }`). All three
// counter classes (identical id+content, diverged id, disjoint ids) are
// pinned together in one scenario per the acceptance criteria, plus the
// destination-item-survival guarantee and the '(imported)' display marking.
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
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-vault-restore-merge-'));
}
function rm(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}
function makeStore(dir, jars = []) {
  // Fixed clock (M18 F3 Leg 2 note): saveItem's _normalizeItem ALWAYS stamps
  // updatedAt = now() regardless of a caller-supplied value, so two
  // independently-saved copies of "the same" item are never byte-identical
  // under a real clock. A fixed injected clock makes a genuinely identical
  // item ACTUALLY identical (content-equality tests need this determinism;
  // production restores compare whatever timestamps the source vault
  // happened to carry, unaffected by this test-only injection).
  return vs.load(dir, { scryptParams: FAST_SCRYPT, listJars: () => jars, now: () => 1000 });
}

test('merge: all three counter classes in ONE scenario (identical id+content skips, diverged id lands as a MARKED copy under a fresh id, disjoint ids coexist) — zero data loss', async () => {
  const jars = [{ id: 'work', name: 'Work', color: '#000', partition: 'persist:container:work', retentionDays: 30 }];

  // Destination: three pre-existing items.
  const destDir = tmpDir();
  const dest = makeStore(destDir, jars);
  await dest.setup({ masterPassword: 'dest pw' });
  dest.saveItem('work', {
    id: 'same-id',
    type: 'login',
    title: 'Identical',
    username: 'same',
    password: 'same-pw',
    origin: 'https://a.example'
  });
  dest.saveItem('work', {
    id: 'diverge-id',
    type: 'login',
    title: 'Original Title',
    username: 'orig',
    password: 'orig-pw',
    origin: 'https://b.example'
  });
  dest.saveItem('work', {
    id: 'dest-only-id',
    type: 'login',
    title: 'DestOnly',
    username: 'd',
    password: 'd-pw',
    origin: 'https://c.example'
  });

  // Source: same-id (byte-identical), diverge-id (same id, different content), plus a
  // disjoint src-only id.
  const srcDir = tmpDir();
  const src = makeStore(srcDir, jars);
  await src.setup({ masterPassword: MASTER });
  src.saveItem('work', {
    id: 'same-id',
    type: 'login',
    title: 'Identical',
    username: 'same',
    password: 'same-pw',
    origin: 'https://a.example'
  });
  src.saveItem('work', {
    id: 'diverge-id',
    type: 'login',
    title: 'Changed Title',
    username: 'changed',
    password: 'changed-pw',
    origin: 'https://b.example'
  });
  src.saveItem('work', {
    id: 'src-only-id',
    type: 'login',
    title: 'SrcOnly',
    username: 's',
    password: 's-pw',
    origin: 'https://d.example'
  });

  try {
    const bundle = src.exportProfile();
    const res = await dest.restoreProfile(JSON.parse(JSON.stringify(bundle)), {
      secret: Buffer.from(MASTER, 'utf8'),
      secretKind: 'master',
      mapping: { global: { directive: 'skip' }, work: { directive: 'existing', destination: 'work', mode: 'merge' } }
    });

    const workRow = res.results.find((r) => r.sourceId === 'work');
    assert.equal(workRow.outcome, 'landed');
    assert.deepEqual(workRow.mergeReport, { imported: 1, skippedIdentical: 1, conflictCopies: 1 });

    const items = dest.listItems('work');
    // Zero data loss: every PRE-MERGE destination item is still present.
    const byId = new Map(items.map((i) => [i.id, i]));
    assert.ok(byId.has('same-id'), 'identical item still present');
    assert.equal(byId.get('same-id').title, 'Identical');
    assert.ok(byId.has('diverge-id'), "destination's OWN diverge-id item is untouched");
    assert.equal(byId.get('diverge-id').title, 'Original Title', 'destination copy unmodified');
    assert.equal(byId.get('diverge-id').password, 'orig-pw');
    assert.ok(byId.has('dest-only-id'), 'dest-only item survives untouched');
    assert.ok(byId.has('src-only-id'), 'disjoint src-only id coexists');
    assert.equal(byId.get('src-only-id').title, 'SrcOnly');

    // The diverged incoming item landed as a COPY under a FRESH id, visibly marked.
    const conflictCopy = items.find((i) => i.title === 'Changed Title (imported)');
    assert.ok(conflictCopy, 'the diverged incoming item is present, marked');
    assert.notEqual(conflictCopy.id, 'diverge-id', 'lands under a FRESH id, never overwriting');
    assert.equal(conflictCopy.password, 'changed-pw');

    // Total count: 3 destination + 2 truly-new (conflict copy + src-only) = 5.
    assert.equal(items.length, 5);
  } finally {
    rm(destDir);
    rm(srcDir);
  }
});

test('merge: an EMPTY destination vault (lazily created by the merge itself) — every incoming item imports, nothing skipped/diverged', async () => {
  const jars = [{ id: 'work', name: 'Work', color: '#000', partition: 'persist:container:work', retentionDays: 30 }];
  const destDir = tmpDir();
  const dest = makeStore(destDir, jars);
  await dest.setup({ masterPassword: 'dest pw' });
  // The destination jar exists in the registry but has NO vault file yet — destExists
  // is false, so this exercises the plain-landed (not merge) branch even with mode:'merge'
  // requested; pinning that a modeless-vs-merge request on a NON-collision is a no-op
  // difference (both just land).
  const srcDir = tmpDir();
  const src = makeStore(srcDir, jars);
  await src.setup({ masterPassword: MASTER });
  src.saveItem('work', { type: 'login', title: 'A', username: 'a', password: 'ap' });
  src.saveItem('work', { type: 'login', title: 'B', username: 'b', password: 'bp' });

  try {
    const bundle = src.exportProfile();
    const res = await dest.restoreProfile(JSON.parse(JSON.stringify(bundle)), {
      secret: Buffer.from(MASTER, 'utf8'),
      secretKind: 'master',
      mapping: { global: { directive: 'skip' }, work: { directive: 'existing', destination: 'work', mode: 'merge' } }
    });
    const workRow = res.results.find((r) => r.sourceId === 'work');
    assert.equal(workRow.outcome, 'landed');
    assert.equal('mergeReport' in workRow, false, 'a no-collision landing carries no mergeReport');
    assert.equal(dest.listItems('work').length, 2);
  } finally {
    rm(destDir);
    rm(srcDir);
  }
});

test('merge: byte-identical content INCLUDES timestamps — a genuinely re-restored bundle (same createdAt/updatedAt) skips every item', async () => {
  const jars = [{ id: 'work', name: 'Work', color: '#000', partition: 'persist:container:work', retentionDays: 30 }];
  const destDir = tmpDir();
  const dest = makeStore(destDir, jars);
  await dest.setup({ masterPassword: 'dest pw' });
  const srcDir = tmpDir();
  const src = makeStore(srcDir, jars);
  await src.setup({ masterPassword: MASTER });
  src.saveItem('work', {
    id: 'x',
    type: 'login',
    title: 'X',
    username: 'x',
    password: 'xp',
    createdAt: 5,
    updatedAt: 5
  });

  try {
    const bundle = src.exportProfile();
    // First restore lands it fresh into the destination (no collision — the jar has no
    // vault yet), then a SECOND restore of the SAME bundle over the SAME destination
    // (now WITH a vault) exercises the identical-content skip path exactly.
    await dest.restoreProfile(JSON.parse(JSON.stringify(bundle)), {
      secret: Buffer.from(MASTER, 'utf8'),
      secretKind: 'master',
      mapping: { global: { directive: 'skip' }, work: { directive: 'existing', destination: 'work' } }
    });
    const res2 = await dest.restoreProfile(JSON.parse(JSON.stringify(bundle)), {
      secret: Buffer.from(MASTER, 'utf8'),
      secretKind: 'master',
      mapping: { global: { directive: 'skip' }, work: { directive: 'existing', destination: 'work', mode: 'merge' } }
    });
    const workRow = res2.results.find((r) => r.sourceId === 'work');
    assert.deepEqual(workRow.mergeReport, { imported: 0, skippedIdentical: 1, conflictCopies: 0 });
    assert.equal(dest.listItems('work').length, 1, 'no duplicate created for a byte-identical re-restore');
  } finally {
    rm(destDir);
    rm(srcDir);
  }
});
