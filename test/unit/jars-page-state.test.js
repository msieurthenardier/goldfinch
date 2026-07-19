'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.join(__dirname, '../../src/renderer/pages/jars-page-state.js')).href;

test('default normalization handles persistent jars and structured-cloned Burner', async () => {
  const { normalizeDefaultId } = await import(moduleUrl);
  assert.equal(normalizeDefaultId({ id: 'personal' }, '__burner__'), 'personal');
  assert.equal(normalizeDefaultId({ id: '__burner__' }, '__burner__'), null);
  assert.equal(normalizeDefaultId(null, '__burner__'), null);
});

test('broadcast-before-resolve state is payload-owned and unchanged payload identity is preserved', async () => {
  const { stateFromPayload } = await import(moduleUrl);
  const containers = [{ id: 'broadcast' }];
  const broadcast = stateFromPayload({ containers: [], defaultId: null }, { containers, defaultId: 'broadcast' });
  const unchanged = stateFromPayload(broadcast, { containers, defaultId: 'broadcast' });
  assert.equal(unchanged, broadcast);
  const laterInvokeValue = { id: 'invoke-result-not-authority' };
  assert.equal(broadcast.containers.includes(laterInvokeValue), false);
});

test('deleted-row confirm closes while unrelated transient state keeps identity', async () => {
  const { reconcileTransient } = await import(moduleUrl);
  const confirm = { mode: 'confirm', rowId: 'gone', action: 'delete', draft: null };
  assert.deepEqual(reconcileTransient(confirm, [{ id: 'survivor' }]), { mode: null, rowId: null, action: null, draft: null });
  const create = { mode: 'create', rowId: null, action: null, draft: { name: 'Draft' } };
  assert.equal(reconcileTransient(create, []), create);
});

test('hash targeting uses exact ids, including panel ids with hyphens', async () => {
  const { exactHashTarget } = await import(moduleUrl);
  const ids = new Set(['jar-work--site-data', 'jar-work--cookies']);
  assert.equal(exactHashTarget('#jar-work--site-data', ids), 'jar-work--site-data');
  assert.equal(exactHashTarget('#jar-work--site', ids), null);
  assert.equal(exactHashTarget('#jar-work--site-data-extra', ids), null);
});

test('row lookup and render transition keys are deterministic', async () => {
  const { findContainer, sectionSetKey, createPanelModeKey } = await import(moduleUrl);
  const rows = [{ id: 'a' }, { id: 'burner' }];
  assert.equal(findContainer(rows, 'a'), rows[0]);
  assert.equal(findContainer(rows, 'missing'), null);
  assert.equal(sectionSetKey(rows), 'a|burner');
  assert.equal(createPanelModeKey({ mode: 'create' }), 'create');
  assert.equal(createPanelModeKey({ mode: 'confirm' }), null);
});
