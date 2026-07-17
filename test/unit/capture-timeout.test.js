'use strict';

// Unit tests for src/main/capture-timeout.js (M09 F7 DD7, recon S3).
//
// Electron-free: capture-timeout.js requires nothing at all, so these run under plain
// `node --test` with no Electron stub. The only ambient dependency is the global
// setTimeout/clearTimeout pair — intercepted per-test with MockTimers (t.mock.timers),
// NEVER file-global (CLAUDE.md's recipe; exemplar test/unit/automation-find.test.js).
// Drain with a real setImmediate around single-step ticks; never one big tick.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { withCaptureTimeout, CAPTURE_TIMEOUT_MS } = require('../../src/main/capture-timeout');

// Let the microtask queue drain (the real setImmediate survives MockTimers' setTimeout
// interception, so an awaited settle actually lands before the next tick).
const drain = () => new Promise((r) => setImmediate(r));

test('capture-timeout: the budget is find.js\'s 3000ms (the ONE thing borrowed, besides the done guard)', () => {
  assert.equal(CAPTURE_TIMEOUT_MS, 3000);
});

test('capture-timeout: a capture that settles BEFORE the bound resolves with its value, and the timer is CLEARED', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  // NOTE on why this SPIES rather than ticking: the done guard makes a dangling timer
  // BEHAVIOURALLY invisible — firing it late is a no-op either way — so any assertion
  // phrased over the promise's outcome would pass whether or not clearTimeout ran, i.e.
  // it would be vacuous. The only real observable is the clearTimeout call itself. A
  // dangling timer keeps a main-process handle alive for 3s per capture, and captures
  // are per-op — hence a real pin. (capture-timeout.js resolves `clearTimeout` off the
  // global at CALL time, so patching it here is seen by the module.)
  const realClear = globalThis.clearTimeout;
  const cleared = [];
  globalThis.clearTimeout = (/** @type {any} */ h) => { cleared.push(h); return realClear(h); };

  try {
    const image = { toPNG: () => Buffer.from('PNG') };
    const result = await withCaptureTimeout(Promise.resolve(image), 'chrome');

    assert.equal(result, image, 'the capture\'s value passes through verbatim');
    assert.equal(cleared.length, 1, 'clearTimeout MUST run on the happy path — no dangling handle');
  } finally {
    globalThis.clearTimeout = realClear;
  }
});

test('capture-timeout: CONTROL for the clearTimeout pin — the spy DOES observe a missing clear', async (t) => {
  // The control the leg's grep-AC lesson demands, applied to a test: prove the spy above
  // can report the NEGATIVE case, so its green is a measurement and not an absence claim.
  // A bare setTimeout that is never cleared must leave the spy empty.
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const realClear = globalThis.clearTimeout;
  const cleared = [];
  globalThis.clearTimeout = (/** @type {any} */ h) => { cleared.push(h); return realClear(h); };

  try {
    setTimeout(() => {}, 3000);   // deliberately never cleared
    assert.equal(cleared.length, 0, 'the spy reports zero clears when nothing clears — it is not vacuously green');
  } finally {
    globalThis.clearTimeout = realClear;
  }
});

test('capture-timeout: a capture that NEVER settles REJECTS at the bound with the named error (the S3 model)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  // capturePage() on a DETACHED-but-live view never settles — resolveContents proves a
  // view LIVE, never ATTACHED, so every isDestroyed() guard passes. Reproduced live on
  // the rig at leg-2 smoke step 0 (no response in 20s).
  const never = new Promise(() => {});
  const p = withCaptureTimeout(never, 'find overlay layer');
  const assertion = assert.rejects(
    () => p,
    (err) => err instanceof Error &&
      /^automation: capture-timeout — find overlay layer did not settle within 3000ms \(the view may be detached\)$/.test(err.message),
  );

  await drain();
  t.mock.timers.tick(3000);
  await assertion;
});

test('capture-timeout: the LABEL names the target in the refusal (Promise.all hides which capture hung)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  // main.js races the chrome and guest captures in one Promise.all; without labels the
  // refusal would name the symptom but not the target. Both labels must survive verbatim.
  const mk = (label) => {
    const p = withCaptureTimeout(new Promise(() => {}), label);
    return assert.rejects(() => p, (err) => err.message.includes(label));
  };
  const chrome = mk('chrome');
  const guest = mk('active guest');

  await drain();
  t.mock.timers.tick(3000);
  await Promise.all([chrome, guest]);
});

test('capture-timeout: a capture that REJECTS before the bound propagates that rejection VERBATIM (not masked by the timeout)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const cause = new Error('capturePage exploded for its own reasons');
  await assert.rejects(
    () => withCaptureTimeout(Promise.reject(cause), 'chrome'),
    (err) => err === cause,   // identity: the caller must read the REAL cause
  );
});

test('capture-timeout: the done guard — a capture settling AFTER the timeout fired does not re-settle or throw', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  // find.js:130-135's guard, borrowed. A late settle on an already-rejected promise
  // would be an unhandled rejection / double-settle without it.
  let resolveLate;
  const late = new Promise((r) => { resolveLate = r; });
  const p = withCaptureTimeout(late, 'sheet overlay layer');
  const assertion = assert.rejects(() => p, (err) => /capture-timeout/.test(err.message));

  await drain();
  t.mock.timers.tick(3000);
  await assertion;

  // The capture finally lands, well after the bound. Must be a silent no-op.
  resolveLate({ toPNG: () => Buffer.from('LATE') });
  await drain();
  // Reaching here without an unhandled rejection / throw IS the assertion.
  assert.ok(true, 'a late settle after the bound is a silent no-op');
});

test('capture-timeout: a LATE REJECTION after the bound is also swallowed by the done guard', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  let rejectLate;
  const late = new Promise((_r, j) => { rejectLate = j; });
  const p = withCaptureTimeout(late, 'chrome');
  const assertion = assert.rejects(() => p, (err) => /capture-timeout/.test(err.message));

  await drain();
  t.mock.timers.tick(3000);
  await assertion;

  rejectLate(new Error('late boom'));
  await drain();
  assert.ok(true, 'a late rejection after the bound must not surface as an unhandled rejection');
});

test('capture-timeout: timeoutMs is overridable (the bound is policy, not a constant)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  const p = withCaptureTimeout(new Promise(() => {}), 'chrome', { timeoutMs: 50 });
  const assertion = assert.rejects(() => p, (err) => /did not settle within 50ms/.test(err.message));

  await drain();
  t.mock.timers.tick(50);
  await assertion;
});

// ---------------------------------------------------------------------------
// THE ANTI-find.js PIN. Named for the contract so a future "harmonize with
// find.js" refactor fails loudly, with the reason in the test name.
// ---------------------------------------------------------------------------

test('capture-timeout: a timeout REJECTS — find.js\'s benign finish(last) semantics are deliberately not carried', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });

  // find.js:155 does finish(last) where last = {activeMatchOrdinal:0, matches:0}
  // (find.js:122) — it RESOLVES WITH A BENIGN ZERO-MATCH SUCCESS on timeout. Only its
  // 3000ms budget (find.js:106) and its done-guarded settle (find.js:130-135) are
  // borrowed here. Carrying its SEMANTICS would yield a silently-empty capture — the
  // exact silent-success class S1/DD6 exists to kill. This helper has exactly ONE
  // semantic: reject. Layer degradation is the CALL SITE's policy (main.js), never
  // this module's, so no call site can inherit a benign settle by accident.
  let settled = null;
  const p = withCaptureTimeout(new Promise(() => {}), 'chrome')
    .then((v) => { settled = { resolved: v }; }, (e) => { settled = { rejected: e }; });

  await drain();
  t.mock.timers.tick(3000);
  await p;

  assert.ok(settled.rejected, 'a timeout MUST reject — it must NEVER resolve with any value');
  assert.equal(settled.resolved, undefined, 'no benign value may be resolved on timeout');
  assert.ok(/^automation: capture-timeout — /.test(settled.rejected.message),
    'the rejection is NAMED so the caller can tell a timeout from any other capture failure');
});
