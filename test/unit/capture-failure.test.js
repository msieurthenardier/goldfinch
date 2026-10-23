'use strict';

// Unit tests for src/main/capture-failure.js (squawk 0155) — the named capture-failed
// refusal and the one bounded active-guest retry used by main.js grabWindow's Wayland
// composite fallback. main.js itself is never loaded by a test; its wiring is pinned by
// capture-window-failure-pins.test.js.
//
// Electron-free: the module requires nothing. setTimeout is intercepted per test with
// MockTimers (never file-global), drained with a real setImmediate around single-step
// ticks (exemplar test/unit/capture-timeout.test.js).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  CAPTURE_REFUSAL_PREFIX,
  GUEST_CAPTURE_RETRY_MS,
  isNamedCaptureRefusal,
  captureFailure,
  captureWithOneRetry
} = require('../../src/main/capture-failure');
const { withCaptureTimeout } = require('../../src/main/capture-timeout');
const { captureWindow } = require('../../src/main/automation/observe');

const drain = () => new Promise((r) => setImmediate(r));

const TIMEOUT_MSG =
  'automation: capture-timeout — active guest did not settle within 3000ms (the view may be detached)';

test('capture-failure: the retry is bounded (one wait, at most ~300ms) and the prefix covers BOTH named refusals', () => {
  assert.ok(GUEST_CAPTURE_RETRY_MS > 0 && GUEST_CAPTURE_RETRY_MS <= 300, 'retry delay must stay ≤ ~300ms');
  assert.equal(CAPTURE_REFUSAL_PREFIX, 'automation: capture-');
  assert.ok(TIMEOUT_MSG.startsWith(CAPTURE_REFUSAL_PREFIX));
  assert.ok(captureFailure('chrome', new Error('x')).message.startsWith(CAPTURE_REFUSAL_PREFIX));
});

test('captureFailure: a plain error becomes "automation: capture-failed — {step}: {reason}"', () => {
  const err = captureFailure('active guest', new Error('UnknownVizError'));
  assert.ok(err instanceof Error);
  assert.equal(err.message, 'automation: capture-failed — active guest: UnknownVizError');
  assert.equal(
    captureFailure('composite', new Error('img load failed')).message,
    'automation: capture-failed — composite: img load failed'
  );
});

test('captureFailure: it never claims the generic "chrome window unavailable" (that stays the no-window signal)', () => {
  const msg = captureFailure('chrome', new Error('empty image')).message;
  assert.ok(!/chrome window unavailable/.test(msg), msg);
});

test('captureFailure: a named refusal passes through VERBATIM (same object) — an outer catch never relabels it', () => {
  const timeout = new Error(TIMEOUT_MSG);
  assert.equal(captureFailure('composite', timeout), timeout, 'capture-timeout passes through');
  const inner = captureFailure('active guest', new Error('UnknownVizError'));
  assert.equal(captureFailure('composite', inner), inner, 'an inner step’s capture-failed passes through');
  assert.equal(inner.message, 'automation: capture-failed — active guest: UnknownVizError');
});

test('captureFailure: non-Error and empty rejections still yield a readable reason', () => {
  assert.equal(captureFailure('chrome', 'boom').message, 'automation: capture-failed — chrome: boom');
  assert.equal(captureFailure('chrome', undefined).message, 'automation: capture-failed — chrome: undefined');
  assert.equal(captureFailure('chrome', new Error('')).message, 'automation: capture-failed — chrome: unknown error');
  assert.equal(
    captureFailure('chrome', { message: '  ' }).message,
    'automation: capture-failed — chrome: unknown error'
  );
});

test('isNamedCaptureRefusal: true only for automation: capture-* messages', () => {
  assert.equal(isNamedCaptureRefusal(new Error(TIMEOUT_MSG)), true);
  assert.equal(isNamedCaptureRefusal(new Error('automation: capture-failed — chrome: x')), true);
  assert.equal(isNamedCaptureRefusal(new Error('automation: chrome window unavailable')), false);
  assert.equal(isNamedCaptureRefusal(new Error('UnknownVizError')), false);
  assert.equal(isNamedCaptureRefusal(null), false);
  assert.equal(isNamedCaptureRefusal('automation: capture-failed — chrome: x'), false, 'a bare string is not an Error');
});

test('captureWithOneRetry: a first-try success returns its value with NO wait and ONE attempt', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const image = { tag: 'img' };
  const result = await captureWithOneRetry(async () => (calls++, image), 'active guest');
  assert.equal(result, image);
  assert.equal(calls, 1);
});

test('captureWithOneRetry: a null result (guest skipped) is a value, not a failure — no retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const result = await captureWithOneRetry(async () => (calls++, null), 'active guest');
  assert.equal(result, null);
  assert.equal(calls, 1);
});

test('captureWithOneRetry: reject → waits exactly GUEST_CAPTURE_RETRY_MS → retries ONCE → succeeds (the not-yet-painted guest)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const image = { tag: 'img' };
  const start = async () => {
    calls++;
    if (calls === 1) throw new Error('UnknownVizError');
    return image;
  };
  let settled = null;
  captureWithOneRetry(start, 'active guest').then((v) => (settled = { v }));
  await drain();
  assert.equal(calls, 1, 'first attempt ran');
  assert.equal(settled, null, 'not settled during the wait');

  t.mock.timers.tick(GUEST_CAPTURE_RETRY_MS - 1);
  await drain();
  assert.equal(calls, 1, 'no retry before the delay elapses');

  t.mock.timers.tick(1);
  await drain();
  await drain();
  assert.equal(calls, 2, 'exactly one retry');
  assert.deepEqual(settled, { v: image });
});

test('captureWithOneRetry: reject twice → named capture-failed carrying the SECOND reason, after exactly two attempts', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const start = async () => {
    calls++;
    throw new Error(calls === 1 ? 'first' : 'UnknownVizError');
  };
  let rejected = null;
  captureWithOneRetry(start, 'active guest').catch((e) => (rejected = e));
  await drain();
  t.mock.timers.tick(GUEST_CAPTURE_RETRY_MS);
  await drain();
  await drain();
  assert.equal(calls, 2, 'never more than one retry');
  assert.ok(rejected instanceof Error);
  assert.equal(rejected.message, 'automation: capture-failed — active guest: UnknownVizError');
});

test('captureWithOneRetry: a capture-timeout on the FIRST attempt is NOT retried and passes through verbatim', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const timeout = new Error(TIMEOUT_MSG);
  await assert.rejects(
    captureWithOneRetry(async () => {
      calls++;
      throw timeout;
    }, 'active guest'),
    (err) => err === timeout
  );
  assert.equal(calls, 1, 'a timed-out (detached) view would hang again — never retried');
});

test('captureWithOneRetry: a capture-timeout on the RETRY passes through verbatim (not relabeled capture-failed)', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const timeout = new Error(TIMEOUT_MSG);
  let rejected = null;
  captureWithOneRetry(async () => {
    calls++;
    throw calls === 1 ? new Error('UnknownVizError') : timeout;
  }, 'active guest').catch((e) => (rejected = e));
  await drain();
  t.mock.timers.tick(GUEST_CAPTURE_RETRY_MS);
  await drain();
  await drain();
  assert.equal(calls, 2);
  assert.equal(rejected, timeout);
});

test('composition: captureWithOneRetry over withCaptureTimeout — a real rejecting capturePage is named, not swallowed', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const start = () => withCaptureTimeout(Promise.reject(new Error('UnknownVizError')), 'active guest');
  let rejected = null;
  captureWithOneRetry(start, 'active guest').catch((e) => (rejected = e));
  await drain();
  t.mock.timers.tick(GUEST_CAPTURE_RETRY_MS);
  await drain();
  await drain();
  assert.ok(rejected instanceof Error);
  assert.equal(rejected.message, 'automation: capture-failed — active guest: UnknownVizError');
});

test('propagation: observe.captureWindow surfaces a grabWindow capture-failed rejection unchanged (the tool’s isError text)', async () => {
  const named = captureFailure('active guest', new Error('UnknownVizError'));
  await assert.rejects(
    () => captureWindow({ grabWindow: async () => Promise.reject(named) }),
    (err) => err === named && err.message === 'automation: capture-failed — active guest: UnknownVizError'
  );
});
