'use strict';

// Unit tests for src/main/automation/observe.js (the READ half — screenshots).
//
// Electron-free: observe.js does NOT require('electron') at the top, so these
// tests run under plain `node --test` with no Electron stub. Fake wc / fromId /
// activate / capturePage stand in for the real Electron handles. An immediate
// (no-op) waitForPaint is injected so no real timer ever fires.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  captureScreenshot,
  readDom,
  captureWindow,
  readAxTree,
  evaluate,
  injectScript,
  openDevTools,
  closeDevTools,
} = require('../../src/main/automation/observe');

// The exact code string readDom is required to pass to executeJavaScript — kept in lockstep
// with observe.js's module-level READ_DOM_SNIPPET const (a single-round-trip IIFE returning a
// consistent { url, title, html } snapshot). Mirrored here byte-for-byte; the
// 'snippet passed verbatim' test below asserts readDom evaluates this exact string.
const EXPECTED_READ_DOM_SNIPPET = '(() => ({' +
  ' url: location.href,' +
  ' title: document.title,' +
  ' html: document.documentElement ? document.documentElement.outerHTML : "" ' +
  '}))()';

// Canned DOM payload the fake executeJavaScript returns (stands in for the renderer-side
// snapshot). readDom must return this object shape unchanged.
const CANNED_DOM = { url: 'https://example.test/page', title: 'Example', html: '<html><body>hi</body></html>' };

// ---------------------------------------------------------------------------
// Helpers — build fake wc objects, deps, and a fake NativeImage
// ---------------------------------------------------------------------------

// Fake NativeImage: toPNG() returns a known Buffer so the base64 of its
// PNG bytes is deterministic — Buffer.from('PNGBYTES').toString('base64').
const PNG_BYTES = 'PNGBYTES';
function makeFakeImage() {
  return { toPNG() { return Buffer.from(PNG_BYTES); } };
}
const EXPECTED_B64 = Buffer.from(PNG_BYTES).toString('base64');

function makeGuestWc(id) {
  return {
    id,
    session: { __goldfinchInternal: false },
    isDestroyed() { return false; },
    /** @type {number} */
    _captureCount: 0,
    async capturePage() { this._captureCount += 1; return makeFakeImage(); },
    // readDom fake: records the code string + counts calls, returns a canned snapshot.
    /** @type {number} */
    _execCount: 0,
    /** @type {string|null} */
    _lastExecCode: null,
    async executeJavaScript(/** @type {string} */ code) {
      this._execCount += 1; this._lastExecCode = code; return { ...CANNED_DOM };
    },
  };
}

function makeInternalWc(id) {
  return {
    id,
    session: { __goldfinchInternal: true },
    isDestroyed() { return false; },
    _captureCount: 0,
    async capturePage() { this._captureCount += 1; return makeFakeImage(); },
    _execCount: 0,
    _lastExecCode: null,
    async executeJavaScript(/** @type {string} */ code) {
      this._execCount += 1; this._lastExecCode = code; return { ...CANNED_DOM };
    },
  };
}

function makeDestroyedWc(id) {
  return {
    id,
    session: { __goldfinchInternal: false },
    isDestroyed() { return true; },
    _captureCount: 0,
    async capturePage() { this._captureCount += 1; return makeFakeImage(); },
    _execCount: 0,
    _lastExecCode: null,
    async executeJavaScript(/** @type {string} */ code) {
      this._execCount += 1; this._lastExecCode = code; return { ...CANNED_DOM };
    },
  };
}

/**
 * Build a fake fromId lookup backed by a map of id → fake wc.
 * @param {Record<number, object>} map
 */
function makeFakeFromId(map) {
  return (/** @type {number} */ id) => map[id] ?? null;
}

// Immediate / no-op waitForPaint — never touches a real timer.
const noopWaitForPaint = async () => {};

// Fake webContents.debugger for readAxTree (Leg 3). Records an ordered _log of operations,
// counts attach/detach, and exposes an injectable sendImpl for the per-command behavior:
//   - attach(v) logs ['attach', v]; throws 'already attached' if attachThrows (the DevTools /
//     second-CDP-client conflict the live attach() raises — DD8), else bumps _attached.
//   - detach() logs ['detach'], bumps _detached; can be made to throw via detachThrows.
//   - sendCommand(method) logs ['send', method]; delegates to sendImpl when supplied, else returns
//     { nodes: axNodes } for getFullAXTree and {} otherwise.
// isAttached() mirrors the real API for parity; readAxTree never reads it (the module Set is the lock).
function makeDebugger({ attachThrows = false, detachThrows = false, axNodes = [], sendImpl } = {}) {
  const log = [];
  return {
    _log: log, _detached: 0, _attached: 0,
    attach(/** @type {string} */ v) { log.push(['attach', v]); if (attachThrows) throw new Error('already attached'); this._attached++; },
    detach() { log.push(['detach']); this._detached++; if (detachThrows) throw new Error('already detached'); },
    isAttached() { return this._attached > this._detached; }, // parity with real API; unused by readAxTree (the Set is the lock)
    sendCommand(/** @type {string} */ method, /** @type {any} */ params) {
      log.push(['send', method]);
      if (sendImpl) return sendImpl(method, params);
      if (method === 'Accessibility.getFullAXTree') return Promise.resolve({ nodes: axNodes });
      return Promise.resolve({});
    },
  };
}

// A controllable deferred promise (for the concurrent-lock test's pending sendCommand).
function makeDeferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// ---------------------------------------------------------------------------
// captureScreenshot — guest foreground-first (DD1/DD5)
// ---------------------------------------------------------------------------

test('captureScreenshot: guest — activate called BEFORE capturePage (ordering via callLog)', async () => {
  const guestWc = makeGuestWc(20);
  const callLog = [];

  const activate = async (/** @type {number} */ id) => { callLog.push({ what: 'activate', id }); };
  const originalCapture = guestWc.capturePage.bind(guestWc);
  guestWc.capturePage = async () => { callLog.push({ what: 'capturePage' }); return originalCapture(); };

  const deps = {
    fromId: makeFakeFromId({ 20: guestWc }),
    chromeContents: null,  // guestWc is not === chromeContents → classified as guest
    activate,
  };

  const result = await captureScreenshot(20, deps, { waitForPaint: noopWaitForPaint });

  const activateIdx = callLog.findIndex((e) => e.what === 'activate');
  const captureIdx = callLog.findIndex((e) => e.what === 'capturePage');
  assert.ok(activateIdx !== -1, 'activate must be called');
  assert.ok(captureIdx !== -1, 'capturePage must be called');
  assert.ok(activateIdx < captureIdx, 'activate must be called before capturePage');
  assert.equal(result, EXPECTED_B64);
});

test('captureScreenshot: guest — activate called exactly once with the wcId', async () => {
  const guestWc = makeGuestWc(21);
  const activateCalls = [];
  const activate = async (/** @type {number} */ id) => { activateCalls.push(id); };

  const deps = {
    fromId: makeFakeFromId({ 21: guestWc }),
    chromeContents: null,
    activate,
  };

  await captureScreenshot(21, deps, { waitForPaint: noopWaitForPaint });

  assert.equal(activateCalls.length, 1, 'activate must be called exactly once');
  assert.equal(activateCalls[0], 21, 'activate must be called with the wcId');
});

test('captureScreenshot: RE-RESOLVE proof — the SECOND (post-activate) handle is the one captured', async () => {
  // Back fromId with a counter so the first lookup (pre-activate) and the
  // second lookup (post-activate, the re-resolve) return DISTINCT fake wc
  // handles. The capturePage that fires must be the SECOND handle's — this
  // proves the stale-handle re-resolve, not merely that activate ran.
  const firstHandle = makeGuestWc(22);
  const secondHandle = makeGuestWc(22);

  let lookups = 0;
  const fromId = (/** @type {number} */ id) => {
    if (id !== 22) return null;
    lookups += 1;
    return lookups === 1 ? firstHandle : secondHandle;
  };

  const deps = {
    fromId,
    chromeContents: null,
    activate: async () => {},
  };

  const result = await captureScreenshot(22, deps, { waitForPaint: noopWaitForPaint });

  assert.equal(lookups, 2, 'fromId must be called twice (initial resolve + post-activate re-resolve)');
  assert.equal(firstHandle._captureCount, 0, 'the STALE pre-activate handle must NOT be captured');
  assert.equal(secondHandle._captureCount, 1, 'the FRESH post-activate handle must be the one captured');
  assert.equal(result, EXPECTED_B64);
});

test('captureScreenshot: chrome target — activate NOT called (chrome is always live)', async () => {
  const chromeWc = makeGuestWc(1);  // this object will be chromeContents
  const activateCalls = [];
  const activate = async (id) => { activateCalls.push(id); };

  const deps = {
    fromId: makeFakeFromId({ 1: chromeWc }),
    chromeContents: chromeWc,  // classify as 'chrome'
    activate,
  };

  const result = await captureScreenshot(1, deps, { waitForPaint: noopWaitForPaint });

  assert.equal(activateCalls.length, 0, 'activate must NOT be called for a chrome target');
  assert.equal(chromeWc._captureCount, 1, 'capturePage must still be called');
  assert.equal(result, EXPECTED_B64);
});

// ---------------------------------------------------------------------------
// captureScreenshot — resolve-rejection passthrough (DD6)
// ---------------------------------------------------------------------------

test('captureScreenshot: bad-handle (non-number wcId) → throws bad-handle', async () => {
  const deps = { fromId: makeFakeFromId({}), chromeContents: null };
  await assert.rejects(
    // @ts-expect-error — intentionally passing wrong type
    () => captureScreenshot('20', deps, { waitForPaint: noopWaitForPaint }),
    (err) => err instanceof Error && err.message.includes('automation: bad-handle')
  );
});

test('captureScreenshot: dead (isDestroyed) wcId → throws no-such-contents, no capture', async () => {
  const destroyed = makeDestroyedWc(55);
  const deps = { fromId: makeFakeFromId({ 55: destroyed }), chromeContents: null };
  await assert.rejects(
    () => captureScreenshot(55, deps, { waitForPaint: noopWaitForPaint }),
    (err) => err instanceof Error && err.message.includes('automation: no-such-contents')
  );
  assert.equal(destroyed._captureCount, 0, 'capturePage must not be called on a dead handle');
});

test('captureScreenshot: internal-session wcId → throws, NEITHER activate NOR capturePage called', async () => {
  const internalWc = makeInternalWc(77);
  const activateCalls = [];
  const activate = async (id) => { activateCalls.push(id); };

  const deps = {
    fromId: makeFakeFromId({ 77: internalWc }),
    chromeContents: null,
    activate,
  };

  await assert.rejects(
    () => captureScreenshot(77, deps, { waitForPaint: noopWaitForPaint }),
    (err) => err instanceof Error && err.message.includes('automation: internal-session')
  );
  assert.equal(activateCalls.length, 0, 'activate must NOT be called on the internal-session path');
  assert.equal(internalWc._captureCount, 0, 'capturePage must NOT be called on the internal-session path');
});

// ---------------------------------------------------------------------------
// captureScreenshot — base64 return shape
// ---------------------------------------------------------------------------

test('captureScreenshot: returns the base64 of the PNG buffer', async () => {
  const guestWc = makeGuestWc(60);
  const deps = {
    fromId: makeFakeFromId({ 60: guestWc }),
    chromeContents: null,
    activate: async () => {},
  };

  const result = await captureScreenshot(60, deps, { waitForPaint: noopWaitForPaint });

  assert.equal(result, Buffer.from('PNGBYTES').toString('base64'));
  assert.equal(typeof result, 'string');
});

// ---------------------------------------------------------------------------
// M09 F7 DD7 (recon S3) — captureScreenshot's capturePage await is BOUNDED.
// ---------------------------------------------------------------------------

test('captureScreenshot: capturePage that NEVER settles → REJECTS at the bound with the named capture-timeout (F7 DD7)', async (t) => {
  // The detached-but-live view model: resolveContents proves a view LIVE, never
  // ATTACHED, so every isDestroyed() guard passes and capturePage() hangs forever.
  // Pre-F7 this wedged the request with no server-side recovery (reproduced live on
  // the rig at leg-2 smoke step 0: no response in 20s). MockTimers per-test (never
  // file-global), per CLAUDE.md's recipe.
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const guestWc = makeGuestWc(70);
  guestWc.capturePage = () => new Promise(() => {});   // never settles — the S3 model

  const deps = { fromId: makeFakeFromId({ 70: guestWc }), chromeContents: null, activate: async () => {} };

  const p = captureScreenshot(70, deps, { waitForPaint: noopWaitForPaint });
  const assertion = assert.rejects(
    () => p,
    (err) => err instanceof Error && /^automation: capture-timeout — wcId 70 did not settle within 3000ms/.test(err.message),
  );

  await new Promise((r) => setImmediate(r));   // let the op reach its await
  t.mock.timers.tick(3000);                    // fire the bound
  await assertion;
});

// ---------------------------------------------------------------------------
// readDom — NEVER foregrounds its target (M09 F7 DD6), debugger-free
// executeJavaScript read.
//
// The contract INVERTED at F7 leg 2. Pre-F7 these pinned "activate called BEFORE
// executeJavaScript" and "the post-activate re-resolve is the handle read"; DD6
// deleted the activate branch outright, so the ordering no longer exists and the
// second resolve is gone. The two are RENAMED WITH INVERTED ASSERTIONS rather than
// deleted-and-readded, so `git blame` carries the intent shift. See captureScreenshot
// / readAxTree for the OTHER side of the asymmetry — those still activate, on purpose.
// ---------------------------------------------------------------------------

test('readDom: guest — activate is NEVER called, even when an activate dep IS present (F7 DD6)', async () => {
  // INVERTED at F7 leg 2 (was: 'activate called BEFORE executeJavaScript'). The primary
  // AC5 pin: a read must not steal the operator's foreground. Supplying a LIVE activate
  // dep is what makes this a real test rather than a tautology — the engine's shared deps
  // bag always carries one, so an absent-dep case would prove nothing about the op itself.
  const guestWc = makeGuestWc(120);
  const callLog = [];

  const activate = async (/** @type {number} */ id) => { callLog.push({ what: 'activate', id }); };
  guestWc.executeJavaScript = async (/** @type {string} */ code) => {
    callLog.push({ what: 'executeJavaScript', code }); return { ...CANNED_DOM };
  };

  const deps = {
    fromId: makeFakeFromId({ 120: guestWc }),
    chromeContents: null,  // guestWc is not === chromeContents → classified as guest
    activate,
  };

  const result = await readDom(120, deps);

  assert.equal(callLog.filter((e) => e.what === 'activate').length, 0,
    'activate must NOT be called: readDom reads a background guest without foregrounding it (DD6)');
  assert.equal(callLog.filter((e) => e.what === 'executeJavaScript').length, 1,
    'the read must still happen');
  assert.deepEqual(result, CANNED_DOM);
});

test('readDom: guest — resolves ONCE (no activate ⇒ no async hop ⇒ no stale-handle re-resolve) (F7 DD6)', async () => {
  // INVERTED at F7 leg 2 (was: 'RE-RESOLVE proof — the SECOND post-activate handle is the
  // one read'). With the activate branch gone there is no async hop between resolve and
  // read, so the handle cannot go stale and a second resolve would be dead code. Pinning
  // the SINGLE resolve is what stops it being "helpfully" restored.
  const firstHandle = makeGuestWc(122);
  const secondHandle = makeGuestWc(122);

  let lookups = 0;
  const fromId = (/** @type {number} */ id) => {
    if (id !== 122) return null;
    lookups += 1;
    return lookups === 1 ? firstHandle : secondHandle;
  };

  const deps = { fromId, chromeContents: null, activate: async () => {} };

  const result = await readDom(122, deps);

  assert.equal(lookups, 1, 'fromId must be called EXACTLY once — there is no post-activate re-resolve');
  assert.equal(firstHandle._execCount, 1, 'the sole resolved handle is the one read');
  assert.equal(secondHandle._execCount, 0, 'no second handle is ever resolved');
  assert.deepEqual(result, CANNED_DOM);
});

test('readDom: chrome target — activate NOT called (chrome never classifies guest; F7 DD6 makes this uniform)', async () => {
  // RE-WORDED at F7 leg 2. This passed pre-F7 because chrome was EXEMPT from the guest
  // activate branch ('chrome is always live'). That branch is gone, so the original
  // rationale no longer operates — it now passes because readDom activates NOTHING. Kept
  // (not retired) as the chrome-target read regression, with the reason corrected so the
  // next reader is not misled about the mechanism.
  const chromeWc = makeGuestWc(1);  // this object will be chromeContents
  const activateCalls = [];
  const activate = async (id) => { activateCalls.push(id); };

  const deps = {
    fromId: makeFakeFromId({ 1: chromeWc }),
    chromeContents: chromeWc,  // classify as 'chrome'
    activate,
  };

  const result = await readDom(1, deps);

  assert.equal(activateCalls.length, 0, 'activate must NOT be called for a chrome target');
  assert.equal(chromeWc._execCount, 1, 'executeJavaScript must still be called');
  assert.deepEqual(result, CANNED_DOM);
});

test('readDom: guest with no activate dep — reads WITHOUT foregrounding', async () => {
  // NOTE (F7 leg 2): pre-F7 the absent-dep case was a SPECIAL case — the discriminator
  // between "foregrounds" and "does not". DD6 made it the GENERAL case, so this no longer
  // discriminates anything by itself. Retained only as the absent-dep smoke (the op must
  // not deref a missing dep); the REAL AC5 pin is the 'activate is NEVER called, even when
  // an activate dep IS present' test above.
  const guestWc = makeGuestWc(123);

  const result = await readDom(123, { fromId: makeFakeFromId({ 123: guestWc }), chromeContents: null });

  assert.equal(guestWc._execCount, 1, 'executeJavaScript must be called even with no activate dep');
  assert.deepEqual(result, CANNED_DOM);
});

// ---------------------------------------------------------------------------
// M09 F7 DD6 — THE READ/ACT ASYMMETRY, pinned in ONE place.
//
// The predicate: an op that needs RENDERED OUTPUT raises the owning window; an op
// that reads live JS/DOM state does not. The individual ops are pinned above and
// below; this test states the CONTRAST directly, so a future refactor that
// "harmonizes the observe ops" (in EITHER direction) fails here with the reason
// spelled out, rather than silently re-breaking one half of S1.
// ---------------------------------------------------------------------------

test('[F7 DD6] the observe read/act asymmetry: captureScreenshot + readAxTree ACTIVATE; readDom + evaluate DO NOT — same guest, same deps', async () => {
  const calls = { capture: [], ax: [], dom: [], evaluate: [] };

  const mk = (/** @type {number} */ id, /** @type {string} */ bucket) => {
    const wc = makeGuestWc(id);
    wc.debugger = makeDebugger({ axNodes: [] });
    return {
      wc,
      deps: {
        fromId: makeFakeFromId({ [id]: wc }),
        chromeContents: null,                 // → classifies 'guest' for all four ops
        activate: async (/** @type {number} */ i) => { calls[bucket].push(i); },
      },
    };
  };

  const a = mk(900, 'capture');
  const b = mk(901, 'ax');
  const c = mk(902, 'dom');
  const d = mk(903, 'evaluate');

  await captureScreenshot(900, a.deps, { waitForPaint: noopWaitForPaint });
  await readAxTree(901, b.deps);
  await readDom(902, c.deps);
  await evaluate(903, 'location.href', d.deps);

  // RENDERED-OUTPUT ops raise (pixels; the AX tree is a rendered artifact).
  assert.deepEqual(calls.capture, [900], 'captureScreenshot MUST activate — it needs pixels');
  assert.deepEqual(calls.ax, [901], 'readAxTree MUST activate — the AX tree is a rendered artifact');
  // LIVE-STATE reads do not — executeJavaScript works fine on a background guest, and a
  // read that steals the operator's foreground is a worse bug than the one DD6 fixes.
  assert.deepEqual(calls.dom, [], 'readDom MUST NOT activate (DD6)');
  assert.deepEqual(calls.evaluate, [], 'evaluate MUST NOT activate (DD6)');
});

// ---------------------------------------------------------------------------
// readDom — resolve-rejection passthrough (DD6); executeJavaScript count 0 on each
// ---------------------------------------------------------------------------

test('readDom: bad-handle (non-number wcId) → throws bad-handle, no read', async () => {
  const deps = { fromId: makeFakeFromId({}), chromeContents: null };
  await assert.rejects(
    // @ts-expect-error — intentionally passing wrong type
    () => readDom('120', deps),
    (err) => err instanceof Error && err.message.includes('automation: bad-handle')
  );
});

test('readDom: dead (isDestroyed) wcId → throws no-such-contents, no read', async () => {
  const destroyed = makeDestroyedWc(155);
  const deps = { fromId: makeFakeFromId({ 155: destroyed }), chromeContents: null };
  await assert.rejects(
    () => readDom(155, deps),
    (err) => err instanceof Error && err.message.includes('automation: no-such-contents')
  );
  assert.equal(destroyed._execCount, 0, 'executeJavaScript must not be called on a dead handle');
});

test('readDom: internal-session wcId → throws, NEITHER activate NOR executeJavaScript called', async () => {
  const internalWc = makeInternalWc(177);
  const activateCalls = [];
  const activate = async (id) => { activateCalls.push(id); };

  const deps = {
    fromId: makeFakeFromId({ 177: internalWc }),
    chromeContents: null,
    activate,
  };

  await assert.rejects(
    () => readDom(177, deps),
    (err) => err instanceof Error && err.message.includes('automation: internal-session')
  );
  assert.equal(activateCalls.length, 0, 'activate must NOT be called on the internal-session path');
  assert.equal(internalWc._execCount, 0, 'executeJavaScript must NOT be called on the internal-session path');
});

// ---------------------------------------------------------------------------
// readDom — return shape + exact snippet
// ---------------------------------------------------------------------------

test('readDom: returns the { url, title, html } shape from the renderer read', async () => {
  const guestWc = makeGuestWc(160);
  const deps = { fromId: makeFakeFromId({ 160: guestWc }), chromeContents: null, activate: async () => {} };

  const result = await readDom(160, deps);

  assert.deepEqual(Object.keys(result).sort(), ['html', 'title', 'url']);
  assert.equal(result.url, CANNED_DOM.url);
  assert.equal(result.title, CANNED_DOM.title);
  assert.equal(result.html, CANNED_DOM.html);
});

test('readDom: passes the exact READ_DOM_SNIPPET string to executeJavaScript', async () => {
  const guestWc = makeGuestWc(161);
  const deps = { fromId: makeFakeFromId({ 161: guestWc }), chromeContents: null, activate: async () => {} };

  await readDom(161, deps);

  assert.equal(guestWc._lastExecCode, EXPECTED_READ_DOM_SNIPPET,
    'readDom must pass the exact single-round-trip snapshot snippet to executeJavaScript');
});

// ---------------------------------------------------------------------------
// captureWindow — whole-window path + nullish-chrome throw
// ---------------------------------------------------------------------------

test('captureWindow: calls grabWindow() and returns its result', async () => {
  let called = false;
  const grabWindow = async () => { called = true; return EXPECTED_B64; };
  const result = await captureWindow({ grabWindow });
  assert.ok(called, 'grabWindow must be called');
  assert.equal(result, EXPECTED_B64);
});

test('captureWindow: nullish grabWindow → throws "automation: chrome window unavailable" verbatim', async () => {
  await assert.rejects(
    () => captureWindow({ grabWindow: null }),
    (err) => err instanceof Error && err.message === 'automation: chrome window unavailable'
  );
  await assert.rejects(
    () => captureWindow({ grabWindow: undefined }),
    (err) => err instanceof Error && err.message === 'automation: chrome window unavailable'
  );
});

test('captureWindow: grabWindow returning null → throws "automation: chrome window unavailable"', async () => {
  await assert.rejects(
    () => captureWindow({ grabWindow: async () => null }),
    (err) => err instanceof Error && err.message === 'automation: chrome window unavailable'
  );
});

// ---------------------------------------------------------------------------
// readAxTree — in-process webContents.debugger a11y read (Leg 3, DD3/DD4/DD7/DD8)
//
// readAxTree now delegates to withDebuggerSession (cdp.js). Each test attaches a fake debugger
// (makeDebugger) onto a guest wc. The shared `attached` Set lock (cdp.js) is shared across
// readAxTree AND scroll — every test uses a DISTINCT wcId to keep the lock state isolated.
// ---------------------------------------------------------------------------

// Canned AX nodes the happy-path fake returns (raw, no projection — DD4).
const CANNED_AX_NODES = [
  { nodeId: '1', role: { value: 'RootWebArea' }, backendNodeId: 100 },
  { nodeId: '2', role: { value: 'button' }, backendNodeId: 101 },
];

test('readAxTree: happy path — attach(\'1.3\'), enable BEFORE getFullAXTree, returns nodes, detach in finally, lock released', async () => {
  const dbg = makeDebugger({ axNodes: CANNED_AX_NODES });
  const guestWc = makeGuestWc(300);
  guestWc.debugger = dbg;

  const deps = { fromId: makeFakeFromId({ 300: guestWc }), chromeContents: null, activate: async () => {} };

  const result = await readAxTree(300, deps);

  // attach called with EXACTLY '1.3'
  assert.deepEqual(dbg._log[0], ['attach', '1.3']);
  // Accessibility.enable logged BEFORE Accessibility.getFullAXTree (the ordering, not just both ran)
  const enableIdx = dbg._log.findIndex((e) => e[0] === 'send' && e[1] === 'Accessibility.enable');
  const treeIdx = dbg._log.findIndex((e) => e[0] === 'send' && e[1] === 'Accessibility.getFullAXTree');
  assert.ok(enableIdx !== -1 && treeIdx !== -1, 'both enable and getFullAXTree must be sent');
  assert.ok(enableIdx < treeIdx, 'Accessibility.enable must be sent before Accessibility.getFullAXTree');
  // returns the raw nodes array
  assert.deepEqual(result, CANNED_AX_NODES);
  // detach ran in the finally exactly once
  assert.equal(dbg._detached, 1, 'detach must run once in the finally');
  // lock released — a subsequent call on the same wcId succeeds
  const second = await readAxTree(300, deps);
  assert.deepEqual(second, CANNED_AX_NODES, 'lock must be released — a subsequent call succeeds');
});

test('readAxTree: empty-tree success — { nodes: [] } returns [] (NOT a refusal; Array.isArray true)', async () => {
  const dbg = makeDebugger({ axNodes: [] });
  const guestWc = makeGuestWc(301);
  guestWc.debugger = dbg;

  const result = await readAxTree(301, { fromId: makeFakeFromId({ 301: guestWc }), chromeContents: null, activate: async () => {} });

  assert.ok(Array.isArray(result), 'empty tree must be an Array (a valid success), not a refusal object');
  assert.deepEqual(result, []);
  assert.equal(dbg._detached, 1, 'detach still runs on the empty-tree success path');
});

test('readAxTree: missing nodes ({}) returns [] (defensive empty-is-success)', async () => {
  // getFullAXTree resolves with no `nodes` key → defensive [] (empty is a valid success, DD4).
  const dbg = makeDebugger({ sendImpl: (method) => {
    if (method === 'Accessibility.getFullAXTree') return Promise.resolve({});
    return Promise.resolve({});
  } });
  const guestWc = makeGuestWc(302);
  guestWc.debugger = dbg;

  const result = await readAxTree(302, { fromId: makeFakeFromId({ 302: guestWc }), chromeContents: null, activate: async () => {} });

  assert.ok(Array.isArray(result));
  assert.deepEqual(result, []);
});

test('readAxTree: attach-throw refusal — returns { debugger-unavailable, attach-failed }, no detach, lock released', async () => {
  const dbg = makeDebugger({ attachThrows: true });
  const guestWc = makeGuestWc(303);
  guestWc.debugger = dbg;

  const deps = { fromId: makeFakeFromId({ 303: guestWc }), chromeContents: null, activate: async () => {} };

  const result = await readAxTree(303, deps);

  assert.deepEqual(result, { automation: 'debugger-unavailable', reason: 'attach-failed', wcId: 303 });
  assert.equal(dbg._detached, 0, 'never attached (attach threw) → never detached');
  // lock released — a subsequent call attempts attach again (and throws again → refusal)
  const second = await readAxTree(303, deps);
  assert.deepEqual(second, { automation: 'debugger-unavailable', reason: 'attach-failed', wcId: 303 },
    'lock must be released even on the attach-throw path');
});

test('readAxTree: concurrent-lock refusal — second un-awaited call returns { locked }, attach called ONCE, lock released after', async () => {
  // sendImpl returns a deferred promise we resolve manually, holding the first call inside the
  // locked region. A second un-awaited call on the SAME wcId must hit the synchronous lock and
  // return the locked refusal WITHOUT a second attach.
  const deferred = makeDeferred();
  const dbg = makeDebugger({ sendImpl: (method) => {
    if (method === 'Accessibility.getFullAXTree') return deferred.promise;
    return Promise.resolve({});
  } });
  const guestWc = makeGuestWc(304);
  guestWc.debugger = dbg;

  const deps = { fromId: makeFakeFromId({ 304: guestWc }), chromeContents: null, activate: async () => {} };

  const firstP = readAxTree(304, deps);          // NOT awaited — parked on the deferred getFullAXTree
  const second = await readAxTree(304, deps);    // hits the synchronous lock

  assert.deepEqual(second, { automation: 'debugger-unavailable', reason: 'locked', wcId: 304 });
  const attachCount = dbg._log.filter((e) => e[0] === 'attach').length;
  assert.equal(attachCount, 1, 'attach must be called exactly ONCE (the locked call never attaches)');

  // resolve the deferred → the first call completes with the nodes
  deferred.resolve({ nodes: CANNED_AX_NODES });
  const first = await firstP;
  assert.deepEqual(first, CANNED_AX_NODES);
  assert.equal(dbg._detached, 1, 'first call detaches once on completion');

  // lock released — a third call succeeds
  const third = await readAxTree(304, deps);
  assert.deepEqual(third, CANNED_AX_NODES, 'lock released after the first completes — third call succeeds');
});

test('readAxTree: detach-on-sendCommand-error — getFullAXTree rejects → readAxTree REJECTS (propagates); detach ran; lock released', async () => {
  const boom = new Error('CDP getFullAXTree failed');
  const dbg = makeDebugger({ sendImpl: (method) => {
    if (method === 'Accessibility.getFullAXTree') return Promise.reject(boom);
    return Promise.resolve({});
  } });
  const guestWc = makeGuestWc(305);
  guestWc.debugger = dbg;

  const deps = { fromId: makeFakeFromId({ 305: guestWc }), chromeContents: null, activate: async () => {} };

  // post-attach sendCommand failure PROPAGATES (not a refusal — the debugger WAS available)
  await assert.rejects(() => readAxTree(305, deps), (err) => err === boom);
  assert.equal(dbg._detached, 1, 'detach must run in the finally even when getFullAXTree rejects');

  // lock released — a subsequent (healthy) call succeeds
  const healthy = makeDebugger({ axNodes: CANNED_AX_NODES });
  guestWc.debugger = healthy;
  const ok = await readAxTree(305, deps);
  assert.deepEqual(ok, CANNED_AX_NODES, 'lock released after the rejecting call — subsequent call succeeds');
});

test('readAxTree: detach() throws on the happy path must not mask the result — still returns the nodes', async () => {
  const dbg = makeDebugger({ axNodes: CANNED_AX_NODES, detachThrows: true });
  const guestWc = makeGuestWc(306);
  guestWc.debugger = dbg;

  const result = await readAxTree(306, { fromId: makeFakeFromId({ 306: guestWc }), chromeContents: null, activate: async () => {} });

  assert.deepEqual(result, CANNED_AX_NODES, 'a throwing detach() must not mask the success value');
  assert.equal(dbg._detached, 1, 'detach was attempted (and threw, but was swallowed)');
});

test('readAxTree: detach() throws AND getFullAXTree rejects — the ORIGINAL sendCommand rejection propagates (not the detach error)', async () => {
  const boom = new Error('CDP getFullAXTree failed');
  const dbg = makeDebugger({ detachThrows: true, sendImpl: (method) => {
    if (method === 'Accessibility.getFullAXTree') return Promise.reject(boom);
    return Promise.resolve({});
  } });
  const guestWc = makeGuestWc(307);
  guestWc.debugger = dbg;

  const deps = { fromId: makeFakeFromId({ 307: guestWc }), chromeContents: null, activate: async () => {} };

  await assert.rejects(
    () => readAxTree(307, deps),
    (err) => err === boom,  // the ORIGINAL sendCommand rejection, NOT the detach 'already detached'
  );
  assert.equal(dbg._detached, 1, 'detach was attempted in the finally');
});

test('readAxTree: guest foreground — activate called BEFORE attach (ordering via shared callLog)', async () => {
  const callLog = [];
  const dbg = makeDebugger({ axNodes: CANNED_AX_NODES });
  const origAttach = dbg.attach.bind(dbg);
  dbg.attach = (v) => { callLog.push({ what: 'attach' }); origAttach(v); };
  const guestWc = makeGuestWc(308);
  guestWc.debugger = dbg;

  const deps = {
    fromId: makeFakeFromId({ 308: guestWc }),
    chromeContents: null,  // guestWc is not === chromeContents → classified as guest
    activate: async (/** @type {number} */ id) => { callLog.push({ what: 'activate', id }); },
  };

  await readAxTree(308, deps);

  const activateIdx = callLog.findIndex((e) => e.what === 'activate');
  const attachIdx = callLog.findIndex((e) => e.what === 'attach');
  assert.ok(activateIdx !== -1, 'activate must be called for a guest');
  assert.ok(attachIdx !== -1, 'attach must be called');
  assert.ok(activateIdx < attachIdx, 'activate must be called before attach');
});

test('readAxTree: RE-RESOLVE proof — the SECOND (post-activate) handle\'s debugger is the one attached', async () => {
  // Counter-backed fromId returns a DISTINCT second handle on the re-resolve. The debugger that
  // attaches must be the SECOND handle's — proving the stale-handle re-resolve spans the lock.
  const firstHandle = makeGuestWc(309);
  firstHandle.debugger = makeDebugger({ axNodes: CANNED_AX_NODES });
  const secondHandle = makeGuestWc(309);
  secondHandle.debugger = makeDebugger({ axNodes: CANNED_AX_NODES });

  let lookups = 0;
  const fromId = (/** @type {number} */ id) => {
    if (id !== 309) return null;
    lookups += 1;
    return lookups === 1 ? firstHandle : secondHandle;
  };

  const result = await readAxTree(309, { fromId, chromeContents: null, activate: async () => {} });

  assert.equal(lookups, 2, 'fromId must be called twice (initial resolve + post-activate re-resolve)');
  assert.equal(firstHandle.debugger._attached, 0, 'the STALE pre-activate handle must NOT be attached');
  assert.equal(secondHandle.debugger._attached, 1, 'the FRESH post-activate handle must be the one attached');
  assert.equal(secondHandle.debugger._detached, 1, 'and the SAME (second) handle is the one detached');
  assert.deepEqual(result, CANNED_AX_NODES);
});

test('readAxTree: chrome target — activate NOT called (chrome is always live)', async () => {
  const chromeWc = makeGuestWc(1);  // this object will be chromeContents
  chromeWc.debugger = makeDebugger({ axNodes: CANNED_AX_NODES });
  const activateCalls = [];

  const deps = {
    fromId: makeFakeFromId({ 1: chromeWc }),
    chromeContents: chromeWc,  // classify as 'chrome'
    activate: async (id) => { activateCalls.push(id); },
  };

  const result = await readAxTree(1, deps);

  assert.equal(activateCalls.length, 0, 'activate must NOT be called for a chrome target');
  assert.equal(chromeWc.debugger._attached, 1, 'attach must still run for the chrome target');
  assert.deepEqual(result, CANNED_AX_NODES);
});

test('readAxTree: bad-handle (non-number wcId) → throws bad-handle BEFORE any lock/attach', async () => {
  const deps = { fromId: makeFakeFromId({}), chromeContents: null };
  await assert.rejects(
    // @ts-expect-error — intentionally passing wrong type
    () => readAxTree('300', deps),
    (err) => err instanceof Error && err.message.includes('automation: bad-handle')
  );
});

test('readAxTree: dead (isDestroyed) wcId → throws no-such-contents BEFORE any lock/attach', async () => {
  const destroyed = makeDestroyedWc(355);
  destroyed.debugger = makeDebugger({ axNodes: CANNED_AX_NODES });
  const deps = { fromId: makeFakeFromId({ 355: destroyed }), chromeContents: null };
  await assert.rejects(
    () => readAxTree(355, deps),
    (err) => err instanceof Error && err.message.includes('automation: no-such-contents')
  );
  assert.equal(destroyed.debugger._attached, 0, 'attach must not run on a dead handle');
});

test('readAxTree: internal-session wcId → throws; NO attach AND the attached Set is size 0 after (lock untouched)', async () => {
  const internalWc = makeInternalWc(377);
  internalWc.debugger = makeDebugger({ axNodes: CANNED_AX_NODES });
  const activateCalls = [];
  const deps = {
    fromId: makeFakeFromId({ 377: internalWc }),
    chromeContents: null,
    activate: async (id) => { activateCalls.push(id); },
  };

  await assert.rejects(
    () => readAxTree(377, deps),
    (err) => err instanceof Error && err.message.includes('automation: internal-session')
  );
  assert.equal(activateCalls.length, 0, 'activate must NOT be called on the internal-session path');
  assert.equal(internalWc.debugger._attached, 0, 'attach must NOT run on the internal-session path');
  // Lock untouched: a subsequent successful call on a DIFFERENT (valid) wcId proves the Set was not
  // left holding 377; and a re-attempt on 377 still throws (never silently locked).
  const guestWc = makeGuestWc(378);
  guestWc.debugger = makeDebugger({ axNodes: CANNED_AX_NODES });
  const ok = await readAxTree(378, { fromId: makeFakeFromId({ 378: guestWc }), chromeContents: null, activate: async () => {} });
  assert.deepEqual(ok, CANNED_AX_NODES, 'a valid call after the internal-session reject still succeeds (lock untouched)');
});

// ---------------------------------------------------------------------------
// evaluate / injectScript — Flight-9 debugger-free executeJavaScript eval ops (DD1/DD2)
//
// These ops run wc.executeJavaScript in the guest MAIN WORLD with ZERO CDP. They share
// readDom's resolve → (guest) activate → re-resolve skeleton, EXCEPT injectScript skips
// activate (DD2 asymmetry). The load-bearing DD2-HIGH guard is the FINAL isInternalContents
// refusal that fires EVEN when allowInternal:true (admin) — proven below.
// ---------------------------------------------------------------------------

// A fake guest wc whose executeJavaScript returns a CONFIGURABLE value (default { ok: 1 }) and
// records the code + call count. `retVal` may also be a function (called with the code) so a
// test can return a non-serializable value or throw.
function makeEvalGuestWc(id, retVal = { ok: 1 }, { internal = false } = {}) {
  return {
    id,
    session: { __goldfinchInternal: internal },
    isDestroyed() { return false; },
    _execCount: 0,
    _lastExecCode: /** @type {string|null} */ (null),
    async executeJavaScript(/** @type {string} */ code) {
      this._execCount += 1; this._lastExecCode = code;
      return typeof retVal === 'function' ? retVal(code) : retVal;
    },
  };
}

// --- evaluate ---

test('evaluate: guest — activate is NEVER called even when an activate dep IS present; returns the serializable value (F7 DD6)', async () => {
  // INVERTED at F7 leg 2 (was: 'activate called BEFORE executeJavaScript, returns the
  // serializable value'). The "returns the serializable value" half is KEPT; the ordering
  // half is gone with the branch. evaluate is the op EVERY probe walk runs on
  // (scripts/a11y-audit.mjs:212-235), so this pin is what keeps the walk from activating
  // a background tab and closing the menu under audit.
  const guestWc = makeEvalGuestWc(400, { violations: 3 });
  const callLog = [];
  const origExec = guestWc.executeJavaScript.bind(guestWc);
  guestWc.executeJavaScript = async (code) => { callLog.push({ what: 'exec', code }); return origExec(code); };

  const deps = {
    fromId: makeFakeFromId({ 400: guestWc }),
    chromeContents: null,
    activate: async (/** @type {number} */ id) => { callLog.push({ what: 'activate', id }); },
  };

  const result = await evaluate(400, 'axe.run(document)', deps);

  assert.equal(callLog.filter((e) => e.what === 'activate').length, 0,
    'activate must NOT be called: evaluate reads a background guest without foregrounding it (DD6)');
  assert.equal(callLog.filter((e) => e.what === 'exec').length, 1, 'the evaluation must still happen');
  assert.equal(guestWc._lastExecCode, 'axe.run(document)', 'the expression is passed verbatim');
  assert.deepEqual(result, { violations: 3 });
});

test('evaluate: awaits a returned Promise so the RESOLVED value is returned (native auto-await)', async () => {
  // executeJavaScript natively awaits a returned Promise; our fake returns a real Promise to
  // model that, and evaluate must `await` so the resolved value (not a Promise) comes back.
  const guestWc = makeEvalGuestWc(401, () => Promise.resolve({ resolved: true }));
  const deps = { fromId: makeFakeFromId({ 401: guestWc }), chromeContents: null, activate: async () => {} };

  const result = await evaluate(401, 'whatever', deps);
  assert.deepEqual(result, { resolved: true });
});

test('evaluate: guest — resolves ONCE (no activate ⇒ no async hop ⇒ no stale-handle re-resolve) (F7 DD6)', async () => {
  // INVERTED at F7 leg 2 (was: 'RE-RESOLVE proof — the SECOND post-activate handle is the
  // one evaluated'). See readDom's twin. The single resolve is now the contract.
  const firstHandle = makeEvalGuestWc(402, { which: 'first' });
  const secondHandle = makeEvalGuestWc(402, { which: 'second' });
  let lookups = 0;
  const fromId = (/** @type {number} */ id) => {
    if (id !== 402) return null;
    lookups += 1;
    return lookups === 1 ? firstHandle : secondHandle;
  };

  const result = await evaluate(402, 'x', { fromId, chromeContents: null, activate: async () => {} });

  assert.equal(lookups, 1, 'fromId must be called EXACTLY once — there is no post-activate re-resolve');
  assert.equal(firstHandle._execCount, 1, 'the sole resolved handle is the one evaluated');
  assert.equal(secondHandle._execCount, 0, 'no second handle is ever resolved');
  assert.deepEqual(result, { which: 'first' });
});

test('evaluate: chrome target — activate NOT called (chrome never classifies guest; F7 DD6 makes this uniform)', async () => {
  // RE-WORDED at F7 leg 2 — see readDom's chrome-target twin. Pre-F7 this passed because
  // chrome was exempt from the guest activate branch; it now passes because evaluate
  // activates nothing. Load-bearing for tab-reorder.md step 7, whose evaluate targets the
  // CHROME (:62/:106) and therefore never activated, before or after DD6.
  const chromeWc = makeEvalGuestWc(1, { chrome: true });
  const activateCalls = [];
  const deps = {
    fromId: makeFakeFromId({ 1: chromeWc }),
    chromeContents: chromeWc, // classify as chrome
    activate: async (id) => { activateCalls.push(id); },
  };

  const result = await evaluate(1, 'x', deps);
  assert.equal(activateCalls.length, 0, 'activate must NOT be called for a chrome target');
  assert.equal(chromeWc._execCount, 1, 'executeJavaScript must still run');
  assert.deepEqual(result, { chrome: true });
});

test('evaluate: non-JSON-serializable return → throws the EXACT DD2 message (not a raw V8 message)', async () => {
  // A circular plain object survives the (faked) structured-clone boundary, then fails JSON.stringify
  // in the op's pre-flight — the op must throw the exact DD2 string before returning.
  const circular = {};
  circular.self = circular;
  const guestWc = makeEvalGuestWc(403, circular);
  const deps = { fromId: makeFakeFromId({ 403: guestWc }), chromeContents: null, activate: async () => {} };

  await assert.rejects(
    () => evaluate(403, 'x', deps),
    (err) => err instanceof Error && err.message === 'automation: evaluate — return value is not JSON-serializable',
  );
});

test('evaluate: in-page throw propagates (not swallowed)', async () => {
  const boom = new ReferenceError('axe is not defined');
  const guestWc = makeEvalGuestWc(404, () => { throw boom; });
  const deps = { fromId: makeFakeFromId({ 404: guestWc }), chromeContents: null, activate: async () => {} };

  await assert.rejects(() => evaluate(404, 'axe.run(document)', deps), (err) => err === boom);
});

test('[HIGH] evaluate: internal-session REFUSED even with allowInternal:true — no executeJavaScript', async () => {
  // The op-local guard is the SOLE protection: admin builds deps with allowInternal:true, so
  // resolveContents is permissive on the internal wcId. The op must STILL refuse before any JS runs.
  const internalWc = makeEvalGuestWc(405, { leaked: 'goldfinchInternal' }, { internal: true });
  const activateCalls = [];
  const deps = {
    fromId: makeFakeFromId({ 405: internalWc }),
    chromeContents: null,
    activate: async (id) => { activateCalls.push(id); },
    allowInternal: true, // admin relaxation — resolveContents would NOT throw
  };

  await assert.rejects(
    () => evaluate(405, 'document.title', deps),
    (err) => err instanceof Error && err.message === 'automation: evaluate — internal-session excluded',
  );
  assert.equal(internalWc._execCount, 0, 'executeJavaScript must NOT run on the internal-session path (even for admin)');
  // F7 leg 2 / AC5 — THE GUARD DID NOT GO OUT WITH THE ACTIVATE BRANCH. DD6 deleted
  // evaluate's guest-activate block; this DD2-HIGH refusal was written to run "on the FINAL
  // wc, AFTER the (optional) activate branch", so a careless deletion could plausibly have
  // taken it along. It now runs on the ONE resolved wc and still refuses before any JS runs.
  // (The pre-F7 version of this comment said "activate fires before the FINAL guard" — that
  // is now false, hence the assertion below, which pins the new truth rather than leaving a
  // comment that lies.)
  assert.equal(activateCalls.length, 0, 'F7 DD6: evaluate must not activate ANY target, internal included');
});

// --- injectScript ---

test('injectScript: runs executeJavaScript and returns undefined (void contract)', async () => {
  const guestWc = makeEvalGuestWc(410, 'ignored-return');
  const deps = { fromId: makeFakeFromId({ 410: guestWc }), chromeContents: null, activate: async () => {} };

  const result = await injectScript(410, 'window.__axe = {};', deps);
  assert.equal(result, undefined, 'injectScript is void (resolves undefined → {"ok":true} at the adapter)');
  assert.equal(guestWc._execCount, 1, 'executeJavaScript must run');
  assert.equal(guestWc._lastExecCode, 'window.__axe = {};', 'the script is passed verbatim');
});

test('injectScript: does NOT call activate (intentional asymmetry vs evaluate) even for a guest', async () => {
  const guestWc = makeEvalGuestWc(411);
  const activateCalls = [];
  const deps = {
    fromId: makeFakeFromId({ 411: guestWc }),
    chromeContents: null, // guest classification
    activate: async (id) => { activateCalls.push(id); },
  };

  await injectScript(411, 'x', deps);
  assert.equal(activateCalls.length, 0, 'injectScript must skip foreground-to-act — activate must NEVER be called');
  assert.equal(guestWc._execCount, 1, 'executeJavaScript still runs on the un-activated guest');
});

test('injectScript: in-page throw propagates (not swallowed)', async () => {
  const boom = new SyntaxError('bad script');
  const guestWc = makeEvalGuestWc(412, () => { throw boom; });
  const deps = { fromId: makeFakeFromId({ 412: guestWc }), chromeContents: null, activate: async () => {} };

  await assert.rejects(() => injectScript(412, 'oops(', deps), (err) => err === boom);
});

test('[HIGH] injectScript: internal-session REFUSED even with allowInternal:true — no executeJavaScript', async () => {
  const internalWc = makeEvalGuestWc(413, undefined, { internal: true });
  const deps = {
    fromId: makeFakeFromId({ 413: internalWc }),
    chromeContents: null,
    allowInternal: true, // admin relaxation — resolveContents would NOT throw
  };

  await assert.rejects(
    () => injectScript(413, 'window.x = 1;', deps),
    (err) => err instanceof Error && err.message === 'automation: injectScript — internal-session excluded',
  );
  assert.equal(internalWc._execCount, 0, 'executeJavaScript must NOT run on the internal-session path (even for admin)');
});

test('injectScript: bad-handle (non-number wcId) → throws bad-handle, no exec', async () => {
  const deps = { fromId: makeFakeFromId({}), chromeContents: null };
  await assert.rejects(
    // @ts-expect-error — intentionally passing wrong type
    () => injectScript('410', 'x', deps),
    (err) => err instanceof Error && err.message.includes('automation: bad-handle'),
  );
});

// ---------------------------------------------------------------------------
// openDevTools / closeDevTools — Flight-9 devtools ops (NO CDP from the ops).
//
// These ops call wc.openDevTools({mode:'detach'}) / wc.closeDevTools() and return undefined
// (void → {"ok":true} at the adapter). NO foreground-to-act activation. The load-bearing guard
// is the FINAL isInternalContents refusal that fires EVEN when allowInternal:true (admin) —
// because opening DevTools establishes a full CDP client on the page (the mission's
// debugger-attach-skip-internal rule). The "detached window actually appears" half of AC1 is a
// live/HAT check, NOT asserted here.
// ---------------------------------------------------------------------------

// A fake wc recording openDevTools/closeDevTools calls. devToolsOpen tracks state so
// the idempotency test can assert closeDevTools-when-not-open is a clean no-op.
function makeDevToolsWc(id, { internal = false } = {}) {
  return {
    id,
    session: { __goldfinchInternal: internal },
    isDestroyed() { return false; },
    _openCalls: /** @type {any[]} */ ([]),
    _closeCount: 0,
    devToolsOpen: false,
    openDevTools(/** @type {any} */ opts) { this._openCalls.push(opts); this.devToolsOpen = true; },
    closeDevTools() { this._closeCount += 1; this.devToolsOpen = false; },
  };
}

// --- openDevTools ---

test('openDevTools: calls wc.openDevTools({mode:"detach"}) on the resolved contents, returns undefined (void)', async () => {
  const wc = makeDevToolsWc(500);
  const deps = { fromId: makeFakeFromId({ 500: wc }), chromeContents: null };
  const result = await openDevTools(500, deps);
  assert.equal(result, undefined, 'void contract (resolves undefined → {"ok":true} at the adapter)');
  assert.equal(wc._openCalls.length, 1, 'openDevTools must be called exactly once');
  assert.deepEqual(wc._openCalls[0], { mode: 'detach' }, 'must pass {mode:"detach"} (WSLg-friendly detached window)');
});

test('openDevTools: does NOT activate (DevTools attaches regardless of paint) — no activate dep needed', async () => {
  const wc = makeDevToolsWc(501);
  const activateCalls = [];
  const deps = {
    fromId: makeFakeFromId({ 501: wc }),
    chromeContents: null, // guest classification
    activate: async (/** @type {number} */ id) => { activateCalls.push(id); },
  };
  await openDevTools(501, deps);
  assert.equal(activateCalls.length, 0, 'openDevTools must skip foreground-to-act — activate must NEVER be called');
  assert.equal(wc._openCalls.length, 1);
});

test('openDevTools: bad-handle (non-number wcId) → throws bad-handle, no openDevTools', async () => {
  const deps = { fromId: makeFakeFromId({}), chromeContents: null };
  await assert.rejects(
    // @ts-expect-error — intentionally passing wrong type
    () => openDevTools('500', deps),
    (err) => err instanceof Error && err.message.includes('automation: bad-handle'),
  );
});

test('[HIGH] openDevTools: internal-session REFUSED even with allowInternal:true — DevTools NOT opened', async () => {
  // The op-local guard is the SOLE protection: admin builds deps with allowInternal:true, so
  // resolveContents is permissive on the internal wcId. The op must STILL refuse before opening
  // DevTools — opening it establishes a full CDP client on goldfinch://settings (privilege escalation).
  const internalWc = makeDevToolsWc(502, { internal: true });
  const deps = {
    fromId: makeFakeFromId({ 502: internalWc }),
    chromeContents: null,
    allowInternal: true, // admin relaxation — resolveContents would NOT throw
  };
  await assert.rejects(
    () => openDevTools(502, deps),
    (err) => err instanceof Error && err.message === 'automation: openDevTools — internal-session excluded',
  );
  assert.equal(internalWc._openCalls.length, 0, 'openDevTools must NOT run on the internal-session path (even for admin)');
});

// --- closeDevTools ---

test('closeDevTools: calls wc.closeDevTools() on the resolved contents, returns undefined (void)', async () => {
  const wc = makeDevToolsWc(510);
  wc.devToolsOpen = true; // pretend DevTools was open
  const deps = { fromId: makeFakeFromId({ 510: wc }), chromeContents: null };
  const result = await closeDevTools(510, deps);
  assert.equal(result, undefined, 'void contract');
  assert.equal(wc._closeCount, 1, 'closeDevTools must be called exactly once');
  assert.equal(wc.devToolsOpen, false);
});

test('closeDevTools: idempotent — close without a prior open still returns {"ok":true} (void, no throw)', async () => {
  const wc = makeDevToolsWc(511); // devToolsOpen starts false — never opened
  const deps = { fromId: makeFakeFromId({ 511: wc }), chromeContents: null };
  const result = await closeDevTools(511, deps);
  assert.equal(result, undefined, 'close-when-not-open is a clean no-op (void → {"ok":true})');
  assert.equal(wc._closeCount, 1, 'closeDevTools is still called (Electron no-ops internally)');
});

test('closeDevTools: does NOT activate', async () => {
  const wc = makeDevToolsWc(512);
  const activateCalls = [];
  const deps = {
    fromId: makeFakeFromId({ 512: wc }),
    chromeContents: null,
    activate: async (/** @type {number} */ id) => { activateCalls.push(id); },
  };
  await closeDevTools(512, deps);
  assert.equal(activateCalls.length, 0, 'closeDevTools must skip foreground-to-act');
});

test('[HIGH] closeDevTools: internal-session REFUSED even with allowInternal:true — closeDevTools NOT called', async () => {
  const internalWc = makeDevToolsWc(513, { internal: true });
  const deps = {
    fromId: makeFakeFromId({ 513: internalWc }),
    chromeContents: null,
    allowInternal: true,
  };
  await assert.rejects(
    () => closeDevTools(513, deps),
    (err) => err instanceof Error && err.message === 'automation: closeDevTools — internal-session excluded',
  );
  assert.equal(internalWc._closeCount, 0, 'closeDevTools must NOT run on the internal-session path (even for admin)');
});
