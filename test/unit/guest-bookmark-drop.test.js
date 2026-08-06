'use strict';

// Guest-side drag-onto-page listeners (M15 F3 "Drag Interactions" Leg 4 —
// AC2/AC3/AC4/AC5, DD5/DD5b/DD6).
//
// ⚠ HONEST BOUND, STATED UP FRONT because the AC2 case below is the leg's single
// most subtle line: `node --test` has no browser. The dispatcher in this file is
// a HAND-WRITTEN model of event dispatch — it pins the handler's SHAPE and the
// test author's model of dispatch ordering, NOT Chromium's actual ordering.
// The real verification of "the page wins" is the HAT fixture page (a real page
// with a real dropzone). Nothing here proves browser behaviour; what it does
// prove is that the implementation reads `defaultPrevented` from a fresh
// macrotask, and that under the documented ordering model a synchronous read and
// a `queueMicrotask` read would BOTH have got the answer wrong.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createBookmarkDropListeners,
  hasBookmarkType,
  GUEST_BOOKMARK_DROP_CHANNEL,
  BOOKMARK_DND_MIME,
} = require('../../src/preload/guest-bookmark-drop.js');

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** A DragEvent stand-in with a real `defaultPrevented` flag. */
function fakeDragEvent(types, { onPreventDefault } = {}) {
  const evt = {
    defaultPrevented: false,
    dataTransfer: {
      types,
      getData() { throw new Error('the guest never calls getData (DD2) — protected mode forbids it here'); },
    },
    preventDefault() {
      evt.defaultPrevented = true;
      if (onPreventDefault) onPreventDefault();
    },
  };
  return evt;
}

/** Records IPC sends verbatim, INCLUDING the argument count (AC5 reads it). */
function fakeIpc() {
  const sends = [];
  return { sends, send: (...args) => sends.push(args) };
}

/** Deferred callbacks, run explicitly — the macrotask queue, made observable. */
function fakeDefer() {
  const queue = [];
  const defer = (fn, ms) => { queue.push({ fn, ms }); };
  return { queue, defer, run: () => { const q = queue.splice(0); for (const t of q) t.fn(); } };
}

function build() {
  const ipc = fakeIpc();
  const timers = fakeDefer();
  const listeners = createBookmarkDropListeners({ ipcRenderer: ipc, setTimeout: timers.defer });
  return { ipc, timers, listeners };
}

// ---------------------------------------------------------------------------
// AC3 — the `types` gate is mandatory, not cosmetic
// ---------------------------------------------------------------------------

test('AC3: dragover preventDefaults ONLY for a bookmark drag', () => {
  const { listeners } = build();
  const ours = fakeDragEvent([BOOKMARK_DND_MIME, 'text/uri-list', 'text/plain']);
  listeners.handleDragOver(ours);
  assert.equal(ours.defaultPrevented, true, 'without this preventDefault no `drop` is ever dispatched (DD5b)');
});

test('AC3: an unrelated drag (Files) is left completely untouched — pages keep refusing drops they would refuse', () => {
  const { listeners } = build();
  // The failure this pins: ungated, we would preventDefault EVERY drag on EVERY
  // page, making pages accept file and link drops they otherwise refuse.
  for (const types of [['Files'], ['text/uri-list', 'text/plain'], ['text/html'], []]) {
    const foreign = fakeDragEvent(types);
    listeners.handleDragOver(foreign);
    assert.equal(foreign.defaultPrevented, false, `a ${JSON.stringify(types)} drag must not be accepted`);
  }
});

test('AC3: the gate answers false for unreadable / hostile dataTransfer shapes', () => {
  assert.equal(hasBookmarkType(undefined), false);
  assert.equal(hasBookmarkType({}), false);
  assert.equal(hasBookmarkType({ dataTransfer: null }), false);
  assert.equal(hasBookmarkType({ dataTransfer: { types: null } }), false);
  // A DOMStringList-shaped (array-LIKE, no .includes) types collection still works.
  assert.equal(hasBookmarkType({ dataTransfer: { types: { length: 1, 0: BOOKMARK_DND_MIME } } }), true);
  // A throwing getter — the page's world, so this is reachable — resolves false.
  assert.equal(hasBookmarkType({ get dataTransfer() { throw new Error('nope'); } }), false);
});

// ---------------------------------------------------------------------------
// AC4 — the drop handler must NOT preventDefault
// ---------------------------------------------------------------------------

test('AC4: the drop handler never calls preventDefault — it would pollute the discriminator', () => {
  const { listeners, timers } = build();
  let prevents = 0;
  const evt = fakeDragEvent([BOOKMARK_DND_MIME], { onPreventDefault: () => { prevents++; } });
  listeners.handleDrop(evt);
  timers.run();
  assert.equal(prevents, 0);
  assert.equal(evt.defaultPrevented, false,
    'DD5b: there is no default left to suppress, and setting the flag would make the page-wins read always say "consumed"');
});

// ---------------------------------------------------------------------------
// AC5 (DD6) — the signal carries no url and no id
// ---------------------------------------------------------------------------

test('AC5: the guest→main signal is BARE — channel only, no payload at all', () => {
  const { listeners, timers, ipc } = build();
  listeners.handleDrop(fakeDragEvent([BOOKMARK_DND_MIME, 'text/uri-list', 'text/plain']));
  timers.run();
  assert.equal(ipc.sends.length, 1);
  // The whole of DD6 in one assertion: a signal that carries no data cannot be
  // aimed. The url IS present in the dataTransfer (text/uri-list, for the page's
  // benefit) and is deliberately not read or forwarded.
  assert.deepEqual(ipc.sends[0], [GUEST_BOOKMARK_DROP_CHANNEL]);
  assert.equal(ipc.sends[0].length, 1, 'exactly one argument — the channel; no second argument may ever appear here');
});

test('AC5: a drop with no bookmark type sends nothing and defers nothing', () => {
  const { listeners, timers, ipc } = build();
  listeners.handleDrop(fakeDragEvent(['Files']));
  assert.equal(timers.queue.length, 0, 'a foreign drop does not even arm the deferred read');
  timers.run();
  assert.equal(ipc.sends.length, 0);
});

// ---------------------------------------------------------------------------
// AC2 — the discriminator, and why the deferral must be a MACROTASK
// ---------------------------------------------------------------------------

/**
 * A model of browser event dispatch over listeners in REGISTRATION order, with a
 * microtask checkpoint between listeners.
 *
 * The checkpoint is the point of the whole test: for a browser-dispatched event
 * the JS stack IS empty between listener callbacks, so queued microtasks run
 * there — which is why `queueMicrotask` is not a sufficient deferral. Modelled
 * with `await null` between listeners; a purely synchronous loop would drain
 * microtasks only at the END and would silently make `queueMicrotask` look
 * correct (see the honest-bound note at the top of this file).
 */
async function dispatchLikeABrowser(listeners, evt) {
  for (const fn of listeners) {
    fn(evt);
    await null; // microtask checkpoint — the stack is empty between listeners
  }
}

test('AC2: a page that consumes the drop keeps it — the deferred read sees defaultPrevented, and no signal is sent', async () => {
  const { listeners, timers, ipc } = build();
  const evt = fakeDragEvent([BOOKMARK_DND_MIME, 'text/uri-list', 'text/plain']);

  // Registration order is the real one: this preload runs at DOCUMENT-START, so
  // OUR listener is registered FIRST and fires AHEAD of the page's own handler
  // on the same node. `document.addEventListener('drop', …)` is the single most
  // common shape for a global dropzone — this is the ordinary case, not a corner.
  const pageHandler = (e) => e.preventDefault(); // the page accepts the drop
  await dispatchLikeABrowser([listeners.handleDrop, pageHandler], evt);

  assert.equal(timers.queue.length, 1, 'the read was deferred, not taken inline');
  assert.equal(timers.queue[0].ms, 0, 'setTimeout(…, 0) — a fresh macrotask');
  timers.run(); // the macrotask runs after the whole dispatch
  assert.equal(ipc.sends.length, 0, 'the page consumed the drop: page wins, we do nothing');
});

test('AC2: a SYNCHRONOUS read and a queueMicrotask read are BOTH insufficient — they destroy the drops this design protects', async () => {
  // Counterfactual probes registered where our real listener sits (first), so
  // they observe exactly what each alternative implementation would have seen.
  // The real implementation's answer is asserted in the test above; this one
  // pins WHY it cannot be either of the cheaper reads.
  const evt = fakeDragEvent([BOOKMARK_DND_MIME]);
  let syncRead = null;
  let microtaskRead = null;
  const syncProbe = (e) => {
    syncRead = e.defaultPrevented;                                  // read inline
    queueMicrotask(() => { microtaskRead = e.defaultPrevented; });  // read at the next checkpoint
  };
  const pageHandler = (e) => e.preventDefault();
  await dispatchLikeABrowser([syncProbe, pageHandler], evt);
  await null; // let any straggler microtask land

  assert.equal(evt.defaultPrevented, true, 'the page really did consume this drop');
  assert.equal(syncRead, false,
    'a synchronous read runs BEFORE the page handler (document-start registration order) and would navigate over it');
  assert.equal(microtaskRead, false,
    'a microtask checkpoint runs between listeners while the stack is empty, so it too runs before the page handler');
});

test('AC2: an ordinary page — nothing consumes the drop — produces exactly one signal', async () => {
  const { listeners, timers, ipc } = build();
  const evt = fakeDragEvent([BOOKMARK_DND_MIME, 'text/uri-list']);
  const inertPageHandler = () => {}; // a page that listens but does not accept
  await dispatchLikeABrowser([listeners.handleDrop, inertPageHandler], evt);
  timers.run();
  assert.deepEqual(ipc.sends, [[GUEST_BOOKMARK_DROP_CHANNEL]]);
});

test('AC2: an unreadable defaultPrevented fails CLOSED — no navigation', () => {
  const { timers, ipc } = build();
  const listeners = createBookmarkDropListeners({ ipcRenderer: ipc, setTimeout: timers.defer });
  const hostile = {
    dataTransfer: { types: [BOOKMARK_DND_MIME] },
    get defaultPrevented() { throw new Error('page-installed getter'); },
  };
  listeners.handleDrop(hostile);
  timers.run();
  assert.equal(ipc.sends.length, 0, 'a flag we cannot read is treated as "the page consumed it"');
});

// ---------------------------------------------------------------------------
// dataTransfer protected mode
// ---------------------------------------------------------------------------

test('the types gate is read SYNCHRONOUSLY — a dataTransfer emptied when dispatch ends still signals', () => {
  const { listeners, timers, ipc } = build();
  const evt = fakeDragEvent([BOOKMARK_DND_MIME]);
  listeners.handleDrop(evt);
  // Protected mode ends with the dispatch: every types/getData read from the
  // deferred callback returns empty. Reproduced literally here — if the gate
  // were re-read late, this send would vanish.
  evt.dataTransfer.types = [];
  timers.run();
  assert.deepEqual(ipc.sends, [[GUEST_BOOKMARK_DROP_CHANNEL]]);
});

test('a send that throws (tab tearing down) is swallowed rather than escaping into page script', () => {
  const timers = fakeDefer();
  const listeners = createBookmarkDropListeners({
    ipcRenderer: { send() { throw new Error('main gone'); } },
    setTimeout: timers.defer,
  });
  listeners.handleDrop(fakeDragEvent([BOOKMARK_DND_MIME]));
  assert.doesNotThrow(() => timers.run());
});

// ---------------------------------------------------------------------------
// The wiring the core cannot see: webview-preload.js's document-start captures
// and registrations (source scan — the grep-AC convention).
// ---------------------------------------------------------------------------

test('webview-preload.js captures setTimeout at document-start and injects it (page-monkeypatch defense)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'preload', 'webview-preload.js'), 'utf8');
  assert.match(src, /const nativeSetTimeout = /,
    'the deferral must not resolve window.setTimeout at DROP time — contextIsolation is off and a page can ' +
    'replace it to run our read synchronously (defeating page-wins) or never (suppressing the navigation)');
  assert.match(src, /createBookmarkDropListeners\(\{\s*ipcRenderer,\s*setTimeout: nativeSetTimeout\s*\}\)/);
  // Registered on `window`, bubble phase (no `true` third argument), in EVERY
  // frame — the frame-scope decision, deliberately not IS_TOP_FRAME-gated.
  assert.match(src, /window\.addEventListener\('dragover', bookmarkDrop\.handleDragOver\);/);
  assert.match(src, /window\.addEventListener\('drop', bookmarkDrop\.handleDrop\);/);
  const registration = src.slice(src.indexOf('const nativeSetTimeout'));
  assert.equal(/IS_TOP_FRAME[\s\S]{0,200}handleDragOver/.test(registration), false,
    'all-frames registration is a stated decision: main navigates the TAB, not a frame');
});
