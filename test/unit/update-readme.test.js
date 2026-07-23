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

  execFileSync(
    process.execPath,
    [path.join(__dirname, '../../scripts/update-readme.mjs'), '1.2.3'],
    { cwd: workdir }
  );

  const readme = readFileSync(path.join(workdir, 'README.md'), 'utf8');
  assert.match(readme, /Goldfinch-Setup-1\.2\.3\.exe/);
  assert.doesNotMatch(readme, /Goldfinch\.Setup\.1\.2\.3\.exe/);
});
