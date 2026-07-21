// @ts-check

// DOM builder for the menu-overlay sheet's `vault-stepup` template (M12 Flight 3 Leg 5
// access-keys, flight DD5 / mission durable-grant step-up) — the chrome-owned fresh
// master-password confirmation required to mint a per-vault access key EVEN WHILE
// UNLOCKED. Extracted as a pure, document-injected builder (the vault-set-template.js
// idiom) so the structure / aria contract is unit-testable against the fake-document
// helper without a live sheet. menu-overlay.js imports this, then wires behavior (submit →
// the dedicated `menu-overlay:vault-stepup-mint` secret Buffer channel carrying the
// non-secret target vault id, Tab-trap, Escape) onto the refs.
//
// The card mirrors the vault-set backdrop (centered, role="dialog" aria-modal="true") but
// with a SINGLE master-password field (a re-auth, not a new-password entry — there is no
// confirm). The secret leaves via a DEDICATED request/response channel as a Uint8Array,
// NEVER channel-4 activated (string-only / 24-char capped). Reuses the `.new-container-*` /
// `.text-btn` classes for visual parity with vault-set / vault-unlock.

/**
 * Build the vault-stepup card DOM.
 * @param {Document} document
 * @returns {{
 *   node: HTMLElement,
 *   card: HTMLElement,
 *   input: HTMLInputElement,
 *   error: HTMLElement,
 *   submit: HTMLButtonElement,
 *   cancel: HTMLButtonElement,
 * }}
 */
export function buildVaultStepupCard(document) {
  const node = document.createElement('div');
  node.id = 'sheet-vault-stepup';
  node.classList.add('hidden');

  const card = document.createElement('div');
  card.className = 'new-container-inner vault-stepup-inner';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'Confirm your master password');
  node.appendChild(card);

  const heading = document.createElement('div');
  heading.className = 'vault-stepup-heading';
  heading.textContent = 'Confirm your master password';
  card.appendChild(heading);

  const lede = document.createElement('p');
  lede.className = 'vault-stepup-lede';
  lede.textContent =
    'Minting an access key needs a fresh master-password confirmation, even while the manager is unlocked.';
  card.appendChild(lede);

  const label = document.createElement('label');
  label.className = 'new-container-label';
  label.htmlFor = 'sheet-vault-stepup-password';
  label.textContent = 'Master password';

  const input = /** @type {HTMLInputElement} */ (document.createElement('input'));
  input.id = 'sheet-vault-stepup-password';
  input.className = 'new-container-input';
  input.type = 'password';
  input.autocomplete = 'current-password';
  input.spellcheck = false;

  // aria-live error line — empty until an empty / wrong-password re-prompt. role="alert"
  // deliberately NOT set (would double-announce with aria-live); polite announces the
  // inline error without stealing focus. Same shape as vault-set's error line.
  const error = document.createElement('div');
  error.className = 'vault-stepup-error';
  error.setAttribute('aria-live', 'polite');
  error.textContent = '';

  const actions = document.createElement('div');
  actions.className = 'new-container-actions';
  const submit = /** @type {HTMLButtonElement} */ (document.createElement('button'));
  submit.className = 'text-btn small';
  submit.type = 'button';
  submit.textContent = 'Mint access key';
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

  return { node, card, input, error, submit, cancel };
}
