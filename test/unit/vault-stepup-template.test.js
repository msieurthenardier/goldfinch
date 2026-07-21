'use strict';

// Unit tests for the vault-stepup sheet template DOM/aria structure (M12 Flight 3 Leg 5
// access-keys, DD5). The card is built by the pure, document-injected buildVaultStepupCard
// so its structure/aria contract is testable against the fake-document helper without a
// live sheet — the vault-set-template idiom. Behavior (empty guard, submit → the dedicated
// menu-overlay:vault-stepup-mint Buffer channel carrying the target, Tab-trap) is wired in
// menu-overlay.js and exercised by the handler integration suite.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createDocument } = require('./helpers/jars-page-dom');
const { buildVaultStepupCard } = require('../../src/shared/vault-stepup-template.js');

test('vault-stepup card is a modal dialog with a SINGLE master-password field (no confirm), aria-live error, Mint + Cancel', () => {
  const document = createDocument();
  const card = buildVaultStepupCard(document);

  assert.equal(card.node.id, 'sheet-vault-stepup');
  assert.equal(card.node.classList.contains('hidden'), true);

  // The card itself is the accessible dialog: role=dialog + aria-modal=true + a name.
  assert.equal(card.card.attributes.get('role'), 'dialog');
  assert.equal(card.card.attributes.get('aria-modal'), 'true');
  assert.equal(card.card.attributes.get('aria-label'), 'Confirm your master password');
  assert.equal(card.card.parentNode, card.node);

  // A SINGLE password field (a re-auth — no confirm) with spellcheck off + a stable id.
  assert.equal(card.input.type, 'password');
  assert.equal(card.input.id, 'sheet-vault-stepup-password');
  assert.equal(card.input.spellcheck, false);
  assert.equal(card.input.autocomplete, 'current-password');

  // Exactly one input in the whole card (no confirm field).
  const inputCount = (function count(node) {
    let n = node.tagName === 'INPUT' ? 1 : 0;
    for (const c of node.children) n += count(c);
    return n;
  })(card.card);
  assert.equal(inputCount, 1, 'the step-up card has exactly one password input');

  // A polite aria-live error line, empty until an empty / wrong-password re-prompt.
  assert.equal(card.error.attributes.get('aria-live'), 'polite');
  assert.equal(card.error.textContent, '');
  assert.equal(card.error.attributes.has('role'), false);

  // Mint + Cancel are type=button (never a form submit).
  assert.equal(card.submit.type, 'button');
  assert.equal(card.submit.textContent, 'Mint access key');
  assert.equal(card.cancel.type, 'button');
  assert.equal(card.cancel.textContent, 'Cancel');
});

test('each buildVaultStepupCard call yields a fresh, independent node tree', () => {
  const document = createDocument();
  const a = buildVaultStepupCard(document);
  const b = buildVaultStepupCard(document);
  assert.notEqual(a.node, b.node);
  assert.notEqual(a.input, b.input);
});
