'use strict';

// Unit tests for src/shared/vault-editor-model.js (M12 Flight 3, Leg 2) — the pure
// editor logic: unchanged-secret assembly, the mask/reveal/clear-on-hide state
// machine, and the http/https origin-link guard. Also PINS the presentation field
// layout to the main-side security schema so the two taxonomies cannot drift.
//
// require(esm): Node ≥22 loads the ESM module synchronously — the same file the page
// imports (the vault-page-model.test.js precedent).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const m = require('../../src/shared/vault-editor-model.js');
const schema = require('../../src/shared/vault-item-schema.js');

/* ---------------------------------------------- layout ↔ schema consistency (drift guard) */

test('EDITOR_LAYOUT secret/non-secret sets EXACTLY match the security schema per type', () => {
  for (const type of schema.ITEM_TYPES) {
    assert.deepEqual(m.secretNames(type).sort(), schema.secretFieldsFor(type).sort(), `${type} secret drift`);
    assert.deepEqual(m.nonSecretNames(type).sort(), schema.nonSecretFieldsFor(type).sort(), `${type} non-secret drift`);
  }
  assert.deepEqual([...m.EDITOR_TYPES].sort(), [...schema.ITEM_TYPES].sort());
});

/* ---------------------------------------------------------------- assembleSave */

test('assembleSave: masked-untouched secrets go to unchangedSecrets (placeholder value)', () => {
  const { item, unchangedSecrets } = m.assembleSave({
    type: 'login',
    id: 'x1',
    nonSecretValues: { title: 'New', username: 'u', origin: 'https://x' },
    secretStates: {
      password: m.newSecretState(),
      totp: m.newSecretState(),
      notes: m.newSecretState(),
    },
  });
  assert.equal(item.id, 'x1');
  assert.equal(item.title, 'New');
  assert.deepEqual(unchangedSecrets.sort(), ['notes', 'password', 'totp']);
  // Every field is still present on the item (full-item editor), secrets as placeholders.
  assert.equal(item.password, '');
  assert.equal(item.totp, '');
  assert.equal(item.notes, '');
});

test('assembleSave: an EDITED secret is sent verbatim and is NOT in unchangedSecrets', () => {
  const states = {
    password: m.edit(m.newSecretState(), 'brandNewPW'),
    totp: m.newSecretState(),
    notes: m.newSecretState(),
  };
  const { item, unchangedSecrets } = m.assembleSave({
    type: 'login', id: 'x', nonSecretValues: { title: 'T' }, secretStates: states,
  });
  assert.equal(item.password, 'brandNewPW');
  assert.deepEqual(unchangedSecrets.sort(), ['notes', 'totp']);
});

test('assembleSave: an EXPLICIT clear (edited to "") sends "" and is NOT preserved', () => {
  const states = {
    password: m.newSecretState(),
    totp: m.edit(m.reveal(m.newSecretState(), 'SEED'), ''), // revealed then cleared
    notes: m.newSecretState(),
  };
  const { item, unchangedSecrets } = m.assembleSave({ type: 'login', id: 'x', nonSecretValues: {}, secretStates: states });
  assert.equal(item.totp, '', 'explicitly cleared');
  assert.equal(unchangedSecrets.includes('totp'), false, 'a cleared field is not unchanged');
  assert.ok(unchangedSecrets.includes('password') && unchangedSecrets.includes('notes'));
});

test('assembleSave: a NEW item (no id) via initialSecretStates preserves NOTHING (create-defense safe)', () => {
  const secretStates = m.initialSecretStates('note', true);
  const { item, unchangedSecrets } = m.assembleSave({
    type: 'note', nonSecretValues: { title: 'Fresh' }, secretStates,
  });
  assert.equal('id' in item, false, 'no id on a create');
  assert.deepEqual(unchangedSecrets, [], 'a new item names no unchanged secrets');
  assert.equal(item.body, '');
});

test('initialSecretStates: edit opens masked+untouched; new opens shown+touched', () => {
  const edit = m.initialSecretStates('login', false);
  for (const n of m.secretNames('login')) {
    assert.deepEqual(edit[n], { value: '', revealed: false, touched: false });
  }
  const create = m.initialSecretStates('login', true);
  for (const n of m.secretNames('login')) {
    assert.equal(create[n].touched, true);
    assert.equal(create[n].revealed, true);
  }
});

/* --------------------------------------------------- mask / reveal / hide reducers */

test('reveal shows plaintext WITHOUT marking touched (unchanged on save)', () => {
  const st = m.reveal(m.newSecretState(), 'theSecret');
  assert.deepEqual(st, { value: 'theSecret', revealed: true, touched: false });
  // A revealed-but-untouched field still preserves (unchangedSecrets), never re-sends the plaintext.
  const { item, unchangedSecrets } = m.assembleSave({
    type: 'note', id: 'x', nonSecretValues: { title: 'T' },
    secretStates: { body: st, notes: m.newSecretState() },
  });
  assert.ok(unchangedSecrets.includes('body'));
  assert.equal(item.body, '', 'revealed-untouched plaintext is NOT put into the save payload');
});

test('hide (clear-on-hide/blur/save) wipes the value and re-masks back to untouched', () => {
  const revealed = m.reveal(m.newSecretState(), 'plaintext');
  const hidden = m.hide(revealed);
  assert.deepEqual(hidden, { value: '', revealed: false, touched: false });
});

/* ----------------------------------------------------------------- safeHttpUrl */

test('safeHttpUrl admits http/https and REJECTS javascript: and other schemes', () => {
  assert.equal(m.safeHttpUrl('https://example.com/login'), 'https://example.com/login');
  assert.equal(m.safeHttpUrl('http://example.com'), 'http://example.com/');
  assert.equal(m.safeHttpUrl('javascript:alert(1)'), null);
  assert.equal(m.safeHttpUrl('data:text/html,x'), null);
  assert.equal(m.safeHttpUrl('file:///etc/passwd'), null);
  assert.equal(m.safeHttpUrl('not a url'), null);
  assert.equal(m.safeHttpUrl(''), null);
  assert.equal(m.safeHttpUrl(null), null);
});
