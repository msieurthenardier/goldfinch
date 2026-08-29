'use strict';

// Unit tests for the vault-adminkey-show sheet template DOM/aria structure (M12 Flight 4
// Leg 3 admin-key-provision, DD4). Built by the pure, document-injected buildVaultAdminKeyCard
// so its structure/aria contract is testable against the fake-document helper without a live
// sheet. Behavior (render the private key, Copy, acknowledge, drop-on-close, and the
// dismiss-DISABLED wiring) is in menu-overlay.js; the dismiss-locked invariant — the
// acknowledge button (the actions region's last child) is the only control that dismisses
// the sheet — is enforced there too, not by this template test.
//
// NEW FILE (M17 Flight 3 Leg 1): vault-adminkey-template.js had no test file. Leg 1 adds one
// so the secret-scrub-on-close invariant (M15 F3 DD1f) is pinned red-on-delete against importable code.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createDocument } = require('./helpers/jars-page-dom');
const { buildVaultAdminKeyCard } = require('../../src/shared/vault-adminkey-template.js');

test('vault-adminkey card is a modal dialog with a read-only key display, Copy + acknowledge', () => {
  const document = createDocument();
  const card = buildVaultAdminKeyCard(document);

  assert.equal(card.node.id, 'sheet-vault-adminkey');
  assert.equal(card.node.classList.contains('hidden'), true);

  assert.equal(card.card.attributes.get('role'), 'dialog');
  assert.equal(card.card.attributes.get('aria-modal'), 'true');
  assert.equal(card.card.attributes.get('aria-label'), 'Copy your admin key');

  // The admin private key is a READ-ONLY display element — NOT an input (nothing to submit).
  assert.equal(card.keyValue.tagName, 'DIV');
  assert.equal(card.keyValue.attributes.get('aria-readonly'), 'true');
  assert.equal(card.keyValue.attributes.get('aria-label'), 'Admin key');
  assert.equal(card.keyValue.textContent, '', 'no key material baked into the built card');

  // Copy + acknowledge are the only controls; both type=button.
  assert.equal(card.copy.type, 'button');
  assert.equal(card.copy.textContent, 'Copy');
  assert.equal(card.acknowledge.type, 'button');
  assert.equal(card.acknowledge.textContent, "I've saved it");

  // No input element anywhere in the card (the private key is display-only).
  const hasInput = (function find(node) {
    if (node.tagName === 'INPUT') return true;
    return node.children.some(find);
  })(card.card);
  assert.equal(hasInput, false, 'an adminkey-show card must contain no input field');
});

test('acknowledge is the LAST actions button — the a11y-audit dismiss-locked branch clicks button:last-child', () => {
  const document = createDocument();
  const card = buildVaultAdminKeyCard(document);
  // The dismiss-locked audit branch queries `.new-container-actions button:last-child` and
  // expects the acknowledge. Assert the DOM order the audit relies on.
  const actions = card.card.children.find((c) => c.className === 'new-container-actions');
  assert.ok(actions, 'a .new-container-actions row exists');
  assert.deepEqual(actions.children, [card.copy, card.acknowledge]);
  assert.equal(actions.children[actions.children.length - 1], card.acknowledge);
});

test('Copy is a gold PRIMARY button carrying a decorative copy glyph, label stays textContent-only', () => {
  const document = createDocument();
  const card = buildVaultAdminKeyCard(document);
  const classes = card.copy.className.split(' ');
  assert.ok(classes.includes('primary'), 'Copy is the gold primary button (I2–I4)');
  assert.ok(classes.includes('vault-copy-btn'));
  const icon = card.copy.children.find((c) => c.tagName === 'SVG');
  assert.ok(icon, 'a copy glyph svg is present in the Copy button');
  assert.equal(icon.attributes.get('aria-hidden'), 'true', 'the glyph is decorative');
  assert.equal(card.copy.textContent, 'Copy');
});

test('each buildVaultAdminKeyCard call yields a fresh, independent node tree', () => {
  const document = createDocument();
  const a = buildVaultAdminKeyCard(document);
  const b = buildVaultAdminKeyCard(document);
  assert.notEqual(a.node, b.node);
  assert.notEqual(a.keyValue, b.keyValue);
});

// The "never retained past the display" invariant (M15 F3 DD1f), pinned against IMPORTABLE code.
// menu-overlay.js's onClose calls refs.scrub() instead of an inline textContent = ''; this
// test goes RED if the scrub() body is deleted — the real red-on-delete pin the flight's
// Verification requires (not a source-text presence check, not a mock-node factory test).
test('scrub() empties the admin key display node (never retained past the display)', () => {
  const document = createDocument();
  const card = buildVaultAdminKeyCard(document);
  card.keyValue.textContent = 'ADMIN-PRIVATE-KEY-b64-material';
  assert.equal(card.keyValue.textContent, 'ADMIN-PRIVATE-KEY-b64-material', 'precondition: key is displayed');
  card.scrub();
  assert.equal(card.keyValue.textContent, '', 'scrub() clears the admin key from the DOM');
});
