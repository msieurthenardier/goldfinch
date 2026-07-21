// @ts-check

// DOM builder for the menu-overlay sheet's `vault-recovery-show` template (M12 Flight 3
// Leg 4 first-run-setup, DD5) — the ONE-TIME, read-only display of the recovery key
// after a successful setup. Extracted as a pure, document-injected builder (the same
// "pure module in src/shared/" pattern vault-unlock-template.js uses) so the structure /
// aria contract is unit-testable against the fake-document helper without a live sheet.
// menu-overlay.js imports this, then wires behavior (render the key text, Copy, the
// explicit "I've saved it" acknowledge, drop-the-reference-on-close).
//
// SECURITY (leg core): displays the RECOVERY KEY ONLY. The `adminPrivateKeyB64` that
// setup() also returns is a machine-automation credential, DEFERRED to F4 — it is never
// surfaced here. The card OPTS OUT of the shared dismiss wiring (menu-overlay.js passes
// dismissible:false) — Escape / backdrop-click / window-blur must NOT close it; only the
// deliberate acknowledge closes (the one-time key is unrecoverable). The key text is
// rendered via textContent only (never markup) and dropped from the DOM on close.

/**
 * Build the vault-recovery-show card DOM. The key value node is a read-only element
 * (no input — nothing to submit); Copy + Acknowledge are the only controls.
 * @param {Document} document
 * @returns {{
 *   node: HTMLElement,
 *   card: HTMLElement,
 *   keyValue: HTMLElement,
 *   copy: HTMLButtonElement,
 *   acknowledge: HTMLButtonElement,
 * }}
 */
export function buildVaultRecoveryCard(document) {
  const node = document.createElement('div');
  node.id = 'sheet-vault-recovery';
  node.classList.add('hidden');

  const card = document.createElement('div');
  card.className = 'new-container-inner vault-recovery-inner';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'Save your recovery key');
  node.appendChild(card);

  const heading = document.createElement('div');
  heading.className = 'vault-recovery-heading';
  heading.textContent = 'Save your recovery key';
  card.appendChild(heading);

  const lede = document.createElement('p');
  lede.className = 'vault-recovery-lede';
  lede.textContent =
    'This is shown once. Write it down and keep it somewhere safe — it recovers your vault if you forget your master password. It cannot be shown again.';
  card.appendChild(lede);

  // Read-only key display. A non-editable element (not an input) — there is nothing to
  // submit; the key is displayed, copied, and acknowledged. aria-readonly + a role/label
  // so assistive tech announces it as the recovery key value.
  const keyValue = document.createElement('div');
  keyValue.className = 'vault-recovery-key';
  keyValue.id = 'sheet-vault-recovery-key';
  keyValue.setAttribute('role', 'textbox');
  keyValue.setAttribute('aria-readonly', 'true');
  keyValue.setAttribute('aria-label', 'Recovery key');
  keyValue.tabIndex = 0; // focusable so a keyboard user can reach + read it
  keyValue.textContent = '';
  card.appendChild(keyValue);

  const actions = document.createElement('div');
  actions.className = 'new-container-actions';
  const copy = /** @type {HTMLButtonElement} */ (document.createElement('button'));
  copy.className = 'text-btn small';
  copy.type = 'button';
  copy.textContent = 'Copy';
  const acknowledge = /** @type {HTMLButtonElement} */ (document.createElement('button'));
  acknowledge.className = 'text-btn small';
  acknowledge.type = 'button';
  acknowledge.textContent = "I've saved it";
  actions.appendChild(copy);
  actions.appendChild(acknowledge);
  card.appendChild(actions);

  return { node, card, keyValue, copy, acknowledge };
}
