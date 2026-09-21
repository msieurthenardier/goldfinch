'use strict';

// Pure PER-FAMILY CAPTURE PLANNER (Mission 21, Flight 3, Leg 6 —
// gesture-holds-every-family, LD2 — rewritten at design review, HIGH).
//
// THE PROBLEM THIS EXISTS TO SOLVE: before this leg, `onCaptureGesture`
// (`webview-preload.js`) resolved exactly ONE family per gesture and ran its
// whole per-family decision body inline, riddled with WHOLE-FUNCTION early
// returns written when one family was the only possibility that could ever
// reach them — `if (!entry) return`, a value-gate `if
// (!snapshotHasProvenancedSecret(...)) return`, and a `return` after each
// family's own `ipcRenderer.send`, all inside ONE shared `try/catch`. Once
// `resolveGestureTargets` (`vault-gesture-policy.js`) was widened to return a
// LIST of every resolving family, a naive "wrap `onCaptureGesture` in a
// per-family loop" fix would still contain every one of those early exits —
// and the FIRST family processed, or the FIRST to FAIL its own gate, would
// `return` out of the whole function and silently drop every family after
// it. That is the EXACT bug this leg exists to fix, reproduced on the
// headline combined-form scenario, and — because the resolver's own tests
// stay green regardless — no automated check would have caught it. The first
// design draft left this correctness argument to "read the preload source,
// since it cannot be `require()`d under `node --test`" — the same resignation
// Leg 2's design review rejected for the gesture-detach watch. This module is
// the fix: EVERY per-family decision (the entry existence check, the
// value-layer gate, the payload encoding, the watch-field list) moves OUT of
// `webview-preload.js` and into this plain, `require()`-able, unit-tested
// module, so the property "every resolving family is independently planned,
// regardless of another family's outcome or processing order" is UNIT-PROVEN
// (AC4) and NEUTER-VERIFIABLE (AC4b) — never left to a source read.
//
// `planCaptures({ resolved, entriesByKind, snapshot })` returns an array of
// `{ kind, channel, payload, watchFields }`, ONE entry per family that passes
// its OWN gate — order preserved from `resolved` (login, card, identity, per
// `resolveGestureTargets`' fixed determinism order). `onCaptureGesture` then
// shrinks to: resolve the list, read the snapshot ONCE, call this function,
// and loop over the result sending + arming — no per-family logic, no
// `return` that could hide a sibling family (AC4c).
//
// The per-kind lookup below fails CLOSED on an unrecognised `kind` — it is
// never planned, never a login default (Leg 4's `dispatchByFamily`
// fail-closed principle, applied here on the GUEST side, which Leg 4 left
// with an implicit login-shaped ternary — see `webview-preload.js`'s old
// `resolved.kind === 'card' ? ... : resolved.kind === 'identity' ? ... :
// logins[...]` shape, now gone).
//
// Deliberately NOT in `vault-gesture-policy.js`: that module's own header
// promises it "never reads a VALUE" (WHICH element, WHICH entry — never
// what's typed into it), and this module's whole job is encoding snapshot
// VALUES into a wire payload. Plain CJS, Electron-free (`TextEncoder` is a
// Node/browser global, not an Electron API) — `require()`-able under
// `node --test` exactly like `vault-gesture-policy.js` and
// `vault-gesture-detach-watch.js`.

const { IDENTITY_ROLES } = require('./vault-identity-fields');
const { snapshotHasProvenancedSecret } = require('./vault-gesture-policy');

/**
 * The submitted expiry as a single `MM/YY`-ish string, from the isolated
 * world's three-state snapshot fields (either the combined `cc-exp` field or
 * the split month/year pair). Returns '' when neither is present/provenanced
 * — main stores a null expiry rather than a fabricated one. Moved verbatim
 * out of `webview-preload.js`'s old `onCaptureGesture` (no behaviour change).
 * @param {any} entrySnapshot
 * @returns {string}
 */
function expiryFromSnapshot(entrySnapshot) {
  if (entrySnapshot.expiry && entrySnapshot.expiry.value) return String(entrySnapshot.expiry.value);
  const month = entrySnapshot.expMonth && entrySnapshot.expMonth.value ? String(entrySnapshot.expMonth.value) : '';
  const year = entrySnapshot.expYear && entrySnapshot.expYear.value ? String(entrySnapshot.expYear.value) : '';
  if (!month || !year) return '';
  return `${month.padStart(2, '0')}/${year}`;
}

/**
 * CARD's per-family plan step, moved verbatim (payload shape unchanged) from
 * the old `onCaptureGesture`'s card branch. Returns `null` when the family's
 * OWN value-layer gate fails — "this family is not planned", never a thrown
 * error and never a return out of anything shared.
 * @param {any} entry  the main-world detected entry (`cards[ordinal]`)
 * @param {any} entrySnapshot  the isolated-world three-state snapshot entry
 * @returns {{ kind: 'card', channel: string, payload: any, watchFields: any[] } | null}
 */
function planCard(entry, entrySnapshot) {
  if (!snapshotHasProvenancedSecret(entrySnapshot, 'card')) return null; // nothing worth holding
  const encoder = new TextEncoder();
  const cvvValue = entrySnapshot.csc && entrySnapshot.csc.value != null ? entrySnapshot.csc.value : '';
  const cardholder =
    entrySnapshot.cardholder && entrySnapshot.cardholder.value != null ? entrySnapshot.cardholder.value : '';
  return {
    kind: 'card',
    channel: 'guest-vault-capture-card',
    payload: {
      number: encoder.encode(String(entrySnapshot.number.value)),
      cvv: encoder.encode(String(cvvValue)),
      cardholder,
      expiry: expiryFromSnapshot(entrySnapshot)
    },
    watchFields: [entry.number, entry.cardholder, entry.expiry, entry.expMonth, entry.expYear, entry.csc]
  };
}

/**
 * IDENTITY's per-family plan step, moved verbatim from the old
 * `onCaptureGesture`'s identity branch. LD2 (flight): the ten secret identity
 * fields cross as ONE Uint8Array — the UTF-8 JSON of the ten secret role
 * values (every role but `fullName`, the one non-secret field, which crosses
 * as a plain string alongside it). Missing/unprovenanced fields encode as ''
 * — the SAME bucket `classifyCapture`'s own `isPresent` guard already treats
 * as absent.
 * @param {any} entry  the main-world detected entry (`identities[ordinal]`)
 * @param {any} entrySnapshot
 * @returns {{ kind: 'identity', channel: string, payload: any, watchFields: any[] } | null}
 */
function planIdentity(entry, entrySnapshot) {
  if (!snapshotHasProvenancedSecret(entrySnapshot, 'identity')) return null; // nothing worth holding
  const encoder = new TextEncoder();
  /** @type {any} */
  const secrets = {};
  for (const role of IDENTITY_ROLES) {
    if (role === 'fullName') continue;
    secrets[role] = entrySnapshot[role] && entrySnapshot[role].value != null ? String(entrySnapshot[role].value) : '';
  }
  const fullNameValue =
    entrySnapshot.fullName && entrySnapshot.fullName.value != null ? String(entrySnapshot.fullName.value) : '';
  return {
    kind: 'identity',
    channel: 'guest-vault-capture-identity',
    payload: {
      identitySecrets: encoder.encode(JSON.stringify(secrets)),
      fullName: fullNameValue
    },
    watchFields: IDENTITY_ROLES.map((role) => entry[role]).filter(Boolean)
  };
}

/**
 * LOGIN's per-family plan step, moved verbatim from the old
 * `onCaptureGesture`'s (else-branch, implicit login) body. DD3c's wire field:
 * `usernameDetected` is whether a username FIELD was detected at all (the
 * snapshot key's presence — DD3h's three-state shape), independent of
 * whether it carried provenance — `normUsername` would otherwise collapse
 * "detected but unprovenanced" into the SAME bucket as "never detected",
 * which is exactly the bucket DD3c forbids reaching the `update` branch.
 * @param {any} entry  the main-world detected entry (`logins[ordinal]`)
 * @param {any} entrySnapshot
 * @returns {{ kind: 'login', channel: string, payload: any, watchFields: any[] } | null}
 */
function planLogin(entry, entrySnapshot) {
  if (!snapshotHasProvenancedSecret(entrySnapshot, 'login')) return null; // nothing worth holding
  const usernameDetected = Object.prototype.hasOwnProperty.call(entrySnapshot, 'username');
  const usernameValue =
    entrySnapshot.username && entrySnapshot.username.value != null ? entrySnapshot.username.value : null;
  const passwordBytes = new TextEncoder().encode(String(entrySnapshot.password.value));
  return {
    kind: 'login',
    channel: 'guest-vault-capture',
    payload: { username: usernameValue, usernameDetected, password: passwordBytes },
    watchFields: [entry.username, entry.password]
  };
}

/** The per-kind lookup (LD2) — an unrecognised `kind` is never planned, never a login default. */
const PLANNERS = { login: planLogin, card: planCard, identity: planIdentity };

/** kind -> the isolated-world snapshot's own plural key. */
const SNAPSHOT_KEY = { login: 'logins', card: 'cards', identity: 'identities' };

/**
 * Plan EVERY resolving family's capture independently (AC3/AC4). `resolved`
 * is `resolveGestureTargets`' own return shape — an array of
 * `{ kind, ordinal }`. `entriesByKind` supplies the main-world detected
 * entries per family (`{ login: logins, card: cards, identity: identities }`
 * — the SAME arrays `resolveGestureTargets` was called with). `snapshot` is
 * the isolated world's three-state snapshot (`{ logins, cards, identities }`,
 * read ONCE by the caller). One family failing its own value-layer gate, or
 * being processed first, or last, NEVER affects any other family's outcome —
 * every family in `resolved` is looked up and planned independently, in
 * order; nothing here can `return` out of the others (AC4b neuter-verifies
 * this property directly).
 * @param {{
 *   resolved: Array<{ kind: 'login' | 'card' | 'identity', ordinal: number }>,
 *   entriesByKind: { login?: any[], card?: any[], identity?: any[] },
 *   snapshot: { logins?: any[], cards?: any[], identities?: any[] }
 * }} args
 * @returns {Array<{ kind: 'login' | 'card' | 'identity', channel: string, payload: any, watchFields: any[] }>}
 */
function planCaptures({ resolved, entriesByKind, snapshot }) {
  /** @type {Array<{ kind: 'login' | 'card' | 'identity', channel: string, payload: any, watchFields: any[] }>} */
  const plan = [];
  if (!Array.isArray(resolved)) return plan;

  for (const target of resolved) {
    if (!target || typeof target.kind !== 'string') continue;
    const planner = Object.prototype.hasOwnProperty.call(PLANNERS, target.kind) ? PLANNERS[target.kind] : null;
    if (!planner) continue; // unrecognised kind — fail closed, never planned

    const entries = entriesByKind && entriesByKind[target.kind];
    const entry = Array.isArray(entries) ? entries[target.ordinal] : undefined;
    if (!entry) continue; // the ordinal no longer resolves a real entry

    const snapshotKey = SNAPSHOT_KEY[target.kind];
    const snapshotEntries = snapshot && snapshot[snapshotKey];
    const entrySnapshot = Array.isArray(snapshotEntries) ? snapshotEntries[target.ordinal] : undefined;

    const planned = planner(entry, entrySnapshot);
    if (planned) plan.push(planned);
  }

  return plan;
}

module.exports = { planCaptures };
