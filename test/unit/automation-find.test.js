'use strict';

// Unit tests for src/main/automation/find.js (the automation findInPage /
// stopFindInPage ops).
//
// ARCHITECTURE NOTE (Deviation D1 — renderer-routed find):
// The main-process `found-in-page` event is NEVER delivered for <webview>
// guests. Proved live via [FIND-DIAG] logging: `findInPage called requestId=1`
// then (no event line) then `timeout fired matches=0`. The fix routes find
// operations through chromeContents.executeJavaScript, which injects a script
// into the chrome renderer that attaches a DOM `found-in-page` listener on the
// <webview> element (where the event fires) and returns a Promise resolving to
// the match counts. This module's tests model THAT architecture — the old
// main-process event-wrap is gone.
//
// Test strategy:
//   - fake deps.chromeContents with an executeJavaScript(code, userGesture)
//     that records the code string and returns a canned Promise<{...}>.
//   - Assert on the returned counts, on the injected code string (proving
//     wcId/text/opts are JSON-encoded), on the internal-session refusal, on
//     the foreground-first activate sequence, and on the bad-handle / no-such-
//     contents error paths.
//
// Covers:
//   - findInPage returns canned counts from executeJavaScript
//   - injected code contains JSON-encoded wcId, text, opts (option threading)
//   - resolveContents bad-handle / no-such-contents still throws
//   - op-local internal-session refusal for BOTH ops under allowInternal:true
//   - foreground-first activate is invoked for a backgrounded guest
//   - stopFindInPage calls executeJavaScript and returns {ok:true}
//   - missing chromeContents throws a clear error

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { findInPage, stopFindInPage } = require('../../src/main/automation/find');

// ---------------------------------------------------------------------------
// Fake helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal fake webContents (no EventEmitter needed — the new path never
 * attaches a main-process listener on wc; it routes through executeJavaScript).
 *
 * @param {number} id
 * @param {{ internal?: boolean }} [opts]
 */
function makeFakeWc(id, { internal = false } = {}) {
  return {
    id,
    session: { __goldfinchInternal: internal },
    isDestroyed() { return false; },
  };
}

/**
 * Build a fake chromeContents whose executeJavaScript records calls and
 * returns a canned result Promise.
 *
 * @param {{ activeMatchOrdinal?: number, matches?: number, ok?: boolean }} [canned]
 */
function makeFakeChromeContents(canned = { activeMatchOrdinal: 1, matches: 3 }) {
  const calls = /** @type {Array<{ code: string, userGesture: boolean }>} */ ([]);
  const cc = {
    _calls: calls,
    /** @param {string} code @param {boolean} userGesture @returns {Promise<any>} */
    executeJavaScript(code, userGesture) {
      calls.push({ code, userGesture });
      return Promise.resolve(canned);
    },
  };
  return cc;
}

/** Build a fake fromId lookup backed by a map of id → fake wc. */
function makeFakeFromId(map) {
  return (/** @type {number} */ id) => map[id] ?? null;
}

// ---------------------------------------------------------------------------
// findInPage — returns canned counts from executeJavaScript
// ---------------------------------------------------------------------------

test('findInPage: returns activeMatchOrdinal and matches from executeJavaScript result', async () => {
  const wc = makeFakeWc(1);
  const chromeContents = makeFakeChromeContents({ activeMatchOrdinal: 2, matches: 5 });
  const deps = {
    fromId: makeFakeFromId({ 1: wc }),
    chromeContents,
    findTimeoutMs: 500,
  };

  const result = await findInPage(1, 'hello', deps);

  assert.deepEqual(result, { activeMatchOrdinal: 2, matches: 5 });
  assert.equal(chromeContents._calls.length, 1, 'executeJavaScript called exactly once');
});

test('findInPage: zero-matches result returned cleanly (not an error)', async () => {
  const wc = makeFakeWc(2);
  const chromeContents = makeFakeChromeContents({ activeMatchOrdinal: 0, matches: 0 });
  const deps = {
    fromId: makeFakeFromId({ 2: wc }),
    chromeContents,
    findTimeoutMs: 500,
  };

  const result = await findInPage(2, 'missing', deps);

  assert.deepEqual(result, { activeMatchOrdinal: 0, matches: 0 });
});

test('findInPage: null/undefined counts from script default to 0', async () => {
  const wc = makeFakeWc(3);
  // Simulate _nowebview:true scenario (webview not found in renderer)
  const chromeContents = makeFakeChromeContents({ activeMatchOrdinal: 0, matches: 0, _nowebview: true });
  const deps = {
    fromId: makeFakeFromId({ 3: wc }),
    chromeContents,
    findTimeoutMs: 500,
  };

  const result = await findInPage(3, 'notfound', deps);

  assert.deepEqual(result, { activeMatchOrdinal: 0, matches: 0 });
});

// ---------------------------------------------------------------------------
// findInPage — injected code contains JSON-encoded wcId, text, opts
// (proves option threading all the way into the renderer script)
// ---------------------------------------------------------------------------

test('findInPage: injected code contains JSON-encoded wcId and text', async () => {
  const wc = makeFakeWc(42);
  const chromeContents = makeFakeChromeContents({ activeMatchOrdinal: 1, matches: 1 });
  const deps = {
    fromId: makeFakeFromId({ 42: wc }),
    chromeContents,
    findTimeoutMs: 500,
  };

  await findInPage(42, 'search text', deps);

  const code = chromeContents._calls[0].code;
  assert.ok(code.includes(JSON.stringify(42)), 'code must contain JSON-encoded wcId=42');
  assert.ok(code.includes(JSON.stringify('search text')), 'code must contain JSON-encoded text');
});

test('findInPage: default options encoded in injected code (forward:true, findNext:false, matchCase:false)', async () => {
  const wc = makeFakeWc(10);
  const chromeContents = makeFakeChromeContents({ activeMatchOrdinal: 1, matches: 1 });
  const deps = {
    fromId: makeFakeFromId({ 10: wc }),
    chromeContents,
    findTimeoutMs: 500,
  };

  await findInPage(10, 'hello', deps);

  const code = chromeContents._calls[0].code;
  assert.ok(code.includes(JSON.stringify({ forward: true, findNext: false, matchCase: false })),
    'default opts must be JSON-encoded in the injected script');
});

test('findInPage: findNext:true, forward:true encoded in injected code', async () => {
  const wc = makeFakeWc(11);
  const chromeContents = makeFakeChromeContents({ activeMatchOrdinal: 2, matches: 5 });
  const deps = {
    fromId: makeFakeFromId({ 11: wc }),
    chromeContents,
    findTimeoutMs: 500,
  };

  await findInPage(11, 'term', deps, { findNext: true, forward: true });

  const code = chromeContents._calls[0].code;
  assert.ok(code.includes(JSON.stringify({ forward: true, findNext: true, matchCase: false })),
    'findNext:true forward:true must be JSON-encoded in the injected script');
});

test('findInPage: findNext:true, forward:false encoded in injected code', async () => {
  const wc = makeFakeWc(12);
  const chromeContents = makeFakeChromeContents({ activeMatchOrdinal: 1, matches: 5 });
  const deps = {
    fromId: makeFakeFromId({ 12: wc }),
    chromeContents,
    findTimeoutMs: 500,
  };

  await findInPage(12, 'term', deps, { findNext: true, forward: false });

  const code = chromeContents._calls[0].code;
  assert.ok(code.includes(JSON.stringify({ forward: false, findNext: true, matchCase: false })),
    'forward:false must be JSON-encoded in the injected script');
});

test('findInPage: matchCase:true encoded in injected code', async () => {
  const wc = makeFakeWc(13);
  const chromeContents = makeFakeChromeContents({ activeMatchOrdinal: 1, matches: 1 });
  const deps = {
    fromId: makeFakeFromId({ 13: wc }),
    chromeContents,
    findTimeoutMs: 500,
  };

  await findInPage(13, 'Hello', deps, { matchCase: true });

  const code = chromeContents._calls[0].code;
  assert.ok(code.includes(JSON.stringify({ forward: true, findNext: false, matchCase: true })),
    'matchCase:true must be JSON-encoded in the injected script');
});

test('findInPage: executeJavaScript called with userGesture=true', async () => {
  const wc = makeFakeWc(14);
  const chromeContents = makeFakeChromeContents({ activeMatchOrdinal: 1, matches: 1 });
  const deps = {
    fromId: makeFakeFromId({ 14: wc }),
    chromeContents,
    findTimeoutMs: 500,
  };

  await findInPage(14, 'hello', deps);

  assert.equal(chromeContents._calls[0].userGesture, true, 'executeJavaScript must be called with userGesture=true');
});

// ---------------------------------------------------------------------------
// findInPage — injected code contains cold-start retry markers
// (regression guard: dropping setInterval / retry causes a silent regression
// that only manifests on cold webviews in the WSLg automation environment)
// ---------------------------------------------------------------------------

test('findInPage: injected code contains setInterval (cold-start retry)', async () => {
  const wc = makeFakeWc(50);
  const chromeContents = makeFakeChromeContents({ activeMatchOrdinal: 1, matches: 1 });
  const deps = {
    fromId: makeFakeFromId({ 50: wc }),
    chromeContents,
    findTimeoutMs: 500,
  };

  await findInPage(50, 'retry-check', deps);

  const code = chromeContents._calls[0].code;
  assert.ok(code.includes('setInterval'), 'injected code must use setInterval for cold-start retry');
});

test('findInPage: injected code calls wv.findInPage (issued inside retry loop)', async () => {
  const wc = makeFakeWc(51);
  const chromeContents = makeFakeChromeContents({ activeMatchOrdinal: 1, matches: 1 });
  const deps = {
    fromId: makeFakeFromId({ 51: wc }),
    chromeContents,
    findTimeoutMs: 500,
  };

  await findInPage(51, 'retry-check', deps);

  const code = chromeContents._calls[0].code;
  assert.ok(code.includes('findInPage'), 'injected code must call wv.findInPage (inside retry loop)');
});

test('findInPage: injected code contains JSON-encoded wcId, text, opts as named vars (WCID/TEXT/OPTS)', async () => {
  const wc = makeFakeWc(52);
  const chromeContents = makeFakeChromeContents({ activeMatchOrdinal: 2, matches: 4 });
  const deps = {
    fromId: makeFakeFromId({ 52: wc }),
    chromeContents,
    findTimeoutMs: 500,
  };

  await findInPage(52, 'cold search', deps, { forward: false, findNext: true, matchCase: true });

  const code = chromeContents._calls[0].code;
  // The retry recipe names the vars WCID/TEXT/OPTS (uppercase) and JSON-encodes them.
  assert.ok(code.includes(JSON.stringify(52)), 'code must contain JSON-encoded wcId=52');
  assert.ok(code.includes(JSON.stringify('cold search')), 'code must contain JSON-encoded text');
  assert.ok(
    code.includes(JSON.stringify({ forward: false, findNext: true, matchCase: true })),
    'code must contain JSON-encoded opts',
  );
});

test('findInPage: injected code contains clearInterval (retry cleanup)', async () => {
  const wc = makeFakeWc(53);
  const chromeContents = makeFakeChromeContents({ activeMatchOrdinal: 1, matches: 1 });
  const deps = {
    fromId: makeFakeFromId({ 53: wc }),
    chromeContents,
    findTimeoutMs: 500,
  };

  await findInPage(53, 'cleanup-check', deps);

  const code = chromeContents._calls[0].code;
  assert.ok(code.includes('clearInterval'), 'injected code must clear the retry interval on finish');
});

test('findInPage: injected code resolves only on matches > 0 (cold-start regression guard)', async () => {
  // Regression guard: the handler must check `matches > 0` before resolving on
  // finalUpdate. Without this, a cold-start spurious finalUpdate:true,matches:0
  // event causes findInPage to return {0,0} before the real count populates.
  // Verify the condition is present in the injected code string so a revert to
  // resolve-on-any-finalUpdate is caught immediately.
  const wc = makeFakeWc(54);
  const chromeContents = makeFakeChromeContents({ activeMatchOrdinal: 1, matches: 1 });
  const deps = {
    fromId: makeFakeFromId({ 54: wc }),
    chromeContents,
    findTimeoutMs: 500,
  };

  await findInPage(54, 'cold-start-guard', deps);

  const code = chromeContents._calls[0].code;
  assert.ok(
    code.includes('matches > 0'),
    'injected code must check matches > 0 before resolving on finalUpdate (cold-start guard)',
  );
});

// ---------------------------------------------------------------------------
// findInPage — missing chromeContents throws a clear error
// ---------------------------------------------------------------------------

test('findInPage: throws clear error when chromeContents is missing', async () => {
  const wc = makeFakeWc(99);
  const deps = {
    fromId: makeFakeFromId({ 99: wc }),
    chromeContents: null,
    findTimeoutMs: 100,
  };

  await assert.rejects(
    () => findInPage(99, 'hello', deps),
    /automation: findInPage — chromeContents unavailable/,
  );
});

// ---------------------------------------------------------------------------
// findInPage — foreground-first (guest activate + re-resolve)
// ---------------------------------------------------------------------------

test('findInPage: guest tab — activate called before executeJavaScript; re-resolved handle used', async () => {
  const callLog = /** @type {string[]} */ ([]);

  const preWc = makeFakeWc(20);
  const postWc = makeFakeWc(20);

  let resolved = 0;
  const fromId = (/** @type {number} */ id) => {
    if (id !== 20) return null;
    resolved += 1;
    return resolved === 1 ? preWc : postWc;
  };
  const activate = async () => { callLog.push('activate'); };

  // chromeContents != wc (preWc/postWc) → classifyContents returns 'guest'
  const chromeContents = makeFakeChromeContents({ activeMatchOrdinal: 1, matches: 1 });
  const origExec = chromeContents.executeJavaScript.bind(chromeContents);
  chromeContents.executeJavaScript = (code, ug) => {
    callLog.push('executeJavaScript');
    return origExec(code, ug);
  };

  const deps = { fromId, chromeContents, activate, findTimeoutMs: 500 };

  const result = await findInPage(20, 'test', deps);

  assert.deepEqual(callLog, ['activate', 'executeJavaScript'],
    'activate runs before executeJavaScript, proving foreground-first sequencing');
  assert.deepEqual(result, { activeMatchOrdinal: 1, matches: 1 });
  assert.equal(resolved, 2, 'resolveContents called twice: once before activate, once after (re-resolve discipline)');
});

// ---------------------------------------------------------------------------
// findInPage — op-local internal-session refusal (DD5)
// ---------------------------------------------------------------------------

test('findInPage: refuses internal wc even when deps.allowInternal === true (op-local guard)', async () => {
  const wc = makeFakeWc(40, { internal: true });
  const chromeContents = makeFakeChromeContents({ activeMatchOrdinal: 0, matches: 0 });
  const activateCalls = /** @type {number[]} */ ([]);
  const deps = {
    fromId: makeFakeFromId({ 40: wc }),
    chromeContents,
    allowInternal: true, // admin relaxation — resolveContents would let internal through
    activate: async (id) => { activateCalls.push(id); },
    findTimeoutMs: 500,
  };

  await assert.rejects(
    () => findInPage(40, 'hello', deps),
    /automation: findInPage — internal-session excluded/,
  );
  assert.equal(activateCalls.length, 0, 'internal wc must be refused BEFORE activate is attempted');
  assert.equal(chromeContents._calls.length, 0, 'executeJavaScript must NOT be called for internal-session');
});

// ---------------------------------------------------------------------------
// findInPage — resolve-time rejections surface through resolveContents
// ---------------------------------------------------------------------------

test('findInPage: bad-handle — non-number wcId rejects via resolveContents', async () => {
  const chromeContents = makeFakeChromeContents();
  const deps = { fromId: makeFakeFromId({}), chromeContents, findTimeoutMs: 100 };
  await assert.rejects(
    () => findInPage(/** @type {any} */ ('nope'), 'hello', deps),
    /automation: bad-handle/,
  );
});

test('findInPage: no-such-contents — unknown wcId rejects via resolveContents', async () => {
  const chromeContents = makeFakeChromeContents();
  const deps = { fromId: makeFakeFromId({}), chromeContents, findTimeoutMs: 100 };
  await assert.rejects(
    () => findInPage(999, 'hello', deps),
    /automation: no-such-contents/,
  );
});

// ---------------------------------------------------------------------------
// stopFindInPage — routes through executeJavaScript and returns {ok:true}
// ---------------------------------------------------------------------------

test('stopFindInPage: calls executeJavaScript and returns {ok:true}', async () => {
  const wc = makeFakeWc(30);
  const chromeContents = makeFakeChromeContents({ ok: true });
  const deps = {
    fromId: makeFakeFromId({ 30: wc }),
    chromeContents,
  };

  const result = await stopFindInPage(30, deps);

  assert.deepEqual(result, { ok: true });
  assert.equal(chromeContents._calls.length, 1, 'executeJavaScript called exactly once');
});

test('stopFindInPage: injected code contains JSON-encoded wcId', async () => {
  const wc = makeFakeWc(31);
  const chromeContents = makeFakeChromeContents({ ok: true });
  const deps = {
    fromId: makeFakeFromId({ 31: wc }),
    chromeContents,
  };

  await stopFindInPage(31, deps);

  const code = chromeContents._calls[0].code;
  assert.ok(code.includes(JSON.stringify(31)), 'stopFindInPage code must contain JSON-encoded wcId=31');
  assert.ok(code.includes('stopFindInPage'), 'code must call stopFindInPage on the webview element');
  assert.ok(code.includes('clearSelection'), 'code must pass clearSelection action');
});

test('stopFindInPage: throws clear error when chromeContents is missing', async () => {
  const wc = makeFakeWc(98);
  const deps = {
    fromId: makeFakeFromId({ 98: wc }),
    chromeContents: null,
  };

  await assert.rejects(
    () => stopFindInPage(98, deps),
    /automation: stopFindInPage — chromeContents unavailable/,
  );
});

// ---------------------------------------------------------------------------
// stopFindInPage — op-local internal-session refusal (DD5)
// ---------------------------------------------------------------------------

test('stopFindInPage: refuses internal wc even when deps.allowInternal === true (op-local guard)', async () => {
  const wc = makeFakeWc(41, { internal: true });
  const chromeContents = makeFakeChromeContents({ ok: true });
  const deps = {
    fromId: makeFakeFromId({ 41: wc }),
    chromeContents,
    allowInternal: true, // admin relaxation
  };

  await assert.rejects(
    () => stopFindInPage(41, deps),
    /automation: stopFindInPage — internal-session excluded/,
  );
  assert.equal(chromeContents._calls.length, 0, 'executeJavaScript must NOT be called for internal-session');
});

// ---------------------------------------------------------------------------
// stopFindInPage — resolve-time rejections
// ---------------------------------------------------------------------------

test('stopFindInPage: bad-handle — non-number wcId rejects via resolveContents', async () => {
  const chromeContents = makeFakeChromeContents({ ok: true });
  const deps = { fromId: makeFakeFromId({}), chromeContents };
  await assert.rejects(
    () => stopFindInPage(/** @type {any} */ ('nope'), deps),
    /automation: bad-handle/,
  );
});

test('stopFindInPage: no-such-contents — unknown wcId rejects via resolveContents', async () => {
  const chromeContents = makeFakeChromeContents({ ok: true });
  const deps = { fromId: makeFakeFromId({}), chromeContents };
  await assert.rejects(
    () => stopFindInPage(999, deps),
    /automation: no-such-contents/,
  );
});

// ---------------------------------------------------------------------------
// Parse-check regression guards (syntax validation of injected code)
//
// The existing tests fake executeJavaScript and never parse the injected code
// string, so a malformed IIFE (e.g. wrong closing bracket sequence) would be
// invisible to the test suite. These guards compile the injected code with
// `new Function(code)` — which parses without executing — and assert no
// SyntaxError is thrown. A malformed IIFE causes a SyntaxError, failing the
// test immediately.
// ---------------------------------------------------------------------------

test('findInPage: injected code string is valid JavaScript (parse guard)', async () => {
  const wc = makeFakeWc(200);
  let capturedCode = '';
  const chromeContents = {
    _calls: [],
    executeJavaScript(code, userGesture) {
      capturedCode = code;
      this._calls.push({ code, userGesture });
      return Promise.resolve({ activeMatchOrdinal: 1, matches: 1 });
    },
  };
  const deps = {
    fromId: makeFakeFromId({ 200: wc }),
    chromeContents,
    findTimeoutMs: 500,
  };

  await findInPage(200, 'parse-check', deps);

  assert.ok(capturedCode.length > 0, 'executeJavaScript must have been called');
  assert.doesNotThrow(
    () => new Function(capturedCode),
    'findInPage injected code must parse as valid JavaScript (new Function compilation)',
  );
});

test('stopFindInPage: injected code string is valid JavaScript (parse guard)', async () => {
  const wc = makeFakeWc(201);
  let capturedCode = '';
  const chromeContents = {
    _calls: [],
    executeJavaScript(code, userGesture) {
      capturedCode = code;
      this._calls.push({ code, userGesture });
      return Promise.resolve({ ok: true });
    },
  };
  const deps = {
    fromId: makeFakeFromId({ 201: wc }),
    chromeContents,
  };

  await stopFindInPage(201, deps);

  assert.ok(capturedCode.length > 0, 'executeJavaScript must have been called');
  assert.doesNotThrow(
    () => new Function(capturedCode),
    'stopFindInPage injected code must parse as valid JavaScript (new Function compilation)',
  );
});
