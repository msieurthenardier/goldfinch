// @ts-check

// DOM builder for the menu-overlay sheet's `auth-basic` template (M14 F1 L2,
// flight DD2) — the HTTP basic-auth credential prompt. Same pure,
// document-injected builder pattern as buildVaultUnlockCard: the structure /
// aria contract is unit-testable against the fake-document helper without a
// live sheet; menu-overlay.js imports this and wires behavior (submit → the
// DEDICATED menu-overlay:auth-submit Buffer channel, Cancel → channel-4
// `activated` with the non-secret id 'cancel') onto the returned node refs.
//
// The card is modal-card family (centered backdrop + card, role="dialog"
// aria-modal="true") with a host+realm context line, a username input, a
// type="password" input, and Sign in / Cancel. The password NEVER rides
// channel-4 `activated` (string-only, 24-char capped) — it leaves only via the
// dual-zeroized invoke. Host/realm are SERVER-controlled strings: rendered via
// textContent only, never markup.

import { buildVaultSheetHeader } from './vault-sheet-header.js';

/**
 * Build the auth-basic card DOM.
 * @param {Document} document
 * @returns {{
 *   node: HTMLElement,
 *   card: HTMLElement,
 *   origin: HTMLElement,
 *   popupNote: HTMLElement,
 *   username: HTMLInputElement,
 *   password: HTMLInputElement,
 *   error: HTMLElement,
 *   submit: HTMLButtonElement,
 *   cancel: HTMLButtonElement,
 *   close: HTMLButtonElement,
 * }}
 */
export function buildAuthBasicCard(document) {
  const node = document.createElement('div');
  node.id = 'sheet-auth-basic';
  node.classList.add('hidden');

  const card = document.createElement('div');
  card.className = 'new-container-inner vault-unlock-inner auth-basic-inner';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'Sign in');
  node.appendChild(card);

  // Shared header (title + close/X) — the vault-sheet chrome. menu-overlay.js
  // wires `close` (a deliberate dismiss, alongside Cancel/Escape).
  const { header, close } = buildVaultSheetHeader(document, 'Sign in');
  card.appendChild(header);

  // Host + realm context line — which server is asking, and its stated realm.
  // Set per-init via textContent (server-controlled strings — never markup).
  const origin = document.createElement('div');
  origin.className = 'auth-basic-origin';
  origin.textContent = '';

  // Popup marker copy line (M14 F2 L2, flight DD5): shown only when the init
  // model carries `popup: true` — the challenge arrived from a script-opened
  // pop-up window, not the visible tab. FIXED template copy (no server string
  // rides it); menu-overlay.js toggles `.hidden` per model. NOT a new sheet —
  // the DD5 budget line.
  const popupNote = document.createElement('div');
  popupNote.className = 'auth-basic-origin auth-popup-note';
  popupNote.classList.add('hidden');
  popupNote.textContent = 'This request comes from a pop-up window opened by this page.';

  const userLabel = document.createElement('label');
  userLabel.className = 'new-container-label';
  userLabel.htmlFor = 'sheet-auth-username';
  userLabel.textContent = 'Username';

  const username = /** @type {HTMLInputElement} */ (document.createElement('input'));
  username.id = 'sheet-auth-username';
  username.className = 'new-container-input';
  username.type = 'text';
  username.autocomplete = 'off';
  username.spellcheck = false;

  const passLabel = document.createElement('label');
  passLabel.className = 'new-container-label';
  passLabel.htmlFor = 'sheet-auth-password';
  passLabel.textContent = 'Password';

  const password = /** @type {HTMLInputElement} */ (document.createElement('input'));
  password.id = 'sheet-auth-password';
  password.className = 'new-container-input';
  password.type = 'password';
  password.autocomplete = 'off';
  password.spellcheck = false;

  // aria-live error line — the vault-unlock idiom (polite, not role="alert" —
  // alert would double-announce; polite announces without stealing focus).
  const error = document.createElement('div');
  error.className = 'vault-unlock-error';
  error.setAttribute('aria-live', 'polite');
  error.textContent = '';

  const actions = document.createElement('div');
  actions.className = 'new-container-actions';
  const submit = /** @type {HTMLButtonElement} */ (document.createElement('button'));
  submit.className = 'text-btn primary vault-sheet-btn';
  submit.type = 'button';
  submit.textContent = 'Sign in';
  const cancel = /** @type {HTMLButtonElement} */ (document.createElement('button'));
  cancel.className = 'text-btn vault-sheet-btn';
  cancel.type = 'button';
  cancel.textContent = 'Cancel';
  actions.appendChild(submit);
  actions.appendChild(cancel);

  const body = document.createElement('div');
  body.className = 'vault-sheet-body';
  body.appendChild(origin);
  body.appendChild(popupNote);
  body.appendChild(userLabel);
  body.appendChild(username);
  body.appendChild(passLabel);
  body.appendChild(password);
  body.appendChild(error);
  body.appendChild(actions);
  card.appendChild(body);

  return { node, card, origin, popupNote, username, password, error, submit, cancel, close };
}
