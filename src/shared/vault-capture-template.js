// @ts-check

// DOM builder + renderer for the menu-overlay sheet's `vault-capture` template
// (M12 Flight 2 Leg 4 capture-save, DD7) — the DEDICATED SEVENTH template kind.
// Extracted as pure, document-injected helpers (the same "pure module in
// src/shared/" pattern vault-unlock-template.js / vault-picker-template.js use) so
// the save-vs-update rendering AND the vault-choice-on-save-only contract are
// unit-testable against the fake-document helper without a live sheet. menu-overlay.js
// imports these and wires behavior (Save → the captureSave invoke, Cancel/Escape,
// Tab-cycle).
//
// The card mirrors the vault-unlock backdrop (centered, role="dialog"
// aria-modal="true") — the submit carries no anchor. It shows the origin + username
// (read-only), a "Save password?" / "Update password?" heading, and — for a `save`
// only — a vault choice (default the active jar, "Global" selectable). Save + Cancel.
//
// SECURITY (leg core): the model is METADATA ONLY (origin / username / mode /
// defaultVaultId / choices / captureId). The captured password NEVER reaches the
// sheet — it lives only in the main-side held record; the Save invoke reports just
// the chosen vaultId (+ captureId + token).

/**
 * Build the vault-capture card shell (built once by menu-overlay.js; the per-offer
 * content is filled by renderVaultCaptureCard).
 * @param {Document} document
 * @returns {{
 *   node: HTMLElement,
 *   card: HTMLElement,
 *   heading: HTMLElement,
 *   originValue: HTMLElement,
 *   usernameValue: HTMLElement,
 *   choices: HTMLElement,
 *   error: HTMLElement,
 *   save: HTMLButtonElement,
 *   cancel: HTMLButtonElement,
 * }}
 */
export function buildVaultCaptureCard(document) {
  const node = document.createElement('div');
  node.id = 'sheet-vault-capture';
  node.classList.add('hidden');

  const card = document.createElement('div');
  card.className = 'new-container-inner vault-capture-inner';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'Save password');
  node.appendChild(card);

  const heading = document.createElement('div');
  heading.className = 'vault-capture-heading';
  card.appendChild(heading);

  const originValue = makeField(document, card, 'Site');
  const usernameValue = makeField(document, card, 'Username');

  const choices = document.createElement('div');
  choices.className = 'vault-capture-choices';
  choices.setAttribute('role', 'radiogroup');
  choices.setAttribute('aria-label', 'Choose a vault');
  card.appendChild(choices);

  const error = document.createElement('div');
  error.className = 'vault-capture-error';
  error.setAttribute('aria-live', 'polite');
  error.textContent = '';
  card.appendChild(error);

  const actions = document.createElement('div');
  actions.className = 'new-container-actions';
  const save = /** @type {HTMLButtonElement} */ (document.createElement('button'));
  save.className = 'text-btn primary vault-sheet-btn';
  save.type = 'button';
  save.textContent = 'Save';
  const cancel = /** @type {HTMLButtonElement} */ (document.createElement('button'));
  cancel.className = 'text-btn vault-sheet-btn';
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  actions.appendChild(save);
  actions.appendChild(cancel);
  card.appendChild(actions);

  return { node, card, heading, originValue, usernameValue, choices, error, save, cancel };
}

/**
 * A labeled read-only field row ("<label>: <value>"). Returns the value span.
 * @param {Document} document
 * @param {HTMLElement} card
 * @param {string} labelText
 * @returns {HTMLElement}
 */
function makeField(document, card, labelText) {
  const row = document.createElement('div');
  row.className = 'vault-capture-field';
  const label = document.createElement('span');
  label.className = 'vault-capture-field-label';
  label.textContent = labelText;
  const value = document.createElement('span');
  value.className = 'vault-capture-field-value';
  row.appendChild(label);
  row.appendChild(value);
  card.appendChild(row);
  return value;
}

/**
 * Render the per-offer content into a built card: the Save/Update heading, the origin
 * + username, and — for a `save` only — a vault radio choice (default the model's
 * defaultVaultId; "Global" selectable). An `update` renders NO choice (the item's
 * vault is fixed). Clears the error line. Returns the choice radio inputs in order
 * (empty for `update`) so the caller can read the selection.
 * @param {Document} document
 * @param {ReturnType<typeof buildVaultCaptureCard>} refs
 * @param {{ origin?: string, username?: string|null, mode?: string, defaultVaultId?: string, choices?: Array<string | { vaultId: string, label?: string }> }} model
 * @returns {{ mode: 'save'|'update', choiceInputs: HTMLInputElement[] }}
 */
export function renderVaultCaptureCard(document, refs, model) {
  const mode = model && model.mode === 'update' ? 'update' : 'save';
  refs.heading.textContent = mode === 'update' ? 'Update password?' : 'Save password?';
  refs.card.setAttribute('aria-label', mode === 'update' ? 'Update password' : 'Save password');
  refs.originValue.textContent = String(model && model.origin != null ? model.origin : '');
  refs.usernameValue.textContent = model && model.username != null && model.username !== ''
    ? String(model.username)
    : '(no username)';
  refs.error.textContent = '';

  refs.choices.textContent = '';
  /** @type {HTMLInputElement[]} */
  const choiceInputs = [];
  if (mode === 'save') {
    refs.choices.classList.remove('hidden');
    const list = Array.isArray(model && model.choices) ? model.choices : [];
    const def = model && model.defaultVaultId;
    list.forEach((c, i) => {
      const vaultId = typeof c === 'string' ? c : (c && c.vaultId);
      const labelText = typeof c === 'string'
        ? (c === 'global' ? 'Global' : c)
        : (c && c.label != null && c.label !== '' ? c.label : (c && c.vaultId === 'global' ? 'Global' : (c && c.vaultId)));

      const optLabel = document.createElement('label');
      optLabel.className = 'vault-capture-choice';
      const input = /** @type {HTMLInputElement} */ (document.createElement('input'));
      input.type = 'radio';
      input.name = 'vault-capture-choice';
      input.value = String(vaultId != null ? vaultId : '');
      input.checked = def != null ? vaultId === def : i === 0;
      const span = document.createElement('span');
      span.textContent = String(labelText != null ? labelText : '');
      optLabel.appendChild(input);
      optLabel.appendChild(span);
      refs.choices.appendChild(optLabel);
      choiceInputs.push(input);
    });
  } else {
    refs.choices.classList.add('hidden');
  }

  return { mode, choiceInputs };
}

/**
 * The chosen vaultId from the rendered choice radios (the checked one, else the first,
 * else null). For an `update` (no choices), returns null — the caller passes the
 * model's defaultVaultId, which main ignores (it uses the record's fixed vault).
 * @param {HTMLInputElement[]} choiceInputs
 * @returns {string | null}
 */
export function selectedVaultId(choiceInputs) {
  if (!Array.isArray(choiceInputs) || !choiceInputs.length) return null;
  const checked = choiceInputs.find((i) => i.checked) || choiceInputs[0];
  return checked ? String(checked.value) : null;
}
