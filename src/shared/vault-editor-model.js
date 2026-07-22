// @ts-check

// Pure editor logic for the goldfinch://vault item editor (M12 Flight 3, Leg 2 /
// DD3, DD6). Extracted so the security-sensitive parts — the unchanged-secret
// assembly, the mask/reveal/clear-on-hide state machine, and the origin-link scheme
// guard — are unit-testable WITHOUT a DOM (the vault-page-model.js precedent; the
// page DOM itself is not axe-coverable, DD9). No DOM, no Electron.
//
// The per-type field LAYOUT below declares which editor inputs each type shows and
// which are secret. It is PRESENTATION, distinct from the security projection/merge
// (single-sourced main-side in vault-item-schema.js); a cross-module test pins this
// layout's secret/non-secret sets to that schema so the two can never drift.
//
// Real ES module: the page imports it via a flat serving-path specifier resolved by
// internal-page-map.js; unit tests require() the same file.

/**
 * @typedef {{ name: string, label: string, multiline?: boolean }} FieldSpec
 * @typedef {{ nonSecret: FieldSpec[], secret: FieldSpec[] }} TypeLayout
 * @typedef {{ value: string, revealed: boolean, touched: boolean }} SecretState
 */

/** The placeholder shown for a masked (unrevealed) secret field. */
const MASK = '••••••••';

/** @type {Record<'login'|'card'|'note', TypeLayout>} */
const EDITOR_LAYOUT = {
  login: {
    nonSecret: [
      { name: 'title', label: 'Name' },
      { name: 'username', label: 'Username' },
      { name: 'origin', label: 'Website' },
    ],
    secret: [
      { name: 'password', label: 'Password' },
      { name: 'totp', label: 'Authenticator secret' },
      { name: 'notes', label: 'Notes', multiline: true },
    ],
  },
  card: {
    nonSecret: [
      { name: 'title', label: 'Name' },
      { name: 'cardholder', label: 'Cardholder' },
      { name: 'brand', label: 'Brand' },
      { name: 'last4', label: 'Last 4 digits' },
    ],
    secret: [
      { name: 'number', label: 'Card number' },
      { name: 'cvv', label: 'Security code' },
      { name: 'expiry', label: 'Expiry' },
      { name: 'notes', label: 'Notes', multiline: true },
    ],
  },
  note: {
    nonSecret: [{ name: 'title', label: 'Name' }],
    secret: [
      { name: 'body', label: 'Note', multiline: true },
      { name: 'notes', label: 'Notes', multiline: true },
    ],
  },
};

/** @type {Array<'login'|'card'|'note'>} */
const EDITOR_TYPES = /** @type {Array<'login'|'card'|'note'>} */ (Object.keys(EDITOR_LAYOUT));

/**
 * @param {string} type
 * @returns {TypeLayout}
 */
function layoutFor(type) {
  const l = EDITOR_LAYOUT[/** @type {'login'|'card'|'note'} */ (type)];
  if (!l) throw new Error(`vault-editor-model: unknown item type "${type}"`);
  return l;
}

/** @param {string} type @returns {string[]} */
function secretNames(type) {
  return layoutFor(type).secret.map((f) => f.name);
}

/** @param {string} type @returns {string[]} */
function nonSecretNames(type) {
  return layoutFor(type).nonSecret.map((f) => f.name);
}

// ---------------------------------------------------------------------------
// Secret-field state machine — mask / reveal / edit / hide.
//
// A secret field starts MASKED and UNTOUCHED. `revealed` means its plaintext is
// currently in the DOM (a viewing/copy gesture, or an in-progress edit); `touched`
// means the user changed it (typed or cleared) and its new value must be SENT on
// save. A masked-untouched field (touched === false) is preserved by main via the
// unchanged-secret path — its plaintext never enters the DOM at all.
// ---------------------------------------------------------------------------

/** @returns {SecretState} a masked, untouched, hidden field. */
function newSecretState() {
  return { value: '', revealed: false, touched: false };
}

/**
 * Reveal the stored plaintext for viewing/copy. Does NOT mark the field touched —
 * revealing alone never causes the (unchanged) value to be re-sent on save; the
 * plaintext is cleared again on hide/blur/save.
 * @param {SecretState} _state
 * @param {string} secret
 * @returns {SecretState}
 */
function reveal(_state, secret) {
  return { value: secret ?? '', revealed: true, touched: _state.touched };
}

/**
 * Clear the plaintext from the field and re-mask it back to the UNCHANGED state
 * (used on hide, on blur of a pure reveal, and on save). Discards any reveal.
 * @param {SecretState} _state
 * @returns {SecretState}
 */
function hide(_state) {
  return newSecretState();
}

/**
 * The user typed a new value (or cleared it to ''): mark it touched + shown, so the
 * value is SENT verbatim on save (an explicit '' clears the field in main).
 * @param {SecretState} _state
 * @param {string} value
 * @returns {SecretState}
 */
function edit(_state, value) {
  return { value: value ?? '', revealed: true, touched: true };
}

/**
 * Initial secret-field states for opening the editor. A NEW item's secret fields
 * are fresh, editable inputs — touched + shown so their (possibly empty) values are
 * sent directly (there is nothing to preserve; a new-id save naming unchanged
 * fields is rejected by the store's create-defense). An EXISTING item's secret
 * fields open MASKED + untouched.
 * @param {string} type
 * @param {boolean} isNew
 * @returns {Record<string, SecretState>}
 */
function initialSecretStates(type, isNew) {
  /** @type {Record<string, SecretState>} */
  const out = {};
  for (const name of secretNames(type)) {
    out[name] = isNew ? { value: '', revealed: true, touched: true } : newSecretState();
  }
  return out;
}

/**
 * Assemble the save payload from the editor state. Produces the full item (every
 * field present) plus the OUT-OF-BAND `unchangedSecrets` list naming the masked-
 * untouched secret fields main must preserve. A touched secret is sent verbatim
 * (an explicit '' clears it); a non-secret field is always sent.
 * `matchMode` (M12 F4 Leg 4 / DD5) is bespoke, NOT a layout field: it is set explicitly
 * on `login` items to `'exact'` | `'registrable-domain'` (any other value → `'exact'`).
 * Because saveItem is a WHOLE-item full-replace, a login MUST always carry an explicit
 * matchMode or an edit-and-save would silently drop a prior opt-in back to exact.
 * @param {{ type: string, id?: string, nonSecretValues: Record<string, any>, secretStates: Record<string, SecretState>, matchMode?: string }} args
 * @returns {{ item: Record<string, any>, unchangedSecrets: string[] }}
 */
function assembleSave({ type, id, nonSecretValues = {}, secretStates = {}, matchMode }) {
  /** @type {Record<string, any>} */
  const item = { type };
  if (typeof id === 'string' && id.length > 0) item.id = id;

  for (const name of nonSecretNames(type)) {
    const v = nonSecretValues[name];
    item[name] = v == null ? '' : v;
  }

  /** @type {string[]} */
  const unchangedSecrets = [];
  for (const name of secretNames(type)) {
    const st = secretStates[name] || newSecretState();
    if (st.touched) {
      item[name] = st.value ?? '';
    } else {
      unchangedSecrets.push(name);
      item[name] = ''; // placeholder — main substitutes the existing secret.
    }
  }

  if (type === 'login') {
    item.matchMode = matchMode === 'registrable-domain' ? 'registrable-domain' : 'exact';
  }
  return { item, unchangedSecrets };
}

/**
 * Partition a vault's item list into per-type buckets for the typed subsections
 * (M12 F5 HAT). DEFENSIVE by design: an item is bucketed ONLY when its `type` is a
 * known editor type (EDITOR_TYPES: login/card/note — the same taxonomy pinned to the
 * main-side security schema by the drift guard). An item with a missing/unknown type
 * is NOT silently dropped — it goes into the separate `unknown` bucket so the page can
 * SURFACE it (a visible row + a console warning). Order within a bucket is the input
 * order (a stable list read). Returns a record keyed by every known type plus `unknown`.
 * @param {Array<any>} items
 * @returns {{ login: any[], card: any[], note: any[], unknown: any[] }}
 */
function partitionItemsByType(items) {
  /** @type {Record<string, any[]>} */
  const buckets = { unknown: [] };
  for (const type of EDITOR_TYPES) buckets[type] = [];
  const known = new Set(EDITOR_TYPES);
  for (const item of Array.isArray(items) ? items : []) {
    const type = item && typeof item.type === 'string' ? item.type : null;
    if (type && known.has(/** @type {any} */ (type))) buckets[type].push(item);
    else buckets.unknown.push(item);
  }
  return /** @type {{ login: any[], card: any[], note: any[], unknown: any[] }} */ (buckets);
}

/**
 * Validate a value as an http/https URL for rendering an `origin` as a link. A
 * `javascript:` (or any non-http/https) origin executes when set as an href even
 * without innerHTML, so only http/https round-trips; anything else → null (render
 * as inert text). Returns the normalized href on success.
 * @param {any} value
 * @returns {string | null}
 */
function safeHttpUrl(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
}

export {
  MASK,
  EDITOR_LAYOUT,
  EDITOR_TYPES,
  secretNames,
  nonSecretNames,
  newSecretState,
  reveal,
  hide,
  edit,
  initialSecretStates,
  assembleSave,
  partitionItemsByType,
  safeHttpUrl,
};
