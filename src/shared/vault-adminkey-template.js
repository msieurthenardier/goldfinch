// @ts-check

import { buildCopyIcon } from './copy-icon.js';

// DOM builder for the menu-overlay sheet's `vault-adminkey-show` template (M12 Flight 4
// Leg 3 admin-key-provision, flight DD4 / mission durable-grant step-up) — the ONE-TIME,
// read-only display of a freshly-minted admin PRIVATE key. Extracted as a pure, document-
// injected builder (the vault-accesskey-template.js idiom) so the structure / aria contract
// is unit-testable against the fake-document helper without a live sheet. menu-overlay.js
// imports this, then wires behavior (render the private key, Copy, the explicit acknowledge,
// drop-the-reference-on-close).
//
// SECURITY (leg core): the admin private key is shown ONCE. The card OPTS OUT of the shared
// dismiss wiring (menu-overlay.js passes dismissible:false, parallel to vault-accesskey-show)
// — Escape / backdrop-click / window-blur must NOT close it; only the deliberate acknowledge
// closes (the private key is unrecoverable once dismissed — the seal is already rotated to its
// public half). The key is rendered via textContent only (never markup) and dropped from the
// DOM on close. The Copy button copies the key (main owns the OS clipboard write).

/**
 * Build the vault-adminkey-show card DOM. The admin private key is a read-only display
 * element (no input — nothing to submit); Copy + Acknowledge are the only controls. The
 * acknowledge button is the LAST child of `.new-container-actions` (the a11y-audit's
 * dismiss-locked branch clicks `.new-container-actions button:last-child`).
 * @param {Document} document
 * @returns {{
 *   node: HTMLElement,
 *   card: HTMLElement,
 *   keyValue: HTMLElement,
 *   copy: HTMLButtonElement,
 *   acknowledge: HTMLButtonElement,
 * }}
 */
export function buildVaultAdminKeyCard(document) {
  const node = document.createElement('div');
  node.id = 'sheet-vault-adminkey';
  node.classList.add('hidden');

  const card = document.createElement('div');
  card.className = 'new-container-inner vault-adminkey-inner';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'Copy your admin key');
  node.appendChild(card);

  const heading = document.createElement('div');
  heading.className = 'vault-adminkey-heading';
  heading.textContent = 'Copy your admin key';
  card.appendChild(heading);

  const lede = document.createElement('p');
  lede.className = 'vault-adminkey-lede';
  lede.textContent =
    'This admin key is shown once. Copy it now and store it somewhere safe — it cannot be shown again. It unlocks every vault for automation; any previous admin key no longer works.';
  card.appendChild(lede);

  const keyLabel = document.createElement('div');
  keyLabel.className = 'vault-adminkey-fieldlabel';
  keyLabel.textContent = 'Admin key';
  card.appendChild(keyLabel);

  // Read-only key display. A non-editable element (not an input) — there is nothing to
  // submit; the key is displayed, copied, and acknowledged. aria-readonly + a role/label
  // so assistive tech announces it as the admin-key value.
  const keyValue = document.createElement('div');
  keyValue.className = 'vault-adminkey-secret';
  keyValue.id = 'sheet-vault-adminkey-secret';
  keyValue.setAttribute('role', 'textbox');
  keyValue.setAttribute('aria-readonly', 'true');
  keyValue.setAttribute('aria-label', 'Admin key');
  keyValue.tabIndex = 0;
  keyValue.textContent = '';
  card.appendChild(keyValue);

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

  return { node, card, keyValue, copy, acknowledge };
}
