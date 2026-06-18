'use strict';

// Unit tests for src/main/automation/zoom.js
//
// Electron-free: zoom.js does NOT require('electron') at the top, and
// resolveContents (which it delegates to) is also Electron-free. These tests run
// under plain `node --test` with no Electron stub. Fake wc/session objects stand
// in for real Electron webContents and Session objects.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { getZoom, setZoom } = require('../../src/main/automation/zoom');

// ---------------------------------------------------------------------------
// Fake webContents helpers — mirrors automation-nav.test.js style, plus
// getZoomFactor()/setZoomFactor() zoom spies.
// ---------------------------------------------------------------------------

/**
 * Build a minimal fake webContents for a web/guest context.
 * getZoomFactor returns the last-set factor (default 1.0); setZoomFactor records.
 */
function makeGuestWc(id, factor = 1.0) {
  return {
    id,
    session: { __goldfinchInternal: false },
    isDestroyed() { return false; },
    _factor: factor,
    setCalls: [],
    getZoomFactor() { return this._factor; },
    setZoomFactor(f) { this.setCalls.push(f); this._factor = f; }
  };
}

/**
 * Build a fake internal-session webContents (goldfinch://settings guest).
 */
function makeInternalWc(id, factor = 1.0) {
  return {
    id,
    session: { __goldfinchInternal: true },
    isDestroyed() { return false; },
    _factor: factor,
    setCalls: [],
    getZoomFactor() { return this._factor; },
    setZoomFactor(f) { this.setCalls.push(f); this._factor = f; }
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
    setCalls: [],
    getZoomFactor() { return 1.0; },
    setZoomFactor(f) { this.setCalls.push(f); }
  };
}

// ---------------------------------------------------------------------------
// getZoom — happy path
// ---------------------------------------------------------------------------

test('getZoom: returns { factor } from wc.getZoomFactor()', () => {
  const wc = makeGuestWc(10, 1.25);
  const deps = { fromId: (id) => id === 10 ? wc : null, chromeContents: null };
  assert.deepEqual(getZoom(10, deps), { factor: 1.25 });
});

// ---------------------------------------------------------------------------
// setZoom — apply, clamp, return applied factor
// ---------------------------------------------------------------------------

test('setZoom: in-range factor applied verbatim and returned', () => {
  const wc = makeGuestWc(10);
  const deps = { fromId: (id) => id === 10 ? wc : null, chromeContents: null };
  assert.deepEqual(setZoom(10, 1.5, deps), { factor: 1.5 });
  assert.deepEqual(wc.setCalls, [1.5]);
  assert.equal(wc.getZoomFactor(), 1.5);
});

test('setZoom: above-max factor clamps to 5.0', () => {
  const wc = makeGuestWc(10);
  const deps = { fromId: (id) => id === 10 ? wc : null, chromeContents: null };
  assert.deepEqual(setZoom(10, 9, deps), { factor: 5.0 });
  assert.deepEqual(wc.setCalls, [5.0]);
});

test('setZoom: below-min factor clamps to 0.25', () => {
  const wc = makeGuestWc(10);
  const deps = { fromId: (id) => id === 10 ? wc : null, chromeContents: null };
  assert.deepEqual(setZoom(10, 0.1, deps), { factor: 0.25 });
  assert.deepEqual(wc.setCalls, [0.25]);
});

test('setZoom: exact bounds pass through unclamped', () => {
  const wcLo = makeGuestWc(10);
  const depsLo = { fromId: (id) => id === 10 ? wcLo : null, chromeContents: null };
  assert.deepEqual(setZoom(10, 0.25, depsLo), { factor: 0.25 });

  const wcHi = makeGuestWc(11);
  const depsHi = { fromId: (id) => id === 11 ? wcHi : null, chromeContents: null };
  assert.deepEqual(setZoom(11, 5.0, depsHi), { factor: 5.0 });
});

// ---------------------------------------------------------------------------
// setZoom — factor validation (before any resolve / side effect)
// ---------------------------------------------------------------------------

test('setZoom: zero factor → throws, setZoomFactor NOT called', () => {
  const wc = makeGuestWc(10);
  const deps = { fromId: (id) => id === 10 ? wc : null, chromeContents: null };
  assert.throws(
    () => setZoom(10, 0, deps),
    (err) => err instanceof Error && err.message.includes('automation: setZoom — factor must be a positive number')
  );
  assert.equal(wc.setCalls.length, 0);
});

test('setZoom: negative factor → throws', () => {
  const wc = makeGuestWc(10);
  const deps = { fromId: (id) => id === 10 ? wc : null, chromeContents: null };
  assert.throws(
    () => setZoom(10, -1, deps),
    (err) => err instanceof Error && err.message.includes('automation: setZoom — factor must be a positive number')
  );
  assert.equal(wc.setCalls.length, 0);
});

test('setZoom: NaN factor → throws', () => {
  const wc = makeGuestWc(10);
  const deps = { fromId: (id) => id === 10 ? wc : null, chromeContents: null };
  assert.throws(
    () => setZoom(10, NaN, deps),
    (err) => err instanceof Error && err.message.includes('automation: setZoom — factor must be a positive number')
  );
  assert.equal(wc.setCalls.length, 0);
});

test('setZoom: Infinity factor → throws', () => {
  const wc = makeGuestWc(10);
  const deps = { fromId: (id) => id === 10 ? wc : null, chromeContents: null };
  assert.throws(
    () => setZoom(10, Infinity, deps),
    (err) => err instanceof Error && err.message.includes('automation: setZoom — factor must be a positive number')
  );
  assert.equal(wc.setCalls.length, 0);
});

test('setZoom: non-number factor → throws', () => {
  const wc = makeGuestWc(10);
  const deps = { fromId: (id) => id === 10 ? wc : null, chromeContents: null };
  assert.throws(
    // @ts-expect-error — intentionally passing wrong type
    () => setZoom(10, '1.5', deps),
    (err) => err instanceof Error && err.message.includes('automation: setZoom — factor must be a positive number')
  );
  assert.equal(wc.setCalls.length, 0);
});

// ---------------------------------------------------------------------------
// resolveContents guards — bad-handle / no-such-contents
// ---------------------------------------------------------------------------

test('getZoom: non-number wcId → throws bad-handle', () => {
  const deps = { fromId: () => null, chromeContents: null };
  assert.throws(
    // @ts-expect-error — intentionally passing wrong type
    () => getZoom('not-a-number', deps),
    (err) => err instanceof Error && err.message.includes('automation: bad-handle')
  );
});

test('setZoom: non-number wcId → throws bad-handle (after factor validation passes)', () => {
  const deps = { fromId: () => null, chromeContents: null };
  assert.throws(
    // @ts-expect-error — intentionally passing wrong type
    () => setZoom('not-a-number', 1.5, deps),
    (err) => err instanceof Error && err.message.includes('automation: bad-handle')
  );
});

test('getZoom: destroyed wc → throws no-such-contents', () => {
  const destroyedWc = makeDestroyedWc(55);
  const deps = { fromId: (id) => id === 55 ? destroyedWc : null, chromeContents: null };
  assert.throws(
    () => getZoom(55, deps),
    (err) => err instanceof Error && err.message.includes('automation: no-such-contents')
  );
});

test('setZoom: destroyed wc → throws no-such-contents, setZoomFactor NOT called', () => {
  const destroyedWc = makeDestroyedWc(55);
  const deps = { fromId: (id) => id === 55 ? destroyedWc : null, chromeContents: null };
  assert.throws(
    () => setZoom(55, 1.5, deps),
    (err) => err instanceof Error && err.message.includes('automation: no-such-contents')
  );
  assert.equal(destroyedWc.setCalls.length, 0);
});

// ---------------------------------------------------------------------------
// Op-local internal-session guard — fires EVEN under admin allowInternal:true
// (the case resolveContents would otherwise let through). This proves the
// op-local guard, not resolveContents, is what refuses internal pages.
// ---------------------------------------------------------------------------

test('getZoom: internal wc with allowInternal:true → op-local internal-session refusal', () => {
  const internalWc = makeInternalWc(99, 1.5);
  const deps = { fromId: (id) => id === 99 ? internalWc : null, chromeContents: null, allowInternal: true };
  assert.throws(
    () => getZoom(99, deps),
    (err) => err instanceof Error && err.message.includes('automation: getZoom — internal-session excluded')
  );
});

test('setZoom: internal wc with allowInternal:true → op-local internal-session refusal, setZoomFactor NOT called', () => {
  const internalWc = makeInternalWc(99);
  const deps = { fromId: (id) => id === 99 ? internalWc : null, chromeContents: null, allowInternal: true };
  assert.throws(
    () => setZoom(99, 1.5, deps),
    (err) => err instanceof Error && err.message.includes('automation: setZoom — internal-session excluded')
  );
  assert.equal(internalWc.setCalls.length, 0);
});

test('getZoom: internal wc without allowInternal → resolveContents internal-session refusal', () => {
  const internalWc = makeInternalWc(99);
  const deps = { fromId: (id) => id === 99 ? internalWc : null, chromeContents: null };
  assert.throws(
    () => getZoom(99, deps),
    (err) => err instanceof Error && err.message.includes('automation: internal-session')
  );
});

test('setZoom: internal wc without allowInternal → resolveContents internal-session refusal', () => {
  const internalWc = makeInternalWc(99);
  const deps = { fromId: (id) => id === 99 ? internalWc : null, chromeContents: null };
  assert.throws(
    () => setZoom(99, 1.5, deps),
    (err) => err instanceof Error && err.message.includes('automation: internal-session')
  );
  assert.equal(internalWc.setCalls.length, 0);
});
