'use strict';

// Sortie 02 leg 01 AC5: the native-isolation feature switch must be set BEFORE app.ready,
// once, from main.js's module top level, after the dev userData redirect and the
// single-instance lock, before crashReporter.start( and registerAppLifecycle(. A second
// appendSwitch('enable-features' anywhere in src/main/** would REPLACE the first value.
//
// Source-scan over comment-masked sources; every neuter mutation is guarded by assertMutated.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { maskComments } = require('../helpers/source-scan');

const MAIN_DIR = path.join(__dirname, '..', '..', 'src', 'main');
const MAIN_JS = path.join(MAIN_DIR, 'main.js');
const masked = maskComments(fs.readFileSync(MAIN_JS, 'utf8'));

function assertMutated(before, after, what) {
  assert.notEqual(after, before, `the ${what} mutation did not apply — the .replace() target is stale`);
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : e.name.endsWith('.js') ? [p] : [];
  });
}

const SWITCH_RE = /app\.commandLine\.appendSwitch\(\s*'enable-features'/g;
const ANY_SWITCH_RE = /appendSwitch\(\s*['"]enable-features['"]/g;
const REDIRECT_RE = /if \(!app\.isPackaged\) \{\s*app\.setPath\('userData'/;
// The whole startup block: from the reader call through the appendSwitch `if`.
const BLOCK_RE =
  /(const startupShields = readStartupShieldsConfig\(\{[\s\S]*?\}\);[\s\S]*?if \([^)]*\) \{\s*app\.commandLine\.appendSwitch\('enable-features'[\s\S]*?\}\s*\n)/;

/** Depth of `{` nesting at `idx` (masked source; strings contain no braces in this region). */
function braceDepthAt(src, idx) {
  let depth = 0;
  for (let i = 0; i < idx; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
  }
  return depth;
}

/** @returns {string[]} violations of main.js's startup-block shape (empty = pinned shape holds) */
function violations(src) {
  const out = [];
  const sw = [...src.matchAll(SWITCH_RE)];
  if (sw.length !== 1) out.push(`appendSwitch('enable-features' appears ${sw.length}x in main.js, expected 1`);
  const at = sw.length ? sw[0].index : -1;
  const redirect = src.search(REDIRECT_RE);
  const lock = src.indexOf('app.requestSingleInstanceLock(');
  const crash = src.indexOf('crashReporter.start(');
  const lifecycle = src.indexOf('registerAppLifecycle(');
  const reader = src.indexOf('readStartupShieldsConfig({');
  if ([at, redirect, lock, crash, lifecycle, reader].some((i) => i === -1)) out.push('a sanity marker is missing');
  else {
    if (!(redirect < lock && lock < reader && reader < at && at < crash && crash < lifecycle)) {
      out.push(
        'order must be: dev redirect < lock < startup reader < appendSwitch < crashReporter.start( < registerAppLifecycle('
      );
    }
    if (braceDepthAt(src, at) !== 1) out.push('appendSwitch must be inside only its own `if` (module top level)');
    if (braceDepthAt(src, reader) !== 0) out.push('the startup reader must sit at module top level');
    // Not inside whenReady / any function: nothing between the lock and the block may open an
    // unclosed `{` (depth 0 at the reader proves it).
  }
  if (!/isolateEffective/.test(src)) out.push('isolateEffective must be held in a module const');
  return out;
}

test("exactly one appendSwitch('enable-features' across every src/main/** file", () => {
  const hits = [];
  for (const file of walk(MAIN_DIR)) {
    const n = (maskComments(fs.readFileSync(file, 'utf8')).match(ANY_SWITCH_RE) || []).length;
    if (n) hits.push([path.relative(MAIN_DIR, file), n]);
  }
  assert.deepEqual(hits, [['main.js', 1]]);
});

test('the real main.js satisfies the startup-block order pin', () => {
  assert.deepEqual(violations(masked), []);
  assert.match(masked, BLOCK_RE, 'sanity: the startup block shape is found');
});

test('neuter: moving the startup block before the single-instance lock turns the pin red', () => {
  const m = masked.match(BLOCK_RE);
  assert.ok(m, 'block must be found');
  const removed = masked.replace(BLOCK_RE, '');
  assertMutated(masked, removed, 'block removal');
  const moved = removed.replace(/(const gotSingleInstanceLock = )/, (hit) => `${m[1]}\n${hit}`);
  assertMutated(removed, moved, 'block re-insert above the lock');
  assert.notDeepEqual(violations(moved), []);
});

test('neuter: moving the block after crashReporter.start( turns the pin red', () => {
  const m = masked.match(BLOCK_RE);
  const removed = masked.replace(BLOCK_RE, '');
  const moved = removed.replace(/(crashReporter\.start\(\{[\s\S]*?\}\);)/, (hit) => `${hit}\n${m[1]}`);
  assertMutated(removed, moved, 'block re-insert after crashReporter');
  assert.notDeepEqual(violations(moved), []);
});

test('neuter: wrapping the block in a function / whenReady turns the pin red', () => {
  const wrapped = masked.replace(BLOCK_RE, (hit) => `app.whenReady().then(() => {\n${hit}});\n`);
  assertMutated(masked, wrapped, 'whenReady wrap');
  assert.notDeepEqual(violations(wrapped), []);
});

test('neuter: a duplicate appendSwitch call turns the pin red', () => {
  const doubled = masked.replace(
    /(app\.commandLine\.appendSwitch\('enable-features'[^;]*;)/,
    "$1 app.commandLine.appendSwitch('enable-features', 'x');"
  );
  assertMutated(masked, doubled, 'duplicate switch');
  assert.notDeepEqual(violations(doubled), []);
});
