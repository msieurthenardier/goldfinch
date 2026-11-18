'use strict';

// Every file in docs/releases/ is either the format guide or a per-version notes file the
// release workflow can publish (sortie 10). The workflow's own splitter is executed against these
// files in release-workflow-invariants.test.js; this file is JS-only and checks the files' shape.
// The path check below is deliberately narrow. Squawk 0204 (a repo-wide path-hygiene scan) is
// still open; when it lands it should absorb these patterns into its one shared scan.

const test = require('node:test');
const assert = require('node:assert/strict');
const { readdirSync, readFileSync } = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', '..');
const DIR = path.join(ROOT, 'docs', 'releases');
const entries = readdirSync(DIR);
const notes = entries.filter((n) => /^v\d+\.\d+\.\d+\.md$/.test(n));
const text = (n) =>
  readFileSync(path.join(DIR, n), 'utf8')
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '');

/** The path patterns no release notes file may contain. `~/` is fine only before `.config/goldfinch` or `Library/Application Support/goldfinch`. */
function pathProblems(s) {
  const out = [];
  for (const p of ['/home/', '/Users/', 'C:\\Users\\', '\\Users\\', '/tmp/', '/var/folders/'])
    if (s.includes(p)) out.push(p);
  for (const m of s.matchAll(/~\//g)) {
    const rest = s.slice(m.index + 2);
    if (!rest.startsWith('.config/goldfinch') && !rest.startsWith('Library/Application Support/goldfinch'))
      out.push('~/');
  }
  return out;
}

test('docs/releases holds the guide and at least one notes file, nothing else', () => {
  assert.ok(notes.length > 0, 'no v*.md notes files found');
  assert.ok(entries.includes('README.md'), 'no README.md format guide');
  for (const n of entries) assert.ok(n === 'README.md' || /^v\d+\.\d+\.\d+\.md$/.test(n), `unexpected entry ${n}`);
});

test('each notes file has its own version in its title line and a non-empty body', () => {
  for (const n of notes) {
    const v = n.slice(1, -3);
    const lines = text(n).split('\n');
    assert.ok(lines[0].startsWith(`# v${v} `), `${n}: title line must start with "# v${v} "`);
    assert.ok(
      lines[0].length > `# v${v} `.length && !/\s$/.test(lines[0]),
      `${n}: title text missing or trailing space`
    );
    assert.ok(lines.slice(1).join('\n').trim().length > 0, `${n}: empty body`);
  }
});

test('the package.json version has a notes file', () => {
  const v = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  assert.ok(notes.includes(`v${v}.md`), `docs/releases/v${v}.md is missing (write it in the release-prep change)`);
});

test('no notes file or the guide carries a local path', () => {
  for (const n of entries) assert.deepEqual(pathProblems(text(n)), [], n);
});

test('the path check accepts the three real data-folder strings and rejects local paths', () => {
  for (const ok of [
    '%APPDATA%\\goldfinch\\vaults',
    '~/.config/goldfinch/vaults',
    '~/Library/Application Support/goldfinch/vaults'
  ])
    assert.deepEqual(pathProblems(ok), [], ok);
  for (const bad of [
    '/home/x',
    '/Users/x',
    'C:\\Users\\x',
    '\\Users\\x',
    '/tmp/x',
    '/var/folders/x',
    '~/notes',
    '~/'
  ]) {
    assert.ok(pathProblems(bad).length > 0, bad);
  }
});
