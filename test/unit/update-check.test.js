'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createUpdateChecker,
  decideUpdateCheck,
  REQUEST_HEADERS,
  DAY_MS,
  FIRST_CHECK_DELAY_MS,
  DEV_FIRST_CHECK_DELAY_MS,
  MIN_CHECK_GAP_MS
} = require('../../src/main/update-check.js');
const { LATEST_RELEASE_API_URL, MAX_BODY_BYTES } = require('../../src/shared/update-version.js');

// A manual timer wheel: nothing runs until the test fires it.
function makeTimers() {
  let next = 1;
  const pending = new Map();
  return {
    setTimeout(fn, ms) {
      const id = next++;
      pending.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    pending,
    /** The delays currently armed, oldest first. */
    delays: () => [...pending.values()].map((t) => t.ms),
    /** Fire the timer with this delay (the first match). */
    fire(ms) {
      for (const [id, t] of pending) {
        if (t.ms === ms) {
          pending.delete(id);
          t.fn();
          return true;
        }
      }
      return false;
    }
  };
}

const enc = new TextEncoder();
// A response with the real `Response` shape the checker reads: status + body.getReader() yielding Uint8Arrays.
function respond(status, body, { chunkSize = 64 } = {}) {
  const bytes = typeof body === 'string' ? enc.encode(body) : body;
  let off = 0;
  let cancelled = false;
  return {
    status,
    cancelled: () => cancelled,
    body: {
      getReader() {
        return {
          read: async () => {
            if (cancelled || off >= bytes.length) return { done: true, value: undefined };
            const value = bytes.slice(off, off + chunkSize);
            off += chunkSize;
            return { done: false, value };
          },
          cancel: async () => {
            cancelled = true;
          }
        };
      },
      cancel: async () => {
        cancelled = true;
      }
    }
  };
}
const tagBody = (tag) => JSON.stringify({ tag_name: tag });
const flush = () => new Promise((r) => setImmediate(r));

function setup({ version = '0.19.15', url = 'http://127.0.0.1:9/x', fetch, ...rest } = {}) {
  const timers = makeTimers();
  const calls = [];
  const changes = [];
  const traces = [];
  const checker = createUpdateChecker({
    fetch: async (u, init) => {
      calls.push({ url: u, init });
      return fetch(u, init, calls.length);
    },
    getVersion: () => version,
    url,
    platform: 'linux',
    arch: 'x64',
    appImage: false,
    onChange: (s) => changes.push(s),
    trace: (c) => traces.push(c),
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    logger: { error() {} },
    ...rest
  });
  return { checker, timers, calls, changes, traces };
}

test('the request: one GET with the pinned options and exactly the two caller headers', async () => {
  const h = setup({ fetch: async () => respond(200, tagBody('v0.19.16')) });
  h.checker.setEnabled(true);
  await flush();
  assert.equal(h.calls.length, 1);
  const { url, init } = h.calls[0];
  assert.equal(url, 'http://127.0.0.1:9/x');
  assert.equal(init.method, 'GET');
  assert.equal(init.credentials, 'omit');
  assert.equal(init.redirect, 'error');
  assert.equal(init.referrerPolicy, 'no-referrer');
  assert.equal(init.cache, 'no-store');
  assert.deepEqual(init.headers, { 'User-Agent': 'Goldfinch-update-check', Accept: 'application/vnd.github+json' });
  assert.deepEqual(REQUEST_HEADERS, init.headers);
  assert.ok(init.signal instanceof AbortSignal);
});

test('newer: state, trace, one change; a repeat answer emits once for lastCheck, available unchanged', async () => {
  const h = setup({ fetch: async () => respond(200, tagBody('v0.19.16')) });
  h.checker.setEnabled(true);
  await flush();
  assert.deepEqual(h.checker.getState(), {
    current: '0.19.15',
    available: '0.19.16',
    releaseUrl: 'https://github.com/msieurthenardier/goldfinch/releases/tag/v0.19.16',
    checkEnabled: true,
    downloadName: 'goldfinch_0.19.16_amd64.deb',
    lastCheck: { at: h.checker.getState().lastCheck.at, outcome: 'newer' },
    canCheck: true
  });
  assert.deepEqual(h.traces, ['newer']);
  const n = h.changes.length;
  h.timers.fire(DAY_MS);
  await flush();
  assert.deepEqual(h.traces, ['newer', 'newer']);
  assert.equal(h.changes.length, n + 1, 'one emit for the completion (lastCheck), none for available');
  assert.equal(h.changes.at(-1).available, '0.19.16');
  assert.equal(h.changes.at(-1).releaseUrl, 'https://github.com/msieurthenardier/goldfinch/releases/tag/v0.19.16');
});

test('current clears a previously available release; failures leave it untouched', async () => {
  const answers = [
    () => respond(200, tagBody('v0.19.16')),
    () => respond(500, ''),
    () => respond(200, tagBody('v0.19.15')),
    () => respond(200, tagBody('v0.19.14'))
  ];
  const h = setup({ fetch: async (_u, _i, n) => answers[n - 1]() });
  h.checker.setEnabled(true);
  await flush();
  assert.equal(h.checker.getState().available, '0.19.16');
  h.timers.fire(DAY_MS);
  await flush();
  assert.equal(h.checker.getState().available, '0.19.16', 'a 500 changes nothing');
  h.timers.fire(DAY_MS);
  await flush();
  assert.equal(h.checker.getState().available, null, 'a valid equal tag clears');
  assert.equal(h.checker.getState().releaseUrl, null);
  assert.deepEqual(h.traces, ['newer', 'http-500', 'current']);
  h.timers.fire(DAY_MS);
  await flush();
  assert.deepEqual(h.traces.at(-1), 'current', 'a lower tag is current');
});

test('each failure mode reaches its own trace code and leaves available null', async () => {
  const big = new Uint8Array(MAX_BODY_BYTES + 1000).fill(32);
  const modes = {
    'http-403': () => respond(403, ''),
    'http-401': () => respond(401, ''),
    'http-407': () => respond(407, ''),
    'http-500': () => respond(500, ''),
    'http-204': () => respond(204, ''),
    'bad-json': () => respond(200, 'not json'),
    'bad-tag': () => respond(200, tagBody('v0.19.16-rc.1')),
    'too-large': () => respond(200, big, { chunkSize: 100000 }),
    current: () => respond(200, tagBody('v0.19.15'))
  };
  for (const [code, make] of Object.entries(modes)) {
    const h = setup({ fetch: async () => make() });
    h.checker.setEnabled(true);
    await flush();
    assert.deepEqual(h.traces, [code], code);
    assert.equal(h.checker.getState().available, null, code);
  }
  const wrongType = setup({ fetch: async () => respond(200, JSON.stringify({ tag_name: 5 })) });
  wrongType.checker.setEnabled(true);
  await flush();
  assert.deepEqual(wrongType.traces, ['bad-tag']);

  const net = setup({
    fetch: async () => {
      throw new TypeError('Failed to fetch', { cause: new Error('net::ERR_CONNECTION_RESET') });
    }
  });
  net.checker.setEnabled(true);
  await flush();
  assert.deepEqual(net.traces, ['network']);

  const redirect = setup({
    fetch: async () => {
      throw new TypeError('Failed to fetch', { cause: new Error('net::ERR_FAILED: redirect') });
    }
  });
  redirect.checker.setEnabled(true);
  await flush();
  assert.deepEqual(redirect.traces, ['redirect']);
});

test('too-large: the read is abandoned and the request aborted once more than 512 KiB has arrived, whatever was declared', async () => {
  let res;
  const h = setup({
    fetch: async (_u, init) => {
      res = respond(200, new Uint8Array(MAX_BODY_BYTES * 4).fill(32), { chunkSize: 64 * 1024 });
      res.headers = { get: () => '10' }; // a lying declared length is not read
      h.signal = init.signal;
      return res;
    }
  });
  h.checker.setEnabled(true);
  await flush();
  assert.deepEqual(h.traces, ['too-large']);
  assert.equal(res.cancelled(), true);
  assert.equal(h.signal.aborted, true);
});

test('the 15 s overall limit is armed while a request is in flight and released when it settles', async () => {
  let release;
  const h = setup({
    fetch: () =>
      new Promise((resolve) => {
        release = () => resolve(respond(200, tagBody('v0.19.15')));
      })
  });
  h.checker.setEnabled(true);
  await flush();
  assert.ok(h.timers.delays().includes(15000));
  release();
  await flush();
  assert.ok(!h.timers.delays().includes(15000));
});

test('timeout: a response that never completes is abandoned at the 15 s limit', async () => {
  const h = setup({
    fetch: (_u, init) =>
      new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))
  });
  h.checker.setEnabled(true);
  await flush();
  assert.deepEqual(h.traces, []);
  assert.ok(h.timers.fire(15000));
  await flush();
  assert.deepEqual(h.traces, ['timeout']);
  assert.equal(h.checker.getState().available, null);
});

test('schedule: first check after the initial delay, then every 24 h from the previous start, one timer at a time', async () => {
  const h = setup({ fetch: async () => respond(200, tagBody('v0.19.15')), initialDelayMs: FIRST_CHECK_DELAY_MS });
  h.checker.start(true);
  assert.deepEqual(h.timers.delays(), [60000]);
  assert.equal(h.calls.length, 0);
  h.timers.fire(60000);
  await flush();
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.timers.delays(), [DAY_MS], 'exactly one schedule timer after a check');
  h.timers.fire(DAY_MS);
  await flush();
  assert.equal(h.calls.length, 2);
  assert.deepEqual(h.timers.delays(), [DAY_MS]);
});

test('start(false) arms nothing; start twice does not double the timer', async () => {
  const off = setup({ fetch: async () => respond(200, tagBody('v0.19.16')) });
  off.checker.start(false);
  assert.deepEqual(off.timers.delays(), []);
  assert.equal(off.checker.getState().checkEnabled, false);
  const on = setup({ fetch: async () => respond(200, tagBody('v0.19.16')) });
  on.checker.start(true);
  on.checker.start(true);
  assert.equal(on.timers.delays().length, 1);
});

test('overlap: a trigger while a check is in flight is dropped', async () => {
  let release;
  const h = setup({
    fetch: () =>
      new Promise((resolve) => {
        release = () => resolve(respond(200, tagBody('v0.19.16')));
      })
  });
  h.checker.setEnabled(true);
  await flush();
  assert.equal(h.calls.length, 1);
  h.timers.fire(DAY_MS);
  await flush();
  assert.equal(h.calls.length, 1, 'the second trigger was dropped');
  release();
  await flush();
  assert.deepEqual(h.traces, ['newer']);
  assert.deepEqual(h.timers.delays(), [DAY_MS], 'still exactly one timer');
});

test('setEnabled(false): clears state and timer, aborts the request in flight, fires onChange', async () => {
  let signal;
  const h = setup({
    fetch: (_u, init) => {
      signal = init.signal;
      return new Promise((_r, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    }
  });
  h.checker.setEnabled(true);
  await flush();
  const before = h.changes.length;
  h.checker.setEnabled(false);
  assert.equal(signal.aborted, true);
  assert.equal(h.changes.length, before + 1);
  assert.equal(h.checker.getState().checkEnabled, false);
  await flush();
  assert.deepEqual(h.timers.delays(), [], 'no schedule timer, no limit timer');
  assert.equal(h.changes.length, before + 1, 'the aborted answer changes nothing');
  assert.ok(h.traces.includes('disabled'));
  assert.ok(h.traces.includes('aborted'));
});

test('off after a release was found: available and releaseUrl go null', async () => {
  const h = setup({ fetch: async () => respond(200, tagBody('v0.19.16')) });
  h.checker.setEnabled(true);
  await flush();
  h.checker.setEnabled(false);
  assert.deepEqual(h.checker.getState(), {
    current: '0.19.15',
    available: null,
    releaseUrl: null,
    checkEnabled: false,
    downloadName: null,
    lastCheck: { at: h.checker.getState().lastCheck.at, outcome: 'newer' },
    canCheck: true
  });
  assert.equal(h.changes.at(-1).available, null);
});

test('off then on with a late answer from the first request: the late answer changes nothing', async () => {
  const pending = [];
  const h = setup({
    fetch: (_u, init) =>
      new Promise((resolve) => {
        pending.push({ resolve, signal: init.signal });
      })
  });
  h.checker.setEnabled(true);
  await flush();
  h.checker.setEnabled(false);
  h.checker.setEnabled(true);
  await flush();
  assert.equal(pending.length, 2, 'the second check started at once (the first was abandoned)');
  // the FIRST request answers late, with a newer tag, even though it was aborted
  pending[0].resolve(respond(200, tagBody('v9.9.9')));
  await flush();
  assert.equal(h.checker.getState().available, null, 'late answer ignored');
  pending[1].resolve(respond(200, tagBody('v0.19.16')));
  await flush();
  assert.equal(h.checker.getState().available, '0.19.16');
});

test('setEnabled(true) while already on is a no-op', async () => {
  const h = setup({ fetch: async () => respond(200, tagBody('v0.19.15')) });
  h.checker.setEnabled(true);
  await flush();
  h.checker.setEnabled(true);
  await flush();
  assert.equal(h.calls.length, 1);
});

test('stop(): clears the timer, aborts, fires nothing, safe twice, and nothing runs afterwards', async () => {
  let signal;
  const h = setup({
    fetch: (_u, init) => {
      signal = init.signal;
      return new Promise((_r, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    }
  });
  h.checker.setEnabled(true);
  await flush();
  const before = h.changes.length;
  h.checker.stop();
  h.checker.stop();
  assert.equal(signal.aborted, true);
  await flush();
  assert.deepEqual(h.timers.delays(), []);
  assert.equal(h.changes.length, before);
  h.checker.setEnabled(false);
  h.checker.setEnabled(true);
  await flush();
  assert.equal(h.calls.length, 1, 'a stopped checker starts nothing');
});

test('an inert checker (no address) never calls fetch on any path and keeps checkEnabled in step', async () => {
  const h = setup({
    url: null,
    fetch: async () => {
      throw new Error('fetch must never be called');
    }
  });
  h.checker.start(true);
  assert.equal(h.checker.getState().checkEnabled, true);
  h.checker.setEnabled(false);
  assert.equal(h.checker.getState().checkEnabled, false);
  h.checker.setEnabled(true);
  assert.equal(h.checker.getState().checkEnabled, true);
  h.timers.fire(FIRST_CHECK_DELAY_MS);
  h.timers.fire(DAY_MS);
  await flush();
  assert.equal(h.calls.length, 0);
  assert.deepEqual(h.timers.delays(), []);
  assert.deepEqual(h.checker.getState(), {
    current: '0.19.15',
    available: null,
    releaseUrl: null,
    checkEnabled: true,
    downloadName: null,
    lastCheck: null,
    canCheck: false
  });
  assert.ok(h.changes.length >= 2, 'the setting toggles still notify');
});

test('an onChange that throws never breaks the checker', async () => {
  const h = setup({
    fetch: async () => respond(200, tagBody('v0.19.16')),
    onChange: () => {
      throw new Error('sink');
    }
  });
  h.checker.setEnabled(true);
  await flush();
  assert.equal(h.checker.getState().available, '0.19.16');
});

test('decideUpdateCheck: packaged ignores the override; unpackaged runs only on a loopback http override', () => {
  const real = { url: LATEST_RELEASE_API_URL, initialDelayMs: FIRST_CHECK_DELAY_MS };
  assert.deepEqual(decideUpdateCheck({ isPackaged: true, env: {} }), real);
  assert.deepEqual(
    decideUpdateCheck({ isPackaged: true, env: { GOLDFINCH_UPDATE_CHECK_URL: 'http://127.0.0.1:9/x' } }),
    real
  );
  for (const u of ['http://127.0.0.1:8080/latest', 'http://localhost:8080/']) {
    assert.deepEqual(decideUpdateCheck({ isPackaged: false, env: { GOLDFINCH_UPDATE_CHECK_URL: u } }), {
      url: new URL(u).href,
      initialDelayMs: DEV_FIRST_CHECK_DELAY_MS
    });
  }
  const none = { url: null, initialDelayMs: FIRST_CHECK_DELAY_MS };
  for (const u of [
    undefined,
    '',
    'https://127.0.0.1:8080/',
    'http://example.com:8080/',
    'http://127.0.0.1/x',
    'http://user:pw@127.0.0.1:8080/',
    'http://127.0.0.1.evil.test:80/',
    'http://[::1]:8080/',
    'ftp://127.0.0.1:21/',
    'garbage',
    LATEST_RELEASE_API_URL
  ]) {
    assert.deepEqual(decideUpdateCheck({ isPackaged: false, env: { GOLDFINCH_UPDATE_CHECK_URL: u } }), none, String(u));
  }
  assert.deepEqual(decideUpdateCheck({ isPackaged: false, env: {} }), none);
});

test('downloadName is computed from available and the injected machine facts, never stored', async () => {
  const cases = [
    [{ platform: 'win32', arch: 'x64', appImage: false }, 'Goldfinch-Setup-0.19.16.exe'],
    [{ platform: 'darwin', arch: 'arm64', appImage: false }, 'Goldfinch-0.19.16-arm64.dmg'],
    [{ platform: 'darwin', arch: 'x64', appImage: false }, null],
    [{ platform: 'linux', arch: 'x64', appImage: true }, 'Goldfinch-0.19.16.AppImage'],
    [{ platform: 'linux', arch: 'x64', appImage: false }, 'goldfinch_0.19.16_amd64.deb'],
    [{ platform: 'linux', arch: 'arm64', appImage: false }, null]
  ];
  for (const [facts, name] of cases) {
    const h = setup({ ...facts, fetch: async () => respond(200, tagBody('v0.19.16')) });
    assert.equal(h.checker.getState().downloadName, null, 'nothing available yet');
    h.checker.setEnabled(true);
    await flush();
    assert.equal(h.checker.getState().downloadName, name, JSON.stringify(facts));
    h.checker.setEnabled(false);
    assert.equal(h.checker.getState().downloadName, null, 'cleared with available');
  }
});

// ---- leg `check-now-main-side`: checkNow, lastCheck, canCheck ----

function clockSetup(opts = {}) {
  const clock = { t: 1_000_000 };
  const h = setup({ now: () => clock.t, ...opts });
  return { ...h, clock };
}
const deferred = () => {
  const d = {};
  d.promise = new Promise((resolve, reject) => {
    d.resolve = resolve;
    d.reject = reject;
  });
  return d;
};

test('check-now with automatic checks off: one request, the outcome, lastCheck, no timer', async () => {
  const h = clockSetup({ fetch: async () => respond(200, tagBody('v0.19.16')) });
  const r = await h.checker.checkNow();
  assert.deepEqual(r, { outcome: 'newer' });
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.timers.delays(), []);
  assert.deepEqual(h.checker.getState().lastCheck, { at: 1_000_000, outcome: 'newer' });
  assert.equal(h.checker.getState().available, '0.19.16');
  assert.equal(h.checker.getState().checkEnabled, false);
  assert.equal(h.changes.length, 1, 'one emit per completion, carrying available and lastCheck');
  assert.equal(h.changes[0].available, '0.19.16');
  assert.equal(h.changes[0].lastCheck.outcome, 'newer');
});

test('check-now with automatic checks on: one request, the daily timer untouched', async () => {
  const h = clockSetup({ fetch: async () => respond(200, tagBody('v0.19.15')) });
  h.checker.start(true);
  const before = [...h.timers.pending.entries()].map(([id, t]) => [id, t.ms]);
  assert.deepEqual(await h.checker.checkNow(), { outcome: 'current' });
  assert.equal(h.calls.length, 1);
  assert.deepEqual(
    [...h.timers.pending.entries()].map(([id, t]) => [id, t.ms]),
    before
  );
});

test('the request options are identical on the scheduled and the on-demand path', async () => {
  const h = clockSetup({ fetch: async () => respond(200, tagBody('v0.19.15')) });
  h.checker.start(true);
  await h.checker.checkNow();
  h.clock.t += MIN_CHECK_GAP_MS;
  h.timers.fire(FIRST_CHECK_DELAY_MS);
  await flush();
  assert.equal(h.calls.length, 2);
  const [a, b] = h.calls;
  assert.equal(a.url, b.url);
  for (const k of ['method', 'credentials', 'redirect', 'referrerPolicy', 'cache'])
    assert.equal(a.init[k], b.init[k], k);
  assert.deepEqual(a.init.headers, b.init.headers);
  assert.deepEqual(Object.keys(a.init).sort(), Object.keys(b.init).sort());
  assert.deepEqual(a.init.headers, { 'User-Agent': 'Goldfinch-update-check', Accept: 'application/vnd.github+json' });
  assert.equal(a.init.method, 'GET');
  assert.equal(a.init.credentials, 'omit');
  assert.equal(a.init.redirect, 'error');
  assert.equal(a.init.referrerPolicy, 'no-referrer');
  assert.equal(a.init.cache, 'no-store');
});

test('check-now on an inert checker or after stop(): unavailable, zero requests', async () => {
  const inert = clockSetup({ url: null, fetch: async () => assert.fail('no fetch') });
  assert.deepEqual(await inert.checker.checkNow(), { outcome: 'unavailable' });
  assert.equal(inert.checker.getState().canCheck, false);
  const h = clockSetup({ fetch: async () => respond(200, tagBody('v0.19.15')) });
  assert.equal(h.checker.getState().canCheck, true);
  h.checker.stop();
  assert.equal(h.checker.getState().canCheck, false);
  assert.deepEqual(await h.checker.checkNow(), { outcome: 'unavailable' });
  assert.equal(h.calls.length, 0);
});

test('a press while a TIMER-started check is in flight joins it: no extra request, same outcome', async () => {
  const d = deferred();
  const h = clockSetup({ fetch: () => d.promise });
  h.checker.start(true);
  assert.ok(h.timers.fire(FIRST_CHECK_DELAY_MS));
  await flush();
  assert.equal(h.calls.length, 1);
  const p = h.checker.checkNow();
  await flush();
  assert.equal(h.calls.length, 1);
  d.resolve(respond(200, tagBody('v0.19.16')));
  assert.deepEqual(await p, { outcome: 'newer' });
  assert.equal(h.calls.length, 1);
});

test('two presses back to back without awaiting: one request, both get the outcome', async () => {
  const h = clockSetup({ fetch: async () => respond(200, tagBody('v0.19.15')) });
  const [a, b] = await Promise.all([h.checker.checkNow(), h.checker.checkNow()]);
  assert.deepEqual(a, { outcome: 'current' });
  assert.deepEqual(b, { outcome: 'current' });
  assert.equal(h.calls.length, 1);
});

test('inside the gap: too-soon with retryAt, no request; the 30 000 ms boundary is allowed', async () => {
  const h = clockSetup({ fetch: async () => respond(200, tagBody('v0.19.15')) });
  await h.checker.checkNow();
  h.clock.t += MIN_CHECK_GAP_MS - 1;
  assert.deepEqual(await h.checker.checkNow(), { outcome: 'too-soon', retryAt: 1_000_000 + MIN_CHECK_GAP_MS });
  assert.equal(h.calls.length, 1);
  h.clock.t += 1;
  assert.deepEqual(await h.checker.checkNow(), { outcome: 'current' });
  assert.equal(h.calls.length, 2);
});

test('the gap applies after a scheduled check too, and an in-flight check is joined even inside it', async () => {
  const h = clockSetup({ fetch: async () => respond(200, tagBody('v0.19.15')) });
  h.checker.start(true);
  h.timers.fire(FIRST_CHECK_DELAY_MS);
  await flush();
  assert.equal(h.calls.length, 1);
  assert.equal((await h.checker.checkNow()).outcome, 'too-soon');
  assert.equal(h.calls.length, 1);
});

test('the gap counts after a failed check but not after an aborted one', async () => {
  const failed = clockSetup({ fetch: async () => respond(500, '') });
  assert.deepEqual(await failed.checker.checkNow(), { outcome: 'failed' });
  assert.equal((await failed.checker.checkNow()).outcome, 'too-soon');

  const d = deferred();
  const aborted = clockSetup({
    fetch: (_u, init) => (init.signal.addEventListener('abort', () => d.reject(new Error('x'))), d.promise)
  });
  const p = aborted.checker.checkNow();
  await flush();
  aborted.checker.stop();
  assert.deepEqual(await p, { outcome: 'failed' });
  assert.equal(aborted.checker.getState().lastCheck, null, 'an abort sets no lastCheck');
});

test('a clock stepped backward counts the gap as elapsed', async () => {
  const h = clockSetup({ fetch: async () => respond(200, tagBody('v0.19.15')) });
  await h.checker.checkNow();
  h.clock.t -= 5000;
  assert.equal((await h.checker.checkNow()).outcome, 'current');
  assert.equal(h.calls.length, 2);
});

test('every failure code maps to failed', async () => {
  const cases = [
    () => respond(404, ''),
    () => respond(200, new Uint8Array(MAX_BODY_BYTES + 10)),
    () => respond(200, 'not json'),
    () => respond(200, tagBody('v0.19.16-rc.1')),
    () => {
      throw new Error('redirect mode is error');
    },
    () => {
      throw new Error('net::ERR');
    }
  ];
  for (const c of cases) {
    const h = clockSetup({ fetch: async () => c() });
    assert.deepEqual(await h.checker.checkNow(), { outcome: 'failed' });
    assert.equal(h.checker.getState().lastCheck.outcome, 'failed');
  }
});

test('a request that never completes ends as timeout: failed, and it counts toward the gap', async () => {
  const h = clockSetup({
    fetch: (_u, init) => new Promise((_r, rej) => init.signal.addEventListener('abort', () => rej(new Error('t'))))
  });
  const p = h.checker.checkNow();
  await flush();
  assert.ok(h.timers.fire(15 * 1000));
  assert.deepEqual(await p, { outcome: 'failed' });
  assert.deepEqual(h.traces, ['timeout']);
  assert.equal((await h.checker.checkNow()).outcome, 'too-soon');
});

test('setEnabled(false) during a check-now: failed, notice cleared, lastCheck unchanged, even for a late 200', async () => {
  const d = deferred();
  const h = clockSetup({ fetch: () => d.promise });
  h.checker.setEnabled(true);
  await flush();
  d.resolve(respond(200, tagBody('v0.19.16')));
  await flush();
  assert.equal(h.checker.getState().available, '0.19.16');
  const kept = h.checker.getState().lastCheck;
  h.checker.setEnabled(false);
  assert.equal(h.checker.getState().available, null);
  assert.deepEqual(h.checker.getState().lastCheck, kept, 'lastCheck is not cleared by turning the setting off');

  // the aborted request's late 200 never counts
  const d3 = deferred();
  const h3 = clockSetup({ fetch: () => d3.promise });
  const p = h3.checker.checkNow();
  await flush();
  h3.checker.setEnabled(true);
  h3.checker.setEnabled(false);
  d3.resolve(respond(200, tagBody('v0.19.16')));
  assert.deepEqual(await p, { outcome: 'failed' });
  assert.equal(h3.checker.getState().lastCheck, null);
  assert.equal(h3.checker.getState().available, null);
});

test('stop() during a check-now: failed, nothing emitted after stop', async () => {
  const d = deferred();
  const h = clockSetup({ fetch: () => d.promise });
  const p = h.checker.checkNow();
  await flush();
  h.checker.stop();
  const n = h.changes.length;
  d.resolve(respond(200, tagBody('v0.19.16')));
  assert.deepEqual(await p, { outcome: 'failed' });
  assert.equal(h.changes.length, n);
});

test('setEnabled(true) during a check-now: still one request in total', async () => {
  const d = deferred();
  const h = clockSetup({ fetch: () => d.promise });
  const p = h.checker.checkNow();
  await flush();
  h.checker.setEnabled(true);
  await flush();
  d.resolve(respond(200, tagBody('v0.19.15')));
  assert.deepEqual(await p, { outcome: 'current' });
  assert.equal(h.calls.length, 1);
});

test('check-now with automatic checks off that finds a newer version sets and emits available', async () => {
  const h = clockSetup({ fetch: async () => respond(200, tagBody('v0.19.16')) });
  await h.checker.checkNow();
  assert.equal(h.changes.at(-1).available, '0.19.16');
  assert.equal(h.changes.length, 1);
});

test('lastCheck is emitted on current after current, and survives off then on', async () => {
  const h = clockSetup({ fetch: async () => respond(200, tagBody('v0.19.15')) });
  await h.checker.checkNow();
  h.clock.t += MIN_CHECK_GAP_MS;
  const n = h.changes.length;
  await h.checker.checkNow();
  assert.equal(h.changes.length, n + 1);
  assert.equal(h.changes.at(-1).lastCheck.at, h.clock.t);
  const kept = h.checker.getState().lastCheck;
  h.checker.setEnabled(true);
  h.checker.setEnabled(false);
  assert.deepEqual(h.checker.getState().lastCheck.outcome, kept.outcome);
});
