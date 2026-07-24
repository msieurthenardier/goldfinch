// @ts-check

// DOM builder + row renderer for the menu-overlay sheet's `vault-picker` template
// (M12 Flight 2 Leg 3 pick-and-fill, DD5/DD6) — the DEDICATED sixth template kind.
// Extracted as pure, document-injected helpers (the same "pure module in
// src/shared/" pattern vault-unlock-template.js uses) so the structure / aria
// contract AND the id↔index mapping are unit-testable against the fake-document
// helper without a live sheet. menu-overlay.js imports these and wires behavior
// (roving via the shared menu-controller, selection → sendActivatedOnce).
//
// A `vault-picker` is NOT an alias of the `'menu'` template: `renderMenu` emits a
// single label + optional color dot + a hardcoded "Default" badge and cannot render
// the title + dimmed username + source-vault badge rows this picker needs. The card
// is a centered backdrop (like vault-unlock) since the lock-icon gesture carries no
// anchor. The selection reports the row INDEX via the `id` field — `pick:<i>`, the
// established `sug:<i>` idiom (non-secret; `id` is not length-capped, only `value`).
//
// SECURITY: the model is METADATA ONLY (title / username / ids / badge). No password
// / TOTP secret is ever in the model, a row, or the reported selection.

import { isSafeColor } from './safe-color.js';
import { buildVaultSheetHeader } from './vault-sheet-header.js';

// The selection id namespace. `id` (not `value`) carries the index — `value` is
// main-side capped at 24 chars by sanitizeActivatedValue; `id` is not.
export const PICK_PREFIX = 'pick:';

// The selection id for the separated "Manage passwords" footer link. NOT a `pick:<i>`
// index — the chrome dispatch routes it to openVaultPage() (a navigation, no secret).
export const MANAGE_ID = 'manage-passwords';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Build the generic, per-row credential glyph (a padlock) as inline SVG — same icon
 * for every row. Built via createElementNS/setAttribute (NO innerHTML): this is a
 * privacy browser and rows never fetch a remote favicon. Decorative (aria-hidden);
 * the row's textContent carries the accessible name.
 * @param {Document} document
 * @returns {SVGElement}
 */
function buildCredentialIcon(document) {
  const svg = /** @type {any} */ (document.createElementNS(SVG_NS, 'svg'));
  svg.setAttribute('class', 'vault-picker-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '22');
  svg.setAttribute('height', '22');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');

  const body = document.createElementNS(SVG_NS, 'rect');
  body.setAttribute('x', '3');
  body.setAttribute('y', '11');
  body.setAttribute('width', '18');
  body.setAttribute('height', '11');
  body.setAttribute('rx', '2');
  body.setAttribute('ry', '2');
  svg.appendChild(body);

  const shackle = document.createElementNS(SVG_NS, 'path');
  shackle.setAttribute('d', 'M7 11V7a5 5 0 0 1 10 0v4');
  svg.appendChild(shackle);

  return svg;
}

/**
 * The selection id for row `i`.
 * @param {number} i
 * @returns {string}
 */
export function pickId(i) {
  return PICK_PREFIX + i;
}

/**
 * The row index encoded in a `pick:<i>` id, or null if `id` is not a valid pick id
 * (defensive: a tampered / foreign id maps to no row rather than NaN-indexing).
 * @param {string} id
 * @returns {number | null}
 */
export function parsePickIndex(id) {
  if (typeof id !== 'string' || !id.startsWith(PICK_PREFIX)) return null;
  const rest = id.slice(PICK_PREFIX.length);
  // Digits only — a bare 'pick:' (Number('') === 0), a negative, or a non-numeric
  // suffix all map to no row rather than a bogus index.
  if (!/^\d+$/.test(rest)) return null;
  return Number(rest);
}

/**
 * The badge label for a row's source vault: "Global" for the global vault, else the
 * jar's display name (the row's `badgeLabel`, enriched by the chrome) falling back
 * to the raw vaultId. Text only — never markup.
 * @param {{ vaultId?: string, badgeLabel?: string }} item
 * @returns {string}
 */
export function badgeLabelFor(item) {
  const vaultId = item && item.vaultId;
  if (vaultId === 'global') return 'Global';
  const label = item && item.badgeLabel;
  return String(label != null && label !== '' ? label : (vaultId != null ? vaultId : ''));
}

/**
 * Build the vault-picker card DOM: a centered backdrop node + a card with a fixed HEADER
 * (title + close/X button) over a scrollable role="menu" `list` (the roving host). Rows are
 * rendered into `list` separately by renderVaultPickerRows. The header gives the sheet a clear
 * title and an OBVIOUS close affordance (the empty state previously offered only a non-obvious
 * click-outside). menu-overlay.js wires the returned `close` button.
 * @param {Document} document
 * @returns {{ node: HTMLElement, card: HTMLElement, list: HTMLElement, close: HTMLButtonElement }}
 */
export function buildVaultPickerCard(document) {
  const node = document.createElement('div');
  node.id = 'sheet-vault-picker';
  node.classList.add('hidden');

  const card = document.createElement('div');
  card.className = 'new-container-inner vault-picker-inner';
  node.appendChild(card);

  const { header, close } = buildVaultSheetHeader(document, 'Saved logins');
  card.appendChild(header);

  // The roving list host carries the menu semantics (moved off the card so the fixed header
  // is not a menuitem and does not scroll away). Rows render here via renderVaultPickerRows.
  const list = document.createElement('div');
  list.className = 'vault-picker-list';
  list.setAttribute('role', 'menu');
  list.setAttribute('aria-label', 'Choose a saved login to fill');
  list.tabIndex = -1;
  card.appendChild(list);

  return { node, card, list, close };
}

/**
 * Build the separated "Manage passwords" footer button (a role="menuitem" so the
 * shared roving contract reaches it by keyboard). It is NOT a `pick:<i>` row — it has
 * no `data-pick-index`; the chrome dispatch routes its `MANAGE_ID` selection to
 * openVaultPage(). A navigation, no secret. Returned so the caller can wire its click.
 * @param {Document} document
 * @returns {{ separator: HTMLElement, btn: HTMLElement }}
 */
function buildManageFooter(document) {
  const separator = document.createElement('div');
  separator.className = 'vault-picker-separator';
  separator.setAttribute('role', 'separator');

  const btn = document.createElement('button');
  btn.className = 'cm-item vault-picker-manage';
  btn.type = 'button';
  btn.setAttribute('role', 'menuitem');
  btn.tabIndex = -1;
  btn.dataset.manage = 'true';

  const label = document.createElement('span');
  label.className = 'vault-picker-manage-label';
  label.textContent = 'Manage passwords';
  btn.appendChild(label);

  return { separator, btn };
}

/**
 * Build one row's trailing badges cluster (rendered in the row's top-right): the
 * source-vault chicklet — tinted with the jar's `badgeColor` when present and SAFE
 * (isSafeColor guard; an unsafe/absent color falls back to the neutral chip, e.g. the
 * Global vault) — plus, when `widened`, the distinct subdomain-match badge. All labels
 * via textContent.
 * @param {Document} document
 * @param {{ vaultId?: string, badgeLabel?: string, badgeColor?: string|null, widened?: boolean }} item
 * @returns {HTMLElement}
 */
function buildRowBadges(document, item) {
  const badges = document.createElement('span');
  badges.className = 'vault-picker-badges';

  const badge = document.createElement('span');
  badge.className = 'vault-picker-badge';
  const color = item && item.badgeColor;
  if (color && isSafeColor(color)) {
    badge.classList.add('vault-picker-badge-colored');
    const dot = document.createElement('span');
    dot.className = 'vault-picker-badge-dot';
    // Guarded above — never a raw color into style without isSafeColor.
    dot.style.backgroundColor = color;
    badge.appendChild(dot);
  }
  const badgeLabel = document.createElement('span');
  badgeLabel.className = 'vault-picker-badge-label';
  badgeLabel.textContent = badgeLabelFor(item || {});
  badge.appendChild(badgeLabel);
  badges.appendChild(badge);

  // A registrable-domain widen (subdomain match, not exact origin): a distinct badge
  // so the operator sees this offer is not exact-origin (M12 F4 Leg 4 / DD5).
  if (item && item.widened) {
    const widened = document.createElement('span');
    widened.className = 'vault-picker-badge vault-picker-badge-widened';
    widened.textContent = 'Subdomain match';
    badges.appendChild(widened);
  }
  return badges;
}

/**
 * Render the picker rows into `card` from the metadata model, replacing any prior
 * content. Each row is a role="menuitem" button laid out like a modern password
 * manager: a generic credential icon on the left, the title + dimmed username stacked
 * to its right, and the source-vault chicklet (jar-colored when a safe `badgeColor` is
 * present, neutral for Global) in the top-right. The row's index is stamped on
 * `data-pick-index`. An EMPTY model renders a single NON-focusable note ("No saved
 * logins for this site") in place of rows.
 *
 * A separated "Manage passwords" footer (divider + a distinct role="menuitem" button,
 * `data-manage`) is ALWAYS appended — even in the empty state — so the operator can
 * always reach the vault page.
 *
 * Returns the focusable menuitems in roving order: the row buttons (if any) followed by
 * the Manage-passwords footer button (the menu-controller's items getter).
 * @param {Document} document
 * @param {HTMLElement} card
 * @param {Array<{ vaultId?: string, id?: string, title?: string|null, username?: string|null, hasTotp?: boolean, badgeLabel?: string, badgeColor?: string|null, widened?: boolean }>} model
 * @returns {HTMLElement[]}
 */
export function renderVaultPickerRows(document, card, model) {
  card.textContent = '';
  const rows = Array.isArray(model) ? model : [];

  /** @type {HTMLElement[]} */
  const buttons = [];

  if (!rows.length) {
    const note = document.createElement('div');
    note.className = 'cm-item vault-picker-note';
    note.setAttribute('aria-disabled', 'true');
    note.textContent = 'No saved logins for this site';
    card.appendChild(note);
  }

  rows.forEach((item, i) => {
    const btn = document.createElement('button');
    btn.className = 'cm-item vault-picker-row';
    btn.type = 'button';
    btn.setAttribute('role', 'menuitem');
    btn.tabIndex = -1;
    btn.dataset.pickIndex = String(i);

    btn.appendChild(buildCredentialIcon(document));

    const text = document.createElement('span');
    text.className = 'vault-picker-text';

    const title = document.createElement('span');
    title.className = 'vault-picker-title';
    const titleText = item && item.title != null && item.title !== ''
      ? item.title
      : (item && item.username != null && item.username !== '' ? item.username : 'Login');
    title.textContent = String(titleText);
    text.appendChild(title);

    const username = document.createElement('span');
    username.className = 'vault-picker-username';
    username.textContent = String(item && item.username != null ? item.username : '');
    text.appendChild(username);

    btn.appendChild(text);
    btn.appendChild(buildRowBadges(document, item || {}));

    card.appendChild(btn);
    buttons.push(btn);
  });

  const { separator, btn: manageBtn } = buildManageFooter(document);
  card.appendChild(separator);
  card.appendChild(manageBtn);
  buttons.push(manageBtn);

  return buttons;
}
