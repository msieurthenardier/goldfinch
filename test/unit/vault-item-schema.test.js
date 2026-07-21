'use strict';

// Unit tests for src/shared/vault-item-schema.js (M12 Flight 3, Leg 2) — the
// per-type secret/non-secret SSOT. The COMPLEMENT invariant (nonSecret ∩ secret =
// ∅) and the metadataOf POSITIVE-WHITELIST (never emits a secret key) are the
// load-bearing properties both the metadata projection and the save-merge rely on.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const schema = require('../../src/shared/vault-item-schema');
const { SCHEMA, ITEM_TYPES, secretFieldsFor, nonSecretFieldsFor, metadataOf } = schema;

test('the three item types are exactly login/card/note', () => {
  assert.deepEqual([...ITEM_TYPES].sort(), ['card', 'login', 'note']);
});

test('COMPLEMENT invariant: nonSecret ∩ secret = ∅ for every type', () => {
  for (const type of ITEM_TYPES) {
    const nonSecret = new Set(nonSecretFieldsFor(type));
    const secret = new Set(secretFieldsFor(type));
    const overlap = [...secret].filter((f) => nonSecret.has(f));
    assert.deepEqual(overlap, [], `type ${type}: fields in BOTH sets: ${overlap.join(', ')}`);
    // Both sets are non-empty and internally unique.
    assert.ok(nonSecret.size > 0 && secret.size > 0);
    assert.equal(nonSecretFieldsFor(type).length, nonSecret.size, 'nonSecret has no dupes');
    assert.equal(secretFieldsFor(type).length, secret.size, 'secret has no dupes');
  }
});

test('taxonomy matches the flight Context: notes is a secret on EVERY type; note body is secret', () => {
  for (const type of ITEM_TYPES) {
    assert.ok(secretFieldsFor(type).includes('notes'), `${type}: notes must be secret`);
  }
  assert.ok(secretFieldsFor('note').includes('body'), 'note body is secret');
  assert.ok(!nonSecretFieldsFor('note').includes('body'), 'note body is NOT metadata');
  assert.deepEqual(secretFieldsFor('login'), ['password', 'totp', 'notes']);
  assert.deepEqual(secretFieldsFor('card'), ['number', 'cvv', 'expiry', 'notes']);
});

test('metadataOf emits NO secret key for any type, even when the item carries secrets', () => {
  const items = {
    login: { id: 'l1', type: 'login', title: 'T', username: 'u', origin: 'https://x', password: 'PW', totp: 'SEED', notes: 'N' },
    card: { id: 'c1', type: 'card', title: 'T', cardholder: 'CH', brand: 'visa', last4: '4242', number: '4111111111111111', cvv: '123', expiry: '12/30', notes: 'N' },
    note: { id: 'n1', type: 'note', title: 'T', body: 'BODY', notes: 'N' },
  };
  for (const type of ITEM_TYPES) {
    const meta = metadataOf(items[type]);
    for (const s of secretFieldsFor(type)) {
      assert.equal(s in meta, false, `metadataOf(${type}) leaked secret key "${s}"`);
    }
    // No secret VALUE appears either.
    const json = JSON.stringify(meta);
    for (const needle of ['PW', 'SEED', '4111111111111111', 'BODY']) {
      assert.equal(json.includes(needle), false, `metadataOf(${type}) leaked value "${needle}"`);
    }
    // Positive: id/type/hasTotp + every non-secret field is present.
    assert.equal(meta.id, items[type].id);
    assert.equal(meta.type, type);
    assert.equal('hasTotp' in meta, true);
    for (const ns of nonSecretFieldsFor(type)) assert.equal(ns in meta, true, `${type} missing ${ns}`);
  }
});

test('metadataOf.hasTotp reflects only totp PRESENCE (a boolean, never the seed)', () => {
  assert.equal(metadataOf({ id: 'a', type: 'login', totp: 'JBSWY3DP' }).hasTotp, true);
  assert.equal(metadataOf({ id: 'b', type: 'login' }).hasTotp, false);
  assert.equal(metadataOf({ id: 'c', type: 'card', number: 'x' }).hasTotp, false);
});

test('metadataOf is a POSITIVE whitelist — a stray unknown/secret key on the item is dropped', () => {
  const meta = metadataOf({ id: 'x', type: 'note', title: 'T', body: 'secret', evil: '<img>', password: 'nope' });
  assert.deepEqual(Object.keys(meta).sort(), ['hasTotp', 'id', 'title', 'type']);
});

test('metadataOf defaults an absent non-secret field to null (stable shape)', () => {
  const meta = metadataOf({ id: 'x', type: 'login', title: 'T' });
  assert.equal(meta.username, null);
  assert.equal(meta.origin, null);
});

test('unknown type throws for metadataOf / secretFieldsFor / nonSecretFieldsFor', () => {
  assert.throws(() => metadataOf({ id: 'x', type: 'wat' }), /unknown item type/);
  assert.throws(() => secretFieldsFor('wat'), /unknown item type/);
  assert.throws(() => nonSecretFieldsFor('wat'), /unknown item type/);
});

test('SCHEMA arrays are the returned fresh copies — mutating a result cannot corrupt the SSOT', () => {
  const s = secretFieldsFor('login');
  s.push('injected');
  assert.equal(SCHEMA.login.secret.includes('injected'), false, 'SCHEMA must be untouched');
});
