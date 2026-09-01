// @ts-check

// DOM builders for the menu-overlay sheet's two compromise-mode templates (M18 F2 L4,
// flight DD4) — the chrome-owned credential entry for the whole-hierarchy re-key:
//
//   `vault-compromise`          — the MASTER branch: current password (the step-up) +
//                                 new password + confirm (the vault-change-master
//                                 template shape, compromise lede/labels; submit
//                                 "Rotate everything"), plus the switch affordance
//                                 "Use your recovery key instead" that reopens the
//                                 recover variant (close-then-reopen via channel-4 —
//                                 design-review M1; never a model replace).
//   `vault-compromise-recover`  — the RECOVERY branch: recovery key (the step-up) +
//                                 new password + confirm (the vault-recover shape,
//                                 compromise lede).
//
// Both are pure, document-injected builders (the vault-set-template.js idiom).
// menu-overlay.js imports them, then wires behavior (client-side confirm-match check,
// submit → the dedicated `menu-overlay:vault-compromise[-recover]` Buffer channels,
// the PENDING state for the op's 2–3-scrypt latency, Tab-trap, Escape) onto the refs.
//
// Both cards carry a `pending` aria-live note node (empty until the submit is in
// flight) — the op's interactive-latency await needs a visible "working" state with
// the fields + submit disabled while Cancel/Escape stay live (leg L1/L2: a dismissal
// mid-op is safe; the reveal arrives via the main-side pending-reveal mechanism).
// Only the OLD/RECOVERY + NEW secrets cross the DEDICATED Buffer channels as
// Uint8Arrays (dual-zeroized); NEITHER rides channel-4 activated. Reuses the
// `.new-container-*` / `.text-btn` classes for visual parity with the other sheets.

const COMPROMISE_LEDE_MASTER =
  'Enter your current master password and choose a new one. Everything you’ve saved is kept and re-encrypted under fresh keys — your old keys stop working.';
const COMPROMISE_LEDE_RECOVER =
  'Enter your recovery key and choose a new master password. Everything you’ve saved is kept and re-encrypted under fresh keys — your old keys stop working.';

/**
 * Build the vault-compromise (master branch) card DOM.
 * @param {Document} document
 * @returns {{
 *   node: HTMLElement,
 *   card: HTMLElement,
 *   oldInput: HTMLInputElement,
 *   newInput: HTMLInputElement,
 *   confirm: HTMLInputElement,
 *   error: HTMLElement,
 *   pending: HTMLElement,
 *   switchLink: HTMLButtonElement,
 *   submit: HTMLButtonElement,
 *   cancel: HTMLButtonElement,
 * }}
 */
export function buildVaultCompromiseCard(document) {
  const node = document.createElement('div');
  node.id = 'sheet-vault-compromise';
  node.classList.add('hidden');

  const card = document.createElement('div');
  card.className = 'new-container-inner vault-compromise-inner';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'Rotate everything');
  node.appendChild(card);

  const heading = document.createElement('div');
  heading.className = 'vault-compromise-heading';
  heading.textContent = 'Rotate everything';
  card.appendChild(heading);

  const lede = document.createElement('p');
  lede.className = 'vault-compromise-lede';
  lede.textContent = COMPROMISE_LEDE_MASTER;
  card.appendChild(lede);

  const oldLabel = document.createElement('label');
  oldLabel.className = 'new-container-label';
  oldLabel.htmlFor = 'sheet-vault-compromise-old';
  oldLabel.textContent = 'Current master password';

  const oldInput = /** @type {HTMLInputElement} */ (document.createElement('input'));
  oldInput.id = 'sheet-vault-compromise-old';
  oldInput.className = 'new-container-input';
  oldInput.type = 'password';
  oldInput.autocomplete = 'current-password';
  oldInput.spellcheck = false;

  const newLabel = document.createElement('label');
  newLabel.className = 'new-container-label';
  newLabel.htmlFor = 'sheet-vault-compromise-new';
  newLabel.textContent = 'New master password';

  const newInput = /** @type {HTMLInputElement} */ (document.createElement('input'));
  newInput.id = 'sheet-vault-compromise-new';
  newInput.className = 'new-container-input';
  newInput.type = 'password';
  newInput.autocomplete = 'new-password';
  newInput.spellcheck = false;

  const confirmLabel = document.createElement('label');
  confirmLabel.className = 'new-container-label';
  confirmLabel.htmlFor = 'sheet-vault-compromise-confirm';
  confirmLabel.textContent = 'Confirm new master password';

  const confirm = /** @type {HTMLInputElement} */ (document.createElement('input'));
  confirm.id = 'sheet-vault-compromise-confirm';
  confirm.className = 'new-container-input';
  confirm.type = 'password';
  confirm.autocomplete = 'new-password';
  confirm.spellcheck = false;

  // The recovery-branch switch (design-review M1): a link-styled button that reopens
  // this sheet as vault-compromise-recover via channel-4 (close-then-reopen — the
  // switch itself never carries a secret). Mirrors the vault page's link-button idiom.
  const switchLink = /** @type {HTMLButtonElement} */ (document.createElement('button'));
  switchLink.className = 'text-btn vault-compromise-switch';
  switchLink.type = 'button';
  switchLink.textContent = 'Use your recovery key instead';

  // aria-live error line — empty until an empty / mismatch / mapped-reason re-prompt.
  const error = document.createElement('div');
  error.className = 'vault-compromise-error';
  error.setAttribute('aria-live', 'polite');
  error.textContent = '';

  // aria-live PENDING note — empty until a submit is in flight (the op's 2–3-scrypt
  // + per-vault AES latency). polite: announces without stealing focus.
  const pending = document.createElement('div');
  pending.className = 'vault-compromise-pending';
  pending.setAttribute('aria-live', 'polite');
  pending.textContent = '';

  const actions = document.createElement('div');
  actions.className = 'new-container-actions';
  const submit = /** @type {HTMLButtonElement} */ (document.createElement('button'));
  submit.className = 'text-btn primary danger vault-sheet-btn';
  submit.type = 'button';
  submit.textContent = 'Rotate everything';
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
  card.appendChild(switchLink);
  card.appendChild(error);
  card.appendChild(pending);
  card.appendChild(actions);

  return { node, card, oldInput, newInput, confirm, error, pending, switchLink, submit, cancel };
}

/**
 * Build the vault-compromise-recover (recovery branch) card DOM.
 * @param {Document} document
 * @returns {{
 *   node: HTMLElement,
 *   card: HTMLElement,
 *   recoveryInput: HTMLInputElement,
 *   newInput: HTMLInputElement,
 *   confirm: HTMLInputElement,
 *   error: HTMLElement,
 *   pending: HTMLElement,
 *   submit: HTMLButtonElement,
 *   cancel: HTMLButtonElement,
 * }}
 */
export function buildVaultCompromiseRecoverCard(document) {
  const node = document.createElement('div');
  node.id = 'sheet-vault-compromise-recover';
  node.classList.add('hidden');

  const card = document.createElement('div');
  card.className = 'new-container-inner vault-compromise-inner';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'Rotate everything with your recovery key');
  node.appendChild(card);

  const heading = document.createElement('div');
  heading.className = 'vault-compromise-heading';
  heading.textContent = 'Rotate everything';
  card.appendChild(heading);

  const lede = document.createElement('p');
  lede.className = 'vault-compromise-lede';
  lede.textContent = COMPROMISE_LEDE_RECOVER;
  card.appendChild(lede);

  const recoveryLabel = document.createElement('label');
  recoveryLabel.className = 'new-container-label';
  recoveryLabel.htmlFor = 'sheet-vault-compromise-recover-key';
  recoveryLabel.textContent = 'Recovery key';

  const recoveryInput = /** @type {HTMLInputElement} */ (document.createElement('input'));
  recoveryInput.id = 'sheet-vault-compromise-recover-key';
  recoveryInput.className = 'new-container-input';
  recoveryInput.type = 'password';
  recoveryInput.autocomplete = 'off';
  recoveryInput.spellcheck = false;

  const newLabel = document.createElement('label');
  newLabel.className = 'new-container-label';
  newLabel.htmlFor = 'sheet-vault-compromise-recover-new';
  newLabel.textContent = 'New master password';

  const newInput = /** @type {HTMLInputElement} */ (document.createElement('input'));
  newInput.id = 'sheet-vault-compromise-recover-new';
  newInput.className = 'new-container-input';
  newInput.type = 'password';
  newInput.autocomplete = 'new-password';
  newInput.spellcheck = false;

  const confirmLabel = document.createElement('label');
  confirmLabel.className = 'new-container-label';
  confirmLabel.htmlFor = 'sheet-vault-compromise-recover-confirm';
  confirmLabel.textContent = 'Confirm new master password';

  const confirm = /** @type {HTMLInputElement} */ (document.createElement('input'));
  confirm.id = 'sheet-vault-compromise-recover-confirm';
  confirm.className = 'new-container-input';
  confirm.type = 'password';
  confirm.autocomplete = 'new-password';
  confirm.spellcheck = false;

  const error = document.createElement('div');
  error.className = 'vault-compromise-error';
  error.setAttribute('aria-live', 'polite');
  error.textContent = '';

  const pending = document.createElement('div');
  pending.className = 'vault-compromise-pending';
  pending.setAttribute('aria-live', 'polite');
  pending.textContent = '';

  const actions = document.createElement('div');
  actions.className = 'new-container-actions';
  const submit = /** @type {HTMLButtonElement} */ (document.createElement('button'));
  submit.className = 'text-btn primary danger vault-sheet-btn';
  submit.type = 'button';
  submit.textContent = 'Rotate everything';
  const cancel = /** @type {HTMLButtonElement} */ (document.createElement('button'));
  cancel.className = 'text-btn vault-sheet-btn';
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
  card.appendChild(pending);
  card.appendChild(actions);

  return { node, card, recoveryInput, newInput, confirm, error, pending, submit, cancel };
}
