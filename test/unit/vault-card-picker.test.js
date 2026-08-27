'use strict';

// Unit tests for the vault-picker sheet's CARD rows and Logins/Cards sectioning
// (issue #152) — the card half of vault-picker-template.test.js, same pure
// document-injected discipline.
//
// The invariant that matters most here is the INDEX MAPPING: section headings are
// presentational nodes inserted between rows, and `data-pick-index` must stay the
// position in the FULL model (what the chrome dispatch resolves against), not the
// position within a section. A regression there fills the WRONG credential.

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
const CARD2 = { type: 'card', vaultId: 'global', id: 'c2', title: 'Shared Amex', brand: 'Amex', last4: '0005' };

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

test('secondaryLineFor: a card shows brand + masked last4, a login shows its username', () => {
  assert.equal(secondaryLineFor(CARD), 'Visa  •••• 4242');
  assert.equal(secondaryLineFor(LOGIN), 'a@example.com');
});

test('secondaryLineFor degrades cleanly on a partial card', () => {
  assert.equal(secondaryLineFor({ type: 'card', brand: 'Visa' }), 'Visa');
  assert.equal(secondaryLineFor({ type: 'card', last4: '4242' }), '•••• 4242');
  assert.equal(secondaryLineFor({ type: 'card' }), '');
});

test('secondaryLineFor never emits raw card digits beyond last4', () => {
  // Defense in depth: even if a PAN somehow rode the model, the line reads only the
  // declared non-secret fields.
  const line = secondaryLineFor({ type: 'card', brand: 'Visa', last4: '4242', number: '4242424242424242' });
  assert.equal(line, 'Visa  •••• 4242');
  assert.ok(!line.includes('4242424242424242'));
});

// --- card rows -------------------------------------------------------------

test('a card row renders its title and the brand/last4 secondary line', () => {
  const { buttons } = render([CARD]);
  const row = buttons[0];
  assert.equal(titleOf(row).textContent, 'Personal Visa');
  assert.equal(subOf(row).textContent, 'Visa  •••• 4242');
  assert.equal(row.dataset.pickIndex, '0');
});

test('a card row uses the card glyph, a login row the credential padlock', () => {
  const { buttons } = render([LOGIN, CARD]);
  // Both are inline SVGs; they differ in their shape children (the card carries a stripe path).
  assert.equal(iconOf(buttons[0]).tagName.toLowerCase(), 'svg');
  assert.equal(iconOf(buttons[1]).tagName.toLowerCase(), 'svg');
  const cardPaths = iconOf(buttons[1]).children.filter((c) => c.tagName.toLowerCase() === 'path');
  assert.equal(cardPaths.length, 1, 'the card glyph has the magnetic-stripe path');
  assert.equal(cardPaths[0].attributes.get('d'), 'M2 10h20');
});

test('a titleless card falls back to its brand/last4 rather than rendering blank', () => {
  const { buttons } = render([{ type: 'card', vaultId: 'work', id: 'c9', brand: 'Visa', last4: '4242' }]);
  assert.equal(titleOf(buttons[0]).textContent, 'Visa  •••• 4242');
});

test('a card with nothing but an id still renders a generic label', () => {
  const { buttons } = render([{ type: 'card', vaultId: 'work', id: 'c9' }]);
  assert.equal(titleOf(buttons[0]).textContent, 'Card');
});

// --- sectioning ------------------------------------------------------------

test('a logins-only picker renders NO section headings (unchanged pre-card behavior)', () => {
  const { list, buttons } = render([LOGIN]);
  assert.deepEqual(headings(list), []);
  assert.equal(buttons.length, 2, 'one row + the Manage footer');
});

test('a cards-only picker renders no section headings either', () => {
  const { list } = render([CARD, CARD2]);
  assert.deepEqual(headings(list), []);
});

test('a mixed picker renders Logins then Cards headings', () => {
  const { list } = render([LOGIN, CARD, CARD2]);
  assert.deepEqual(headings(list), ['Logins', 'Cards']);
});

test('section headings are aria-hidden and are NOT focusable menuitems', () => {
  const { list, buttons } = render([LOGIN, CARD]);
  const heads = list.children.filter((c) => c.className === 'vault-picker-section');
  assert.equal(heads.length, 2);
  for (const h of heads) {
    assert.equal(h.attributes.get('aria-hidden'), 'true');
    assert.equal(h.attributes.get('role'), undefined, 'never a menuitem');
    assert.ok(!buttons.includes(h), 'never enters the roving order');
  }
  assert.equal(buttons.length, 3, 'two rows + the Manage footer — headings excluded');
});

// --- the index-mapping invariant ------------------------------------------

test('data-pick-index stays the FULL-model index across section headings', () => {
  const model = [LOGIN, CARD, CARD2];
  const { buttons } = render(model);

  // buttons = [login, card, card2, manage]
  assert.equal(buttons[0].dataset.pickIndex, '0');
  assert.equal(buttons[1].dataset.pickIndex, '1');
  assert.equal(buttons[2].dataset.pickIndex, '2');

  // And each index resolves back to the intended model row.
  for (let i = 0; i < model.length; i += 1) {
    const idx = parsePickIndex(`pick:${buttons[i].dataset.pickIndex}`);
    assert.equal(model[idx].id, model[i].id, `row ${i} must resolve to its own model entry`);
  }
});

test('the first card after a heading is not off-by-one', () => {
  // The regression this guards: counting rendered CHILDREN instead of model entries
  // would shift every post-heading index by the number of headings before it.
  const model = [LOGIN, LOGIN, CARD];
  const { buttons } = render(model);
  assert.equal(buttons[2].dataset.pickIndex, '2', 'the card is model index 2, not 3');
});
