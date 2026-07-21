// @ts-check

// DOM builder for the menu-overlay sheet's `vault-recover` template (M12 Flight 4 Leg 2
// key-rotation, DD3/DD2) — the chrome-owned RECOVER-after-forgotten-master entry: a
// RECOVERY-KEY field (the step-up — the recovery key is master-equivalent proof), a
// NEW-password field, and a CONFIRM field. Extracted as a pure, document-injected builder
// (the vault-set-template.js idiom) so the structure / aria contract is unit-testable
// against the fake-document helper without a live sheet. menu-overlay.js imports this, then
// wires behavior (client-side confirm-match check, submit → the dedicated
// `menu-overlay:vault-recover` Buffer channel carrying the recovery + new secrets, Tab-trap,
// Escape) onto the refs.
//
// The card mirrors the vault-set backdrop (centered, role="dialog" aria-modal="true") but
// carries THREE fields. Only the RECOVERY + NEW secrets cross the DEDICATED Buffer channel as
// Uint8Arrays (dual-zeroized) — the confirm check is RENDERER-side; NEITHER secret rides
// channel-4 activated (string-only / 24-char capped). Reuses the `.new-container-*` /
// `.text-btn` classes for visual parity with the other vault sheets.

/**
 * Build the vault-recover card DOM.
 * @param {Document} document
 * @returns {{
 *   node: HTMLElement,
 *   card: HTMLElement,
 *   recoveryInput: HTMLInputElement,
 *   newInput: HTMLInputElement,
 *   confirm: HTMLInputElement,
 *   error: HTMLElement,
 *   submit: HTMLButtonElement,
 *   cancel: HTMLButtonElement,
 * }}
 */
export function buildVaultRecoverCard(document) {
  const node = document.createElement('div');
  node.id = 'sheet-vault-recover';
  node.classList.add('hidden');

  const card = document.createElement('div');
  card.className = 'new-container-inner vault-recover-inner';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'Recover with your recovery key');
  node.appendChild(card);

  const heading = document.createElement('div');
  heading.className = 'vault-recover-heading';
  heading.textContent = 'Recover with your recovery key';
  card.appendChild(heading);

  const lede = document.createElement('p');
  lede.className = 'vault-recover-lede';
  lede.textContent =
    'Enter your recovery key to unlock the manager, then set a new master password. The recovery key stays valid.';
  card.appendChild(lede);

  const recoveryLabel = document.createElement('label');
  recoveryLabel.className = 'new-container-label';
  recoveryLabel.htmlFor = 'sheet-vault-recover-key';
  recoveryLabel.textContent = 'Recovery key';

  const recoveryInput = /** @type {HTMLInputElement} */ (document.createElement('input'));
  recoveryInput.id = 'sheet-vault-recover-key';
  recoveryInput.className = 'new-container-input';
  recoveryInput.type = 'password';
  recoveryInput.autocomplete = 'off';
  recoveryInput.spellcheck = false;

  const newLabel = document.createElement('label');
  newLabel.className = 'new-container-label';
  newLabel.htmlFor = 'sheet-vault-recover-new';
  newLabel.textContent = 'New master password';

  const newInput = /** @type {HTMLInputElement} */ (document.createElement('input'));
  newInput.id = 'sheet-vault-recover-new';
  newInput.className = 'new-container-input';
  newInput.type = 'password';
  newInput.autocomplete = 'new-password';
  newInput.spellcheck = false;

  const confirmLabel = document.createElement('label');
  confirmLabel.className = 'new-container-label';
  confirmLabel.htmlFor = 'sheet-vault-recover-confirm';
  confirmLabel.textContent = 'Confirm new master password';

  const confirm = /** @type {HTMLInputElement} */ (document.createElement('input'));
  confirm.id = 'sheet-vault-recover-confirm';
  confirm.className = 'new-container-input';
  confirm.type = 'password';
  confirm.autocomplete = 'new-password';
  confirm.spellcheck = false;

  // aria-live error line — empty until an empty / mismatch / wrong-recovery-key re-prompt.
  // role="alert" deliberately NOT set (would double-announce with aria-live); polite
  // announces the inline error without stealing focus.
  const error = document.createElement('div');
  error.className = 'vault-recover-error';
  error.setAttribute('aria-live', 'polite');
  error.textContent = '';

  const actions = document.createElement('div');
  actions.className = 'new-container-actions';
  const submit = /** @type {HTMLButtonElement} */ (document.createElement('button'));
  submit.className = 'text-btn small';
  submit.type = 'button';
  submit.textContent = 'Recover';
  const cancel = /** @type {HTMLButtonElement} */ (document.createElement('button'));
  cancel.className = 'text-btn small';
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  actions.appendChild(submit);
  actions.appendChild(cancel);

  card.appendChild(recoveryLabel);
  card.appendChild(recoveryInput);
  card.appendChild(newLabel);
  card.appendChild(newInput);
  card.appendChild(confirmLabel);
  card.appendChild(confirm);
  card.appendChild(error);
  card.appendChild(actions);

  return { node, card, recoveryInput, newInput, confirm, error, submit, cancel };
}
