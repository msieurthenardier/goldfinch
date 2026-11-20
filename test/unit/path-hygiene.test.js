'use strict';
// Squawk 0204: private absolute paths (embedding the OS user name) must not
// reach public artifacts. Scans tracked files under the artifact directories.
const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const DIRS = ['missions', 'sorties', 'squawks', 'docs', 'tests/behavior'];
const NAME = '[A-Za-z0-9._-]+';
const PATTERNS = [
  { id: 'linux-home', re: new RegExp(`/home/${NAME}/`) },
  { id: 'mac-home', re: new RegExp(`/Users/${NAME}/`) },
  { id: 'windows-home', re: new RegExp(`[A-Za-z]:\\\\Users\\\\${NAME}\\\\`) },
  { id: 'claude-session-tmp', re: /\/tmp\/claude-\d+\// }
];

function findHits(text) {
  const hits = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const p of PATTERNS) if (p.re.test(line)) hits.push({ line: i + 1, id: p.id });
  });
  return hits;
}

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z', '--', ...DIRS], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024
  });
  return out.split('\0').filter(Boolean);
}

test('patterns hit real-looking private paths', () => {
  for (const s of [
    'see /home/someone/x',
    'at /Users/jdoe/proj/a.js',
    'C:\\Users\\jdoe\\AppData\\x',
    '/mnt/c/Users/jdoe/Downloads',
    '/tmp/claude-1000/-home-x/scratchpad'
  ]) {
    assert.ok(findHits(s).length > 0, `should hit: ${s}`);
  }
});

test('patterns ignore placeholders and generic paths', () => {
  for (const s of [
    '/home/<name>/x',
    '/home/<user>/projects',
    '<session-scratch>/out.json',
    '<repo>/src/main.js',
    '/tmp/behavior-tests/goldfinch/run-1/evidence.png',
    '/Users/<name>/x',
    'C:\\Users\\<name>\\x'
  ]) {
    assert.deepStrictEqual(findHits(s), [], `should not hit: ${s}`);
  }
});

test('no private absolute paths in tracked public artifacts', () => {
  const files = trackedFiles();
  assert.ok(files.length > 100, `scan read only ${files.length} files`);
  const found = [];
  let read = 0;
  for (const f of files) {
    let text;
    try {
      text = fs.readFileSync(path.join(ROOT, f), 'utf8');
    } catch {
      continue;
    }
    read++;
    for (const h of findHits(text)) found.push(`${f}:${h.line} (${h.id})`);
  }
  assert.ok(read > 100, `scan read only ${read} files`);
  assert.deepStrictEqual(found, [], `private paths found:\n${found.join('\n')}`);
});
