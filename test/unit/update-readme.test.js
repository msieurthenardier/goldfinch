const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

test('README updater emits the electron-builder Windows asset name', (t) => {
  const workdir = mkdtempSync(path.join(tmpdir(), 'goldfinch-readme-'));
  t.after(() => rmSync(workdir, { recursive: true, force: true }));

  writeFileSync(
    path.join(workdir, 'README.md'),
    'before\n<!-- DOWNLOADS:START -->\nold\n<!-- DOWNLOADS:END -->\nafter\n'
  );

  execFileSync(process.execPath, [path.join(__dirname, '../../scripts/update-readme.mjs'), '1.2.3'], { cwd: workdir });

  const readme = readFileSync(path.join(workdir, 'README.md'), 'utf8');
  assert.match(readme, /Goldfinch-Setup-1\.2\.3\.exe/);
  assert.doesNotMatch(readme, /Goldfinch\.Setup\.1\.2\.3\.exe/);
});

test('README updater leaves the text after the generated block unchanged', (t) => {
  const workdir = mkdtempSync(path.join(tmpdir(), 'goldfinch-readme-'));
  t.after(() => rmSync(workdir, { recursive: true, force: true }));

  const after = '\n### Verify your download\n\nhand-written text, `gh attestation verify <file>`\n\n## Features\n';
  const before = '# Title\n\n## Download\n\n';
  writeFileSync(
    path.join(workdir, 'README.md'),
    `${before}<!-- DOWNLOADS:START -->\nold\n<!-- DOWNLOADS:END -->\n${after}`
  );

  execFileSync(process.execPath, [path.join(__dirname, '../../scripts/update-readme.mjs'), '1.2.3'], { cwd: workdir });

  const readme = readFileSync(path.join(workdir, 'README.md'), 'utf8');
  assert.ok(readme.startsWith(before), 'text before the block is unchanged');
  assert.ok(readme.endsWith(`<!-- DOWNLOADS:END -->\n${after}`), 'text after the block is unchanged');
  assert.match(readme, /Goldfinch-Setup-1\.2\.3\.exe/);
});

test('the real README keeps its verify section after the generated block, once', () => {
  const readme = readFileSync(path.join(__dirname, '../../README.md'), 'utf8');
  const end = readme.indexOf('<!-- DOWNLOADS:END -->');
  assert.ok(end >= 0, 'no DOWNLOADS:END marker');
  const heading = readme.indexOf('### Verify your download');
  assert.ok(heading > end, 'the verify section sits after the generated block');
  assert.equal(readme.split('### Verify your download').length, 2);
  assert.equal(readme.split('Builds are currently **unsigned**').length, 2, 'the unsigned sentence is not repeated');
  assert.match(readme, /gh attestation verify <file> -R msieurthenardier\/goldfinch/);
  assert.match(readme, /--signer-workflow msieurthenardier\/goldfinch\/\.github\/workflows\/build\.yml/);
});
