'use strict';

// Unit tests for the vault-import sheet template DOM/aria structure (M12 Flight 4 Leg 1
// export-import, DD1/DD2). The card is built by the pure, document-injected buildVaultImportCard
// so its structure/aria contract is testable against the fake-document helper without a live
// sheet — the vault-stepup-template idiom. Behavior (secretKind toggle, empty guard, submit → the
// dedicated menu-overlay:vault-import Buffer channel, Tab-trap) is wired in menu-overlay.js and
// exercised by the handler integration suite.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createDocument } = require('./helpers/jars-page-dom');
const { buildVaultImportCard } = require('../../src/shared/vault-import-template.js');

test('vault-import card is a modal dialog with a secretKind radio group, a single secret field, aria-live error, Import + Cancel', () => {
  const document = createDocument();
  const card = buildVaultImportCard(document);

  assert.equal(card.node.id, 'sheet-vault-import');
  assert.equal(card.node.classList.contains('hidden'), true);

  // The card itself is the accessible dialog: role=dialog + aria-modal=true + a name.
  assert.equal(card.card.attributes.get('role'), 'dialog');
  assert.equal(card.card.attributes.get('aria-modal'), 'true');
  assert.equal(card.card.attributes.get('aria-label'), 'Unlock the import bundle');
  assert.equal(card.card.parentNode, card.node);

  // A single secret field (type=password), spellcheck off, stable id.
  assert.equal(card.input.type, 'password');
  assert.equal(card.input.id, 'sheet-vault-import-secret');
  assert.equal(card.input.spellcheck, false);

  // Exactly ONE non-radio input (the secret) + TWO radios (the secretKind toggle).
  let radios = 0;
  let secrets = 0;
  (function walk(node) {
    if (node.tagName === 'INPUT') {
      if (node.type === 'radio') radios += 1;
      else secrets += 1;
    }
    for (const c of node.children) walk(c);
  })(card.card);
  assert.equal(secrets, 1, 'exactly one secret input');
  assert.equal(radios, 2, 'exactly two secretKind radios (master | recovery)');

  // The secretKind radios share a name; master is the default.
  assert.equal(card.masterRadio.type, 'radio');
  assert.equal(card.recoveryRadio.type, 'radio');
  assert.equal(card.masterRadio.name, card.recoveryRadio.name, 'radios share a group name');
  assert.equal(card.masterRadio.value, 'master');
  assert.equal(card.recoveryRadio.value, 'recovery');
  assert.equal(card.masterRadio.checked, true, 'master is the default secretKind');
  assert.equal(card.recoveryRadio.checked, false);

  // A polite aria-live error line, empty until an empty / wrong-secret re-prompt.
  assert.equal(card.error.attributes.get('aria-live'), 'polite');
  assert.equal(card.error.textContent, '');
  assert.equal(card.error.attributes.has('role'), false);

  // Import + Cancel are type=button (never a form submit).
  assert.equal(card.submit.type, 'button');
  assert.equal(card.submit.textContent, 'Import');
  assert.equal(card.cancel.type, 'button');
  assert.equal(card.cancel.textContent, 'Cancel');
});

test('each buildVaultImportCard call yields a fresh, independent node tree', () => {
  const document = createDocument();
  const a = buildVaultImportCard(document);
  const b = buildVaultImportCard(document);
  assert.notEqual(a.node, b.node);
  assert.notEqual(a.input, b.input);
});
