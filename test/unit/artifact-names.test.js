'use strict';

// Drift guard (Mission 23 flight 03, leg release-build-split): the installer names the
// electron-builder templates in package.json produce must equal the names
// scripts/update-readme.mjs links. The test substitutes the placeholders BY HAND, so it proves
// the two sources agree with each other - not what the builder writes (that was shown by a real
// Linux build, and for Windows and macOS only a workflow run shows it).

const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = '1.2.3-rc.1';

/** The file names scripts/update-readme.mjs links, read by running it on a scratch README. */
function readmeLinkNames(version) {
  const dir = mkdtempSync(path.join(tmpdir(), 'goldfinch-names-'));
  try {
    writeFileSync(path.join(dir, 'README.md'), '<!-- DOWNLOADS:START -->\nold\n<!-- DOWNLOADS:END -->\n');
    // update-readme.mjs accepts only X.Y.Z, so run it on the core and swap the prerelease in.
    const core = version.split('-')[0];
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'update-readme.mjs'), core], { cwd: dir });
    const text = readFileSync(path.join(dir, 'README.md'), 'utf8');
    const names = [...text.matchAll(/\/releases\/download\/v[^/\s)]+\/([^\s)]+)\)/g)].map((m) => m[1]);
    assert.equal(names.length, 5, 'expected five download links in the generated README block');
    return names.map((n) => n.split(core).join(version)).sort();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Substitute electron-builder's macros by hand. */
function expand(template, { ext, arch }) {
  assert.equal(typeof template, 'string', 'artifactName template is missing');
  if (arch === null) assert.ok(!template.includes('${arch}'), `${template} must not carry \${arch}`);
  return template
    .replace(/\$\{productName\}/g, pkg.build.productName)
    .replace(/\$\{name\}/g, pkg.name)
    .replace(/\$\{version\}/g, VERSION)
    .replace(/\$\{ext\}/g, ext)
    .replace(/\$\{arch\}/g, arch ?? '');
}

test('the per-target artifactName templates give the names the README links', () => {
  const b = pkg.build;
  const fromTemplates = [
    expand(b.nsis && b.nsis.artifactName, { ext: 'exe', arch: null }),
    expand(b.dmg && b.dmg.artifactName, { ext: 'dmg', arch: 'arm64' }),
    expand(b.mac && b.mac.artifactName, { ext: 'zip', arch: 'arm64' }),
    expand(b.appImage && b.appImage.artifactName, { ext: 'AppImage', arch: null }),
    expand(b.deb && b.deb.artifactName, { ext: 'deb', arch: 'amd64' }) // the builder's deb name for x64
  ].sort();
  assert.deepEqual(fromTemplates, readmeLinkNames(VERSION));
});

test('artifactName is set per target only, never at the top level or under linux', () => {
  assert.equal(pkg.build.artifactName, undefined, 'a top-level artifactName would apply to every target');
  assert.equal(pkg.build.linux.artifactName, undefined, 'a linux artifactName would apply to both Linux targets');
  assert.equal(pkg.build.win.artifactName, undefined);
});

test('the README download links show the file name they point at (the .zip/.deb extras show their extension)', () => {
  const readme = readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const block = readme.match(/<!-- DOWNLOADS:START[\s\S]*?<!-- DOWNLOADS:END -->/);
  assert.ok(block, 'README is missing the downloads block');
  const links = [
    ...block[0].matchAll(/\[([^\]]+)\]\(https:\/\/github\.com\/[^)\s]*\/releases\/download\/v[^/\s)]+\/([^\s)]+)\)/g)
  ];
  assert.equal(links.length, 5, 'expected five download links');
  for (const [, text, file] of links) {
    if (text.startsWith('.')) assert.ok(file.endsWith(text), `short label ${text} must be the extension of ${file}`);
    else assert.equal(text, file, `link text "${text}" must equal the file name "${file}"`);
  }
});
