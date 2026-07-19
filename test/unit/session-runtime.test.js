'use strict';

const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSessionRuntime } = require('../../src/main/session-runtime');

function setup(options = {}) {
  const log = [];
  const broadcasts = [];
  const chromeSends = [];
  const timers = [];
  let creatingInternal = false;
  let dbOpen = true;
  const jars = options.jars || [{ id: 'jar-a', partition: 'persist:jar-a', retentionDays: 30 }];
  const cookieSeenStore = {
    insertIfAbsent(...args) { log.push(['insert', ...args]); },
    deleteByIdentity(...args) { log.push(['delete', ...args]); }
  };
  const sweepPromise = options.sweepPromise ||
    Promise.resolve({ 'jar-a': { classes: ['cookies', 'storage'] } });
  const runtime = createSessionRuntime({
    isCreatingInternalSession: () => creatingInternal,
    wireDownloadHandler: (session) => log.push(['downloads', session]),
    settings: options.settings || { get: () => true },
    partitionFromStoragePath: () =>
      options.partition === undefined ? 'persist:jar-a' : options.partition,
    jars: {
      list: () => {
        if (options.jarsError) throw new Error('not ready');
        return jars;
      }
    },
    appDb: { isOpen: () => dbOpen },
    cookieChangeAction: (cause, removed) =>
      removed || cause === 'expired' ? 'delete' : cause === 'overwrite' ? 'skip' : 'insert',
    cookieSeenStore,
    now: () => 1234,
    retentionSweep: {
      snapshotAgedOutOrigins(list) {
        log.push('snapshot-origins');
        return Object.fromEntries(list.map((jar) => [jar.id, ['https://old.test']]));
      },
      sweepAll(list, snapshots) {
        log.push(['sweep', list, snapshots]);
        return sweepPromise;
      }
    },
    historyStore: {
      pruneExpired(map, now) {
        log.push(['prune-history', map, now]);
        if (options.pruneError) throw new Error('prune');
        return { 'jar-a': 2 };
      }
    },
    broadcast: (channel, payload) => broadcasts.push([channel, payload]),
    registrableDomain: (host) => host,
    hostnameOf: (url) => {
      try { return new URL(url).hostname; } catch { return ''; }
    },
    classify: options.classify || ((url) => ({
      thirdParty: url.includes('tracker.test'),
      domain: url.includes('tracker.test') ? 'tracker.test' : '',
      tracker: url.includes('tracker.test') ? 'analytics' : null
    })),
    shields: options.shields || {
      active: (kind) => kind === 'block' && !!options.blockTrackers,
      stripUrl: (url) => url
    },
    chromeForTab: () => ({ send: (channel, payload) => chromeSends.push([channel, payload]) }),
    schedule: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    logger: { error(...args) { log.push(['error', ...args]); } }
  });
  return {
    runtime,
    log,
    broadcasts,
    chromeSends,
    setCreatingInternal(value) { creatingInternal = value; },
    setDbOpen(value) { dbOpen = value; },
    flushPrivacy() {
      while (timers.length) timers.shift()();
    }
  };
}

function fakeSession(log) {
  const handlers = {};
  const counts = { beforeRequest: 0, beforeSendHeaders: 0, headersReceived: 0 };
  const session = {
    storagePath: '/profile/Partitions/jar-a',
    cookies: new EventEmitter(),
    webRequest: {
      onBeforeRequest(fn) { handlers.beforeRequest = fn; counts.beforeRequest++; },
      onBeforeSendHeaders(fn) { handlers.beforeSendHeaders = fn; counts.beforeSendHeaders++; },
      onHeadersReceived(fn) { handlers.headersReceived = fn; counts.headersReceived++; }
    },
    setSpellCheckerLanguages(languages) { log.push(['languages', languages]); },
    setPermissionRequestHandler(fn) { handlers.permissionRequest = fn; },
    setPermissionCheckHandler(fn) { handlers.permissionCheck = fn; }
  };
  return { session, handlers, counts };
}

test('internal-session creation marks and refuses every web-session wiring', () => {
  const h = setup();
  h.setCreatingInternal(true);
  const { session, counts } = fakeSession(h.log);
  h.runtime.onSessionCreated(session);
  assert.equal(session.__goldfinchInternal, true);
  assert.deepEqual(counts, { beforeRequest: 0, beforeSendHeaders: 0, headersReceived: 0 });
  assert.equal(session.cookies.listenerCount('changed'), 0);
  assert.deepEqual(h.log, []);
});

test('web session gets one Shields pipeline, downloads, idempotent spellcheck, and one cookie listener', () => {
  const h = setup();
  const { session, counts } = fakeSession(h.log);
  h.runtime.onSessionCreated(session);
  assert.equal(session.__goldfinchShields, true);
  assert.deepEqual(counts, { beforeRequest: 1, beforeSendHeaders: 1, headersReceived: 1 });
  assert.equal(h.log[0][0], 'downloads');
  assert.deepEqual(h.log[1], ['languages', ['en-US']]);
  assert.equal(session.cookies.listenerCount('changed'), 1);

  h.runtime.applyShields(session);
  assert.deepEqual(counts, { beforeRequest: 1, beforeSendHeaders: 1, headersReceived: 1 },
    'repeat application never installs a second webRequest listener');
  h.runtime.applySpellcheck(session, false);
  h.runtime.applySpellcheck(session, false);
  assert.deepEqual(h.log.slice(-2), [['languages', []], ['languages', []]],
    'spellcheck is safe and intentionally idempotent');
});

test('pre-readiness settings/jars failures are fail-soft and spellcheck defaults off', () => {
  const h = setup({ settings: { get() { throw new Error('not loaded'); } }, jarsError: true });
  const { session } = fakeSession(h.log);
  assert.doesNotThrow(() => h.runtime.onSessionCreated(session));
  assert.deepEqual(h.log.find((entry) => entry[0] === 'languages'), ['languages', []]);
  assert.equal(session.cookies.listenerCount('changed'), 0);
  assert.ok(h.log.some((entry) => entry[0] === 'error'));
});

test('webRequest pipeline records privacy, blocks trackers, and denies sensitive permissions', () => {
  const h = setup({ blockTrackers: true });
  const { session, handlers } = fakeSession(h.log);
  h.runtime.onSessionCreated(session);

  let response;
  handlers.beforeRequest({
    webContentsId: 10,
    resourceType: 'mainFrame',
    url: 'https://site.test/'
  }, (value) => { response = value; });
  assert.deepEqual(response, {});

  handlers.beforeRequest({
    webContentsId: 10,
    resourceType: 'script',
    url: 'https://tracker.test/a.js'
  }, (value) => { response = value; });
  assert.deepEqual(response, { cancel: true });
  h.flushPrivacy();
  assert.deepEqual(h.chromeSends.at(-1), [
    'privacy-net',
    {
      webContentsId: 10,
      agg: {
        firstParty: 'site.test',
        secure: true,
        total: 1,
        mixedContent: 0,
        blocked: 1,
        stripped: 0,
        cookiesBlocked: 0,
        thirdPartyCount: 1,
        thirdPartyList: [{ domain: 'tracker.test', count: 1 }],
        trackers: {
          count: 1,
          blocked: 1,
          allowed: 0,
          ads: [],
          analytics: [{ domain: 'tracker.test', blocked: true }],
          social: [],
          other: []
        }
      }
    }
  ]);

  let permissionGranted;
  handlers.permissionRequest({ id: 10 }, 'geolocation', (value) => { permissionGranted = value; });
  assert.equal(permissionGranted, false);
  assert.equal(handlers.permissionCheck(null, 'notifications'), false);
  assert.deepEqual(h.chromeSends.at(-1), [
    'privacy-permission',
    { webContentsId: 10, permission: 'geolocation', granted: false }
  ]);
});

test('Shields pipeline strips tracking URLs and isolates third-party request/response cookies', () => {
  const h = setup({
    shields: {
      active: (kind) => kind === 'strip' || kind === 'isolate',
      stripUrl: (url) => url.includes('utm_source') ? 'https://tracker.test/a.js' : url
    }
  });
  const { session, handlers } = fakeSession(h.log);
  h.runtime.onSessionCreated(session);
  handlers.beforeRequest({
    webContentsId: 10,
    resourceType: 'mainFrame',
    url: 'https://site.test/'
  }, () => {});

  let response;
  handlers.beforeRequest({
    webContentsId: 10,
    resourceType: 'script',
    url: 'https://tracker.test/a.js?utm_source=x'
  }, (value) => { response = value; });
  assert.deepEqual(response, { redirectURL: 'https://tracker.test/a.js' });

  handlers.beforeSendHeaders({
    webContentsId: 10,
    resourceType: 'script',
    url: 'https://tracker.test/a.js',
    requestHeaders: { Cookie: 'sid=1', Referer: 'https://site.test/path?q=1' }
  }, (value) => { response = value; });
  assert.deepEqual(response, { requestHeaders: { Referer: 'https://site.test/' } });

  handlers.headersReceived({
    webContentsId: 10,
    resourceType: 'script',
    url: 'https://tracker.test/a.js',
    responseHeaders: { 'Set-Cookie': ['sid=2'], Server: ['test'] }
  }, (value) => { response = value; });
  assert.deepEqual(response, { responseHeaders: { Server: ['test'] } });
});

test('cookie changes insert first-seen, delete expiration, skip overwrite, and stop after DB close', () => {
  const h = setup();
  const { session } = fakeSession(h.log);
  h.runtime.onSessionCreated(session);
  const cookie = { name: 'sid', domain: '.example.test', path: '/' };
  session.cookies.emit('changed', {}, cookie, 'explicit', false);
  session.cookies.emit('changed', {}, cookie, 'expired', true);
  session.cookies.emit('changed', {}, cookie, 'overwrite', false);
  h.setDbOpen(false);
  session.cookies.emit('changed', {}, cookie, 'explicit', false);
  assert.deepEqual(h.log.filter((entry) => entry[0] === 'insert' || entry[0] === 'delete'), [
    ['insert', 'jar-a', 'sid', '.example.test', '/', 1234],
    ['delete', 'jar-a', 'sid', '.example.test', '/']
  ]);
});

test('prune snapshots origins before history deletion, starts sweep without awaiting, and broadcasts by changed class', async () => {
  let resolveSweep;
  const sweepPromise = new Promise((resolve) => { resolveSweep = resolve; });
  const h = setup({ sweepPromise });
  const result = h.runtime.pruneAllJars();
  assert.equal(result, undefined, 'cadence remains fire-and-forget');
  assert.equal(h.log.indexOf('snapshot-origins') <
    h.log.findIndex((entry) => entry[0] === 'prune-history'), true);
  assert.equal(h.log.findIndex((entry) => entry[0] === 'prune-history') <
    h.log.findIndex((entry) => entry[0] === 'sweep'), true);
  assert.deepEqual(h.broadcasts, [['history-changed', { jarId: 'jar-a' }]]);
  resolveSweep({ 'jar-a': { classes: ['cookies'] }, 'jar-b': { classes: [] } });
  await sweepPromise;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.broadcasts.at(-1),
    ['jar-data-changed', { jarId: 'jar-a', classes: ['cookies'] }]);
});

test('prune and sweep errors are isolated from the cadence caller', async () => {
  const prune = setup({ pruneError: true });
  assert.doesNotThrow(() => prune.runtime.pruneAllJars());
  assert.ok(prune.log.some((entry) => entry[0] === 'error'));

  const rejected = setup({ sweepPromise: Promise.reject(new Error('sweep')) });
  assert.doesNotThrow(() => rejected.runtime.pruneAllJars());
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(rejected.log.some((entry) => entry[0] === 'error'));
});
