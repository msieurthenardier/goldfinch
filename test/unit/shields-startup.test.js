'use strict';

// Sortie 02 leg 01 AC3/AC4: the pre-ready, read-only startup reader and
// app-db's peekDocumentReadOnly. Real temp dirs and real node:sqlite files.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const appDb = require('../../src/main/app-db');
const shields = require('../../src/main/shields');
const { readStartupShieldsConfig } = require('../../src/main/shields-startup');
const { maskComments } = require('../helpers/source-scan');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gf-shields-startup-'));
}
const read = (dir) => readStartupShieldsConfig({ userDataPath: dir, peek: appDb.peekDocumentReadOnly, fs });
const files = (dir) => fs.readdirSync(dir).sort();

/** Write a shields row via a real app-db.open (the real schema), then close. */
function writeRow(dir, cfg, { keepOpen = false } = {}) {
  appDb.open(dir);
  appDb.createDocumentStore('shields').write(typeof cfg === 'string' ? cfg : JSON.stringify(cfg));
  if (!keepOpen) appDb.close();
}

test('AC3: no app.db and no legacy file -> DEFAULTS, and no app.db is created', () => {
  const dir = tmp();
  const cfg = read(dir);
  assert.deepEqual(cfg, shields.DEFAULTS);
  assert.equal(shields.isolateConfigured(cfg), true);
  assert.deepEqual(files(dir), []);
});

test('AC3: row present with isolate false / enabled false', () => {
  const dir = tmp();
  writeRow(dir, { ...shields.DEFAULTS, isolate: false });
  assert.equal(shields.isolateConfigured(read(dir)), false);
  writeRow(dir, { ...shields.DEFAULTS, enabled: false });
  const cfg = read(dir);
  assert.equal(cfg.isolate, true);
  assert.equal(shields.isolateConfigured(cfg), false, 'master off -> not configured');
});

test('AC3: corrupt app.db and no legacy -> DEFAULTS; with legacy -> legacy parsed and NOT renamed', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'app.db'), Buffer.from('this is not a sqlite database at all'.repeat(40)));
  assert.deepEqual(read(dir), shields.DEFAULTS);
  const legacy = path.join(dir, 'shields.json');
  fs.writeFileSync(legacy, JSON.stringify({ isolate: false }));
  const cfg = read(dir);
  assert.equal(cfg.isolate, false);
  assert.equal(shields.isolateConfigured(cfg), false);
  assert.ok(fs.existsSync(legacy), 'legacy file untouched');
  assert.ok(!fs.existsSync(legacy + '.migrated'), 'legacy file not renamed');
});

test('AC3: legacy only -> parsed (pausedSites repaired); corrupt legacy -> DEFAULTS', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'shields.json'), JSON.stringify({ isolate: false, pausedSites: 'x' }));
  const cfg = read(dir);
  assert.equal(cfg.isolate, false);
  assert.deepEqual(cfg.pausedSites, []);
  assert.deepEqual(files(dir), ['shields.json']);
  fs.writeFileSync(path.join(dir, 'shields.json'), '{not json');
  assert.deepEqual(read(dir), shields.DEFAULTS);
});

test('AC3: a WAL db with uncheckpointed frames (writer still open) -> the latest row is seen', () => {
  const dir = tmp();
  writeRow(dir, { ...shields.DEFAULTS, isolate: true }, { keepOpen: true });
  appDb.createDocumentStore('shields').write(JSON.stringify({ ...shields.DEFAULTS, isolate: false }));
  try {
    assert.equal(read(dir).isolate, false);
  } finally {
    appDb.close();
  }
});

test('AC3: malformed isolate "false" is truthy -> configured, consistent with active()', () => {
  const dir = tmp();
  writeRow(dir, { ...shields.DEFAULTS, isolate: 'false' });
  const cfg = read(dir);
  assert.equal(shields.isolateConfigured(cfg), true);
  assert.equal(!!(cfg.enabled && cfg.isolate), true, 'same truthiness as active()');
});

test('AC3: a reader hitting an EXCLUSIVE lock never throws (rollback-journal db -> falls through to legacy/DEFAULTS)', () => {
  const dir = tmp();
  const file = path.join(dir, 'app.db');
  const rw = new DatabaseSync(file);
  rw.exec('CREATE TABLE documents (store TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL)');
  rw.prepare('INSERT INTO documents VALUES (?1, ?2, ?3)').run('shields', JSON.stringify({ isolate: false }), 1);
  rw.exec('BEGIN EXCLUSIVE');
  try {
    let cfg;
    assert.doesNotThrow(() => {
      cfg = read(dir);
    });
    // Documented outcome: the locked read fails (SQLITE_BUSY) and fails CLOSED to DEFAULTS.
    assert.deepEqual(cfg, shields.DEFAULTS);
    fs.writeFileSync(path.join(dir, 'shields.json'), JSON.stringify({ isolate: false }));
    assert.equal(read(dir).isolate, false, 'locked + legacy -> legacy');
  } finally {
    rw.exec('ROLLBACK');
    rw.close();
  }
});

test('AC3: a WAL db with a held EXCLUSIVE write transaction still reads the last committed row', () => {
  const dir = tmp();
  writeRow(dir, { ...shields.DEFAULTS, isolate: false }, { keepOpen: true });
  const rw = new DatabaseSync(path.join(dir, 'app.db'));
  rw.exec('BEGIN EXCLUSIVE');
  try {
    assert.equal(read(dir).isolate, false);
  } finally {
    rw.exec('ROLLBACK');
    rw.close();
    appDb.close();
  }
});

test('AC3: app.db without a documents table -> falls to legacy / DEFAULTS', () => {
  const dir = tmp();
  const raw = new DatabaseSync(path.join(dir, 'app.db'));
  raw.exec('CREATE TABLE other (x INTEGER)');
  raw.close();
  assert.deepEqual(read(dir), shields.DEFAULTS);
  fs.writeFileSync(path.join(dir, 'shields.json'), JSON.stringify({ isolate: false }));
  assert.equal(read(dir).isolate, false);
});

test('AC3: the reader never throws even when peek and fs throw', () => {
  const boom = () => {
    throw new Error('boom');
  };
  const cfg = readStartupShieldsConfig({
    userDataPath: '/nope',
    peek: boom,
    fs: { existsSync: boom, readFileSync: boom }
  });
  assert.deepEqual(cfg, shields.DEFAULTS);
});

// ---- AC4: peekDocumentReadOnly ---------------------------------------------

test('AC4: missing file -> null and nothing is created (no app.db / -wal / -shm)', () => {
  const dir = tmp();
  assert.equal(appDb.peekDocumentReadOnly(dir, 'shields'), null);
  assert.deepEqual(files(dir), []);
});

test('AC4: present -> payload; absent store -> null; corrupt -> throws; rw open works afterwards', () => {
  const dir = tmp();
  writeRow(dir, { hello: 'world' });
  assert.equal(appDb.peekDocumentReadOnly(dir, 'shields'), JSON.stringify({ hello: 'world' }));
  assert.equal(appDb.peekDocumentReadOnly(dir, 'no-such-store'), null);
  assert.doesNotThrow(() => appDb.open(dir), 'read-write open coexists after a peek');
  assert.equal(appDb.createDocumentStore('shields').read(), JSON.stringify({ hello: 'world' }));
  appDb.close();

  const bad = tmp();
  fs.writeFileSync(path.join(bad, 'app.db'), Buffer.from('garbage'.repeat(200)));
  assert.throws(() => appDb.peekDocumentReadOnly(bad, 'shields'));
});

test('AC4: a read-only peek cannot write (the handle really is readOnly)', () => {
  const dir = tmp();
  writeRow(dir, { a: 1 });
  const before = fs.readFileSync(path.join(dir, 'app.db'));
  appDb.peekDocumentReadOnly(dir, 'shields');
  assert.ok(before.equals(fs.readFileSync(path.join(dir, 'app.db'))), 'main db file bytes unchanged');
});

// ---- AC4: readOnly source-scan pin (a lowercase `readonly` silently opens read-write) ----

const APP_DB_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'main', 'app-db.js'), 'utf8');
const PEEK_BODY_RE = /(function peekDocumentReadOnly\([^)]*\)\s*\{[\s\S]*?\n\})/;
const READONLY_RE = /readOnly:\s*true/;

function assertMutated(before, after, what) {
  assert.notEqual(after, before, `the ${what} mutation did not apply — the .replace() target is stale`);
}

function peekBody(src) {
  const m = maskComments(src).match(PEEK_BODY_RE);
  assert.ok(m, 'peekDocumentReadOnly body must be found');
  return m[1];
}

test('AC4 pin: peekDocumentReadOnly opens with readOnly: true', () => {
  assert.match(peekBody(APP_DB_SRC), READONLY_RE);
});

test('AC4 neuter: a lowercase `readonly` typo turns the pin red', () => {
  const mutated = APP_DB_SRC.replace(PEEK_BODY_RE, (body) => body.replace(/readOnly(:\s*true)/, 'readonly$1'));
  assertMutated(APP_DB_SRC, mutated, 'readOnly -> readonly');
  assert.doesNotMatch(peekBody(mutated), READONLY_RE);
  const dropped = APP_DB_SRC.replace(PEEK_BODY_RE, (body) => body.replace(/\{\s*readOnly:\s*true\s*\}/, '{}'));
  assertMutated(APP_DB_SRC, dropped, 'readOnly option drop');
  assert.doesNotMatch(peekBody(dropped), READONLY_RE);
});
