'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RETRY_REASONS, retryReasonText, planRetry, projectRow } = require('../../src/main/download-retry');

const env = (over = {}) => ({
  isJarPartition: (p) => p === 'persist:container:work' || p === 'persist:goldfinch',
  isBurnerLive: (p) => p === 'burner:1',
  ...over
});
const rec = (over = {}) => ({ id: 1, url: 'https://e.test/f.bin', partition: 'persist:container:work', ...over });

test('planRetry accepts a listed jar, the default-flagged jar and a live burner', () => {
  assert.deepEqual(planRetry(rec(), env()), {
    ok: true,
    partition: 'persist:container:work',
    url: 'https://e.test/f.bin'
  });
  assert.equal(planRetry(rec({ partition: 'persist:goldfinch' }), env()).ok, true);
  assert.equal(planRetry(rec({ partition: 'burner:1', url: 'http://e.test/f' }), env()).ok, true);
});

test('planRetry names a reason for each refusal', () => {
  const reason = (r, e = env()) => planRetry(r, e).reason;
  assert.equal(reason(null), 'no-record');
  assert.equal(reason(undefined), 'no-record');
  assert.equal(reason(rec({ partition: undefined })), 'no-partition');
  assert.equal(reason(rec({ partition: '' })), 'no-partition');
  assert.equal(reason(rec({ partition: 7 })), 'no-partition');
  assert.equal(reason(rec({ partition: 'persist:container:gone' })), 'jar-gone');
  assert.equal(reason(rec({ partition: 'burner:2' })), 'burner-gone');
  for (const url of [
    'blob:https://e.test/x',
    'data:image/png;base64,AA',
    'file:///x',
    'ftp://e.test/x',
    '',
    undefined,
    null,
    'not a url'
  ]) {
    assert.equal(reason(rec({ url })), 'unsupported-url', String(url));
  }
});

test('a burner-shaped partition is never answered by the persistent-jar lookup', () => {
  // isJarPartition says yes to everything; the burner branch must still ask isBurnerLive.
  const e = env({ isJarPartition: () => true, isBurnerLive: () => false });
  assert.equal(planRetry(rec({ partition: 'burner:5' }), e).reason, 'burner-gone');
});

test('retryReasonText maps every reason code to its own line and is safe for anything else', () => {
  const lines = new Set();
  for (const code of Object.values(RETRY_REASONS)) {
    const text = retryReasonText(code);
    assert.match(text, /^Cannot retry/);
    lines.add(text);
  }
  assert.equal(lines.size, Object.values(RETRY_REASONS).length, 'each code has its own wording');
  for (const bad of [undefined, null, 5, {}, 'constructor', '__proto__', 'toString']) {
    assert.equal(retryReasonText(bad), 'Cannot retry this download.');
  }
});

test('projectRow keeps the record and adds the verdict', () => {
  const ok = projectRow(rec({ extra: 1 }), env());
  assert.deepEqual(ok, { ...rec({ extra: 1 }), retryable: true, retryReason: null, retryNote: null });
  const no = projectRow(rec({ partition: undefined }), env());
  assert.equal(no.retryable, false);
  assert.equal(no.retryReason, 'no-partition');
  assert.equal(no.retryNote, retryReasonText('no-partition'));
  assert.equal(no.url, 'https://e.test/f.bin');
});
