'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractLaunchUrls, filterLaunchUrls } = require('../../src/shared/launch-urls');

const U = 'https://example.com/a?b=1&c=2';

test('dev argv: electron, app path, flag, URL', () => {
  assert.deepEqual(extractLaunchUrls(['/x/electron', '.', '--automation-dev', U]), [U]);
});

test('packaged argv: exe then URL', () => {
  assert.deepEqual(extractLaunchUrls(['C:\\Goldfinch.exe', U]), [U]);
});

test('argv[0] is ignored even if it is a URL', () => {
  assert.deepEqual(extractLaunchUrls([U]), []);
});

test('Chromium-injected switches are dropped', () => {
  assert.deepEqual(
    extractLaunchUrls(['exe', '--original-process-start-time=13300000000000', '--allow-file-access-from-files', U]),
    [U]
  );
});

test('mixed-case scheme is admitted in normalized form', () => {
  assert.deepEqual(extractLaunchUrls(['exe', 'HTTPS://Example.COM/Path']), ['https://example.com/Path']);
});

test('hostile / non-web tokens are dropped', () => {
  const bad = [
    'about:blank',
    'file:///etc/passwd',
    'goldfinch://settings',
    'javascript:alert(1)',
    'data:text/html,hi',
    'chrome://gpu',
    '.',
    './rel/path',
    'rel/path',
    '',
    '-https://example.com',
    '--https://example.com'
  ];
  assert.deepEqual(extractLaunchUrls(['exe', ...bad]), []);
  assert.deepEqual(extractLaunchUrls(['exe', 5, null, undefined, {}, []]), []);
});

test('duplicates collapse on the normalized form, first-occurrence order', () => {
  const out = extractLaunchUrls(['exe', 'https://b.test/', 'HTTPS://A.test/', 'https://b.test/', 'https://a.test/']);
  assert.deepEqual(out, ['https://b.test/', 'https://a.test/']);
});

test('25 URLs are capped at 20', () => {
  const many = Array.from({ length: 25 }, (_, i) => `https://h${i}.test/`);
  const out = extractLaunchUrls(['exe', ...many]);
  assert.equal(out.length, 20);
  assert.equal(out[19], 'https://h19.test/');
});

test('non-array input yields []', () => {
  for (const v of [undefined, null, 'https://x.test', 5, {}]) {
    assert.deepEqual(extractLaunchUrls(v), []);
    assert.deepEqual(filterLaunchUrls(v), []);
  }
});

test('filterLaunchUrls keeps every entry (no argv[0] skip)', () => {
  assert.deepEqual(filterLaunchUrls([U]), [U]);
});
