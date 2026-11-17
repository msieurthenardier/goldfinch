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
