// @ts-check

// DOM builder for the menu-overlay sheet's `bookmark-edit` template (M15 F1 Leg 2,
// flight DD4) — the star/bar/overflow quick-edit popover (name, URL, Remove/Done).
// Same pure, document-injected builder pattern as buildAuthBasicCard: the
// structure/aria contract is unit-testable against the fake-document helper
// without a live sheet; menu-overlay.js imports this and wires behavior (submit
// → the DEDICATED menu-overlay:bookmark-edit-submit invoke, close-only-on-success
// — never channel-4 sendActivated).
//
// The card is modal-card family (role="dialog" aria-modal="true", a 4-way
// Tab-cycle name → url → Remove → Done via attachModalCard) but — UNLIKE every
// sibling dialog-style card — it is the FIRST-EVER anchored one (leg design
// review): the card itself takes `position: absolute` (menu-overlay.css) so
// positionNode's inline left/top take effect for the anchored-at-the-star
// placement; the backdrop keeps its flex-centering rules as a no-anchor
// fallback (an absolutely-positioned child simply leaves the flex flow). The
// card sets its own aria-label (dialog family — not MENU_LABELS). Name/URL are
// user-controlled strings carried as plain input values, never markup.

/**
 * Build the bookmark-edit card DOM.
 * @param {Document} document
 * @returns {{
 *   node: HTMLElement,
 *   card: HTMLElement,
 *   name: HTMLInputElement,
 *   url: HTMLInputElement,
 *   error: HTMLElement,
 *   remove: HTMLButtonElement,
 *   done: HTMLButtonElement,
 * }}
 */
export function buildBookmarkEditCard(document) {
  const node = document.createElement('div');
  node.id = 'sheet-bookmark-edit';
  node.classList.add('hidden');

  const card = document.createElement('div');
  card.className = 'new-container-inner bookmark-edit-inner';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'Edit bookmark');
  node.appendChild(card);

  const nameLabel = document.createElement('label');
  nameLabel.className = 'new-container-label';
  nameLabel.htmlFor = 'sheet-bookmark-name';
  nameLabel.textContent = 'Name';
  const name = /** @type {HTMLInputElement} */ (document.createElement('input'));
  name.id = 'sheet-bookmark-name';
  name.className = 'new-container-input';
  name.type = 'text';
  name.autocomplete = 'off';
  name.spellcheck = false;

  const urlLabel = document.createElement('label');
  urlLabel.className = 'new-container-label';
  urlLabel.htmlFor = 'sheet-bookmark-url';
  urlLabel.textContent = 'URL';
  const url = /** @type {HTMLInputElement} */ (document.createElement('input'));
  url.id = 'sheet-bookmark-url';
  url.className = 'new-container-input';
  url.type = 'text';
  url.autocomplete = 'off';
  url.spellcheck = false;

  // aria-live error line — the auth-basic/vault-unlock idiom (polite, not
  // role="alert" — alert would double-announce).
  const error = document.createElement('div');
  error.className = 'vault-unlock-error';
  error.setAttribute('aria-live', 'polite');
  error.textContent = '';

  const actions = document.createElement('div');
  actions.className = 'new-container-actions';
  const remove = /** @type {HTMLButtonElement} */ (document.createElement('button'));
  remove.className = 'text-btn vault-sheet-btn';
  remove.type = 'button';
  remove.textContent = 'Remove';
  const done = /** @type {HTMLButtonElement} */ (document.createElement('button'));
  done.className = 'text-btn primary vault-sheet-btn';
  done.type = 'button';
  done.textContent = 'Done';
  actions.appendChild(remove);
  actions.appendChild(done);

  const body = document.createElement('div');
  body.className = 'vault-sheet-body';
  body.appendChild(nameLabel);
  body.appendChild(name);
  body.appendChild(urlLabel);
  body.appendChild(url);
  body.appendChild(error);
  body.appendChild(actions);
  card.appendChild(body);

  return { node, card, name, url, error, remove, done };
}

/**
 * Pure: populate the card's name/url fields + reset the error line from the
 * sheet model ({ id, name, url }) — the ONE place that reads model.name /
 * model.url (menu-overlay.js's renderBookmarkEdit calls this; pinned here so
 * a future model-shape drift, e.g. a `title` field creeping back in, fails a
 * fast unit test instead of silently blanking the popover — the HAT-observed
 * M15 F1 Leg 5 regression this guards against).
 * @param {{name: HTMLInputElement, url: HTMLInputElement, error: HTMLElement}} card
 * @param {any} model
 */
export function applyBookmarkEditModel(card, model) {
  card.name.value = model && typeof model.name === 'string' ? model.name : '';
  card.url.value = model && typeof model.url === 'string' ? model.url : '';
  card.error.textContent = '';
}
