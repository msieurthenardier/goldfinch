'use strict';

// Unit tests for src/main/automation/find.js (the automation findInPage /
// stopFindInPage ops).
//
// ARCHITECTURE NOTE (main-process found-in-page model):
// Guests are now WebContentsViews whose webContents emit found-in-page to
// main (proven in production since Flight 3). This module's tests model THAT
// architecture — the ops call wc.findInPage() directly and listen for
// found-in-page on the guest wc, correlating on the requestId returned by
// wc.findInPage(). No chromeContents injection or executeJavaScript is needed.
//
// Test strategy:
//   - makeFakeWc() returns a fake guest wc backed by node:events EventEmitter,
//     with findInPage/stopFindInPage methods that record calls and increment a
//     requestId counter so each call gets a distinct id.
//   - emitFound(wc, result) is a helper that emits a found-in-page event on
//     the fake wc with the given result payload.
//   - For timeout/retry tests: use a small findTimeoutMs so the Promise settles
//     quickly without real clock time; or use t.mock.timers for deterministic
//     control.
//
// Covers:
//   - findInPage resolves correlated counts on a matching-requestId final event
//   - ignores a foreign requestId; resolves on the matching one
//   - cold-start: finalUpdate:true,matches:0 does not resolve; re-issue happens;
//     a later matches>0 event resolves the real count
//   - timeout fallback resolves `last` when no qualifying event arrives
//   - listener cleanup: removeListener called on both resolve and timeout
//   - opts threading: wc._finds[0].opts deep-equals {forward,findNext,matchCase}
//   - internal-session refusal for both ops under allowInternal:true (before activate)
//   - foreground-first activate-before-find + double re-resolve (resolved===2)
//   - bad-handle / no-such-contents via resolveContents
//   - stopFindInPage calls wc.stopFindInPage('clearSelection') and returns {ok:true}
//   - MAX-retry exhaustion resolves `last` without waiting for timeout
//   - concurrent-find listener hygiene: exactly one found-in-page listener during find

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const { findInPage, stopFindInPage } = require('../../src/main/automation/find');

// ---------------------------------------------------------------------------
// Fake helpers
// ---------------------------------------------------------------------------

/**
 * Build a fake guest wc backed by EventEmitter with findInPage/stopFindInPage
 * methods that record calls.
 *
 * @param {number} id
 * @param {{ internal?: boolean }} [opts]
 */
function makeFakeWc(id, { internal = false } = {}) {
  const ee = new EventEmitter();
  ee.setMaxListeners(50); // prevent spurious MaxListenersExceededWarning in tests
  const wc = Object.assign(ee, {
    id,
    session: { __goldfinchInternal: internal },
    isDestroyed() { return false; },
    _finds: /** @type {Array<{text: string, opts: object}>} */ ([]),
    _stops: /** @type {string[]} */ ([]),
    _reqId: 0,
    /** @param {string} text @param {object} opts @returns {number} */
    findInPage(text, opts) {
      this._finds.push({ text, opts });
      return ++this._reqId;
    },
    /** @param {string} action */
    stopFindInPage(action) {
      this._stops.push(action);
    },
  });
  return wc;
}

/**
 * Emit a found-in-page event on a fake wc with a chosen result payload.
 *
 * @param {ReturnType<typeof makeFakeWc>} wc
 * @param {{ requestId: number, activeMatchOrdinal?: number, matches?: number, finalUpdate?: boolean }} result
 */
function emitFound(wc, result) {
  wc.emit('found-in-page', {}, {
    requestId: result.requestId,
    activeMatchOrdinal: result.activeMatchOrdinal ?? 0,
    matches: result.matches ?? 0,
    finalUpdate: result.finalUpdate ?? false,
  });
}

/** Build a fake fromId lookup backed by a map of id → fake wc. */
function makeFakeFromId(map) {
  return (/** @type {number} */ id) => map[id] ?? null;
}

// ---------------------------------------------------------------------------
// findInPage — resolves correlated counts on a matching-requestId final event
// ---------------------------------------------------------------------------

test('findInPage: resolves activeMatchOrdinal and matches from a matching-requestId finalUpdate event', async () => {
  const wc = makeFakeWc(1);
  const deps = {
    fromId: makeFakeFromId({ 1: wc }),
    findTimeoutMs: 3000,
  };

  // After findInPage is called it will attach a found-in-page listener and call
  // wc.findInPage() (requestId=1). We emit the event asynchronously.
  setImmediate(() => {
    emitFound(wc, { requestId: 1, activeMatchOrdinal: 2, matches: 5, finalUpdate: true });
  });

  const result = await findInPage(1, 'hello', deps);
  assert.deepEqual(result, { activeMatchOrdinal: 2, matches: 5 });
  assert.equal(wc._finds.length, 1, 'findInPage called exactly once');
  assert.equal(wc._finds[0].text, 'hello');
});

test('findInPage: zero-matches result returned cleanly (not an error)', async () => {
  const wc = makeFakeWc(2);
  const deps = {
    fromId: makeFakeFromId({ 2: wc }),
    findTimeoutMs: 100, // short timeout — no matching event, resolves last={0,0}
  };

  const result = await findInPage(2, 'missing', deps);
  assert.deepEqual(result, { activeMatchOrdinal: 0, matches: 0 });
});

// ---------------------------------------------------------------------------
// findInPage — ignores a foreign requestId; resolves on the matching one
// ---------------------------------------------------------------------------

test('findInPage: ignores found-in-page event with a foreign requestId', async () => {
  const wc = makeFakeWc(3);
  const deps = {
    fromId: makeFakeFromId({ 3: wc }),
    findTimeoutMs: 3000,
  };

  setImmediate(() => {
    // First emit a foreign requestId — must be ignored
    emitFound(wc, { requestId: 999, activeMatchOrdinal: 9, matches: 9, finalUpdate: true });
    // Then emit the real one (requestId=1 from the first issue)
    emitFound(wc, { requestId: 1, activeMatchOrdinal: 2, matches: 4, finalUpdate: true });
  });

  const result = await findInPage(3, 'term', deps);
  assert.deepEqual(result, { activeMatchOrdinal: 2, matches: 4 },
    'must resolve from the matching requestId, not the foreign one');
});

test('findInPage: exactly one found-in-page listener during a find (listener hygiene)', async () => {
  const wc = makeFakeWc(4);
  let listenerCountDuringFind = 0;
  const deps = {
    fromId: makeFakeFromId({ 4: wc }),
    findTimeoutMs: 3000,
  };

  setImmediate(() => {
    listenerCountDuringFind = wc.listenerCount('found-in-page');
    emitFound(wc, { requestId: 1, activeMatchOrdinal: 1, matches: 2, finalUpdate: true });
  });

  await findInPage(4, 'term', deps);
  assert.equal(listenerCountDuringFind, 1, 'exactly one found-in-page listener must be attached during the find');
});

// ---------------------------------------------------------------------------
// findInPage — cold-start: finalUpdate:true,matches:0 does not resolve;
//   re-issue happens; a later matches>0 event resolves the real count
// ---------------------------------------------------------------------------

test('findInPage: cold-start — finalUpdate:true,matches:0 does not resolve; re-issue happens; matches>0 resolves', async () => {
  const wc = makeFakeWc(5);
  const deps = {
    fromId: makeFakeFromId({ 5: wc }),
    findTimeoutMs: 3000,
  };

  // Step 1: emit spurious cold-start event for requestId=1 (finalUpdate:true, matches:0)
  // Step 2: after a tick (the retry interval fires), emit a real event for requestId=2
  setImmediate(() => {
    // Spurious cold-start event — must NOT resolve
    emitFound(wc, { requestId: 1, activeMatchOrdinal: 0, matches: 0, finalUpdate: true });
  });

  // Wait for the retry to fire and issue a second find (requestId=2), then resolve it
  // We use a small delay to ensure the retry interval (500ms) has fired
  const p = findInPage(5, 'word', deps);
  await new Promise(r => setImmediate(r)); // let the spurious event fire

  // At this point wc._finds.length should still be 1 (not yet retried)
  // We poll briefly for the retry to fire
  await new Promise(r => setTimeout(r, 520)); // just over RETRY=500ms
  assert.ok(wc._finds.length >= 2, 'a re-issue must happen after the cold-start spurious event');

  // Emit the real result for the re-issue (requestId=2)
  emitFound(wc, { requestId: 2, activeMatchOrdinal: 1, matches: 3, finalUpdate: true });

  const result = await p;
  assert.deepEqual(result, { activeMatchOrdinal: 1, matches: 3 },
    'must resolve the real count from the re-issued find');
});

// ---------------------------------------------------------------------------
// findInPage — timeout fallback resolves `last`
// ---------------------------------------------------------------------------

test('findInPage: timeout fallback — resolves last when no qualifying event arrives', async () => {
  const wc = makeFakeWc(6);
  const deps = {
    fromId: makeFakeFromId({ 6: wc }),
    findTimeoutMs: 100, // very short timeout
  };

  // No event emitted — timeout fires, resolves last={0,0}
  const result = await findInPage(6, 'ghost', deps);
  assert.deepEqual(result, { activeMatchOrdinal: 0, matches: 0 },
    'timeout fallback must resolve {0,0} for a genuine no-match');
});

test('findInPage: timeout fallback resolves last nonzero count if a non-final event arrived first', async () => {
  const wc = makeFakeWc(7);
  const deps = {
    fromId: makeFakeFromId({ 7: wc }),
    findTimeoutMs: 100,
  };

  // Emit a non-finalUpdate event to update `last`, then let timeout fire
  setImmediate(() => {
    emitFound(wc, { requestId: 1, activeMatchOrdinal: 1, matches: 2, finalUpdate: false });
  });

  const result = await findInPage(7, 'partial', deps);
  // last was updated to {1,2} but not resolved (finalUpdate:false), timeout resolves last
  assert.deepEqual(result, { activeMatchOrdinal: 1, matches: 2 });
});

// ---------------------------------------------------------------------------
// findInPage — listener cleanup after resolve and after timeout
// ---------------------------------------------------------------------------

test('findInPage: listener cleanup after resolve — listenerCount is 0', async () => {
  const wc = makeFakeWc(8);
  const deps = {
    fromId: makeFakeFromId({ 8: wc }),
    findTimeoutMs: 3000,
  };

  setImmediate(() => {
    emitFound(wc, { requestId: 1, activeMatchOrdinal: 1, matches: 1, finalUpdate: true });
  });

  await findInPage(8, 'clean', deps);
  assert.equal(wc.listenerCount('found-in-page'), 0,
    'found-in-page listener must be removed after resolve');
});

test('findInPage: listener cleanup after timeout — listenerCount is 0', async () => {
  const wc = makeFakeWc(9);
  const deps = {
    fromId: makeFakeFromId({ 9: wc }),
    findTimeoutMs: 80,
  };

  await findInPage(9, 'timed-out', deps);
  assert.equal(wc.listenerCount('found-in-page'), 0,
    'found-in-page listener must be removed after timeout');
});

// ---------------------------------------------------------------------------
// findInPage — opts threading
// ---------------------------------------------------------------------------

test('findInPage: default options threaded to wc.findInPage (forward:true, findNext:false, matchCase:false)', async () => {
  const wc = makeFakeWc(10);
  const deps = {
    fromId: makeFakeFromId({ 10: wc }),
    findTimeoutMs: 3000,
  };

  setImmediate(() => {
    emitFound(wc, { requestId: 1, activeMatchOrdinal: 1, matches: 1, finalUpdate: true });
  });

  await findInPage(10, 'hello', deps);
  assert.deepEqual(wc._finds[0].opts, { forward: true, findNext: false, matchCase: false });
});

test('findInPage: findNext:true, forward:true threaded to wc.findInPage', async () => {
  const wc = makeFakeWc(11);
  const deps = {
    fromId: makeFakeFromId({ 11: wc }),
    findTimeoutMs: 3000,
  };

  setImmediate(() => {
    emitFound(wc, { requestId: 1, activeMatchOrdinal: 2, matches: 5, finalUpdate: true });
  });

  await findInPage(11, 'term', deps, { findNext: true, forward: true });
  assert.deepEqual(wc._finds[0].opts, { forward: true, findNext: true, matchCase: false });
});

test('findInPage: findNext:true, forward:false threaded to wc.findInPage', async () => {
  const wc = makeFakeWc(12);
  const deps = {
    fromId: makeFakeFromId({ 12: wc }),
    findTimeoutMs: 3000,
  };

  setImmediate(() => {
    emitFound(wc, { requestId: 1, activeMatchOrdinal: 1, matches: 5, finalUpdate: true });
  });

  await findInPage(12, 'term', deps, { findNext: true, forward: false });
  assert.deepEqual(wc._finds[0].opts, { forward: false, findNext: true, matchCase: false });
});

test('findInPage: matchCase:true threaded to wc.findInPage', async () => {
  const wc = makeFakeWc(13);
  const deps = {
    fromId: makeFakeFromId({ 13: wc }),
    findTimeoutMs: 3000,
  };

  setImmediate(() => {
    emitFound(wc, { requestId: 1, activeMatchOrdinal: 1, matches: 1, finalUpdate: true });
  });

  await findInPage(13, 'Hello', deps, { matchCase: true });
  assert.deepEqual(wc._finds[0].opts, { forward: true, findNext: false, matchCase: true });
});

// ---------------------------------------------------------------------------
// findInPage — MAX-retry exhaustion resolves last without waiting for timeout
// ---------------------------------------------------------------------------

test('findInPage: MAX-retry exhaustion resolves last immediately without waiting for timeout', async () => {
  const wc = makeFakeWc(50);
  // Long timeout so we know resolution came from MAX exhaustion, not timeout
  const deps = {
    fromId: makeFakeFromId({ 50: wc }),
    findTimeoutMs: 10000,
  };

  // We send cold-start spurious events for each retry requestId so the op keeps
  // re-issuing. After MAX=5 retries, the interval's `attempts >= MAX` branch
  // fires finish(last) before the timeout.
  const p = findInPage(50, 'retry-exhaust', deps);

  // Poll: emit spurious cold-start events for each issued requestId so the
  // listener records them (updates last) but doesn't resolve (matches===0).
  // The interval fires at 500ms cadence; we emit one spurious event per requestId.
  const pollInterval = setInterval(() => {
    for (let i = 1; i <= wc._reqId; i++) {
      emitFound(wc, { requestId: i, activeMatchOrdinal: 0, matches: 0, finalUpdate: true });
    }
  }, 100);

  const result = await p;
  clearInterval(pollInterval);

  assert.deepEqual(result, { activeMatchOrdinal: 0, matches: 0 });
  assert.ok(wc._finds.length >= 5, `expected ≥5 issues (MAX retries), got ${wc._finds.length}`);
});

// ---------------------------------------------------------------------------
// findInPage — retry uses same opts (no findNext:true on retry)
// ---------------------------------------------------------------------------

test('findInPage: retry issues use same caller opts — no findNext:true corruption', async () => {
  const wc = makeFakeWc(51);
  const deps = {
    fromId: makeFakeFromId({ 51: wc }),
    findTimeoutMs: 3000,
  };

  // Emit two cold-start spurious events (req 1 and 2) then a real one (req 3)
  let tick = 0;
  const iv = setInterval(() => {
    tick++;
    if (tick === 1) {
      emitFound(wc, { requestId: 1, activeMatchOrdinal: 0, matches: 0, finalUpdate: true });
    } else if (tick === 2) {
      emitFound(wc, { requestId: 2, activeMatchOrdinal: 0, matches: 0, finalUpdate: true });
    } else if (tick >= 3 && wc._finds.length >= 3) {
      emitFound(wc, { requestId: 3, activeMatchOrdinal: 1, matches: 2, finalUpdate: true });
      clearInterval(iv);
    }
  }, 520);

  const result = await findInPage(51, 'retry-opts', deps, { forward: false, findNext: false, matchCase: true });

  // All issues must use the original opts (not findNext:true)
  for (const call of wc._finds) {
    assert.deepEqual(call.opts, { forward: false, findNext: false, matchCase: true },
      'retry must not corrupt opts by flipping findNext:true');
  }
  assert.deepEqual(result, { activeMatchOrdinal: 1, matches: 2 });
});

// ---------------------------------------------------------------------------
// findInPage — op-local internal-session refusal (DD5)
// ---------------------------------------------------------------------------

test('findInPage: refuses internal wc even when deps.allowInternal === true (op-local guard)', async () => {
  const wc = makeFakeWc(40, { internal: true });
  const activateCalls = /** @type {number[]} */ ([]);
  const deps = {
    fromId: makeFakeFromId({ 40: wc }),
    allowInternal: true, // admin relaxation — resolveContents would let internal through
    activate: async (id) => { activateCalls.push(id); },
    findTimeoutMs: 500,
  };

  await assert.rejects(
    () => findInPage(40, 'hello', deps),
    /automation: findInPage — internal-session excluded/,
  );
  assert.equal(activateCalls.length, 0, 'internal wc must be refused BEFORE activate is attempted');
  assert.equal(wc._finds.length, 0, 'wc.findInPage must NOT be called for internal-session');
});

// ---------------------------------------------------------------------------
// findInPage — foreground-first (guest activate + re-resolve)
// ---------------------------------------------------------------------------

test('findInPage: guest tab — activate called before wc.findInPage; re-resolved handle used (resolved===2)', async () => {
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

  const deps = { fromId, chromeContents: null, activate, findTimeoutMs: 3000 };

  // postWc is what the op uses after re-resolve — emit found-in-page on postWc
  setImmediate(() => {
    callLog.push('findInPage-issued');
    emitFound(postWc, { requestId: 1, activeMatchOrdinal: 1, matches: 1, finalUpdate: true });
  });

  const result = await findInPage(20, 'test', deps);

  assert.ok(callLog.indexOf('activate') < callLog.indexOf('findInPage-issued'),
    'activate runs before wc.findInPage is issued');
  assert.deepEqual(result, { activeMatchOrdinal: 1, matches: 1 });
  assert.equal(resolved, 2, 'resolveContents called twice: once before activate, once after (re-resolve discipline)');
  assert.equal(postWc._finds.length, 1, 'find must be issued on the post-activate re-resolved wc');
  assert.equal(preWc._finds.length, 0, 'find must NOT be issued on the stale pre-activate wc');
});

// ---------------------------------------------------------------------------
// findInPage — resolve-time rejections surface through resolveContents
// ---------------------------------------------------------------------------

test('findInPage: bad-handle — non-number wcId rejects via resolveContents', async () => {
  const deps = { fromId: makeFakeFromId({}), findTimeoutMs: 100 };
  await assert.rejects(
    () => findInPage(/** @type {any} */ ('nope'), 'hello', deps),
    /automation: bad-handle/,
  );
});

test('findInPage: no-such-contents — unknown wcId rejects via resolveContents', async () => {
  const deps = { fromId: makeFakeFromId({}), findTimeoutMs: 100 };
  await assert.rejects(
    () => findInPage(999, 'hello', deps),
    /automation: no-such-contents/,
  );
});

// ---------------------------------------------------------------------------
// stopFindInPage — calls wc.stopFindInPage('clearSelection') and returns {ok:true}
// ---------------------------------------------------------------------------

test('stopFindInPage: calls wc.stopFindInPage with clearSelection and returns {ok:true}', async () => {
  const wc = makeFakeWc(30);
  const deps = {
    fromId: makeFakeFromId({ 30: wc }),
  };

  const result = await stopFindInPage(30, deps);

  assert.deepEqual(result, { ok: true });
  assert.equal(wc._stops.length, 1, 'wc.stopFindInPage called exactly once');
  assert.equal(wc._stops[0], 'clearSelection', 'must pass clearSelection action');
});

// ---------------------------------------------------------------------------
// stopFindInPage — op-local internal-session refusal (DD5)
// ---------------------------------------------------------------------------

test('stopFindInPage: refuses internal wc even when deps.allowInternal === true (op-local guard)', async () => {
  const wc = makeFakeWc(41, { internal: true });
  const deps = {
    fromId: makeFakeFromId({ 41: wc }),
    allowInternal: true, // admin relaxation
  };

  await assert.rejects(
    () => stopFindInPage(41, deps),
    /automation: stopFindInPage — internal-session excluded/,
  );
  assert.equal(wc._stops.length, 0, 'wc.stopFindInPage must NOT be called for internal-session');
});

// ---------------------------------------------------------------------------
// stopFindInPage — resolve-time rejections
// ---------------------------------------------------------------------------

test('stopFindInPage: bad-handle — non-number wcId rejects via resolveContents', async () => {
  const deps = { fromId: makeFakeFromId({}) };
  await assert.rejects(
    () => stopFindInPage(/** @type {any} */ ('nope'), deps),
    /automation: bad-handle/,
  );
});

test('stopFindInPage: no-such-contents — unknown wcId rejects via resolveContents', async () => {
  const deps = { fromId: makeFakeFromId({}) };
  await assert.rejects(
    () => stopFindInPage(999, deps),
    /automation: no-such-contents/,
  );
});
