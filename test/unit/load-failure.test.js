'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  LOAD_STATES,
  classifyLoadFailure,
  shouldRecordLoadFailure,
  isChromeErrorUrl
} = require('../../src/shared/load-failure');

test('LOAD_STATES is frozen with exactly ok/failed', () => {
  assert.deepEqual(LOAD_STATES, { OK: 'ok', FAILED: 'failed' });
  assert.ok(Object.isFrozen(LOAD_STATES));
});

// ---------------------------------------------------------------------------
// classifyLoadFailure — one row per DD3 kind, name-first matching
// ---------------------------------------------------------------------------

const NAME_CASES = [
  ['ERR_NAME_NOT_RESOLVED', 'dns'],
  ['ERR_CONNECTION_REFUSED', 'refused'],
  ['ERR_CONNECTION_TIMED_OUT', 'timeout'],
  ['ERR_TIMED_OUT', 'timeout'],
  ['ERR_INTERNET_DISCONNECTED', 'offline'],
  ['ERR_ADDRESS_UNREACHABLE', 'unreachable'],
  ['ERR_CONNECTION_CLOSED', 'dropped'],
  ['ERR_CONNECTION_RESET', 'dropped'],
  ['ERR_CONNECTION_FAILED', 'dropped'],
  ['ERR_EMPTY_RESPONSE', 'dropped'],
  ['ERR_SSL_PROTOCOL_ERROR', 'tls'],
  ['ERR_SSL_VERSION_OR_CIPHER_MISMATCH', 'tls'],
  ['ERR_BLOCKED_BY_CLIENT', 'blocked'],
  ['ERR_BLOCKED_BY_RESPONSE', 'blocked'],
  ['ERR_TOO_MANY_REDIRECTS', 'redirect-loop'],
  ['ERR_UNKNOWN_URL_SCHEME', 'scheme'],
  ['ERR_UNSAFE_PORT', 'unsafe-port']
];

for (const [name, kind] of NAME_CASES) {
  test(`classifyLoadFailure matches ${name} -> ${kind}`, () => {
    const result = classifyLoadFailure({ code: -1, name });
    assert.equal(result.kind, kind);
    assert.equal(typeof result.title, 'string');
    assert.ok(result.title.length > 0);
    assert.equal(typeof result.body, 'string');
    assert.ok(result.body.length > 0);
    assert.equal(typeof result.retryable, 'boolean');
    // No engine string ever rides the app-authored copy.
    assert.ok(!result.title.includes(name));
    assert.ok(!result.body.includes(name));
  });
}

test('classifyLoadFailure: any ERR_CERT_* name maps to cert, regardless of code', () => {
  assert.equal(classifyLoadFailure({ code: -200, name: 'ERR_CERT_COMMON_NAME_INVALID' }).kind, 'cert');
  assert.equal(classifyLoadFailure({ code: -202, name: 'ERR_CERT_AUTHORITY_INVALID' }).kind, 'cert');
  assert.equal(classifyLoadFailure({ code: -999, name: 'ERR_CERT_WEIRD_FUTURE_ONE' }).kind, 'cert');
});

test('classifyLoadFailure: unmapped name + unmapped code -> unknown, still safe shape', () => {
  const result = classifyLoadFailure({ code: -99999, name: 'ERR_SOMETHING_NEW' });
  assert.equal(result.kind, 'unknown');
  assert.equal(typeof result.title, 'string');
  assert.equal(typeof result.body, 'string');
  assert.equal(typeof result.retryable, 'boolean');
});

test('classifyLoadFailure: code-only fallback when name is missing', () => {
  assert.equal(classifyLoadFailure({ code: -105 }).kind, 'dns');
  assert.equal(classifyLoadFailure({ code: -102 }).kind, 'refused');
  assert.equal(classifyLoadFailure({ code: -312 }).kind, 'unsafe-port');
});

test('classifyLoadFailure: retryable is false ONLY for scheme, blocked, and unsafe-port', () => {
  const casesByName = [...NAME_CASES, ['ERR_CERT_X', 'cert']];
  for (const [name, kind] of casesByName) {
    const result = classifyLoadFailure({ name });
    if (kind === 'blocked' || kind === 'scheme' || kind === 'unsafe-port') {
      assert.equal(result.retryable, false, `${kind} must not be retryable`);
    } else {
      assert.equal(result.retryable, true, `${kind} must be retryable`);
    }
  }
  assert.equal(classifyLoadFailure({ name: 'ERR_TOTALLY_UNKNOWN' }).retryable, true, 'unknown defaults retryable');
});

test('classifyLoadFailure never throws on undefined/non-string/missing input', () => {
  assert.doesNotThrow(() => classifyLoadFailure(undefined));
  assert.doesNotThrow(() => classifyLoadFailure(null));
  assert.doesNotThrow(() => classifyLoadFailure({}));
  assert.doesNotThrow(() => classifyLoadFailure({ code: 'not-a-number', name: 42 }));
  assert.equal(classifyLoadFailure(undefined).kind, 'unknown');
  assert.equal(classifyLoadFailure({}).kind, 'unknown');
  assert.equal(classifyLoadFailure({ code: 'nope', name: 42 }).kind, 'unknown');
});

// ---------------------------------------------------------------------------
// shouldRecordLoadFailure — main frame only, never ERR_ABORTED (-3)
// ---------------------------------------------------------------------------

test('shouldRecordLoadFailure: true only for main-frame, non-aborted failures', () => {
  assert.equal(shouldRecordLoadFailure({ errorCode: -105, isMainFrame: true }), true);
  assert.equal(shouldRecordLoadFailure({ errorCode: -105, isMainFrame: false }), false, 'subframe ignored');
  assert.equal(shouldRecordLoadFailure({ errorCode: -3, isMainFrame: true }), false, 'ERR_ABORTED ignored');
  assert.equal(shouldRecordLoadFailure({ errorCode: -3, isMainFrame: false }), false);
});

test('shouldRecordLoadFailure never throws on missing/malformed input', () => {
  assert.equal(shouldRecordLoadFailure(undefined), false);
  assert.equal(shouldRecordLoadFailure(null), false);
  assert.equal(shouldRecordLoadFailure({}), false);
});

// ---------------------------------------------------------------------------
// isChromeErrorUrl
// ---------------------------------------------------------------------------

test('isChromeErrorUrl: true for any chrome-error: URL, false otherwise', () => {
  assert.equal(isChromeErrorUrl('chrome-error://chromewebdata/'), true);
  assert.equal(isChromeErrorUrl('chrome-error:foo'), true);
  assert.equal(isChromeErrorUrl('https://example.test/'), false);
  assert.equal(isChromeErrorUrl(''), false);
  assert.equal(isChromeErrorUrl(undefined), false);
  assert.equal(isChromeErrorUrl(null), false);
  assert.equal(isChromeErrorUrl(42), false);
});
