'use strict';

// Unit tests for the vault-capture sheet template (Mission 12, Flight 2, Leg 4
// capture-save, DD7). The card + per-offer content are built by the pure,
// document-injected buildVaultCaptureCard / renderVaultCaptureCard so the
// save-vs-update rendering AND the vault-choice-on-save-only contract are testable
// against the fake-document helper without a live sheet — the same idiom the other
// vault templates use. Behavior (Save invoke, Cancel/Escape, Tab-cycle) is wired in
// menu-overlay.js. The captured password is NEVER in the model — nothing here renders
// or reads one.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createDocument } = require('./helpers/jars-page-dom');
const {
  buildVaultCaptureCard, renderVaultCaptureCard, selectedVaultId,
} = require('../../src/shared/vault-capture-template.js');

test('buildVaultCaptureCard: a centered backdrop + a role="dialog" card with Save/Cancel', () => {
  const document = createDocument();
  const refs = buildVaultCaptureCard(document);
  assert.equal(refs.node.id, 'sheet-vault-capture');
  assert.equal(refs.node.classList.contains('hidden'), true);
  assert.equal(refs.card.attributes.get('role'), 'dialog');
  assert.equal(refs.card.attributes.get('aria-modal'), 'true');
  assert.equal(refs.save.textContent, 'Save');
  assert.equal(refs.cancel.textContent, 'Cancel');
  assert.equal(refs.card.parentNode, refs.node);
});

test('renderVaultCaptureCard (save): Save heading + a vault radio choice, default checked', () => {
  const document = createDocument();
  const refs = buildVaultCaptureCard(document);
  const model = {
    origin: 'https://a.example', username: 'me@a', mode: 'save', defaultVaultId: 'work',
    choices: [{ vaultId: 'work', label: 'Work' }, { vaultId: 'global', label: 'Global' }],
  };
  const { mode, choiceInputs } = renderVaultCaptureCard(document, refs, model);

  assert.equal(mode, 'save');
  assert.equal(refs.heading.textContent, 'Save password?');
  assert.equal(refs.originValue.textContent, 'https://a.example');
  assert.equal(refs.usernameValue.textContent, 'me@a');
  // Two radio choices; the default vault is the one pre-checked.
  assert.equal(choiceInputs.length, 2);
  assert.equal(choiceInputs[0].value, 'work');
  assert.equal(choiceInputs[0].checked, true, 'the default active jar is pre-checked');
  assert.equal(choiceInputs[1].value, 'global');
  assert.equal(choiceInputs[1].checked, false);
  assert.equal(refs.choices.classList.contains('hidden'), false);
  // selectedVaultId reads the checked radio.
  assert.equal(selectedVaultId(choiceInputs), 'work');
  // No password rendered anywhere.
  assert.ok(!JSON.stringify(model).includes('password'));
});

test('renderVaultCaptureCard (update): Update heading and NO vault choice', () => {
  const document = createDocument();
  const refs = buildVaultCaptureCard(document);
  const model = { origin: 'https://a.example', username: 'me@a', mode: 'update', defaultVaultId: 'work', choices: [] };
  const { mode, choiceInputs } = renderVaultCaptureCard(document, refs, model);

  assert.equal(mode, 'update');
  assert.equal(refs.heading.textContent, 'Update password?');
  assert.deepEqual(choiceInputs, [], 'no vault choice is rendered on an update');
  assert.equal(refs.choices.classList.contains('hidden'), true);
  assert.equal(refs.choices.children.length, 0);
  assert.equal(selectedVaultId(choiceInputs), null, 'no choice → null (the caller passes the fixed default)');
});

test('renderVaultCaptureCard: a null username renders a "(no username)" placeholder', () => {
  const document = createDocument();
  const refs = buildVaultCaptureCard(document);
  renderVaultCaptureCard(document, refs, { origin: 'https://a.example', username: null, mode: 'save', defaultVaultId: 'work', choices: ['work'] });
  assert.equal(refs.usernameValue.textContent, '(no username)');
});

test('renderVaultCaptureCard: string choices render, global labeled "Global", first checked without a default', () => {
  const document = createDocument();
  const refs = buildVaultCaptureCard(document);
  const { choiceInputs } = renderVaultCaptureCard(document, refs, {
    origin: 'https://a.example', username: 'me@a', mode: 'save', choices: ['work', 'global'],
  });
  // No defaultVaultId → the first choice is checked.
  assert.equal(choiceInputs[0].checked, true);
  assert.equal(choiceInputs[1].checked, false);
  // The global choice's visible label is "Global".
  const globalLabel = refs.choices.children[1].children[1];
  assert.equal(globalLabel.textContent, 'Global');
});

test('renderVaultCaptureCard: re-render replaces prior content + clears the error line', () => {
  const document = createDocument();
  const refs = buildVaultCaptureCard(document);
  renderVaultCaptureCard(document, refs, { origin: 'https://a.example', username: 'x', mode: 'save', defaultVaultId: 'work', choices: ['work', 'global'] });
  refs.error.textContent = 'Couldn’t save the password';
  const { choiceInputs } = renderVaultCaptureCard(document, refs, { origin: 'https://b.example', username: 'y', mode: 'update', defaultVaultId: 'work', choices: [] });
  assert.equal(refs.error.textContent, '', 'error cleared on re-render');
  assert.equal(refs.originValue.textContent, 'https://b.example');
  assert.equal(refs.choices.children.length, 0, 'prior save choices removed on the update re-render');
  assert.deepEqual(choiceInputs, []);
});

test('selectedVaultId: honors the checked radio, else the first, else null', () => {
  assert.equal(selectedVaultId([]), null);
  assert.equal(selectedVaultId([{ checked: false, value: 'a' }, { checked: true, value: 'b' }]), 'b');
  assert.equal(selectedVaultId([{ checked: false, value: 'a' }, { checked: false, value: 'b' }]), 'a');
});
