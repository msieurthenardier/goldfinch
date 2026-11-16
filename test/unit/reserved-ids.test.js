'use strict';

// Reserved-id single-source-of-truth cross-module consistency (M12 Flight 3, Leg 1
// / DD8). The `'global'` sentinel is the vault-store's manager-wide vault id AND a
// reserved container id in jars.js. Before this leg the two literals lived apart and
// could silently drift; now both consume src/shared/reserved-ids.js. These tests
// fail loudly if the sentinel ever diverges from either consumer.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { GLOBAL_ID } = require('../../src/shared/reserved-ids');
const vaultStore = require('../../src/main/vault/vault-store');
const jars = require('../../src/main/jars');

test('the shared sentinel is the literal `global`', () => {
  assert.equal(GLOBAL_ID, 'global');
});

test('vault-store consumes the shared sentinel (GLOBAL_ID identity)', () => {
  assert.equal(vaultStore.GLOBAL_ID, GLOBAL_ID);
});

test('the vault-store sentinel ∈ jars reserved ids (jars remaps it to jar-<id>)', () => {
  // isReservedId isn't exported, so assert membership behaviorally: a container
  // claiming the reserved sentinel is remapped (never dropped), proving jars treats
  // the vault-store's GLOBAL_ID as reserved.
  const result = jars.validateContainers([
    { id: vaultStore.GLOBAL_ID, name: 'Global', color: '#4caf50', partition: 'persist:container:global' }
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, `jar-${GLOBAL_ID}`, 'the reserved sentinel is remapped, not honored');
  // Data survives the remap (DD4 remap-not-drop contract).
  assert.equal(result[0].partition, 'persist:container:global');
  assert.equal(result[0].name, 'Global');
});

test('a non-reserved id is NOT remapped (control)', () => {
  const result = jars.validateContainers([
    { id: 'personal', name: 'Personal', color: '#4caf50', partition: 'persist:container:personal' }
  ]);
  assert.equal(result[0].id, 'personal');
});

// One predicate (leg admin-key-name AC7b): the key-map consumers and jars.js share
// src/shared/reserved-ids.js; jars.js's behaviour is the drift guard.
const { isReservedId, isReservedKeyName } = require('../../src/shared/reserved-ids');

test('isReservedId — the whole reserved set, exact-match only', () => {
  for (const id of ['burner', 'burner-1', 'admin', 'internal', 'default', 'global'])
    assert.equal(isReservedId(id), true, id);
  for (const id of ['Admin', 'admin ', 'personal', 'jar-admin', 'xburner', '', null, undefined, 3]) {
    assert.equal(isReservedId(id), false, String(id));
  }
});

test('isReservedKeyName — reserved ids plus the non-own-entry names', () => {
  assert.equal(isReservedKeyName('admin'), true);
  assert.equal(isReservedKeyName('__proto__'), true);
  assert.equal(isReservedKeyName('constructor'), true);
  assert.equal(isReservedKeyName('personal'), false);
});

test('drift guard — every id isReservedId rejects is remapped by jars.validateContainers', () => {
  for (const id of ['burner', 'burner-1', 'admin', 'internal', 'default', 'global']) {
    const [out] = jars.validateContainers([
      { id, name: 'X', color: '#4caf50', partition: `persist:container:${id}-x` }
    ]);
    assert.equal(out.id, `jar-${id}`, id);
  }
});
