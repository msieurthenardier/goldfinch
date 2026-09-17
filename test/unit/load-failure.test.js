'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  LOAD_STATES,
  classifyLoadFailure,
  shouldRecordLoadFailure,
  isChromeErrorUrl,
  classifyCertError,
  stripNetPrefix,
  failedTabTitle,
  classifyCrash,
  deriveStripLoadState,
  guestTakenOver
} = require('../../src/shared/load-failure');

test('LOAD_STATES is frozen with exactly ok/failed/cert-blocked/crashed/hung', () => {
  assert.deepEqual(LOAD_STATES, {
    OK: 'ok',
    FAILED: 'failed',
    CERT_BLOCKED: 'cert-blocked',
    CRASHED: 'crashed',
    HUNG: 'hung'
  });
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

// ---------------------------------------------------------------------------
// Mission 20 Flight 2 Leg 2 (DD5): stripNetPrefix + classifyCertError
// ---------------------------------------------------------------------------

test('stripNetPrefix strips a net:: prefix and passes everything else through', () => {
  assert.equal(stripNetPrefix('net::ERR_CERT_AUTHORITY_INVALID'), 'ERR_CERT_AUTHORITY_INVALID');
  assert.equal(stripNetPrefix('ERR_CERT_AUTHORITY_INVALID'), 'ERR_CERT_AUTHORITY_INVALID');
  assert.equal(stripNetPrefix(''), '');
  assert.equal(stripNetPrefix(undefined), '');
  assert.equal(stripNetPrefix(null), '');
  assert.equal(stripNetPrefix(42), '');
});

const CERT_KIND_CASES = [
  ['ERR_CERT_AUTHORITY_INVALID', 'authority', true],
  ['ERR_CERT_COMMON_NAME_INVALID', 'name', true],
  ['ERR_CERT_DATE_INVALID', 'date', true],
  ['ERR_CERT_WEAK_SIGNATURE_ALGORITHM', 'weak', true],
  ['ERR_CERT_WEAK_KEY', 'weak', true],
  ['ERR_CERT_REVOKED', 'revoked', false],
  ['ERR_SSL_PINNED_KEY_NOT_IN_CERT_CHAIN', 'pinned', false],
  ['ERR_CERT_KNOWN_INTERCEPTION_BLOCKED', 'pinned', false],
  ['ERR_CERT_INVALID', 'invalid', false],
  ['ERR_CERT_CONTAINS_ERRORS', 'invalid', false]
];

for (const [name, kind, overridable] of CERT_KIND_CASES) {
  test(`classifyCertError matches ${name} -> ${kind} (overridable=${overridable})`, () => {
    const result = classifyCertError(name);
    assert.equal(result.kind, kind);
    assert.equal(result.overridable, overridable);
    assert.equal(typeof result.title, 'string');
    assert.ok(result.title.length > 0);
    assert.equal(typeof result.body, 'string');
    assert.ok(result.body.length > 0);
    // No engine string ever rides the app-authored copy.
    assert.ok(!result.title.includes(name));
    assert.ok(!result.body.includes(name));
  });
}

test('classifyCertError: an unrecognized ERR_CERT_* name falls to other, overridable, generic copy', () => {
  const result = classifyCertError('ERR_CERT_SOME_FUTURE_KIND');
  assert.equal(result.kind, 'other');
  assert.equal(result.overridable, true);
  assert.equal(typeof result.title, 'string');
  assert.equal(typeof result.body, 'string');
});

test('classifyCertError never throws on malformed input', () => {
  assert.doesNotThrow(() => classifyCertError(undefined));
  assert.doesNotThrow(() => classifyCertError(null));
  assert.doesNotThrow(() => classifyCertError(42));
  assert.equal(classifyCertError(undefined).kind, 'other');
});

test('isChromeErrorUrl: true for any chrome-error: URL, false otherwise', () => {
  assert.equal(isChromeErrorUrl('chrome-error://chromewebdata/'), true);
  assert.equal(isChromeErrorUrl('chrome-error:foo'), true);
  assert.equal(isChromeErrorUrl('https://example.test/'), false);
  assert.equal(isChromeErrorUrl(''), false);
  assert.equal(isChromeErrorUrl(undefined), false);
  assert.equal(isChromeErrorUrl(null), false);
  assert.equal(isChromeErrorUrl(42), false);
});

// ---------------------------------------------------------------------------
// Mission 20 Flight 3 Leg 2 (DD1/DD3): classifyCrash, deriveStripLoadState,
// failedTabTitle's crash precedence, guestTakenOver
// ---------------------------------------------------------------------------

test('classifyCrash: killed -> "closed by the system" copy', () => {
  const result = classifyCrash('killed');
  assert.equal(result.heading, 'This page was closed by the system');
  assert.equal(typeof result.body, 'string');
  assert.ok(result.body.length > 0);
});

test('classifyCrash: oom -> "ran out of memory" copy', () => {
  const result = classifyCrash('oom');
  assert.equal(result.heading, 'This page ran out of memory');
  assert.equal(typeof result.body, 'string');
  assert.ok(result.body.length > 0);
});

const GENERIC_CRASH_REASONS = ['crashed', 'abnormal-exit', 'integrity-failure', 'launch-failed', 'memory-eviction'];
for (const reason of GENERIC_CRASH_REASONS) {
  test(`classifyCrash: ${reason} -> generic "This page crashed" copy`, () => {
    const result = classifyCrash(reason);
    assert.equal(result.heading, 'This page crashed');
    assert.equal(typeof result.body, 'string');
    assert.ok(result.body.length > 0);
  });
}

test('classifyCrash: an unrecognized/non-string reason falls to the generic copy, never throws', () => {
  assert.doesNotThrow(() => classifyCrash(undefined));
  assert.doesNotThrow(() => classifyCrash(null));
  assert.doesNotThrow(() => classifyCrash(42));
  assert.equal(classifyCrash('some-future-reason').heading, 'This page crashed');
  assert.equal(classifyCrash(undefined).heading, 'This page crashed');
});

test('deriveStripLoadState: precedence crashed > failed > hung > null', () => {
  assert.equal(deriveStripLoadState({ crash: { reason: 'crashed' }, loadFailure: {}, hung: true }), 'crashed');
  assert.equal(deriveStripLoadState({ crash: { reason: 'crashed' } }), 'crashed');
  assert.equal(deriveStripLoadState({ loadFailure: {}, hung: true }), 'failed');
  assert.equal(deriveStripLoadState({ loadFailure: {} }), 'failed');
  assert.equal(deriveStripLoadState({ hung: true }), 'hung');
  assert.equal(deriveStripLoadState({}), null);
  assert.equal(deriveStripLoadState({ crash: null, loadFailure: null, hung: false }), null);
});

test('deriveStripLoadState never throws on missing/malformed input', () => {
  assert.equal(deriveStripLoadState(undefined), null);
  assert.equal(deriveStripLoadState(null), null);
});

test('failedTabTitle: a crash url takes precedence over a loadFailure url and the tab url', () => {
  assert.equal(
    failedTabTitle({
      crash: { url: 'https://crash.example/' },
      loadFailure: { url: 'https://failure.example/' },
      url: 'https://tab.example/'
    }),
    'crash.example'
  );
  assert.equal(
    failedTabTitle({ loadFailure: { url: 'https://failure.example/' }, url: 'https://tab.example/' }),
    'failure.example'
  );
  assert.equal(failedTabTitle({ url: 'https://tab.example/' }), 'tab.example');
  assert.equal(failedTabTitle({}), '');
  assert.equal(failedTabTitle(null), '');
});

test('failedTabTitle: falls back to the raw string when it does not parse as a URL', () => {
  assert.equal(failedTabTitle({ crash: { url: 'not a url' } }), 'not a url');
});

test('guestTakenOver: true iff the entry carries a load failure OR a crash', () => {
  assert.equal(guestTakenOver({ loadFailure: { code: -1 } }), true);
  assert.equal(guestTakenOver({ crash: { reason: 'crashed' } }), true);
  assert.equal(guestTakenOver({ loadFailure: { code: -1 }, crash: { reason: 'crashed' } }), true);
  assert.equal(guestTakenOver({ loadFailure: null, crash: null }), false);
  assert.equal(guestTakenOver({}), false);
  assert.equal(guestTakenOver(null), false);
  assert.equal(guestTakenOver(undefined), false);
});
