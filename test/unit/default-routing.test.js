'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { resolveNewTabContainer } = require('../../src/shared/default-routing');

// ---------------------------------------------------------------------------
// Truth table (leg spec, Implementation Guidance step 2)
// ---------------------------------------------------------------------------

test('matching defaultId resolves the container', () => {
  const containers = [{ id: 'a' }, { id: 'b' }];
  assert.deepEqual(resolveNewTabContainer(containers, 'a'), { id: 'a' });
});

test('defaultId null (Burner holds the flag) resolves null', () => {
  assert.equal(resolveNewTabContainer([{ id: 'a' }], null), null);
});

test('defaultId undefined (boot snapshot pending) resolves null', () => {
  assert.equal(resolveNewTabContainer([{ id: 'a' }], undefined), null);
});

test('stale defaultId (no matching container) resolves null', () => {
  assert.equal(resolveNewTabContainer([{ id: 'a' }], 'b'), null);
});

test('empty containers array resolves null', () => {
  assert.equal(resolveNewTabContainer([], 'a'), null);
});

test('undefined containers array resolves null', () => {
  assert.equal(resolveNewTabContainer(/** @type {any} */ (undefined), 'a'), null);
});

test('never throws on malformed entries', () => {
  assert.doesNotThrow(() => {
    const result = resolveNewTabContainer(/** @type {any} */ ([null, { id: 'a' }]), 'a');
    assert.deepEqual(result, { id: 'a' });
  });
});

test('malformed entries with no match resolve null, not a throw', () => {
  assert.doesNotThrow(() => {
    assert.equal(resolveNewTabContainer(/** @type {any} */ ([null, { id: 'a' }]), 'missing'), null);
  });
});

// ---------------------------------------------------------------------------
// Verification Steps node -e snippet, pinned as a test
// ---------------------------------------------------------------------------
test('verification snippet: {id:a} null null', () => {
  assert.deepEqual(resolveNewTabContainer([{ id: 'a' }], 'a'), { id: 'a' });
  assert.equal(resolveNewTabContainer([], null), null);
  assert.equal(resolveNewTabContainer([{ id: 'a' }], 'b'), null);
});
