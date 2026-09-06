'use strict';

// Unit tests for src/main/vault/resurface-compromise-reveal.js (M18 F3 L1, DD9) — the
// H2 resurface composition extracted from main.js's `resurfaceCompromiseReveal`
// (formerly main.js:934-948). Electron-free, injected deps: pins the orphan scan (a
// reveal whose owning chromeId is no longer live), the at-most-one break, the
// dead-chrome / no-chromeId no-op, and the exact `{ recoveryKey, replacing: true }`
// send payload.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { resurfaceCompromiseReveal } = require('../../src/main/vault/resurface-compromise-reveal');

// A minimal fake mirroring pending-compromise-reveals.js's shape: chromeIds() lists
// the pending reveals' owning ids; rekey(from, to) moves one and returns it (or null).
function makeFakeReveals(pending) {
  /** @type {Map<number, { recoveryKey: string }>} */
  const reveals = new Map(pending);
  const rekeyCalls = [];
  return {
    reveals,
    rekeyCalls,
    chromeIds: () => [...reveals.keys()],
    rekey(from, to) {
      rekeyCalls.push([from, to]);
      const reveal = reveals.get(from);
      if (!reveal) return null;
      reveals.delete(from);
      reveals.set(to, reveal);
      return reveal;
    }
  };
}

test('an orphaned reveal (owning window gone) is re-keyed to the booted chrome and re-sent with replacing:true', () => {
  const reveals = makeFakeReveals([[7, { recoveryKey: 'ABCD-EFGH' }]]);
  const sent = [];
  resurfaceCompromiseReveal({
    chromeId: 99,
    liveChromeIds: new Set([99]), // chrome 7 is NOT live — orphaned
    reveals,
    send: (payload) => sent.push(payload)
  });
  assert.deepEqual(reveals.rekeyCalls, [[7, 99]]);
  assert.deepEqual(sent, [{ recoveryKey: 'ABCD-EFGH', replacing: true }]);
  assert.equal(reveals.reveals.has(7), false, 'consumed from the old id');
  assert.equal(reveals.reveals.has(99), true, 'moved to the new id');
});

test('a reveal whose owning window is STILL live is left untouched — nothing to resurface', () => {
  const reveals = makeFakeReveals([[7, { recoveryKey: 'ABCD-EFGH' }]]);
  const sent = [];
  resurfaceCompromiseReveal({
    chromeId: 99,
    liveChromeIds: new Set([7, 99]), // chrome 7 IS live
    reveals,
    send: (payload) => sent.push(payload)
  });
  assert.deepEqual(reveals.rekeyCalls, [], 'no rekey attempted for a live owner');
  assert.deepEqual(sent, []);
  assert.equal(reveals.reveals.has(7), true, 'reveal stays where it is');
});

test('no pending reveals at all — a strict no-op', () => {
  const reveals = makeFakeReveals([]);
  const sent = [];
  resurfaceCompromiseReveal({ chromeId: 99, liveChromeIds: new Set(), reveals, send: (p) => sent.push(p) });
  assert.deepEqual(reveals.rekeyCalls, []);
  assert.deepEqual(sent, []);
});

test('a null/undefined chromeId (dead/destroyed chrome) is a no-op — nothing scanned, nothing sent', () => {
  const reveals = makeFakeReveals([[7, { recoveryKey: 'ABCD-EFGH' }]]);
  const sent = [];
  resurfaceCompromiseReveal({ chromeId: null, liveChromeIds: new Set(), reveals, send: (p) => sent.push(p) });
  assert.deepEqual(reveals.rekeyCalls, []);
  assert.deepEqual(sent, []);
  assert.equal(reveals.reveals.has(7), true, 'the pending reveal is untouched');
});

test('AT MOST ONE reveal resurfaces per call, even with multiple orphans pending (the scan breaks after the first)', () => {
  const reveals = makeFakeReveals([
    [7, { recoveryKey: 'FIRST-KEY' }],
    [8, { recoveryKey: 'SECOND-KEY' }]
  ]);
  const sent = [];
  resurfaceCompromiseReveal({
    chromeId: 99,
    liveChromeIds: new Set([99]), // neither 7 nor 8 is live
    reveals,
    send: (p) => sent.push(p)
  });
  assert.equal(sent.length, 1, 'exactly one reveal resurfaced');
  assert.equal(reveals.rekeyCalls.length, 1, 'the scan breaks after the first orphan — never inspects the second');
  // The other orphan is left exactly as it was — still pending under its OWN id, for a
  // later boot to pick up.
  const remainingIds = [...reveals.reveals.keys()].filter((id) => id !== 99);
  assert.equal(remainingIds.length, 1, 'the un-resurfaced orphan is still pending');
});

test('a rekey that returns null (defensive — the store found nothing to move) sends nothing', () => {
  // Simulates chromeIds() listing an id that rekey() can't actually find (a race the
  // real store guards against) — the composition must not send a garbage payload.
  const reveals = {
    chromeIds: () => [7],
    rekey: () => null
  };
  const sent = [];
  resurfaceCompromiseReveal({ chromeId: 99, liveChromeIds: new Set(), reveals, send: (p) => sent.push(p) });
  assert.deepEqual(sent, []);
});
