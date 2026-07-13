'use strict';

// Unit tests for src/main/history-ipc.js (M08 Flight 1, Leg 3 / flight DD9).
//
// history-ipc.js is Electron-free — every dep is injected — so the harness
// fakes ipcMain (capturing handlers, the jar-ipc.js pattern), a minimal jars
// object exposing list(), a broadcast spy, and ONE shared fake history store
// with per-method throw toggles (the jar-ipc `storageThrows` convention,
// leg spec: "not four per-op fakes"). The fake store is a real (if tiny)
// in-memory jar-keyed visit list — deleteVisit/clearJar return real
// true/false and counts instead of hardcoded stubs, so the "not-found" and
// "cleared: 0" branches fall out of real behavior rather than special-casing.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { registerHistoryIpc } = require('../../src/main/history-ipc');

const personal = { id: 'personal', name: 'Personal', color: '#4caf50', partition: 'persist:container:personal' };
const work = { id: 'work', name: 'Work', color: '#2196f3', partition: 'persist:container:work' };

/**
 * A tiny jar-keyed in-memory visit store, real enough that deleteVisit /
 * clearJar / listRecent / search fall out of actual behavior. Per-method
 * `throws` flags simulate a store hiccup for the store-failure catch branch.
 */
function makeFakeStore({ throws = {} } = {}) {
  /** @type {Map<string, Array<{id:number, url:string, title:string|null, visitedAt:number}>>} */
  const data = new Map();
  let nextId = 1;
  /** @type {any} */
  let lastSuggestOpts = null;

  function rows(jarId) {
    if (!data.has(jarId)) data.set(jarId, []);
    return data.get(jarId);
  }

  return {
    // Test-only seeding helper — not part of the real history-store API.
    seed(jarId, { url, title = null, visitedAt } = {}) {
      const id = nextId++;
      rows(jarId).push({ id, url, title, visitedAt: visitedAt ?? id });
      return id;
    },
    // Test-only accessor — captures the opts bag the IPC handler passed to
    // suggest() on its most recent call, so a test can assert `now` was injected.
    get lastSuggestOpts() {
      return lastSuggestOpts;
    },
    listRecent(jarId, opts) {
      if (throws.listRecent) throw new Error('store blew up');
      const limit = opts && opts.limit !== undefined ? opts.limit : 100;
      return rows(jarId).slice(0, limit);
    },
    listByPage(jarId, opts) {
      if (throws.listByPage) throw new Error('store blew up');
      const page = opts && opts.page !== undefined ? opts.page : 1;
      const pageSize = opts && opts.pageSize !== undefined ? opts.pageSize : 50;
      const start = (page - 1) * pageSize;
      return rows(jarId).slice(start, start + pageSize);
    },
    search(jarId, query, opts) {
      if (throws.search) throw new Error('store blew up');
      const limit = opts && opts.limit !== undefined ? opts.limit : 50;
      return rows(jarId)
        .filter((v) => v.url.includes(query) || (v.title && v.title.includes(query)))
        .slice(0, limit);
    },
    suggest(jarId, query, opts) {
      lastSuggestOpts = opts;
      if (throws.suggest) throw new Error('store blew up');
      const limit = opts && opts.limit !== undefined ? opts.limit : 6;
      return rows(jarId)
        .filter((v) => v.url.includes(query) || (v.title && v.title.includes(query)))
        .slice(0, limit)
        .map((v) => ({ url: v.url, title: v.title, score: 1, lastVisitedAt: v.visitedAt }));
    },
    deleteVisit(jarId, visitId) {
      if (throws.deleteVisit) throw new Error('store blew up');
      const arr = rows(jarId);
      const idx = arr.findIndex((v) => v.id === visitId);
      if (idx === -1) return false;
      arr.splice(idx, 1);
      return true;
    },
    clearJar(jarId) {
      if (throws.clearJar) throw new Error('store blew up');
      const arr = rows(jarId);
      const n = arr.length;
      data.set(jarId, []);
      return n;
    },
    countByJar(jarId) {
      if (throws.countByJar) throw new Error('store blew up');
      return rows(jarId).length;
    }
  };
}

/**
 * Build the fake-deps harness. `storeThrows` toggles per-method throw
 * behavior on the ONE shared fake store (see header note).
 */
function makeHarness({ storeThrows = {} } = {}) {
  const handlers = new Map();
  const ipcMain = {
    handle(channel, fn) {
      handlers.set(channel, fn);
    }
  };
  const jars = { list: () => [personal, work] };
  const store = makeFakeStore({ throws: storeThrows });
  const events = [];
  const broadcast = (channel, payload) => events.push({ channel, payload });

  registerHistoryIpc({ ipcMain, historyStore: store, jars, broadcast });

  const invoke = (channel, payload) => handlers.get(channel)({}, payload);
  // Internal-origin-gated twins (DD9, mirrors jar-ipc's trustedJarsEvent()):
  // history has no page of its own — its UI renders inside goldfinch://jars
  // (DD9) — so the trusted origin here is 'goldfinch://jars'.
  const trustedHistoryEvent = () => ({
    senderFrame: { origin: 'goldfinch://jars', url: 'goldfinch://jars/' },
    sender: { session: { __goldfinchInternal: true } }
  });
  const invokeInternal = (channel, payload) => handlers.get(channel)(trustedHistoryEvent(), payload);

  return { handlers, events, store, invoke, invokeInternal };
}

// ---------------------------------------------------------------------------
// Registration surface
// ---------------------------------------------------------------------------
test('registers exactly the six chrome + six internal history channels, no others', () => {
  const h = makeHarness();
  assert.deepEqual(
    [...h.handlers.keys()].sort(),
    [
      'history-clear',
      'history-count',
      'history-delete',
      'history-page',
      'history-search',
      'history-suggest',
      'internal-history-clear',
      'internal-history-count',
      'internal-history-delete',
      'internal-history-page',
      'internal-history-search',
      'internal-history-suggest'
    ]
  );
});

// ---------------------------------------------------------------------------
// Untrusted-sender rejection (per internal-history-* channel)
// ---------------------------------------------------------------------------
test('an untrusted event (wrong origin) is rejected on every internal-history-* channel', () => {
  const h = makeHarness();
  const untrusted = {
    senderFrame: { origin: 'https://evil.test', url: 'https://evil.test/' },
    sender: { session: { __goldfinchInternal: true } }
  };
  for (const channel of [
    'internal-history-page',
    'internal-history-search',
    'internal-history-delete',
    'internal-history-clear',
    'internal-history-count',
    'internal-history-suggest'
  ]) {
    assert.throws(
      () => h.handlers.get(channel)(untrusted, { jarId: 'personal' }),
      (err) => err instanceof Error && err.message.includes('forbidden'),
      `${channel} should reject an untrusted sender`
    );
  }
  assert.equal(h.events.length, 0);
});

test('a non-internal session on an allowlisted origin is rejected too (strict === true check)', () => {
  const h = makeHarness();
  const notInternalSession = {
    senderFrame: { origin: 'goldfinch://jars', url: 'goldfinch://jars/' },
    sender: { session: { __goldfinchInternal: false } }
  };
  assert.throws(
    () => h.handlers.get('internal-history-page')(notInternalSession, { jarId: 'personal', page: 1 }),
    (err) => err instanceof Error && err.message.includes('forbidden')
  );
});

// ---------------------------------------------------------------------------
// Extract-don't-fork: behavioral parity across the trust boundary
// ---------------------------------------------------------------------------
test('a mutation via internal-history-clear is observable via the chrome history-page twin', () => {
  const h = makeHarness();
  h.store.seed('personal', { url: 'https://example.com/a' });
  h.store.seed('personal', { url: 'https://example.com/b' });
  assert.equal(h.invoke('history-page', { jarId: 'personal', page: 1 }).visits.length, 2);

  const result = h.invokeInternal('internal-history-clear', { jarId: 'personal' });
  assert.deepEqual(result, { ok: true, cleared: 2 });

  assert.deepEqual(h.invoke('history-page', { jarId: 'personal', page: 1 }).visits, []);
});

test('a mutation via chrome history-delete is observable via the internal-history-page twin', () => {
  const h = makeHarness();
  const id = h.store.seed('personal', { url: 'https://example.com/a' });
  assert.deepEqual(h.invoke('history-delete', { jarId: 'personal', visitId: id }), { ok: true });
  assert.deepEqual(h.invokeInternal('internal-history-page', { jarId: 'personal', page: 1 }).visits, []);
});

test('a read via internal-history-search sees rows recorded before either twin was called', () => {
  const h = makeHarness();
  h.store.seed('personal', { url: 'https://example.com/report', title: 'Quarterly report' });
  const chromeResult = h.invoke('history-search', { jarId: 'personal', query: 'report' });
  const internalResult = h.invokeInternal('internal-history-search', { jarId: 'personal', query: 'report' });
  assert.equal(chromeResult.visits.length, 1);
  assert.deepEqual(chromeResult.visits, internalResult.visits);
});

// ---------------------------------------------------------------------------
// history-page (H1/H5, M08 F6 Leg 4 / design review — replaces history-list)
// ---------------------------------------------------------------------------
test('history-page: malformed payload returns the static error, no store call', () => {
  const h = makeHarness();
  for (const bad of [undefined, null, 'nope', 42]) {
    assert.deepEqual(h.invoke('history-page', bad), { ok: false, error: 'history: page — malformed-payload' });
  }
});

test('history-page: unknown jarId returns the static error', () => {
  const h = makeHarness();
  assert.deepEqual(h.invoke('history-page', { jarId: 'nope', page: 1 }), { ok: false, error: 'history: page — unknown-jar' });
  assert.deepEqual(h.invoke('history-page', { jarId: 'burner', page: 1 }), { ok: false, error: 'history: page — unknown-jar' });
});

test('history-page: page must be a positive integer — 0/negative/fractional/non-finite is bad-args (isFiniteNumber alone would not catch these)', () => {
  const h = makeHarness();
  for (const page of [0, -1, 1.5, NaN, Infinity, 'one', {}, undefined]) {
    assert.deepEqual(h.invoke('history-page', { jarId: 'personal', page }), {
      ok: false,
      error: 'history: page — bad-args'
    });
  }
});

test('history-page: pageSize must be a positive integer when provided — same bad-args rule as page', () => {
  const h = makeHarness();
  for (const pageSize of [0, -1, 1.5, NaN, Infinity, 'ten', {}]) {
    assert.deepEqual(h.invoke('history-page', { jarId: 'personal', page: 1, pageSize }), {
      ok: false,
      error: 'history: page — bad-args'
    });
  }
});

test('history-page: pageSize is optional — omitting it uses the store default', () => {
  const h = makeHarness();
  h.store.seed('personal', { url: 'https://example.com' });
  const result = h.invoke('history-page', { jarId: 'personal', page: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.visits.length, 1);
});

test('history-page: success shape returns { ok: true, visits, total }', () => {
  const h = makeHarness();
  h.store.seed('personal', { url: 'https://example.com' });
  h.store.seed('personal', { url: 'https://example.com/2' });
  h.store.seed('work', { url: 'https://other.example.com' });
  const result = h.invoke('history-page', { jarId: 'personal', page: 1, pageSize: 1 });
  assert.equal(result.ok, true);
  assert.equal(result.visits.length, 1);
  assert.equal(result.visits[0].url, 'https://example.com');
  assert.equal(result.total, 2, 'total reflects countByJar, not the page size');
});

test('history-page: page 2 returns the second slice, using the shared store\'s real pagination', () => {
  const h = makeHarness();
  h.store.seed('personal', { url: 'https://example.com/a' });
  h.store.seed('personal', { url: 'https://example.com/b' });
  const page2 = h.invoke('history-page', { jarId: 'personal', page: 2, pageSize: 1 });
  assert.equal(page2.ok, true);
  assert.equal(page2.visits.length, 1);
  assert.equal(page2.visits[0].url, 'https://example.com/b');
});

test('history-page: an out-of-range page returns an empty visits array, not an error', () => {
  const h = makeHarness();
  h.store.seed('personal', { url: 'https://example.com' });
  const result = h.invoke('history-page', { jarId: 'personal', page: 99, pageSize: 10 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.visits, []);
  assert.equal(result.total, 1);
});

test('history-page: unknown extra payload keys are ignored', () => {
  const h = makeHarness();
  h.store.seed('personal', { url: 'https://example.com' });
  const result = h.invoke('history-page', { jarId: 'personal', page: 1, bogus: true });
  assert.equal(result.ok, true);
});

test('history-page: a throwing store returns the static store-failure string, never rejects', () => {
  const h = makeHarness({ storeThrows: { listByPage: true } });
  const result = h.invoke('history-page', { jarId: 'personal', page: 1 });
  assert.deepEqual(result, { ok: false, error: 'history: page — store-failure' });
});

// ---------------------------------------------------------------------------
// history-search
// ---------------------------------------------------------------------------
test('history-search: malformed payload returns the static error', () => {
  const h = makeHarness();
  for (const bad of [undefined, null, 'nope', 42]) {
    assert.deepEqual(h.invoke('history-search', bad), { ok: false, error: 'history: search — malformed-payload' });
  }
});

test('history-search: unknown jarId returns the static error', () => {
  const h = makeHarness();
  assert.deepEqual(h.invoke('history-search', { jarId: 'nope', query: 'x' }), {
    ok: false,
    error: 'history: search — unknown-jar'
  });
});

test('history-search: non-string query or non-finite limit returns bad-args', () => {
  const h = makeHarness();
  assert.deepEqual(h.invoke('history-search', { jarId: 'personal', query: 42 }), {
    ok: false,
    error: 'history: search — bad-args'
  });
  assert.deepEqual(h.invoke('history-search', { jarId: 'personal', query: undefined }), {
    ok: false,
    error: 'history: search — bad-args'
  });
  assert.deepEqual(h.invoke('history-search', { jarId: 'personal', query: 'x', limit: 'ten' }), {
    ok: false,
    error: 'history: search — bad-args'
  });
});

test('history-search: empty string query is a valid string (bad-args only rejects non-string)', () => {
  const h = makeHarness();
  const result = h.invoke('history-search', { jarId: 'personal', query: '' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.visits, []);
});

test('history-search: success shape returns { ok: true, visits }', () => {
  const h = makeHarness();
  h.store.seed('personal', { url: 'https://example.com/report', title: 'Quarterly report' });
  const result = h.invoke('history-search', { jarId: 'personal', query: 'report' });
  assert.equal(result.ok, true);
  assert.equal(result.visits.length, 1);
});

test('history-search: a throwing store returns the static store-failure string, never rejects', () => {
  const h = makeHarness({ storeThrows: { search: true } });
  const result = h.invoke('history-search', { jarId: 'personal', query: 'x' });
  assert.deepEqual(result, { ok: false, error: 'history: search — store-failure' });
});

// ---------------------------------------------------------------------------
// history-delete
// ---------------------------------------------------------------------------
test('history-delete: malformed payload returns the static error', () => {
  const h = makeHarness();
  for (const bad of [undefined, null, 'nope', 42]) {
    assert.deepEqual(h.invoke('history-delete', bad), { ok: false, error: 'history: delete — malformed-payload' });
  }
});

test('history-delete: unknown jarId returns the static error', () => {
  const h = makeHarness();
  const id = h.store.seed('personal', { url: 'https://example.com' });
  assert.deepEqual(h.invoke('history-delete', { jarId: 'nope', visitId: id }), {
    ok: false,
    error: 'history: delete — unknown-jar'
  });
});

test('history-delete: non-finite visitId returns bad-args', () => {
  const h = makeHarness();
  for (const visitId of ['1', NaN, Infinity, undefined, {}]) {
    assert.deepEqual(h.invoke('history-delete', { jarId: 'personal', visitId }), {
      ok: false,
      error: 'history: delete — bad-args'
    });
  }
});

test('history-delete: unknown visitId returns not-found, no broadcast', () => {
  const h = makeHarness();
  assert.deepEqual(h.invoke('history-delete', { jarId: 'personal', visitId: 999 }), {
    ok: false,
    error: 'history: delete — not-found'
  });
  assert.equal(h.events.length, 0);
});

test('history-delete: success returns { ok: true } and broadcasts history-changed ONLY on true', () => {
  const h = makeHarness();
  const id = h.store.seed('personal', { url: 'https://example.com' });
  const result = h.invoke('history-delete', { jarId: 'personal', visitId: id });
  assert.deepEqual(result, { ok: true });
  assert.equal(h.events.length, 1);
  assert.deepEqual(h.events[0], { channel: 'history-changed', payload: { jarId: 'personal' } });
});

test('history-delete: cross-jar visitId is scoped — deleting jar B\'s id via jar A returns not-found', () => {
  const h = makeHarness();
  const workId = h.store.seed('work', { url: 'https://work.example.com' });
  assert.deepEqual(h.invoke('history-delete', { jarId: 'personal', visitId: workId }), {
    ok: false,
    error: 'history: delete — not-found'
  });
  assert.equal(h.events.length, 0);
});

test('history-delete: a throwing store returns the static store-failure string, never rejects', () => {
  const h = makeHarness({ storeThrows: { deleteVisit: true } });
  const result = h.invoke('history-delete', { jarId: 'personal', visitId: 1 });
  assert.deepEqual(result, { ok: false, error: 'history: delete — store-failure' });
  assert.equal(h.events.length, 0);
});

// ---------------------------------------------------------------------------
// history-clear
// ---------------------------------------------------------------------------
test('history-clear: malformed payload returns the static error', () => {
  const h = makeHarness();
  for (const bad of [undefined, null, 'nope', 42]) {
    assert.deepEqual(h.invoke('history-clear', bad), { ok: false, error: 'history: clear — malformed-payload' });
  }
});

test('history-clear: unknown jarId returns the static error', () => {
  const h = makeHarness();
  assert.deepEqual(h.invoke('history-clear', { jarId: 'nope' }), {
    ok: false,
    error: 'history: clear — unknown-jar'
  });
});

test('history-clear: an empty jar is idempotent — ok:true, cleared:0, no broadcast', () => {
  const h = makeHarness();
  const result = h.invoke('history-clear', { jarId: 'personal' });
  assert.deepEqual(result, { ok: true, cleared: 0 });
  assert.equal(h.events.length, 0);
});

test('history-clear: a non-empty jar clears and broadcasts history-changed', () => {
  const h = makeHarness();
  h.store.seed('personal', { url: 'https://example.com/a' });
  h.store.seed('personal', { url: 'https://example.com/b' });
  const result = h.invoke('history-clear', { jarId: 'personal' });
  assert.deepEqual(result, { ok: true, cleared: 2 });
  assert.equal(h.events.length, 1);
  assert.deepEqual(h.events[0], { channel: 'history-changed', payload: { jarId: 'personal' } });
});

test('history-clear: clearing jar A never touches jar B\'s rows', () => {
  const h = makeHarness();
  h.store.seed('personal', { url: 'https://example.com/a' });
  h.store.seed('work', { url: 'https://work.example.com' });
  h.invoke('history-clear', { jarId: 'personal' });
  assert.equal(h.invoke('history-page', { jarId: 'work', page: 1 }).visits.length, 1);
});

test('history-clear: a throwing store returns the static store-failure string, never rejects', () => {
  const h = makeHarness({ storeThrows: { clearJar: true } });
  const result = h.invoke('history-clear', { jarId: 'personal' });
  assert.deepEqual(result, { ok: false, error: 'history: clear — store-failure' });
  assert.equal(h.events.length, 0);
});

// ---------------------------------------------------------------------------
// history-count (M08 Flight 2, Leg 1 / flight DD6)
// ---------------------------------------------------------------------------
test('history-count: malformed payload returns the static error, no store call', () => {
  const h = makeHarness();
  for (const bad of [undefined, null, 'nope', 42]) {
    assert.deepEqual(h.invoke('history-count', bad), { ok: false, error: 'history: count — malformed-payload' });
  }
});

test('history-count: unknown jarId returns the static error', () => {
  const h = makeHarness();
  assert.deepEqual(h.invoke('history-count', { jarId: 'nope' }), {
    ok: false,
    error: 'history: count — unknown-jar'
  });
  assert.deepEqual(h.invoke('history-count', { jarId: 'burner' }), {
    ok: false,
    error: 'history: count — unknown-jar'
  });
});

test('history-count: success shape returns { ok: true, count } against a real store, no broadcast', () => {
  const h = makeHarness();
  h.store.seed('personal', { url: 'https://example.com/a' });
  h.store.seed('personal', { url: 'https://example.com/b' });
  h.store.seed('work', { url: 'https://other.example.com' });
  const result = h.invoke('history-count', { jarId: 'personal' });
  assert.deepEqual(result, { ok: true, count: 2 });
  assert.equal(h.events.length, 0);
});

test('history-count: an empty jar returns { ok: true, count: 0 }', () => {
  const h = makeHarness();
  const result = h.invoke('history-count', { jarId: 'personal' });
  assert.deepEqual(result, { ok: true, count: 0 });
});

test('history-count: a throwing store returns the static store-failure string, never rejects', () => {
  const h = makeHarness({ storeThrows: { countByJar: true } });
  const result = h.invoke('history-count', { jarId: 'personal' });
  assert.deepEqual(result, { ok: false, error: 'history: count — store-failure' });
  assert.equal(h.events.length, 0);
});

test('a count via internal-history-count sees rows recorded via the chrome twin (extract-don\'t-fork parity)', () => {
  const h = makeHarness();
  h.store.seed('personal', { url: 'https://example.com/a' });
  const chromeResult = h.invoke('history-count', { jarId: 'personal' });
  const internalResult = h.invokeInternal('internal-history-count', { jarId: 'personal' });
  assert.deepEqual(chromeResult, internalResult);
  assert.deepEqual(chromeResult, { ok: true, count: 1 });
});

// ---------------------------------------------------------------------------
// history-suggest (M08 Flight 4, Leg 1 / flight DD3-DD4) — the omnibox's 6th
// op. Read-only, like history-count: no broadcast. internal-history-suggest
// is registered-but-unused this flight (the omnibox is chrome-only) but is
// still exercised here for registration-surface + trust-boundary parity.
// ---------------------------------------------------------------------------
test('history-suggest: malformed payload returns the static error, no store call', () => {
  const h = makeHarness();
  for (const bad of [undefined, null, 'nope', 42]) {
    assert.deepEqual(h.invoke('history-suggest', bad), { ok: false, error: 'history: suggest — malformed-payload' });
  }
});

test('history-suggest: unknown jarId returns the static error', () => {
  const h = makeHarness();
  assert.deepEqual(h.invoke('history-suggest', { jarId: 'nope', query: 'x' }), {
    ok: false,
    error: 'history: suggest — unknown-jar'
  });
  assert.deepEqual(h.invoke('history-suggest', { jarId: 'burner', query: 'x' }), {
    ok: false,
    error: 'history: suggest — unknown-jar'
  });
});

test('history-suggest: non-string query or non-finite limit returns bad-args', () => {
  const h = makeHarness();
  assert.deepEqual(h.invoke('history-suggest', { jarId: 'personal', query: 42 }), {
    ok: false,
    error: 'history: suggest — bad-args'
  });
  assert.deepEqual(h.invoke('history-suggest', { jarId: 'personal', query: undefined }), {
    ok: false,
    error: 'history: suggest — bad-args'
  });
  assert.deepEqual(h.invoke('history-suggest', { jarId: 'personal', query: 'x', limit: 'ten' }), {
    ok: false,
    error: 'history: suggest — bad-args'
  });
  assert.deepEqual(h.invoke('history-suggest', { jarId: 'personal', query: 'x', limit: NaN }), {
    ok: false,
    error: 'history: suggest — bad-args'
  });
});

test('history-suggest: empty string query is a valid string (bad-args only rejects non-string)', () => {
  const h = makeHarness();
  const result = h.invoke('history-suggest', { jarId: 'personal', query: '' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.suggestions, []);
});

test('history-suggest: success shape returns { ok: true, suggestions }', () => {
  const h = makeHarness();
  h.store.seed('personal', { url: 'https://example.com/report', title: 'Quarterly report' });
  const result = h.invoke('history-suggest', { jarId: 'personal', query: 'report' });
  assert.equal(result.ok, true);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].url, 'https://example.com/report');
});

test('history-suggest: handler injects now: Date.now() into the store opts (the store never calls Date.now() itself)', () => {
  const h = makeHarness();
  h.store.seed('personal', { url: 'https://example.com/report', title: 'Quarterly report' });
  const before = Date.now();
  h.invoke('history-suggest', { jarId: 'personal', query: 'report' });
  const after = Date.now();
  const opts = h.store.lastSuggestOpts;
  assert.equal(typeof opts.now, 'number');
  assert.ok(opts.now >= before && opts.now <= after, 'now should be a fresh Date.now() snapshot from the handler');
});

test('history-suggest: a throwing store returns the static store-failure string, never rejects', () => {
  const h = makeHarness({ storeThrows: { suggest: true } });
  const result = h.invoke('history-suggest', { jarId: 'personal', query: 'x' });
  assert.deepEqual(result, { ok: false, error: 'history: suggest — store-failure' });
});

test('a suggest via internal-history-suggest sees rows recorded before either twin was called (extract-don\'t-fork parity)', () => {
  const h = makeHarness();
  h.store.seed('personal', { url: 'https://example.com/report', title: 'Quarterly report' });
  const chromeResult = h.invoke('history-suggest', { jarId: 'personal', query: 'report' });
  const internalResult = h.invokeInternal('internal-history-suggest', { jarId: 'personal', query: 'report' });
  assert.equal(chromeResult.ok, true);
  assert.deepEqual(chromeResult.suggestions, internalResult.suggestions);
});
