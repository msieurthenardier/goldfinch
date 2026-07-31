'use strict';

// DD9 lifecycle pin (M15 Flight 2 "Jar-Scoped Bookmarks", Leg 2): jar DELETE
// drops its bookmarks; jar WIPE (the full identity wipe, jar persists)
// PRESERVES them. Both assertions live in ONE file (leg spec: "the wipe-vs-
// remove pair... the distinction is visible in one place") — the same
// pairing jar-registry-ipc.test.js/jar-data-ipc.test.js already keep for
// history's clearJar-vs-preserved split, but bookmarks additionally spans
// TWO registrars (jars-remove in jar-registry-ipc.js, jars-wipe in
// jar-data-ipc.js), which is exactly why this needs its own file rather than
// living inside either registrar's own suite.
//
// Uses the shared `makeHarness` (registers BOTH registrars via the real
// jar-ipc.js facade) with a fake bookmarksStore injected (the
// makeFakeBookmarksStore/makeFakeHistoryStore pattern in
// test/unit/helpers/jar-ipc-harness.js) — proving the FACADE forwards the
// same reference to both registrars, not just one.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeFakeBookmarksStore, makeHarness } = require('./helpers/jar-ipc-harness');

test('jars-remove drops the deleted jar\'s bookmarks (DD9) and broadcasts bookmarks-changed (n>0 gate)', async (t) => {
  const bookmarksStore = makeFakeBookmarksStore();
  bookmarksStore.seed('personal', 3);
  bookmarksStore.seed('work', 1); // a DIFFERENT jar — must survive
  const h = makeHarness(t, { bookmarksStore });

  const result = await h.invoke('jars-remove', { id: 'personal' });
  assert.equal(result.ok, true);
  assert.equal(bookmarksStore.count('personal'), 0, 'the removed jar\'s bookmarks are gone');
  assert.equal(bookmarksStore.count('work'), 1, 'a DIFFERENT jar\'s bookmarks are untouched');

  const bookmarksBroadcast = h.broadcasts().find((b) => b.channel === 'bookmarks-changed');
  assert.ok(bookmarksBroadcast, 'handleRemove must broadcast bookmarks-changed when rows were deleted');
  assert.deepEqual(bookmarksBroadcast.payload, { jarId: 'personal' });
});

test('jars-remove on a jar with zero bookmarks does not broadcast bookmarks-changed (n>0 gate)', async (t) => {
  const bookmarksStore = makeFakeBookmarksStore();
  const h = makeHarness(t, { bookmarksStore });
  const result = await h.invoke('jars-remove', { id: 'personal' });
  assert.equal(result.ok, true);
  assert.ok(h.broadcasts().every((b) => b.channel !== 'bookmarks-changed'));
});

test('jars-remove\'s bookmark teardown is fail-soft: a throwing bookmarksStore.clearJar never flips ok, and the rest of the composition still runs', async (t) => {
  const bookmarksStore = makeFakeBookmarksStore({ throws: true });
  const h = makeHarness(t, { bookmarksStore });
  const result = await h.invoke('jars-remove', { id: 'personal' });
  assert.equal(result.ok, true, 'a bookmark-teardown failure must not fail the whole delete (own try/catch, fail-soft)');
  assert.ok(h.broadcasts().some((b) => b.channel === 'jars-changed'), 'the rest of the composition (revoke/broadcasts) still ran');
  assert.ok(h.broadcasts().every((b) => b.channel !== 'bookmarks-changed'), 'no bookmarks-changed on a failed teardown');
});

test('jars-remove without a bookmarksStore injection skips the step entirely (offline-test gating) — no throw, no broadcast', async (t) => {
  const h = makeHarness(t); // no bookmarksStore injected
  const result = await h.invoke('jars-remove', { id: 'personal' });
  assert.equal(result.ok, true);
  assert.ok(h.broadcasts().every((b) => b.channel !== 'bookmarks-changed'));
});

test('jars-wipe (the full identity wipe) PRESERVES the jar\'s bookmarks — DD9\'s central distinction from jars-remove', async (t) => {
  const bookmarksStore = makeFakeBookmarksStore();
  bookmarksStore.seed('personal', 3);
  const h = makeHarness(t, { bookmarksStore });

  const result = await h.invoke('jars-wipe', { id: 'personal' });
  assert.equal(result.ok, true);
  assert.equal(bookmarksStore.count('personal'), 3, 'wipeJarData never calls bookmarksStore.clearJar — the jar persists, bookmarks stay');
  assert.ok(h.broadcasts().every((b) => b.channel !== 'bookmarks-changed'), 'a wipe never touches bookmarks, so it never broadcasts about them');
});

test('the SAME injected bookmarksStore reference is shared by both registrars (facade forwarding, jar-ipc.js)', async (t) => {
  const bookmarksStore = makeFakeBookmarksStore();
  bookmarksStore.seed('personal', 1);
  const h = makeHarness(t, { bookmarksStore });

  // jars-wipe (jar-data-ipc.js) must not see/touch it...
  await h.invoke('jars-wipe', { id: 'personal' });
  assert.equal(bookmarksStore.count('personal'), 1);

  // ...but jars-remove (jar-registry-ipc.js), the OTHER registrar, uses the
  // exact same reference — proving jar-ipc.js's facade forwards ONE
  // bookmarksStore to both, not two independently-injected fakes.
  const result = await h.invoke('jars-remove', { id: 'personal' });
  assert.equal(result.ok, true);
  assert.equal(bookmarksStore.count('personal'), 0);
});
