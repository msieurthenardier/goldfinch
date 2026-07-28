'use strict';

// HTTP auth pending-challenge store (M14 F1 L2, flight DD2/DD3; client-cert
// kind added by L3, flight DD4) — the full lifecycle matrix, PARAMETRIC over
// both challenge kinds where the semantics are shared (the L3 design ruling:
// one store, one queue — only presentation channel/menuType and resolution
// payload differ): every-callback-answered (exactly-once ledger), silent-cancel
// guards, DD2 bucket mapping (resolution vs occlusion, incl. the fail-safe
// unknown-reason default), FIFO + background-tab hold + re-present triggers,
// the fullscreen interplay, answer/selection paths, the agent-seam kind filter
// (cert selection is human-only), and the source-scan pin that no code path
// abandons a callback.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { createAuthChallenges } = require('../../src/main/auth-challenges');
const { maskComments } = require('../helpers/source-scan');

// ---------------------------------------------------------------------------
// Harness. The fake sheet mirrors the manager surface the store reads
// (isMenuOpen/getCurrentMenu/closeMenuOverlay); `wired: true` re-enters the
// store's notifySheetClosed from closeMenuOverlay — the window-factory
// onClosed threading — so close-triggered bucket mapping runs like production.
// ---------------------------------------------------------------------------

function makeCallback() {
  const calls = [];
  const cb = (...args) => calls.push(args);
  cb.calls = calls;
  return cb;
}

const FIXTURE_CERT = { subjectName: 'CN=Goldfinch Fixture Client', issuerName: 'CN=Goldfinch Fixture Throwaway CA', data: 'PEM' };

function makeHarness() {
  const guests = new Map(); // wcId -> record
  const popupEntries = new Map(); // popupWcId -> PopupEntry (M14 F2 L2 popup routing)
  const presents = []; // every auth-challenge-present / cert-challenge-present send
  const registry = { getWindowForGuest: (id) => guests.get(id) || null };
  const chromeForTab = (wcId) => ({
    send: (channel, payload) => presents.push({ wcId, channel, payload }),
  });
  const store = createAuthChallenges({
    registry,
    chromeForTab,
    // The main.js lazy-seam shape: getByWcId only.
    popupRegistry: { getByWcId: (id) => popupEntries.get(id) || null },
    logger: { warn: () => {} },
  });

  let nextWinId = 1;
  function makeRecord({ wired = true } = {}) {
    const record = {
      win: { id: nextWinId++, isDestroyed: () => false },
      activeTabWcId: null,
      htmlFullscreen: null,
      sheet: null,
    };
    // M14 F2 L2: popup presentation resolves the record's OWN chrome directly
    // (chromeForTab misses popups). Sends land in `presents` tagged via:'record'.
    record.chromeView = {
      webContents: {
        isDestroyed: () => false,
        send: (channel, payload) => presents.push({ via: 'record', winId: record.win.id, channel, payload }),
      },
    };
    const sheet = {
      menu: null, // { menuType, token }
      closeCalls: [],
      isMenuOpen() { return this.menu != null; },
      getCurrentMenu() { return this.menu; },
      closeMenuOverlay(reason) {
        if (!this.menu) return; // idempotent, like the manager
        const closed = this.menu;
        this.menu = null;
        this.closeCalls.push(reason);
        if (wired) store.notifySheetClosed(record, closed.menuType, reason);
      },
    };
    record.sheet = sheet;
    return record;
  }

  function addGuest(record, wcId) {
    guests.set(wcId, record);
    return { id: wcId, session: {} };
  }

  // Enqueue a BASIC-AUTH challenge for `wcId` on `record`'s window; returns its callback.
  function challenge(record, wcId, { url = 'http://127.0.0.1:8091/protected', realm = 'fixture', host = '127.0.0.1' } = {}) {
    const wc = addGuest(record, wcId);
    const cb = makeCallback();
    store.handleLogin(wc, { url }, { isProxy: false, host, port: 8091, scheme: 'basic', realm }, cb);
    return cb;
  }

  // Enqueue a CLIENT-CERT challenge for `wcId`; returns its callback (with the
  // raw list on cb.list so selection tests can assert identity).
  function certChallenge(record, wcId, { url = 'https://127.0.0.1:8493/', list } = {}) {
    const wc = addGuest(record, wcId);
    const cb = makeCallback();
    cb.list = list || [FIXTURE_CERT];
    store.handleSelectClientCertificate(wc, url, cb.list, cb);
    return cb;
  }

  // Simulate the chrome having opened the matching sheet for the latest present.
  let nextToken = 100;
  function openAuthSheet(record) {
    record.sheet.menu = { menuType: 'auth-basic', token: nextToken++ };
  }
  function openCertSheet(record) {
    record.sheet.menu = { menuType: 'cert-picker', token: nextToken++ };
  }

  // M14 F2 L2 — popup harness half. addPopup registers a popup-registry entry
  // WITHOUT a guests entry: getWindowForGuest must MISS (production shape —
  // popups are never in tabViews) so routing provably comes from the registry.
  function addPopup(record, popupWcId, { openerWcId = 900, partition = 'persist:jar-a' } = {}) {
    popupEntries.set(popupWcId, { popupWcId, openerWcId, openerRecord: record, partition, win: {} });
  }
  function popupWc(popupWcId) {
    return { id: popupWcId, session: {} };
  }
  // Enqueue a BASIC-AUTH challenge arriving from popup contents.
  function popupChallenge(popupWcId, { url = 'http://127.0.0.1:8091/protected', realm = 'fixture', host = '127.0.0.1' } = {}) {
    const cb = makeCallback();
    store.handleLogin(popupWc(popupWcId), { url }, { isProxy: false, host, port: 8091, scheme: 'basic', realm }, cb);
    return cb;
  }
  // Enqueue a CLIENT-CERT challenge arriving from popup contents.
  function popupCertChallenge(popupWcId, { url = 'https://127.0.0.1:8493/', list } = {}) {
    const cb = makeCallback();
    cb.list = list || [FIXTURE_CERT];
    store.handleSelectClientCertificate(popupWc(popupWcId), url, cb.list, cb);
    return cb;
  }

  return { store, presents, makeRecord, addGuest, challenge, certChallenge, openAuthSheet, openCertSheet, guests, addPopup, popupChallenge, popupCertChallenge, popupEntries };
}

// The parametric kind table: shared-semantics tests run once per row (AC — the
// full DD2 matrix applies to BOTH kinds via the shared machinery).
const KINDS = [
  {
    kind: 'basic-auth',
    menuType: 'auth-basic',
    channel: 'auth-challenge-present',
    enqueue: (h, record, wcId, opts) => h.challenge(record, wcId, opts),
    openSheet: (h, record) => h.openAuthSheet(record),
  },
  {
    kind: 'client-cert',
    menuType: 'cert-picker',
    channel: 'cert-challenge-present',
    enqueue: (h, record, wcId, opts) => h.certChallenge(record, wcId, opts),
    openSheet: (h, record) => h.openCertSheet(record),
  },
];

// ---------------------------------------------------------------------------
// Presentation + silent-cancel guards
// ---------------------------------------------------------------------------

test('a basic-auth guest challenge on the active tab presents exactly once (host + realm, never a secret)', () => {
  const h = makeHarness();
  const record = h.makeRecord();
  record.activeTabWcId = 10;
  const cb = h.challenge(record, 10);
  assert.equal(h.presents.length, 1);
  assert.deepEqual(h.presents[0].payload, { wcId: 10, host: '127.0.0.1', realm: 'fixture' });
  assert.equal(h.presents[0].channel, 'auth-challenge-present');
  assert.deepEqual(cb.calls, [], 'the callback stays pending while the prompt is up');
});

test('a client-cert challenge presents exactly once on the DEDICATED channel with DISPLAY STRINGS only (never certificate objects)', () => {
  const h = makeHarness();
  const record = h.makeRecord();
  record.activeTabWcId = 10;
  const cb = h.certChallenge(record, 10);
  assert.equal(h.presents.length, 1);
  assert.equal(h.presents[0].channel, 'cert-challenge-present');
  assert.deepEqual(h.presents[0].payload, {
    wcId: 10,
    host: '127.0.0.1:8493',
    certs: [{ subject: 'CN=Goldfinch Fixture Client', issuer: 'CN=Goldfinch Fixture Throwaway CA' }],
  });
  // The raw Certificate list never rides the payload (main-side only).
  assert.equal(h.presents[0].payload.certs[0].data, undefined);
  assert.equal('list' in h.presents[0].payload, false);
  assert.deepEqual(cb.calls, [], 'the callback stays pending while the chooser is up');
});

test('basic-auth silent cancels: proxy / contents-less / internal-session / non-guest each answer the callback exactly once with no args, no prompt', () => {
  const h = makeHarness();
  const record = h.makeRecord();
  record.activeTabWcId = 10;

  const proxyCb = makeCallback();
  h.store.handleLogin(h.addGuest(record, 10), { url: 'http://x/' }, { isProxy: true }, proxyCb);
  assert.deepEqual(proxyCb.calls, [[]]);

  const noneCb = makeCallback();
  h.store.handleLogin(undefined, { url: 'http://x/' }, { isProxy: false }, noneCb);
  assert.deepEqual(noneCb.calls, [[]]);

  const internalCb = makeCallback();
  h.store.handleLogin({ id: 10, session: { __goldfinchInternal: true } }, { url: 'http://x/' }, { isProxy: false }, internalCb);
  assert.deepEqual(internalCb.calls, [[]]);

  const nonGuestCb = makeCallback();
  h.store.handleLogin({ id: 999, session: {} }, { url: 'http://x/' }, { isProxy: false }, nonGuestCb);
  assert.deepEqual(nonGuestCb.calls, [[]]);

  assert.equal(h.presents.length, 0, 'no guard path presents a prompt');
});

test('client-cert silent cancels: contents-less / internal-session / non-guest each answer the callback exactly once with no args, no prompt', () => {
  const h = makeHarness();
  const record = h.makeRecord();
  record.activeTabWcId = 10;
  const list = [FIXTURE_CERT];

  const noneCb = makeCallback();
  h.store.handleSelectClientCertificate(undefined, 'https://x/', list, noneCb);
  assert.deepEqual(noneCb.calls, [[]]);

  const internalCb = makeCallback();
  h.store.handleSelectClientCertificate({ id: 10, session: { __goldfinchInternal: true } }, 'https://x/', list, internalCb);
  assert.deepEqual(internalCb.calls, [[]]);

  const nonGuestCb = makeCallback();
  h.store.handleSelectClientCertificate({ id: 999, session: {} }, 'https://x/', list, nonGuestCb);
  assert.deepEqual(nonGuestCb.calls, [[]]);

  assert.equal(h.presents.length, 0, 'no guard path presents a chooser');
});

test('client-cert empty/non-array list cancels silently without presenting — DEFENSIVE-UNREACHABLE (Electron 43 continues cert-less before emitting the event)', () => {
  const h = makeHarness();
  const record = h.makeRecord();
  record.activeTabWcId = 10;
  const wc = h.addGuest(record, 10);

  const emptyCb = makeCallback();
  h.store.handleSelectClientCertificate(wc, 'https://x/', [], emptyCb);
  assert.deepEqual(emptyCb.calls, [[]], 'empty list → exactly-once no-args cancel');

  const badCb = makeCallback();
  h.store.handleSelectClientCertificate(wc, 'https://x/', /** @type {any} */ (undefined), badCb);
  assert.deepEqual(badCb.calls, [[]], 'non-array list → exactly-once no-args cancel');

  assert.equal(h.presents.length, 0, 'no sheet for the guard paths');
});

for (const K of KINDS) {
  test(`[${K.kind}] FIFO: a second challenge on the same tab waits for the first resolution, then presents`, () => {
    const h = makeHarness();
    const record = h.makeRecord();
    record.activeTabWcId = 10;
    const cb1 = K.enqueue(h, record, 10);
    const cb2 = K.enqueue(h, record, 10);
    assert.equal(h.presents.length, 1, 'one prompt at a time');
    K.openSheet(h, record);
    // Resolve the first via a resolution-family sheet close (Escape).
    record.sheet.closeMenuOverlay('escape');
    assert.deepEqual(cb1.calls, [[]], 'Esc cancels the presented challenge');
    assert.deepEqual(cb2.calls, [], 'the second challenge stays pending');
    assert.equal(h.presents.length, 2, 'the queue event presents the second challenge');
    assert.equal(h.presents[1].channel, K.channel);
  });

  test(`[${K.kind}] background-tab challenges hold until their tab activates`, () => {
    const h = makeHarness();
    const record = h.makeRecord();
    record.activeTabWcId = 10;
    h.addGuest(record, 10);
    const cb = K.enqueue(h, record, 20); // background tab
    assert.equal(h.presents.length, 0, 'held — the tab is not active');
    record.activeTabWcId = 20;
    h.store.notifyTabActivated(record, 20);
    assert.equal(h.presents.length, 1);
    assert.equal(h.presents[0].payload.wcId, 20);
    assert.equal(h.presents[0].channel, K.channel);
    assert.deepEqual(cb.calls, [], 'still pending, now prompted');
  });

  test(`[${K.kind}] two windows queue independently — window B presents while window A holds one`, () => {
    const h = makeHarness();
    const recA = h.makeRecord();
    const recB = h.makeRecord();
    recA.activeTabWcId = 10;
    recB.activeTabWcId = 20;
    K.enqueue(h, recA, 10);
    K.enqueue(h, recB, 20);
    assert.equal(h.presents.length, 2, 'one prompt per window, simultaneously');
  });
}

// ---------------------------------------------------------------------------
// DD2 bucket mapping (AC) — unit-pinned per reason, per kind
// ---------------------------------------------------------------------------

for (const K of KINDS) {
  for (const reason of ['escape', 'outside-click', 'activated', 'tab-close', 'teardown', 'totally-unknown-reason']) {
    test(`[${K.kind}] sheet close '${reason}' maps to RESOLVE-CANCEL (exactly-once) — incl. the fail-safe unknown default`, () => {
      const h = makeHarness();
      const record = h.makeRecord();
      record.activeTabWcId = 10;
      const cb = K.enqueue(h, record, 10);
      K.openSheet(h, record);
      record.sheet.closeMenuOverlay(reason);
      assert.deepEqual(cb.calls, [[]], `'${reason}' must cancel the callback`);
      // Idempotent: a duplicate close notification never double-resolves.
      h.store.notifySheetClosed(record, K.menuType, reason);
      assert.equal(cb.calls.length, 1);
    });
  }

  for (const reason of ['blur', 'superseded', 'tab-hide', 'tab-switch']) {
    test(`[${K.kind}] sheet close '${reason}' is OCCLUSION — callback survives and re-presents on window refocus`, () => {
      const h = makeHarness();
      const record = h.makeRecord();
      record.activeTabWcId = 10;
      const cb = K.enqueue(h, record, 10);
      K.openSheet(h, record);
      record.sheet.closeMenuOverlay(reason);
      assert.deepEqual(cb.calls, [], `'${reason}' must NOT resolve the callback`);
      h.store.notifyWindowFocused(record);
      assert.equal(h.presents.length, 2, 'the surviving challenge re-presents at the refocus trigger');
      assert.deepEqual(cb.calls, [], 'still pending after the re-present');
    });
  }

  test(`[${K.kind}] model-replace 'superseded' (the path that bypasses closeMenuOverlay) is occlusion via notifySheetClosed directly`, () => {
    const h = makeHarness();
    const record = h.makeRecord();
    record.activeTabWcId = 10;
    const cb = K.enqueue(h, record, 10);
    K.openSheet(h, record);
    // The manager's model-replace branch emits onClosed WITHOUT closeMenuOverlay;
    // window-factory threads it straight into notifySheetClosed. The replacing
    // menu is now open on the sheet.
    record.sheet.menu = { menuType: 'kebab', token: 999 };
    h.store.notifySheetClosed(record, K.menuType, 'superseded');
    assert.deepEqual(cb.calls, [], 'superseded is occlusion — challenge survives');
    // While the replacing menu is open, no trigger may re-present over it.
    h.store.notifyWindowFocused(record);
    assert.equal(h.presents.length, 1, 'no re-present while another menu is open');
    // The replacing menu closes (Escape) — an OTHER menuType's close is IGNORED
    // by the store (no re-present-stealing, leg ruling)…
    record.sheet.closeMenuOverlay('escape');
    assert.equal(h.presents.length, 1, "another menu's close is not a re-present trigger");
    // …so the challenge waits for the NEXT trigger.
    h.store.notifyWindowFocused(record);
    assert.equal(h.presents.length, 2, 'the next trigger re-presents');
    assert.deepEqual(cb.calls, []);
  });

  test(`[${K.kind}] closes of OTHER menu types never touch the presented challenge`, () => {
    const h = makeHarness();
    const record = h.makeRecord();
    record.activeTabWcId = 10;
    const cb = K.enqueue(h, record, 10);
    h.store.notifySheetClosed(record, 'kebab', 'escape');
    h.store.notifySheetClosed(record, 'vault-unlock', 'blur');
    assert.deepEqual(cb.calls, [], 'foreign-menu closes are ignored entirely');
    assert.equal(h.presents.length, 1, 'no duplicate present either');
  });
}

// ---------------------------------------------------------------------------
// Presentation eligibility: fullscreen + open-menu holds (edge-case pins)
// ---------------------------------------------------------------------------

for (const K of KINDS) {
  test(`[${K.kind}] fullscreen interplay: a challenge arriving mid-fullscreen holds; fullscreen exit presents it`, () => {
    const h = makeHarness();
    const record = h.makeRecord();
    record.activeTabWcId = 10;
    record.htmlFullscreen = { wcId: 10, savedBounds: {}, pendingBounds: null };
    const cb = K.enqueue(h, record, 10);
    assert.equal(h.presents.length, 0, 'held while fullscreen');
    h.store.notifyTabActivated(record, 10);
    assert.equal(h.presents.length, 0, 'tab activation does not override the fullscreen hold');
    record.htmlFullscreen = null;
    h.store.notifyFullscreenExited(record);
    assert.equal(h.presents.length, 1, 'presents on fullscreen exit');
    assert.deepEqual(cb.calls, []);
  });

  test(`[${K.kind}] fullscreen-enter closes the sheet ('tab-hide' occlusion); the challenge re-presents on exit`, () => {
    const h = makeHarness();
    const record = h.makeRecord();
    record.activeTabWcId = 10;
    const cb = K.enqueue(h, record, 10);
    K.openSheet(h, record);
    // html-fullscreen enter() closes the sheet with 'tab-hide' and arms the mode.
    record.htmlFullscreen = { wcId: 10, savedBounds: {}, pendingBounds: null };
    record.sheet.closeMenuOverlay('tab-hide');
    assert.deepEqual(cb.calls, [], 'occlusion — the challenge survives fullscreen entry');
    record.htmlFullscreen = null;
    h.store.notifyFullscreenExited(record);
    assert.equal(h.presents.length, 2, 're-presents via the exit trigger');
  });

  test(`[${K.kind}] a dismiss-locked one-time-key sheet blocks the refocus re-present (isMenuOpen gate) — the challenge waits`, () => {
    const h = makeHarness();
    const record = h.makeRecord();
    record.activeTabWcId = 10;
    K.enqueue(h, record, 10);
    K.openSheet(h, record);
    record.sheet.closeMenuOverlay('blur'); // app switch — occlusion
    // A vault-recovery-show is now open (it ignored 'blur'); a re-present would
    // model-replace it and destroy the unrecoverable one-time key.
    record.sheet.menu = { menuType: 'vault-recovery-show', token: 7 };
    h.store.notifyWindowFocused(record);
    assert.equal(h.presents.length, 1, 'no model-replace over the one-time-key sheet');
    record.sheet.menu = null; // acknowledged
    h.store.notifyWindowFocused(record);
    assert.equal(h.presents.length, 2, 'presents at the next trigger once the sheet is free');
  });
}

// ---------------------------------------------------------------------------
// Invalidation: navigation-away / tab close / move / window close
// ---------------------------------------------------------------------------

for (const K of KINDS) {
  test(`[${K.kind}] cancelForTab('navigated') cancels that tab's challenges exactly once and closes a visible ${K.menuType} sheet with a resolution-family reason`, () => {
    const h = makeHarness();
    const record = h.makeRecord();
    record.activeTabWcId = 10;
    const cb1 = K.enqueue(h, record, 10);
    const cb2 = K.enqueue(h, record, 10);
    K.openSheet(h, record);
    h.store.cancelForTab(10, 'navigated');
    assert.deepEqual(cb1.calls, [[]]);
    assert.deepEqual(cb2.calls, [[]]);
    // The AUTH_MENU_TYPES pin (L3): a hardcoded 'auth-basic' here would leave a
    // stale cert-picker open across navigation-away.
    assert.deepEqual(record.sheet.closeCalls, ['navigation'], 'the visible prompt closes (resolution family)');
    // Exactly-once through the wired close's own notifySheetClosed re-entry.
    assert.equal(cb1.calls.length, 1);
  });

  test(`[${K.kind}] cancelForTab only touches the named tab — another tab's queued challenge survives and presents`, () => {
    const h = makeHarness();
    const record = h.makeRecord();
    record.activeTabWcId = 10;
    const cb10 = K.enqueue(h, record, 10);
    const cb20 = K.enqueue(h, record, 20); // background hold
    K.openSheet(h, record);
    h.store.cancelForTab(10, 'tab-close');
    assert.deepEqual(cb10.calls, [[]]);
    assert.deepEqual(cb20.calls, [], 'the other tab is untouched');
    record.activeTabWcId = 20;
    h.store.notifyTabActivated(record, 20);
    assert.equal(h.presents.at(-1).payload.wcId, 20);
  });

  test(`[${K.kind}] cancelForWindow cancels the WHOLE queue (presented + held), never just the head — and every callback exactly once`, () => {
    const h = makeHarness();
    const record = h.makeRecord();
    record.activeTabWcId = 10;
    const cb1 = K.enqueue(h, record, 10); // presented
    const cb2 = K.enqueue(h, record, 10); // queued behind it
    const cb3 = K.enqueue(h, record, 20); // background hold
    K.openSheet(h, record);
    h.store.cancelForWindow(record);
    assert.deepEqual(cb1.calls, [[]]);
    assert.deepEqual(cb2.calls, [[]]);
    assert.deepEqual(cb3.calls, [[]]);
    // The window-factory close path fires the sheet 'teardown' close afterwards —
    // must be a clean no-op (state dropped, ledger exact-once).
    record.sheet.closeMenuOverlay('teardown');
    assert.equal(cb1.calls.length + cb2.calls.length + cb3.calls.length, 3);
  });

  test(`[${K.kind}] a throwing native callback never breaks the queue — the next challenge still presents`, () => {
    const h = makeHarness();
    const record = h.makeRecord();
    record.activeTabWcId = 10;
    const bad = () => { throw new Error('native dispatch exploded'); };
    if (K.kind === 'client-cert') {
      h.store.handleSelectClientCertificate(h.addGuest(record, 10), 'https://x/', [FIXTURE_CERT], bad);
    } else {
      h.store.handleLogin(h.addGuest(record, 10), { url: 'http://x/' }, { isProxy: false, host: 'x', realm: 'r' }, bad);
    }
    const cb2 = K.enqueue(h, record, 10);
    K.openSheet(h, record);
    record.sheet.closeMenuOverlay('escape'); // resolves the throwing head
    assert.equal(h.presents.length, 2, 'the second challenge presents despite the throw');
    assert.deepEqual(cb2.calls, []);
  });
}

// ---------------------------------------------------------------------------
// Interleaved kinds on one window: single FIFO, order preserved, one sheet at
// a time (leg edge case)
// ---------------------------------------------------------------------------

test('basic-auth and client-cert challenges interleave on ONE window FIFO — each presents on its own channel, in order', () => {
  const h = makeHarness();
  const record = h.makeRecord();
  record.activeTabWcId = 10;
  const basicCb = h.challenge(record, 10);
  const certCb = h.certChallenge(record, 10);
  assert.equal(h.presents.length, 1, 'one sheet at a time');
  assert.equal(h.presents[0].channel, 'auth-challenge-present', 'FIFO head first');
  h.openAuthSheet(record);
  record.sheet.closeMenuOverlay('escape'); // resolve-cancel the basic head
  assert.deepEqual(basicCb.calls, [[]]);
  assert.equal(h.presents.length, 2, 'the queue event presents the cert challenge next');
  assert.equal(h.presents[1].channel, 'cert-challenge-present');
  assert.deepEqual(certCb.calls, [], 'cert challenge pending under its own chooser');
});

// ---------------------------------------------------------------------------
// Answer paths: sheet submit + agent (exactly-once across both) — basic-auth
// ---------------------------------------------------------------------------

test('answerFromSheet resolves the ledger FIRST, then closes with activated; the trailing close notification cannot cancel the answered challenge', () => {
  const h = makeHarness();
  const record = h.makeRecord();
  record.activeTabWcId = 10;
  const cb = h.challenge(record, 10);
  h.openAuthSheet(record);
  const res = h.store.answerFromSheet(record, 'fixtureuser', Buffer.from('fixturepass'));
  assert.deepEqual(res, { answered: true });
  assert.deepEqual(cb.calls, [['fixtureuser', 'fixturepass']], 'credentials reach the native callback');
  assert.deepEqual(record.sheet.closeCalls, ['activated'], 'the store owns the single close site');
  assert.equal(cb.calls.length, 1, "the wired 'activated' close's resolve-cancel was an exactly-once no-op");
});

test('answerFromSheet with no presented challenge → { answered:false, reason:no-challenge }', () => {
  const h = makeHarness();
  const record = h.makeRecord();
  assert.deepEqual(h.store.answerFromSheet(record, 'u', 'p'), { answered: false, reason: 'no-challenge' });
});

test('answerFromSheet REFUSES while a client-cert challenge is presented (kind guard) — a string credential never reaches a Certificate callback', () => {
  const h = makeHarness();
  const record = h.makeRecord();
  record.activeTabWcId = 10;
  const certCb = h.certChallenge(record, 10);
  h.openCertSheet(record);
  const res = h.store.answerFromSheet(record, 'u', 'p');
  assert.deepEqual(res, { answered: false, reason: 'no-challenge' });
  assert.deepEqual(certCb.calls, [], 'the cert challenge is untouched');
  assert.deepEqual(record.sheet.closeCalls, [], 'the chooser stays open');
});

test('answerWithCredential resolves the presented challenge, closes the sheet (activated), no re-present', () => {
  const h = makeHarness();
  const record = h.makeRecord();
  record.activeTabWcId = 10;
  const cb = h.challenge(record, 10);
  h.openAuthSheet(record);
  const res = h.store.answerWithCredential(10, { username: 'fixtureuser', password: 'fixturepass' });
  assert.deepEqual(res, { answered: true });
  assert.deepEqual(cb.calls, [['fixtureuser', 'fixturepass']]);
  assert.deepEqual(record.sheet.closeCalls, ['activated']);
  h.store.notifyWindowFocused(record);
  h.store.notifyTabActivated(record, 10);
  assert.equal(h.presents.length, 1, 'an answered challenge NEVER re-presents');
  assert.equal(cb.calls.length, 1);
});

test('answerWithCredential answers a HELD (unpresented) challenge too, without touching the sheet', () => {
  const h = makeHarness();
  const record = h.makeRecord();
  record.activeTabWcId = 10;
  h.addGuest(record, 10);
  const cb = h.challenge(record, 20); // background hold — never presented
  const res = h.store.answerWithCredential(20, { username: 'u', password: 'p' });
  assert.deepEqual(res, { answered: true });
  assert.deepEqual(cb.calls, [['u', 'p']]);
  assert.deepEqual(record.sheet.closeCalls, [], 'no sheet was open for it — nothing to close');
});

test('answerWithCredential with no pending challenge → { answered:false, reason:no-challenge }', () => {
  const h = makeHarness();
  assert.deepEqual(h.store.answerWithCredential(77, { username: 'u', password: 'p' }), { answered: false, reason: 'no-challenge' });
});

test('double answer (agent then sheet) resolves exactly once; the loser reports no-challenge', () => {
  const h = makeHarness();
  const record = h.makeRecord();
  record.activeTabWcId = 10;
  const cb = h.challenge(record, 10);
  h.openAuthSheet(record);
  assert.equal(h.store.answerWithCredential(10, { username: 'a', password: 'b' }).answered, true);
  const late = h.store.answerFromSheet(record, 'c', 'd');
  assert.deepEqual(late, { answered: false, reason: 'no-challenge' });
  assert.deepEqual(cb.calls, [['a', 'b']], 'first answer wins, exactly once');
});

test('submit-after-cancel: a cancelled challenge cannot be answered', () => {
  const h = makeHarness();
  const record = h.makeRecord();
  record.activeTabWcId = 10;
  const cb = h.challenge(record, 10);
  h.openAuthSheet(record);
  record.sheet.closeMenuOverlay('escape'); // resolve-cancel
  assert.deepEqual(cb.calls, [[]]);
  const res = h.store.answerFromSheet(record, 'u', 'p');
  assert.deepEqual(res, { answered: false, reason: 'no-challenge' });
  assert.equal(cb.calls.length, 1);
});

// ---------------------------------------------------------------------------
// Cert selection path (selectCertFromSheet — M14 F1 L3)
// ---------------------------------------------------------------------------

test('selectCertFromSheet resolves callback(list[i]) LEDGER-FIRST; the trailing activated close is an exactly-once no-op that presents the next challenge', () => {
  const h = makeHarness();
  const record = h.makeRecord();
  record.activeTabWcId = 10;
  const certB = { subjectName: 'CN=Second', issuerName: 'CN=CA' };
  const cb = h.certChallenge(record, 10, { list: [FIXTURE_CERT, certB] });
  const cb2 = h.certChallenge(record, 10); // queued behind
  h.openCertSheet(record);
  const res = h.store.selectCertFromSheet(record, 1);
  assert.deepEqual(res, { answered: true });
  assert.equal(cb.calls.length, 1, 'exactly once');
  assert.equal(cb.calls[0].length, 1, 'callback(cert) — one argument');
  assert.equal(cb.calls[0][0], certB, 'the RAW list object by identity (index-resolved main-side)');
  // The register-overlay-ipc activated handler's TRAILING close (this ordering
  // is the review-critical detail: ledger first, close second).
  record.sheet.closeMenuOverlay('activated');
  assert.equal(cb.calls.length, 1, 'the trailing activated close cannot cancel the answered selection');
  assert.equal(h.presents.length, 2, 'the close is the queue event that presents the next challenge');
  assert.deepEqual(cb2.calls, []);
});

test('selectCertFromSheet out-of-range / non-integer index resolves CANCEL (no-args), exactly once — never a throw', () => {
  for (const badIndex of [2, -1, 1.5, NaN, Infinity]) {
    const h = makeHarness();
    const record = h.makeRecord();
    record.activeTabWcId = 10;
    const cb = h.certChallenge(record, 10, { list: [FIXTURE_CERT, { subjectName: 'b', issuerName: 'c' }] });
    h.openCertSheet(record);
    const res = h.store.selectCertFromSheet(record, /** @type {any} */ (badIndex));
    assert.deepEqual(res, { answered: true }, `index ${badIndex} still resolves (as cancel)`);
    assert.deepEqual(cb.calls, [[]], `index ${badIndex} → no-args cancel`);
    record.sheet.closeMenuOverlay('activated');
    assert.equal(cb.calls.length, 1);
  }
});

test('selectCertFromSheet refuses when nothing is presented, and when the presented challenge is basic-auth (kind guard)', () => {
  const h = makeHarness();
  const record = h.makeRecord();
  assert.deepEqual(h.store.selectCertFromSheet(record, 0), { answered: false, reason: 'no-challenge' });
  record.activeTabWcId = 10;
  const basicCb = h.challenge(record, 10);
  h.openAuthSheet(record);
  assert.deepEqual(h.store.selectCertFromSheet(record, 0), { answered: false, reason: 'no-challenge' });
  assert.deepEqual(basicCb.calls, [], 'the basic-auth challenge is untouched');
});

// ---------------------------------------------------------------------------
// Agent-seam kind filter (M14 F1 L3): cert challenges are human-only
// ---------------------------------------------------------------------------

test('answerWithCredential NEVER answers a client-cert challenge — only-cert-pending reports no-challenge', () => {
  const h = makeHarness();
  const record = h.makeRecord();
  record.activeTabWcId = 10;
  const certCb = h.certChallenge(record, 10);
  h.openCertSheet(record);
  const res = h.store.answerWithCredential(10, { username: 'u', password: 'p' });
  assert.deepEqual(res, { answered: false, reason: 'no-challenge' });
  assert.deepEqual(certCb.calls, [], 'the native Certificate callback never sees a string credential');
  assert.deepEqual(record.sheet.closeCalls, [], 'the chooser stays open');
});

test('agent answers a QUEUED basic-auth challenge while a cert-picker is presented on the same tab — without touching the visible chooser (named edge case)', () => {
  const h = makeHarness();
  const record = h.makeRecord();
  record.activeTabWcId = 10;
  const certCb = h.certChallenge(record, 10); // presented
  const basicCb = h.challenge(record, 10); // queued behind the chooser
  h.openCertSheet(record);
  const res = h.store.answerWithCredential(10, { username: 'u', password: 'p' });
  assert.deepEqual(res, { answered: true });
  assert.deepEqual(basicCb.calls, [['u', 'p']], 'the queued basic-auth challenge is the agent target');
  assert.deepEqual(certCb.calls, [], 'the presented cert challenge is untouched');
  assert.deepEqual(record.sheet.closeCalls, [], 'the visible chooser is not closed (state.presented early-return keeps it)');
  assert.equal(h.presents.length, 1, 'no second sheet while the chooser is up');
});

test('getPendingChallenge skips client-cert challenges: only-cert → null; cert presented + basic queued → the basic (non-secret fields only)', () => {
  const h = makeHarness();
  const record = h.makeRecord();
  record.activeTabWcId = 10;
  h.certChallenge(record, 10);
  assert.equal(h.store.getPendingChallenge(10), null, 'a cert challenge is invisible to the agent read seam');
  h.challenge(record, 10, { url: 'http://127.0.0.1:8091/protected', realm: 'fixture' });
  const pending = h.store.getPendingChallenge(10);
  assert.deepEqual(pending, {
    wcId: 10, host: '127.0.0.1', port: 8091, realm: 'fixture', url: 'http://127.0.0.1:8091/protected',
  });
  assert.equal('callback' in pending, false);
  assert.equal('list' in pending, false);
  assert.equal(h.store.getPendingChallenge(99), null);
});

// ---------------------------------------------------------------------------
// Source-scan pin (AC): no code path abandons a callback. Structural half of
// the guarantee: the Electron callback property is read at EXACTLY ONE site —
// inside resolveOnce, the exactly-once ledger (which now carries the kind-
// aware resolution union: both kinds' answer shapes live there by design) —
// so every answer/cancel/selection path (including both handlers' guard
// cancels, which mint a challenge shell and route through it) is provably
// funneled through the ledger. The behavioral half is the matrix above.
// ---------------------------------------------------------------------------

test('source-scan: `challenge.callback` is read at exactly one site, inside resolveOnce (the exactly-once choke point)', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../src/main/auth-challenges.js'), 'utf8');
  const masked = maskComments(source);
  const occurrences = masked.split('challenge.callback').length - 1;
  assert.equal(occurrences, 1, 'exactly one challenge.callback read site (the resolveOnce ledger)');
  const readIdx = masked.indexOf('challenge.callback');
  const resolveIdx = masked.indexOf('function resolveOnce');
  const nextFnIdx = masked.indexOf('function presentNext');
  assert.ok(resolveIdx !== -1 && nextFnIdx !== -1);
  assert.ok(readIdx > resolveIdx && readIdx < nextFnIdx, 'the read site lives inside resolveOnce');
  // And no direct positional-arg invocation of a raw `callback` identifier
  // exists outside resolveOnce's `cb` alias (a second invocation site would
  // bypass the ledger).
  const bareInvocations = masked.match(/(?<![.\w$])callback\s*\(/g) || [];
  assert.equal(bareInvocations.length, 0, 'no bare callback(...) invocation anywhere — only the ledger answers it');
});

// ---------------------------------------------------------------------------
// M14 F2 L2 — popup challenge matrix (DD1b as flight-log refined, kind-
// agnostic). Popup challenges route popup-registry-FIRST to the OWNING record,
// present on the record's OWN chrome with a `popup: true` payload field, are
// eligible independent of activeTabWcId / opener liveness / occlusion, and
// resolve-cancel on popup destroy ('tab-close' via the cancelChallengesForPopup
// delegation), navigation-away ('navigated'), and opener re-key ('moved').
// ---------------------------------------------------------------------------

const POPUP_KINDS = [
  {
    kind: 'basic-auth',
    menuType: 'auth-basic',
    channel: 'auth-challenge-present',
    enqueue: (h, popupWcId, opts) => h.popupChallenge(popupWcId, opts),
    openSheet: (h, record) => h.openAuthSheet(record),
  },
  {
    kind: 'client-cert',
    menuType: 'cert-picker',
    channel: 'cert-challenge-present',
    enqueue: (h, popupWcId, opts) => h.popupCertChallenge(popupWcId, opts),
    openSheet: (h, record) => h.openCertSheet(record),
  },
];

for (const K of POPUP_KINDS) {
  test(`[popup ${K.kind}] routes registry-first to the OWNING record and presents on the record's OWN chrome with popup: true`, () => {
    const h = makeHarness();
    const record = h.makeRecord();
    record.activeTabWcId = 10; // some unrelated active tab
    h.addGuest(record, 10);
    h.addPopup(record, 701, { openerWcId: 10 });
    const cb = K.enqueue(h, 701);

    assert.equal(h.presents.length, 1, 'presents immediately');
    const p = h.presents[0];
    assert.equal(p.via, 'record', 'presentation resolves record.chromeView.webContents directly — never chromeForTab(popup)');
    assert.equal(p.winId, record.win.id);
    assert.equal(p.channel, K.channel);
    assert.equal(p.payload.wcId, 701);
    assert.equal(p.payload.popup, true, 'the DD5 marker field rides the payload');
    assert.deepEqual(cb.calls, [], 'pending, prompted');
  });

  test(`[popup ${K.kind}] eligibility is INDEPENDENT of activeTabWcId, opener-tab liveness (dead openerWcId), and popup occlusion`, () => {
    const h = makeHarness();
    const record = h.makeRecord();
    record.activeTabWcId = 55; // popup's opener is NOT the active tab
    // Dead opener: openerWcId 900 has no guest entry anywhere (the tolerated-
    // dead-openerWcId seam) — eligibility must not consult it.
    h.addPopup(record, 701, { openerWcId: 900 });
    K.enqueue(h, 701);
    assert.equal(h.presents.length, 1, 'presents with a foreign active tab and a dead opener');

    // Occlusion/minimization of the POPUP window is not modeled by the store at
    // all — structurally independent. Re-present after an occlusion close works
    // through the standard triggers:
    K.openSheet(h, record);
    record.sheet.closeMenuOverlay('blur');
    h.store.notifyWindowFocused(record);
    assert.equal(h.presents.length, 2, 'occlusion close + refocus re-present, tab parity');
  });

  test(`[popup ${K.kind}] standard record-level gates still hold: fullscreen hold, open-menu hold, one presented per window`, () => {
    const h = makeHarness();
    const record = h.makeRecord();
    record.activeTabWcId = 10;
    h.addPopup(record, 701, { openerWcId: 10 });

    record.htmlFullscreen = { wcId: 10, savedBounds: {}, pendingBounds: null };
    const cb = K.enqueue(h, 701);
    assert.equal(h.presents.length, 0, 'held while the owner window is fullscreen');
    record.htmlFullscreen = null;
    record.sheet.menu = { menuType: 'kebab', token: 3 };
    h.store.notifyFullscreenExited(record);
    assert.equal(h.presents.length, 0, 'held while another menu is open');
    record.sheet.menu = null;
    h.store.notifyWindowFocused(record);
    assert.equal(h.presents.length, 1, 'presents once the gates clear');
    assert.deepEqual(cb.calls, []);
  });

  test(`[popup ${K.kind}] popup destroyed (the cancelChallengesForPopup delegation: cancelForTab 'tab-close') resolve-cancels queued + presented and closes the sheet`, () => {
    const h = makeHarness();
    const record = h.makeRecord();
    record.activeTabWcId = 10;
    h.addPopup(record, 701, { openerWcId: 10 });
    const cb1 = K.enqueue(h, 701); // presented
    const cb2 = K.enqueue(h, 701); // queued behind it
    K.openSheet(h, record);

    // main.js's seam body, verbatim (the thin delegation).
    h.store.cancelForTab(701, 'tab-close');
    assert.deepEqual(cb1.calls, [[]], 'presented resolved exactly once');
    assert.deepEqual(cb2.calls, [[]], 'queued sibling resolved too');
    assert.deepEqual(record.sheet.closeCalls, ['tab-close'], 'visible sheet closed with a resolution-family reason');
    // Idempotent second invocation (owner-close path double-fires the seam).
    h.store.cancelForTab(701, 'tab-close');
    assert.equal(cb1.calls.length + cb2.calls.length, 2);
  });

  test(`[popup ${K.kind}] opener re-key cancels with 'moved' — no hung callback across a cross-window move (cancel-on-rekey ruling)`, () => {
    const h = makeHarness();
    const record = h.makeRecord();
    record.activeTabWcId = 10;
    h.addPopup(record, 701, { openerWcId: 10 });
    const cb = K.enqueue(h, 701);
    K.openSheet(h, record);
    // register-tab-ipc's move hook: rekeyForRecord (registry-side) + this call.
    h.store.cancelForTab(701, 'moved');
    assert.deepEqual(cb.calls, [[]], 'resolved exactly once — never a strand, never a migration');
    assert.deepEqual(record.sheet.closeCalls, ['tab-close'], 'sheet closes via the non-navigated mapping');
  });

  test(`[popup ${K.kind}] navigation-away ('navigated') cancels — DD2 max-staleness holds for popups`, () => {
    const h = makeHarness();
    const record = h.makeRecord();
    h.addPopup(record, 701, { openerWcId: 900 });
    const cb = K.enqueue(h, 701);
    K.openSheet(h, record);
    h.store.cancelForTab(701, 'navigated');
    assert.deepEqual(cb.calls, [[]]);
    assert.deepEqual(record.sheet.closeCalls, ['navigation']);
  });

  test(`[popup ${K.kind}] cancelForWindow sweeps popup challenges with the whole queue (DD1f owner-close path)`, () => {
    const h = makeHarness();
    const record = h.makeRecord();
    record.activeTabWcId = 10;
    h.addGuest(record, 10);
    h.addPopup(record, 701, { openerWcId: 10 });
    const tabCb = h.challenge(record, 10);
    const popCb = K.enqueue(h, 701);
    h.store.cancelForWindow(record);
    assert.deepEqual(tabCb.calls, [[]]);
    assert.deepEqual(popCb.calls, [[]], 'popup challenges die with the window — no popup awareness needed');
  });
}

// Every DD2 bucket applies to popup challenges (AC4 parametric extension):
// resolution reasons + the fail-safe unknown default resolve-cancel; occlusion
// reasons survive and re-present. Kind-agnostic via POPUP_KINDS.
for (const K of POPUP_KINDS) {
  for (const reason of ['escape', 'outside-click', 'activated', 'tab-close', 'teardown', 'totally-unknown-reason']) {
    test(`[popup ${K.kind}] sheet close '${reason}' maps to RESOLVE-CANCEL (exactly-once, fail-safe default included)`, () => {
      const h = makeHarness();
      const record = h.makeRecord();
      h.addPopup(record, 701, { openerWcId: 900 });
      const cb = K.enqueue(h, 701);
      K.openSheet(h, record);
      record.sheet.closeMenuOverlay(reason);
      assert.deepEqual(cb.calls, [[]], `'${reason}' must cancel the popup challenge's callback`);
      h.store.notifySheetClosed(record, K.menuType, reason);
      assert.equal(cb.calls.length, 1, 'exactly once');
    });
  }

  for (const reason of ['blur', 'superseded', 'tab-hide', 'tab-switch']) {
    test(`[popup ${K.kind}] sheet close '${reason}' is OCCLUSION — the popup challenge survives and re-presents`, () => {
      const h = makeHarness();
      const record = h.makeRecord();
      h.addPopup(record, 701, { openerWcId: 900 });
      const cb = K.enqueue(h, 701);
      K.openSheet(h, record);
      record.sheet.closeMenuOverlay(reason);
      assert.deepEqual(cb.calls, [], `'${reason}' must NOT resolve the callback`);
      h.store.notifyWindowFocused(record);
      assert.equal(h.presents.length, 2, 're-presents at the refocus trigger');
      assert.equal(h.presents.at(-1).payload.popup, true, 'the re-present still carries the marker');
    });
  }
}

test('two popups from one opener: FIFO on the owning window single queue — one sheet at a time (leg edge case)', () => {
  const h = makeHarness();
  const record = h.makeRecord();
  record.activeTabWcId = 10;
  h.addPopup(record, 701, { openerWcId: 10 });
  h.addPopup(record, 702, { openerWcId: 10 });
  const cb1 = h.popupChallenge(701);
  const cb2 = h.popupChallenge(702);
  assert.equal(h.presents.length, 1, 'one prompt at a time');
  assert.equal(h.presents[0].payload.wcId, 701, 'FIFO head first');
  h.openAuthSheet(record);
  record.sheet.closeMenuOverlay('escape');
  assert.deepEqual(cb1.calls, [[]]);
  assert.deepEqual(cb2.calls, []);
  assert.equal(h.presents.length, 2, 'the queue event presents the second popup challenge');
  assert.equal(h.presents[1].payload.wcId, 702);
});

test('a popup challenge queued BEHIND a held background-tab challenge presents (first ELIGIBLE, not first queued)', () => {
  const h = makeHarness();
  const record = h.makeRecord();
  record.activeTabWcId = 10;
  h.addGuest(record, 10);
  const heldCb = h.challenge(record, 20); // background tab — holds
  assert.equal(h.presents.length, 0);
  h.addPopup(record, 701, { openerWcId: 10 });
  const popCb = h.popupChallenge(701);
  assert.equal(h.presents.length, 1, 'the popup challenge is eligible and presents');
  assert.equal(h.presents[0].payload.wcId, 701);
  assert.deepEqual(heldCb.calls, [], 'the held tab challenge stays queued');
  assert.deepEqual(popCb.calls, []);
});

test('TAB presentation payloads are UNCHANGED: no popup field ever rides a tab challenge (both kinds)', () => {
  const h = makeHarness();
  const record = h.makeRecord();
  record.activeTabWcId = 10;
  h.challenge(record, 10);
  assert.equal(h.presents.length, 1);
  assert.equal('popup' in h.presents[0].payload, false, 'basic-auth tab payload contract frozen');
  assert.equal(h.presents[0].via, undefined, 'tab presentation still routes chromeForTab');
  record.sheet.menu = { menuType: 'auth-basic', token: 1 };
  record.sheet.closeMenuOverlay('escape');

  const rec2 = h.makeRecord();
  rec2.activeTabWcId = 30;
  h.certChallenge(rec2, 30);
  assert.equal('popup' in h.presents.at(-1).payload, false, 'client-cert tab payload contract frozen');
});

test('agent seams on popup challenges: getPendingChallenge reads the popup basic-auth challenge; answerWithCredential answers it and closes the sheet; cert kind stays invisible', () => {
  const h = makeHarness();
  const record = h.makeRecord();
  h.addPopup(record, 701, { openerWcId: 900 });
  const cb = h.popupChallenge(701, { url: 'http://127.0.0.1:8091/oauth', realm: 'oauth' });
  h.openAuthSheet(record);

  const pending = h.store.getPendingChallenge(701);
  assert.deepEqual(pending, { wcId: 701, host: '127.0.0.1', port: 8091, realm: 'oauth', url: 'http://127.0.0.1:8091/oauth' },
    'non-secret read seam works on a popup wcId (origin match input for vaultAnswerAuth)');

  const res = h.store.answerWithCredential(701, { username: 'user', password: 'pass' });
  assert.deepEqual(res, { answered: true });
  assert.deepEqual(cb.calls, [['user', 'pass']]);
  assert.deepEqual(record.sheet.closeCalls, ['activated'], 'visible sheet closed with the answer reason');

  // Cert kind filter unchanged for popups: only a cert challenge pending → no-challenge.
  h.addPopup(record, 702, { openerWcId: 900 });
  h.popupCertChallenge(702);
  assert.equal(h.store.getPendingChallenge(702), null, 'cert challenges invisible to the agent seams');
  assert.deepEqual(h.store.answerWithCredential(702, { username: 'u', password: 'p' }), { answered: false, reason: 'no-challenge' });
});

test('a destroyed owning-record chrome makes the popup present a harmless no-op (guarded) — never a throw, callback still owned', () => {
  const h = makeHarness();
  const record = h.makeRecord();
  record.chromeView.webContents.isDestroyed = () => true;
  h.addPopup(record, 701, { openerWcId: 900 });
  const cb = h.popupChallenge(701);
  assert.equal(h.presents.length, 0, 'no send into a destroyed chrome (mid-teardown window)');
  assert.deepEqual(cb.calls, [], "not resolved here — teardown's cancelForWindow/seam owns the resolution");
  h.store.cancelForWindow(record);
  assert.deepEqual(cb.calls, [[]], 'and it does resolve exactly once at teardown');
});
