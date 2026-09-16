'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { SECURITY_STATES, deriveSecurityState } = require('../../src/shared/site-security');

test('SECURITY_STATES is frozen with exactly the five DD5 values', () => {
  assert.deepEqual(SECURITY_STATES, {
    SECURE: 'secure',
    INSECURE: 'insecure',
    OVERRIDDEN: 'overridden',
    NONE: 'none',
    INTERNAL: 'internal'
  });
  assert.ok(Object.isFrozen(SECURITY_STATES));
});

// ---------------------------------------------------------------------------
// deriveSecurityState — DD7 truth table, every branch
// ---------------------------------------------------------------------------

test('internal wins over everything else', () => {
  assert.equal(deriveSecurityState({ url: 'http://insecure.test/', internal: true }), 'internal');
  assert.equal(deriveSecurityState({ url: 'goldfinch://settings/', internal: true }), 'internal');
  assert.equal(deriveSecurityState({ internal: true }), 'internal', 'no url needed when internal');
});

test('none for a blank or missing url', () => {
  assert.equal(deriveSecurityState({ url: '' }), 'none');
  assert.equal(deriveSecurityState({ url: null }), 'none');
  assert.equal(deriveSecurityState({}), 'none');
  assert.equal(deriveSecurityState(), 'none');
});

test('none for an unparseable url', () => {
  assert.equal(deriveSecurityState({ url: 'not a url at all' }), 'none');
});

test('insecure for a parseable non-https url', () => {
  assert.equal(deriveSecurityState({ url: 'http://plain.test/' }), 'insecure');
  assert.equal(deriveSecurityState({ url: 'ftp://plain.test/' }), 'insecure');
});

test('none for about:blank (a live, non-internal, non-failed tab that has never navigated) — never insecure', () => {
  assert.equal(deriveSecurityState({ url: 'about:blank' }), 'none');
  assert.equal(deriveSecurityState({ url: 'about:blank#x' }), 'none');
});

test('overridden when the observer verification is present and not OK', () => {
  assert.equal(
    deriveSecurityState({
      url: 'https://bad.test/',
      verification: { verificationResult: 'net::ERR_CERT_AUTHORITY_INVALID' }
    }),
    'overridden'
  );
});

test('secure when the observer verification is present and OK, regardless of the overridden decision fallback', () => {
  assert.equal(
    deriveSecurityState({ url: 'https://ok.test/', verification: { verificationResult: 'net::OK' }, overridden: true }),
    'secure',
    'observation wins over the decision fallback — a mid-session fix reads secure'
  );
});

test('overridden via the decision fallback when no observer entry exists', () => {
  assert.equal(deriveSecurityState({ url: 'https://bad.test/', verification: null, overridden: true }), 'overridden');
});

test('secure when there is no observer entry and no override decision', () => {
  assert.equal(deriveSecurityState({ url: 'https://ok.test/', verification: null, overridden: false }), 'secure');
  assert.equal(deriveSecurityState({ url: 'https://ok.test/' }), 'secure');
});

test('a verification object with no verificationResult string is treated as absent (falls to the decision fallback)', () => {
  assert.equal(deriveSecurityState({ url: 'https://bad.test/', verification: {}, overridden: true }), 'overridden');
  assert.equal(deriveSecurityState({ url: 'https://ok.test/', verification: {}, overridden: false }), 'secure');
});

test('never throws on malformed input', () => {
  assert.doesNotThrow(() => deriveSecurityState(null));
  assert.doesNotThrow(() => deriveSecurityState({ url: 42 }));
  assert.doesNotThrow(() => deriveSecurityState({ url: 'https://x.test/', verification: 'not-an-object' }));
});
