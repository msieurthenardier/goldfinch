'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  parseStableTag,
  compareVersions,
  isNewer,
  releaseUrlFor,
  readLatestTag,
  isWellFormedVersion,
  installerNameFor,
  installerUrlFor,
  LATEST_RELEASE_API_URL,
  REPO_SLUG,
  MAX_BODY_BYTES
} = require('../../src/shared/update-version.js');

test('parseStableTag accepts exactly v + MAJOR.MINOR.PATCH', () => {
  assert.equal(parseStableTag('v0.19.16'), '0.19.16');
  assert.equal(parseStableTag('v1.0.0'), '1.0.0');
  assert.equal(parseStableTag('v10.20.30'), '10.20.30');
});

test('parseStableTag refuses everything else', () => {
  const bad = [
    '0.19.16',
    'V0.19.16',
    'v0.19.16-rc.1',
    'v0.19.16+build',
    'v01.2.3',
    'v1.02.3',
    'v1.2.03',
    'v1.2',
    'v1.2.3.4',
    ' v1.2.3',
    'v1.2.3 ',
    'v1.2.3\n',
    '',
    'v',
    'v-1.2.3',
    'v1.2.x',
    'v' + '1'.repeat(70) + '.0.0',
    'v9007199254740992.0.0',
    'v0.9007199254740993.0'
  ];
  for (const t of bad) assert.equal(parseStableTag(t), null, JSON.stringify(t));
  for (const t of [null, undefined, 1, {}, [], ['v1.2.3'], true]) assert.equal(parseStableTag(t), null);
  assert.equal(parseStableTag('v9007199254740991.0.0'), '9007199254740991.0.0');
});

test('isNewer table', () => {
  const rows = [
    ['0.19.16', '0.19.15', true],
    ['0.19.15', '0.19.15', false],
    ['0.19.14', '0.19.15', false],
    ['0.19.15', '0.19.15-rc.1', true],
    ['0.19.15', '0.19.16-rc.1', false],
    ['0.20.0', '0.19.99', true],
    ['1.0.0', '0.99.99', true],
    ['0.19.10', '0.19.9', true],
    ['0.19.9', '0.19.10', false],
    ['0.19.16', 'not-a-version', false],
    ['0.19.16', '', false],
    ['0.19.16', undefined, false],
    ['v0.19.16', '0.19.15', false],
    ['0.19.16-rc.1', '0.19.15', false]
  ];
  for (const [a, c, want] of rows) assert.equal(isNewer(a, c), want, `${a} over ${c}`);
});

test('compareVersions: prerelease precedence follows the semver rule', () => {
  const ordered = [
    '1.0.0-alpha',
    '1.0.0-alpha.1',
    '1.0.0-alpha.beta',
    '1.0.0-beta',
    '1.0.0-beta.2',
    '1.0.0-beta.11',
    '1.0.0-rc.1',
    '1.0.0'
  ];
  for (let i = 0; i < ordered.length - 1; i++) {
    assert.equal(compareVersions(ordered[i], ordered[i + 1]), -1, `${ordered[i]} < ${ordered[i + 1]}`);
    assert.equal(compareVersions(ordered[i + 1], ordered[i]), 1);
  }
  assert.equal(compareVersions('1.0.0-rc.1', '1.0.0-rc.1'), 0);
  assert.equal(compareVersions('0.19.15-rc.2', '0.19.15-rc.10'), -1, 'numeric identifiers compare numerically');
  assert.equal(compareVersions('1.0.0-1', '1.0.0-a'), -1, 'numeric below alphanumeric');
  assert.equal(compareVersions('x', '1.0.0'), null);
});

test('releaseUrlFor builds the address from a validated version only', () => {
  assert.equal(releaseUrlFor('0.19.16'), 'https://github.com/' + REPO_SLUG + '/releases/tag/v0.19.16');
  for (const v of [
    'v0.19.16',
    '0.19.16-rc.1',
    '0.19',
    '',
    null,
    undefined,
    5,
    '0.19.16/../../x',
    '0.19.16?a=b',
    '01.2.3'
  ])
    assert.equal(releaseUrlFor(v), null, String(v));
});

test('readLatestTag believes only tag_name, and only a stable tag', () => {
  assert.deepEqual(
    readLatestTag(JSON.stringify({ tag_name: 'v0.19.16', html_url: 'https://evil.example/', body: 'x' })),
    {
      version: '0.19.16'
    }
  );
  const reason = (b) => readLatestTag(b).reason;
  assert.equal(reason('not json'), 'bad-json');
  assert.equal(reason('[]'), 'bad-json');
  assert.equal(reason('null'), 'bad-json');
  assert.equal(reason('"v1.0.0"'), 'bad-json');
  assert.equal(reason(undefined), 'bad-json');
  assert.equal(reason('{}'), 'bad-tag');
  assert.equal(reason(JSON.stringify({ tag_name: 5 })), 'bad-tag');
  assert.equal(reason(JSON.stringify({ tag_name: 'v0.19.16-rc.1' })), 'bad-tag');
  assert.equal(reason(JSON.stringify({ tag_name: ['v0.19.16'] })), 'bad-tag');
  assert.equal(reason(JSON.stringify({ tag_name: 'v1.0.0', pad: 'x'.repeat(MAX_BODY_BYTES) })), 'too-large');
});

test('drift guard: the slug is package.json build.publish owner/repo and the API address names it', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));
  const { owner, repo } = pkg.build.publish;
  assert.equal(REPO_SLUG, owner + '/' + repo);
  assert.equal(LATEST_RELEASE_API_URL, 'https://api.github.com/repos/' + REPO_SLUG + '/releases/latest');
});

test('drift guard: every tag the app accepts also satisfies the release workflow semver expression', () => {
  const wf = fs.readFileSync(path.join(__dirname, '../../.github/workflows/build.yml'), 'utf8');
  const line = wf.split('\n').find((l) => /semver='/.test(l));
  assert.ok(line, 'the semver= line was not found in build.yml (the guard would pass vacuously)');
  const expr = /semver='([^']+)'/.exec(line)[1];
  const workflowRule = new RegExp(expr.replace(/\\\./g, '\\.').replace(/\\\+/g, '\\+'));
  const table = ['v0.19.16', 'v1.0.0', 'v10.20.30', 'v0.0.1', 'v9007199254740991.0.0'];
  for (const tag of table) {
    assert.ok(parseStableTag(tag), tag);
    assert.ok(workflowRule.test(tag.slice(1)), `workflow rule accepts ${tag.slice(1)}`);
  }
  // and the workflow's rule refuses what ours refuses at the core level (leading zeros)
  assert.equal(workflowRule.test('01.2.3'), false);
  assert.equal(parseStableTag('v01.2.3'), null);
});

test('isWellFormedVersion: stable, prerelease and build forms only, capped at 64', () => {
  for (const v of ['0.19.15', '0.19.15-rc.2', '1.0.0-beta.1+build.5', '1.0.0+b']) {
    assert.equal(isWellFormedVersion(v), true, v);
  }
  const bad = [
    '',
    'v1.0.0',
    '01.2.3',
    '1.0',
    '1.0.0-',
    '1.0.0+',
    '1.0.0-01',
    '1.0.0 x',
    '<b>x',
    '1.0.0-' + 'a'.repeat(64),
    null,
    7,
    {}
  ];
  for (const v of bad) assert.equal(isWellFormedVersion(v), false, String(v));
});

const V = '0.19.16';
test('installerNameFor: one row per platform, null for the rest and for a non-stable version', () => {
  const f = (platform, arch, appImage = false, version = V) => installerNameFor({ platform, arch, appImage, version });
  assert.equal(f('win32', 'x64'), `Goldfinch-Setup-${V}.exe`);
  assert.equal(f('win32', 'arm64'), `Goldfinch-Setup-${V}.exe`);
  assert.equal(f('darwin', 'arm64'), `Goldfinch-${V}-arm64.dmg`);
  assert.equal(f('darwin', 'x64'), null);
  assert.equal(f('linux', 'x64', true), `Goldfinch-${V}.AppImage`);
  assert.equal(f('linux', 'x64', false), `goldfinch_${V}_amd64.deb`);
  assert.equal(f('linux', 'arm64'), null);
  assert.equal(f('freebsd', 'x64'), null);
  for (const bad of ['0.19.16-rc.1', '01.2.3', '1.0', '', null, 7, '0.19.16/../x']) {
    assert.equal(f('win32', 'x64', false, bad), null, String(bad));
  }
  assert.equal(installerNameFor(), null);
  assert.equal(installerNameFor({}), null);
});

test('installerUrlFor: the release-download address from the slug, version and a known name only', () => {
  assert.equal(
    installerUrlFor(`goldfinch_${V}_amd64.deb`, V),
    `https://github.com/${REPO_SLUG}/releases/download/v${V}/goldfinch_${V}_amd64.deb`
  );
  assert.equal(installerUrlFor(null, V), null);
  assert.equal(installerUrlFor(`goldfinch_${V}_amd64.deb`, '0.19.16-rc.1'), null);
  assert.equal(installerUrlFor('evil.exe', V), null);
  assert.equal(installerUrlFor(`../goldfinch_${V}_amd64.deb`, V), null);
  assert.equal(installerUrlFor(`goldfinch_0.19.17_amd64.deb`, V), null, 'the name must be for that version');
});

test('installerUrlFor is not influenced by the dev override variable', () => {
  const saved = process.env.GOLDFINCH_UPDATE_CHECK_URL;
  process.env.GOLDFINCH_UPDATE_CHECK_URL = 'http://127.0.0.1:9/override';
  try {
    assert.match(installerUrlFor(`goldfinch_${V}_amd64.deb`, V), /^https:\/\/github\.com\//);
  } finally {
    if (saved === undefined) delete process.env.GOLDFINCH_UPDATE_CHECK_URL;
    else process.env.GOLDFINCH_UPDATE_CHECK_URL = saved;
  }
});

test('drift guard: the names installerNameFor can return are among the five the release builds', () => {
  const { execFileSync } = require('node:child_process');
  const os = require('node:os');
  const ROOT = path.join(__dirname, '..', '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goldfinch-dl-names-'));
  try {
    fs.writeFileSync(path.join(dir, 'README.md'), '<!-- DOWNLOADS:START -->\nold\n<!-- DOWNLOADS:END -->\n');
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'update-readme.mjs'), V], { cwd: dir });
    const text = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
    const linked = new Set([...text.matchAll(/\/releases\/download\/v[^/\s)]+\/([^\s)]+)\)/g)].map((m) => m[1]));
    assert.equal(linked.size, 5, 'five download links in the generated README block');
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    assert.ok(pkg.build && pkg.build.nsis, 'package.json build config readable');
    const returned = new Set();
    for (const [platform, arch, appImage] of [
      ['win32', 'x64', false],
      ['darwin', 'arm64', false],
      ['linux', 'x64', true],
      ['linux', 'x64', false]
    ]) {
      const n = installerNameFor({ platform, arch, appImage, version: V });
      assert.ok(linked.has(n), `${n} is not a name the README links`);
      returned.add(n);
    }
    assert.equal(returned.size, 4);
    assert.ok([...returned].some((n) => n.endsWith('.exe')));
    assert.ok([...returned].some((n) => n.endsWith('.dmg')));
    assert.ok([...returned].some((n) => n.endsWith('.AppImage') || n.endsWith('.deb')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
