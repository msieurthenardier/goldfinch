'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createCrashLog, originOf, jarKindOf, kindOfChildProcess } = require('../../src/main/crash-log');
const { INTERNAL_PARTITION } = require('../../src/shared/internal-page');

const DIR = '/fake/userData';
const LOG_PATH = path.join(DIR, 'crash-log.jsonl');

function makeFakeFs() {
  /** @type {Map<string, { content: string, mtime: number }>} */
  const files = new Map();
  let seq = 0;
  return {
    files,
    seed(p, content, mtime) {
      files.set(p, { content, mtime: mtime ?? ++seq });
    },
    appendFileSync(p, data) {
      const cur = files.get(p);
      files.set(p, { content: (cur ? cur.content : '') + data, mtime: ++seq });
    },
    writeFileSync(p, data) {
      files.set(p, { content: data, mtime: ++seq });
    },
    readFileSync(p) {
      const cur = files.get(p);
      if (!cur) {
        const err = new Error('ENOENT');
        // @ts-ignore
        err.code = 'ENOENT';
        throw err;
      }
      return cur.content;
    },
    readdirSync(dir) {
      const names = [];
      for (const p of files.keys()) {
        if (path.dirname(p) === dir) names.push(path.basename(p));
      }
      return names;
    },
    statSync(p) {
      const cur = files.get(p);
      if (!cur) {
        const err = new Error('ENOENT');
        // @ts-ignore
        err.code = 'ENOENT';
        throw err;
      }
      return { mtimeMs: cur.mtime };
    },
    unlinkSync(p) {
      if (!files.has(p)) {
        const err = new Error('ENOENT');
        // @ts-ignore
        err.code = 'ENOENT';
        throw err;
      }
      files.delete(p);
    }
  };
}

function makeLogger() {
  const warns = [];
  return { warns, warn: (...a) => warns.push(a) };
}

function readLines(fs) {
  const cur = fs.files.get(LOG_PATH);
  if (!cur) return [];
  return cur.content
    .split('\n')
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));
}

// ---------------------------------------------------------------------------
// AC5: exactly the eight allowed keys, source-scan on the writer's literal
// ---------------------------------------------------------------------------

test('crash-log.js record() writer literal has exactly the eight allowed keys', () => {
  const src = require('node:fs').readFileSync(require.resolve('../../src/main/crash-log.js'), 'utf8');
  const m = src.match(/const entry = \{([\s\S]*?)\n\s*\};/);
  assert.ok(m, 'expected an `const entry = { ... };` object literal');
  const body = m[1];
  // Matches both `key: value` entries and shorthand `key,`/`key` entries.
  const keys = [...body.matchAll(/^\s*([a-zA-Z][\w]*)\s*[:,]?/gm)].map((x) => x[1]).filter(Boolean);
  assert.deepEqual(
    keys.sort(),
    ['exitCode', 'jarKind', 'kind', 'origin', 'recovery', 'reason', 'ts', 'windowId'].sort()
  );
});

test('record() destructures its input rather than spreading it', () => {
  const src = require('node:fs').readFileSync(require.resolve('../../src/main/crash-log.js'), 'utf8');
  assert.equal(/\.\.\.input/.test(src), false, 'record() must never spread its input');
});

// ---------------------------------------------------------------------------
// originOf — redaction table
// ---------------------------------------------------------------------------

test('originOf strips path/query/fragment/userinfo, keeps scheme+host+non-default-port', () => {
  assert.equal(originOf('https://example.com/a/b?x=1#frag', null), 'https://example.com');
  assert.equal(originOf('https://user:pass@example.com:8443/secret', null), 'https://example.com:8443');
  assert.equal(originOf('http://example.com:80/', null), 'http://example.com');
});

test('originOf reconstructs goldfinch://host (Node origin is "null" for the custom scheme)', () => {
  assert.equal(originOf('goldfinch://settings/#privacy', INTERNAL_PARTITION), 'goldfinch://settings');
});

test('originOf returns null for a burner partition regardless of url', () => {
  assert.equal(originOf('https://example.com/x', 'burner:1'), null);
});

test('originOf returns null for an unparsable or empty url', () => {
  assert.equal(originOf('', null), null);
  assert.equal(originOf(undefined, null), null);
  assert.equal(originOf('not a url', null), null);
});

test('originOf returns null for a non-http(s)/goldfinch scheme', () => {
  assert.equal(originOf('file:///etc/passwd', null), null);
});

// ---------------------------------------------------------------------------
// jarKindOf
// ---------------------------------------------------------------------------

test('jarKindOf maps internal/burner/persistent/null', () => {
  assert.equal(jarKindOf(INTERNAL_PARTITION), 'internal');
  assert.equal(jarKindOf('burner:1'), 'burner');
  assert.equal(jarKindOf('persist:jar-1'), 'persistent');
  assert.equal(jarKindOf(null), null);
  assert.equal(jarKindOf(undefined), null);
});

// ---------------------------------------------------------------------------
// kindOfChildProcess — the capitalised-type table
// ---------------------------------------------------------------------------

test('kindOfChildProcess maps the capitalised Electron type table', () => {
  assert.equal(kindOfChildProcess('GPU'), 'gpu');
  assert.equal(kindOfChildProcess('Utility'), 'utility');
  for (const t of ['Zygote', 'Sandbox helper', 'Pepper Plugin', 'Pepper Plugin Broker', 'Unknown', 'anything-else']) {
    assert.equal(kindOfChildProcess(t), 'other');
  }
  assert.equal(kindOfChildProcess(undefined), 'other');
});

// ---------------------------------------------------------------------------
// record()
// ---------------------------------------------------------------------------

test('record() writes one JSON line with the redacted fields', () => {
  const fs = makeFakeFs();
  const logger = makeLogger();
  const crashLog = createCrashLog({ dir: DIR, fs, now: () => new Date('2026-09-16T00:00:00.000Z'), logger });
  crashLog.record({
    kind: 'guest',
    reason: 'crashed',
    exitCode: 139,
    url: 'https://example.com/secret/path?x=1',
    partition: 'persist:jar-1',
    windowId: 7,
    recovery: 'panel'
  });
  const lines = readLines(fs);
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0], {
    ts: '2026-09-16T00:00:00.000Z',
    kind: 'guest',
    reason: 'crashed',
    exitCode: 139,
    origin: 'https://example.com',
    jarKind: 'persistent',
    windowId: 7,
    recovery: 'panel'
  });
  assert.equal(logger.warns.length, 1);
});

test('record() folds an unknown recovery value to "ignored"', () => {
  const fs = makeFakeFs();
  const crashLog = createCrashLog({ dir: DIR, fs, now: () => new Date() });
  crashLog.record({ kind: 'gpu', reason: 'crashed', exitCode: 1, recovery: 'bogus' });
  assert.equal(readLines(fs)[0].recovery, 'ignored');
});

test('record() defaults an absent windowId to null', () => {
  const fs = makeFakeFs();
  const crashLog = createCrashLog({ dir: DIR, fs, now: () => new Date() });
  crashLog.record({ kind: 'utility', reason: 'killed', exitCode: 9 });
  assert.equal(readLines(fs)[0].windowId, null);
});

test('record() never throws when the file is unwritable', () => {
  const fs = makeFakeFs();
  fs.appendFileSync = () => {
    throw new Error('EROFS');
  };
  const logger = makeLogger();
  const crashLog = createCrashLog({ dir: DIR, fs, now: () => new Date(), logger });
  assert.doesNotThrow(() => crashLog.record({ kind: 'guest', reason: 'crashed', exitCode: 139 }));
  assert.equal(logger.warns.length, 1);
});

test('record() rotates: over cap keeps the newest cap/2 lines', () => {
  const fs = makeFakeFs();
  const crashLog = createCrashLog({ dir: DIR, fs, now: () => new Date(), cap: 10 });
  for (let i = 0; i < 12; i++) {
    crashLog.record({ kind: 'guest', reason: 'crashed', exitCode: i, recovery: 'panel' });
  }
  const lines = readLines(fs);
  // The 11th write (index 10) pushes the file to 11 lines (> cap 10), rotating
  // to the newest 5 (exitCodes 6..10); the 12th write then appends exitCode 11
  // without re-triggering rotation (6 lines is not > cap).
  assert.equal(lines.length, 6);
  assert.deepEqual(
    lines.map((l) => l.exitCode),
    [6, 7, 8, 9, 10, 11]
  );
});

// ---------------------------------------------------------------------------
// pruneDumps
// ---------------------------------------------------------------------------

test('pruneDumps keeps the newest N and deletes the rest', () => {
  const fs = makeFakeFs();
  const dumpDir = '/fake/userData/crashDumps';
  for (let i = 0; i < 5; i++) {
    fs.seed(path.join(dumpDir, `dump-${i}.dmp`), 'x', i);
  }
  const crashLog = createCrashLog({ dir: DIR, fs, now: () => new Date(), keepDumps: 2 });
  crashLog.pruneDumps(dumpDir);
  const remaining = [...fs.files.keys()].filter((p) => p.endsWith('.dmp'));
  assert.deepEqual(remaining.sort(), [path.join(dumpDir, 'dump-3.dmp'), path.join(dumpDir, 'dump-4.dmp')].sort());
});

test('pruneDumps probes the Crashpad pending/completed subdirectories too', () => {
  const fs = makeFakeFs();
  const dumpDir = '/fake/userData/crashDumps';
  fs.seed(path.join(dumpDir, 'Crashpad', 'pending', 'a.dmp'), 'x', 1);
  fs.seed(path.join(dumpDir, 'Crashpad', 'pending', 'b.dmp'), 'x', 2);
  fs.seed(path.join(dumpDir, 'Crashpad', 'completed', 'c.dmp'), 'x', 3);
  const crashLog = createCrashLog({ dir: DIR, fs, now: () => new Date(), keepDumps: 1 });
  crashLog.pruneDumps(dumpDir);
  const remaining = [...fs.files.keys()].filter((p) => p.endsWith('.dmp'));
  assert.deepEqual(remaining, [path.join(dumpDir, 'Crashpad', 'completed', 'c.dmp')]);
});

test('pruneDumps on an absent dump directory returns silently', () => {
  const fs = makeFakeFs();
  const crashLog = createCrashLog({ dir: DIR, fs, now: () => new Date() });
  assert.doesNotThrow(() => crashLog.pruneDumps('/fake/userData/crashDumps'));
});

test('pruneDumps never throws even if unlink fails', () => {
  const fs = makeFakeFs();
  const dumpDir = '/fake/userData/crashDumps';
  fs.seed(path.join(dumpDir, 'a.dmp'), 'x', 1);
  fs.seed(path.join(dumpDir, 'b.dmp'), 'x', 2);
  fs.unlinkSync = () => {
    throw new Error('EPERM');
  };
  const crashLog = createCrashLog({ dir: DIR, fs, now: () => new Date(), keepDumps: 1 });
  assert.doesNotThrow(() => crashLog.pruneDumps(dumpDir));
});
