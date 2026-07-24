'use strict';

// Unit tests for the vault-unlock sheet template DOM/aria structure (M12 Flight 2
// Leg 2 chrome-unlock, DD4). The card is built by the pure, document-injected
// buildVaultUnlockCard so its structure/aria contract is testable against the
// fake-document helper without a live sheet — the same idiom jars-create-controller
// uses. Behavior (submit → secret channel, Tab-trap) is wired in menu-overlay.js
// and exercised by the handler integration suite.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createDocument } = require('./helpers/jars-page-dom');
const { buildVaultUnlockCard } = require('../../src/shared/vault-unlock-template.js');

test('vault-unlock card is a modal dialog with a password input, aria-live error line, Unlock + Cancel', () => {
  const document = createDocument();
  const card = buildVaultUnlockCard(document);

  // Backdrop node, hidden by default (menu-controller onOpen unhides).
  assert.equal(card.node.id, 'sheet-vault-unlock');
  assert.equal(card.node.classList.contains('hidden'), true);

  // The card itself is the accessible dialog: role=dialog + aria-modal=true + a name.
  assert.equal(card.card.attributes.get('role'), 'dialog');
  assert.equal(card.card.attributes.get('aria-modal'), 'true');
  assert.equal(card.card.attributes.get('aria-label'), 'Unlock password manager');
  assert.equal(card.card.parentNode, card.node);

  // A password input (never type=text) with autocomplete off + spellcheck off.
  assert.equal(card.input.type, 'password');
  assert.equal(card.input.id, 'sheet-vault-password');
  assert.equal(card.input.autocomplete, 'off');
  assert.equal(card.input.spellcheck, false);

  // A polite aria-live error line, empty until a wrong-password re-prompt.
  assert.equal(card.error.attributes.get('aria-live'), 'polite');
  assert.equal(card.error.textContent, '');
  // role=alert deliberately NOT set (would double-announce with aria-live).
  assert.equal(card.error.attributes.has('role'), false);

  // Unlock + Cancel are type=button (never a form submit).
  assert.equal(card.unlock.type, 'button');
  assert.equal(card.unlock.textContent, 'Unlock');
  assert.equal(card.cancel.type, 'button');
  assert.equal(card.cancel.textContent, 'Cancel');

  // DOM order inside the card: label → input → error → actions(Unlock, Cancel).
  const [label, input, error, actions] = card.card.children;
  assert.equal(label.tagName, 'LABEL');
  assert.equal(label.htmlFor, 'sheet-vault-password'); // the label points at the input
  assert.equal(input, card.input);
  assert.equal(error, card.error);
  assert.deepEqual(actions.children, [card.unlock, card.cancel]);
});

test('each buildVaultUnlockCard call yields a fresh, independent node tree', () => {
  const document = createDocument();
  const a = buildVaultUnlockCard(document);
  const b = buildVaultUnlockCard(document);
  assert.notEqual(a.node, b.node);
  assert.notEqual(a.input, b.input);
});
