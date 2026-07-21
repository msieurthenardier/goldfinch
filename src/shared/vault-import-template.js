// @ts-check

// DOM builder for the menu-overlay sheet's `vault-import-unlock` template (M12 Flight 4
// Leg 1 export-import, DD1/DD2) — the chrome-owned secret entry that opens a portable
// import bundle. Extracted as a pure, document-injected builder (the vault-stepup-template.js
// idiom) so the structure / aria contract is unit-testable against the fake-document helper
// without a live sheet. menu-overlay.js imports this, then wires behavior (secretKind toggle,
// submit → the dedicated `menu-overlay:vault-import` secret Buffer channel, Tab-trap, Escape)
// onto the refs.
//
// The card mirrors the vault-stepup backdrop (centered, role="dialog" aria-modal="true") but
// adds a `secretKind` radio group (master password | recovery key) selecting how the single
// secret field is interpreted. The secret leaves via a DEDICATED request/response channel as a
// Uint8Array, NEVER channel-4 activated (string-only / 24-char capped); the destination target
// + the bundle are held MAIN-SIDE (never on this sheet). Reuses the `.new-container-*` /
// `.text-btn` classes for visual parity with the other vault sheets.

/**
 * Build the vault-import-unlock card DOM.
 * @param {Document} document
 * @returns {{
 *   node: HTMLElement,
 *   card: HTMLElement,
 *   input: HTMLInputElement,
 *   masterRadio: HTMLInputElement,
 *   recoveryRadio: HTMLInputElement,
 *   error: HTMLElement,
 *   submit: HTMLButtonElement,
 *   cancel: HTMLButtonElement,
 * }}
 */
export function buildVaultImportCard(document) {
  const node = document.createElement('div');
  node.id = 'sheet-vault-import';
  node.classList.add('hidden');

  const card = document.createElement('div');
  card.className = 'new-container-inner vault-import-inner';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'Unlock the import bundle');
  node.appendChild(card);

  const heading = document.createElement('div');
  heading.className = 'vault-import-heading';
  heading.textContent = 'Unlock the import bundle';
  card.appendChild(heading);

  const lede = document.createElement('p');
  lede.className = 'vault-import-lede';
  lede.textContent =
    'Enter the source master password or the recovery key to open this bundle. It is re-keyed under this profile.';
  card.appendChild(lede);

  // secretKind toggle — a radio group choosing how the secret field is read.
  const fieldset = document.createElement('fieldset');
  fieldset.className = 'vault-import-kind';
  const legend = document.createElement('legend');
  legend.className = 'vault-import-kind-legend';
  legend.textContent = 'Secret type';
  fieldset.appendChild(legend);

  const masterWrap = document.createElement('label');
  masterWrap.className = 'vault-import-kind-option';
  const masterRadio = /** @type {HTMLInputElement} */ (document.createElement('input'));
  masterRadio.type = 'radio';
  masterRadio.name = 'vault-import-kind';
  masterRadio.value = 'master';
  masterRadio.checked = true;
  masterWrap.appendChild(masterRadio);
  masterWrap.appendChild(document.createTextNode('Master password'));
  fieldset.appendChild(masterWrap);

  const recoveryWrap = document.createElement('label');
  recoveryWrap.className = 'vault-import-kind-option';
  const recoveryRadio = /** @type {HTMLInputElement} */ (document.createElement('input'));
  recoveryRadio.type = 'radio';
  recoveryRadio.name = 'vault-import-kind';
  recoveryRadio.value = 'recovery';
  recoveryRadio.checked = false;
  recoveryWrap.appendChild(recoveryRadio);
  recoveryWrap.appendChild(document.createTextNode('Recovery key'));
  fieldset.appendChild(recoveryWrap);

  card.appendChild(fieldset);

  const label = document.createElement('label');
  label.className = 'new-container-label';
  label.htmlFor = 'sheet-vault-import-secret';
  label.textContent = 'Master password or recovery key';

  const input = /** @type {HTMLInputElement} */ (document.createElement('input'));
  input.id = 'sheet-vault-import-secret';
  input.className = 'new-container-input';
  input.type = 'password';
  input.autocomplete = 'off';
  input.spellcheck = false;

  // aria-live error line — empty until an empty / wrong-secret re-prompt. role="alert"
  // deliberately NOT set (would double-announce with aria-live); polite announces the inline
  // error without stealing focus. Same shape as the other vault sheets' error lines.
  const error = document.createElement('div');
  error.className = 'vault-import-error';
  error.setAttribute('aria-live', 'polite');
  error.textContent = '';

  const actions = document.createElement('div');
  actions.className = 'new-container-actions';
  const submit = /** @type {HTMLButtonElement} */ (document.createElement('button'));
  submit.className = 'text-btn small';
  submit.type = 'button';
  submit.textContent = 'Import';
  const cancel = /** @type {HTMLButtonElement} */ (document.createElement('button'));
  cancel.className = 'text-btn small';
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  actions.appendChild(submit);
  actions.appendChild(cancel);

  card.appendChild(label);
  card.appendChild(input);
  card.appendChild(error);
  card.appendChild(actions);

  return { node, card, input, masterRadio, recoveryRadio, error, submit, cancel };
}
