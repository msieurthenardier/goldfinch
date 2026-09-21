// @ts-check
'use strict';

// Human fill orchestration — the chrome-facing operations behind the M12 F2
// `pick-and-fill` leg (DD5/DD6/DD9). Two ops sit between the chrome renderer's
// gesture→pick→fill state machine and the vault store / F1 fill delegate:
//
//   - reachableItems(wcId)  → the badged, origin-filtered, metadata-only picker
//     model for the tab (or [] for a burner / bad-URL / locked state).
//   - fillHuman({ wcId, vaultId, itemId }) → resolves the credential by (vaultId,
//     itemId) UNDER THE MRK (in main) and hands `{ wcId, credential }` to the F1
//     fill delegate — the password NEVER crosses back to chrome. Re-checks lock →
//     burner → cross-vault scope → exact-origin, in that order.
//
// SECURITY (leg core): the picker model + the activated selection are metadata /
// an index only. The password is read and dispatched ONLY here; it is never in the
// model, the selection, or either op's return value.
//
// ELECTRON-FREE / injected deps: every host handle — the vault-store singleton
// accessor, `webContents.fromId`, the registry tab-entry lookup, the jars list,
// and the F1 fill delegate — is injected, so the whole surface unit-tests
// headlessly with fakes + real `.gfvault` fixtures and NO Electron. It requires
// only the pure persist-jar gate.

const crypto = require('node:crypto');
// Fill matcher (M12 F4 Leg 4 / DD5): exact origin by default, widened to the
// registrable domain for a per-item `matchMode:'registrable-domain'` opt-in, fail-closed.
const { originMatches } = require('../../shared/origin-match');

const { resolvePersistJar } = require('../persist-jar-gate');
// Card capture (issue #152): the non-secret descriptors derived from a PAN, plus the
// plausibility gate that keeps an arbitrary submitted form value out of the vault.
const { isPlausibleCardNumber, brandForNumber, last4Of, titleForNumber, digitsOf } = require('./card-identity');
// Identity fill (M21 F3 Leg 3, DD7) + capture (M21 F3 Leg 4, DD10): the eleven
// role-field names, single-sourced via `identity-profile.js`'s own derived union
// (never re-typed here); `identityProfileOf`/`classifyCapture` are LD6/DD10's own
// wiring — reused here, never reimplemented (both had no caller before this leg).
const { IDENTITY_FIELDS, identityProfileOf, classifyCapture } = require('./identity-profile');

// DD6: the field LABELS an identity offer names — never a value (ten of eleven
// identity fields are declared secret in vault-item-schema.js). Mirrors, and must
// be kept in sync with, src/shared/vault-editor-model.js's EDITOR_LAYOUT.identity
// labels — the only other place the operator sees these field names spelled out.
// vault-human.js stays main-only CJS and that file is a real ES module served to
// the vault page, so the pairing is manual here rather than a shared import.
const IDENTITY_FIELD_LABELS = {
  fullName: 'Full name',
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  phone: 'Phone',
  street: 'Street address',
  street2: 'Street address 2',
  city: 'City',
  region: 'State / Region',
  country: 'Country',
  postalCode: 'Postal code'
};

/**
 * Field names -> human-readable LABELS (DD6) — never a value. An unrecognised
 * field name (should never happen; defensive) falls back to itself.
 * @param {string[]} fields
 * @returns {string[]}
 */
function labelsFor(fields) {
  return fields.map((f) => IDENTITY_FIELD_LABELS[f] || f);
}

// The held captured-credential record's safety-drop timeout (Leg 4): if neither a
// save nor a dismiss resolves the offer, the record is zeroized+dropped after this
// window so no captured password lingers. Armed via the INJECTED setTimeout so the
// timeout is unit-testable with no wall-clock wait (mirrors vault-store's idle timer).
const CAPTURE_DROP_MS = 2 * 60 * 1000;

/**
 * Normalize a username for the capture read + the existence match: an empty string
 * and null/undefined both collapse to null, so a password-only submit and a stored
 * null-username item compare equal (and a `'' !== null` mismatch never splits them).
 * @param {any} u
 * @returns {string | null}
 */
function normUsername(u) {
  return u === '' || u == null ? null : u;
}

/**
 * The safe origin of a URL string, or null if it does not parse. `originOf` is
 * NOT exported from vault-context.js, so this is a local null-safe helper (a bad
 * / empty URL throws in `new URL` — mapped to null).
 * @param {string} url
 * @returns {string | null}
 */
function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * The supersession FAMILY of a capture record (M21 F3 Leg 2's DD1 amendment,
 * made THREE-WAY and FAIL-CLOSED at Leg 4 / LD1): 'card' when `rec.kind ===
 * 'card'`, 'identity' when `rec.kind === 'identity'` (the shapes `holdGestureCard`/
 * `captureCard` and `holdGestureIdentity`/`captureIdentity` stamp on every record
 * they create), 'login' when `kind` is ABSENT (every login-creating site —
 * `capture`, `holdGestureLogin` — omits it), and `null` for anything else —
 * including a stray `'constructor'`/`''`/unrecognised string. This is the ONE
 * predicate every supersession loop below uses instead of a bare `rec.wcId ===
 * wcId` (a family-blind loop is what made a card release zeroize a sibling
 * pending login record, or vice versa, in the SAME synchronous pass, defeating
 * multi-hold — DD1's own citation: `capture`/`captureCard`/`captureIdentity` have
 * no callers anywhere in `src/` outside `captureRelease`, so `captureRelease`'s
 * own re-entry into any of them was the live path this broke) — and it is what
 * `dispatchByFamily` below uses to refuse an unrecognised kind rather than
 * silently defaulting it to login (LD1's central finding: every capture-side
 * dispatch was binary with login as the else-branch).
 * @param {any} rec
 * @returns {'login' | 'card' | 'identity' | null}
 */
function familyOf(rec) {
  // ABSENT (the key genuinely does not exist — `undefined`) is 'login'; a
  // rec-less call also falls here (best-effort, matching the pre-Leg-4
  // fallback). An EXPLICIT `null` (or any other non-string) is NOT "absent" —
  // it falls through to the fail-closed `null` below (AC1's own distinction).
  const kind = rec ? rec.kind : undefined;
  if (kind === undefined) return 'login';
  if (kind === 'card') return 'card';
  if (kind === 'identity') return 'identity';
  return null;
}

/**
 * The sentinel `dispatchByFamily` returns when `familyOf(rec)` is `null` — an
 * unrecognised `kind`. Frozen, exported alongside `dispatchByFamily`/`familyOf`
 * so a test can identify it by reference rather than shape. Unreachable in
 * production today (no public constructor produces an unrecognised `kind`),
 * which is exactly why LD1 pins the refusal here rather than assuming it.
 */
const FAMILY_REFUSED = Object.freeze({ familyRefused: true });

/**
 * LD1's ONE exported family dispatch helper — the sole main-side dispatch point
 * for `captureRelease`/`captureFinalize`/`captureSave`. Resolves `rec`'s family
 * via `familyOf` and invokes exactly the matching handler; an unrecognised family
 * invokes NO handler and returns `FAMILY_REFUSED` — never a login fallback. A
 * pure function: it neither drops nor mutates `rec` itself — each call site maps
 * `FAMILY_REFUSED` to its OWN existing "record is gone" behaviour, dropping and
 * zeroizing the record itself (LD1's per-site mapping).
 * @param {any} rec
 * @param {{ login: (rec: any) => any, card: (rec: any) => any, identity: (rec: any) => any }} handlers
 * @returns {any}
 */
function dispatchByFamily(rec, { login, card, identity }) {
  const family = familyOf(rec);
  if (family === 'login') return login(rec);
  if (family === 'card') return card(rec);
  if (family === 'identity') return identity(rec);
  return FAMILY_REFUSED;
}

/**
 * @typedef {Object} VaultHumanDeps
 * @property {() => any} getVaultStore  the memoized vault-store singleton accessor.
 * @property {(wcId: number) => any} fromId  webContents.fromId — resolve a tab's live wc.
 * @property {(wcId: number) => ({ partition: string, trusted: boolean } | null | undefined)} getTabEntry
 *   resolve the registry tab entry for a wcId (partition + trusted); null/undefined when absent.
 * @property {() => Array<{ id: string, partition: string }>} listJars  the persistent jars snapshot.
 * @property {(arg: { wcId: number, credential: { username: any, password: any } }) => void} fillDelegate
 *   the F1 main→preload fill effect (main.js `webContents.fromId(wcId)?.send('vault-fill', credential)`).
 * @property {(arg: { wcId: number, card: { number: any, cardholder: any, expiry: any, cvv: any } }) => void} [fillCardDelegate]
 *   the CARD main→preload fill effect (issue #152 — `send('vault-fill-card', card)`). A
 *   SEPARATE channel from `fillDelegate` because the two land on different DOM anchors
 *   guest-side. Optional: an omitted injection refuses card fills outright (`ineligible`)
 *   rather than silently dropping them, so offline fixtures stay honest.
 * @property {(arg: { wcId: number, identity: any }) => void} [fillIdentityDelegate]
 *   the IDENTITY main→preload fill effect (M21 F3 Leg 3, DD7/AC19 —
 *   `send('vault-fill-identity', identity)`). Same optional-refuses-rather-than-
 *   drops shape as `fillCardDelegate`.
 * @property {(fn: () => void, ms: number) => any} [setTimeout]  capture drop-timer arm (default global) — injected so the timeout is unit-testable.
 * @property {(handle: any) => void} [clearTimeout]  capture drop-timer clear (default global).
 * @property {() => number} [now]  clock (default Date.now) — the record's capturedAt stamp.
 * @property {(chromeId: number) => number[]} [tabWcIdsForChrome]  Leg 1 (capture-hold-safety):
 *   resolve a WINDOW's (chrome-id-keyed) owned tab wcIds, so `dropCapturesForWindow` can match
 *   this module's tab-keyed `captures` against a chrome id. vault-human.js is Electron-free and
 *   has no registry access, so the chromeId→wcIds lookup is injected rather than reached for
 *   (main.js: `webContents.fromId(chromeId)` → `registry.getWindowForChrome(wc)` →
 *   `[...rec.tabViews.keys()]`, null-safe at every hop). An omitted dep resolves no tabs.
 * @property {(event: string, detail: any) => void} [trace]  M21 F3 Leg 4, LD9 — an OPTIONAL
 *   diagnostic trace (no-op default; this module is Electron-free and cannot reach console/env
 *   itself). `main.js` wires the real one behind the same `GOLDFINCH_VAULT_TRACE` gate
 *   `register-browser-ipc.js`'s own `vaultTrace` uses, with the same `[vault-capture]` prefix.
 *   `detail` must carry vault ids/counts only — NEVER a field value (LD9's duplicate-profile
 *   refusal trace is the sole caller today).
 */

/**
 * A held captured-credential record — lives in MAIN only, keyed by captureId, from
 * `capture()` until save / dismiss / supersession / timeout. The password is a
 * zeroizable Buffer; it NEVER travels to chrome or the sheet (the offer model + the
 * save invoke carry only origin / username / vaultId).
 * @typedef {Object} CaptureRecord
 * @property {string} captureId
 * @property {number} wcId  the owning tab (for last-wins-per-tab supersession).
 * @property {'login' | 'card' | 'identity'} [kind]  the item family (issue #152; identity
 *   M21 F3 Leg 4); absent = 'login', so every pre-card record shape is unchanged.
 * @property {string} origin  derived in main from the sender URL (never guest-supplied),
 *   FROZEN at capture/hold time — never re-derived at settle (Leg 5 Edge Case).
 * @property {string | null} username
 * @property {boolean} [usernameDetected]  Leg 5 / DD3c: a username FIELD was detected on the
 *   page, independent of whether it carried operator provenance (`username` can be `null`
 *   either because no field was detected at all, or because one was detected but
 *   unprovenanced — this flag is what tells the two apart). Absent/false for every pre-Leg-5
 *   caller, so the DD3c downgrade never fires for them (existing behaviour unchanged).
 * @property {Buffer} password
 * @property {Buffer} [number]  card only — the PAN, zeroized by dropCapture.
 * @property {Buffer} [cvv]  card only — the security code, zeroized by dropCapture.
 * @property {string | null} [cardholder]  card only (non-secret).
 * @property {string | null} [expiry]  card only.
 * @property {string | null} [brand]  card only — derived from the PAN (non-secret).
 * @property {string | null} [last4]  card only — derived from the PAN (non-secret).
 * @property {Buffer} [identitySecrets]  identity only (M21 F3 Leg 4, LD2) — the ten secret
 *   identity fields, as ONE Buffer holding the UTF-8 JSON `capture()` decodes transiently at
 *   dispose/save time. Zeroized by `dropCapture` (LD7 — every own Buffer, not a named list).
 * @property {string | null} [fullName]  identity only — the one non-secret identity field.
 * @property {string[]} [identityGapFilled]  identity only, stamped by `disposeIdentityCapture` —
 *   exactly the field names `classifyCapture` found as gaps, consumed by LD8's write set.
 * @property {string[]} [identityConflicting]  identity only — exactly the field names
 *   `classifyCapture` found as conflicts, consumed by LD8's write set.
 * @property {string} jarId  the tab's persistent jar id (fixed at capture; disposition uses it).
 * @property {'save' | 'update' | 'locked' | 'pending-settle'} mode  'locked' = held pending an
 *   unlock; the save/update disposition is deferred to `captureFinalize` (it needs the vault
 *   unlocked). 'pending-settle' (Leg 5, DD4/DD5) = held pending a navigation-commit or
 *   field-detachment settle signal; NOT YET disposed/offered at all — distinct from 'locked',
 *   which HAS been disposed (a settle already released it) but needs an unlock before the
 *   disposition can be computed. `captureRelease` is the only transition out of this mode.
 * @property {string} [vaultId]  update: the existing item's fixed vault.
 * @property {string} [itemId]  update: the existing item's fixed id.
 * @property {string[]} choices  save: the selectable vault ids ([jar.id, 'global']).
 * @property {any} timer  the injected drop-timer handle.
 * @property {number} capturedAt
 */

/**
 * @param {VaultHumanDeps} deps
 */
function createVaultHuman(deps) {
  const _setTimeout = deps.setTimeout ?? setTimeout;
  const _clearTimeout = deps.clearTimeout ?? clearTimeout;
  const _now = deps.now ?? Date.now;
  // LD9: an optional diagnostic trace — no-op by default (this module is
  // Electron-free and cannot reach console/env itself). `main.js` wires the real
  // one behind the same GOLDFINCH_VAULT_TRACE gate register-browser-ipc.js's own
  // vaultTrace uses. `detail` must carry vault ids/counts only — never a field
  // value (LD9's own refusal-tracing rule).
  const _trace = typeof deps.trace === 'function' ? deps.trace : () => {};

  // The held captured-credential records (Leg 4). Keyed by captureId; each holds the
  // password as a zeroizable Buffer that is dropped on save / dismiss / supersession
  // / timeout. Never leaves main.
  /** @type {Map<string, CaptureRecord>} */
  const captures = new Map();

  /**
   * Zeroize a record's password Buffer, clear its drop timer, and evict it from the
   * map. Idempotent (a missing / already-dropped record is a no-op) — every exit path
   * funnels through here so no captured password lingers.
   * @param {string} captureId
   */
  function dropCapture(captureId) {
    const rec = captures.get(captureId);
    if (!rec) return;
    captures.delete(captureId);
    if (rec.timer != null) _clearTimeout(rec.timer);
    // LD7 (M21 F3 Leg 4, design review HIGH/SECURITY): zeroize EVERY own
    // Buffer-valued field on the record — never a named list. The prior
    // ['password', 'number', 'cvv'] list, under a comment reading "a new secret
    // field MUST be added here or it outlives the record", is EXACTLY the defect
    // class this retires: a new `rec.identitySecrets` Buffer would silently have
    // outlived every lock/tab-close/window-close/TTL. Every Buffer a capture
    // record ever holds is secret by construction (a non-secret field is always
    // a string) and `rec.timer` is a Node Timeout, which `Buffer.isBuffer`
    // rejects — so this is a strict superset of the three names it replaces,
    // plus `identitySecrets`, plus any future secret field, with NO edit
    // required here ever again.
    for (const value of Object.values(rec)) {
      if (Buffer.isBuffer(value)) value.fill(0);
    }
  }

  /**
   * TEST-ONLY seam (LD1/AC2b): insert `rec` directly into the private `captures`
   * Map, keyed by its own `captureId`. No production caller can construct a
   * record whose `kind` is not one of the three known families — that is exactly
   * why AC1/AC2's fail-closed pins need this seam to exercise a real
   * `captureRelease`/`captureFinalize`/`captureSave` call end to end against a
   * `{ kind: 'bogus' }` record. Never called by production code; mirrors the
   * underscore-prefixed test-only introspection already precedented in
   * vault-entry-observer.js. Returns nothing — never hands back the live Map.
   * @param {any} rec
   */
  function _seedCaptureForTest(rec) {
    captures.set(rec.captureId, rec);
  }

  /**
   * Resolve a tab's persistent jar (null for a burner / non-persistent / closed
   * tab). The trusted registry idiom — never renderer-supplied partition data.
   * @param {number} wcId
   * @returns {{ id: string, partition: string } | null}
   */
  function tabJarFor(wcId) {
    const entry = deps.getTabEntry(wcId);
    if (!entry) return null;
    return resolvePersistJar(entry, deps.listJars()) || null;
  }

  /**
   * The tab's exact origin, or null (closed tab / bad URL).
   * @param {number} wcId
   * @returns {string | null}
   */
  function tabOriginFor(wcId) {
    const wc = deps.fromId(wcId);
    if (!wc) return null;
    const url = typeof wc.getURL === 'function' ? wc.getURL() : '';
    return originOf(url || '');
  }

  /**
   * The picker model for the tab: the badged, metadata-only reachable items, LOGINS
   * FIRST, then CARDS (issue #152), then IDENTITY (M21 F3 Leg 3, DD7). `[]` for a
   * burner (no persistent jar), a bad/empty URL, or a locked/uncreated vault — all
   * three reachable reads are themselves `[]`-safe.
   *
   * The families are gathered by DIFFERENT rules and that asymmetry is deliberate:
   * logins are ORIGIN-FILTERED (a credential belongs to its site), cards and
   * identity are not (a card belongs to the operator and is used at any merchant —
   * see `reachableCardItems`; a person's own name/address belongs to the operator
   * too — see `reachableIdentityItems`). Each row is stamped with its `type` HERE,
   * at the merge point, rather than inside the store: the login row's key set is
   * pinned as a metadata-only guard by vault-store-reachable.test.js, and this is
   * presentation routing for the unified picker, not vault metadata.
   * @param {number} wcId
   * @returns {Array<any>}
   */
  function reachableItems(wcId) {
    const origin = tabOriginFor(wcId);
    if (!origin) return [];
    const jar = tabJarFor(wcId);
    if (!jar) return []; // burner / non-persistent — no reachable items (DD9).
    const store = deps.getVaultStore();
    // Picker path WIDENS (M12 F4 Leg 4 / DD5): a `matchMode:'registrable-domain'` item
    // surfaces on a hardened-matched subdomain, badged via the row's `widened` flag.
    const logins = store
      .reachableLoginItems(jar.id, origin, { widen: true })
      .map((/** @type {any} */ row) => ({ ...row, type: 'login' }));
    const cards =
      typeof store.reachableCardItems === 'function'
        ? store.reachableCardItems(jar.id).map((/** @type {any} */ row) => ({ ...row, type: 'card' }))
        : [];
    const identities =
      typeof store.reachableIdentityItems === 'function'
        ? store.reachableIdentityItems(jar.id).map((/** @type {any} */ row) => ({ ...row, type: 'identity' }))
        : [];
    return logins.concat(cards, identities);
  }

  /**
   * Dispatch the chosen credential through F1's `vault-fill` channel. Re-checks, in
   * ORDER (DD6/DD9): (1) locked; (2) burner → ineligible BEFORE the scope assert
   * (so a `vaultId:'global'` can never fill a burner tab); (3) cross-vault scope
   * (`vaultId ∈ { 'global', tabJar.id }`); (4) resolve the item; (5) TYPE-DISPATCH on
   * the STORED item's own `type` (issue #152; identity M21 F3 Leg 3, DD7) — a
   * `card` or an `identity` skips the origin check by design and rides
   * `fillCardDelegate` / `fillIdentityDelegate` respectively; a `login` takes the
   * exact/widened origin check and rides `fillDelegate`; any other type is
   * refused. Any refusal returns `{ filled: false, reason }` and does NOT call
   * any fill delegate. On success the
   * credential is built + consumed HERE and `{ filled: true }` (no secret) is
   * returned.
   * @param {{ wcId: number, vaultId: string, itemId: string }} sel
   * @returns {{ filled: boolean, reason?: string }}
   */
  function fillHuman({ wcId, vaultId, itemId }) {
    const store = deps.getVaultStore();

    // (1) locked (covers a lock BETWEEN pick and fill — DD6: re-prompt, don't error).
    if (!store.isUnlocked()) return { filled: false, reason: 'locked' };

    const tabOrigin = tabOriginFor(wcId);
    const tabJar = tabJarFor(wcId);

    // (2) burner / non-persistent → ineligible, BEFORE the scope assert (DD9): a
    // 'global' vaultId must never fill a burner tab. `_resolveTarget` does NOT catch
    // this — it admits any persistent jar and 'global'.
    if (!tabJar) return { filled: false, reason: 'ineligible' };

    // (3) cross-vault scope re-check: only the tab's own jar or the global vault.
    if (vaultId !== 'global' && vaultId !== tabJar.id) {
      return { filled: false, reason: 'out-of-scope' };
    }

    // (4) resolve the item by id under the MRK; a lock race here surfaces as locked.
    let item;
    try {
      item = store.listItems(vaultId).find((/** @type {any} */ i) => i.id === itemId);
    } catch (err) {
      if (err && /** @type {any} */ (err).name === 'VaultLockedError') {
        return { filled: false, reason: 'locked' };
      }
      throw err;
    }
    if (!item) return { filled: false, reason: 'origin-mismatch' };

    // (5) TYPE-DISPATCH (issue #152; identity M21 F3 Leg 3, DD7). The branch is
    // chosen by the STORED ITEM's own `type` — never by anything the guest, the
    // page, or the chrome supplied — so a hostile page cannot steer a login
    // request onto either un-origin-gated path. Fill payloads go out over
    // DIFFERENT channels because they land on different DOM anchors guest-side.
    if (item.type === 'card') {
      // Cards are NOT origin-gated (see reachableCardItems for the full reasoning): a
      // payment card belongs to the operator, not to a site. Every other gate above —
      // unlocked, persistent jar, jar scope — has already run, and the fill still
      // requires the explicit per-fill operator selection that got us here.
      if (!deps.fillCardDelegate) return { filled: false, reason: 'ineligible' };
      deps.fillCardDelegate({
        wcId,
        card: {
          number: item.number,
          cardholder: item.cardholder,
          expiry: item.expiry,
          cvv: item.cvv
        }
      });
      return { filled: true };
    }

    if (item.type === 'identity') {
      // Identity is NOT origin-gated either (DD7 — the card precedent): a
      // person's own name and address belong to the operator, not to a site.
      // Every other gate above — unlocked, persistent jar, jar scope — has
      // already run.
      if (!deps.fillIdentityDelegate) return { filled: false, reason: 'ineligible' };
      /** @type {any} */
      const identity = {};
      for (const field of IDENTITY_FIELDS) identity[field] = item[field];
      deps.fillIdentityDelegate({ wcId, identity });
      return { filled: true };
    }

    // Origin match — exact by default, widened to the registrable domain for a
    // `matchMode:'registrable-domain'` item behind the fail-closed matcher (M12 F4 Leg 4
    // / DD5). The picker only offers rows that already matched, but re-checking here
    // (with the same widen) keeps the fill gate the authoritative boundary.
    if (item.type !== 'login' || !tabOrigin || !originMatches(item, tabOrigin, { widen: true })) {
      return { filled: false, reason: 'origin-mismatch' };
    }

    // Build + consume the credential HERE (in main) — never returned to chrome.
    deps.fillDelegate({ wcId, credential: { username: item.username, password: item.password } });
    return { filled: true };
  }

  /**
   * Capture a freshly-submitted credential and, when the manager is set up + unlocked
   * and the tab is a persistent jar, hold it in a main-side record and return the
   * chrome-owned save/update offer model. The password is copied into a zeroizable
   * Buffer HERE and the incoming array is wiped; the returned model carries NO
   * password (only origin / username / mode / defaultVaultId / choices). Origin is
   * derived in main from the sender URL — a guest-supplied origin is never trusted.
   *
   * GATE (DD7/DD9): drops (returns null — no offer) unless
   * `isSetUp() && isUnlocked() && a persistent jar`. Last-wins-per-tab: an existing
   * record for the same `wcId` is evicted+zeroized BEFORE the new one is stored.
   * DISPOSITION: an exact origin+username match in {active jar, global} (via
   * `reachableLoginItems`) → `update` targeting that item's fixed `{ vaultId, itemId }`
   * (PREFERRING the active-jar copy over global on a username tie — global is iterated
   * first); else `save` (defaultVaultId = the tab's jar, choices = [jar.id, 'global']).
   * @param {{ wcId: number, username: any, passwordBytes: any }} arg
   * @returns {{ captureId: string, model: { origin: string, username: string|null, mode: 'save'|'update', defaultVaultId: string, choices: string[] } } | null}
   */
  /**
   * Compute the save/update disposition for a held record against the NOW-UNLOCKED vault,
   * mutating the record (mode / choices / vaultId / itemId) and returning the sheet model.
   * Shared by the immediate (already-unlocked) `capture` path and the deferred
   * `captureFinalize` (after an unlock-to-save). Prefers an active-jar username match over a
   * global one on a tie (reachableLoginItems iterates global FIRST, so a naive .find would
   * target global). REQUIRES the vault unlocked (reachableLoginItems reads it).
   * @param {CaptureRecord} rec
   * @returns {{ origin: string, username: string|null, mode: 'save'|'update', defaultVaultId: string, choices: string[] } | null}
   *   the save/update sheet model, or null when the login is UNCHANGED (no offer).
   */
  function disposeCapture(rec) {
    const store = deps.getVaultStore();
    const reachable = store.reachableLoginItems(rec.jarId, rec.origin);
    const jarMatch = reachable.find(
      (/** @type {any} */ r) => r.vaultId === rec.jarId && normUsername(r.username) === rec.username
    );
    const globalMatch = reachable.find(
      (/** @type {any} */ r) => r.vaultId === 'global' && normUsername(r.username) === rec.username
    );
    const match = jarMatch || globalMatch;
    if (match) {
      // NO-OP GUARD: reachableLoginItems matches on origin + username only (it is
      // metadata-only — no password), so an UNCHANGED login (same username AND same
      // password already stored for this origin) would otherwise offer a pointless
      // "update". Read the full stored item (listItems includes the password; the vault
      // is unlocked here) and compare the submitted password — if identical, there is
      // nothing to update, so drop the offer entirely.
      const existing = store.listItems(match.vaultId).find((/** @type {any} */ i) => i.id === match.id);
      if (existing && existing.password === rec.password.toString('utf8')) {
        return null; // unchanged credential → no offer
      }
      rec.mode = 'update';
      rec.vaultId = match.vaultId;
      rec.itemId = match.id;
      rec.choices = [];
      return { origin: rec.origin, username: rec.username, mode: 'update', defaultVaultId: match.vaultId, choices: [] };
    }
    rec.mode = 'save';
    rec.choices = [rec.jarId, 'global'];
    return {
      origin: rec.origin,
      username: rec.username,
      mode: 'save',
      defaultVaultId: rec.jarId,
      choices: [rec.jarId, 'global']
    };
  }

  /**
   * DD3c: downgrade a computed `'update'` disposition to `'save'` when the username was
   * DETECTED but UNPROVENANCED — `rec.usernameDetected === true` and `rec.username == null`
   * (the `normUsername` collapse of `''`/`null`/`undefined`, which is exactly the bucket a
   * page could otherwise steer into a false match by suppressing provenance on a real
   * username field). Never applied when no username field was detected at all
   * (`usernameDetected !== true`) — that case's existing null-username matching behaviour is
   * unchanged, per DD3c's own carve-out. Applied AFTER `disposeCapture`, which stays
   * unmodified (DD3b) — this never touches its logic or its no-op/unchanged guard.
   * @param {CaptureRecord} rec
   * @param {{ origin: string, username: string|null, mode: 'save'|'update', defaultVaultId: string, choices: string[] } | null} model
   * @returns {{ origin: string, username: string|null, mode: 'save'|'update', defaultVaultId: string, choices: string[] } | null}
   */
  function applyUsernameDowngrade(rec, model) {
    if (!model || model.mode !== 'update') return model;
    if (rec.username != null || rec.usernameDetected !== true) return model;
    rec.mode = 'save';
    rec.vaultId = undefined;
    rec.itemId = undefined;
    rec.choices = [rec.jarId, 'global'];
    return {
      origin: rec.origin,
      username: rec.username,
      mode: 'save',
      defaultVaultId: rec.jarId,
      choices: [rec.jarId, 'global']
    };
  }

  /**
   * Gate + hold + (when unlocked) dispose a login credential. `origin`/`jar` are normally
   * DERIVED HERE from the tab's CURRENT state — the shape every pre-Leg-5 call site (direct,
   * immediate capture) still relies on unmodified. Leg 5's gesture-release path (below) is
   * the ONE caller that supplies `origin`/`jar` EXPLICITLY, frozen at gesture time, to avoid
   * re-deriving them from a tab that may have already navigated by the time settle calls
   * this (Edge Case: "the capture's origin is main-derived at capture time, never re-derived
   * at settle") — an explicit override always wins over a fresh derive.
   * `usernameDetected` (Leg 5, DD3c) is threaded onto the record and consulted by
   * `applyUsernameDowngrade` after disposition; omitted (every pre-Leg-5 caller) defaults to
   * `false`, so the downgrade never fires and existing null-username matching behaviour for
   * those callers is unchanged.
   * @param {{ wcId: number, username: any, passwordBytes: any, usernameDetected?: boolean, origin?: string|null, jar?: {id: string}|null }} arg
   * @returns {{ captureId: string, model: { origin: string, username: string|null, mode: 'save'|'update'|'locked', defaultVaultId?: string, choices?: string[] } } | null}
   */
  function capture({ wcId, username, passwordBytes, usernameDetected, origin: originOverride, jar: jarOverride }) {
    const store = deps.getVaultStore();

    // GATE — set up AND a persistent jar (DD9) AND an origin. Unlocked is NO LONGER required:
    // a LOCKED vault now HOLDS the credential and asks the chrome to prompt an unlock first,
    // then saves (mode 'locked'). Not-set-up / no-jar / no-origin still drop with no offer.
    // A miss wipes the incoming bytes below.
    const bytes = passwordBytes instanceof Uint8Array ? passwordBytes : null;
    const origin = originOverride !== undefined ? originOverride : tabOriginFor(wcId);
    const jar = jarOverride !== undefined ? jarOverride : tabJarFor(wcId);
    if (!store.isSetUp() || !jar || !origin) {
      if (bytes) bytes.fill(0);
      return null;
    }

    // Supersession: evict+zeroize any prior LOGIN record for this SAME tab first, so a
    // rapid re-submit is true last-wins and never leaves an orphan record holding a
    // password. Family-scoped (M21 F3 L2, DD1's amendment) — a card hold for the same
    // tab is a DIFFERENT family and survives untouched (`familyOf`).
    for (const [id, rec] of captures) {
      if (rec.wcId === wcId && familyOf(rec) === 'login') dropCapture(id);
    }

    const normUser = normUsername(username);
    const captureId = crypto.randomBytes(12).toString('hex');
    const password = bytes ? Buffer.from(bytes) : Buffer.alloc(0);
    if (bytes) bytes.fill(0); // the incoming deserialized array is a separate allocation.

    /** @type {CaptureRecord} */
    const rec = {
      captureId,
      wcId,
      origin,
      username: normUser,
      usernameDetected: usernameDetected === true,
      password,
      jarId: jar.id,
      mode: 'save', // provisional — set by disposeCapture (unlocked) or 'locked' below.
      choices: [],
      timer: null,
      capturedAt: _now()
    };
    rec.timer = _setTimeout(() => dropCapture(captureId), CAPTURE_DROP_MS);
    if (rec.timer && typeof rec.timer.unref === 'function') rec.timer.unref();
    captures.set(captureId, rec);

    // LOCKED: hold the credential and ask the chrome to raise an unlock prompt first. The
    // save/update disposition needs the vault unlocked, so it is deferred to captureFinalize
    // (called by the chrome after a successful unlock).
    if (!store.isUnlocked()) {
      rec.mode = 'locked';
      return { captureId, model: { origin, username: normUser, mode: /** @type {'locked'} */ ('locked') } };
    }

    // UNLOCKED: compute the disposition now, applying DD3c's post-dispose downgrade. An
    // UNCHANGED login (disposeCapture → null) has nothing to save — drop the held record and
    // make no offer.
    const model = applyUsernameDowngrade(rec, disposeCapture(rec));
    if (!model) {
      dropCapture(captureId);
      return null;
    }
    return { captureId, model };
  }

  /**
   * Hold a GESTURE-TIME login read, pending SETTLE (Leg 5 — DD3f corrected at design
   * review, DD4, DD5-extended). The isolated-world snapshot is read at GESTURE time (a
   * same-process `webFrame` call, never a cross-process
   * `webContents.executeJavaScriptInIsolatedWorld`) and arrives here as plain data; this
   * function's ONLY job is to survive, unmolested, from that moment until settle — a
   * navigation commit or a preload-reported field detachment — calls `captureRelease`.
   *
   * `origin` AND `jar` are resolved HERE, at gesture time, and FROZEN on the record.
   * `captureRelease` never re-derives either: by the time a navigation-commit settle fires,
   * the tab may already be showing a different origin (`did-navigate` fires AFTER commit),
   * and re-deriving would silently attribute the capture to the WRONG site (Edge Case: "the
   * capture's origin is main-derived at capture time, never re-derived at settle").
   *
   * Same gate as `capture()` (set up + persistent jar + origin), same last-wins-per-tab
   * supersession (a second gesture on the same tab, pending or already-disposed, is
   * evicted+zeroized first), and the SAME `captures` map + `dropCapture` choke point — so
   * this new held state needs NO new drop-rule wiring: Leg 1's three bulk-drop functions
   * (vault lock / window close / tab close) and the existing TTL timer already cover it,
   * because it is never a second, parallel hold structure.
   * @param {{ wcId: number, username: any, usernameDetected: boolean, passwordBytes: any }} arg
   * @returns {{ captureId: string } | null}
   */
  function holdGestureLogin({ wcId, username, usernameDetected, passwordBytes }) {
    const store = deps.getVaultStore();
    const bytes = passwordBytes instanceof Uint8Array ? passwordBytes : null;
    const origin = tabOriginFor(wcId);
    const jar = tabJarFor(wcId);
    if (!store.isSetUp() || !jar || !origin || !bytes) {
      if (bytes) bytes.fill(0);
      return null;
    }

    // Family-scoped supersession (M21 F3 L2, DD1's amendment): only a PRIOR LOGIN hold
    // for this tab is evicted — a pending CARD hold survives untouched.
    for (const [id, rec] of captures) {
      if (rec.wcId === wcId && familyOf(rec) === 'login') dropCapture(id);
    }

    const captureId = crypto.randomBytes(12).toString('hex');
    const password = Buffer.from(bytes);
    bytes.fill(0);

    /** @type {CaptureRecord} */
    const rec = {
      captureId,
      wcId,
      origin,
      username: normUsername(username),
      usernameDetected: usernameDetected === true,
      password,
      jarId: jar.id,
      mode: 'pending-settle',
      choices: [],
      timer: null,
      capturedAt: _now()
    };
    rec.timer = _setTimeout(() => dropCapture(captureId), CAPTURE_DROP_MS);
    if (rec.timer && typeof rec.timer.unref === 'function') rec.timer.unref();
    captures.set(captureId, rec);
    return { captureId };
  }

  /**
   * Hold a GESTURE-TIME card read, pending SETTLE — the card twin of `holdGestureLogin`.
   * No plausibility (Luhn) gate here: `captureRelease` runs the held read back through
   * `captureCard`, which still applies it before anything is offered — holding an
   * implausible read for up to `CAPTURE_DROP_MS` costs nothing security-relevant (it is
   * dropped, never offered, same as any other gesture that leads nowhere).
   * @param {{ wcId: number, numberBytes: any, cvvBytes: any, cardholder?: any, expiry?: any }} arg
   * @returns {{ captureId: string } | null}
   */
  function holdGestureCard({ wcId, numberBytes, cvvBytes, cardholder, expiry }) {
    const store = deps.getVaultStore();
    const numBytes = numberBytes instanceof Uint8Array ? numberBytes : null;
    const cvcBytes = cvvBytes instanceof Uint8Array ? cvvBytes : null;
    const wipe = () => {
      if (numBytes) numBytes.fill(0);
      if (cvcBytes) cvcBytes.fill(0);
    };

    const origin = tabOriginFor(wcId);
    const jar = tabJarFor(wcId);
    if (!store.isSetUp() || !jar || !origin || !numBytes) {
      wipe();
      return null;
    }

    // Family-scoped supersession (M21 F3 L2, DD1's amendment): only a PRIOR CARD hold
    // for this tab is evicted — a pending LOGIN hold survives untouched.
    for (const [id, rec] of captures) {
      if (rec.wcId === wcId && familyOf(rec) === 'card') dropCapture(id);
    }

    const captureId = crypto.randomBytes(12).toString('hex');
    /** @type {any} */
    const rec = {
      captureId,
      wcId,
      kind: 'card',
      origin,
      number: Buffer.from(numBytes),
      cvv: cvcBytes ? Buffer.from(cvcBytes) : Buffer.alloc(0),
      cardholder: cardholder == null || cardholder === '' ? null : String(cardholder),
      expiry: expiry == null || expiry === '' ? null : String(expiry),
      jarId: jar.id,
      mode: 'pending-settle',
      choices: [],
      timer: null,
      capturedAt: _now()
    };
    wipe();
    rec.timer = _setTimeout(() => dropCapture(captureId), CAPTURE_DROP_MS);
    if (rec.timer && typeof rec.timer.unref === 'function') rec.timer.unref();
    captures.set(captureId, rec);
    return { captureId };
  }

  /**
   * Hold a GESTURE-TIME identity read, pending SETTLE (M21 F3 Leg 4, AC9) — the
   * identity twin of `holdGestureLogin`/`holdGestureCard`. LD2: the ten secret
   * identity fields cross as ONE `Uint8Array` (`identitySecretsBytes` — the
   * UTF-8 JSON of the ten secret role values), copied into a zeroizable Buffer
   * HERE (`rec.identitySecrets`) and the incoming array wiped; `fullName`, the
   * one non-secret identity field, crosses as a plain string. Same gate + family-
   * scoped supersession shape as the other two holds, same `captures` map +
   * `dropCapture` choke point — no new drop-rule wiring needed.
   * @param {{ wcId: number, identitySecretsBytes: any, fullName: any }} arg
   * @returns {{ captureId: string } | null}
   */
  function holdGestureIdentity({ wcId, identitySecretsBytes, fullName }) {
    const store = deps.getVaultStore();
    const bytes = identitySecretsBytes instanceof Uint8Array ? identitySecretsBytes : null;

    const origin = tabOriginFor(wcId);
    const jar = tabJarFor(wcId);
    if (!store.isSetUp() || !jar || !origin || !bytes) {
      if (bytes) bytes.fill(0);
      return null;
    }

    // Family-scoped supersession (LD1): only a PRIOR IDENTITY hold for this tab
    // is evicted — a pending LOGIN or CARD hold survives untouched.
    for (const [id, rec] of captures) {
      if (rec.wcId === wcId && familyOf(rec) === 'identity') dropCapture(id);
    }

    const captureId = crypto.randomBytes(12).toString('hex');
    const identitySecrets = Buffer.from(bytes);
    bytes.fill(0);

    /** @type {any} */
    const rec = {
      captureId,
      wcId,
      kind: 'identity',
      origin,
      identitySecrets,
      fullName: fullName == null || fullName === '' ? null : String(fullName),
      jarId: jar.id,
      mode: 'pending-settle',
      choices: [],
      timer: null,
      capturedAt: _now()
    };
    rec.timer = _setTimeout(() => dropCapture(captureId), CAPTURE_DROP_MS);
    if (rec.timer && typeof rec.timer.unref === 'function') rec.timer.unref();
    captures.set(captureId, rec);
    return { captureId };
  }

  /**
   * SETTLE: release a tab's held gesture-time reads (M21 F3 L2, DD1 — one per FAMILY,
   * not one per tab) into actual gate+dispose passes, via the SAME `capture`/`captureCard`
   * those functions already run for a direct call — never a reimplementation. Called from
   * BOTH settle signals (DD4): a per-tab `did-navigate` commit, and a preload-reported
   * field detachment (the SPA case). Returns `[]` when nothing is pending for this tab (the
   * ordinary case — most gestures/settles have no held record at all — or a resistant
   * fixture whose values never carried a provenanced secret, so no hold was ever created),
   * otherwise one `{ captureId, model }` entry per released record that produced an offer,
   * in `captures` Map insertion order (gesture order) — a record whose disposition yields
   * no offer (an unchanged login/card) is simply absent, exactly as it returned null today.
   *
   * AC1/AC3: `capture`/`captureCard`/`captureIdentity` re-run their OWN family-scoped
   * supersession loop on every call — with `familyOf` in place, a release below can no
   * longer evict a still-pending SIBLING record of a different family mid-loop, which
   * is what makes releasing multiple families in one call safe.
   *
   * AC12b: this loop is iterated over a SNAPSHOT taken up front and stays fully
   * SYNCHRONOUS end to end (no `await` between records) — no external bulk-drop (lock /
   * tab close / window close) can interleave mid-loop and invalidate AC3's argument.
   *
   * The pending record's secret Buffer(s) are COPIED before the pending record is dropped —
   * never the SAME Buffer object handed to `capture`/`captureCard`/`captureIdentity`, which
   * would otherwise be zeroized by THIS function's own `dropCapture` before those functions
   * ever read it (an aliasing hazard caught at implementation time, not assumed safe) — done
   * PER RECORD, inside the loop, so no reference to a dropped record's Buffer is ever held.
   *
   * LD1: dispatch is via `dispatchByFamily`, never a binary kind check — an
   * unrecognised family (`FAMILY_REFUSED`) drops+zeroizes the record and is OMITTED from the
   * returned array, exactly as a record whose disposition yields no offer already is.
   * @param {number} wcId
   * @returns {Array<{ captureId: string, model: any }>}
   */
  function captureRelease(wcId) {
    // Snapshot BEFORE releasing anything (AC12b) — never the live `captures` Map, which
    // this loop's own calls into `capture`/`captureCard`/`captureIdentity` mutate (drop the
    // released record, then re-add a NEW one for its disposition).
    /** @type {Array<[string, CaptureRecord]>} */
    const pending = [];
    for (const [id, r] of captures) {
      if (r.wcId === wcId && r.mode === 'pending-settle') pending.push([id, r]);
    }
    if (pending.length === 0) return [];

    const released = [];
    for (const [pendingId, rec] of pending) {
      const outcome = dispatchByFamily(rec, {
        login: () => {
          const passwordCopy = Buffer.from(rec.password);
          const { username, usernameDetected, jarId, origin } = rec;
          dropCapture(pendingId);
          return capture({ wcId, username, passwordBytes: passwordCopy, usernameDetected, origin, jar: { id: jarId } });
        },
        card: () => {
          const numberCopy = Buffer.from(rec.number);
          const cvvCopy = Buffer.from(rec.cvv);
          const { cardholder, expiry, jarId, origin } = rec;
          dropCapture(pendingId);
          return captureCard({
            wcId,
            numberBytes: numberCopy,
            cvvBytes: cvvCopy,
            cardholder,
            expiry,
            origin,
            jar: { id: jarId }
          });
        },
        identity: () => {
          const secretsCopy = Buffer.from(rec.identitySecrets);
          const { fullName, jarId, origin } = rec;
          dropCapture(pendingId);
          return captureIdentity({ wcId, identitySecretsBytes: secretsCopy, fullName, origin, jar: { id: jarId } });
        }
      });
      if (outcome === FAMILY_REFUSED) {
        // LD1's per-site mapping: drop+zeroize the refused record (dispatchByFamily
        // invoked no handler, so it is still held), then behave exactly as a record
        // whose disposition yields no offer already does — omitted from the array.
        dropCapture(pendingId);
        continue;
      }
      if (outcome) released.push(outcome);
    }
    return released;
  }

  /**
   * The stored cards reachable from a captured record's jar ({global, jar}), as FULL
   * items (the vault is unlocked here) — the card twin of `reachableLoginItems`'s role
   * inside `disposeCapture`. Kept local: it reads secrets (the stored PAN) to compare
   * identity, so it must never be confused with the metadata-only store method of a
   * similar name.
   * @param {string} jarId
   * @returns {Array<{ vaultId: string, item: any }>}
   */
  function storedCardsFor(jarId) {
    const store = deps.getVaultStore();
    const targets = jarId !== 'global' ? ['global', jarId] : ['global'];
    const out = [];
    for (const vaultId of targets) {
      let items;
      try {
        items = store.listItems(vaultId);
      } catch {
        continue;
      }
      for (const item of items) {
        if (item && item.type === 'card') out.push({ vaultId, item });
      }
    }
    return out;
  }

  /**
   * Compute the save/update disposition for a held CARD record against the NOW-UNLOCKED
   * vault, mutating the record and returning the sheet model — the card twin of
   * `disposeCapture`. Returns null when there is nothing to offer.
   *
   * IDENTITY is the PAN itself (digits-compared, so stored formatting never splits a
   * match), NOT the last4: two cards can share a last4, and offering to "update" the
   * wrong one would silently overwrite a different card. An exact PAN match whose CVV,
   * expiry and cardholder all agree is UNCHANGED → no offer, mirroring the login
   * path's no-op guard. Prefers a jar-vault match over a global one on a tie, exactly
   * as the login path does.
   * @param {any} rec
   * @returns {any | null}
   */
  function disposeCardCapture(rec) {
    const digits = digitsOf(rec.number.toString('utf8'));
    const stored = storedCardsFor(rec.jarId);
    const matches = stored.filter((s) => digitsOf(s.item.number) === digits);
    const match = matches.find((s) => s.vaultId === rec.jarId) || matches[0];

    const base = {
      kind: 'card',
      origin: rec.origin,
      brand: rec.brand,
      last4: rec.last4
    };

    if (match) {
      const cvv = rec.cvv.toString('utf8');
      const unchanged =
        String(match.item.cvv ?? '') === cvv &&
        String(match.item.expiry ?? '') === String(rec.expiry ?? '') &&
        String(match.item.cardholder ?? '') === String(rec.cardholder ?? '');
      if (unchanged) return null; // nothing to update → no offer
      rec.mode = 'update';
      rec.vaultId = match.vaultId;
      rec.itemId = match.item.id;
      rec.choices = [];
      return { ...base, mode: 'update', defaultVaultId: match.vaultId, choices: [] };
    }

    rec.mode = 'save';
    rec.choices = [rec.jarId, 'global'];
    return { ...base, mode: 'save', defaultVaultId: rec.jarId, choices: [rec.jarId, 'global'] };
  }

  /**
   * Capture a freshly-submitted payment card (issue #152) — the card twin of `capture`.
   * The PAN and CVV arrive as `Uint8Array`s, are copied into zeroizable Buffers HERE,
   * and the incoming arrays are wiped; neither ever reaches chrome (the offer model
   * carries only origin / brand / last4 / mode / vault choices).
   *
   * GATE, in order: the manager is set up → the tab resolves a PERSISTENT jar → an
   * origin resolves → the number is PLAUSIBLY A CARD (12–19 digits passing Luhn). That
   * last gate is what keeps a false-positive field detection from writing an arbitrary
   * submitted value into the vault as a "card"; it has no login equivalent because a
   * password field is self-identifying and a password has no checkable structure.
   *
   * Like the login path, a LOCKED vault HOLDS the capture (mode 'locked') and defers
   * the disposition to `captureFinalize` after an unlock.
   *
   * `origin`/`jar` follow `capture`'s own override shape (Leg 5): normally DERIVED HERE
   * from the tab's current state; `captureRelease` is the one caller that supplies them
   * explicitly, frozen at gesture time.
   * @param {{ wcId: number, numberBytes: any, cvvBytes: any, cardholder?: any, expiry?: any, origin?: string|null, jar?: {id: string}|null }} arg
   * @returns {{ captureId: string, model: any } | null}
   */
  function captureCard({ wcId, numberBytes, cvvBytes, cardholder, expiry, origin: originOverride, jar: jarOverride }) {
    const store = deps.getVaultStore();
    const numBytes = numberBytes instanceof Uint8Array ? numberBytes : null;
    const cvcBytes = cvvBytes instanceof Uint8Array ? cvvBytes : null;
    const wipe = () => {
      if (numBytes) numBytes.fill(0);
      if (cvcBytes) cvcBytes.fill(0);
    };

    const origin = originOverride !== undefined ? originOverride : tabOriginFor(wcId);
    const jar = jarOverride !== undefined ? jarOverride : tabJarFor(wcId);
    if (!store.isSetUp() || !jar || !origin || !numBytes) {
      wipe();
      return null;
    }

    const number = Buffer.from(numBytes).toString('utf8');
    if (!isPlausibleCardNumber(number)) {
      wipe();
      return null; // not a card — never offer to save an arbitrary form value
    }

    // Supersession: evict+zeroize any prior CARD record for this SAME tab first.
    // Family-scoped (M21 F3 L2, DD1's amendment, AC1b) — THIS is the loop that would
    // have defeated the whole leg left family-blind: `captureCard` has no callers in
    // `src/` outside `captureRelease`, so every card release re-enters this loop, where
    // (family-blind) it would find and zeroize a sibling PENDING LOGIN record `capture()`
    // just created moments earlier in the same synchronous `captureRelease` pass — or,
    // with the gesture order reversed, a still-pending login record even earlier. This
    // loop binds its variable as `prior`, not `rec` — a `rec.wcId`-shaped grep misses it.
    for (const [id, prior] of captures) {
      if (prior.wcId === wcId && familyOf(prior) === 'card') dropCapture(id);
    }

    const captureId = crypto.randomBytes(12).toString('hex');
    /** @type {any} */
    const rec = {
      captureId,
      wcId,
      kind: 'card',
      origin,
      number: Buffer.from(numBytes),
      cvv: cvcBytes ? Buffer.from(cvcBytes) : Buffer.alloc(0),
      cardholder: cardholder == null || cardholder === '' ? null : String(cardholder),
      expiry: expiry == null || expiry === '' ? null : String(expiry),
      brand: brandForNumber(number),
      last4: last4Of(number),
      jarId: jar.id,
      mode: 'save',
      choices: [],
      timer: null,
      capturedAt: _now()
    };
    wipe(); // the incoming deserialized arrays are separate allocations
    rec.timer = _setTimeout(() => dropCapture(captureId), CAPTURE_DROP_MS);
    if (rec.timer && typeof rec.timer.unref === 'function') rec.timer.unref();
    captures.set(captureId, rec);

    if (!store.isUnlocked()) {
      rec.mode = 'locked';
      return {
        captureId,
        model: { kind: 'card', origin, brand: rec.brand, last4: rec.last4, mode: 'locked' }
      };
    }

    const model = disposeCardCapture(rec);
    if (!model) {
      dropCapture(captureId);
      return null;
    }
    return { captureId, model };
  }

  /**
   * Decode a held identity record's transient plaintext (LD2): the ten secret
   * fields from `rec.identitySecrets`' JSON, plus `fullName` from the record's
   * own plain-string field. A parse failure (should never happen — this module
   * is the sole writer of `identitySecrets`) degrades every secret field to ''
   * rather than throwing — an empty field is simply never judged by
   * `classifyCapture` (its own `isPresent` guard).
   * @param {any} rec
   * @returns {any}  a plain object keyed by every one of `IDENTITY_FIELDS`.
   */
  function decodeIdentitySecrets(rec) {
    /** @type {any} */
    let parsed;
    try {
      parsed = JSON.parse(rec.identitySecrets.toString('utf8'));
    } catch {
      parsed = {};
    }
    /** @type {any} */
    const out = { fullName: rec.fullName ?? '' };
    for (const field of IDENTITY_FIELDS) {
      if (field === 'fullName') continue;
      out[field] = typeof parsed[field] === 'string' ? parsed[field] : '';
    }
    return out;
  }

  /**
   * LD6: which stored identity profile (if any) a capture for `jarId` classifies
   * against — the tab's own jar vault PREFERRED over the global vault, mirroring
   * the login/card precedent (jar match preferred over global). Reads through
   * `identityProfileOf` (LD2/DD10's canonical accessor) at EACH vault visited, so
   * a per-vault write-path-invariant violation (`extra` non-empty) is surfaced
   * for whichever vault is actually chosen — never silently picked around.
   * Returns `null` when neither vault holds a profile (a fresh save).
   * @param {string} jarId
   * @returns {{ vaultId: string, profile: any, extra: any[] } | null}
   */
  function identityProfileFor(jarId) {
    const store = deps.getVaultStore();
    const targets = jarId !== 'global' ? [jarId, 'global'] : ['global'];
    for (const vaultId of targets) {
      let items;
      try {
        items = store.listItems(vaultId);
      } catch {
        continue; // non-persistent/unknown jar (VaultStateError) or a lock race — skip.
      }
      const { profile, extra } = identityProfileOf(/** @type {any[]} */ (items));
      if (profile) return { vaultId, profile, extra };
    }
    return null;
  }

  /**
   * Compute the save/update disposition for a held IDENTITY record against the
   * NOW-UNLOCKED vault (M21 F3 Leg 4, DD10/LD6/LD9) — the identity twin of
   * `disposeCapture`/`disposeCardCapture`. Reads the transient captured record via
   * `decodeIdentitySecrets`, resolves the profile to classify against via LD6's
   * `identityProfileFor`, and runs the flight's hard-zero criterion —
   * `classifyCapture` — for real:
   *   - a violated one-profile-per-vault invariant (`extra` non-empty) REFUSES the
   *     offer entirely (LD9) rather than silently picking a profile — traced (when
   *     `deps.trace` is injected) with vault ids/counts only, never a field value;
   *   - `match` against an existing profile → no offer (record dropped);
   *   - `gap-fill` / `conflict` against an existing profile → an `update` offer,
   *     with the record stamped with EXACTLY the fields the offer names
   *     (`rec.identityGapFilled` / `rec.identityConflicting`) for LD8's write-set
   *     to consume later at `captureSave` — never a spread of the full capture;
   *   - no profile anywhere (a fresh vault) → a `save` offer naming every captured
   *     field as `addedFields` (DD10's stated residual: nothing to conflict with).
   * The model carries field LABELS only (DD6) — `classifyCapture`'s own `to`/`from`
   * VALUES are consumed here and never placed on the returned model.
   * @param {any} rec
   * @returns {any | null}
   */
  function disposeIdentityCapture(rec) {
    const captured = decodeIdentitySecrets(rec);
    const found = identityProfileFor(rec.jarId);

    if (found && found.extra.length > 0) {
      _trace('duplicate-profile', { jarId: rec.jarId, vaultId: found.vaultId, count: found.extra.length + 1 });
      return null; // LD9: refuse the offer entirely — never silently pick one.
    }

    const classification = classifyCapture(found ? found.profile : null, captured);

    if (found) {
      if (classification.kind === 'match') return null; // nothing to update → no offer
      rec.mode = 'update';
      rec.vaultId = found.vaultId;
      rec.itemId = found.profile.id;
      rec.choices = [];
      rec.identityGapFilled = classification.gapFilled.map((g) => g.field);
      rec.identityConflicting = classification.conflicting.map((c) => c.field);
      return {
        kind: 'identity',
        origin: rec.origin,
        mode: 'update',
        addedFields: labelsFor(rec.identityGapFilled),
        changedFields: labelsFor(rec.identityConflicting),
        defaultVaultId: found.vaultId,
        choices: []
      };
    }

    rec.mode = 'save';
    rec.choices = [rec.jarId, 'global'];
    return {
      kind: 'identity',
      origin: rec.origin,
      mode: 'save',
      addedFields: labelsFor(classification.gapFilled.map((g) => g.field)),
      changedFields: [],
      defaultVaultId: rec.jarId,
      choices: [rec.jarId, 'global']
    };
  }

  /**
   * Capture a freshly-submitted identity profile (M21 F3 Leg 4, AC8b) — the
   * identity twin of `capture`/`captureCard`. LD2: the ten secret fields arrive
   * as ONE `Uint8Array` (the UTF-8 JSON of the ten secret role values), copied
   * into a zeroizable Buffer HERE (`rec.identitySecrets`) and the incoming array
   * wiped; `fullName` crosses as a plain string. Neither ever reaches chrome —
   * the offer model carries only field LABELS (DD6), never a value.
   *
   * GATE: the manager is set up, the tab resolves a PERSISTENT jar, an origin
   * resolves. No plausibility gate — DD2's own value-layer admission gate
   * (the scope anchor AND a non-postal role both provenanced) already ran at the
   * gesture layer before this was ever called, so a gate-passed capture is
   * always worth holding.
   *
   * Like the login/card path, a LOCKED vault HOLDS the capture (mode 'locked')
   * and defers the disposition to `captureFinalize`. `origin`/`jar` follow
   * `capture`'s own override shape (Leg 5): normally DERIVED HERE from the tab's
   * current state; `captureRelease` is the one caller that supplies them
   * explicitly, frozen at gesture time. `captureRelease`'s identity branch and
   * nothing else calls this (AC8b — the login/card twins' own call graph).
   * @param {{ wcId: number, identitySecretsBytes: any, fullName: any, origin?: string|null, jar?: {id: string}|null }} arg
   * @returns {{ captureId: string, model: any } | null}
   */
  function captureIdentity({ wcId, identitySecretsBytes, fullName, origin: originOverride, jar: jarOverride }) {
    const store = deps.getVaultStore();
    const bytes = identitySecretsBytes instanceof Uint8Array ? identitySecretsBytes : null;

    const origin = originOverride !== undefined ? originOverride : tabOriginFor(wcId);
    const jar = jarOverride !== undefined ? jarOverride : tabJarFor(wcId);
    if (!store.isSetUp() || !jar || !origin || !bytes) {
      if (bytes) bytes.fill(0);
      return null;
    }

    // Family-scoped supersession (LD1): only a PRIOR IDENTITY record for this
    // SAME tab is evicted — a pending LOGIN or CARD hold survives untouched.
    for (const [id, prior] of captures) {
      if (prior.wcId === wcId && familyOf(prior) === 'identity') dropCapture(id);
    }

    const captureId = crypto.randomBytes(12).toString('hex');
    /** @type {any} */
    const rec = {
      captureId,
      wcId,
      kind: 'identity',
      origin,
      identitySecrets: Buffer.from(bytes),
      fullName: fullName == null || fullName === '' ? null : String(fullName),
      jarId: jar.id,
      mode: 'save',
      choices: [],
      timer: null,
      capturedAt: _now()
    };
    bytes.fill(0); // the incoming deserialized array is a separate allocation
    rec.timer = _setTimeout(() => dropCapture(captureId), CAPTURE_DROP_MS);
    if (rec.timer && typeof rec.timer.unref === 'function') rec.timer.unref();
    captures.set(captureId, rec);

    if (!store.isUnlocked()) {
      rec.mode = 'locked';
      return { captureId, model: { kind: 'identity', origin, mode: 'locked' } };
    }

    const model = disposeIdentityCapture(rec);
    if (!model) {
      dropCapture(captureId);
      return null;
    }
    return { captureId, model };
  }

  /**
   * Finalize a held 'locked' capture AFTER a successful unlock (the chrome's unlock-to-save
   * continuation): compute the deferred save/update disposition and return `{ captureId, model }`
   * so the chrome opens the vault-capture sheet.
   *
   * Every OTHER outcome returns a discriminated `{ reason }` rather than a bare null. The
   * operator has just typed their master password FOR THIS SAVE, so "no sheet appears and
   * nothing is said" is not an acceptable answer to any of them — the chrome turns each reason
   * into its own message (operator-reported: a real save that produced total silence, with no
   * way to tell a correct no-op from a defect). The reasons:
   *   'expired'     — the record is gone: the 2-minute safety timeout fired, or it was dropped
   *                   (dismissed / superseded by a newer capture on the same tab), OR (LD1) the
   *                   record carried an unrecognised family — refused, dropped, mapped here.
   *   'locked'      — the vault is not unlocked after all (unlock didn't take / raced a re-lock).
   *   'tab-changed' — the tab's jar no longer resolves the SAME jar (tab closed / re-jarred);
   *                   the record is dropped so the captured password never lingers.
   *   'unchanged'   — the credential already stored for this origin is identical, so there is
   *                   genuinely nothing to save; the record is dropped.
   * @param {string} captureId
   * @returns {{ captureId: string, model: { origin: string, username: string|null, mode: 'save'|'update', defaultVaultId: string, choices: string[] } }
   *   | { reason: 'expired' | 'locked' | 'tab-changed' | 'unchanged' }}
   */
  function captureFinalize(captureId) {
    const rec = captures.get(captureId);
    if (!rec) return { reason: /** @type {'expired'} */ ('expired') };
    if (!deps.getVaultStore().isUnlocked()) return { reason: /** @type {'locked'} */ ('locked') };
    const jar = tabJarFor(rec.wcId);
    if (!jar || jar.id !== rec.jarId) {
      dropCapture(captureId);
      return { reason: /** @type {'tab-changed'} */ ('tab-changed') };
    }
    // Unchanged item after unlock (dispose → null) → drop, no offer. LD1: dispatched via
    // dispatchByFamily, never a binary kind check — the card twin disposes by
    // PAN identity, the identity twin by LD6/DD10's classifyCapture wiring, and the login
    // twin by origin+username with DD3c's post-dispose downgrade applied (unlock-to-save
    // must not skip it — a locked-at-gesture capture reaches disposition ONLY through this
    // path). An unrecognised family (FAMILY_REFUSED) drops+zeroizes and maps to 'expired' —
    // its existing "no such record" reason, true once the record is gone.
    const model = dispatchByFamily(rec, {
      login: () => applyUsernameDowngrade(rec, disposeCapture(rec)),
      card: () => disposeCardCapture(rec),
      identity: () => disposeIdentityCapture(rec)
    });
    if (model === FAMILY_REFUSED) {
      dropCapture(captureId);
      return { reason: /** @type {'expired'} */ ('expired') };
    }
    if (!model) {
      dropCapture(captureId);
      return { reason: /** @type {'unchanged'} */ ('unchanged') };
    }
    return { captureId, model };
  }

  /**
   * Persist a held capture on accept. Looks up the record (`{ saved:false }` if gone /
   * already dropped), re-checks `isUnlocked()` (an idle-lock between offer and save →
   * `{ saved:false, reason:'locked' }`), then upserts via `saveItem`:
   *   - a `save` requires the chosen `vaultId ∈ record.choices`, creates a NEW login,
   *     and synthesizes the title from the origin hostname so captured items are
   *     self-describing;
   *   - an `update` ignores the sheet-supplied vaultId and targets the record's fixed
   *     `{ vaultId, itemId }`. It reads the existing item and MERGES — carrying every
   *     field forward (notably `totp`, a user-customized `title`, notes, and any future
   *     field), overriding ONLY origin / username / password. This matters because
   *     `saveItem` does a WHOLESALE replace on update (only `createdAt` is preserved by
   *     `_normalizeItem`); passing a bare `{ type, title, origin, username, password }`
   *     would permanently drop the login's `totp` seed — unrecoverable data loss. The
   *     hostname-title synthesis therefore applies ONLY to the SAVE path; an update keeps
   *     the operator's custom title. If the item vanished between the offer and the save,
   *     the held record is dropped and `{ saved:false }` is returned.
   * On success — and on a `saveItem` throw (N1) — the record is zeroized+dropped and the
   * timer cleared through the `dropCapture` choke point, so a captured password never
   * lingers on a persist error.
   *
   * IDENTITY (M21 F3 Leg 4, LD4/LD8): a `save` writes a brand-new item titled the fixed
   * non-secret default `"My details"` (LD4 — never composed from firstName+lastName) with
   * every captured field. An `update` writes EXACTLY the fields `disposeIdentityCapture`
   * named on the record (`rec.identityGapFilled` ∪ `rec.identityConflicting`) over the
   * EXISTING item — LD8's hard rule, never a spread of the full capture: a checkout
   * captures only the fields it happens to ask for, and a bare `{ ...existing, ...captured }`
   * would silently blank every field the form never asked about. The store's
   * one-profile-per-vault refusal (`_saveItem`) is respected either way — an `update`
   * targets the existing profile's own id (passes it); a racing concurrent `save` would
   * throw `VaultStateError`, which this function does not catch, surfacing through the
   * same generic "Couldn't save" chain as any other `saveItem` throw (N1).
   *
   * LD1: dispatched via `dispatchByFamily`, never a binary kind check — an
   * unrecognised family (`FAMILY_REFUSED`) drops+zeroizes the record and maps to `{ saved:
   * false }`, its existing "record gone" shape (true once the record is dropped).
   * @param {{ captureId: string, vaultId: any }} arg
   * @returns {{ saved: boolean, reason?: string }}
   */
  function captureSave({ captureId, vaultId }) {
    const store = deps.getVaultStore();
    // Leg 1 (capture-hold-safety): checked BEFORE the record lookup, not after.
    // A vault lock now drops every held record (dropAllCaptures), so a Save
    // clicked against an already-dropped record must still report the SAME
    // actionable 'locked' reason it always has — not degrade to the generic
    // `{ saved: false }` a bare `!rec` would produce. This also covers the
    // pre-existing idle-lock race (offer shown, vault auto-locks, Save clicked
    // before the record itself is dropped) with the identical check.
    if (!store.isUnlocked()) return { saved: false, reason: 'locked' };

    const rec = captures.get(captureId);
    if (!rec) return { saved: false };

    const outcome = dispatchByFamily(rec, {
      // CARD (issue #152) — the same save/update shape as a login, with the card's own
      // field set. An update MERGES over the existing item for exactly the login path's
      // reason: `saveItem` wholesale-replaces, so a bare rewrite would drop the
      // operator's custom title and notes.
      card: () => {
        const number = rec.number.toString('utf8');
        let cardTarget;
        let cardItem;
        if (rec.mode === 'update') {
          cardTarget = /** @type {string} */ (rec.vaultId);
          const existing = store.listItems(cardTarget).find((/** @type {any} */ i) => i.id === rec.itemId);
          if (!existing) {
            dropCapture(captureId);
            return { saved: false };
          }
          cardItem = {
            ...existing,
            number,
            cvv: rec.cvv.toString('utf8'),
            expiry: rec.expiry,
            cardholder: rec.cardholder ?? existing.cardholder,
            brand: rec.brand ?? existing.brand,
            last4: rec.last4 ?? existing.last4
          };
        } else {
          if (typeof vaultId !== 'string' || !rec.choices.includes(vaultId)) {
            return { saved: false, reason: 'invalid-vault' };
          }
          cardTarget = vaultId;
          // SAVE only: synthesize a self-describing title ("Visa •••• 4242"), the card
          // analogue of the login path's hostname title.
          cardItem = {
            type: 'card',
            title: titleForNumber(number),
            cardholder: rec.cardholder,
            brand: rec.brand,
            last4: rec.last4,
            number,
            cvv: rec.cvv.toString('utf8'),
            expiry: rec.expiry
          };
        }
        try {
          store.saveItem(cardTarget, cardItem);
        } finally {
          dropCapture(captureId);
        }
        return { saved: true };
      },

      // IDENTITY (M21 F3 Leg 4, LD4/LD8). See this function's own header.
      identity: () => {
        const captured = decodeIdentitySecrets(rec);
        if (rec.mode === 'update') {
          const target = /** @type {string} */ (rec.vaultId);
          const existing = store.listItems(target).find((/** @type {any} */ i) => i.id === rec.itemId);
          if (!existing) {
            dropCapture(captureId);
            return { saved: false };
          }
          // LD8: write EXACTLY the fields the offer named — never a spread of the full
          // captured object, which would silently blank every field this form never asked
          // about.
          const fields = new Set([...(rec.identityGapFilled || []), ...(rec.identityConflicting || [])]);
          /** @type {any} */
          const item = { ...existing };
          for (const field of fields) item[field] = captured[field];
          try {
            store.saveItem(target, item);
          } finally {
            dropCapture(captureId);
          }
          return { saved: true };
        }
        if (typeof vaultId !== 'string' || !rec.choices.includes(vaultId)) {
          return { saved: false, reason: 'invalid-vault' };
        }
        // SAVE (new item) only: the fixed non-secret default title (LD4 — one profile
        // per vault needs no disambiguation), every captured field.
        const item = { type: 'identity', title: 'My details', ...captured };
        try {
          store.saveItem(vaultId, item);
        } finally {
          dropCapture(captureId);
        }
        return { saved: true };
      },

      login: () => {
        let target;
        let item;
        if (rec.mode === 'update') {
          target = /** @type {string} */ (rec.vaultId);
          // Read the existing item and MERGE — a bare rewrite would drop totp / custom title
          // / notes (saveItem wholesale-replaces on update, keeping only createdAt).
          const existing = store.listItems(target).find((/** @type {any} */ i) => i.id === rec.itemId);
          // The item vanished between the offer and the save (deleted elsewhere) — nothing to
          // update. Drop the held record so the captured password never lingers.
          if (!existing) {
            dropCapture(captureId);
            return { saved: false };
          }
          item = {
            ...existing,
            origin: rec.origin,
            username: rec.username,
            password: rec.password.toString('utf8')
          };
        } else {
          if (typeof vaultId !== 'string' || !rec.choices.includes(vaultId)) {
            return { saved: false, reason: 'invalid-vault' };
          }
          target = vaultId;
          // SAVE (new item) only: synthesize a self-describing title from the origin host.
          let title;
          try {
            title = new URL(rec.origin).hostname;
          } catch {
            title = rec.origin;
          }
          item = {
            type: 'login',
            title,
            origin: rec.origin,
            username: rec.username,
            password: rec.password.toString('utf8')
          };
        }

        // N1: once we commit to the persist, drop+zeroize the held record in a `finally` so a
        // `saveItem` throw (e.g. a disk error) can never leave the captured password lingering
        // until the 2-min safety timeout. On success this is the same drop choke point as before.
        try {
          store.saveItem(target, item);
        } finally {
          dropCapture(captureId);
        }
        return { saved: true };
      }
    });

    if (outcome === FAMILY_REFUSED) {
      dropCapture(captureId);
      return { saved: false };
    }
    return outcome;
  }

  /**
   * Drop a held capture without saving (chrome `handleOverlayClosed` for a dismissed
   * `vault-capture` sheet). Zeroizes+evicts the record and clears the timer.
   * @param {string} captureId
   */
  function captureDismiss(captureId) {
    dropCapture(captureId);
  }

  // ---------------------------------------------------------------------------
  // Leg 1 (capture-hold-safety, DD5): bulk drops for the three teardown conditions
  // a held capture must not outlive — vault lock, owning-window close, tab close —
  // on top of the existing TTL/dismiss/save/supersession exits. Every one of the
  // three delegates to `dropCapture`, the single zeroizing choke point: no second
  // eviction path exists that could diverge from its zeroization.
  //
  // RETURN VALUE IS TEST-ONLY. `captures` is private and the returned API exposes
  // no record, while `capture()`/`captureCard()` deliberately COPY the caller's
  // bytes into an internal Buffer and zero the caller's own array immediately — so
  // a test has no other way to reach a record's secret buffer from outside. Every
  // production call site (onLock, releaseVaultHoldsForWindow, the tab-close hook)
  // discards the return value — bare calls, no assignment. `dropCapture` zeroizes
  // the secret Buffers in place before eviction, so a returned record's
  // password/number/cvv already read back as all-zero — but the SAME record still
  // carries plaintext `origin`/`username`/`cardholder` and the like, so a future
  // "helpful" log or trace on a returned array would leak that metadata even
  // though the passwords themselves stay safe. Never log/trace what these return.
  // ---------------------------------------------------------------------------

  /**
   * Bulk-drop every held capture for one TAB (tab close). See the block comment
   * above for the return-value contract.
   * @param {number} wcId
   * @returns {CaptureRecord[]}
   */
  function dropCapturesForTab(wcId) {
    const dropped = [];
    for (const id of [...captures.keys()]) {
      const rec = captures.get(id);
      if (rec && rec.wcId === wcId) {
        dropped.push(rec);
        dropCapture(id);
      }
    }
    return dropped;
  }

  /**
   * Bulk-drop every held capture owned by one WINDOW (window close), via the
   * injected `tabWcIdsForChrome` chromeId→wcIds resolver (`captures` is keyed by
   * tab wcId, not chrome id, and this module has no registry access to bridge the
   * two itself). An omitted dep or an unresolved/dead chrome id drops nothing,
   * never throws. See the block comment above for the return-value contract.
   * @param {number} chromeId
   * @returns {CaptureRecord[]}
   */
  function dropCapturesForWindow(chromeId) {
    const wcIds = new Set(deps.tabWcIdsForChrome ? deps.tabWcIdsForChrome(chromeId) : []);
    const dropped = [];
    for (const id of [...captures.keys()]) {
      const rec = captures.get(id);
      if (rec && wcIds.has(rec.wcId)) {
        dropped.push(rec);
        dropCapture(id);
      }
    }
    return dropped;
  }

  /**
   * Bulk-drop EVERY held capture (vault lock — manual `lockNow()` or the idle
   * autolock timer, both routed through the store's single `onLock` hook). See
   * the block comment above for the return-value contract.
   * @returns {CaptureRecord[]}
   */
  function dropAllCaptures() {
    const dropped = [];
    for (const id of [...captures.keys()]) {
      const rec = captures.get(id);
      if (rec) dropped.push(rec);
      dropCapture(id);
    }
    return dropped;
  }

  return {
    reachableItems,
    fillHuman,
    capture,
    captureCard,
    captureIdentity,
    holdGestureLogin,
    holdGestureCard,
    holdGestureIdentity,
    captureRelease,
    captureFinalize,
    captureSave,
    captureDismiss,
    dropCapturesForTab,
    dropCapturesForWindow,
    dropAllCaptures,
    _seedCaptureForTest
  };
}

module.exports = { createVaultHuman, originOf, familyOf, dispatchByFamily, FAMILY_REFUSED };
