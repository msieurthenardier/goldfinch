'use strict';

// Placement pin for the launch-switch block in main.js (flight 03 leg `launch-switches`).
// Comment-masked source scan; every landmark search throws if not found.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { maskComments } = require('../helpers/source-scan');

const MAIN_DIR = path.join(__dirname, '..', '..', 'src', 'main');
const read = (f) => maskComments(fs.readFileSync(path.join(MAIN_DIR, f), 'utf8'));
const main = read('main.js');

function at(src, re, what) {
  const m = re.exec(src);
  if (!m) throw new Error(`landmark not found: ${what}`);
  return m.index;
}

const BLOCK_RE = /if \(app\.isPackaged\) \{\s*const launchDecision = decideLaunchSwitches\(/;

function violations(src) {
  const out = [];
  const redirect = at(src, /if \(!app\.isPackaged\) \{\s*app\.setPath\('userData'/, 'dev redirect');
  const block = at(src, BLOCK_RE, 'launch-switch block');
  const lock = at(src, /app\.requestSingleInstanceLock\(/, 'single-instance lock');
  const reader = at(src, /getSwitchValue\('enable-features'\)/, 'enable-features reader');
  if (!(redirect < block)) out.push('block must come after the dev redirect');
  if (!(block < lock)) out.push('block must come before requestSingleInstanceLock(');
  if (!(block < reader)) out.push("block must come before getSwitchValue('enable-features')");
  const start = src.indexOf('{', block);
  const end = lock; // everything between the block start and the lock
  const body = src.slice(start, end);
  if (/setPath\('userData'/.test(body)) out.push("block must not contain setPath('userData'");
  if (/appendSwitch/.test(body)) out.push('block must not contain appendSwitch');
  const exits = (src.match(/app\.exit\(64\)/g) || []).length;
  if (exits !== 1) out.push(`app.exit(64) appears ${exits}x, expected exactly 1`);
  if (!/app\.exit\(64\);\s*process\.exit\(64\);/.test(body))
    out.push('refusal must be app.exit(64); process.exit(64);');
  return out;
}

test('the real main.js satisfies the placement pin', () => {
  assert.deepEqual(violations(main), []);
});

test('removeSwitch( appears only in the main.js block across src/main/**', () => {
  const hits = [];
  for (const f of fs.readdirSync(MAIN_DIR, { recursive: true })) {
    if (!String(f).endsWith('.js')) continue;
    const n = (read(String(f)).match(/removeSwitch\(/g) || []).length;
    if (n) hits.push(`${f}:${n}`);
  }
  assert.deepEqual(hits.sort(), ['launch-switches.js:1', 'main.js:1'].sort());
});

function assertMutated(before, after, what) {
  assert.notEqual(after, before, `the ${what} mutation did not apply — the .replace() target is stale`);
}

test('neuter: block moved after the lock, an appendSwitch inside it, a second exit', () => {
  // move the block after the lock
  const m = BLOCK_RE.exec(main);
  const blockStart = m.index;
  const blockEnd = main.indexOf('app.requestSingleInstanceLock(');
  const blockText = main.slice(blockStart, blockEnd);
  const moved = main.slice(0, blockStart) + main.slice(blockEnd) + blockText;
  assertMutated(main, moved, 'move');
  assert.ok(violations(moved).length > 0);

  const withAppend = main.replace(/(const refusedSwitches = )/, "app.commandLine.appendSwitch('x');\n  $1");
  assertMutated(main, withAppend, 'appendSwitch');
  assert.ok(violations(withAppend).some((v) => /appendSwitch/.test(v)));

  const twoExits = main.replace(/(app\.exit\(64\);\s*process\.exit\(64\);)/, '$1\napp.exit(64);');
  assertMutated(main, twoExits, 'second exit');
  assert.ok(violations(twoExits).some((v) => /exactly 1/.test(v)));
});

test('a missing landmark throws instead of passing vacuously', () => {
  assert.throws(() => violations(main.replace(/decideLaunchSwitches\(\{/, 'x({')), /landmark not found/);
});

test('src/main/launch-switches.js names switches but never appends one', () => {
  const src = read('launch-switches.js');
  assert.ok(src.length > 0, 'launch-switches.js is empty');
  assert.doesNotMatch(src, /appendSwitch\s*\(/);
});
