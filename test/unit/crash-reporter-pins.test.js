'use strict';

// Mission 20 Flight 3 Leg 3 (DD8): crashReporter.start pins. Source-scan over
// src/main/main.js — the ONE call site — and over all of src/ for the two
// forbidden literals (no upload path can ever exist). Scanned against
// COMMENT-MASKED text (the shared source-scan toolkit) so this leg's own
// prose ABOUT the pin — which necessarily quotes the literals it pins — can
// never trip itself.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { maskComments, collectSources } = require('../helpers/source-scan');

const repoRoot = path.join(__dirname, '..', '..');
const mainSrcRaw = fs.readFileSync(path.join(repoRoot, 'src', 'main', 'main.js'), 'utf8');
const mainSrc = maskComments(mainSrcRaw);

const allSrcMasked = collectSources(path.join(repoRoot, 'src'))
  .map((f) => maskComments(fs.readFileSync(f, 'utf8')))
  .join('\n');

test('exactly one crashReporter.start( call exists in src/main/main.js', () => {
  const matches = mainSrc.match(/crashReporter\.start\(/g) || [];
  assert.equal(matches.length, 1, `expected exactly one crashReporter.start( call, found ${matches.length}`);
});

test("crashReporter.start(...)'s options literal contains uploadToServer: false", () => {
  const idx = mainSrc.indexOf('crashReporter.start(');
  assert.ok(idx >= 0);
  const openParen = mainSrc.indexOf('(', idx);
  let depth = 0;
  let end = -1;
  for (let i = openParen; i < mainSrc.length; i++) {
    if (mainSrc[i] === '(') depth++;
    else if (mainSrc[i] === ')') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  assert.ok(end > openParen, 'must find the closing paren of the call');
  const argsLiteral = mainSrc.slice(openParen, end + 1);
  assert.match(argsLiteral, /uploadToServer:\s*false/);
});

test('neither submitURL nor addExtraParameter appears anywhere in src/', () => {
  assert.equal(/submitURL/.test(allSrcMasked), false, 'submitURL must never appear in src/ (no upload endpoint, ever)');
  assert.equal(
    /addExtraParameter/.test(allSrcMasked),
    false,
    'addExtraParameter must never appear in src/ (no extra data ever attached to a crash report)'
  );
});

test('the only crashReporter. call anywhere in src/ is the one start( call', () => {
  const calls = allSrcMasked.match(/crashReporter\.\w+\(/g) || [];
  assert.deepEqual(calls, ['crashReporter.start(']);
});

test('crashReporter.start( sits textually AFTER the dev-profile setPath("userData" redirect', () => {
  const setPathIdx = mainSrc.indexOf("setPath('userData'");
  const startIdx = mainSrc.indexOf('crashReporter.start(');
  assert.ok(setPathIdx >= 0, 'the dev-profile redirect must exist');
  assert.ok(startIdx >= 0, 'crashReporter.start( must exist');
  assert.ok(startIdx > setPathIdx, 'crashReporter.start( must sit AFTER the setPath("userData" redirect');
});
