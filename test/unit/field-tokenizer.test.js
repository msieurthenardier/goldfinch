'use strict';

// Unit test for the family-agnostic field-name / autocomplete tokenizing
// primitives (Mission 21, Flight 2, Leg 1 — squawks 0090/0091). Tested
// INDEPENDENTLY of any family's patterns or token vocabulary — no card, no
// identity — per the leg's own discipline: normalization and the anchor gate
// (vault-card-fields.test.js) are separate mechanisms, and a suite that can
// only prove them together cannot attribute a regression to one or the other.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeFieldHaystack, resolveAutocompleteToken } = require('../../src/preload/field-tokenizer');

// --- normalizeFieldHaystack -------------------------------------------------

test('splits camelCase humps (squawk 0087 mechanism, family-agnostic)', () => {
  assert.equal(normalizeFieldHaystack('ccExpMonth'), 'cc Exp Month');
  assert.equal(normalizeFieldHaystack('cardholderName'), 'cardholder Name');
  assert.equal(normalizeFieldHaystack('creditCardExpirationMonth'), 'credit Card Expiration Month');
});

test('splits a digit→uppercase hump too', () => {
  assert.equal(normalizeFieldHaystack('cc2Name'), 'cc2 Name');
});

test('maps underscore to space (squawk 0091 mechanism)', () => {
  assert.equal(normalizeFieldHaystack('card_nameOnCard'), 'card name On Card');
  assert.equal(normalizeFieldHaystack('card_securityCode'), 'card security Code');
  assert.equal(normalizeFieldHaystack('form_expMonth'), 'form exp Month');
});

test('maps hyphen to space', () => {
  assert.equal(normalizeFieldHaystack('card-number'), 'card number');
  assert.equal(normalizeFieldHaystack('exp-month'), 'exp month');
});

test('combines underscore and camelCase in one haystack', () => {
  assert.equal(normalizeFieldHaystack('card_cardExpMonth'), 'card card Exp Month');
});

test('a string with no humps or separators is unchanged', () => {
  assert.equal(normalizeFieldHaystack('cvv'), 'cvv');
  assert.equal(normalizeFieldHaystack('number'), 'number');
});

test('an already-spaced haystack is unaffected', () => {
  assert.equal(normalizeFieldHaystack('Name on Card'), 'Name on Card');
});

test('an empty string stays empty', () => {
  assert.equal(normalizeFieldHaystack(''), '');
});

test('consecutive uppercase letters are not split (no hump between two uppercase)', () => {
  assert.equal(normalizeFieldHaystack('CCNumber'), 'CCNumber');
});

// --- resolveAutocompleteToken -----------------------------------------------

const ROLE_MAP = new Map([
  ['cc-number', 'number'],
  ['given-name', 'given']
]);

test('resolves a bare token', () => {
  assert.equal(resolveAutocompleteToken('cc-number', ROLE_MAP), 'number');
});

test('resolves a token behind a prefix chain, first matching token wins', () => {
  assert.equal(resolveAutocompleteToken('section-payment billing cc-number', ROLE_MAP), 'number');
  assert.equal(resolveAutocompleteToken('shipping given-name', ROLE_MAP), 'given');
});

test('is case-insensitive', () => {
  assert.equal(resolveAutocompleteToken('CC-NUMBER', ROLE_MAP), 'number');
  assert.equal(resolveAutocompleteToken('Billing CC-Number', ROLE_MAP), 'number');
});

test('tolerates irregular whitespace between tokens', () => {
  assert.equal(resolveAutocompleteToken('billing   cc-number', ROLE_MAP), 'number');
});

test('returns null when no token in the value resolves', () => {
  assert.equal(resolveAutocompleteToken('username', ROLE_MAP), null);
  assert.equal(resolveAutocompleteToken('billing shipping', ROLE_MAP), null);
});

test('returns null for null, undefined and empty values', () => {
  assert.equal(resolveAutocompleteToken(null, ROLE_MAP), null);
  assert.equal(resolveAutocompleteToken(undefined, ROLE_MAP), null);
  assert.equal(resolveAutocompleteToken('', ROLE_MAP), null);
});

test('an empty role map never resolves anything', () => {
  assert.equal(resolveAutocompleteToken('cc-number', new Map()), null);
});
