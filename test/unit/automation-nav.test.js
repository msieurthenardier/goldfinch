'use strict';

// Unit tests for src/main/automation/nav.js
//
// Electron-free: nav.js does NOT require('electron') at the top, and resolveContents
// (which it delegates to) is also Electron-free. These tests run under plain
// `node --test` with no Electron stub. Fake wc/session objects stand in for real
// Electron webContents and Session objects.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { navigate, goBack, goForward, reload } = require('../../src/main/automation/nav');

// ---------------------------------------------------------------------------
// Fake webContents helpers — mirrors automation-resolve.test.js style
// ---------------------------------------------------------------------------

/**
 * Build a minimal fake webContents for a web/guest context.
 * loadURL records calls and returns a resolved promise.
 */
function makeGuestWc(id) {
  return {
    id,
    session: { __goldfinchInternal: false },
    isDestroyed() { return false; },
    loadURLCalls: [],
    loadURL(url) {
      this.loadURLCalls.push(url);
      return Promise.resolve();
    },
    goBackCalled: false,
    goBack() { this.goBackCalled = true; },
    goForwardCalled: false,
    goForward() { this.goForwardCalled = true; },
    reloadCalled: false,
    reload() { this.reloadCalled = true; }
  };
}

/**
 * Build a fake internal-session webContents (goldfinch://settings guest).
 */
function makeInternalWc(id) {
  return {
    id,
    session: { __goldfinchInternal: true },
    isDestroyed() { return false; },
    loadURLCalls: [],
    loadURL(url) {
      this.loadURLCalls.push(url);
      return Promise.resolve();
    }
  };
}

/**
 * Build a fake destroyed webContents.
 */
function makeDestroyedWc(id) {
  return {
    id,
    session: { __goldfinchInternal: false },
    isDestroyed() { return true; },
    loadURLCalls: [],
    loadURL(url) {
      this.loadURLCalls.push(url);
      return Promise.resolve();
    }
  };
}

// ---------------------------------------------------------------------------
// navigate — URL safety gate (DD6, AC1)
// ---------------------------------------------------------------------------

test('navigate: safe http URL → loadURL called with exact URL', async () => {
  const wc = makeGuestWc(10);
  const deps = { fromId: (id) => id === 10 ? wc : null, chromeContents: null };
  await navigate(10, 'https://example.com', deps);
  assert.equal(wc.loadURLCalls.length, 1);
  assert.equal(wc.loadURLCalls[0], 'https://example.com');
});

test('navigate: about:blank → loadURL called (valid target)', async () => {
  const wc = makeGuestWc(10);
  const deps = { fromId: (id) => id === 10 ? wc : null, chromeContents: null };
  await navigate(10, 'about:blank', deps);
  assert.equal(wc.loadURLCalls.length, 1);
  assert.equal(wc.loadURLCalls[0], 'about:blank');
});

test('navigate: goldfinch://settings → throws bad-url, loadURL NOT called', async () => {
  const wc = makeGuestWc(10);
  const deps = { fromId: (id) => id === 10 ? wc : null, chromeContents: null };
  await assert.rejects(
    () => navigate(10, 'goldfinch://settings', deps),
    (err) => err instanceof Error && err.message.includes('automation: bad-url')
  );
  assert.equal(wc.loadURLCalls.length, 0, 'loadURL must NOT be called for bad-url');
});

test('navigate: file: URL → throws bad-url, loadURL NOT called', async () => {
  const wc = makeGuestWc(10);
  const deps = { fromId: (id) => id === 10 ? wc : null, chromeContents: null };
  await assert.rejects(
    () => navigate(10, 'file:///etc/passwd', deps),
    (err) => err instanceof Error && err.message.includes('automation: bad-url')
  );
  assert.equal(wc.loadURLCalls.length, 0);
});

test('navigate: data: URL → throws bad-url, loadURL NOT called', async () => {
  const wc = makeGuestWc(10);
  const deps = { fromId: (id) => id === 10 ? wc : null, chromeContents: null };
  await assert.rejects(
    () => navigate(10, 'data:text/html,<h1>hi</h1>', deps),
    (err) => err instanceof Error && err.message.includes('automation: bad-url')
  );
  assert.equal(wc.loadURLCalls.length, 0);
});

test('navigate: javascript: URL → throws bad-url, loadURL NOT called', async () => {
  const wc = makeGuestWc(10);
  const deps = { fromId: (id) => id === 10 ? wc : null, chromeContents: null };
  await assert.rejects(
    () => navigate(10, 'javascript:alert(1)', deps),
    (err) => err instanceof Error && err.message.includes('automation: bad-url')
  );
  assert.equal(wc.loadURLCalls.length, 0);
});

test('navigate: non-string (number) → throws bad-url, loadURL NOT called', async () => {
  const wc = makeGuestWc(10);
  const deps = { fromId: (id) => id === 10 ? wc : null, chromeContents: null };
  await assert.rejects(
    // @ts-expect-error — intentionally passing wrong type
    () => navigate(10, 42, deps),
    (err) => err instanceof Error && err.message.includes('automation: bad-url')
  );
  assert.equal(wc.loadURLCalls.length, 0);
});

test('navigate: non-string (null) → throws bad-url, loadURL NOT called', async () => {
  const wc = makeGuestWc(10);
  const deps = { fromId: (id) => id === 10 ? wc : null, chromeContents: null };
  await assert.rejects(
    // @ts-expect-error — intentionally passing wrong type
    () => navigate(10, null, deps),
    (err) => err instanceof Error && err.message.includes('automation: bad-url')
  );
  assert.equal(wc.loadURLCalls.length, 0);
});

test('navigate: non-string (undefined) → throws bad-url, loadURL NOT called', async () => {
  const wc = makeGuestWc(10);
  const deps = { fromId: (id) => id === 10 ? wc : null, chromeContents: null };
  await assert.rejects(
    // @ts-expect-error — intentionally passing wrong type
    () => navigate(10, undefined, deps),
    (err) => err instanceof Error && err.message.includes('automation: bad-url')
  );
  assert.equal(wc.loadURLCalls.length, 0);
});

// ---------------------------------------------------------------------------
// navigate — URL gate fires BEFORE resolve (AC1 ordering guarantee)
// ---------------------------------------------------------------------------

test('navigate: unsafe URL + invalid wcId → bad-url error (URL gate fires first)', async () => {
  // fromId returns null for any id — but the bad-url gate should fire before resolve
  const deps = { fromId: () => null, chromeContents: null };
  await assert.rejects(
    () => navigate(999, 'goldfinch://settings', deps),
    (err) => err instanceof Error && err.message.includes('automation: bad-url')
  );
});

// ---------------------------------------------------------------------------
// navigate — resolveContents guard (AC2, DD5)
// ---------------------------------------------------------------------------

test('navigate: internal-session wcId with safe URL → throws internal-session, loadURL NOT called', async () => {
  const internalWc = makeInternalWc(99);
  const deps = { fromId: (id) => id === 99 ? internalWc : null, chromeContents: null };
  // URL is safe, passes the gate; resolve guard fires
  await assert.rejects(
    () => navigate(99, 'https://example.com', deps),
    (err) => err instanceof Error && err.message.includes('automation: internal-session')
  );
  assert.equal(internalWc.loadURLCalls.length, 0, 'loadURL must NOT be called for internal-session wcId');
});

test('navigate: bad wcId (fromId returns null) → throws no-such-contents', async () => {
  const deps = { fromId: () => null, chromeContents: null };
  await assert.rejects(
    () => navigate(42, 'https://example.com', deps),
    (err) => err instanceof Error && err.message.includes('automation: no-such-contents')
  );
});

test('navigate: destroyed wcId → throws no-such-contents', async () => {
  const destroyedWc = makeDestroyedWc(55);
  const deps = { fromId: (id) => id === 55 ? destroyedWc : null, chromeContents: null };
  await assert.rejects(
    () => navigate(55, 'https://example.com', deps),
    (err) => err instanceof Error && err.message.includes('automation: no-such-contents')
  );
  assert.equal(destroyedWc.loadURLCalls.length, 0);
});

// ---------------------------------------------------------------------------
// goBack — AC3
// ---------------------------------------------------------------------------

test('goBack: valid guest wcId → wc.goBack() called once', () => {
  const wc = makeGuestWc(10);
  const deps = { fromId: (id) => id === 10 ? wc : null, chromeContents: null };
  goBack(10, deps);
  assert.equal(wc.goBackCalled, true);
});

test('goBack: internal-session wcId → throws internal-session (no navigation side effect)', () => {
  const internalWc = makeInternalWc(99);
  const deps = { fromId: (id) => id === 99 ? internalWc : null, chromeContents: null };
  assert.throws(
    () => goBack(99, deps),
    (err) => err instanceof Error && err.message.includes('automation: internal-session')
  );
});

test('goBack: bad wcId → throws no-such-contents', () => {
  const deps = { fromId: () => null, chromeContents: null };
  assert.throws(
    () => goBack(42, deps),
    (err) => err instanceof Error && err.message.includes('automation: no-such-contents')
  );
});

test('goBack: destroyed wcId → throws no-such-contents', () => {
  const destroyedWc = makeDestroyedWc(55);
  const deps = { fromId: (id) => id === 55 ? destroyedWc : null, chromeContents: null };
  assert.throws(
    () => goBack(55, deps),
    (err) => err instanceof Error && err.message.includes('automation: no-such-contents')
  );
});

// ---------------------------------------------------------------------------
// goForward — AC3
// ---------------------------------------------------------------------------

test('goForward: valid guest wcId → wc.goForward() called once', () => {
  const wc = makeGuestWc(10);
  const deps = { fromId: (id) => id === 10 ? wc : null, chromeContents: null };
  goForward(10, deps);
  assert.equal(wc.goForwardCalled, true);
});

test('goForward: internal-session wcId → throws internal-session', () => {
  const internalWc = makeInternalWc(99);
  const deps = { fromId: (id) => id === 99 ? internalWc : null, chromeContents: null };
  assert.throws(
    () => goForward(99, deps),
    (err) => err instanceof Error && err.message.includes('automation: internal-session')
  );
});

test('goForward: bad wcId → throws no-such-contents', () => {
  const deps = { fromId: () => null, chromeContents: null };
  assert.throws(
    () => goForward(42, deps),
    (err) => err instanceof Error && err.message.includes('automation: no-such-contents')
  );
});

test('goForward: destroyed wcId → throws no-such-contents', () => {
  const destroyedWc = makeDestroyedWc(55);
  const deps = { fromId: (id) => id === 55 ? destroyedWc : null, chromeContents: null };
  assert.throws(
    () => goForward(55, deps),
    (err) => err instanceof Error && err.message.includes('automation: no-such-contents')
  );
});

// ---------------------------------------------------------------------------
// reload — AC3
// ---------------------------------------------------------------------------

test('reload: valid guest wcId → wc.reload() called once', () => {
  const wc = makeGuestWc(10);
  const deps = { fromId: (id) => id === 10 ? wc : null, chromeContents: null };
  reload(10, deps);
  assert.equal(wc.reloadCalled, true);
});

test('reload: internal-session wcId → throws internal-session', () => {
  const internalWc = makeInternalWc(99);
  const deps = { fromId: (id) => id === 99 ? internalWc : null, chromeContents: null };
  assert.throws(
    () => reload(99, deps),
    (err) => err instanceof Error && err.message.includes('automation: internal-session')
  );
});

test('reload: bad wcId → throws no-such-contents', () => {
  const deps = { fromId: () => null, chromeContents: null };
  assert.throws(
    () => reload(42, deps),
    (err) => err instanceof Error && err.message.includes('automation: no-such-contents')
  );
});

test('reload: destroyed wcId → throws no-such-contents', () => {
  const destroyedWc = makeDestroyedWc(55);
  const deps = { fromId: (id) => id === 55 ? destroyedWc : null, chromeContents: null };
  assert.throws(
    () => reload(55, deps),
    (err) => err instanceof Error && err.message.includes('automation: no-such-contents')
  );
});

// ---------------------------------------------------------------------------
// dispatch correctness — each function calls the right wc method (AC3)
// ---------------------------------------------------------------------------

test('goBack/goForward/reload each call the correct wc method and not the others', () => {
  const wc = makeGuestWc(10);
  const deps = { fromId: (id) => id === 10 ? wc : null, chromeContents: null };

  goBack(10, deps);
  assert.equal(wc.goBackCalled, true, 'goBack must call wc.goBack');
  assert.equal(wc.goForwardCalled, false, 'goBack must NOT call wc.goForward');
  assert.equal(wc.reloadCalled, false, 'goBack must NOT call wc.reload');

  const wc2 = makeGuestWc(10);
  const deps2 = { fromId: (id) => id === 10 ? wc2 : null, chromeContents: null };
  goForward(10, deps2);
  assert.equal(wc2.goForwardCalled, true, 'goForward must call wc.goForward');
  assert.equal(wc2.goBackCalled, false, 'goForward must NOT call wc.goBack');
  assert.equal(wc2.reloadCalled, false, 'goForward must NOT call wc.reload');

  const wc3 = makeGuestWc(10);
  const deps3 = { fromId: (id) => id === 10 ? wc3 : null, chromeContents: null };
  reload(10, deps3);
  assert.equal(wc3.reloadCalled, true, 'reload must call wc.reload');
  assert.equal(wc3.goBackCalled, false, 'reload must NOT call wc.goBack');
  assert.equal(wc3.goForwardCalled, false, 'reload must NOT call wc.goForward');
});
