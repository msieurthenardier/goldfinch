'use strict';

// Squawk 0169: stripAppToken removes ONLY `<name>/<ver>` (+ one space).

const test = require('node:test');
const assert = require('node:assert/strict');
const { stripAppToken } = require('../../src/main/user-agent');

const linux =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) goldfinch/0.19.9 Chrome/152.0.7977.169 Electron/44.10.0 Safari/537.36';
const win =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) goldfinch/0.19.9 Chrome/152.0.7977.169 Electron/44.10.0 Safari/537.36';
const mac =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) goldfinch/0.19.9 Chrome/152.0.7977.169 Electron/44.10.0 Safari/537.36';

test('Linux: removes only the app token; matches the squawk target', () => {
  assert.equal(
    stripAppToken(linux, 'goldfinch', '0.19.9'),
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.169 Electron/44.10.0 Safari/537.36'
  );
});

test('Windows and macOS shapes', () => {
  for (const ua of [win, mac]) {
    const out = stripAppToken(ua, 'goldfinch', '0.19.9');
    assert.equal(out, ua.replace('goldfinch/0.19.9 ', ''));
    assert.ok(out.includes('Electron/44.10.0') && out.includes('Chrome/152.0.7977.169'));
  }
});

test('no-op when the token is absent or version differs', () => {
  assert.equal(stripAppToken(linux, 'other', '0.19.9'), linux);
  assert.equal(stripAppToken(linux, 'goldfinch', '0.1.0'), linux);
  const clean = stripAppToken(linux, 'goldfinch', '0.19.9');
  assert.equal(stripAppToken(clean, 'goldfinch', '0.19.9'), clean);
});

test('idempotent', () => {
  const once = stripAppToken(linux, 'goldfinch', '0.19.9');
  assert.equal(stripAppToken(once, 'goldfinch', '0.19.9'), once);
});

test('regex metacharacters in name/version are escaped', () => {
  const ua = 'A (x) gold.finch+/1.2.3-beta+1 Chrome/1 Electron/2 Safari/3';
  assert.equal(stripAppToken(ua, 'gold.finch+', '1.2.3-beta+1'), 'A (x) Chrome/1 Electron/2 Safari/3');
  // '.' must not act as a wildcard
  assert.equal(stripAppToken('A goldXfinch/1 Chrome/1', 'gold.finch', '1'), 'A goldXfinch/1 Chrome/1');
  // an ".*" name must not swallow the string
  assert.equal(stripAppToken(linux, '.*', '.*'), linux);
});

test('never removes Electron/ or Chrome/ even for those app names', () => {
  assert.equal(stripAppToken(linux, 'Electron', '44.10.0'), linux);
  assert.equal(stripAppToken(linux, 'Chrome', '152.0.7977.169'), linux);
});

test('does not match a token embedded in a longer token', () => {
  const ua = 'A xgoldfinch/1 Chrome/1';
  assert.equal(stripAppToken(ua, 'goldfinch', '1'), ua);
  const ua2 = 'A goldfinch/10 Chrome/1';
  assert.equal(stripAppToken(ua2, 'goldfinch', '1'), ua2);
});

test('leading and trailing token positions; bad input passes through', () => {
  assert.equal(stripAppToken('goldfinch/1 Chrome/1', 'goldfinch', '1'), 'Chrome/1');
  assert.equal(stripAppToken('Chrome/1 goldfinch/1', 'goldfinch', '1'), 'Chrome/1');
  assert.equal(stripAppToken(undefined, 'goldfinch', '1'), undefined);
  assert.equal(stripAppToken('', 'goldfinch', '1'), '');
  assert.equal(stripAppToken(linux, undefined, '1'), linux);
  assert.equal(stripAppToken(linux, 'goldfinch', ''), linux);
});
