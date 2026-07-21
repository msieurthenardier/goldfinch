// @ts-check

// DOM builder for the menu-overlay sheet's `vault-set` template (M12 Flight 3 Leg 4
// first-run-setup, DD5) — the chrome-owned first-run master-password entry. Extracted as
// a pure, document-injected builder (the same "pure module in src/shared/" pattern
// vault-unlock-template.js uses) so the structure / aria contract is unit-testable
// against the fake-document helper without a live sheet. menu-overlay.js imports this,
// then wires behavior (client-side confirm-match check, submit → the dedicated
// `menu-overlay:vault-setup` secret Buffer channel, Tab-trap, Escape) onto the refs.
//
// The card mirrors the vault-unlock backdrop (centered, role="dialog" aria-modal="true")
// — but with a password field AND a confirm field, a client-side match check, and the
// secret leaving via a DEDICATED request/response channel (menuOverlay.setupVault),
// NEVER channel-4 activated (string-only / 24-char capped). Reuses the `.new-container-*`
// / `.text-btn` classes for visual parity.

/**
 * Build the vault-set card DOM.
 * @param {Document} document
 * @returns {{
 *   node: HTMLElement,
 *   card: HTMLElement,
 *   input: HTMLInputElement,
 *   confirm: HTMLInputElement,
 *   error: HTMLElement,
 *   submit: HTMLButtonElement,
 *   cancel: HTMLButtonElement,
 * }}
 */
export function buildVaultSetCard(document) {
  const node = document.createElement('div');
  node.id = 'sheet-vault-set';
  node.classList.add('hidden');

  const card = document.createElement('div');
  card.className = 'new-container-inner vault-set-inner';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'Set up the password manager');
  node.appendChild(card);

  const label = document.createElement('label');
  label.className = 'new-container-label';
  label.htmlFor = 'sheet-vault-set-password';
  label.textContent = 'Master password';

  const input = /** @type {HTMLInputElement} */ (document.createElement('input'));
  input.id = 'sheet-vault-set-password';
  input.className = 'new-container-input';
  input.type = 'password';
  input.autocomplete = 'new-password';
  input.spellcheck = false;

  const confirmLabel = document.createElement('label');
  confirmLabel.className = 'new-container-label';
  confirmLabel.htmlFor = 'sheet-vault-set-confirm';
  confirmLabel.textContent = 'Confirm master password';

  const confirm = /** @type {HTMLInputElement} */ (document.createElement('input'));
  confirm.id = 'sheet-vault-set-confirm';
  confirm.className = 'new-container-input';
  confirm.type = 'password';
  confirm.autocomplete = 'new-password';
  confirm.spellcheck = false;

  // aria-live error line — empty until an empty / mismatch / setup-failure re-prompt.
  // role="alert" deliberately NOT set (would double-announce with aria-live); polite
  // announces the inline error without stealing focus.
  const error = document.createElement('div');
  error.className = 'vault-set-error';
  error.setAttribute('aria-live', 'polite');
  error.textContent = '';

  const actions = document.createElement('div');
  actions.className = 'new-container-actions';
  const submit = /** @type {HTMLButtonElement} */ (document.createElement('button'));
  submit.className = 'text-btn small';
  submit.type = 'button';
  submit.textContent = 'Set up';
  const cancel = /** @type {HTMLButtonElement} */ (document.createElement('button'));
  cancel.className = 'text-btn small';
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  actions.appendChild(submit);
  actions.appendChild(cancel);

  card.appendChild(label);
  card.appendChild(input);
  card.appendChild(confirmLabel);
  card.appendChild(confirm);
  card.appendChild(error);
  card.appendChild(actions);

  return { node, card, input, confirm, error, submit, cancel };
}
