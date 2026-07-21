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

// The selection id namespace. `id` (not `value`) carries the index — `value` is
// main-side capped at 24 chars by sanitizeActivatedValue; `id` is not.
export const PICK_PREFIX = 'pick:';

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
 * Build the vault-picker card DOM: a centered backdrop node + a role="menu" card
 * (roving list host). Rows are rendered separately by renderVaultPickerRows.
 * @param {Document} document
 * @returns {{ node: HTMLElement, card: HTMLElement }}
 */
export function buildVaultPickerCard(document) {
  const node = document.createElement('div');
  node.id = 'sheet-vault-picker';
  node.classList.add('hidden');

  const card = document.createElement('div');
  card.className = 'new-container-inner vault-picker-inner';
  card.setAttribute('role', 'menu');
  card.setAttribute('aria-label', 'Choose a saved login to fill');
  card.tabIndex = -1;
  node.appendChild(card);

  return { node, card };
}

/**
 * Render the picker rows into `card` from the metadata model, replacing any prior
 * content. Each row is a role="menuitem" button showing title + dimmed username +
 * a source-vault badge; the row's index is stamped on `data-pick-index`. An EMPTY
 * model renders a single NON-focusable note ("No saved logins for this site") and
 * returns [] — the caller's roving contract then has no items to focus.
 *
 * Returns the focusable row buttons in order (the menu-controller's items getter).
 * @param {Document} document
 * @param {HTMLElement} card
 * A row whose `widened` flag is true (a registrable-domain match on a subdomain, not
 * the exact origin — M12 F4 Leg 4 / DD5) gets an ADDITIONAL distinct badge so the
 * operator sees the offer is not exact-origin. `textContent`-only, like every label.
 * @param {Array<{ vaultId?: string, id?: string, title?: string|null, username?: string|null, hasTotp?: boolean, badgeLabel?: string, widened?: boolean }>} model
 * @returns {HTMLElement[]}
 */
export function renderVaultPickerRows(document, card, model) {
  card.textContent = '';
  const rows = Array.isArray(model) ? model : [];

  if (!rows.length) {
    const note = document.createElement('div');
    note.className = 'cm-item vault-picker-note';
    note.setAttribute('aria-disabled', 'true');
    note.textContent = 'No saved logins for this site';
    card.appendChild(note);
    return [];
  }

  /** @type {HTMLElement[]} */
  const buttons = [];
  rows.forEach((item, i) => {
    const btn = document.createElement('button');
    btn.className = 'cm-item vault-picker-row';
    btn.type = 'button';
    btn.setAttribute('role', 'menuitem');
    btn.tabIndex = -1;
    btn.dataset.pickIndex = String(i);

    const title = document.createElement('span');
    title.className = 'vault-picker-title';
    const titleText = item && item.title != null && item.title !== ''
      ? item.title
      : (item && item.username != null && item.username !== '' ? item.username : 'Login');
    title.textContent = String(titleText);
    btn.appendChild(title);

    const username = document.createElement('span');
    username.className = 'vault-picker-username';
    username.textContent = String(item && item.username != null ? item.username : '');
    btn.appendChild(username);

    const badge = document.createElement('span');
    badge.className = 'vault-picker-badge';
    badge.textContent = badgeLabelFor(item || {});
    btn.appendChild(badge);

    // A registrable-domain widen (subdomain match, not exact origin): a distinct badge
    // so the operator sees this offer is not exact-origin (M12 F4 Leg 4 / DD5).
    if (item && item.widened) {
      const widened = document.createElement('span');
      widened.className = 'vault-picker-badge vault-picker-badge-widened';
      widened.textContent = 'Subdomain match';
      btn.appendChild(widened);
    }

    card.appendChild(btn);
    buttons.push(btn);
  });
  return buttons;
}
