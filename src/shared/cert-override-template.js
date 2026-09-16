// @ts-check

// DOM builder for the menu-overlay sheet's `cert-override` template (Mission 20
// Flight 2 Leg 3, flight DD3) — the flight's ONE security-decision channel: the
// card through which an operator grants a standing TLS-trust override for the
// active tab's failing certificate. Pure, document-injected builder (the
// vault-compromise-template.js / bookmark-edit-template.js idiom) — the
// structure/aria contract is unit-testable offline; menu-overlay.js imports
// this and wires behavior (the DEDICATED menu-overlay:cert-override-proceed
// invoke, Back = dismiss, attachModalCard's 2-way Tab-cycle).
//
// role="dialog" aria-modal="true" (the modal-card family), own aria-label (not
// MENU_LABELS — every dialog-style card sets its own). "Back to safety" is the
// initially-focused, VISUALLY PRIMARY action (DD3: Escape/backdrop/outside-
// click are equivalent to it); "Proceed to {host} (unsafe)" never auto-focuses
// and is visually SECONDARY — a plain .text-btn beside Back's .text-btn.primary,
// never colour alone (leg design review). Every string renders via textContent
// only: host/error are the entry's own recorded strings, title/body are
// app-authored copy from classifyCertError — none of it is ever markup.

/**
 * Build the cert-override card DOM.
 * @param {Document} document
 * @returns {{
 *   node: HTMLElement,
 *   card: HTMLElement,
 *   heading: HTMLElement,
 *   body: HTMLElement,
 *   errorLine: HTMLElement,
 *   status: HTMLElement,
 *   back: HTMLButtonElement,
 *   proceed: HTMLButtonElement,
 * }}
 */
export function buildCertOverrideCard(document) {
  const node = document.createElement('div');
  node.id = 'sheet-cert-override';
  node.classList.add('hidden');

  const card = document.createElement('div');
  card.className = 'new-container-inner cert-override-inner';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'Proceed despite a certificate error?');
  node.appendChild(card);

  const heading = document.createElement('div');
  heading.id = 'sheet-cert-override-heading';
  heading.className = 'cert-override-heading';
  card.appendChild(heading);

  const body = document.createElement('p');
  body.id = 'sheet-cert-override-body';
  body.className = 'cert-override-lede';
  card.appendChild(body);

  // The raw engine error name (e.g. "ERR_CERT_AUTHORITY_INVALID") — an
  // app-authored title/body never substitutes for it; the operator sees both.
  const errorLine = document.createElement('p');
  errorLine.id = 'sheet-cert-override-error';
  errorLine.className = 'cert-override-code';
  card.appendChild(errorLine);

  // aria-live status line — the vault-compromise/auth-basic idiom (polite;
  // empty until a failed proceed leaves the card open with feedback).
  const status = document.createElement('div');
  status.className = 'cert-override-status';
  status.setAttribute('aria-live', 'polite');
  status.textContent = '';
  card.appendChild(status);

  const actions = document.createElement('div');
  actions.className = 'new-container-actions';
  const back = /** @type {HTMLButtonElement} */ (document.createElement('button'));
  back.id = 'sheet-cert-override-back';
  back.className = 'text-btn primary vault-sheet-btn';
  back.type = 'button';
  back.textContent = 'Back to safety';
  const proceed = /** @type {HTMLButtonElement} */ (document.createElement('button'));
  proceed.id = 'sheet-cert-override-proceed';
  proceed.className = 'text-btn vault-sheet-btn';
  proceed.type = 'button';
  actions.appendChild(back);
  actions.appendChild(proceed);
  card.appendChild(actions);

  return { node, card, heading, body, errorLine, status, back, proceed };
}

/**
 * Pure: populate the card's heading/body/error line + the Proceed button's
 * host-naming label from the sheet model, and reset the status line for a
 * fresh open. Unknown/missing fields degrade to an empty string — never a
 * throw. @param {{heading: HTMLElement, body: HTMLElement, errorLine: HTMLElement, status: HTMLElement, proceed: HTMLButtonElement}} card
 * @param {any} model  `{ host, error, title, body }`
 */
export function applyCertOverrideModel(card, model) {
  const host = model && typeof model.host === 'string' ? model.host : '';
  card.heading.textContent = (model && typeof model.title === 'string' && model.title) || '';
  card.body.textContent = (model && typeof model.body === 'string' && model.body) || '';
  card.errorLine.textContent = (model && typeof model.error === 'string' && model.error) || '';
  card.status.textContent = '';
  card.proceed.textContent = `Proceed to ${host} (unsafe)`;
}
