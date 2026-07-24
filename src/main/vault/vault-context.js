// @ts-check
'use strict';

// Automation vault context — the per-SESSION, fill-only vault dispatch (Mission
// 12, Flight 1, Leg 3, DECISION: automation state is per-session, dispatched
// OUTSIDE scopeEngine).
//
// ELECTRON-FREE: this module requires ONLY the pure `../automation/resolve`
// membership primitive and `./vault-crypto` (for TOTP code generation). Every
// host handle — the vault store, the fill delegate, the auto-lock-minutes
// reader, and the timer/clock functions — is INJECTED via `createVaultContext`,
// so the whole surface unit-tests headlessly with fakes + real `.gfvault`
// fixtures and NO Electron/SDK/browser. This module must never import the
// electron module — an acceptance criterion greps to confirm zero such imports.
//
// WHY A SEPARATE PER-SESSION MODULE (leg DECISION):
//   - Vault ops NEVER flow through `scopeEngine`. `scopeEngine` returns the raw
//     engine unchanged for admin (reference-pinned by ~6 tests), and vault ops
//     are not engine ops — so `vaultFill` can never be a scope method. This
//     module owns the vault dispatch on a SEPARATE per-session path.
//   - State is per-session: `keys` (vaultId → key Buffer) + `unlockedIds`, held
//     only in memory, `.fill(0)`-zeroized on transport teardown (mcp-server's
//     `transport.onclose`) AND on an idle-timer backstop (DD5). Two concurrent
//     sessions hold INDEPENDENT Buffers — one teardown never zeroizes the other.
//   - NO singleton coupling either direction: this path uses only the store's
//     STATELESS methods (`unlockVaultWithAccessKey`, `openAllWithAdminKey`,
//     `readVaultItems`) — it never installs an MRK or mutates the store's human
//     `mrk`/`vaultKeys`, and `vault-store.lockNow()` never empties a live session
//     (each session holds its own fresh-buffer copies).
//
// FILL IS FILL-ONLY: `fill` resolves an origin-matched login from an unlocked
// reachable vault, enforces jar membership (via resolveContentsForJar) + origin
// match, then hands the credential to the INJECTED fill delegate — the credential
// is NEVER returned across the MCP boundary (the tool result carries no password).

const { resolveContents, resolveContentsForJar } = require('../automation/resolve');
const vc = require('./vault-crypto');
// Fill matcher (M12 F4 Leg 4 / DD5): exact origin by default, widened to the
// registrable domain for a per-item `matchMode:'registrable-domain'` opt-in, fail-closed.
const { originMatches } = require('../../shared/origin-match');

/**
 * The safe origin of a URL string, or null if it does not parse.
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
 * Injected dependencies for a per-session vault context.
 * @typedef {Object} VaultContextDeps
 * @property {{
 *   unlockVaultWithAccessKey: (vaultId: string, secret: string) => Buffer,
 *   openVaultWithAccessKey: (vaultId: string, secret: string) => { key: Buffer, keyId: string },
 *   openAllWithAdminKey: (privB64: string) => Map<string, Buffer>,
 *   readVaultItems: (vaultId: string, key: Buffer) => any[],
 *   accessEnvelopeExists: (vaultId: string, keyId: string) => boolean,
 *   adminPublicKey: () => string,
 * }} vaultStore  the STATELESS vault-store methods (no MRK / no singleton).
 * @property {(arg: { wcId: number, credential: any }) => any} fillDelegate  the
 *   main→preload fill effect (Leg 4 injects the real one; Leg 3 tests inject a fake).
 * @property {() => number} [getAutoLockMinutes]  idle auto-lock minutes reader.
 * @property {() => number} [now]  clock (default Date.now) — TOTP + idle stamps.
 * @property {(fn: () => void, ms: number) => any} [setTimeout]  idle-timer arm.
 * @property {(handle: any) => void} [clearTimeout]  idle-timer clear.
 */

/**
 * Deps for the fill membership/origin resolution — the SAME shape as scope.js's
 * `scopeCtx` (mcp-server passes `scopeCtx` straight through). Absent handles fail
 * cleanly rather than resolving a foreign contents.
 * @typedef {Object} FillEngineDeps
 * @property {{ list: () => Array<{ id: string, partition: string }> }} [jars]
 * @property {(id: number) => any} [fromId]
 * @property {(partition: string) => any} [fromPartition]
 * @property {() => any} [getChromeContents]
 * @property {(wc: any) => boolean} [isChromeContents]
 */

/**
 * Create a per-session vault context. The returned methods take `identity`
 * (a jarId or the literal `'admin'`) explicitly — mcp-server's per-session
 * `buildServer` binds it. `list`/`totp` read the unlocked `keys`; they need no
 * identity because `keys` already reflects this session's reachable set.
 *
 * @param {VaultContextDeps} deps
 * @returns {{
 *   unlock: (identity: string, accessKey: string) => { unlocked: string[] },
 *   list: () => Array<{ vaultId: string, id: string, title: string|null, origin: string|null, username: string|null, hasTotp: boolean }>,
 *   totp: (itemId: string, vaultId?: string) => { id: string, code: string|null },
 *   fill: (identity: string, target: { wcId: number, itemId: string, vaultId?: string }, engineDeps?: FillEngineDeps) => { filled: boolean, id?: string, reason?: string },
 *   touch: () => void,
 *   zeroize: () => void,
 * }}
 */
function createVaultContext(deps = /** @type {any} */ ({})) {
  const vaultStore = deps.vaultStore;
  const fillDelegate = typeof deps.fillDelegate === 'function'
    ? deps.fillDelegate
    : () => { throw new Error('automation: vault-fill-unavailable — no fill delegate injected'); };
  const getAutoLockMinutes = typeof deps.getAutoLockMinutes === 'function' ? deps.getAutoLockMinutes : () => 10;
  const now = typeof deps.now === 'function' ? deps.now : Date.now;
  const setT = typeof deps.setTimeout === 'function' ? deps.setTimeout : setTimeout;
  const clearT = typeof deps.clearTimeout === 'function' ? deps.clearTimeout : clearTimeout;

  /** @type {Map<string, Buffer>} session-scoped vault keys (fresh-buffer copies). */
  const keys = new Map();
  /** @type {Set<string>} unlocked vault ids (mirrors keys.keys()). */
  const unlockedIds = new Set();
  // Per-vault GRANT that opened each key (PR#112 finding 2): `{ mode:'access', keyId }`
  // for a per-jar access key, or `{ mode:'admin', adminPub }` for the admin key. Revalidated
  // per operation so a REVOKED access key (its envelope deleted) or a ROTATED admin key (the
  // manager's admin pubkey changed) drops the affected live keys IMMEDIATELY — not only at
  // teardown/idle. Without this, revocation/rotation prevents only FUTURE unlocks; an already
  // -unlocked session kept filling/listing/TOTP-ing until it happened to expire.
  /** @type {Map<string, { mode: 'access', keyId: string } | { mode: 'admin', adminPub: string }>} */
  const grants = new Map();
  /** @type {any} */
  let timer = null;

  function clearTimer() {
    if (timer !== null) {
      clearT(timer);
      timer = null;
    }
  }

  /**
   * Zeroize every session key Buffer and clear the maps + idle timer. Idempotent
   * — safe to call on transport teardown, on an idle fire, and again after.
   */
  function zeroize() {
    clearTimer();
    for (const buf of keys.values()) {
      try { buf.fill(0); } catch { /* not a Buffer / already gone */ }
    }
    keys.clear();
    unlockedIds.clear();
    grants.clear();
  }

  /**
   * Drop a single vault's session key (zeroize + forget its grant). Used by revalidate()
   * when a grant no longer holds, and shared with setKey's re-unlock path.
   * @param {string} vaultId
   */
  function dropVault(vaultId) {
    const buf = keys.get(vaultId);
    if (buf) { try { buf.fill(0); } catch { /* ignore */ } }
    keys.delete(vaultId);
    unlockedIds.delete(vaultId);
    grants.delete(vaultId);
  }

  /**
   * Revalidate every unlocked vault against its GRANT (PR#112 finding 2), dropping any
   * whose authorization no longer holds ON DISK:
   *   - `access` grant → the opening `access` envelope must still exist (a revoked key
   *     had its envelope deleted → drop);
   *   - `admin` grant → the manager's admin pubkey must be UNCHANGED (a rotateAdminKey
   *     overwrote it → the session's admin-derived keys are stale → drop).
   * Any read error (deleted vault / gone manager) is treated as "no longer authorized" →
   * drop. Called at the top of every vault op so revocation/rotation takes effect on the
   * NEXT operation, never lingering until teardown/idle.
   */
  function revalidate() {
    for (const vaultId of [...unlockedIds]) {
      const grant = grants.get(vaultId);
      let stillValid;
      try {
        if (grant && grant.mode === 'access') {
          // A store without the probe (a minimal test fake) cannot be revalidated → keep.
          stillValid = typeof vaultStore.accessEnvelopeExists === 'function'
            ? vaultStore.accessEnvelopeExists(vaultId, grant.keyId)
            : true;
        } else if (grant && grant.mode === 'admin') {
          stillValid = typeof vaultStore.adminPublicKey === 'function'
            ? vaultStore.adminPublicKey() === grant.adminPub
            : true;
        } else {
          stillValid = true; // no grant recorded (older path) → nothing to revalidate against.
        }
      } catch {
        stillValid = false; // manager/vault unreadable → fail-closed, drop the key.
      }
      if (!stillValid) dropVault(vaultId);
    }
  }

  /**
   * Reset the idle auto-lock timer (DD5 belt-and-suspenders backstop for a client
   * that holds no stream to signal an ungraceful drop). Called on every vault op.
   * Only arms while something is unlocked; a fired timer zeroizes the session.
   */
  function touch() {
    clearTimer();
    if (keys.size === 0) return;
    const mins = getAutoLockMinutes();
    const safeMins = typeof mins === 'number' && mins >= 1 ? mins : 10;
    timer = setT(() => { zeroize(); }, safeMins * 60 * 1000);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  /**
   * Install a fresh key Buffer for a vault id, zeroizing any prior buffer for the
   * same id (a re-unlock).
   * @param {string} vaultId
   * @param {Buffer} key
   */
  function setKey(vaultId, key, grant) {
    const prev = keys.get(vaultId);
    if (prev && prev !== key) {
      try { prev.fill(0); } catch { /* ignore */ }
    }
    keys.set(vaultId, key);
    unlockedIds.add(vaultId);
    if (grant) grants.set(vaultId, grant); // finding 2: remember what authorized this key.
  }

  /**
   * Unlock this session's reachable vaults from the presented access key.
   *   - jar identity  → `unlockVaultWithAccessKey(jarId, accessKey)` (its OWN
   *     vault only; a per-jar access key holds no envelope for global/siblings).
   *   - admin identity → `openAllWithAdminKey(accessKey)` (the X25519 admin private
   *     key opens the MRK → every vault key), merged into `keys`.
   * A wrong/foreign key opens nothing → normal `{ unlocked: [] }` (DD6), NOT a throw.
   * @param {string} identity  jarId | 'admin'
   * @param {string} accessKey
   * @returns {{ unlocked: string[] }}
   */
  function unlock(identity, accessKey) {
    /** @type {string[]} */
    const opened = [];
    try {
      if (identity === 'admin') {
        const map = vaultStore.openAllWithAdminKey(accessKey);
        // Capture the admin pubkey ONCE as the grant marker (finding 2): a rotateAdminKey
        // overwrites it, so per-op revalidation drops these admin-derived keys after rotation.
        const adminPub = typeof vaultStore.adminPublicKey === 'function' ? vaultStore.adminPublicKey() : null;
        for (const [vaultId, key] of map) {
          setKey(vaultId, key, { mode: 'admin', adminPub });
          opened.push(vaultId);
        }
      } else {
        // Record the opening access-envelope keyId as the grant (finding 2): revoking THAT
        // key (envelope deletion) drops this session's key on its next op. A minimal fake
        // store without openVaultWithAccessKey falls back to the keyless unlock (no grant).
        if (typeof vaultStore.openVaultWithAccessKey === 'function') {
          const { key, keyId } = vaultStore.openVaultWithAccessKey(identity, accessKey);
          setKey(identity, key, { mode: 'access', keyId });
        } else {
          setKey(identity, vaultStore.unlockVaultWithAccessKey(identity, accessKey));
        }
        opened.push(identity);
      }
    } catch {
      // Wrong/foreign key (or an absent vault) opens nothing — a NORMAL result
      // (DD6), never a throw. The accessKey is never surfaced anywhere.
    }
    touch();
    return { unlocked: opened };
  }

  /**
   * Decrypt every unlocked vault's items with its session key. Never caches
   * plaintext — decrypts on demand so the only long-lived secret is the key Buffer.
   * @returns {Array<{ vaultId: string, item: any }>}
   */
  function unlockedItems() {
    const out = [];
    for (const vaultId of unlockedIds) {
      const key = keys.get(vaultId);
      if (!key) continue;
      let items;
      try {
        items = vaultStore.readVaultItems(vaultId, key);
      } catch {
        items = [];
      }
      for (const item of items) out.push({ vaultId, item });
    }
    return out;
  }

  /**
   * List METADATA of the login items in this session's unlocked vaults — origin,
   * username, has-TOTP, vault id, id, title. NEVER the password / TOTP secret /
   * card data. An empty context (nothing unlocked) lists as empty.
   */
  function list() {
    touch();
    revalidate(); // finding 2: drop any key whose grant (access envelope / admin pubkey) no longer holds.
    const rows = [];
    for (const { vaultId, item } of unlockedItems()) {
      if (!item || item.type !== 'login') continue;
      rows.push({
        vaultId,
        id: item.id,
        title: item.title ?? null,
        origin: item.origin ?? null,
        username: item.username ?? null,
        hasTotp: !!item.totp,
      });
    }
    return rows;
  }

  /**
   * Resolve a login/TOTP item by its COMPOSITE identity across this session's
   * unlocked vaults (PR#112 finding 6). Item ids are unique only WITHIN a vault —
   * importing the same bundle into two destinations makes `id` collide across
   * vaults — so a bare `itemId` is ambiguous in a multi-vault (e.g. admin) session.
   *   - `vaultId` supplied → match the exact (vaultId, itemId) pair (unambiguous).
   *   - `vaultId` absent + exactly one vault holds the id → that item (back-compat
   *     for single-vault sessions).
   *   - `vaultId` absent + the id is in >1 unlocked vault → `{ ambiguous: true }`,
   *     so the caller refuses rather than silently filling the WRONG credential.
   * @param {string} itemId
   * @param {string} [vaultId]
   * @param {(item: any) => boolean} [accept]  extra predicate (e.g. type === 'login').
   * @returns {{ item: any, vaultId?: string, ambiguous?: boolean }}
   */
  function resolveItem(itemId, vaultId, accept) {
    /** @type {{ item: any, vaultId?: string, ambiguous?: boolean } | null} */
    let found = null;
    for (const { vaultId: vid, item } of unlockedItems()) {
      if (!item || item.id !== itemId) continue;
      if (accept && !accept(item)) continue;
      if (vaultId != null && vid !== vaultId) continue;
      if (found) return { item: null, ambiguous: true };
      found = { item, vaultId: vid };
    }
    return found || { item: null };
  }

  /**
   * Return ONLY the current TOTP code for a named unlocked item — never the
   * secret. `code` is null when the item is absent / not unlocked / has no TOTP /
   * ambiguous across vaults without a `vaultId` (finding 6). When resolved, echoes
   * the item's `vaultId` so the caller can disambiguate a subsequent fill.
   * @param {string} itemId
   * @param {string} [vaultId]  optional composite qualifier (from vaultList).
   */
  function totp(itemId, vaultId) {
    touch();
    revalidate(); // finding 2: revoked/rotated grants drop their keys before this reads them.
    const hit = resolveItem(itemId, vaultId, (item) => !!item.totp);
    if (!hit.item) return { id: itemId, code: null };
    const params = vc.parseOtpauth(hit.item.totp);
    const code = vc.totp(params.secret, params, now());
    return { id: itemId, code };
  }

  /**
   * Resolve the target tab's live webContents, enforcing reachability by identity:
   *   - jar   → `resolveContentsForJar(wcId, jar, deps)` — THROWS `automation:
   *     out-of-jar` on a foreign/sibling tab (the membership linchpin).
   *   - admin → `resolveContents(wcId, { allowInternal: true, … })` — reaches any tab.
   * @param {string} identity
   * @param {number} wcId
   * @param {FillEngineDeps} engineDeps
   * @returns {any} the resolved webContents
   */
  function resolveTarget(identity, wcId, engineDeps) {
    const fromId = engineDeps.fromId;
    const chromeContents = typeof engineDeps.getChromeContents === 'function'
      ? engineDeps.getChromeContents()
      : undefined;
    const chromeDep = typeof engineDeps.isChromeContents === 'function'
      ? { isChromeContents: engineDeps.isChromeContents }
      : {};
    if (identity === 'admin') {
      return resolveContents(wcId, { fromId, allowInternal: true, chromeContents, ...chromeDep });
    }
    const jar = (engineDeps.jars && typeof engineDeps.jars.list === 'function'
      ? engineDeps.jars.list()
      : []).find((j) => j.id === identity);
    if (!jar) {
      throw new Error('automation: no-such-jar — jar ' + identity + ' is not present (revoked or deleted)');
    }
    return resolveContentsForJar(wcId, jar, {
      fromId,
      fromPartition: engineDeps.fromPartition,
      chromeContents,
      ...chromeDep,
    });
  }

  /**
   * Fill an origin-matched login credential into the target tab. Steps:
   *   1. touch() (reset idle timer);
   *   2. locked? → normal `{ filled: false, reason: 'locked' }` (DD6);
   *   3. resolve + jar-membership-check the target tab (THROWS out-of-jar on a
   *      foreign tab — a genuine error, isError at the boundary);
   *   4. look up the login item by id across unlocked reachable vaults;
   *   5. origin-match the resolved tab's origin against the item — a mismatch (or
   *      no such item) is a NORMAL `{ filled: false }` (DD6), delegate NOT called;
   *   6. hand `{ wcId, credential }` to the INJECTED fill delegate;
   *   7. return `{ filled: true, id, origin }` — the credential/password is NEVER
   *      returned; `origin` is the resolved (non-secret) top-frame origin.
   * @param {string} identity  jarId | 'admin'
   * @param {{ wcId: number, itemId: string, vaultId?: string }} target  `vaultId`
   *   disambiguates a duplicated item id across unlocked vaults (finding 6).
   * @param {FillEngineDeps} [engineDeps]
   * @returns {{ filled: boolean, id?: string, origin?: string, reason?: string }}
   */
  function fill(identity, { wcId, itemId, vaultId }, engineDeps = {}) {
    touch();
    revalidate(); // finding 2: a revoked access key / rotated admin key drops its key BEFORE a fill.
    if (keys.size === 0) return { filled: false, reason: 'locked' };

    // (3) reachability + membership — throws automation: out-of-jar on a foreign tab.
    const wc = resolveTarget(identity, wcId, engineDeps);
    const tabOrigin = originOf(typeof wc.getURL === 'function' ? wc.getURL() : '');

    // (4) resolve the login item by its COMPOSITE identity (finding 6). A bare
    // itemId duplicated across unlocked vaults (same bundle imported twice) is
    // AMBIGUOUS — refuse rather than fill the wrong vault's credential; the caller
    // passes `vaultId` (from vaultList) to select the intended one.
    const hit = resolveItem(itemId, vaultId, (item) => item.type === 'login');
    if (hit.ambiguous) return { filled: false, reason: 'ambiguous' };
    const found = hit.item;
    if (!found) return { filled: false, reason: 'no-match' };

    // (5) top-frame origin match — exact by default, widened to the registrable domain
    // for a `matchMode:'registrable-domain'` item behind the fail-closed matcher (M12 F4
    // Leg 4 / DD5). A mismatch is a normal no-fill, delegate untouched.
    if (!tabOrigin || !originMatches(found, tabOrigin, { widen: true })) {
      return { filled: false, reason: 'origin-mismatch' };
    }

    // (6) hand the credential to the fill delegate — NEVER returned across the MCP boundary.
    const credential = { username: found.username, password: found.password };
    fillDelegate({ wcId, credential });

    // (7) the tool result carries NO password/secret — only the resolved
    // top-frame origin (non-secret; the client drove the fill into this wcId and
    // can already read its URL via enumerateTabs). Audit records it via DD6.
    return { filled: true, id: itemId, origin: tabOrigin };
  }

  return { unlock, list, totp, fill, touch, zeroize };
}

module.exports = { createVaultContext };
