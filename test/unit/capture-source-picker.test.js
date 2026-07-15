'use strict';

// F7 DD4 — the extracted pure picker's unit net.
//
// THIS IS DD4'S ONLY RIG-PROVABLE HALF (recon S2, load-bearing). main.js skips the
// whole desktopCapturer branch under Wayland and `dev:automation` selects Wayland,
// so the code that CALLS this module is dead on the dev rig: no live step in this
// flight can prove the mis-pick fix, and any that claimed to would pass vacuously.
// The cross-platform half is HAT/operator-scoped on a non-Wayland desktop.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { pickSourceByMediaSourceId } = require('../../src/main/capture-source-picker');

const src = (id, extra = {}) => ({ id, name: 'window ' + id, thumbnail: { id }, ...extra });

test('capture-source-picker: picks the source whose id EXACTLY matches the mediaSourceId, among several', () => {
  const sources = [src('window:1:0'), src('window:22:0'), src('window:333:0')];
  const picked = pickSourceByMediaSourceId(sources, 'window:22:0');
  assert.equal(picked, sources[1]);
});

test('capture-source-picker: picks by identity even when another source is a better SIZE match — DD4 is not scoring', () => {
  // The pre-F7 bug in one test: the decoy is the largest source, so any
  // size/area heuristic prefers it. Identity must win regardless.
  const decoy = { id: 'window:99:0', thumbnail: { getSize: () => ({ width: 4000, height: 4000 }) } };
  const target = { id: 'window:7:0', thumbnail: { getSize: () => ({ width: 10, height: 10 }) } };
  assert.equal(pickSourceByMediaSourceId([decoy, target], 'window:7:0'), target);
});

test('capture-source-picker: NO MATCH returns null — never a "closest" fallback (the DD4 contract)', () => {
  // Named for the CONTRACT, not the mechanism: a future "be helpful" refactor that
  // returns the nearest/largest/first source must fail HERE, loudly. "Capture *a*
  // window that happens to be the same size" is not a contract — a miss falls
  // through to main.js's composite path, which is already bound to the right record.
  const sources = [src('window:1:0'), src('window:2:0')];
  assert.equal(pickSourceByMediaSourceId(sources, 'window:404:0'), null);
});

test('capture-source-picker: empty sources array → null', () => {
  assert.equal(pickSourceByMediaSourceId([], 'window:1:0'), null);
});

test('capture-source-picker: null / undefined sources → null (no throw)', () => {
  assert.equal(pickSourceByMediaSourceId(null, 'window:1:0'), null);
  assert.equal(pickSourceByMediaSourceId(undefined, 'window:1:0'), null);
});

test('capture-source-picker: null / undefined / empty mediaSourceId → null (never matches a source)', () => {
  const sources = [src('window:1:0'), { id: undefined, thumbnail: {} }];
  assert.equal(pickSourceByMediaSourceId(sources, null), null);
  assert.equal(pickSourceByMediaSourceId(sources, undefined), null);
  assert.equal(pickSourceByMediaSourceId(sources, ''), null);
});

test('capture-source-picker: sources lacking a string id are SKIPPED, and a later valid match still wins', () => {
  const target = src('window:5:0');
  const sources = [{ thumbnail: {} }, { id: 42, thumbnail: {} }, null, target];
  assert.equal(pickSourceByMediaSourceId(sources, 'window:5:0'), target);
});

test('capture-source-picker: a non-string id never matches a mediaSourceId by coercion', () => {
  // Guards against a `==` regression: 42 must not match '42'.
  assert.equal(pickSourceByMediaSourceId([{ id: 42, thumbnail: {} }], '42'), null);
});

test('capture-source-picker: returns the FIRST exact match when ids duplicate (deterministic)', () => {
  const first = src('window:1:0');
  const second = src('window:1:0');
  assert.equal(pickSourceByMediaSourceId([first, second], 'window:1:0'), first);
});
