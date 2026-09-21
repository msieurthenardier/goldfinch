'use strict';

// Unit tests for the vault-picker sheet's IDENTITY rows and three-way sectioning
// (Mission 21, Flight 3, Leg 3 — identity-fill, AC20) — the identity twin of
// vault-card-picker.test.js, same pure document-injected discipline.
//
// The invariant that matters most here is the SAME index mapping vault-card-
// picker.test.js pins: section headings are presentational nodes inserted
// between rows, and `data-pick-index` must stay the position in the FULL model,
// not the position within a section.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createDocument } = require('./helpers/jars-page-dom');
const {
  buildVaultPickerCard,
  renderVaultPickerRows,
  secondaryLineFor,
  parsePickIndex
} = require('../../src/shared/vault-picker-template.js');

const textOf = (row) => row.children[1];
const titleOf = (row) => textOf(row).children[0];
const subOf = (row) => textOf(row).children[1];
const iconOf = (row) => row.children[0];

const LOGIN = { type: 'login', vaultId: 'work', id: 'l1', title: 'Example', username: 'a@example.com' };
const CARD = { type: 'card', vaultId: 'work', id: 'c1', title: 'Personal Visa', brand: 'Visa', last4: '4242' };
const IDENTITY = { type: 'identity', vaultId: 'work', id: 'i1', title: 'Home', fullName: 'Ada Lovelace' };
const IDENTITY2 = { type: 'identity', vaultId: 'global', id: 'i2', title: 'Work profile', fullName: 'Grace Hopper' };

function render(model) {
  const document = createDocument();
  const { card, list } = buildVaultPickerCard(document);
  const buttons = renderVaultPickerRows(document, list, model);
  return { document, card, list, buttons };
}

// The presentational section headings (never menuitems).
const headings = (list) =>
  list.children.filter((c) => c.className === 'vault-picker-section').map((c) => c.textContent);

// --- the secondary line ----------------------------------------------------

test('secondaryLineFor: an identity shows its fullName', () => {
  assert.equal(secondaryLineFor(IDENTITY), 'Ada Lovelace');
});

test('secondaryLineFor degrades cleanly on an identity with no fullName', () => {
  assert.equal(secondaryLineFor({ type: 'identity', title: 'Home' }), '');
});

test('secondaryLineFor never emits a secret identity field (street/email/phone/etc.)', () => {
  const line = secondaryLineFor({
    type: 'identity',
    fullName: 'Ada Lovelace',
    email: 'ada@example.com',
    street: '12 Analytical Engine Way'
  });
  assert.equal(line, 'Ada Lovelace');
  assert.ok(!line.includes('ada@example.com'));
  assert.ok(!line.includes('Analytical Engine'));
});

// --- identity rows -----------------------------------------------------------

test('an identity row renders its title and the fullName secondary line', () => {
  const { buttons } = render([IDENTITY]);
  const row = buttons[0];
  assert.equal(titleOf(row).textContent, 'Home');
  assert.equal(subOf(row).textContent, 'Ada Lovelace');
  assert.equal(row.dataset.pickIndex, '0');
});

test('an identity row uses a person-shaped glyph, distinct from login/card', () => {
  const { buttons } = render([LOGIN, CARD, IDENTITY]);
  for (const b of buttons.slice(0, 3)) {
    assert.equal(iconOf(b).tagName.toLowerCase(), 'svg');
  }
  // The identity glyph carries a circle (head) + a path (shoulders) — distinct
  // shape composition from the card's rect+stripe and the login's rect+path.
  const identityIcon = iconOf(buttons[2]);
  const circles = identityIcon.children.filter((c) => c.tagName.toLowerCase() === 'circle');
  assert.equal(circles.length, 1, 'the identity glyph has a head circle');
});

test('a titleless identity falls back to fullName rather than rendering blank', () => {
  const { buttons } = render([{ type: 'identity', vaultId: 'work', id: 'i9', fullName: 'Ada Lovelace' }]);
  assert.equal(titleOf(buttons[0]).textContent, 'Ada Lovelace');
});

test('an identity with nothing but an id still renders a generic label', () => {
  const { buttons } = render([{ type: 'identity', vaultId: 'work', id: 'i9' }]);
  assert.equal(titleOf(buttons[0]).textContent, 'Identity');
});

// --- sectioning --------------------------------------------------------------

test('an identity-only picker renders no section headings', () => {
  const { list } = render([IDENTITY, IDENTITY2]);
  assert.deepEqual(headings(list), []);
});

test('a three-way mixed picker renders Logins, Cards, then Identity headings, in that order', () => {
  const { list } = render([LOGIN, CARD, IDENTITY]);
  assert.deepEqual(headings(list), ['Logins', 'Cards', 'Identity']);
});

test('section headings for identity are aria-hidden and NOT focusable menuitems', () => {
  const { list, buttons } = render([LOGIN, IDENTITY]);
  const heads = list.children.filter((c) => c.className === 'vault-picker-section');
  assert.equal(heads.length, 2);
  for (const h of heads) {
    assert.equal(h.attributes.get('aria-hidden'), 'true');
    assert.equal(h.attributes.get('role'), undefined, 'never a menuitem');
    assert.ok(!buttons.includes(h), 'never enters the roving order');
  }
  assert.equal(buttons.length, 3, 'two rows + the Manage footer — headings excluded');
});

// --- the index-mapping invariant ---------------------------------------------

test('data-pick-index stays the FULL-model index across three families and their headings', () => {
  const model = [LOGIN, CARD, IDENTITY, IDENTITY2];
  const { buttons } = render(model);

  assert.equal(buttons[0].dataset.pickIndex, '0');
  assert.equal(buttons[1].dataset.pickIndex, '1');
  assert.equal(buttons[2].dataset.pickIndex, '2');
  assert.equal(buttons[3].dataset.pickIndex, '3');

  for (let i = 0; i < model.length; i += 1) {
    const idx = parsePickIndex(`pick:${buttons[i].dataset.pickIndex}`);
    assert.equal(model[idx].id, model[i].id, `row ${i} must resolve to its own model entry`);
  }
});

test('the first identity row after two headings is not off-by-one', () => {
  const model = [LOGIN, LOGIN, CARD, IDENTITY];
  const { buttons } = render(model);
  assert.equal(buttons[3].dataset.pickIndex, '3', 'the identity is model index 3, not 5');
});
