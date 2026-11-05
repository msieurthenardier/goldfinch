'use strict';

// Unit tests for the vault-capture sheet template (Mission 12, Flight 2, Leg 4
// capture-save, DD7; made NON-MODAL for the corner save prompt, Sortie 06). The card + per-offer content are built by the pure,
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
  buildVaultCaptureCard,
  renderVaultCaptureCard,
  selectedVaultId,
  resultNounOf
} = require('../../src/shared/vault-capture-template.js');

test('buildVaultCaptureCard (Sortie 06, AC22): a NON-MODAL card - root role="dialog" with aria-labelledby/-describedby, NO aria-modal, NO backdrop', () => {
  const document = createDocument();
  const refs = buildVaultCaptureCard(document);
  // the card IS the root (no backdrop wrapper), and it is not pre-hidden
  assert.equal(refs.node, refs.card);
  assert.equal(refs.node.id, 'save-prompt-card');
  assert.equal(refs.card.parentNode, null, 'no backdrop wrapper around the card');
  assert.equal(refs.card.attributes.get('role'), 'dialog');
  assert.equal(refs.card.attributes.has('aria-modal'), false, 'the page behind the prompt stays operable');
  assert.equal(refs.card.attributes.get('aria-labelledby'), refs.heading.id);
  assert.equal(refs.card.attributes.get('aria-describedby'), refs.fields.id);
  assert.ok(refs.heading.id && refs.fields.id, 'both targets carry real ids');
  // controls: Save + "Not now" + a dismiss X; plus the counter, timer bar and result status node
  assert.equal(refs.save.textContent, 'Save');
  assert.equal(refs.cancel.textContent, 'Not now');
  assert.equal(refs.dismissX.attributes.get('aria-label'), 'Dismiss');
  assert.equal(refs.status.attributes.get('role'), 'status');
  assert.equal(refs.status.classList.contains('hidden'), true, 'result state hidden until used');
  assert.ok(refs.timerFill && refs.counter);
});

test('resultNounOf resolves through KIND_TABLE (login / card / identity; unknown -> login)', () => {
  assert.equal(resultNounOf({ kind: 'login' }), 'Password');
  assert.equal(resultNounOf({}), 'Password');
  assert.equal(resultNounOf({ kind: 'card' }), 'Card');
  assert.equal(resultNounOf({ kind: 'identity' }), 'Details');
  assert.equal(resultNounOf({ kind: 'constructor' }), 'Password');
  assert.equal(resultNounOf(null), 'Password');
});

test('renderVaultCaptureCard: a choice flagged `disabled` (unresolvable jar) is shown but NOT selectable or pre-checked', () => {
  const document = createDocument();
  const refs = buildVaultCaptureCard(document);
  const { choiceInputs } = renderVaultCaptureCard(document, refs, {
    origin: 'https://a.example',
    mode: 'save',
    defaultVaultId: 'gone-jar',
    choices: [
      { vaultId: 'gone-jar', label: 'Unknown vault', disabled: true },
      { vaultId: 'global', label: 'Global' }
    ]
  });
  assert.equal(choiceInputs[0].disabled, true);
  assert.equal(choiceInputs[0].checked, false);
  assert.equal(choiceInputs[1].disabled, false);
});

test('renderVaultCaptureCard (save): Save heading + a vault radio choice, default checked', () => {
  const document = createDocument();
  const refs = buildVaultCaptureCard(document);
  const model = {
    origin: 'https://a.example',
    username: 'me@a',
    mode: 'save',
    defaultVaultId: 'work',
    choices: [
      { vaultId: 'work', label: 'Work' },
      { vaultId: 'global', label: 'Global' }
    ]
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
  renderVaultCaptureCard(document, refs, {
    origin: 'https://a.example',
    username: null,
    mode: 'save',
    defaultVaultId: 'work',
    choices: ['work']
  });
  assert.equal(refs.usernameValue.textContent, '(no username)');
});

test('renderVaultCaptureCard: string choices render, global labeled "Global", first checked without a default', () => {
  const document = createDocument();
  const refs = buildVaultCaptureCard(document);
  const { choiceInputs } = renderVaultCaptureCard(document, refs, {
    origin: 'https://a.example',
    username: 'me@a',
    mode: 'save',
    choices: ['work', 'global']
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
  renderVaultCaptureCard(document, refs, {
    origin: 'https://a.example',
    username: 'x',
    mode: 'save',
    defaultVaultId: 'work',
    choices: ['work', 'global']
  });
  refs.error.textContent = 'Couldn’t save the password';
  const { choiceInputs } = renderVaultCaptureCard(document, refs, {
    origin: 'https://b.example',
    username: 'y',
    mode: 'update',
    defaultVaultId: 'work',
    choices: []
  });
  assert.equal(refs.error.textContent, '', 'error cleared on re-render');
  assert.equal(refs.originValue.textContent, 'https://b.example');
  assert.equal(refs.choices.children.length, 0, 'prior save choices removed on the update re-render');
  assert.deepEqual(choiceInputs, []);
});

test('selectedVaultId: honors the checked radio, else the first, else null', () => {
  assert.equal(selectedVaultId([]), null);
  assert.equal(
    selectedVaultId([
      { checked: false, value: 'a' },
      { checked: true, value: 'b' }
    ]),
    'b'
  );
  assert.equal(
    selectedVaultId([
      { checked: false, value: 'a' },
      { checked: false, value: 'b' }
    ]),
    'a'
  );
});

// --- identity mode-dispatch (M21 F3 Leg 4, AC17/AC18) -----------------------

test('renderVaultCaptureCard (identity, fresh save): "Save your details?" + the vault choice', () => {
  const document = createDocument();
  const refs = buildVaultCaptureCard(document);
  const { mode } = renderVaultCaptureCard(document, refs, {
    kind: 'identity',
    origin: 'https://shop.example',
    mode: 'save',
    addedFields: ['First name', 'Email', 'Street address'],
    changedFields: [],
    defaultVaultId: 'work',
    choices: ['work', 'global']
  });
  assert.equal(mode, 'save');
  assert.equal(refs.heading.textContent, 'Save your details?');
  assert.equal(refs.card.attributes.get('aria-labelledby'), refs.heading.id, 'AC22: the heading labels the dialog');
  assert.equal(refs.subjectLabel.textContent, 'Fields');
  assert.equal(refs.usernameValue.textContent, 'First name, Email, Street address');
  assert.equal(refs.choices.classList.contains('hidden'), false, 'a save offers the vault choice');
});

test('renderVaultCaptureCard (identity, gap-fill): "Add to your saved details?" + no vault choice', () => {
  const document = createDocument();
  const refs = buildVaultCaptureCard(document);
  const { mode, choiceInputs } = renderVaultCaptureCard(document, refs, {
    kind: 'identity',
    origin: 'https://shop.example',
    mode: 'update',
    addedFields: ['Phone'],
    changedFields: [],
    defaultVaultId: 'work',
    choices: []
  });
  assert.equal(mode, 'update');
  assert.equal(refs.heading.textContent, 'Add to your saved details?');
  assert.equal(refs.usernameValue.textContent, 'Phone');
  assert.deepEqual(choiceInputs, [], 'an update renders no vault choice');
  assert.equal(refs.choices.classList.contains('hidden'), true);
});

test('renderVaultCaptureCard (identity, conflict): "Update your saved details?" names BOTH groups', () => {
  const document = createDocument();
  const refs = buildVaultCaptureCard(document);
  renderVaultCaptureCard(document, refs, {
    kind: 'identity',
    origin: 'https://shop.example',
    mode: 'update',
    addedFields: ['Phone'],
    changedFields: ['Street address', 'Postal code'],
    defaultVaultId: 'work',
    choices: []
  });
  assert.equal(refs.heading.textContent, 'Update your saved details?');
  assert.equal(refs.usernameValue.textContent, 'Phone · Street address, Postal code', 'both groups named');
});

test('renderVaultCaptureCard (identity): with no fields at all, the subject row falls back to "(no fields)"', () => {
  const document = createDocument();
  const refs = buildVaultCaptureCard(document);
  renderVaultCaptureCard(document, refs, {
    kind: 'identity',
    origin: 'https://shop.example',
    mode: 'save',
    addedFields: [],
    changedFields: [],
    defaultVaultId: 'work',
    choices: ['work', 'global']
  });
  assert.equal(refs.usernameValue.textContent, '(no fields)');
});

test('renderVaultCaptureCard (identity): every field label is rendered via textContent only — no markup', () => {
  const document = createDocument();
  const refs = buildVaultCaptureCard(document);
  renderVaultCaptureCard(document, refs, {
    kind: 'identity',
    origin: 'https://shop.example',
    mode: 'save',
    addedFields: ['<script>alert(1)</script>'],
    changedFields: [],
    defaultVaultId: 'work',
    choices: ['work']
  });
  assert.equal(refs.usernameValue.children.length, 0, 'no child elements — text only');
  assert.equal(refs.usernameValue.textContent, '<script>alert(1)</script>');
});

// ---- Sortie 06 Leg 2 (AC3): the LOCKED offer rendering ------------------------------------------

test('renderVaultCaptureCard (locked login/card): "Save to" choices, the lock note, primary "Unlock & save"', () => {
  for (const [kind, heading] of [
    [undefined, 'Save password?'],
    ['card', 'Save card?']
  ]) {
    const document = createDocument();
    const refs = buildVaultCaptureCard(document);
    const { choiceInputs } = renderVaultCaptureCard(document, refs, {
      origin: 'https://a.example',
      username: 'me',
      kind,
      mode: 'locked',
      defaultVaultId: 'work',
      choices: [
        { vaultId: 'work', label: 'Work' },
        { vaultId: 'global', label: 'Global' }
      ]
    });
    assert.equal(refs.heading.textContent, heading);
    assert.equal(choiceInputs.length, 2);
    assert.equal(selectedVaultId(choiceInputs), 'work');
    assert.equal(refs.save.textContent, 'Unlock & save');
    assert.equal(refs.lockNote.classList.contains('hidden'), false);
    assert.equal(refs.lockNote.textContent, 'Your vault is locked. You will enter your master password to save.');
  }
});

test('renderVaultCaptureCard (locked identity): primary reads "Unlock & review"; an unlocked re-render hides the note', () => {
  const document = createDocument();
  const refs = buildVaultCaptureCard(document);
  renderVaultCaptureCard(document, refs, { origin: 'https://a.example', kind: 'identity', mode: 'locked' });
  assert.equal(refs.save.textContent, 'Unlock & review');
  assert.equal(refs.lockNote.classList.contains('hidden'), false);
  renderVaultCaptureCard(document, refs, { origin: 'https://a.example', kind: 'identity', mode: 'save' });
  assert.equal(refs.save.textContent, 'Save');
  assert.equal(refs.lockNote.classList.contains('hidden'), true);
  assert.equal(refs.lockNote.textContent, '');
});
