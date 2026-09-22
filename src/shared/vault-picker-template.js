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
// Not exported: unlike CERT_PICK_PREFIX (mirrored as a local literal in
// register-overlay-ipc.js because main-process code parses cert-picker ids), the
// vault-picker id is only ever produced/parsed here, via the exported pickId /
// parsePickIndex helpers — there is no other consumer of the raw prefix.
const PICK_PREFIX = 'pick:';

// The selection id for the separated "Manage passwords" footer link. NOT a `pick:<i>`
// index — the chrome dispatch routes it to openVaultPage() (a navigation, no secret).
export const MANAGE_ID = 'manage-passwords';

// Generate-in-picker action-row ids (Mission 21, Flight 4, Leg 3 —
// generate-in-picker, DD5/AC9). Like MANAGE_ID, these are FIXED ids — never
// `pick:<i>` — so a row rendered from a `{ action: 'generate' }` / `{ action:
// 'unlock' }` model entry can never be confused with a real credential index.
export const GENERATE_ID = 'generate-password';
export const UNLOCK_ID = 'unlock-saved-logins';

const SVG_NS = 'http://www.w3.org/2000/svg';

// The empty-picker note (AC4, Mission 21 Flight 3 Leg 1; text updated Flight 3
// Leg 3, AC20, to name all three families — Leg 1's own design review
// established that a comment misattributing a boundary is worse than a stale
// one, so this corrects the prior "Leg 4 changes the text" comment).
const EMPTY_PICKER_NOTE = 'No saved logins, cards, or identities to fill here';

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
 * Build the per-row PAYMENT-CARD glyph (issue #152) — a card rectangle with a
 * magnetic stripe, drawn in the same createElementNS/setAttribute discipline as
 * the credential padlock (NO innerHTML, never a remote asset). Decorative
 * (aria-hidden); the row's textContent carries the accessible name.
 * @param {Document} document
 * @returns {SVGElement}
 */
function buildCardIcon(document) {
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
  body.setAttribute('x', '2');
  body.setAttribute('y', '5');
  body.setAttribute('width', '20');
  body.setAttribute('height', '14');
  body.setAttribute('rx', '2');
  svg.appendChild(body);

  const stripe = document.createElementNS(SVG_NS, 'path');
  stripe.setAttribute('d', 'M2 10h20');
  svg.appendChild(stripe);

  return svg;
}

/**
 * Build the per-row IDENTITY glyph (M21 F3 Leg 3) — a simple person silhouette,
 * drawn in the same createElementNS/setAttribute discipline as the credential
 * padlock and card icons (NO innerHTML, never a remote asset). Decorative
 * (aria-hidden); the row's textContent carries the accessible name.
 * @param {Document} document
 * @returns {SVGElement}
 */
function buildIdentityIcon(document) {
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

  const head = document.createElementNS(SVG_NS, 'circle');
  head.setAttribute('cx', '12');
  head.setAttribute('cy', '8');
  head.setAttribute('r', '4');
  svg.appendChild(head);

  const shoulders = document.createElementNS(SVG_NS, 'path');
  shoulders.setAttribute('d', 'M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8');
  svg.appendChild(shoulders);

  return svg;
}

// Type-keyed dispatch table (Mission 21 Flight 3 Leg 1, replacing the 8 binary
// `=== 'card'` / `!== 'card'` branch sites this module used to carry): each entry
// supplies the section heading label, the generic fallback title, the row icon
// builder, and the secondary (dimmed) line builder for that kind. Data only, no
// branching logic. Membership is checked via hasOwnProperty (never a bare truthy
// lookup) so a `type` of 'constructor' or similar can't resolve through
// Object.prototype. `identity` (M21 F3 Leg 3, AC20) is the third family — its
// secondary line is `fullName` (a declared non-secret field in
// vault-item-schema.js; every other identity field is secret and never
// reaches the sheet).
const KIND_TABLE = {
  login: {
    sectionHeading: 'Logins',
    fallbackTitle: 'Login',
    buildIcon: buildCredentialIcon,
    secondaryLine: (item) => String(item && item.username != null ? item.username : '')
  },
  card: {
    sectionHeading: 'Cards',
    fallbackTitle: 'Card',
    buildIcon: buildCardIcon,
    // last4 is the ONLY card digits that ever reach the sheet (a declared
    // non-secret field in vault-item-schema.js; the PAN, CVV and expiry never
    // leave main).
    secondaryLine: (item) => {
      const brand = item && item.brand != null && item.brand !== '' ? String(item.brand) : '';
      const last4 = item && item.last4 != null && item.last4 !== '' ? `•••• ${item.last4}` : '';
      return [brand, last4].filter(Boolean).join('  ');
    }
  },
  identity: {
    sectionHeading: 'Identity',
    fallbackTitle: 'Identity',
    buildIcon: buildIdentityIcon,
    secondaryLine: (item) => String(item && item.fullName != null ? item.fullName : '')
  }
};

/**
 * Resolve a picker row's family. An item whose `type` is absent, `'login'`,
 * `'note'`, or anything unrecognised resolves to `login` — the exact fallback the
 * prior `item.type !== 'card'` check implied. `null`/`undefined` items resolve to
 * `login` too (the render loop's own `item || {}` renders a null entry as a
 * login row).
 * @param {{ type?: string }|null|undefined} item
 * @returns {'card'|'login'|'identity'}
 */
function kindOf(item) {
  const type = item && item.type;
  const known = typeof type === 'string' && Object.prototype.hasOwnProperty.call(KIND_TABLE, type);
  const knownType = /** @type {'card'|'login'|'identity'} */ (type);
  return known ? knownType : 'login';
}

/**
 * The secondary (dimmed) line for a row. A login shows its username; a card shows
 * its brand and masked last four — the ONLY card digits that ever reach the sheet
 * (`last4` is a declared non-secret field in vault-item-schema.js; the PAN, CVV and
 * expiry never leave main); an identity shows its `fullName` — the ONLY identity
 * field besides `title` that is not secret. Text only, always a string.
 * @param {{ type?: string, username?: string|null, brand?: string|null, last4?: string|null, fullName?: string|null }} item
 * @returns {string}
 */
export function secondaryLineFor(item) {
  return KIND_TABLE[kindOf(item)].secondaryLine(item);
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
 * The channel-4 activation id for a clicked picker row's `dataset` (AC9b,
 * design review round 1 HIGH — the dispatch CHOKEPOINT). Today's binary
 * pick-index-or-MANAGE_ID fallback would silently route BOTH Generate-in-
 * picker action rows to "Manage passwords" (a navigation), since neither
 * carries `data-pick-index`. Only the two exported action ids
 * (GENERATE_ID/UNLOCK_ID) are honoured as `data-action-id` values — any
 * OTHER `data-action-id` (defensive: none is ever produced today) falls
 * through to the existing pick-index-or-MANAGE_ID rule, never silently
 * mis-routed to an action.
 * @param {{ actionId?: string, pickIndex?: string }} dataset
 * @returns {string}
 */
export function activationIdFor(dataset) {
  const actionId = dataset && dataset.actionId;
  if (actionId === GENERATE_ID || actionId === UNLOCK_ID) return actionId;
  const pi = dataset && dataset.pickIndex;
  return pi != null && pi !== '' ? pickId(Number(pi)) : MANAGE_ID;
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
  return String(label != null && label !== '' ? label : vaultId != null ? vaultId : '');
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

  // Generic copy since issue #152: the list can hold logins, cards, or both, and the
  // card is built ONCE (rows are rendered per-open), so the header cannot be model-
  // dependent. "Saved logins" over a list containing cards would simply be wrong.
  const { header, close } = buildVaultSheetHeader(document, 'Fill from vault');
  card.appendChild(header);

  // The roving list host carries the menu semantics (moved off the card so the fixed header
  // is not a menuitem and does not scroll away). Rows render here via renderVaultPickerRows.
  const list = document.createElement('div');
  list.className = 'vault-picker-list';
  list.setAttribute('role', 'menu');
  list.setAttribute('aria-label', 'Choose a saved item to fill');
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
 * @param {Array<{ vaultId?: string, id?: string, type?: string, title?: string|null, username?: string|null, brand?: string|null, last4?: string|null, hasTotp?: boolean, badgeLabel?: string, badgeColor?: string|null, widened?: boolean }>} model
 * @returns {HTMLElement[]}
 */
/**
 * True iff `item` is a Generate-in-picker ACTION-ROW model entry — never a
 * real credential row. (AC9, design review round 1 MEDIUM: action entries
 * branch early, before any `kindOf`/`KIND_TABLE` use.)
 * @param {any} item
 * @returns {boolean}
 */
function isActionEntry(item) {
  return !!item && (item.action === 'generate' || item.action === 'unlock');
}

export function renderVaultPickerRows(document, card, model) {
  card.textContent = '';
  const rows = Array.isArray(model) ? model : [];

  /** @type {HTMLElement[]} */
  const buttons = [];

  // The empty note shows only when there are NO real item rows AND no
  // `unlock` action row (AC9) — a Generate-only picker (locked=false, zero
  // saved items) still shows both the Generate row AND the note; a LOCKED
  // picker (Generate + Unlock, zero items) shows no note (the Unlock row is
  // itself an affordance to reach real items).
  const hasUnlockRow = rows.some((r) => r && r.action === 'unlock');
  const itemRowCount = rows.filter((r) => !isActionEntry(r)).length;
  if (itemRowCount === 0 && !hasUnlockRow) {
    const note = document.createElement('div');
    note.className = 'cm-item vault-picker-note';
    note.setAttribute('aria-disabled', 'true');
    note.textContent = EMPTY_PICKER_NOTE;
    card.appendChild(note);
  }

  // Section headers (issue #152) appear ONLY when ≥2 distinct kinds are present — a
  // single-kind picker renders exactly as it did before cards existed. Headers are
  // `aria-hidden` presentational text, NOT menuitems: they never enter `buttons`, so
  // the roving contract and the `data-pick-index` → model index mapping are both
  // untouched by them (the index is the position in the FULL model, not in a section).
  //
  // Derived from `rows.filter(Boolean)` — deliberately NOT the same array the render
  // loop below walks. A null entry contributes no kind here (matching the pre-table
  // `rows.some(r => r && …)` precomputation) even though the render loop, reached via
  // `item || {}`, renders that same null entry as a login row. Two derivations over
  // one array, on purpose: `filter(Boolean)` for sectioning, `item || {}` for
  // rendering — collapsing them would flip `[null, {type:'card'}]` from unsectioned to
  // sectioned, a real output change. Action entries (AC9) are excluded here too — they
  // never spawn or merge into a kind-based section heading.
  const presentKinds = new Set(
    rows
      .filter(Boolean)
      .filter((r) => !isActionEntry(r))
      .map(kindOf)
  );
  const sectioned = presentKinds.size >= 2;
  let lastKind = null;

  rows.forEach((item, i) => {
    // Generate-in-picker action rows (AC9): fixed id (GENERATE_ID/UNLOCK_ID,
    // never `pick:<i>`), no data-pick-index, no section heading, built via
    // textContent only. Pushed into `buttons` in array order — since chrome
    // always prepends action entries ahead of real items, this already keeps
    // roving order = visual order with no extra bookkeeping.
    if (isActionEntry(item)) {
      const btn = document.createElement('button');
      btn.className = 'cm-item vault-picker-action';
      btn.type = 'button';
      btn.setAttribute('role', 'menuitem');
      btn.tabIndex = -1;
      btn.dataset.actionId = item.action === 'generate' ? GENERATE_ID : UNLOCK_ID;
      const label = document.createElement('span');
      label.className = 'vault-picker-action-label';
      label.textContent = item.action === 'generate' ? 'Generate strong password' : 'Unlock to fill a saved login';
      btn.appendChild(label);
      card.appendChild(btn);
      buttons.push(btn);
      return;
    }

    const kind = kindOf(item);
    const entry = KIND_TABLE[kind];
    if (sectioned && kind !== lastKind) {
      const heading = document.createElement('div');
      heading.className = 'vault-picker-section';
      heading.setAttribute('aria-hidden', 'true');
      heading.textContent = entry.sectionHeading;
      card.appendChild(heading);
    }
    lastKind = kind;

    const btn = document.createElement('button');
    btn.className = 'cm-item vault-picker-row';
    btn.type = 'button';
    btn.setAttribute('role', 'menuitem');
    btn.tabIndex = -1;
    btn.dataset.pickIndex = String(i);

    btn.appendChild(entry.buildIcon(document));

    const text = document.createElement('span');
    text.className = 'vault-picker-text';

    const secondary = secondaryLineFor(item || {});

    const title = document.createElement('span');
    title.className = 'vault-picker-title';
    // Fall back through: explicit title → the secondary line → a type-appropriate
    // generic, so a row is never blank.
    const titleText =
      item && item.title != null && item.title !== '' ? item.title : secondary !== '' ? secondary : entry.fallbackTitle;
    title.textContent = String(titleText);
    text.appendChild(title);

    const sub = document.createElement('span');
    sub.className = 'vault-picker-username';
    sub.textContent = secondary;
    text.appendChild(sub);

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
