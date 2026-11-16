'use strict';

// Mission 23 Flight 2 (leg `admin-reach`, AC19): the vault page's per-field Reveal, per-field Copy and the
// one-time-code widget handle a REFUSED read as a normal answer. Runs the shipped controller (real ESM,
// no static import) against fake elements and an injected bridge and timer.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const url = pathToFileURL(path.join(__dirname, '../../src/renderer/pages/vault-secret-reads-controller.js')).href;
const load = () => import(url);
const flush = () => new Promise((r) => setImmediate(r));
const REFUSED = { refused: 'not-confirmed' };

function fakeBridge(replies) {
  const calls = { reveal: 0, code: 0, clip: [] };
  return {
    calls,
    vaultReveal: async () => {
      calls.reveal++;
      return typeof replies.reveal === 'function' ? replies.reveal() : replies.reveal;
    },
    vaultTotpCode: async () => {
      calls.code++;
      return typeof replies.code === 'function' ? replies.code() : replies.code;
    },
    clipboardWrite: (text, opts) => calls.clip.push([text, opts])
  };
}

test('reveal: a refusal leaves the field hidden, announces, and never calls onSecret (today: revealed + empty)', async () => {
  const { revealField, REFUSED_TEXT } = await load();
  const bridge = fakeBridge({ reveal: REFUSED });
  const said = [];
  let secret = null;
  let refreshed = 0;
  await revealField({
    bridge,
    vaultId: 'v',
    itemId: 'i',
    name: 'password',
    onSecret: (s) => (secret = s),
    refresh: () => refreshed++,
    announce: (t) => said.push(t)
  });
  assert.equal(secret, null);
  assert.deepEqual(said, [REFUSED_TEXT]);
  assert.equal(refreshed, 0);
});

test('reveal: an unexpected reply (no item key) also stays hidden; a lock refreshes; a secret is passed on', async () => {
  const { revealField, UNEXPECTED_TEXT } = await load();
  const run = async (reply) => {
    const said = [];
    const got = { secret: undefined, refreshed: 0 };
    await revealField({
      bridge: fakeBridge({ reveal: reply }),
      vaultId: 'v',
      itemId: 'i',
      name: 'password',
      onSecret: (s) => (got.secret = s),
      refresh: () => got.refreshed++,
      announce: (t) => said.push(t)
    });
    return { ...got, said };
  };
  assert.deepEqual(await run({}), { secret: undefined, refreshed: 0, said: [UNEXPECTED_TEXT] });
  assert.deepEqual(await run({ locked: true }), { secret: undefined, refreshed: 1, said: [] });
  assert.deepEqual(await run({ item: { password: 'pw' } }), { secret: 'pw', refreshed: 0, said: [''] });
  // a deleted item (item: null) is today's revealed-empty, unchanged
  assert.deepEqual(await run({ item: null }), { secret: '', refreshed: 0, said: [''] });
  assert.deepEqual(await run({ item: { password: null } }), { secret: '', refreshed: 0, said: [''] });
});

test('copy: a refusal or an unexpected reply writes NOTHING to the clipboard (never an empty string); a secret is written marked secret', async () => {
  const { copyField, REFUSED_TEXT } = await load();
  const said = [];
  const refused = fakeBridge({ reveal: REFUSED });
  await copyField({
    bridge: refused,
    vaultId: 'v',
    itemId: 'i',
    name: 'password',
    refresh() {},
    announce: (t) => said.push(t)
  });
  assert.deepEqual(refused.calls.clip, []);
  assert.deepEqual(said, [REFUSED_TEXT]);
  const odd = fakeBridge({ reveal: { nothing: 1 } });
  await copyField({ bridge: odd, vaultId: 'v', itemId: 'i', name: 'password', refresh() {}, announce() {} });
  assert.deepEqual(odd.calls.clip, []);
  const ok = fakeBridge({ reveal: { item: { password: 'pw' } } });
  await copyField({ bridge: ok, vaultId: 'v', itemId: 'i', name: 'password', refresh() {}, announce() {} });
  assert.deepEqual(ok.calls.clip, [['pw', { secret: true }]]);
  let refreshed = 0;
  const locked = fakeBridge({ reveal: { locked: true } });
  await copyField({
    bridge: locked,
    vaultId: 'v',
    itemId: 'i',
    name: 'password',
    refresh: () => refreshed++,
    announce() {}
  });
  assert.equal(refreshed, 1);
  assert.deepEqual(locked.calls.clip, []);
});

function fakeTimers() {
  const pending = [];
  return {
    setTimer: (fn, ms) => {
      const t = { fn, ms, live: true };
      pending.push(t);
      return t;
    },
    clearTimer: (t) => t && (t.live = false),
    pending: () => pending.filter((t) => t.live)
  };
}

test('code widget: deny -> focus -> no second request (the latch); blur/visibility/focus all respect it', async () => {
  const { createTotpPoller, REFUSED_TEXT } = await load();
  const bridge = fakeBridge({ code: { code: null, refused: 'not-confirmed' } });
  const codeEl = { textContent: '••••••' };
  const countEl = { textContent: '' };
  const said = [];
  const tm = fakeTimers();
  const p = createTotpPoller({
    bridge,
    vaultId: 'v',
    itemId: 'i',
    codeEl,
    countEl,
    refresh() {},
    announce: (t) => said.push(t),
    ...tm
  });
  p.begin();
  p.onBlur(); // the native dialog blurs the window while the request is out
  await flush();
  assert.equal(bridge.calls.code, 1);
  assert.equal(p.isDenied(), true, 'a refusal is handled BEFORE the stopped check');
  assert.deepEqual(said, [REFUSED_TEXT]);
  assert.equal(codeEl.textContent, '—');
  p.onFocus();
  p.onVisibility(false);
  p.start();
  await flush();
  assert.equal(bridge.calls.code, 1, 'no second request after a refusal, however many refocuses');
  assert.equal(tm.pending().length, 0);
});

test("code widget: a confirmed first reply is NOT discarded because the dialog's blur set stopped; focus resumes it", async () => {
  const { createTotpPoller } = await load();
  const bridge = fakeBridge({ code: { code: '123456', secondsRemaining: 20 } });
  const codeEl = { textContent: '••••••' };
  const countEl = { textContent: '' };
  const tm = fakeTimers();
  const p = createTotpPoller({
    bridge,
    vaultId: 'v',
    itemId: 'i',
    codeEl,
    countEl,
    refresh() {},
    announce() {},
    ...tm
  });
  p.begin();
  p.onBlur();
  await flush();
  assert.equal(codeEl.textContent, '123456', 'shown although stopped');
  assert.equal(tm.pending().length, 0, 'no countdown while stopped');
  p.onFocus();
  await flush();
  assert.equal(bridge.calls.code, 2, 'focus re-fetches (main answers from the item grant, no dialog)');
  assert.equal(countEl.textContent, '20s');
  assert.equal(tm.pending().length, 1);
  p.stop();
  assert.equal(tm.pending().length, 0);
});

test('code widget: one request in flight at a time - a refocus racing the reply never asks twice', async () => {
  const { createTotpPoller } = await load();
  let release;
  const bridge = fakeBridge({ code: () => new Promise((r) => (release = r)) });
  const p = createTotpPoller({
    bridge,
    vaultId: 'v',
    itemId: 'i',
    codeEl: { textContent: '' },
    countEl: { textContent: '' },
    refresh() {},
    announce() {},
    ...fakeTimers()
  });
  p.begin();
  p.onBlur();
  p.onFocus();
  p.onBlur();
  p.onFocus();
  await flush();
  assert.equal(bridge.calls.code, 1);
  release({ code: null, refused: 'not-confirmed' });
  await flush();
  assert.equal(p.isDenied(), true);
  p.onFocus();
  await flush();
  assert.equal(bridge.calls.code, 1);
});

test('code widget: unchanged behaviour when nothing is refused (countdown, boundary re-fetch, lock -> refresh, no-code dash)', async () => {
  const { createTotpPoller } = await load();
  const tm = fakeTimers();
  const replies = [
    { code: '111111', secondsRemaining: 1 },
    { code: '222222', secondsRemaining: 30 }
  ];
  const bridge = fakeBridge({ code: () => replies.shift() });
  const codeEl = { textContent: '' };
  const countEl = { textContent: '' };
  const p = createTotpPoller({
    bridge,
    vaultId: 'v',
    itemId: 'i',
    codeEl,
    countEl,
    refresh() {},
    announce() {},
    ...tm
  });
  p.begin();
  await flush();
  assert.equal(countEl.textContent, '1s');
  tm.pending()[0].fn(); // one second passes -> 0 -> period boundary -> re-fetch
  await flush();
  assert.equal(codeEl.textContent, '222222');
  assert.equal(bridge.calls.code, 2);

  let refreshed = 0;
  const lockedBridge = fakeBridge({ code: { locked: true } });
  const p2 = createTotpPoller({
    bridge: lockedBridge,
    vaultId: 'v',
    itemId: 'i',
    codeEl: { textContent: '' },
    countEl: { textContent: '' },
    refresh: () => refreshed++,
    announce() {},
    ...fakeTimers()
  });
  p2.begin();
  await flush();
  assert.equal(refreshed, 1);

  const none = { textContent: '' };
  const p3 = createTotpPoller({
    bridge: fakeBridge({ code: { code: null } }),
    vaultId: 'v',
    itemId: 'i',
    codeEl: none,
    countEl: { textContent: 'x' },
    refresh() {},
    announce() {},
    ...fakeTimers()
  });
  p3.begin();
  await flush();
  assert.equal(none.textContent, '—');
  assert.equal(p3.isDenied(), false);
});

test('the vault page wires the three reads through this controller (no inline vaultReveal / vaultTotpCode left)', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/pages/vault.js'), 'utf8');
  assert.ok(!/\.vaultReveal\(/.test(src), 'vault.js no longer calls vaultReveal itself');
  assert.ok(!/\.vaultTotpCode\(/.test(src), 'vault.js no longer calls vaultTotpCode itself');
  for (const fn of ['revealField(', 'copyField(', 'createTotpPoller(']) assert.ok(src.includes(fn), fn);
  // the poller's own handlers are the only ones wired to focus / blur / visibility
  assert.ok(/poller\.onFocus\(\)/.test(src) && /poller\.onVisibility\(/.test(src) && /poller\.onBlur\(\)/.test(src));
});

test('leg vault-lifecycle: a { locked: true } code read mid-poll refreshes the page once and arms no further poll', async () => {
  const { createTotpPoller } = await load();
  const tm = fakeTimers();
  let refreshed = 0;
  let n = 0;
  const bridge = fakeBridge({ code: () => (n++ === 0 ? { code: '111111', secondsRemaining: 1 } : { locked: true }) });
  const poller = createTotpPoller({
    bridge,
    vaultId: 'v',
    itemId: 'i',
    codeEl: { textContent: '' },
    countEl: { textContent: '' },
    refresh: () => refreshed++,
    announce() {},
    ...tm
  });
  poller.begin();
  await flush();
  tm.pending()[0].fn(); // one second: period boundary -> re-fetch -> the vault locked meanwhile
  await flush();
  assert.equal(refreshed, 1, 'the page re-renders to its locked state once');
  assert.equal(tm.pending().length, 0, 'no further poll is armed');
});

test('code widget: a BUSY answer does not latch - the next poll (timer) and the next focus ask again; a denial still latches', async () => {
  const { createTotpPoller, BUSY_RETRY_MS } = await load();
  const replies = [
    { code: null, refused: 'not-confirmed', busy: true },
    { code: null, refused: 'not-confirmed', busy: true },
    { code: '654321', secondsRemaining: 20 }
  ];
  const bridge = fakeBridge({ code: () => replies.shift() });
  const said = [];
  const codeEl = { textContent: '' };
  const tm = fakeTimers();
  const p = createTotpPoller({
    bridge,
    vaultId: 'v',
    itemId: 'i',
    codeEl,
    countEl: { textContent: '' },
    refresh() {},
    announce: (t) => said.push(t),
    ...tm
  });
  p.begin();
  await flush();
  assert.equal(p.isDenied(), false, 'busy never latches');
  assert.deepEqual(said, [], 'nothing is announced as a denial');
  assert.equal(codeEl.textContent, '—');
  const retry = tm.pending().find((t) => t.ms === BUSY_RETRY_MS);
  assert.ok(retry, 'a retry is scheduled');
  retry.fn();
  await flush();
  assert.equal(bridge.calls.code, 2, 'the timer asked again');
  p.onBlur(); // a window blur, then focus: asks again too
  p.onFocus();
  await flush();
  assert.equal(bridge.calls.code, 3);
  assert.equal(codeEl.textContent, '654321');

  const denied = fakeBridge({ code: { code: null, refused: 'not-confirmed' } });
  const q = createTotpPoller({
    bridge: denied,
    vaultId: 'v',
    itemId: 'i',
    codeEl: { textContent: '' },
    countEl: { textContent: '' },
    refresh() {},
    announce() {},
    ...fakeTimers()
  });
  q.begin();
  await flush();
  assert.equal(q.isDenied(), true, 'a denial (no busy flag) still latches');
});

test('reveal/copy: a busy answer announces the try-again line (not the denial line) and writes nothing', async () => {
  const { revealField, copyField, BUSY_TEXT } = await load();
  const busy = { refused: 'not-confirmed', busy: true };
  const said = [];
  const bridge = fakeBridge({ reveal: busy });
  await revealField({
    bridge,
    vaultId: 'v',
    itemId: 'i',
    name: 'password',
    onSecret: () => assert.fail('no secret'),
    refresh() {},
    announce: (t) => said.push(t)
  });
  await copyField({ bridge, vaultId: 'v', itemId: 'i', name: 'password', refresh() {}, announce: (t) => said.push(t) });
  assert.deepEqual(said, [BUSY_TEXT, BUSY_TEXT]);
  assert.equal(
    BUSY_TEXT,
    'Not confirmed - try again.',
    'true for a busy gate AND a confirmation cancelled by the browser'
  );
  assert.deepEqual(bridge.calls.clip, []);
});
