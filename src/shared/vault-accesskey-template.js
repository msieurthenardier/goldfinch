// @ts-check

import { buildCopyIcon } from './copy-icon.js';

// DOM builder for the menu-overlay sheet's `vault-accesskey-show` template (M12 Flight 3
// Leg 5 access-keys, flight DD5 / mission durable-grant step-up) — the ONE-TIME, read-only
// display of a freshly-minted access key. Extracted as a pure, document-injected builder
// (the vault-recovery-template.js idiom) so the structure / aria contract is unit-testable
// against the fake-document helper without a live sheet. menu-overlay.js imports this, then
// wires behavior (render the secret + keyId, Copy, the explicit acknowledge, drop-the-
// reference-on-close).
//
// SECURITY (leg core): the access secret is shown ONCE. The card OPTS OUT of the shared
// dismiss wiring (menu-overlay.js passes dismissible:false, parallel to vault-recovery-show)
// — Escape / backdrop-click / window-blur must NOT close it; only the deliberate
// acknowledge closes (the secret is unrecoverable once dismissed). The secret + keyId are
// rendered via textContent only (never markup) and dropped from the DOM on close. The Copy
// button copies the SECRET (main owns the OS clipboard write). The keyId is a plaintext
// envelope fingerprint (not a secret) shown for reference so the operator can later revoke.

/**
 * Build the vault-accesskey-show card DOM. The secret + keyId are read-only display
 * elements (no input — nothing to submit); Copy + Acknowledge are the only controls. The
 * acknowledge button is the LAST child of `.new-container-actions` (the a11y-audit's
 * dismiss-locked branch clicks `.new-container-actions button:last-child`).
 * @param {Document} document
 * @returns {{
 *   node: HTMLElement,
 *   card: HTMLElement,
 *   keyIdValue: HTMLElement,
 *   secretValue: HTMLElement,
 *   copy: HTMLButtonElement,
 *   acknowledge: HTMLButtonElement,
 * }}
 */
export function buildVaultAccessKeyCard(document) {
  const node = document.createElement('div');
  node.id = 'sheet-vault-accesskey';
  node.classList.add('hidden');

  const card = document.createElement('div');
  card.className = 'new-container-inner vault-accesskey-inner';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'Copy your access key');
  node.appendChild(card);

  const heading = document.createElement('div');
  heading.className = 'vault-accesskey-heading';
  heading.textContent = 'Copy your access key';
  card.appendChild(heading);

  const lede = document.createElement('p');
  lede.className = 'vault-accesskey-lede';
  lede.textContent =
    'This access key is shown once. Copy it now and store it somewhere safe — it cannot be shown again. You can revoke it later by its key ID.';
  card.appendChild(lede);

  // Key ID display (NOT a secret — the plaintext envelope fingerprint used to revoke).
  const keyIdLabel = document.createElement('div');
  keyIdLabel.className = 'vault-accesskey-fieldlabel';
  keyIdLabel.textContent = 'Key ID';
  card.appendChild(keyIdLabel);

  const keyIdValue = document.createElement('div');
  keyIdValue.className = 'vault-accesskey-keyid';
  keyIdValue.id = 'sheet-vault-accesskey-keyid';
  keyIdValue.setAttribute('role', 'textbox');
  keyIdValue.setAttribute('aria-readonly', 'true');
  keyIdValue.setAttribute('aria-label', 'Access key ID');
  keyIdValue.tabIndex = 0;
  keyIdValue.textContent = '';
  card.appendChild(keyIdValue);

  const secretLabel = document.createElement('div');
  secretLabel.className = 'vault-accesskey-fieldlabel';
  secretLabel.textContent = 'Access key';
  card.appendChild(secretLabel);

  // Read-only secret display. A non-editable element (not an input) — there is nothing to
  // submit; the secret is displayed, copied, and acknowledged. aria-readonly + a role/label
  // so assistive tech announces it as the access-key value.
  const secretValue = document.createElement('div');
  secretValue.className = 'vault-accesskey-secret';
  secretValue.id = 'sheet-vault-accesskey-secret';
  secretValue.setAttribute('role', 'textbox');
  secretValue.setAttribute('aria-readonly', 'true');
  secretValue.setAttribute('aria-label', 'Access key');
  secretValue.tabIndex = 0;
  secretValue.textContent = '';
  card.appendChild(secretValue);

  const actions = document.createElement('div');
  actions.className = 'new-container-actions';
  // Copy = gold PRIMARY button with a leading copy glyph (I2–I4). The label stays
  // textContent-only; the icon is prepended via the safe createElementNS builder (never
  // innerHTML). Set the label BEFORE inserting the icon so the icon survives (a
  // textContent write replaces child nodes).
  const copy = /** @type {HTMLButtonElement} */ (document.createElement('button'));
  copy.className = 'text-btn primary vault-sheet-btn vault-copy-btn';
  copy.type = 'button';
  copy.textContent = 'Copy';
  copy.insertBefore(buildCopyIcon(document), copy.firstChild);
  const acknowledge = /** @type {HTMLButtonElement} */ (document.createElement('button'));
  acknowledge.className = 'text-btn vault-sheet-btn';
  acknowledge.type = 'button';
  acknowledge.textContent = "I've saved it";
  actions.appendChild(copy);
  actions.appendChild(acknowledge);
  card.appendChild(actions);

  return { node, card, keyIdValue, secretValue, copy, acknowledge };
}
