'use strict';

// Pure PASSWORD-FIELD ROLE classifier (Mission 21, Flight 4, Leg 2 —
// password-field-roles, flight DD1/DD3a). Tells apart a sign-in field from a
// sign-up ("new" + "confirm") field and a change-password ("current" + "new" +
// "confirm") field, inside one login SCOPE — a `<form>`, or the whole document
// for form-less fields (DD3a). Two exports:
//
//   loginScopeOrdinals(entries, ordinal) -> number[]
//     Every ordinal, among a family's own `findAllLoginFields(doc)`-shaped
//     `entries` array, that shares the handle-at-`ordinal`'s scope — its
//     `.form` (non-null), or every form-less entry when the handle's own
//     `.form` is null/undefined. Document order (the array's own order).
//
//   classifyPasswordScope(passwordFields) -> { kind, roles }
//     `passwordFields` is an array of `<input type=password>`-shaped field
//     objects, in document order (typically `entries[i].password` for every
//     `i` in `loginScopeOrdinals`'s result). `roles` is an ALIGNED array of
//     'current' | 'new' | 'confirm' | null. `kind` is 'sign-in' (capture
//     unchanged from today) | 'classified' (a rotation/sign-up capture can be
//     planned) | 'ambiguous' (no capture — a missed capture, never a wrong
//     value, per DD1).
//
// LAYERING (DD1, amended at design review round 2 — a per-scope "first
// decisive layer" rule misread a two-field current+new form as new+confirm).
// Resolution is per FIELD first, then structure fills only what layers 1-2
// left unresolved:
//   1. `autocomplete` (read via `getAttribute('autocomplete')`, tokens split
//      on whitespace via field-tokenizer.js's `resolveAutocompleteToken` — so
//      a prefixed value like "section-x new-password" still resolves):
//      `new-password` -> new; `current-password` -> current.
//   2. name/id/placeholder/aria-label tokens (`field-tokenizer.js`'s
//      `fieldHaystack` + `normalizeFieldHaystack`, word-boundary token
//      matching), for fields layer 1 left unresolved. Precedence within one
//      field: confirm > current > new (so `confirmNewPassword` and
//      `newPasswordConfirm` both resolve `confirm`, never `new`).
//   3. Structure, for fields layers 1-2 left unresolved, consistent with what
//      is already resolved: three fields -> current + new + confirm (the
//      roles not yet taken, assigned to the unresolved fields in document
//      order); two fields -> current + new if either field already resolved
//      `current`, otherwise new + confirm; one field -> no structural signal
//      (a one-field scope is a REGRESSION-GATE case the planner handles
//      itself — see vault-capture-plan.js's `planLogin` — never routed
//      through this layer).
//
// BOTH layer 1 and layer 2 apply the SAME "a second `new` in the scope
// becomes `confirm`" rule (AC1/AC2), via one running flag spanning the whole
// two-layer pass (layer 1 fully processes every field, in document order,
// before layer 2 begins) — so a scope carrying, say, two independently
// `new-password`-marked fields resolves new+confirm, and the same holds for
// two independently token-matched `new` fields once layer 1 has nothing left
// to resolve.
//
// KNOWN LIMIT (documented, not fixed here — DD1's own named gap, corpus-
// recorded as `known-unsolved`): a flat, no-separator name (`newpass`,
// `oldpwd`) has no word boundary for `normalizeFieldHaystack` to insert (it
// only splits at a camelCase hump or a `-`/`_`), so it falls through layer 2
// unresolved to layer 3 (structure) — realistic camelCase (`newPassword`) and
// snake_case (`new_password`) shapes ARE covered; a fully unmarked TWO-FIELD
// current+new form (no autocomplete, no tokens at all) is therefore
// indistinguishable from new+confirm and classifies as such — DD3's
// confirm-agreement rule then plans no capture for it (a missed capture,
// fail-safe, never a wrong value).
//
// Pure, CJS, Electron-free, DOM-global-free (reads only what is handed to it
// — `getAttribute`, `.form`; no `window`/`document` reference at module
// scope) so it `require()`s under `node --test` AND bundles into the isolated
// world untouched for Leg 3's fill-target resolution (DD7's "one function,
// not a hand-mirror" requirement) exactly like vault-gesture-policy.js and
// vault-capture-plan.js.

const { normalizeFieldHaystack, resolveAutocompleteToken, fieldHaystack } = require('./field-tokenizer');

/** Layer 1: the two `autocomplete` value tokens this classifier recognises. */
const AUTOCOMPLETE_ROLE_MAP = new Map([
  ['new-password', 'new'],
  ['current-password', 'current']
]);

/** Layer 2 fallback vocabulary — confirm > current > new precedence within one field. */
const CONFIRM_TOKENS = new Set(['confirm', 'confirmation', 'repeat', 'retype', 'verify', 'again']);
const CURRENT_TOKENS = new Set(['current', 'old', 'existing']);
const NEW_TOKEN = 'new';

/**
 * Every ordinal in `entries` (a `findAllLoginFields(doc)`-shaped array) that
 * shares the SCOPE of the handle entry at `ordinal`: the handle's own
 * non-null `.form`, or — when the handle's `.form` is null/undefined — every
 * entry whose OWN `.form` is also null/undefined (DD3a's form-less scope).
 * Document order (the input array's own order). `[]` for an out-of-range or
 * non-integer `ordinal`, or a non-array `entries` — never throws.
 * @param {any[]} entries
 * @param {number} ordinal
 * @returns {number[]}
 */
function loginScopeOrdinals(entries, ordinal) {
  if (
    !Array.isArray(entries) ||
    typeof ordinal !== 'number' ||
    !Number.isInteger(ordinal) ||
    ordinal < 0 ||
    ordinal >= entries.length
  ) {
    return [];
  }
  const handle = entries[ordinal];
  const handleForm = handle ? handle.form : undefined;
  const result = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const entryForm = entry ? entry.form : undefined;
    if (handleForm == null) {
      if (entryForm == null) result.push(i);
    } else if (entryForm === handleForm) {
      result.push(i);
    }
  }
  return result;
}

/**
 * `field`'s layer-1 `autocomplete` role, or null. Never throws on a field
 * lacking `getAttribute` (defensive — a hand-built fake or a stale reference).
 * @param {any} field
 * @returns {'new' | 'current' | null}
 */
function autocompleteRole(field) {
  const raw = typeof field?.getAttribute === 'function' ? field.getAttribute('autocomplete') : null;
  const role = resolveAutocompleteToken(raw, AUTOCOMPLETE_ROLE_MAP);
  return role === 'new' || role === 'current' ? role : null;
}

/**
 * `field`'s layer-2 fallback token role, or null — confirm > current > new
 * precedence within the field's own token set. Never throws on a field
 * lacking the attributes `fieldHaystack` reads.
 * @param {any} field
 * @returns {'confirm' | 'current' | 'new' | null}
 */
function fallbackRole(field) {
  const hay = fieldHaystack(field) || '';
  if (!hay) return null;
  const tokens = new Set(normalizeFieldHaystack(hay).toLowerCase().split(/\s+/).filter(Boolean));
  if (tokens.size === 0) return null;
  for (const t of CONFIRM_TOKENS) if (tokens.has(t)) return 'confirm';
  for (const t of CURRENT_TOKENS) if (tokens.has(t)) return 'current';
  if (tokens.has(NEW_TOKEN)) return 'new';
  return null;
}

/**
 * Layer 3 (structure): fill every still-unresolved field, for a scope of
 * EXACTLY two or three total fields, consistent with what is already
 * resolved — mutates `roles` in place. A one-field scope carries no
 * structural signal (the planner's own regression-gate case, never reached
 * through here); any other count (0, or more than 3) is left as-is, which
 * `computeKind` below resolves to `ambiguous` whenever a null survives.
 * @param {Array<'current'|'new'|'confirm'|null>} roles
 */
function applyStructuralLayer(roles) {
  const unresolvedIndices = [];
  for (let i = 0; i < roles.length; i++) if (roles[i] == null) unresolvedIndices.push(i);
  if (unresolvedIndices.length === 0) return;

  /** @type {Array<'current'|'new'|'confirm'>} */
  let candidateSeq;
  if (roles.length === 3) {
    candidateSeq = ['current', 'new', 'confirm'];
  } else if (roles.length === 2) {
    candidateSeq = roles.includes('current') ? ['current', 'new'] : ['new', 'confirm'];
  } else {
    return; // no structural rule for 0, 1, or >3 fields
  }

  const remaining = candidateSeq.filter((r) => !roles.includes(r));
  for (let k = 0; k < unresolvedIndices.length && k < remaining.length; k++) {
    roles[unresolvedIndices[k]] = remaining[k];
  }
}

/**
 * AC4: the scope's final `kind` from its resolved `roles`.
 *   - 'sign-in': a one-field scope whose sole role is null or 'current'.
 *   - 'classified': exactly one 'new', at most one 'current', at most one
 *     'confirm', and no null anywhere (covers a single field resolved 'new'
 *     too — roles ['new'] satisfies this on its own).
 *   - 'ambiguous': anything else (more than three fields, a duplicated role,
 *     a field left null in a multi-field scope, a one-field scope resolved
 *     to something other than null/current/new).
 * @param {Array<'current'|'new'|'confirm'|null>} roles
 * @returns {'sign-in' | 'classified' | 'ambiguous'}
 */
function computeKind(roles) {
  if (roles.length === 1 && (roles[0] === null || roles[0] === 'current')) return 'sign-in';
  const newCount = roles.filter((r) => r === 'new').length;
  const currentCount = roles.filter((r) => r === 'current').length;
  const confirmCount = roles.filter((r) => r === 'confirm').length;
  const hasNull = roles.some((r) => r === null);
  if (newCount === 1 && currentCount <= 1 && confirmCount <= 1 && !hasNull) return 'classified';
  return 'ambiguous';
}

/**
 * Classify every password field in one login scope (AC1-4). Never throws on
 * a field lacking `getAttribute`/the haystack attributes.
 * @param {any[]} passwordFields
 * @returns {{ kind: 'sign-in' | 'classified' | 'ambiguous', roles: Array<'current'|'new'|'confirm'|null> }}
 */
function classifyPasswordScope(passwordFields) {
  const fields = Array.isArray(passwordFields) ? passwordFields : [];
  /** @type {Array<'current'|'new'|'confirm'|null>} */
  const roles = fields.map(() => null);
  let sawNew = false;

  // Layer 1: autocomplete, in document order, ALL fields before layer 2 begins.
  for (let i = 0; i < fields.length; i++) {
    const role = autocompleteRole(fields[i]);
    if (!role) continue;
    if (role === 'new') {
      if (sawNew) {
        roles[i] = 'confirm';
      } else {
        roles[i] = 'new';
        sawNew = true;
      }
    } else {
      roles[i] = role; // 'current'
    }
  }

  // Layer 2: name/id/placeholder/aria-label tokens, only still-unresolved fields.
  for (let i = 0; i < fields.length; i++) {
    if (roles[i] != null) continue;
    const role = fallbackRole(fields[i]);
    if (!role) continue;
    if (role === 'new') {
      if (sawNew) {
        roles[i] = 'confirm';
      } else {
        roles[i] = 'new';
        sawNew = true;
      }
    } else {
      roles[i] = role; // 'confirm' | 'current'
    }
  }

  // Layer 3: structure, only still-unresolved fields.
  applyStructuralLayer(roles);

  return { kind: computeKind(roles), roles };
}

/**
 * Read one attribute off `field`, guarded the module's defensive style —
 * never throws on a field lacking `getAttribute` (a hand-built fake or a
 * stale reference). Never reads `.value`.
 * @param {any} field
 * @param {string} name
 * @returns {string | null}
 */
function readAttr(field, name) {
  return typeof field?.getAttribute === 'function' ? field.getAttribute(name) : null;
}

/**
 * @param {string | null} raw
 * @returns {number | null}
 */
function parseIntOrNull(raw) {
  if (raw == null) return null;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? null : n;
}

/**
 * @param {any} field
 * @returns {{ minLength: number|null, maxLength: number|null, passwordRules: string|null }}
 */
function readGenerateConstraints(field) {
  return {
    minLength: parseIntOrNull(readAttr(field, 'minlength')),
    maxLength: parseIntOrNull(readAttr(field, 'maxlength')),
    passwordRules: readAttr(field, 'passwordrules')
  };
}

/**
 * The Generate-in-picker gesture payload (Mission 21, Flight 4, Leg 3 —
 * generate-in-picker, DD5/AC6). `entries` is a `findAllLoginFields(doc)`-
 * shaped array (main world); `ordinal` is the index of the CLICKED password
 * field's OWN entry within it — every password field in a scope has its own
 * entry (DD2's "both fields carry the icon" is per-PASSWORD-FIELD, not
 * per-scope, so a 3-field change-password form has three entries, one per
 * field).
 *
 * Widens to the handle's scope (`loginScopeOrdinals`) and classifies it
 * (`classifyPasswordScope`). When the scope classifies `'classified'` with a
 * `new` role, returns `{ passwordRole: 'new', constraints }` where
 * `constraints` are read from the SCOPE's `new` field — regardless of which
 * field within the scope was actually clicked (choosing Generate from the
 * confirm field's icon still targets the scope's new+confirm pair, using the
 * new field's own length/`passwordrules` attributes). Every other outcome —
 * `sign-in`, `ambiguous`, no `new` role resolved, an out-of-range/invalid
 * ordinal, a non-array `entries` — returns
 * `{ passwordRole: null, constraints: null }`.
 *
 * Never throws (every attribute read is guarded); never reads a `.value`.
 * @param {any[]} entries
 * @param {number} ordinal
 * @returns {{ passwordRole: 'new' | null, constraints: { minLength: number|null, maxLength: number|null, passwordRules: string|null } | null }}
 */
function generateGestureInfo(entries, ordinal) {
  const scopeOrdinals = loginScopeOrdinals(entries, ordinal);
  if (scopeOrdinals.length === 0) return { passwordRole: null, constraints: null };
  const scopeFields = scopeOrdinals.map((i) => (entries[i] ? entries[i].password : null));
  const classification = classifyPasswordScope(scopeFields);
  if (classification.kind !== 'classified') return { passwordRole: null, constraints: null };
  const idxInScope = classification.roles.indexOf('new');
  if (idxInScope === -1) return { passwordRole: null, constraints: null };
  return { passwordRole: 'new', constraints: readGenerateConstraints(scopeFields[idxInScope]) };
}

module.exports = { loginScopeOrdinals, classifyPasswordScope, generateGestureInfo };
