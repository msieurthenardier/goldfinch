'use strict';

// Leg `clipboard-and-file-modes` AC6/AC7/AC8: owner-only modes, set at creation and tightened once.
// Mode bits are meaningless on win32, so every real-filesystem test is skipped there.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createFileModes } = require('../../src/main/file-modes');
const { writeFileAtomic } = require('../../src/main/vault/atomic-write');
const appDb = require('../../src/main/app-db');
const historyStore = require('../../src/main/history-store');

const skip = process.platform === 'win32' ? 'mode bits are not enforced on win32' : false;
const mode = (p) => fs.statSync(p).mode & 0o777;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gf-modes-'));

test(
  'writeFileAtomic creates the file 0600 even under a permissive umask (skipped on win32: no mode bits)',
  { skip },
  () => {
    const d = tmp();
    const old = process.umask(0);
    try {
      const f = path.join(d, 'x.gfvault');
      writeFileAtomic(f, 'hello');
      assert.equal(mode(f), 0o600);
    } finally {
      process.umask(old);
      fs.rmSync(d, { recursive: true });
    }
  }
);

test(
  'ensureOwnerDir creates 0700 and tightens an existing directory (skipped on win32: no mode bits)',
  { skip },
  () => {
    const d = tmp();
    const old = process.umask(0);
    try {
      const modes = createFileModes({ fs });
      const fresh = path.join(d, 'a', 'vaults');
      modes.ensureOwnerDir(fresh);
      assert.equal(mode(fresh), 0o700);
      const existing = path.join(d, 'b');
      fs.mkdirSync(existing, { mode: 0o755 });
      modes.ensureOwnerDir(existing);
      assert.equal(mode(existing), 0o700);
    } finally {
      process.umask(old);
      fs.rmSync(d, { recursive: true });
    }
  }
);

test('app.db and history.db are created 0600 with 0600 sidecars (skipped on win32: no mode bits)', { skip }, () => {
  const d = tmp();
  const old = process.umask(0);
  try {
    appDb.open(d);
    historyStore.open(d);
    appDb.createDocumentStore('t').write('{}');
    historyStore.recordVisit({ jarId: 'j', url: 'https://example.test/', visitedAt: 1 });
    const names = fs.readdirSync(d).filter((n) => /^(app|history)\.db/.test(n));
    assert.ok(names.includes('app.db') && names.includes('history.db'));
    assert.ok(
      names.some((n) => n.endsWith('-wal')),
      'WAL sidecar exists while open'
    );
    for (const n of names) assert.equal(mode(path.join(d, n)), 0o600, n);
  } finally {
    appDb.close();
    historyStore.close();
    process.umask(old);
    fs.rmSync(d, { recursive: true });
  }
});

test(
  'existing databases, sidecars, quarantines and .migrated files are tightened at open (skipped on win32: no mode bits)',
  { skip },
  () => {
    const d = tmp();
    try {
      appDb.open(d);
      historyStore.open(d);
      historyStore.recordVisit({ jarId: 'j', url: 'https://example.test/', visitedAt: 1 });
      // Simulate a pre-leg profile: loosen everything, then add siblings.
      fs.writeFileSync(path.join(d, 'app.db.corrupt-1'), 'x');
      fs.writeFileSync(path.join(d, 'history.db-wal.corrupt-2'), 'x');
      fs.writeFileSync(path.join(d, 'settings.json.migrated'), '{}');
      fs.writeFileSync(path.join(d, 'unrelated.txt'), 'x');
      for (const n of fs.readdirSync(d)) fs.chmodSync(path.join(d, n), 0o644);
      appDb.close();
      historyStore.close();
      appDb.open(d);
      historyStore.open(d);
      for (const n of fs.readdirSync(d)) {
        if (n === 'unrelated.txt') assert.equal(mode(path.join(d, n)), 0o644, 'unrelated files are left alone');
        else assert.equal(mode(path.join(d, n)), 0o600, n);
      }
      // Idempotent.
      appDb.close();
      appDb.open(d);
      assert.equal(mode(path.join(d, 'app.db')), 0o600);
    } finally {
      appDb.close();
      historyStore.close();
      fs.rmSync(d, { recursive: true });
    }
  }
);

test('a pre-created zero-length database is a valid empty database, and a corrupt one still quarantines', () => {
  const d = tmp();
  try {
    fs.writeFileSync(path.join(d, 'app.db'), '');
    appDb.open(d);
    appDb.close();
    const bad = tmp();
    fs.writeFileSync(path.join(bad, 'app.db'), 'this is not a sqlite file at all, just text padding..........');
    appDb.open(bad);
    assert.ok(fs.readdirSync(bad).some((n) => n.startsWith('app.db.corrupt-')));
    appDb.close();
    if (!skip) assert.equal(mode(path.join(bad, 'app.db')), 0o600, 'the recreated file is owner-only too');
    fs.rmSync(bad, { recursive: true });
  } finally {
    appDb.close();
    fs.rmSync(d, { recursive: true });
  }
});

test('chmod/mkdir failures never throw and are logged once, not per file', () => {
  const warns = [];
  const failing = {
    ...fs,
    chmodSync() {
      throw Object.assign(new Error('nope'), { code: 'EPERM' });
    },
    mkdirSync() {
      throw Object.assign(new Error('nope'), { code: 'EROFS' });
    },
    openSync() {
      throw Object.assign(new Error('nope'), { code: 'EROFS' });
    },
    existsSync: () => false
  };
  const modes = createFileModes({ fs: failing, logger: { warn: (...a) => warns.push(a) } });
  modes.chmodFile('/a');
  modes.chmodFile('/b');
  modes.chmodDir('/c');
  modes.ensureOwnerDir('/d');
  modes.precreateOwnerFile('/e');
  modes.prepareDatabaseFiles('/f/app.db');
  assert.equal(warns.length, 1);
});

test('a missing vaults directory or file is silent (ENOENT)', () => {
  const warns = [];
  const modes = createFileModes({ fs, logger: { warn: (...a) => warns.push(a) } });
  modes.chmodFile('/nonexistent-gf/x');
  modes.chmodDir('/nonexistent-gf');
  modes.tightenFilesIn('/nonexistent-gf', () => true);
  assert.deepEqual(warns, []);
});

// The bundle export writer lives in main.js (Electron-bound): source-scan pin of its mode handling.
test('the bundle export writes mode 0600 on creation and tightens an overwritten file', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/main/main.js'), 'utf8');
  const m =
    /fs\.writeFileSync\(\s*filePath,\s*JSON\.stringify\(bundle\),[\s\S]*?return \{ ok: true, path: filePath \};/.exec(
      src
    );
  assert.ok(m, 'export writer found');
  assert.match(m[0], /flag: 'wx', mode: 0o600/);
  assert.match(m[0], /\{ encoding: 'utf8', mode: 0o600 \}/);
  assert.match(m[0], /if \(!exclusive\) \{\s*try \{\s*fs\.chmodSync\(filePath, 0o600\)/);
  // Neuter: dropping the overwrite chmod must make the pattern miss.
  const neutered = m[0].replace(/fs\.chmodSync\(filePath, 0o600\)/, 'void 0');
  assert.notEqual(neutered, m[0]);
  assert.doesNotMatch(neutered, /fs\.chmodSync\(filePath, 0o600\)/);
});

test(
  'a symbolic link is never followed: its target outside the directory keeps its mode (skipped on win32: symlinks and mode bits)',
  { skip },
  () => {
    const outside = tmp();
    const inside = tmp();
    try {
      fs.chmodSync(outside, 0o755);
      const target = path.join(outside, 'target.txt');
      fs.writeFileSync(target, 'x', { mode: 0o644 });
      fs.chmodSync(target, 0o644);
      const link = path.join(inside, 'app.db-wal');
      fs.symlinkSync(target, link);
      const dirLink = path.join(outside, 'dirlink');
      fs.symlinkSync(outside, dirLink);
      const warns = [];
      const modes = createFileModes({ fs, logger: { warn: (...a) => warns.push(a) } });
      modes.tightenFilesIn(inside, () => true);
      modes.chmodFile(link);
      modes.precreateOwnerFile(link);
      modes.chmodDir(dirLink);
      modes.ensureOwnerDir(dirLink);
      modes.prepareDatabaseFiles(path.join(inside, 'app.db'));
      assert.equal(mode(target), 0o644, 'target untouched');
      assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
      assert.equal(mode(outside), 0o755, 'directory behind a link untouched');
      assert.equal(mode(path.join(inside, 'app.db')), 0o600, 'a regular database file is still created 0600');
      assert.equal(warns.length, 1, 'the link skip is logged once');
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
      fs.rmSync(inside, { recursive: true, force: true });
    }
  }
);
