'use strict';

// Squawk 0119: the pure embedder-token stripper behind every web session's UA.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { stripEmbedderTokens } = require('../../src/main/user-agent');

const CASES = [
  {
    name: 'Windows (real Electron 44 default UA)',
    input:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) goldfinch/0.18.2 Chrome/152.0.7977.130 Electron/44.4.4 Safari/537.36',
    expected:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36'
  },
  {
    name: 'Linux',
    input:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) goldfinch/0.18.2 Chrome/152.0.7977.130 Electron/44.4.4 Safari/537.36',
    expected:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36'
  },
  {
    name: 'macOS',
    input:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) goldfinch/1.2.3-beta.1 Chrome/152.0.7977.130 Electron/44.4.4 Safari/537.36',
    expected:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36'
  },
  {
    name: 'app-name match is case-insensitive',
    input:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Goldfinch/9.9.9 Chrome/1.0 Electron/2.0 Safari/537.36',
    expected: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/1.0 Safari/537.36'
  },
  {
    name: 'embedder token at the very end leaves no trailing space',
    input: 'Mozilla/5.0 Chrome/1.0 Safari/537.36 Electron/44.4.4',
    expected: 'Mozilla/5.0 Chrome/1.0 Safari/537.36'
  }
];

for (const { name, input, expected } of CASES) {
  test(`stripEmbedderTokens: ${name}`, () => {
    const out = stripEmbedderTokens(input);
    assert.equal(out, expected);
    assert.ok(!/ {2}/.test(String(out)), 'never produces a double space');
    assert.equal(stripEmbedderTokens(out), out, 'idempotent');
  });
}

test('stripEmbedderTokens: an already Chrome-shaped UA is unchanged', () => {
  const clean =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36';
  assert.equal(stripEmbedderTokens(clean), clean);
});

test('stripEmbedderTokens: lookalike tokens are not stripped', () => {
  const ua = 'Mozilla/5.0 goldfinchy/1.0 NotElectron/2.0 Electron Chrome/1.0 Safari/537.36';
  assert.equal(stripEmbedderTokens(ua), ua);
});

test('stripEmbedderTokens: non-string and empty input is returned unchanged', () => {
  for (const value of [undefined, null, 42, {}, '']) {
    assert.equal(stripEmbedderTokens(value), value);
  }
});
