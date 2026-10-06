'use strict';

const { EventEmitter } = require('node:events');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createSessionRuntime } = require('../../src/main/session-runtime');
const { partitionFromStoragePath: realPartitionFromStoragePath } = require('../../src/main/jar-data-helpers');

function setup(options = {}) {
  const log = [];
  const broadcasts = [];
  const chromeSends = [];
  const timers = [];
  let creatingInternal = false;
  let dbOpen = true;
  const jars = options.jars || [{ id: 'jar-a', partition: 'persist:jar-a', retentionDays: 30 }];
  const cookieSeenStore = {
    insertIfAbsent(...args) {
      log.push(['insert', ...args]);
    },
    deleteByIdentity(...args) {
      log.push(['delete', ...args]);
    }
  };
  const sweepPromise = options.sweepPromise || Promise.resolve({ 'jar-a': { classes: ['cookies', 'storage'] } });
  // Mission 20 Flight 2 Leg 2 (DD6/AC5): a recording fake — procFor is called
  // for EVERY web session (Burner included), before the jar-lookup block.
  const certObserverCalls = [];
  const certObserver = {
    procFor: (partition) => {
      certObserverCalls.push(partition);
      return () => {};
    }
  };
  const runtime = createSessionRuntime({
    isCreatingInternalSession: () => creatingInternal,
    wireDownloadHandler: (session) => log.push(['downloads', session]),
    settings: options.settings || { get: () => true },
    partitionFromStoragePath:
      options.partitionFromStoragePath ||
      (() => (options.partition === undefined ? 'persist:jar-a' : options.partition)),
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
      try {
        return new URL(url).hostname;
      } catch {
        return '';
      }
    },
    classify:
      options.classify ||
      ((url) => ({
        thirdParty: url.includes('tracker.test'),
        domain: url.includes('tracker.test') ? 'tracker.test' : '',
        tracker: url.includes('tracker.test') ? 'analytics' : null
      })),
    shields: options.shields || {
      active: (kind) => kind === 'block' && !!options.blockTrackers,
      stripUrl: (url) => url
    },
    isolateEffective: options.isolateEffective,
    chromeForTab: () => ({ send: (channel, payload) => chromeSends.push([channel, payload]) }),
    certObserver,
    schedule: (fn) => {
      timers.push(fn);
      return timers.length;
    },
    logger: {
      error(...args) {
        log.push(['error', ...args]);
      }
    }
  });
  return {
    runtime,
    log,
    broadcasts,
    chromeSends,
    certObserverCalls,
    setCreatingInternal(value) {
      creatingInternal = value;
    },
    setDbOpen(value) {
      dbOpen = value;
    },
    flushPrivacy() {
      while (timers.length) timers.shift()();
    }
  };
}

// Squawk 0119: the real Electron 44 default UA (Windows), as probed live.
const ELECTRON_DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) goldfinch/0.18.2 Chrome/152.0.7977.130 Electron/44.4.4 Safari/537.36';
const CHROME_SHAPED_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.7977.130 Safari/537.36';

function fakeSession(log) {
  const handlers = {};
  const counts = { beforeRequest: 0, beforeSendHeaders: 0, headersReceived: 0 };
  // Squawk 0119: UA writes are recorded OUTSIDE `log`/`counts` (both are
  // asserted by exact shape elsewhere in this file).
  const userAgentSets = [];
  const session = {
    storagePath: '/profile/Partitions/jar-a',
    cookies: new EventEmitter(),
    webRequest: {
      onBeforeRequest(fn) {
        handlers.beforeRequest = fn;
        counts.beforeRequest++;
      },
      onBeforeSendHeaders(fn) {
        handlers.beforeSendHeaders = fn;
        counts.beforeSendHeaders++;
      },
      onHeadersReceived(fn) {
        handlers.headersReceived = fn;
        counts.headersReceived++;
      }
    },
    setSpellCheckerLanguages(languages) {
      log.push(['languages', languages]);
    },
    setPermissionRequestHandler(fn) {
      handlers.permissionRequest = fn;
    },
    setPermissionCheckHandler(fn) {
      handlers.permissionCheck = fn;
    },
    // Mission 20 Flight 2 Leg 2 (DD6): the verify-proc observer install site.
    setCertificateVerifyProc(fn) {
      handlers.certVerifyProc = fn;
      counts.certVerifyProc = (counts.certVerifyProc || 0) + 1;
    },
    // Squawk 0119: the UA strip site.
    getUserAgent() {
      return ELECTRON_DEFAULT_UA;
    },
    setUserAgent(userAgent) {
      userAgentSets.push(userAgent);
    }
  };
  return { session, handlers, counts, userAgentSets };
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
  // Mission 20 Flight 2 Leg 2 (DD6): the internal session NEVER gets an
  // observer — the early return above precedes the install site entirely.
  assert.equal(counts.certVerifyProc, undefined);
  assert.deepEqual(h.certObserverCalls, []);
});

// ---------------------------------------------------------------------------
// Squawk 0119: every WEB session presents a Chrome-shaped UA (embedder tokens
// stripped); the internal session is never touched.
// ---------------------------------------------------------------------------

test('squawk 0119: a web session gets setUserAgent with the embedder tokens stripped', () => {
  const h = setup();
  const { session, userAgentSets } = fakeSession(h.log);
  h.runtime.onSessionCreated(session);
  assert.deepEqual(userAgentSets, [CHROME_SHAPED_UA]);
});

test('squawk 0119: a web session with NO jar entry (Burner/default) still gets the stripped UA', () => {
  const h = setup({ partition: null });
  const { session, userAgentSets } = fakeSession(h.log);
  h.runtime.onSessionCreated(session);
  assert.deepEqual(userAgentSets, [CHROME_SHAPED_UA]);
});

test('squawk 0119: the internal session never has its UA set', () => {
  const h = setup();
  h.setCreatingInternal(true);
  const { session, userAgentSets } = fakeSession(h.log);
  h.runtime.onSessionCreated(session);
  assert.deepEqual(userAgentSets, []);
});

test('squawk 0119: a throwing UA read is fail-soft and never skips the rest of the wiring', () => {
  const h = setup();
  const { session, counts, userAgentSets } = fakeSession(h.log);
  session.getUserAgent = () => {
    throw new Error('boom');
  };
  assert.doesNotThrow(() => h.runtime.onSessionCreated(session));
  assert.deepEqual(userAgentSets, []);
  assert.equal(session.__goldfinchShields, true);
  assert.equal(counts.certVerifyProc, 1);
  assert.ok(h.log.some((entry) => entry[0] === 'downloads'));
  assert.ok(h.log.some((entry) => entry[0] === 'error' && entry[1] === '[user-agent] strip failed:'));
});

// ---------------------------------------------------------------------------
// Mission 20 Flight 2 Leg 2 (AC5): the observer is installed BEFORE the
// jar-lookup block's `if (!jarEntry) return` — a session with no jar entry
// (Burner, or any session-created race) still gets it.
// ---------------------------------------------------------------------------

test('AC5: a web session with NO matching jar entry still gets the verify-proc installed', () => {
  const h = setup({ partition: null }); // partitionFromStoragePath resolves null -> jarEntry lookup fails
  const { session, counts } = fakeSession(h.log);
  h.runtime.onSessionCreated(session);
  assert.equal(counts.certVerifyProc, 1, 'installed despite no jar entry (Burner parity)');
  assert.deepEqual(h.certObserverCalls, ['default']);
});

test('AC5: a web session WITH a matching jar entry is keyed by its own partition, not "default"', () => {
  const h = setup(); // default fake resolves partition -> 'persist:jar-a', matching the seeded jar
  const { session, counts } = fakeSession(h.log);
  h.runtime.onSessionCreated(session);
  assert.equal(counts.certVerifyProc, 1);
  assert.deepEqual(h.certObserverCalls, ['persist:jar-a']);
});

test('web session gets one Shields pipeline, downloads, idempotent spellcheck, and one cookie listener', () => {
  const h = setup();
  const { session, counts } = fakeSession(h.log);
  h.runtime.onSessionCreated(session);
  assert.equal(session.__goldfinchShields, true);
  // Mission 20 Flight 2 Leg 2 (DD6): a verify-proc is installed for every web
  // session, beside applyShields.
  assert.deepEqual(counts, { beforeRequest: 1, beforeSendHeaders: 1, headersReceived: 1, certVerifyProc: 1 });
  assert.equal(h.certObserverCalls.length, 1);
  assert.equal(h.log[0][0], 'downloads');
  assert.deepEqual(h.log[1], ['languages', ['en-US']]);
  assert.equal(session.cookies.listenerCount('changed'), 1);

  h.runtime.applyShields(session);
  assert.deepEqual(
    counts,
    { beforeRequest: 1, beforeSendHeaders: 1, headersReceived: 1, certVerifyProc: 1 },
    'repeat application never installs a second webRequest listener'
  );
  h.runtime.applySpellcheck(session, false);
  h.runtime.applySpellcheck(session, false);
  assert.deepEqual(
    h.log.slice(-2),
    [
      ['languages', []],
      ['languages', []]
    ],
    'spellcheck is safe and intentionally idempotent'
  );
});

test('pre-readiness settings/jars failures are fail-soft and spellcheck defaults off', () => {
  const h = setup({
    settings: {
      get() {
        throw new Error('not loaded');
      }
    },
    jarsError: true
  });
  const { session } = fakeSession(h.log);
  assert.doesNotThrow(() => h.runtime.onSessionCreated(session));
  assert.deepEqual(
    h.log.find((entry) => entry[0] === 'languages'),
    ['languages', []]
  );
  assert.equal(session.cookies.listenerCount('changed'), 0);
  assert.ok(h.log.some((entry) => entry[0] === 'error'));
});

test('webRequest pipeline records privacy, blocks trackers, and denies sensitive permissions', () => {
  const h = setup({ blockTrackers: true });
  const { session, handlers } = fakeSession(h.log);
  h.runtime.onSessionCreated(session);

  let response;
  handlers.beforeRequest(
    {
      webContentsId: 10,
      resourceType: 'mainFrame',
      url: 'https://site.test/'
    },
    (value) => {
      response = value;
    }
  );
  assert.deepEqual(response, {});

  handlers.beforeRequest(
    {
      webContentsId: 10,
      resourceType: 'script',
      url: 'https://tracker.test/a.js'
    },
    (value) => {
      response = value;
    }
  );
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
  handlers.permissionRequest({ id: 10 }, 'geolocation', (value) => {
    permissionGranted = value;
  });
  assert.equal(permissionGranted, false);
  assert.equal(handlers.permissionCheck(null, 'notifications'), false);
  assert.deepEqual(h.chromeSends.at(-1), [
    'privacy-permission',
    { webContentsId: 10, permission: 'geolocation', granted: false }
  ]);
});

test('permission allowlist denies invented/future permissions and grants allowlisted members', () => {
  const h = setup();
  const { session, handlers } = fakeSession(h.log);
  h.runtime.onSessionCreated(session);

  let permissionGranted;
  handlers.permissionRequest({ id: 10 }, 'some-future-perm-2030', (value) => {
    permissionGranted = value;
  });
  assert.equal(permissionGranted, false, 'invented permission denies via request handler');
  assert.equal(
    handlers.permissionCheck(null, 'some-future-perm-2030'),
    false,
    'invented permission denies via check handler'
  );

  handlers.permissionRequest({ id: 10 }, 'fullscreen', (value) => {
    permissionGranted = value;
  });
  assert.equal(permissionGranted, true, 'allowlisted permission is granted via request handler');
  assert.equal(
    handlers.permissionCheck(null, 'fullscreen'),
    true,
    'allowlisted permission is granted via check handler'
  );
  assert.deepEqual(h.chromeSends.at(-1), [
    'privacy-permission',
    { webContentsId: 10, permission: 'fullscreen', granted: true }
  ]);
});

test('Shields pipeline strips tracking URLs but no longer strips third-party request/response cookies (native isolation)', () => {
  const h = setup({
    isolateEffective: true,
    shields: {
      active: (kind) => kind === 'strip' || kind === 'isolate',
      stripUrl: (url) => (url.includes('utm_source') ? 'https://tracker.test/a.js' : url)
    }
  });
  const { session, handlers } = fakeSession(h.log);
  h.runtime.onSessionCreated(session);
  handlers.beforeRequest(
    {
      webContentsId: 10,
      resourceType: 'mainFrame',
      url: 'https://site.test/'
    },
    () => {}
  );

  let response;
  handlers.beforeRequest(
    {
      webContentsId: 10,
      resourceType: 'script',
      url: 'https://tracker.test/a.js?utm_source=x'
    },
    (value) => {
      response = value;
    }
  );
  assert.deepEqual(response, { redirectURL: 'https://tracker.test/a.js' });

  handlers.beforeSendHeaders(
    {
      webContentsId: 10,
      resourceType: 'script',
      url: 'https://tracker.test/a.js',
      requestHeaders: { Cookie: 'sid=1', Referer: 'https://site.test/path?q=1' }
    },
    (value) => {
      response = value;
    }
  );
  // Sortie 02 DD3: Referer still trimmed; Cookie passes through (Chromium filters natively).
  assert.deepEqual(response, { requestHeaders: { Cookie: 'sid=1', Referer: 'https://site.test/' } });

  handlers.headersReceived(
    {
      webContentsId: 10,
      resourceType: 'script',
      url: 'https://tracker.test/a.js',
      responseHeaders: { 'Set-Cookie': ['sid=2'], Server: ['test'] }
    },
    (value) => {
      response = value;
    }
  );
  assert.deepEqual(response, { responseHeaders: { 'Set-Cookie': ['sid=2'], Server: ['test'] } });
});

// ---- Sortie 02 DD6 accounting ---------------------------------------------

function accountingRig(options = {}) {
  const h = setup({
    isolateEffective: options.isolateEffective ?? true,
    shields: options.shields || { active: () => true, stripUrl: (url) => url }
  });
  const { session, handlers } = fakeSession(h.log);
  h.runtime.onSessionCreated(session);
  handlers.beforeRequest({ webContentsId: 10, resourceType: 'mainFrame', url: 'https://site.test/' }, () => {});
  function receive(details) {
    let out;
    const original = details.responseHeaders;
    handlers.headersReceived(
      { webContentsId: 10, resourceType: 'subFrame', url: 'https://tracker.test/f', ...details },
      (v) => {
        out = v;
      }
    );
    return { out, original };
  }
  function blockedCount() {
    h.flushPrivacy();
    const push = h.chromeSends.filter((c) => c[0] === 'privacy-net').at(-1);
    return push ? push[1].agg.cookiesBlocked : 0;
  }
  return { h, handlers, receive, blockedCount };
}

test('DD6: third-party subFrame with an unpartitioned Set-Cookie marks the domain (cookiesBlocked 1)', () => {
  const r = accountingRig();
  const headers = { 'Set-Cookie': ['a=1; Secure; SameSite=None'] };
  const { out } = r.receive({ responseHeaders: headers });
  assert.deepEqual(out, { responseHeaders: headers }, 'pass-through');
  assert.equal(r.blockedCount(), 1);
});

test('DD6: only valid partitioned cookies, mainFrame, first-party, or isolateEffective=false do not mark', () => {
  const part = accountingRig();
  part.receive({ responseHeaders: { 'set-cookie': ['__Host-a=1; Secure; Path=/; Partitioned'] } });
  assert.equal(part.blockedCount(), 0);

  const main = accountingRig();
  main.receive({ resourceType: 'mainFrame', responseHeaders: { 'Set-Cookie': ['a=1'] } });
  assert.equal(main.blockedCount(), 0);

  const fp = accountingRig();
  fp.receive({ url: 'https://site.test/x', responseHeaders: { 'Set-Cookie': ['a=1'] } });
  assert.equal(fp.blockedCount(), 0);

  const off = accountingRig({ isolateEffective: false });
  off.receive({ responseHeaders: { 'Set-Cookie': ['a=1'] } });
  assert.equal(off.blockedCount(), 0);
});

test('DD6: a paused site (isolate not active) with isolateEffective still marks', () => {
  const r = accountingRig({ shields: { active: () => false, stripUrl: (url) => url } });
  r.receive({ responseHeaders: { 'Set-Cookie': ['a=1'] } });
  assert.equal(r.blockedCount(), 1);
});

test('DD6 robustness: missing ids/aggregate/domain/headers never throw or mark; bare-string set-cookie normalizes', () => {
  const r = accountingRig();
  assert.doesNotThrow(() => r.receive({ webContentsId: undefined, responseHeaders: { 'Set-Cookie': ['a=1'] } }));
  assert.doesNotThrow(() => r.receive({ webContentsId: 999, responseHeaders: { 'Set-Cookie': ['a=1'] } }));
  assert.doesNotThrow(() => r.receive({ responseHeaders: undefined }));
  assert.doesNotThrow(() => r.receive({ responseHeaders: { Server: ['x'] } }));
  assert.doesNotThrow(() => r.receive({ responseHeaders: { 'Set-Cookie': [] } }));
  assert.equal(r.blockedCount(), 0);

  const h2 = setup({
    isolateEffective: true,
    classify: () => ({ thirdParty: true, domain: '', tracker: null })
  });
  const { session, handlers } = fakeSession(h2.log);
  h2.runtime.onSessionCreated(session);
  handlers.beforeRequest({ webContentsId: 10, resourceType: 'mainFrame', url: 'https://site.test/' }, () => {});
  handlers.headersReceived(
    { webContentsId: 10, resourceType: 'subFrame', url: 'https://x.test/', responseHeaders: { 'Set-Cookie': ['a=1'] } },
    () => {}
  );
  h2.flushPrivacy();
  assert.equal(
    h2.chromeSends.filter((c) => c[0] === 'privacy-net').at(-1)?.[1].agg.cookiesBlocked ?? 0,
    0,
    'missing classification.domain does not mark'
  );

  const bare = accountingRig();
  bare.receive({ responseHeaders: { 'Set-Cookie': 'a=1; Secure' } });
  assert.equal(bare.blockedCount(), 1, 'a bare-string set-cookie is normalized');
});

test('DD6 pass-through: response headers are deepEqual-unchanged for third-party and first-party alike', () => {
  const r = accountingRig();
  for (const url of ['https://tracker.test/f', 'https://site.test/f']) {
    const headers = { 'Set-Cookie': ['a=1', 'b=2; Partitioned; Secure'], Server: ['t'] };
    const snapshot = structuredClone(headers);
    const { out } = r.receive({ url, responseHeaders: headers });
    assert.deepEqual(out.responseHeaders, snapshot);
  }
});

// ---- Sortie 02 DD7 storage-access gating ----------------------------------

const ALLOWLIST_SAMPLE = [
  'fullscreen',
  'clipboard-sanitized-write',
  'pointerLock',
  'mediaKeySystem',
  'storage-access',
  'top-level-storage-access',
  'speaker-selection',
  'window-management'
];

function permissionOutcome(isolateEffective) {
  const h = setup({ isolateEffective });
  const { session, handlers } = fakeSession(h.log);
  h.runtime.onSessionCreated(session);
  const out = {};
  for (const p of ALLOWLIST_SAMPLE) {
    let req;
    handlers.permissionRequest({ id: 10 }, p, (v) => {
      req = v;
    });
    out[p] = [req, handlers.permissionCheck(null, p)];
  }
  return { out, h };
}

test('DD7: isolateEffective denies storage-access permissions in both handlers; every other entry is still granted', () => {
  const { out, h } = permissionOutcome(true);
  for (const p of ALLOWLIST_SAMPLE) {
    const expected = p === 'storage-access' || p === 'top-level-storage-access' ? false : true;
    assert.deepEqual(out[p], [expected, expected], p);
  }
  assert.deepEqual(
    h.chromeSends.find((c) => c[1].permission === 'storage-access'),
    ['privacy-permission', { webContentsId: 10, permission: 'storage-access', granted: false }]
  );
});

test('DD7: with isolateEffective false every allowlisted permission is granted (unchanged)', () => {
  const { out } = permissionOutcome(false);
  for (const p of ALLOWLIST_SAMPLE) assert.deepEqual(out[p], [true, true], p);
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
  assert.deepEqual(
    h.log.filter((entry) => entry[0] === 'insert' || entry[0] === 'delete'),
    [
      ['insert', 'jar-a', 'sid', '.example.test', '/', 1234],
      ['delete', 'jar-a', 'sid', '.example.test', '/']
    ]
  );
});

// ---------------------------------------------------------------------------
// Squawk 0079: `partitionFromStoragePath` (jar-data-helpers.js) now
// percent-decodes the recovered directory segment — Electron writes a
// container jar's on-disk partition directory percent-encoded
// (`Partitions/container%3Apersonal` for `persist:container:personal`).
// Before that fix, `onSessionCreated`'s `jars.list().find(jar =>
// jar.partition === partition)` lookup never matched a container jar, so the
// M10 cookie-bookkeeping listener was never attached for one and no
// `cookie_seen` rows were ever written. This test wires the REAL helper (not
// the ad-hoc fake above) so a regression in the decode step fails here.
// ---------------------------------------------------------------------------

test('squawk 0079: a percent-encoded partition directory still resolves its jar, attaching the cookie listener', () => {
  const h = setup({
    partitionFromStoragePath: realPartitionFromStoragePath,
    jars: [{ id: 'jar-container', partition: 'persist:container:personal', retentionDays: 30 }]
  });
  const { session } = fakeSession(h.log);
  session.storagePath = '/profile/Partitions/container%3Apersonal';
  h.runtime.onSessionCreated(session);
  assert.equal(
    session.cookies.listenerCount('changed'),
    1,
    'listener attaches once the percent-encoded segment decodes to a real jar partition'
  );

  const cookie = { name: 'sq79', domain: '.example.test', path: '/' };
  session.cookies.emit('changed', {}, cookie, 'inserted', false);
  assert.deepEqual(
    h.log.filter((entry) => entry[0] === 'insert'),
    [['insert', 'jar-container', 'sq79', '.example.test', '/', 1234]],
    'the inserted cookie reaches cookieSeenStore.insertIfAbsent keyed on the container jar'
  );
});

test('prune snapshots origins before history deletion, starts sweep without awaiting, and broadcasts by changed class', async () => {
  let resolveSweep;
  const sweepPromise = new Promise((resolve) => {
    resolveSweep = resolve;
  });
  const h = setup({ sweepPromise });
  const result = h.runtime.pruneAllJars();
  assert.equal(result, undefined, 'cadence remains fire-and-forget');
  assert.equal(h.log.indexOf('snapshot-origins') < h.log.findIndex((entry) => entry[0] === 'prune-history'), true);
  assert.equal(
    h.log.findIndex((entry) => entry[0] === 'prune-history') < h.log.findIndex((entry) => entry[0] === 'sweep'),
    true
  );
  assert.deepEqual(h.broadcasts, [['history-changed', { jarId: 'jar-a' }]]);
  resolveSweep({ 'jar-a': { classes: ['cookies'] }, 'jar-b': { classes: [] } });
  await sweepPromise;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.broadcasts.at(-1), ['jar-data-changed', { jarId: 'jar-a', classes: ['cookies'] }]);
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
