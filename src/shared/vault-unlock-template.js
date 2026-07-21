// @ts-check

// DOM builder for the menu-overlay sheet's `vault-unlock` template (M12 Flight 2
// Leg 2 chrome-unlock, DD4). Extracted as a pure, document-injected builder — the
// SAME "pure module in src/shared/" pattern the codebase uses so the structure /
// aria contract is unit-testable against the fake-document helper without a live
// sheet. menu-overlay.js imports this, then wires behavior (submit → secret
// channel, Tab-trap, Escape) onto the returned node refs.
//
// The card mirrors the `input-dialog` (new-container) precedent — a centered
// backdrop + card, role="dialog" aria-modal="true" — but with a type="password"
// input and an aria-live error line, and the secret leaves via a DEDICATED
// request/response channel (menuOverlay.unlockVault), NEVER channel-4 activated
// (which sanitizeActivatedValue caps at 24 chars / string-only). Reuses the
// `.new-container-*` / `.text-btn` classes for visual parity; the `.vault-unlock-*`
// hooks carry the error-line + password-specific styling.

/**
 * Build the vault-unlock card DOM.
 * @param {Document} document
 * @returns {{
 *   node: HTMLElement,
 *   card: HTMLElement,
 *   input: HTMLInputElement,
 *   error: HTMLElement,
 *   unlock: HTMLButtonElement,
 *   cancel: HTMLButtonElement,
 * }}
 */
export function buildVaultUnlockCard(document) {
  const node = document.createElement('div');
  node.id = 'sheet-vault-unlock';
  node.classList.add('hidden');

  const card = document.createElement('div');
  card.className = 'new-container-inner vault-unlock-inner';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'Unlock password manager');
  node.appendChild(card);

  const label = document.createElement('label');
  label.className = 'new-container-label';
  label.htmlFor = 'sheet-vault-password';
  label.textContent = 'Master password';

  const input = /** @type {HTMLInputElement} */ (document.createElement('input'));
  input.id = 'sheet-vault-password';
  input.className = 'new-container-input';
  input.type = 'password';
  input.autocomplete = 'off';
  input.spellcheck = false;

  // aria-live error line — empty until a wrong password re-prompts. role="alert"
  // is deliberately NOT used (it would double-announce with aria-live); polite
  // announces the inline error without stealing focus from the input.
  const error = document.createElement('div');
  error.className = 'vault-unlock-error';
  error.setAttribute('aria-live', 'polite');
  error.textContent = '';

  const actions = document.createElement('div');
  actions.className = 'new-container-actions';
  const unlock = /** @type {HTMLButtonElement} */ (document.createElement('button'));
  unlock.className = 'text-btn small';
  unlock.type = 'button';
  unlock.textContent = 'Unlock';
  const cancel = /** @type {HTMLButtonElement} */ (document.createElement('button'));
  cancel.className = 'text-btn small';
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  actions.appendChild(unlock);
  actions.appendChild(cancel);

  card.appendChild(label);
  card.appendChild(input);
  card.appendChild(error);
  card.appendChild(actions);

  return { node, card, input, error, unlock, cancel };
}
