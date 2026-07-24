// @ts-check

// DOM builder for the menu-overlay sheet's `vault-change-master` template (M12 Flight 4
// Leg 2 key-rotation, DD3/DD2) — the chrome-owned master-password CHANGE entry: an
// OLD-password field (the step-up), a NEW-password field, and a CONFIRM field. Extracted
// as a pure, document-injected builder (the vault-set-template.js idiom) so the structure /
// aria contract is unit-testable against the fake-document helper without a live sheet.
// menu-overlay.js imports this, then wires behavior (client-side confirm-match check, submit
// → the dedicated `menu-overlay:vault-change-master` Buffer channel carrying the old + new
// secrets, Tab-trap, Escape) onto the refs.
//
// The card mirrors the vault-set backdrop (centered, role="dialog" aria-modal="true") but
// carries THREE fields. Only the OLD + NEW secrets cross the DEDICATED Buffer channel as
// Uint8Arrays (dual-zeroized) — the confirm check is RENDERER-side; NEITHER secret rides
// channel-4 activated (string-only / 24-char capped). Reuses the `.new-container-*` /
// `.text-btn` classes for visual parity with the other vault sheets.

/**
 * Build the vault-change-master card DOM.
 * @param {Document} document
 * @returns {{
 *   node: HTMLElement,
 *   card: HTMLElement,
 *   oldInput: HTMLInputElement,
 *   newInput: HTMLInputElement,
 *   confirm: HTMLInputElement,
 *   error: HTMLElement,
 *   submit: HTMLButtonElement,
 *   cancel: HTMLButtonElement,
 * }}
 */
export function buildVaultChangeMasterCard(document) {
  const node = document.createElement('div');
  node.id = 'sheet-vault-change-master';
  node.classList.add('hidden');

  const card = document.createElement('div');
  card.className = 'new-container-inner vault-change-master-inner';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'Change your master password');
  node.appendChild(card);

  const heading = document.createElement('div');
  heading.className = 'vault-change-master-heading';
  heading.textContent = 'Change your master password';
  card.appendChild(heading);

  const lede = document.createElement('p');
  lede.className = 'vault-change-master-lede';
  lede.textContent =
    'Confirm your current master password, then choose a new one. This re-wraps the vault key — your items are not re-encrypted.';
  card.appendChild(lede);

  const oldLabel = document.createElement('label');
  oldLabel.className = 'new-container-label';
  oldLabel.htmlFor = 'sheet-vault-change-master-old';
  oldLabel.textContent = 'Current master password';

  const oldInput = /** @type {HTMLInputElement} */ (document.createElement('input'));
  oldInput.id = 'sheet-vault-change-master-old';
  oldInput.className = 'new-container-input';
  oldInput.type = 'password';
  oldInput.autocomplete = 'current-password';
  oldInput.spellcheck = false;

  const newLabel = document.createElement('label');
  newLabel.className = 'new-container-label';
  newLabel.htmlFor = 'sheet-vault-change-master-new';
  newLabel.textContent = 'New master password';

  const newInput = /** @type {HTMLInputElement} */ (document.createElement('input'));
  newInput.id = 'sheet-vault-change-master-new';
  newInput.className = 'new-container-input';
  newInput.type = 'password';
  newInput.autocomplete = 'new-password';
  newInput.spellcheck = false;

  const confirmLabel = document.createElement('label');
  confirmLabel.className = 'new-container-label';
  confirmLabel.htmlFor = 'sheet-vault-change-master-confirm';
  confirmLabel.textContent = 'Confirm new master password';

  const confirm = /** @type {HTMLInputElement} */ (document.createElement('input'));
  confirm.id = 'sheet-vault-change-master-confirm';
  confirm.className = 'new-container-input';
  confirm.type = 'password';
  confirm.autocomplete = 'new-password';
  confirm.spellcheck = false;

  // aria-live error line — empty until an empty / mismatch / wrong-old-password re-prompt.
  // role="alert" deliberately NOT set (would double-announce with aria-live); polite
  // announces the inline error without stealing focus.
  const error = document.createElement('div');
  error.className = 'vault-change-master-error';
  error.setAttribute('aria-live', 'polite');
  error.textContent = '';

  const actions = document.createElement('div');
  actions.className = 'new-container-actions';
  const submit = /** @type {HTMLButtonElement} */ (document.createElement('button'));
  submit.className = 'text-btn primary vault-sheet-btn';
  submit.type = 'button';
  submit.textContent = 'Change password';
  const cancel = /** @type {HTMLButtonElement} */ (document.createElement('button'));
  cancel.className = 'text-btn vault-sheet-btn';
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  actions.appendChild(submit);
  actions.appendChild(cancel);

  card.appendChild(oldLabel);
  card.appendChild(oldInput);
  card.appendChild(newLabel);
  card.appendChild(newInput);
  card.appendChild(confirmLabel);
  card.appendChild(confirm);
  card.appendChild(error);
  card.appendChild(actions);

  return { node, card, oldInput, newInput, confirm, error, submit, cancel };
}
