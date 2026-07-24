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
 * @typedef {Object} VaultHumanDeps
 * @property {() => any} getVaultStore  the memoized vault-store singleton accessor.
 * @property {(wcId: number) => any} fromId  webContents.fromId — resolve a tab's live wc.
 * @property {(wcId: number) => ({ partition: string, trusted: boolean } | null | undefined)} getTabEntry
 *   resolve the registry tab entry for a wcId (partition + trusted); null/undefined when absent.
 * @property {() => Array<{ id: string, partition: string }>} listJars  the persistent jars snapshot.
 * @property {(arg: { wcId: number, credential: { username: any, password: any } }) => void} fillDelegate
 *   the F1 main→preload fill effect (main.js `webContents.fromId(wcId)?.send('vault-fill', credential)`).
 * @property {(fn: () => void, ms: number) => any} [setTimeout]  capture drop-timer arm (default global) — injected so the timeout is unit-testable.
 * @property {(handle: any) => void} [clearTimeout]  capture drop-timer clear (default global).
 * @property {() => number} [now]  clock (default Date.now) — the record's capturedAt stamp.
 */

/**
 * A held captured-credential record — lives in MAIN only, keyed by captureId, from
 * `capture()` until save / dismiss / supersession / timeout. The password is a
 * zeroizable Buffer; it NEVER travels to chrome or the sheet (the offer model + the
 * save invoke carry only origin / username / vaultId).
 * @typedef {Object} CaptureRecord
 * @property {string} captureId
 * @property {number} wcId  the owning tab (for last-wins-per-tab supersession).
 * @property {string} origin  derived in main from the sender URL (never guest-supplied).
 * @property {string | null} username
 * @property {Buffer} password
 * @property {string} jarId  the tab's persistent jar id (fixed at capture; disposition uses it).
 * @property {'save' | 'update' | 'locked'} mode  'locked' = held pending an unlock; the save/update
 *   disposition is deferred to `captureFinalize` (it needs the vault unlocked).
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
    if (rec.password && typeof rec.password.fill === 'function') rec.password.fill(0);
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
   * The picker model for the tab: the origin-filtered, badged, metadata-only
   * reachable login items. `[]` for a burner (no persistent jar), a bad/empty URL,
   * or a locked/uncreated vault — the reachable read is itself `[]`-safe.
   * @param {number} wcId
   * @returns {Array<{ vaultId: string, id: string, title: string|null, origin: string|null, username: string|null, hasTotp: boolean }>}
   */
  function reachableItems(wcId) {
    const origin = tabOriginFor(wcId);
    if (!origin) return [];
    const jar = tabJarFor(wcId);
    if (!jar) return []; // burner / non-persistent — no reachable items (DD9).
    // Picker path WIDENS (M12 F4 Leg 4 / DD5): a `matchMode:'registrable-domain'` item
    // surfaces on a hardened-matched subdomain, badged via the row's `widened` flag.
    return deps.getVaultStore().reachableLoginItems(jar.id, origin, { widen: true });
  }

  /**
   * Dispatch the chosen credential through F1's `vault-fill` channel. Re-checks, in
   * ORDER (DD6/DD9): (1) locked; (2) burner → ineligible BEFORE the scope assert
   * (so a `vaultId:'global'` can never fill a burner tab); (3) cross-vault scope
   * (`vaultId ∈ { 'global', tabJar.id }`); (4) exact-origin. Any refusal returns
   * `{ filled: false, reason }` and does NOT call the fill delegate. On success the
   * credential is built + consumed HERE and `{ filled: true }` (no password) is
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
    // Origin match — exact by default, widened to the registrable domain for a
    // `matchMode:'registrable-domain'` item behind the fail-closed matcher (M12 F4 Leg 4
    // / DD5). The picker only offers rows that already matched, but re-checking here
    // (with the same widen) keeps the fill gate the authoritative boundary.
    if (!item || item.type !== 'login' || !tabOrigin || !originMatches(item, tabOrigin, { widen: true })) {
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
    return { origin: rec.origin, username: rec.username, mode: 'save', defaultVaultId: rec.jarId, choices: [rec.jarId, 'global'] };
  }

  function capture({ wcId, username, passwordBytes }) {
    const store = deps.getVaultStore();

    // GATE — set up AND a persistent jar (DD9) AND an origin. Unlocked is NO LONGER required:
    // a LOCKED vault now HOLDS the credential and asks the chrome to prompt an unlock first,
    // then saves (mode 'locked'). Not-set-up / no-jar / no-origin still drop with no offer.
    // A miss wipes the incoming bytes below.
    const bytes = passwordBytes instanceof Uint8Array ? passwordBytes : null;
    const origin = tabOriginFor(wcId);
    const jar = tabJarFor(wcId);
    if (!store.isSetUp() || !jar || !origin) {
      if (bytes) bytes.fill(0);
      return null;
    }

    // Supersession: evict+zeroize any prior record for this SAME tab first, so a rapid
    // re-submit is true last-wins and never leaves an orphan record holding a password.
    for (const [id, rec] of captures) {
      if (rec.wcId === wcId) dropCapture(id);
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
      password,
      jarId: jar.id,
      mode: 'save', // provisional — set by disposeCapture (unlocked) or 'locked' below.
      choices: [],
      timer: null,
      capturedAt: _now(),
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

    // UNLOCKED: compute the disposition now. An UNCHANGED login (disposeCapture → null)
    // has nothing to save — drop the held record and make no offer.
    const model = disposeCapture(rec);
    if (!model) { dropCapture(captureId); return null; }
    return { captureId, model };
  }

  /**
   * Finalize a held 'locked' capture AFTER a successful unlock (the chrome's unlock-to-save
   * continuation): compute the deferred save/update disposition and return `{ captureId, model }`
   * so the chrome opens the vault-capture sheet. Returns null when the record is gone
   * (timeout / superseded), the vault is still locked (unlock didn't take / re-locked), or the
   * tab's jar no longer resolves the SAME jar (tab closed / re-jarred) — the record is dropped
   * in that last case so the captured password never lingers.
   * @param {string} captureId
   * @returns {{ captureId: string, model: { origin: string, username: string|null, mode: 'save'|'update', defaultVaultId: string, choices: string[] } } | null}
   */
  function captureFinalize(captureId) {
    const rec = captures.get(captureId);
    if (!rec) return null;
    if (!deps.getVaultStore().isUnlocked()) return null; // unlock didn't take / raced a re-lock
    const jar = tabJarFor(rec.wcId);
    if (!jar || jar.id !== rec.jarId) { dropCapture(captureId); return null; }
    // Unchanged login after unlock (disposeCapture → null) → drop, no offer.
    const model = disposeCapture(rec);
    if (!model) { dropCapture(captureId); return null; }
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
   * @param {{ captureId: string, vaultId: any }} arg
   * @returns {{ saved: boolean, reason?: string }}
   */
  function captureSave({ captureId, vaultId }) {
    const rec = captures.get(captureId);
    if (!rec) return { saved: false };

    const store = deps.getVaultStore();
    // Idle-lock race: the vault may have auto-locked between the offer and the save.
    if (!store.isUnlocked()) return { saved: false, reason: 'locked' };

    let target;
    let item;
    if (rec.mode === 'update') {
      target = /** @type {string} */ (rec.vaultId);
      // Read the existing item and MERGE — a bare rewrite would drop totp / custom title
      // / notes (saveItem wholesale-replaces on update, keeping only createdAt).
      const existing = store
        .listItems(target)
        .find((/** @type {any} */ i) => i.id === rec.itemId);
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
        password: rec.password.toString('utf8'),
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
        password: rec.password.toString('utf8'),
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

  /**
   * Drop a held capture without saving (chrome `handleOverlayClosed` for a dismissed
   * `vault-capture` sheet). Zeroizes+evicts the record and clears the timer.
   * @param {string} captureId
   */
  function captureDismiss(captureId) {
    dropCapture(captureId);
  }

  return { reachableItems, fillHuman, capture, captureFinalize, captureSave, captureDismiss };
}

module.exports = { createVaultHuman, originOf };
