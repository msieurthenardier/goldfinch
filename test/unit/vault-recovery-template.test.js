'use strict';

// Unit tests for the vault-recovery-show sheet template DOM/aria structure (M12 Flight 3
// Leg 4 first-run-setup, DD5). Built by the pure, document-injected buildVaultRecoveryCard
// so its structure/aria contract is testable against the fake-document helper without a
// live sheet. Behavior (render the key text, Copy, acknowledge, drop-on-close, and the
// dismiss-DISABLED wiring) is in menu-overlay.js; the dismiss-disabled invariant is also
// pinned by the modal-card-controller characterization suite.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createDocument } = require('./helpers/jars-page-dom');
const { buildVaultRecoveryCard } = require('../../src/shared/vault-recovery-template.js');

test('vault-recovery card is a modal dialog with a read-only key display, Copy + acknowledge', () => {
  const document = createDocument();
  const card = buildVaultRecoveryCard(document);

  assert.equal(card.node.id, 'sheet-vault-recovery');
  assert.equal(card.node.classList.contains('hidden'), true);

  assert.equal(card.card.attributes.get('role'), 'dialog');
  assert.equal(card.card.attributes.get('aria-modal'), 'true');
  assert.equal(card.card.attributes.get('aria-label'), 'Save your recovery key');

  // The key value is a READ-ONLY display element — NOT an input (nothing to submit).
  assert.equal(card.keyValue.tagName, 'DIV');
  assert.equal(card.keyValue.attributes.get('aria-readonly'), 'true');
  assert.equal(card.keyValue.attributes.get('aria-label'), 'Recovery key');
  assert.equal(card.keyValue.textContent, '', 'no key material baked into the built card');

  // Copy + acknowledge are the only controls; both type=button.
  assert.equal(card.copy.type, 'button');
  assert.equal(card.copy.textContent, 'Copy');
  assert.equal(card.acknowledge.type, 'button');
  assert.equal(card.acknowledge.textContent, "I've saved it");

  // No input element anywhere in the card (the recovery key is display-only).
  const hasInput = (function find(node) {
    if (node.tagName === 'INPUT') return true;
    return node.children.some(find);
  })(card.card);
  assert.equal(hasInput, false, 'a recovery-show card must contain no input field');
});

test('Copy is a gold PRIMARY button carrying a decorative copy glyph, label stays textContent-only', () => {
  const document = createDocument();
  const card = buildVaultRecoveryCard(document);
  const classes = card.copy.className.split(' ');
  assert.ok(classes.includes('primary'), 'Copy is the gold primary button (I2–I4)');
  assert.ok(classes.includes('vault-copy-btn'));
  // The glyph is a decorative SVG node prepended via createElementNS (no innerHTML), and the
  // accessible label is still the plain "Copy" text (textContent-only).
  const icon = card.copy.children.find((c) => c.tagName === 'SVG');
  assert.ok(icon, 'a copy glyph svg is present in the Copy button');
  assert.equal(icon.attributes.get('aria-hidden'), 'true', 'the glyph is decorative');
  assert.equal(card.copy.textContent, 'Copy');
});

test('replacing-lede line is built hidden by default (setup case) and carries the rotation warning', () => {
  const document = createDocument();
  const card = buildVaultRecoveryCard(document);

  // The rotate-recovery warning line exists but is HIDDEN by default — the first-run setup
  // case has no prior key to replace (HAT I9). textContent-only, never markup.
  assert.ok(card.replacingLede, 'a replacing-lede node ref is exposed');
  assert.equal(card.replacingLede.tagName, 'P');
  assert.equal(card.replacingLede.hidden, true, 'hidden by default (setup case shows no line)');
  assert.equal(
    card.replacingLede.textContent,
    'This replaces your previous recovery key — the old one no longer works.'
  );
  // It lives inside the card so the reveal path (menu-overlay.js) can toggle it in place.
  assert.ok(card.card.children.includes(card.replacingLede));
});

test('each buildVaultRecoveryCard call yields a fresh, independent node tree', () => {
  const document = createDocument();
  const a = buildVaultRecoveryCard(document);
  const b = buildVaultRecoveryCard(document);
  assert.notEqual(a.node, b.node);
  assert.notEqual(a.keyValue, b.keyValue);
});
