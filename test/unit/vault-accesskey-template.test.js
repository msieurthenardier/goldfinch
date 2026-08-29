'use strict';

// Unit tests for the vault-accesskey-show sheet template DOM/aria structure (M12 Flight 3
// Leg 5 access-keys, DD5). Built by the pure, document-injected buildVaultAccessKeyCard so
// its structure/aria contract is testable against the fake-document helper without a live
// sheet. Behavior (render the secret + keyId, Copy, acknowledge, drop-on-close, and the
// dismiss-DISABLED wiring) is in menu-overlay.js; the dismiss-locked invariant — the
// acknowledge button (the actions region's last child) is the only control that
// dismisses the sheet — is enforced there too, not by this template test.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createDocument } = require('./helpers/jars-page-dom');
const { buildVaultAccessKeyCard } = require('../../src/shared/vault-accesskey-template.js');

test('vault-accesskey card is a modal dialog with read-only keyId + secret displays, Copy + acknowledge', () => {
  const document = createDocument();
  const card = buildVaultAccessKeyCard(document);

  assert.equal(card.node.id, 'sheet-vault-accesskey');
  assert.equal(card.node.classList.contains('hidden'), true);

  assert.equal(card.card.attributes.get('role'), 'dialog');
  assert.equal(card.card.attributes.get('aria-modal'), 'true');
  assert.equal(card.card.attributes.get('aria-label'), 'Copy your access key');

  // Both the keyId and the secret are READ-ONLY display elements — NOT inputs (nothing to
  // submit). Empty until rendered — no key material baked into the built card.
  for (const val of [card.keyIdValue, card.secretValue]) {
    assert.equal(val.tagName, 'DIV');
    assert.equal(val.attributes.get('aria-readonly'), 'true');
    assert.equal(val.textContent, '');
  }
  assert.equal(card.keyIdValue.attributes.get('aria-label'), 'Access key ID');
  assert.equal(card.secretValue.attributes.get('aria-label'), 'Access key');

  // Copy + acknowledge are the only controls; both type=button.
  assert.equal(card.copy.type, 'button');
  assert.equal(card.copy.textContent, 'Copy');
  assert.equal(card.acknowledge.type, 'button');
  assert.equal(card.acknowledge.textContent, "I've saved it");

  // No input element anywhere (the secret is display-only).
  const hasInput = (function find(node) {
    if (node.tagName === 'INPUT') return true;
    return node.children.some(find);
  })(card.card);
  assert.equal(hasInput, false, 'an accesskey-show card must contain no input field');
});

test('acknowledge is the LAST actions button — the a11y-audit dismiss-locked branch clicks button:last-child', () => {
  const document = createDocument();
  const card = buildVaultAccessKeyCard(document);
  // The dismiss-locked audit branch queries `.new-container-actions button:last-child` and
  // expects the acknowledge. Assert the DOM order the audit relies on.
  const actions = card.card.children.find((c) => c.className === 'new-container-actions');
  assert.ok(actions, 'a .new-container-actions row exists');
  assert.deepEqual(actions.children, [card.copy, card.acknowledge]);
  assert.equal(actions.children[actions.children.length - 1], card.acknowledge);
});

test('Copy is a gold PRIMARY button carrying a decorative copy glyph, label stays textContent-only', () => {
  const document = createDocument();
  const card = buildVaultAccessKeyCard(document);
  const classes = card.copy.className.split(' ');
  assert.ok(classes.includes('primary'), 'Copy is the gold primary button (I2–I4)');
  assert.ok(classes.includes('vault-copy-btn'));
  const icon = card.copy.children.find((c) => c.tagName === 'SVG');
  assert.ok(icon, 'a copy glyph svg is present in the Copy button');
  assert.equal(icon.attributes.get('aria-hidden'), 'true', 'the glyph is decorative');
  assert.equal(card.copy.textContent, 'Copy');
});

test('each buildVaultAccessKeyCard call yields a fresh, independent node tree', () => {
  const document = createDocument();
  const a = buildVaultAccessKeyCard(document);
  const b = buildVaultAccessKeyCard(document);
  assert.notEqual(a.node, b.node);
  assert.notEqual(a.secretValue, b.secretValue);
});

// The "never retained past the display" invariant (DD5), pinned against IMPORTABLE code.
// menu-overlay.js's onClose calls refs.scrub() instead of inline textContent = ''; this test
// goes RED if the scrub() body is deleted. scrub() clears BOTH the secret AND the keyId —
// preserving the exact behavior of the old inline onClose (the keyId is a non-secret
// revocation fingerprint but is cleared today alongside the secret).
test('scrub() empties BOTH the access secret and the keyId display nodes', () => {
  const document = createDocument();
  const card = buildVaultAccessKeyCard(document);
  card.secretValue.textContent = 'ACCESS-SECRET-9f8e7d';
  card.keyIdValue.textContent = 'keyid-1234';
  assert.equal(card.secretValue.textContent, 'ACCESS-SECRET-9f8e7d', 'precondition: secret displayed');
  assert.equal(card.keyIdValue.textContent, 'keyid-1234', 'precondition: keyId displayed');
  card.scrub();
  assert.equal(card.secretValue.textContent, '', 'scrub() clears the access secret');
  assert.equal(card.keyIdValue.textContent, '', 'scrub() also clears the keyId (behavior-preserving)');
});
