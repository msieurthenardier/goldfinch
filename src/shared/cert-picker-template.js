// @ts-check

// DOM builder + row renderer for the menu-overlay sheet's `cert-picker`
// template (M14 F1 L3, flight DD4) — the TLS client-certificate chooser.
// Modeled on vault-picker-template.js for its DOM/roving-list shape ONLY
// (centered backdrop + card + role="menu" roving list, index-carrying row ids,
// a separated cancel row): the ACTIVATION ROUTING deliberately deviates —
// selections resolve MAIN-SIDE in register-overlay-ipc.js (ledger-first
// against the pending-challenge store), not in the chrome dispatch. Pure,
// document-injected helpers so the structure / aria contract AND the id↔index
// mapping are unit-testable against the fake-document helper without a live
// sheet; menu-overlay.js imports these and wires behavior (roving via the
// shared menu-controller, selection → sendActivatedOnce).
//
// SECURITY: the model is DISPLAY STRINGS ONLY ({ subject, issuer } per row —
// built main-side from certificate metadata). No certificate object, key, or
// other secret is ever in the model, a row, or the reported selection (an
// index; main resolves it against its own held list).

import { buildVaultSheetHeader } from './vault-sheet-header.js';

// The selection id namespace. `id` (not `value`) carries the index — the
// `pick:<i>` / `sug:<i>` idiom (`value` is main-side capped at 24 chars by
// sanitizeActivatedValue; `id` is not). MIRRORED as a local literal in
// src/main/register-overlay-ipc.js (main-side parse — this file is ESM); the
// unit suite cross-pins the two literals.
export const CERT_PICK_PREFIX = 'cert:';

// The separated cancel row's id: an explicit "continue without a certificate".
// NOT a `cert:<i>` index — main's activated handler lets it fall through to the
// close's resolution-cancel (callback() — the handshake proceeds cert-less).
export const CERT_CANCEL_ID = 'cancel';

/**
 * The selection id for row `i`.
 * @param {number} i
 * @returns {string}
 */
export function certPickId(i) {
  return CERT_PICK_PREFIX + i;
}

/**
 * The row index encoded in a `cert:<i>` id, or null if `id` is not a valid pick
 * id (defensive: a tampered / foreign id maps to no row rather than
 * NaN-indexing — main then resolves cancel, never a throw).
 * @param {string} id
 * @returns {number | null}
 */
export function parseCertPickIndex(id) {
  if (typeof id !== 'string' || !id.startsWith(CERT_PICK_PREFIX)) return null;
  const rest = id.slice(CERT_PICK_PREFIX.length);
  // Digits only — a bare 'cert:' (Number('') === 0), a negative, or a
  // non-numeric suffix all map to no row rather than a bogus index.
  if (!/^\d+$/.test(rest)) return null;
  return Number(rest);
}

/**
 * Build the cert-picker card DOM: a centered backdrop node + a card with a
 * fixed HEADER (title + close/X button) over a scrollable role="menu" `list`
 * (the roving host). Rows render into `list` separately via
 * renderCertPickerRows. menu-overlay.js wires the returned `close` button
 * (a deliberate dismiss, same family as Escape).
 * @param {Document} document
 * @returns {{ node: HTMLElement, card: HTMLElement, subtitle: HTMLElement, list: HTMLElement, popupNote: HTMLElement, close: HTMLButtonElement }}
 */
export function buildCertPickerCard(document) {
  const node = document.createElement('div');
  node.id = 'sheet-cert-picker';
  node.classList.add('hidden');

  const card = document.createElement('div');
  card.className = 'new-container-inner vault-picker-inner cert-picker-inner';
  node.appendChild(card);

  const { header, close } = buildVaultSheetHeader(document, 'Select a certificate');
  card.appendChild(header);

  // Site-attribution subtitle (M14 F3 HAT fix): WHO is asking for a
  // certificate — the auth-basic origin-line parity ("The server <host>
  // says…"); without it the chooser is indistinguishable across sites (the
  // phishing-shaped gap class the displayHost fix closed for auth-basic).
  // Rendered per-init via renderCertPickerSubtitle (the host is a server-
  // derived display string — textContent only, never markup); hidden when the
  // model carries no host (the a11y audit hook's bare-array shape).
  const subtitle = document.createElement('div');
  subtitle.className = 'auth-basic-origin cert-picker-origin';
  subtitle.classList.add('hidden');
  subtitle.textContent = '';
  card.appendChild(subtitle);

  // Popup marker copy line (M14 F2 L2, flight DD5): shown only when the init
  // model carries `popup: true` — the challenge arrived from a script-opened
  // pop-up window. FIXED template copy; menu-overlay.js toggles `.hidden` per
  // model. NOT a new sheet — the DD5 budget line (auth-basic parity).
  const popupNote = document.createElement('div');
  popupNote.className = 'auth-basic-origin auth-popup-note';
  popupNote.classList.add('hidden');
  popupNote.textContent = 'This request comes from a pop-up window opened by this page.';
  card.appendChild(popupNote);

  // The roving list host carries the menu semantics (vault-picker shape: the
  // fixed header is not a menuitem and does not scroll away).
  const list = document.createElement('div');
  list.className = 'vault-picker-list cert-picker-list';
  list.setAttribute('role', 'menu');
  list.setAttribute('aria-label', 'Choose a certificate to present to this site');
  list.tabIndex = -1;
  card.appendChild(list);

  return { node, card, subtitle, list, popupNote, close };
}

/**
 * Render the site-attribution subtitle from the presented challenge's host
 * (derived main-side by auth-challenges' certChallengeHost from the bare
 * `host:port` Electron passes — carries a non-default port natively). A
 * missing/empty host hides the line entirely (the a11y audit hook's bare-array
 * model has no host) rather than rendering copy with a blank in it. The host
 * is a server-derived string: textContent only, never markup.
 * @param {HTMLElement} subtitle
 * @param {unknown} host
 * @returns {void}
 */
export function renderCertPickerSubtitle(subtitle, host) {
  const h = typeof host === 'string' ? host : '';
  subtitle.textContent = h ? `The site ${h} is asking you to identify yourself with a certificate.` : '';
  subtitle.classList.toggle('hidden', !h);
}

/**
 * Render the chooser rows into `list` from the display-string model, replacing
 * any prior content. Each row is a role="menuitem" button: the certificate
 * subject on top, the dimmed issuer beneath — both via textContent only
 * (metadata strings originate from server/OS-store certificates; never
 * markup). The row's index is stamped on `data-cert-index`.
 *
 * A separated Cancel row (divider + a distinct role="menuitem" button,
 * `data-cert-cancel`) is ALWAYS appended so keyboard users have an explicit
 * continue-without-a-certificate affordance (Escape remains equivalent). An
 * EMPTY model renders a single non-focusable note in place of rows —
 * defensive only: main never presents an empty candidate list (Electron
 * continues cert-less before emitting the event).
 *
 * Returns the focusable menuitems in roving order: the cert rows (if any)
 * followed by the Cancel row (the menu-controller's items getter).
 * @param {Document} document
 * @param {HTMLElement} list
 * @param {Array<{ subject?: string|null, issuer?: string|null }>} model
 * @returns {HTMLElement[]}
 */
export function renderCertPickerRows(document, list, model) {
  list.textContent = '';
  const rows = Array.isArray(model) ? model : [];

  /** @type {HTMLElement[]} */
  const buttons = [];

  if (!rows.length) {
    const note = document.createElement('div');
    note.className = 'cm-item vault-picker-note';
    note.setAttribute('aria-disabled', 'true');
    note.textContent = 'No certificates available';
    list.appendChild(note);
  }

  rows.forEach((item, i) => {
    const btn = document.createElement('button');
    btn.className = 'cm-item vault-picker-row cert-picker-row';
    btn.type = 'button';
    btn.setAttribute('role', 'menuitem');
    btn.tabIndex = -1;
    btn.dataset.certIndex = String(i);

    const text = document.createElement('span');
    text.className = 'vault-picker-text';

    const subject = document.createElement('span');
    subject.className = 'vault-picker-title cert-picker-subject';
    const subjectText = item && item.subject != null && item.subject !== '' ? item.subject : 'Certificate';
    subject.textContent = String(subjectText);
    text.appendChild(subject);

    const issuer = document.createElement('span');
    issuer.className = 'vault-picker-username cert-picker-issuer';
    issuer.textContent = String(item && item.issuer != null ? item.issuer : '');
    text.appendChild(issuer);

    btn.appendChild(text);
    list.appendChild(btn);
    buttons.push(btn);
  });

  const separator = document.createElement('div');
  separator.className = 'vault-picker-separator';
  separator.setAttribute('role', 'separator');
  list.appendChild(separator);

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'cm-item vault-picker-manage cert-picker-cancel';
  cancelBtn.type = 'button';
  cancelBtn.setAttribute('role', 'menuitem');
  cancelBtn.tabIndex = -1;
  cancelBtn.dataset.certCancel = 'true';
  const cancelLabel = document.createElement('span');
  cancelLabel.className = 'vault-picker-manage-label';
  cancelLabel.textContent = 'Continue without a certificate';
  cancelBtn.appendChild(cancelLabel);
  list.appendChild(cancelBtn);
  buttons.push(cancelBtn);

  return buttons;
}
