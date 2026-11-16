'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createSecretClipboard, CLIPBOARD_SECRET_CLEAR_MS } = require('../../src/main/secret-clipboard');
const { SHEET_MENU_TYPES } = require('../../src/main/ipc-channel-table');

const drain = () => new Promise((r) => setImmediate(r));

// Electron 45's clipboard is promise-based: the fake is too.
function fakeClipboard({ failRead = false, failClear = false, slowClear = false } = {}) {
  let value = '';
  const log = [];
  return {
    log,
    get value() {
      return value;
    },
    set value(v) {
      value = v;
    },
    writeText: async (t) => {
      value = t;
      log.push(['write', t]);
    },
    readText: async () => {
      log.push(['read']);
      if (failRead) throw new Error('no clipboard');
      return value;
    },
    clear: async () => {
      if (slowClear) await new Promise((r) => setTimeout(r, 20));
      if (failClear) throw new Error('clear failed');
      value = '';
      log.push(['clear']);
    }
  };
}
const quiet = { error() {} };

test('a secret write is cleared after 20 s if the clipboard still holds it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const cb = fakeClipboard();
  const sc = createSecretClipboard({ clipboard: cb, logger: quiet });
  sc.write('s3cret', { secret: true });
  assert.equal(CLIPBOARD_SECRET_CLEAR_MS, 20000);
  t.mock.timers.tick(19999);
  await drain();
  assert.equal(cb.value, 's3cret');
  t.mock.timers.tick(1);
  await drain();
  assert.equal(cb.value, '');
});

test('a changed clipboard is left alone', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const cb = fakeClipboard();
  const sc = createSecretClipboard({ clipboard: cb, logger: quiet });
  sc.write('s3cret', { secret: true });
  cb.value = 'other';
  t.mock.timers.tick(20000);
  await drain();
  assert.equal(cb.value, 'other');
  assert.ok(!cb.log.some((e) => e[0] === 'clear'));
});

test('a later plain write cancels the pending clear; a later secret replaces it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const cb = fakeClipboard();
  const sc = createSecretClipboard({ clipboard: cb, logger: quiet });
  sc.write('a', { secret: true });
  sc.write('plain');
  t.mock.timers.tick(60000);
  await drain();
  assert.equal(cb.value, 'plain');

  sc.write('one', { secret: true });
  t.mock.timers.tick(10000);
  sc.write('two', { secret: true });
  t.mock.timers.tick(10000);
  await drain();
  assert.equal(cb.value, 'two', 'the first timer must not fire');
  t.mock.timers.tick(10000);
  await drain();
  assert.equal(cb.value, '');
  assert.equal(cb.log.filter((e) => e[0] === 'clear').length, 1);
});

test('flush clears a pending secret now, once; the timer is gone', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const cb = fakeClipboard();
  const sc = createSecretClipboard({ clipboard: cb, logger: quiet });
  sc.write('s', { secret: true });
  assert.equal(await sc.flush(), true);
  assert.equal(cb.value, '');
  cb.value = 'next';
  assert.equal(await sc.flush(), false);
  t.mock.timers.tick(60000);
  await drain();
  assert.equal(cb.value, 'next');
});

test('flush with nothing pending touches the clipboard not at all', async () => {
  const cb = fakeClipboard();
  const sc = createSecretClipboard({ clipboard: cb, logger: quiet });
  await sc.flush();
  sc.write('plain');
  await sc.flush();
  assert.deepEqual(cb.log, [['write', 'plain']]);
});

test('flush skips (no clear) when the clipboard holds something else', async () => {
  const cb = fakeClipboard();
  const sc = createSecretClipboard({ clipboard: cb, logger: quiet });
  sc.write('s', { secret: true });
  cb.value = 'mine';
  assert.equal(await sc.flush(), false);
  assert.equal(cb.value, 'mine');
});

test('an unreadable clipboard SKIPS rather than clearing blind, and logs', async () => {
  const cb = fakeClipboard({ failRead: true });
  const errors = [];
  const sc = createSecretClipboard({ clipboard: cb, logger: { error: (...a) => errors.push(a) } });
  sc.write('s', { secret: true });
  assert.equal(await sc.flush(), false);
  assert.ok(!cb.log.some((e) => e[0] === 'clear'));
  assert.equal(errors.length, 1);
});

test('the clear is awaited: flush resolves true only after it completed; a rejected clear is caught and logged', async () => {
  const slow = fakeClipboard({ slowClear: true });
  const sc = createSecretClipboard({ clipboard: slow, logger: quiet });
  sc.write('s', { secret: true });
  assert.equal(await sc.flush(), true);
  assert.equal(slow.value, '', 'cleared by the time flush resolved');

  const bad = fakeClipboard({ failClear: true });
  const errors = [];
  const sc2 = createSecretClipboard({ clipboard: bad, logger: { error: (...a) => errors.push(a) } });
  sc2.write('s', { secret: true });
  assert.equal(await sc2.flush(), false);
  assert.equal(errors.length, 1);
});

test('a write that lands while the clear read is in flight is not cleared', async () => {
  const cb = fakeClipboard();
  const sc = createSecretClipboard({ clipboard: cb, logger: quiet });
  sc.write('s', { secret: true });
  const p = sc.flush();
  sc.write('s'); // same text, newer write: it owns the clipboard now
  assert.equal(await p, false);
  assert.equal(cb.value, 's');
});

test('works with a synchronous clipboard (older Electron / fakes)', async () => {
  let v = '';
  const sc = createSecretClipboard({
    clipboard: { writeText: (t) => (v = t), readText: () => v, clear: () => (v = '') },
    logger: quiet
  });
  sc.write('x', { secret: true });
  assert.equal(await sc.flush(), true);
  assert.equal(v, '');
});

// --- pins ---

test('the sheet Copy row admits exactly the three key-display cards (all secret writes)', () => {
  assert.deepEqual([...SHEET_MENU_TYPES['menu-overlay:copy-text']].sort(), [
    'vault-accesskey-show',
    'vault-adminkey-show',
    'vault-recovery-show'
  ]);
});

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (p.endsWith('.js')) out.push(p);
  }
  return out;
}
const MAIN = path.join(__dirname, '../../src/main');
const SINK = /\bclipboard\s*\.\s*(writeText|write|clear)\s*\(/g;

function scan(text) {
  return (text.match(SINK) || []).length;
}

test('no clipboard.writeText/write/clear in src/main outside secret-clipboard.js', () => {
  const offenders = [];
  for (const f of walk(MAIN)) {
    if (path.basename(f) === 'secret-clipboard.js') continue;
    const n = scan(fs.readFileSync(f, 'utf8'));
    if (n) offenders.push(`${path.relative(MAIN, f)} x${n}`);
  }
  assert.deepEqual(offenders, []);
});

test('the scan is neuter-verified: it catches a raw sink', () => {
  assert.equal(scan('clipboard.writeText(x)'), 1);
  assert.equal(scan('  clipboard . clear ( )'), 1);
  assert.equal(scan('secretClipboard.write(x)'), 0);
});

test('the three sinks and before-quit go through the helper', () => {
  const settings = fs.readFileSync(path.join(MAIN, 'register-settings-ipc.js'), 'utf8');
  assert.match(settings, /'clipboard:write'[\s\S]{0,200}secretClipboard\.write\(text, \{ secret:/);
  assert.match(settings, /'chrome-clipboard-write',\s*\(_event, text\) => \{\s*secretClipboard\.write\(text\);/);
  const main = fs.readFileSync(path.join(MAIN, 'main.js'), 'utf8');
  assert.match(main, /writeClipboard: \(text\) => secretClipboard\.write\(String\(text\), \{ secret: true \}\)/);
});

test('before-quit calls flushSecretClipboard FIRST, in its own try, logged on failure', () => {
  const src = fs.readFileSync(path.join(MAIN, 'app-lifecycle.js'), 'utf8');
  const m = /app\.on\('before-quit', \(\) => \{([\s\S]*?)\n {2}\}\);/.exec(src);
  assert.ok(m, 'before-quit handler found');
  const body = m[1];
  const flushAt = body.indexOf('flushSecretClipboard');
  assert.ok(flushAt >= 0);
  assert.ok(flushAt < body.indexOf('setSessionQuitting(true)'), 'flush precedes every other step');
  assert.ok(flushAt < body.indexOf('flushSessionSnapshotScheduler'));
  const tryAt = body.lastIndexOf('try {', flushAt);
  assert.ok(
    tryAt >= 0 &&
      body
        .slice(0, tryAt)
        .trim()
        .replace(/\/\/.*\n?/g, '')
        .trim() === '',
    'flush try is the first statement'
  );
  assert.match(body.slice(flushAt, body.indexOf('setSessionQuitting(true)')), /logger\.error\('\[secret-clipboard\]/);
});
