'use strict';

// Unit tests for src/main/automation/resolve.js
//
// Electron-free: the module does NOT require('electron') at the top, so these
// tests run under plain `node --test` with no Electron stub. Fake wc/session
// objects stand in for real Electron webContents and Session objects.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { isInternalContents, classifyContents, resolveContents } = require('../../src/main/automation/resolve');

// ---------------------------------------------------------------------------
// isInternalContents — predicate matrix
// ---------------------------------------------------------------------------

test('isInternalContents: session.__goldfinchInternal === true → true', () => {
  assert.equal(isInternalContents({ session: { __goldfinchInternal: true } }), true);
});

test('isInternalContents: session.__goldfinchInternal === false → false', () => {
  assert.equal(isInternalContents({ session: { __goldfinchInternal: false } }), false);
});

test('isInternalContents: session.__goldfinchInternal === 1 (truthy-but-not-true) → false (pins strict ===true)', () => {
  assert.equal(isInternalContents({ session: { __goldfinchInternal: 1 } }), false);
});

test('isInternalContents: missing session → false', () => {
  assert.equal(isInternalContents({ }), false);
});

test('isInternalContents: null wc → false', () => {
  assert.equal(isInternalContents(null), false);
});

test('isInternalContents: undefined wc → false', () => {
  assert.equal(isInternalContents(undefined), false);
});

test('isInternalContents: session.__goldfinchInternal === undefined → false', () => {
  assert.equal(isInternalContents({ session: {} }), false);
});

// ---------------------------------------------------------------------------
// classifyContents — identity comparison
// ---------------------------------------------------------------------------

test('classifyContents: wc === chromeContents → "chrome"', () => {
  const wc = { id: 1 };
  assert.equal(classifyContents(wc, wc), 'chrome');
});

test('classifyContents: wc !== chromeContents → "guest"', () => {
  const wc = { id: 1 };
  const chromeContents = { id: 2 };
  assert.equal(classifyContents(wc, chromeContents), 'guest');
});

test('classifyContents: null chromeContents injection → "guest" (engine glue injects live chrome; null never matches)', () => {
  const wc = { id: 1 };
  assert.equal(classifyContents(wc, null), 'guest');
});

// ---------------------------------------------------------------------------
// resolveContents — with fake fromId
// ---------------------------------------------------------------------------

/**
 * Build a minimal fake webContents for a web/guest context.
 */
function makeGuestWc(id) {
  return {
    id,
    session: { __goldfinchInternal: false },
    isDestroyed() { return false; }
  };
}

/**
 * Build a fake internal-session webContents (goldfinch://settings guest).
 */
function makeInternalWc(id) {
  return {
    id,
    session: { __goldfinchInternal: true },
    isDestroyed() { return false; }
  };
}

/**
 * Build a fake destroyed webContents.
 */
function makeDestroyedWc(id) {
  return {
    id,
    session: { __goldfinchInternal: false },
    isDestroyed() { return true; }
  };
}

test('resolveContents: valid guest wcId → returns the webContents', () => {
  const wc = makeGuestWc(10);
  const fromId = (id) => id === 10 ? wc : null;
  const result = resolveContents(10, { fromId, chromeContents: null });
  assert.equal(result, wc);
});

test('resolveContents: valid chrome wcId → returns the webContents (classifyContents can then identify it)', () => {
  const chromeContents = { id: 1, session: { __goldfinchInternal: false }, isDestroyed() { return false; } };
  const fromId = (id) => id === 1 ? chromeContents : null;
  const result = resolveContents(1, { fromId, chromeContents });
  assert.equal(result, chromeContents);
  // Verify classifier identifies it correctly
  assert.equal(classifyContents(result, chromeContents), 'chrome');
});

test('resolveContents: internal-session wcId (direct supply) → throws internal-session (DD5 bypass-path guard)', () => {
  // This is the load-bearing security test: a directly-supplied internal-guest
  // wcId must be rejected at resolve-time, not merely filtered from enumerate.
  const internalWc = makeInternalWc(99);
  const fromId = (id) => id === 99 ? internalWc : null;
  assert.throws(
    () => resolveContents(99, { fromId, chromeContents: null }),
    (err) => err instanceof Error && err.message.includes('automation: internal-session')
  );
});

test('resolveContents: fromId returns null → throws no-such-contents', () => {
  const fromId = () => null;
  assert.throws(
    () => resolveContents(42, { fromId, chromeContents: null }),
    (err) => err instanceof Error && err.message.includes('automation: no-such-contents')
  );
});

test('resolveContents: fromId returns undefined → throws no-such-contents', () => {
  const fromId = () => undefined;
  assert.throws(
    () => resolveContents(42, { fromId, chromeContents: null }),
    (err) => err instanceof Error && err.message.includes('automation: no-such-contents')
  );
});

test('resolveContents: non-number wcId (string) → throws bad-handle', () => {
  const fromId = () => null;
  assert.throws(
    // @ts-expect-error — intentionally passing wrong type
    () => resolveContents('10', { fromId, chromeContents: null }),
    (err) => err instanceof Error && err.message.includes('automation: bad-handle')
  );
});

test('resolveContents: non-number wcId (null) → throws bad-handle', () => {
  const fromId = () => null;
  assert.throws(
    // @ts-expect-error — intentionally passing wrong type
    () => resolveContents(null, { fromId, chromeContents: null }),
    (err) => err instanceof Error && err.message.includes('automation: bad-handle')
  );
});

test('resolveContents: destroyed webContents → throws no-such-contents', () => {
  // A resolved-but-destroyed contents is treated as gone (AC6, edge cases).
  const destroyedWc = makeDestroyedWc(55);
  const fromId = (id) => id === 55 ? destroyedWc : null;
  assert.throws(
    () => resolveContents(55, { fromId, chromeContents: null }),
    (err) => err instanceof Error && err.message.includes('automation: no-such-contents')
  );
});

test('resolveContents: error messages are distinguishable per guard', () => {
  // Pins AC4: three distinct prefixes so callers can identify which guard fired.
  const internalWc = makeInternalWc(1);
  const guestWc = makeGuestWc(2);

  let badHandleMsg, noSuchMsg, internalSessionMsg;

  try {
    // @ts-expect-error — intentionally passing wrong type
    resolveContents('x', { fromId: () => null, chromeContents: null });
  } catch (e) { badHandleMsg = e.message; }

  try {
    resolveContents(2, { fromId: () => null, chromeContents: null });
  } catch (e) { noSuchMsg = e.message; }

  try {
    resolveContents(1, { fromId: (id) => id === 1 ? internalWc : null, chromeContents: guestWc });
  } catch (e) { internalSessionMsg = e.message; }

  assert.ok(badHandleMsg.includes('bad-handle'), 'bad-handle path must say bad-handle');
  assert.ok(noSuchMsg.includes('no-such-contents'), 'no-such path must say no-such-contents');
  assert.ok(internalSessionMsg.includes('internal-session'), 'internal path must say internal-session');

  // All three must be distinct messages
  assert.notEqual(badHandleMsg, noSuchMsg);
  assert.notEqual(noSuchMsg, internalSessionMsg);
  assert.notEqual(badHandleMsg, internalSessionMsg);
});
