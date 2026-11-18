'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registerUpdateIpc } = require('../../src/main/register-update-ipc');
const { eventFrom, guestEvent, makeTestGate } = require('../helpers/ipc-gate-fixture');
const { registerInternalHandler } = require('../../src/main/internal-ipc');

const RELEASE = 'https://github.com/msieurthenardier/goldfinch/releases/tag/v0.19.16';

const DEB = 'goldfinch_0.19.16_amd64.deb';
const DEB_URL = 'https://github.com/msieurthenardier/goldfinch/releases/download/v0.19.16/' + DEB;

function setup({ releaseUrl = RELEASE, pausedSecond = false, downloadName = DEB, startResult = true, checkNow } = {}) {
  const handlers = new Map();
  const ipcMain = { handle: (c, fn) => handlers.set(c, fn), on() {} };
  const chromeA = { id: 'chrome-a' };
  const chromeB = { id: 'chrome-b' };
  const recordA = { id: 1, name: 'A' };
  const recordB = { id: 2, name: 'B', chromeRecoveryPaused: pausedSecond };
  const guests = new Map([
    [101, recordA],
    [102, recordB]
  ]);
  const registry = {
    getWindowForChrome: (s) => (s === chromeA ? recordA : s === chromeB ? recordB : null),
    getWindowForGuest: (id) => guests.get(id) || null,
    // A last-focused accessor that must never be consulted:
    getLastFocused: () => {
      throw new Error('last-focused accessor used');
    }
  };
  const sends = [];
  const state = { current: '0.19.15', available: '0.19.16', releaseUrl, checkEnabled: true, downloadName };
  const started = [];
  const records = [];
  const clock = { t: 1_000_000 };
  const gate = makeTestGate({ ipcMain, registry });
  registerUpdateIpc({
    ipcMain,
    gate,
    registerInternalHandler,
    registry,
    getState: () => state,
    ...(checkNow ? { checkNow } : {}),
    queueChromeSend: (record, build) => sends.push([record.id, ...build()]),
    startUpdateDownload: (url) => {
      started.push(url);
      if (startResult === 'throw') throw new Error('boom');
      return startResult;
    },
    getDownloadsManager: () => ({ listAll: () => records.slice() }),
    now: () => clock.t
  });
  const internalEvent = (id) => ({
    sender: { id, session: { __goldfinchInternal: true } },
    senderFrame: { origin: 'goldfinch://settings' }
  });
  return { handlers, chromeA, chromeB, sends, state, internalEvent, started, records, clock };
}

test('registers exactly the five channels', () => {
  const h = setup();
  assert.deepEqual([...h.handlers.keys()].sort(), [
    'internal-update-check-now',
    'internal-update-download',
    'internal-update-open-release-page',
    'update:get-state',
    'update:open-release-page'
  ]);
});

test('update:get-state answers the chrome and an internal page with a COPY, takes no arguments', async () => {
  const h = setup();
  const fromChrome = await h.handlers.get('update:get-state')(eventFrom(h.chromeA), { evil: true });
  assert.deepEqual(fromChrome, h.state);
  fromChrome.available = 'tampered';
  assert.equal(h.state.available, '0.19.16');
  const fromInternal = await h.handlers.get('update:get-state')(h.internalEvent(101));
  assert.deepEqual(fromInternal, h.state);
});

test('a web tab guest is refused on all three channels', async () => {
  const h = setup();
  const web = guestEvent(101);
  await assert.rejects(async () => h.handlers.get('internal-update-download')(web));
  assert.deepEqual(h.started, []);
  await assert.rejects(async () => h.handlers.get('update:get-state')(web));
  assert.equal(await h.handlers.get('update:open-release-page')(web), false);
  await assert.rejects(async () => h.handlers.get('internal-update-open-release-page')(web));
  assert.deepEqual(h.sends, []);
});

test('the chrome open sends exactly the app-built address to the sender window and returns true', async () => {
  const h = setup();
  assert.equal(await h.handlers.get('update:open-release-page')(eventFrom(h.chromeA)), true);
  assert.deepEqual(h.sends, [[1, 'open-external-urls', { urls: [RELEASE] }]]);
});

test('page-supplied arguments change nothing about what is opened', async () => {
  const h = setup();
  for (const arg of [
    'https://evil.example/',
    { url: 'https://evil.example/', urls: ['x'] },
    42,
    null,
    ['https://evil.example/']
  ]) {
    h.sends.length = 0;
    assert.equal(await h.handlers.get('update:open-release-page')(eventFrom(h.chromeA), arg, arg), true);
    assert.deepEqual(h.sends, [[1, 'open-external-urls', { urls: [RELEASE] }]]);
    h.sends.length = 0;
    assert.equal(await h.handlers.get('internal-update-open-release-page')(h.internalEvent(101), arg, arg), true);
    assert.deepEqual(h.sends, [[1, 'open-external-urls', { urls: [RELEASE] }]]);
  }
});

test('no release available: false and nothing sent, on both', async () => {
  const h = setup({ releaseUrl: null });
  assert.equal(await h.handlers.get('update:open-release-page')(eventFrom(h.chromeA)), false);
  assert.equal(await h.handlers.get('internal-update-open-release-page')(h.internalEvent(101)), false);
  assert.deepEqual(h.sends, []);
});

test('the internal variant routes to the SENDER window with two windows open', async () => {
  const h = setup();
  assert.equal(await h.handlers.get('internal-update-open-release-page')(h.internalEvent(102)), true);
  assert.equal(await h.handlers.get('internal-update-open-release-page')(h.internalEvent(101)), true);
  assert.deepEqual(h.sends, [
    [2, 'open-external-urls', { urls: [RELEASE] }],
    [1, 'open-external-urls', { urls: [RELEASE] }]
  ]);
  h.sends.length = 0;
  assert.equal(await h.handlers.get('update:open-release-page')(eventFrom(h.chromeB)), true);
  assert.deepEqual(h.sends, [[2, 'open-external-urls', { urls: [RELEASE] }]]);
});

test('an unresolvable window or a recovery-paused chrome answers false and sends nothing', async () => {
  const h = setup({ pausedSecond: true });
  assert.equal(await h.handlers.get('internal-update-open-release-page')(h.internalEvent(999)), false);
  assert.equal(await h.handlers.get('internal-update-open-release-page')(h.internalEvent(102)), false);
  assert.equal(await h.handlers.get('update:open-release-page')(eventFrom(h.chromeB)), false);
  // a sender that is not a window chrome is refused by the gate (refusal value false)
  assert.equal(await h.handlers.get('update:open-release-page')(eventFrom({ id: 'stranger' })), false);
  assert.deepEqual(h.sends, []);
});

test('the internal handler refuses a non-internal sender', async () => {
  const h = setup();
  await assert.rejects(async () =>
    h.handlers.get('internal-update-open-release-page')({
      sender: { id: 101, session: {} },
      senderFrame: { origin: 'https://x.test' }
    })
  );
});

test('source: neither open channel calls the reveal gate or a last-focused accessor, and the registrar names the reason', () => {
  const src = require('node:fs').readFileSync(require.resolve('../../src/main/register-update-ipc'), 'utf8');
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, ''), /revealGate|getLastFocused|getChromeContents/);
  assert.match(src, /Neither open channel calls the reveal gate/);
});

const dl = (h, ...args) => h.handlers.get('internal-update-download')(h.internalEvent(101), ...args);

test('download: starts ONE download of the app-built address and answers { ok, name }', async () => {
  const h = setup();
  assert.deepEqual(await dl(h), { ok: true, name: DEB });
  assert.deepEqual(h.started, [DEB_URL]);
  assert.deepEqual(h.sends, [], 'no chrome send, no tab opened');
});

test('download: page-supplied arguments change nothing about what is downloaded', async () => {
  for (const arg of ['https://evil.example/x.exe', { url: 'https://evil.example/', name: 'x' }, 42, null, ['x']]) {
    const h = setup();
    assert.deepEqual(await dl(h, arg, arg), { ok: true, name: DEB });
    assert.deepEqual(h.started, [DEB_URL]);
  }
});

test('download: the address comes from the version and name, never from releaseUrl', async () => {
  const h = setup({ releaseUrl: 'https://evil.example/tag/v9' });
  await dl(h);
  assert.deepEqual(h.started, [DEB_URL]);
});

test('download: no downloadName, no available version, or a name that is not this version: unavailable, nothing started', async () => {
  for (const patch of [
    { downloadName: null },
    { available: null },
    { downloadName: 'evil.exe' },
    { downloadName: 'goldfinch_0.19.17_amd64.deb' }
  ]) {
    const h = setup();
    Object.assign(h.state, patch);
    assert.deepEqual(await dl(h), { ok: false, reason: 'unavailable' });
    assert.deepEqual(h.started, []);
  }
});

test('download: a thrown or false start answers failed and leaves no latch behind', async () => {
  for (const startResult of ['throw', false]) {
    const h = setup({ startResult });
    assert.deepEqual(await dl(h), { ok: false, reason: 'failed' });
    assert.deepEqual(await dl(h), { ok: false, reason: 'failed' });
    assert.equal(h.started.length, 2, 'the second click was not blocked by a latch');
  }
});

test('download: a record with this address and no end time blocks a repeat (progressing, paused)', async () => {
  const h = setup();
  h.records.push({ id: 1, url: DEB_URL, state: 'progressing', startTime: 5 });
  assert.deepEqual(await dl(h), { ok: true, name: DEB, already: true });
  assert.deepEqual(h.started, []);
  h.records[0] = { id: 1, url: DEB_URL, state: 'progressing', startTime: 5, endTime: undefined };
  assert.equal((await dl(h)).already, true);
});

test('download: an interrupted record with no end time (a failed connect) does not block, a paused one does', async () => {
  const h = setup();
  h.records.push({ id: 1, url: DEB_URL, state: 'interrupted', startTime: 5 });
  assert.deepEqual(await dl(h), { ok: true, name: DEB });
  assert.equal(h.started.length, 1);
  const p = setup();
  p.records.push({ id: 1, url: DEB_URL, state: 'progressing', paused: true, startTime: 5 });
  assert.equal((await dl(p)).already, true);
  assert.deepEqual(p.started, []);
});

test('download: a finished record does not block', async () => {
  const h = setup();
  h.records.push({ id: 1, url: DEB_URL, state: 'interrupted', startTime: 5, endTime: 9 });
  assert.deepEqual(await dl(h), { ok: true, name: DEB });
  assert.equal(h.started.length, 1);
});

test('download: the start latch blocks a second click before the record appears, then yields to the record', async () => {
  const h = setup();
  assert.equal((await dl(h)).already, undefined);
  h.clock.t += 2000;
  assert.deepEqual(await dl(h), { ok: true, name: DEB, already: true });
  assert.equal(h.started.length, 1);
  // The record appears (started after the click) and has already ended: nothing is in progress.
  h.records.push({ id: 7, url: DEB_URL, state: 'interrupted', startTime: h.clock.t - 1500, endTime: h.clock.t - 1000 });
  assert.equal((await dl(h)).already, undefined);
  assert.equal(h.started.length, 2);
});

const REDIRECT_URL =
  'https://release-assets.githubusercontent.com/github-production-release-asset/123456/abcd-ef01?sp=r&sv=2018-11-09&sr=b&spr=https&se=2026-11-17T10%3A00%3A00Z&rscd=attachment%3B+filename%3D' +
  DEB +
  '&rsct=application%2Foctet-stream&skoid=00000000-0000-0000-0000-000000000000&sig=AbCdEf%2BGhIjKl%3D';
const DEB_1 = 'goldfinch_0.19.16_amd64 (1).deb';

test('download: a redirected, partition-less record with the installer name blocks a repeat (exact and (n) forms)', async () => {
  for (const filename of [DEB, DEB_1]) {
    const h = setup();
    h.records.push({ id: 1, url: REDIRECT_URL, filename, state: 'progressing', startTime: 5 });
    assert.deepEqual(await dl(h), { ok: true, name: DEB, already: true });
    assert.deepEqual(h.started, []);
  }
});

test('download: a partitioned, differently named, loosely named or interrupted record does not block', async () => {
  const cases = [
    { filename: DEB, partition: 'persist:jar-a', state: 'progressing' },
    { filename: 'other.deb', state: 'progressing' },
    { filename: 'goldfinch_0.19.16_amd64 (x).deb', state: 'progressing' },
    { filename: 'goldfinch_0.19.16_amd64 (0).deb', state: 'progressing' },
    { filename: 'goldfinch_0.19.16_amd64 (1).deb.exe', state: 'progressing' },
    { filename: DEB, state: 'interrupted' },
    { filename: DEB, state: 'progressing', endTime: 9 }
  ];
  for (const c of cases) {
    const h = setup();
    h.records.push({ id: 1, url: REDIRECT_URL, startTime: 5, ...c });
    assert.equal((await dl(h)).already, undefined, JSON.stringify(c));
    assert.equal(h.started.length, 1);
  }
});

test('download: the latch releases when a redirected, name-matched record appears', async () => {
  const h = setup();
  await dl(h);
  h.clock.t += 2000;
  h.records.push({
    id: 7,
    url: REDIRECT_URL,
    filename: DEB,
    state: 'interrupted',
    startTime: h.clock.t - 1500,
    endTime: h.clock.t - 1000
  });
  assert.equal((await dl(h)).already, undefined);
  assert.equal(h.started.length, 2);
});

test('download: the latch expires after ten seconds', async () => {
  const h = setup();
  await dl(h);
  h.clock.t += 9999;
  assert.equal((await dl(h)).already, true);
  h.clock.t += 1;
  assert.equal((await dl(h)).already, undefined);
  assert.equal(h.started.length, 2);
});

test('download: a state push between render and click - the click downloads what main says now and names it', async () => {
  const h = setup();
  Object.assign(h.state, { available: '0.19.17', downloadName: 'goldfinch_0.19.17_amd64.deb' });
  assert.deepEqual(await dl(h), { ok: true, name: 'goldfinch_0.19.17_amd64.deb' });
  assert.deepEqual(h.started, [DEB_URL.replace('0.19.16', '0.19.17').replace('0.19.16', '0.19.17')]);
});

test('source: the download call is injected, the registrar has no electron session, and no reveal gate', () => {
  const src = require('node:fs').readFileSync(require.resolve('../../src/main/register-update-ipc'), 'utf8');
  const code = src.replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /downloadURL|require\('electron'\)|session\./);
  assert.match(src, /does not call the reveal gate either/);
});

test('internal-update-check-now: zero arguments reach checkNow, the result is a passed-through copy', async () => {
  const calls = [];
  const result = { outcome: 'too-soon', retryAt: 5 };
  const h = setup({
    checkNow: async (...args) => {
      calls.push(args);
      return result;
    }
  });
  for (const arg of ['x', { evil: 1 }, [1, 2], 42]) {
    const r = await h.handlers.get('internal-update-check-now')(h.internalEvent(101), arg, arg);
    assert.deepEqual(r, result);
    assert.notEqual(r, result);
  }
  assert.equal(calls.length, 4);
  assert.ok(calls.every((a) => a.length === 0));
});

test('internal-update-check-now: a web tab is refused; a throw or rejection answers unavailable; default is unavailable', async () => {
  let n = 0;
  const h = setup({
    checkNow: async () => {
      n++;
      throw new Error('boom');
    }
  });
  await assert.rejects(async () => h.handlers.get('internal-update-check-now')(guestEvent(101)));
  assert.equal(n, 0);
  assert.deepEqual(await h.handlers.get('internal-update-check-now')(h.internalEvent(101)), { outcome: 'unavailable' });
  const sync = setup({
    checkNow: () => {
      throw new Error('sync');
    }
  });
  assert.deepEqual(await sync.handlers.get('internal-update-check-now')(sync.internalEvent(101)), {
    outcome: 'unavailable'
  });
  const d = setup();
  assert.deepEqual(await d.handlers.get('internal-update-check-now')(d.internalEvent(101)), { outcome: 'unavailable' });
});
