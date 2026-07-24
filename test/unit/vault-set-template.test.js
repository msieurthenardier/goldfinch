'use strict';

// Unit tests for the vault-set sheet template DOM/aria structure (M12 Flight 3 Leg 4
// first-run-setup, DD5). The card is built by the pure, document-injected buildVaultSetCard
// so its structure/aria contract is testable against the fake-document helper without a
// live sheet — the vault-unlock-template idiom. Behavior (confirm-match check, submit →
// the dedicated menu-overlay:vault-setup Buffer channel, Tab-trap) is wired in
// menu-overlay.js and exercised by the handler integration suite.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createDocument } = require('./helpers/jars-page-dom');
const { buildVaultSetCard } = require('../../src/shared/vault-set-template.js');

test('vault-set card is a modal dialog with password + confirm inputs, aria-live error, Set up + Cancel', () => {
  const document = createDocument();
  const card = buildVaultSetCard(document);

  assert.equal(card.node.id, 'sheet-vault-set');
  assert.equal(card.node.classList.contains('hidden'), true);

  // The card itself is the accessible dialog: role=dialog + aria-modal=true + a name.
  assert.equal(card.card.attributes.get('role'), 'dialog');
  assert.equal(card.card.attributes.get('aria-modal'), 'true');
  assert.equal(card.card.attributes.get('aria-label'), 'Set up the password manager');
  assert.equal(card.card.parentNode, card.node);

  // BOTH fields are password (never text) with spellcheck off + distinct ids.
  assert.equal(card.input.type, 'password');
  assert.equal(card.input.id, 'sheet-vault-set-password');
  assert.equal(card.input.spellcheck, false);
  assert.equal(card.confirm.type, 'password');
  assert.equal(card.confirm.id, 'sheet-vault-set-confirm');
  assert.equal(card.confirm.spellcheck, false);
  assert.notEqual(card.input.id, card.confirm.id);

  // A polite aria-live error line, empty until a mismatch / failure; role=alert NOT set.
  assert.equal(card.error.attributes.get('aria-live'), 'polite');
  assert.equal(card.error.textContent, '');
  assert.equal(card.error.attributes.has('role'), false);

  // Set up + Cancel are type=button (never a form submit).
  assert.equal(card.submit.type, 'button');
  assert.equal(card.submit.textContent, 'Set up');
  assert.equal(card.cancel.type, 'button');
  assert.equal(card.cancel.textContent, 'Cancel');

  // DOM order: password label → password → confirm label → confirm → error → actions.
  const [label, input, confirmLabel, confirm, error, actions] = card.card.children;
  assert.equal(label.tagName, 'LABEL');
  assert.equal(label.htmlFor, 'sheet-vault-set-password');
  assert.equal(input, card.input);
  assert.equal(confirmLabel.tagName, 'LABEL');
  assert.equal(confirmLabel.htmlFor, 'sheet-vault-set-confirm');
  assert.equal(confirm, card.confirm);
  assert.equal(error, card.error);
  assert.deepEqual(actions.children, [card.submit, card.cancel]);
});

test('each buildVaultSetCard call yields a fresh, independent node tree', () => {
  const document = createDocument();
  const a = buildVaultSetCard(document);
  const b = buildVaultSetCard(document);
  assert.notEqual(a.node, b.node);
  assert.notEqual(a.input, b.input);
  assert.notEqual(a.confirm, b.confirm);
});
