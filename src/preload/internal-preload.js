'use strict';

// Preload for trusted internal `goldfinch://` pages (the Settings page).
// Runs under contextIsolation:true + sandbox:true (set at the `tab-create` handler's
// trusted branch when constructing the internal WebContentsView). In a sandbox:true + contextIsolation:true preload,
// `location` IS available and reflects the URL being loaded at the time the preload
// is injected — so `location.origin` reads 'goldfinch://settings' for the real settings
// page and the web origin for any other content.
//
// The main-side registerInternalHandler check is the AUTHORITATIVE security boundary.
// This guard is defense-in-depth: even if the preload runs in the wrong context (e.g.
// after a navigation into web content — webPreferences are immutable post-attach), the
// bridge simply isn't exposed, and any stored reference to it would fail at the
// main-side origin check anyway.

const { contextBridge, ipcRenderer } = require('electron');

// The internal-origin allowlist (Flight 5, extended Flight 3 F3). The trust boundary is
// "internal page vs web," NOT "settings vs downloads vs jars" — every inhabitant is an
// equally-trusted internal origin, so the SAME bridge (settings + shields + automation +
// downloads + jars methods) is exposed to each. The downloads/jars methods are inert on
// the settings page (it never calls them) and the main-side registerInternalHandler
// origin check gates them regardless.
const INTERNAL_ORIGINS = new Set(['goldfinch://settings', 'goldfinch://downloads', 'goldfinch://jars', 'goldfinch://vault']);

// Only expose the bridge when this preload is running in a genuine internal page.
// When the origin does not match, expose NOTHING — not even `version`.
if (INTERNAL_ORIGINS.has(location.origin)) {
  // DD5: listener-handle map — lets on() return a numeric handle and off(h) remove
  // the exact wrapper, preventing accumulation across guest reloads (electronmon
  // reloads the goldfinch://settings guest; without off/pagehide cleanup, each reload
  // would leave an extra ipcRenderer listener permanently registered in the preload).
  // contextBridge cannot return a function, but it CAN return a number, so handles
  // are the right cross-boundary currency.
  let nextHandle = 1;
  const listeners = new Map();

  /**
   * Register a wrapper for channel and return a numeric handle.
   * @param {string} channel
   * @param {(x: any) => void} cb
   * @returns {number}
   */
  function on(channel, cb) {
    const wrapper = (_e, x) => cb(x);
    const h = nextHandle++;
    listeners.set(h, { channel, wrapper });
    ipcRenderer.on(channel, wrapper);
    return h;
  }

  /**
   * Remove the listener registered under handle h.
   * @param {number} h
   */
  function off(h) {
    const e = listeners.get(h);
    if (e) {
      ipcRenderer.removeListener(e.channel, e.wrapper);
      listeners.delete(h);
    }
  }

  contextBridge.exposeInMainWorld('goldfinchInternal', {
    version: 1,

    /**
     * Read a single setting by key, or all settings if key is omitted/falsy.
     * @param {string} [key]
     * @returns {Promise<any>}
     */
    settingsGet: (key) => ipcRenderer.invoke('internal-settings-get', key),

    /**
     * Write a single setting. Resolves with the updated config; rejects if the
     * key is unknown or the value fails validation (main-side set() throws).
     * @param {string} key
     * @param {unknown} value
     * @returns {Promise<any>}
     */
    settingsSet: (key, value) => ipcRenderer.invoke('internal-settings-set', key, value),

    /**
     * Subscribe to settings-changed broadcasts.
     * cb receives the full updated config object.
     * Returns a numeric handle for use with offSettingsChanged.
     * @param {(all: object) => void} cb
     * @returns {number}
     */
    onSettingsChanged: (cb) => on('settings-changed', cb),

    /**
     * Unsubscribe the settings-changed listener registered under handle h.
     * Call from a pagehide handler to prevent accumulation across reloads.
     * @param {number} h
     */
    offSettingsChanged: (h) => off(h),

    /**
     * Read the current global Shields config.
     * @returns {Promise<object>}
     */
    shieldsGet: () => ipcRenderer.invoke('internal-shields-get'),

    /**
     * Write a partial Shields config patch. Resolves with the updated config;
     * broadcasts shields-changed to both the chrome and all internal guests.
     * @param {object} patch
     * @returns {Promise<object>}
     */
    shieldsSet: (patch) => ipcRenderer.invoke('internal-shields-set', patch),

    /**
     * Subscribe to shields-changed broadcasts.
     * cb receives the updated shields config object.
     * Returns a numeric handle for use with offShieldsChanged.
     * @param {(cfg: object) => void} cb
     * @returns {number}
     */
    onShieldsChanged: (cb) => on('shields-changed', cb),

    /**
     * Unsubscribe the shields-changed listener registered under handle h.
     * Call from a pagehide handler to prevent accumulation across reloads.
     * @param {number} h
     */
    offShieldsChanged: (h) => off(h),

    // Automation status/address (Flight 5, Leg 2). Activity listeners are Leg 4.

    /**
     * Read the live automation-surface status.
     * @returns {Promise<{ enabled: boolean, host: string, port: number, bound: boolean, error: (string|null) }>}
     */
    automationGetStatus: () => ipcRenderer.invoke('automation:get-status'),

    /**
     * Persist the automation port and live-rebind the running surface to it
     * (Flight 5, Leg 7). Resolves with the fresh status; rejects ("Invalid port")
     * when the value fails the main-side validator.
     * @param {number} port
     * @returns {Promise<{ enabled: boolean, host: string, port: number, bound: boolean, error: (string|null) }>}
     */
    automationSetPort: (port) => ipcRenderer.invoke('automation:set-port', port),

    /**
     * Advisory scan for a free loopback port for the "find free port" affordance.
     * @returns {Promise<{ port: (number|null) }>}
     */
    automationFindFreePort: () => ipcRenderer.invoke('automation:find-free-port'),

    /**
     * Write text to the system clipboard (fallback when navigator.clipboard is
     * blocked at runtime under contextIsolation + sandbox — DD4).
     * @param {string} text
     * @returns {Promise<{ ok: boolean }>}
     */
    clipboardWrite: (text) => ipcRenderer.invoke('clipboard:write', text),

    // Automation key management (Flight 5, Leg 3 / SC9). Mint returns the
    // show-once plaintext; list/revoke deal in hashes only (never plaintext).

    /**
     * List jars joined with key presence, plus the admin env gate + admin-key
     * state. Never returns hashes or plaintext.
     * @returns {Promise<{ jars: Array<{ id: string, name: string, color: string, hasKey: boolean }>, adminEnabled: boolean, adminKeySet: boolean }>}
     */
    automationListKeys: () => ipcRenderer.invoke('automation:list-keys'),

    /**
     * Generate (or rotate) the per-jar automation key; returns the show-once
     * plaintext. Rejects for an unknown/burner jarId.
     * @param {string} jarId
     * @returns {Promise<{ key: string }>}
     */
    automationJarKeyMint: (jarId) => ipcRenderer.invoke('automation:jar-key-mint', jarId),

    /**
     * Revoke the per-jar automation key (deletes its hash). No-op if absent.
     * @param {string} jarId
     * @returns {Promise<{ ok: boolean }>}
     */
    automationJarKeyRevoke: (jarId) => ipcRenderer.invoke('automation:jar-key-revoke', jarId),

    /**
     * Generate (or rotate) the admin key; returns the show-once plaintext, or
     * { key: null } when the GOLDFINCH_AUTOMATION_ADMIN env gate is unset.
     * @returns {Promise<{ key: (string|null) }>}
     */
    automationAdminKeyMint: () => ipcRenderer.invoke('automation:admin-key-mint'),

    /**
     * Revoke the admin key (clears its hash).
     * @returns {Promise<{ ok: boolean }>}
     */
    automationAdminKeyRevoke: () => ipcRenderer.invoke('automation:admin-key-revoke'),

    // Automation activity (Flight 5, Leg 4 / SC10 / DD6). Read-only audit snapshot
    // ({ sessions, log }) + live broadcast for the settings-page Activity viewer.

    /**
     * Read the current automation activity snapshot (active sessions + action log).
     * Carries no key/hash. Returns { sessions: [], log: [] } when the surface is off.
     * @returns {Promise<{ sessions: any[], log: any[] }>}
     */
    automationGetActivity: () => ipcRenderer.invoke('automation:get-activity'),

    /**
     * Subscribe to automation-activity-changed broadcasts.
     * cb receives the updated { sessions, log } snapshot.
     * Returns a numeric handle for use with offAutomationActivity.
     * @param {(snap: { sessions: any[], log: any[] }) => void} cb
     * @returns {number}
     */
    onAutomationActivity: (cb) => on('automation-activity-changed', cb),

    /**
     * Unsubscribe the automation-activity listener registered under handle h.
     * Call from a pagehide handler to prevent accumulation across reloads.
     * @param {number} h
     */
    offAutomationActivity: (h) => off(h),

    // Downloads surface (Flight 5, Leg 2). The goldfinch://downloads page is the only
    // caller; these are inert on the settings page. The actionable savePath is NEVER
    // passed from the renderer — main resolves it by id from the trusted manager/store
    // for open/show (avoids an arbitrary-open vector).

    /**
     * Read the full merged downloads list (in-progress + persisted terminal,
     * deduped by id). Plain records; no live DownloadItem references.
     * @returns {Promise<Array<object>>}
     */
    downloadsList: () => ipcRenderer.invoke('internal-downloads-list'),

    /**
     * Dispatch a single per-item action by id. `action` ∈
     * {'pause','resume','cancel','remove','retry','open','show'} (main-side
     * allowlisted). No-ops on a missing/pruned id.
     * @param {number} id
     * @param {string} action
     * @returns {Promise<{ ok: boolean }>}
     */
    downloadsAction: (id, action) => ipcRenderer.invoke('internal-downloads-action', { id, action }),

    /**
     * Clear the terminal download history (in-progress items stay). Files are
     * NOT deleted from disk — history only.
     * @returns {Promise<{ ok: boolean }>}
     */
    downloadsClear: () => ipcRenderer.invoke('internal-downloads-clear'),

    /**
     * Subscribe to live downloads changes over the existing id-keyed
     * download-progress / download-done broadcasts. cb receives the broadcast
     * payload (carries `id`). Returns a tuple of handles for offDownloadsChanged.
     * @param {(payload: object) => void} cb
     * @returns {number[]}
     */
    onDownloadsChanged: (cb) => [on('download-progress', cb), on('download-done', cb)],

    /**
     * Unsubscribe the listeners registered by onDownloadsChanged.
     * @param {number[]} handles
     */
    offDownloadsChanged: (handles) => {
      if (Array.isArray(handles)) for (const h of handles) off(h);
    },

    // Cookie-jar registry surface (Flight 3, Leg 1). The goldfinch://jars page is the
    // only caller; wrappers are thin ipcRenderer.invoke calls onto the internal-origin-
    // gated internal-jars-* channels (registerJarIpc / jar-ipc.js), which share their
    // exact handler bodies with the chrome-trusted jars-* channels the picker uses.

    /**
     * List every persistent jar (Burner is never a store entry — compose it
     * separately via jarsGetDefault()/the BURNER constant).
     * @returns {Promise<Array<{id:string,name:string,color:string,partition:string}>>}
     */
    jarsList: () => ipcRenderer.invoke('internal-jars-list'),

    /**
     * Create a new jar. Resolves with the created container, or null for an
     * invalid payload (missing/non-string name).
     * @param {{name:string,color?:string}} payload
     * @returns {Promise<object|null>}
     */
    jarsAdd: (payload) => ipcRenderer.invoke('internal-jars-add', payload),

    /**
     * Rename/recolor an existing jar — id/partition are immutable, so this is the
     * ONLY mutation entry for both name and color. Resolves with the updated
     * container, or null for an unknown id.
     * @param {{id:string,name?:string,color?:string}} payload
     * @returns {Promise<object|null>}
     */
    jarsRename: (payload) => ipcRenderer.invoke('internal-jars-rename', payload),

    /**
     * Delete a jar: wipes its storage/cache, rerolls its fingerprint seed, and
     * revokes its automation key. Resolves with the removal result; the
     * renderer's jars-changed subscriber closes the jar's open tabs.
     * @param {{id:string}} payload
     * @returns {Promise<{ok:boolean, removed?:object, wiped?:boolean}>}
     */
    jarsRemove: (payload) => ipcRenderer.invoke('internal-jars-remove', payload),

    /**
     * Move the default flag to an existing jar. Resolves true on success, false
     * for an unknown id (or an explicit { id: null } while jars still exist).
     * @param {{id:string|null}} payload
     * @returns {Promise<boolean>}
     */
    jarsSetDefault: (payload) => ipcRenderer.invoke('internal-jars-set-default', payload),

    /**
     * Read the current default jar object, or the BURNER identity clone when no
     * persistent jar holds the flag. Compare by id, never by reference — this
     * crosses IPC as a structured-clone of the frozen BURNER constant.
     * @returns {Promise<{id:string,name:string,color:string}>}
     */
    jarsGetDefault: () => ipcRenderer.invoke('internal-jars-get-default'),

    // Per-jar data controls (Flight 4, Leg 1). Same internal-origin-gated
    // internal-jars-* trust domain as the registry wrappers above.

    /**
     * Clear one or more data classes (cookies/storage/cache — see
     * src/shared/jar-data-classes.js) from a jar's partition. Strict
     * fail-closed: an unknown jar id (Burner is never a store entry, so it
     * always rejects), an empty/non-array `classes`, or ANY unknown class id
     * rejects with { ok: false } and no session call at all.
     * @param {{id:string, classes:string[]}} payload
     * @returns {Promise<{ok:boolean, cleared?:string[], error?:string}>}
     */
    jarsClearData: (payload) => ipcRenderer.invoke('internal-jars-clear-data', payload),

    /**
     * Full identity wipe for a jar: clears every storage class + cache and
     * rerolls its fingerprint seed (the jar itself and its automation key are
     * untouched — only delete removes those). Broadcasts `jar-wiped { id }`
     * BEFORE resolving on success. Rejects the same way as jarsClearData for
     * burner/unknown ids.
     * @param {{id:string}} payload
     * @returns {Promise<{ok:boolean, error?:string}>}
     */
    jarsWipe: (payload) => ipcRenderer.invoke('internal-jars-wipe', payload),

    /**
     * Set a jar's retention window in days (M08 Flight 3, Leg 1 / flight DD4).
     * Rejects (never coerces) an invalid `days` — 0, non-integer,
     * out-of-range, or non-numeric — with { ok: false, error }; same for an
     * unknown jar id or malformed payload. On success also prunes the jar's
     * history immediately to the new window (rows older than the new
     * retention are deleted right away) and resolves { ok: true, container }.
     * @param {{id:string, days:number}} payload
     * @returns {Promise<{ok:boolean, container?:object, error?:string}>}
     */
    jarsSetRetention: (payload) => ipcRenderer.invoke('internal-jars-set-retention', payload),

    /**
     * Subscribe to jars-changed broadcasts. cb receives { containers, defaultId }
     * (defaultId null ⇔ Burner holds the flag). Returns a numeric handle for use
     * with offJarsChanged.
     * @param {(payload:{containers:Array<object>, defaultId:(string|null)}) => void} cb
     * @returns {number}
     */
    onJarsChanged: (cb) => on('jars-changed', cb),

    /**
     * Unsubscribe the jars-changed listener registered under handle h. Call from
     * a pagehide handler to prevent accumulation across reloads.
     * @param {number} h
     */
    offJarsChanged: (h) => off(h),

    // Cookies + Other-site-data panel surface (M10 Flight 2, Leg 2 / flight
    // DD2, DD3 VERDICT). Same internal-origin-gated internal-jars-* trust
    // domain as every other jars wrapper above.

    /**
     * List a jar's live session cookies (name/domain/path/expiry/flags — NO
     * `value` field, DD7 least-privilege). Rejects the same way as
     * jarsClearData for a malformed payload or unknown jar id.
     * @param {{id:string}} payload
     * @returns {Promise<{ok:boolean, cookies?:Array<{name:string,domain:string,path:string,expirationDate:(number|null),secure:boolean,hostOnly:boolean,session:boolean}>, error?:string}>}
     */
    jarsCookiesList: (payload) => ipcRenderer.invoke('internal-jars-cookies-list', payload),

    /**
     * Remove a single cookie by its listed identity (name/domain/path/secure
     * — the same fields jarsCookiesList returns, never a value). Resolves
     * { ok: true } on success (idempotent — removing an already-gone cookie
     * still resolves ok); { ok: false, error } for a malformed payload,
     * unknown jar, or a session-layer failure.
     * @param {{id:string, name:string, domain:string, path?:string, secure?:boolean}} payload
     * @returns {Promise<{ok:boolean, error?:string}>}
     */
    jarsCookiesRemove: (payload) => ipcRenderer.invoke('internal-jars-cookies-remove', payload),

    /**
     * Reveal a single cookie's value on demand (F3 HAT walkthrough
     * fix-rider, operator-requested). Payload carries the listed cookie's
     * exact identity (name/domain/path — the same fields jarsCookiesList
     * returns), matched client-side to that EXACT triple (never a
     * subdomain-matching lookup). Resolves { ok: true, value } on a match;
     * { ok: false, error } for a malformed payload, unknown jar, a
     * no-longer-present cookie ('not-found'), or a session-layer failure.
     * @param {{id:string, name:string, domain:string, path:string}} payload
     * @returns {Promise<{ok:boolean, value?:string, error?:string}>}
     */
    jarsCookiesValue: (payload) => ipcRenderer.invoke('internal-jars-cookies-value', payload),

    /**
     * List a jar's storage-bearing origins: the composite union (DD3
     * VERDICT) of IndexedDB-confirmed origins (tier 'stored') and
     * history-derived origins (tier 'visited') — NO usage/quota figure
     * (verified unavailable). A jar with no storage path or no history
     * yields an empty (not error) list.
     * @param {{id:string}} payload
     * @returns {Promise<{ok:boolean, origins?:Array<{origin:string, tier:('stored'|'visited')}>, error?:string}>}
     */
    jarsSiteDataList: (payload) => ipcRenderer.invoke('internal-jars-sitedata-list', payload),

    /**
     * Clear one origin's storage (the site-data storage-class set, cookies
     * excluded — see src/shared/jar-data-classes.js's 'storage' descriptor).
     * A `visited`-tier origin with no actual storage is a silent no-op
     * success (the delete acts on storage, not history — known-gap note in
     * the panel). Rejects the same way as jarsCookiesRemove otherwise.
     * @param {{id:string, origin:string}} payload
     * @returns {Promise<{ok:boolean, error?:string}>}
     */
    jarsSiteDataRemoveOrigin: (payload) => ipcRenderer.invoke('internal-jars-sitedata-remove-origin', payload),

    /**
     * Subscribe to jar-data-changed broadcasts (DD10) — fired by
     * jars-clear-data (cookies/storage classes) and jars-wipe. cb receives
     * { jarId, classes }; per the invalidation-signal convention every other
     * *-changed subscription in this file follows, treat this as a
     * re-query trigger, never a source of truth for the payload's own data.
     * Returns a numeric handle for use with offJarDataChanged.
     * @param {(payload:{jarId:string, classes:string[]}) => void} cb
     * @returns {number}
     */
    onJarDataChanged: (cb) => on('jar-data-changed', cb),

    /**
     * Unsubscribe the jar-data-changed listener registered under handle h.
     * Call from a pagehide handler to prevent accumulation across reloads.
     * @param {number} h
     */
    offJarDataChanged: (h) => off(h),

    // Per-jar history surface (M08 Flight 1 Leg 3 / DD9). The history UI has no
    // page of its own — it renders inside goldfinch://jars — so these wrappers
    // are thin ipcRenderer.invoke calls onto the internal-origin-gated
    // internal-history-* channels (registerHistoryIpc / history-ipc.js), which
    // share their exact handler bodies with the chrome-trusted history-*
    // channels (no chrome-preload consumer this flight — see history-ipc.js).

    /**
     * Offset-paged visits for the History panel's numbered pager bar
     * (H1/H5, M08 F6 Leg 4 — replaces the removed historyList/history-list).
     * Rejects on an unknown jar id or malformed args (non-positive-integer
     * page/pageSize included) with { ok: false, error }.
     * @param {{jarId:string, page:number, pageSize?:number}} payload
     * @returns {Promise<{ok:boolean, visits?:Array<object>, total?:number, error?:string}>}
     */
    historyPage: (payload) => ipcRenderer.invoke('internal-history-page', payload),

    /**
     * Full-text search a jar's history. Rejects the same way as historyPage.
     * @param {{jarId:string, query:string, limit?:number}} payload
     * @returns {Promise<any>}
     */
    historySearch: (payload) => ipcRenderer.invoke('internal-history-search', payload),

    /**
     * Delete a single visit by id, scoped to the jar. Resolves { ok: false,
     * error: 'history: delete — not-found' } when the visit doesn't exist.
     * @param {{jarId:string, visitId:number}} payload
     * @returns {Promise<any>}
     */
    historyDelete: (payload) => ipcRenderer.invoke('internal-history-delete', payload),

    /**
     * Clear all visits for a jar. Idempotent — clearing an empty jar resolves
     * { ok: true, cleared: 0 } with no broadcast.
     * @param {{jarId:string}} payload
     * @returns {Promise<any>}
     */
    historyClear: (payload) => ipcRenderer.invoke('internal-history-clear', payload),

    /**
     * Read the live visit count for a jar (M08 Flight 2, Leg 1 / flight DD6).
     * Rejects the same way as historyPage/historySearch on a malformed
     * payload or unknown jar id.
     * @param {{jarId:string}} payload
     * @returns {Promise<any>}
     */
    historyCount: (payload) => ipcRenderer.invoke('internal-history-count', payload),

    /**
     * Subscribe to history-changed broadcasts. cb receives { jarId }.
     * Returns a numeric handle for use with offHistoryChanged.
     * @param {(p: any) => void} cb
     * @returns {number}
     */
    onHistoryChanged: (cb) => on('history-changed', cb),

    /**
     * Unsubscribe the history-changed listener registered under handle h. Call
     * from a pagehide handler to prevent accumulation across reloads.
     * @param {number} h
     */
    offHistoryChanged: (h) => off(h),

    /**
     * Open a URL as a NEW TAB IN THE SAME JAR (H2, M08 Flight 6 Leg 4) — the
     * open-target for a History panel row link. Main validates the jar exists
     * and re-checks isSafeTabUrl(url) before forwarding to the chrome
     * renderer's open-tab -> inheritFromPartition path (defense-in-depth; the
     * downstream createTab untrusted branch checks it a second time too).
     * @param {{jarId:string, url:string}} payload
     * @returns {Promise<{ok:boolean, error?:string}>}
     */
    openTabInJar: (payload) => ipcRenderer.invoke('internal-open-tab-in-jar', payload),

    // Vault management surface (M12 Flight 3, Leg 1). The goldfinch://vault page is
    // the only caller; inert on the other internal pages, and the main-side
    // registerInternalHandler origin check gates it regardless. Leg 1 lands the
    // metadata-only state read (labels only — no MRK, no counts, NO SECRET); later
    // legs add CRUD / reveal / totp / access-key / setup / autolock wrappers here.

    /**
     * Read the vault manager's page state: whether it is set up, whether it is
     * unlocked, and the vault list (the manager-wide `global` vault plus each
     * persistent jar's vault) as LABELS ONLY — { vaultId, label }. No item counts
     * (they need the MRK — leg 2) and no secret ever crosses this channel.
     * @returns {Promise<{ setUp: boolean, unlocked: boolean, vaults: Array<{ vaultId: string, label: string, count?: number }> }>}
     */
    vaultState: () => ipcRenderer.invoke('internal-vault-state'),

    // Item CRUD surface (M12 Flight 3, Leg 2 / DD3, DD6, DD10). Metadata-only list +
    // explicit single-item reveal + preserving save + delete. A LOCKED store resolves
    // to a structured { locked: true } (never a serialized error string) so the page
    // can route to the unlock path.

    /**
     * Metadata-only item list for one vault (no secret ever). Resolves { items } or
     * the structured { locked: true }.
     * @param {string} vaultId
     * @returns {Promise<{ items?: Array<object>, locked?: boolean }>}
     */
    vaultList: (vaultId) => ipcRenderer.invoke('internal-vault-list', vaultId),

    /**
     * Reveal a SINGLE item in full (incl. secrets) by id — the explicit-reveal path.
     * Resolves { item } (item null when absent) or { locked: true }.
     * @param {{ vaultId: string, itemId: string }} payload
     * @returns {Promise<{ item?: (object|null), locked?: boolean }>}
     */
    vaultReveal: (payload) => ipcRenderer.invoke('internal-vault-reveal', payload),

    /**
     * Save a full item, preserving the masked-untouched secret fields named in
     * `unchangedSecrets` (resolved against the existing item in main). Resolves the
     * saved item's METADATA ({ item }) — never a secret — or { locked: true }.
     * @param {{ vaultId: string, item: object, unchangedSecrets: string[] }} payload
     * @returns {Promise<{ item?: object, locked?: boolean }>}
     */
    vaultItemSave: (payload) => ipcRenderer.invoke('internal-vault-item-save', payload),

    /**
     * Delete an item by id. Resolves { deleted } (false on a missing id) or
     * { locked: true }.
     * @param {{ vaultId: string, itemId: string }} payload
     * @returns {Promise<{ deleted?: boolean, locked?: boolean }>}
     */
    vaultItemDelete: (payload) => ipcRenderer.invoke('internal-vault-item-delete', payload),

    // Live TOTP code (M12 Flight 3, Leg 3 / DD4). The seed stays in main — this
    // resolves the current code + seconds-remaining ONLY (never the seed). { code: null }
    // when the item has no totp; { locked: true } when the store is locked. The page
    // polls per-period and counts down locally.

    /**
     * Fetch the current TOTP code + countdown for an item (computed in main; NEVER
     * the seed). Resolves { code, secondsRemaining }, { code: null }, or { locked: true }.
     * @param {{ vaultId: string, itemId: string }} payload
     * @returns {Promise<{ code?: (string|null), secondsRemaining?: number, locked?: boolean }>}
     */
    vaultTotpCode: (payload) => ipcRenderer.invoke('internal-vault-totp-code', payload),

    // First-run setup + unlock triggers (M12 Flight 3, Leg 4 / DD5). The page cannot
    // reach chrome-trust menuOverlay.*, so its not-set-up CTA / locked affordance invoke
    // these origin-gated channels; main forwards a bare trigger to the owning window's
    // chrome, which opens the chrome-owned vault-set / vault-unlock sheet. NO secret ever
    // crosses either channel (the password lives only on the sheet + in main). The page
    // moves to unlocked off the `vault-lock-state` broadcast below (also received by the
    // internal session), so neither invoke needs to return anything actionable.

    /** Request the first-run setup sheet (opens the chrome-owned vault-set card). */
    requestSetup: () => ipcRenderer.invoke('internal-vault-request-setup'),

    /** Request the unlock sheet (opens the F2 chrome-owned vault-unlock card — no
     * fill-picker continuation, distinct from the guest-gesture unlock). */
    requestUnlock: () => ipcRenderer.invoke('internal-vault-request-unlock'),

    /**
     * Explicit global LOCK (M12 F5 HAT batch 1, I6). Zeroizes ALL vault keys immediately —
     * global (not per-vault) and idempotent. Carries NO secret. The page moves to the locked
     * view off the `vault-lock-state` broadcast the store's onLock hook already emits (this
     * call does not re-broadcast). Resolves { ok: true }.
     * @returns {Promise<{ ok: boolean }>}
     */
    lockVault: () => ipcRenderer.invoke('internal-vault-lock'),

    // Access-key management (M12 Flight 3, Leg 5 / flight DD5, mission durable-grant step-up).
    // These are the vault-store `access` ENVELOPES — NOT the MCP automation transport tokens.
    // List + revoke ride internal channels (no secret ever crosses either — keyIds are
    // plaintext fingerprints); MINT rides the chrome-owned vault-stepup sheet (a fresh master
    // password on the sheet, never the page), triggered by requestMint below.

    /**
     * List a vault's access-key grants by keyId ONLY (no secret). Resolves { keys } or the
     * structured { locked: true }.
     * @param {string} vaultId
     * @returns {Promise<{ keys?: Array<{ keyId: string }>, locked?: boolean }>}
     */
    vaultAccessKeys: (vaultId) => ipcRenderer.invoke('internal-vault-accesskey-list', vaultId),

    /**
     * Revoke an access key by keyId — immediate. Resolves { revoked } (false for a stale
     * keyId) or { locked: true }.
     * @param {{ vaultId: string, keyId: string }} payload
     * @returns {Promise<{ revoked?: boolean, locked?: boolean }>}
     */
    vaultAccessKeyRevoke: (payload) => ipcRenderer.invoke('internal-vault-accesskey-revoke', payload),

    /** Request the access-key MINT sheet (opens the chrome-owned vault-stepup card scoped to
     * `target`). NO secret crosses here — the master password is entered on the sheet and the
     * minted secret is shown on the chrome-owned vault-accesskey-show sheet, never the page. */
    requestMint: (target) => ipcRenderer.invoke('internal-vault-request-mint', target),

    // Portable export / import (M12 Flight 4, Leg 1 / DD1 — Option A). Export is fully main-side:
    // the handler builds the ciphertext-only bundle from the store + runs the save dialog + writes
    // the file — the bundle never crosses to the page (the sandboxed page can't write files anyway).
    // Import is a two-step page flow: requestImport picks a destination + opens the bundle file
    // (main-side dialog + read + hold), then main opens the chrome-owned vault-import-unlock sheet
    // for the secret. NO secret ever crosses either channel.

    /**
     * Export a vault to a portable bundle file (save dialog runs in main). Resolves
     * { ok, path }, { canceled }, or the structured { locked: true } (a locked manager).
     * @param {string} target  `'global'` or a persistent jar id.
     * @returns {Promise<{ ok?: boolean, path?: string, canceled?: boolean, locked?: boolean }>}
     */
    exportVault: (target) => ipcRenderer.invoke('internal-vault-export', target),

    /**
     * Does this jar have a saved `.gfvault` file? (M12 F4 Leg 6.) Lets the jars
     * page's Delete confirm surface the export-first offer only for a vault-bearing
     * jar. A pure filesystem probe — no secret, non-throwing on a locked store.
     * @param {string} vaultId  `'global'` or a persistent jar id.
     * @returns {Promise<{ present: boolean }>}
     */
    hasVault: (vaultId) => ipcRenderer.invoke('internal-vault-has', vaultId),

    /**
     * Begin an import: open a bundle file (main-side dialog + read) for the given DESTINATION
     * target, then main opens the chrome-owned vault-import-unlock secret sheet. Resolves
     * { ok } (sheet opening), { canceled } (dialog dismissed), or { error }.
     * @param {string} destinationTarget  `'global'` or a persistent jar id.
     * @returns {Promise<{ ok?: boolean, canceled?: boolean, error?: string }>}
     */
    requestImport: (destinationTarget) => ipcRenderer.invoke('internal-vault-request-import', destinationTarget),

    // Key rotation / recover (M12 Flight 4, Leg 2 / DD3). All three are BARE cross-renderer
    // triggers: main opens the chrome-owned sheet that collects the secret(s) — NO secret ever
    // crosses these channels or enters the page DOM. rotate-recovery + change-master require the
    // manager unlocked (rotation-section actions); recover is reachable FROM the LOCKED page (the
    // recovery key is its own step-up + installs the MRK).

    /** Request the recovery-key ROTATION sheet (reuses the chrome-owned vault-stepup card for a
     * master-password step-up; the new recovery key is shown once on the recovery-show sheet). */
    requestRotateRecovery: () => ipcRenderer.invoke('internal-vault-request-rotate-recovery'),

    /** Request the admin-key PROVISION/ROTATE sheet (reuses the chrome-owned vault-stepup card for a
     * master-password step-up, mode 'rotate-admin'; the new admin private key is shown once on the
     * vault-adminkey-show sheet). M12 F4 Leg 3. */
    requestRotateAdmin: () => ipcRenderer.invoke('internal-vault-request-rotate-admin'),

    /** Request the master-password CHANGE sheet (chrome-owned vault-change-master card: old +
     * new + confirm; the old password is the step-up). */
    requestChangeMaster: () => ipcRenderer.invoke('internal-vault-request-change-master'),

    /** Request the RECOVER-after-forgotten-master sheet (chrome-owned vault-recover card:
     * recovery key + new + confirm; the recovery key is the step-up, installs the MRK). */
    requestRecover: () => ipcRenderer.invoke('internal-vault-request-recover'),

    /**
     * Subscribe to vault lock-state transitions (`{ setUp, unlocked }`). The vault page
     * re-queries its state on every push so setup / unlock move the page not-set-up →
     * locked → unlocked without a manual refresh. Returns a numeric handle for
     * offVaultLockState.
     * @param {(d: { setUp: boolean, unlocked: boolean }) => void} cb
     * @returns {number}
     */
    onVaultLockState: (cb) => on('vault-lock-state', cb),

    /**
     * Unsubscribe the vault-lock-state listener registered under handle h. Call from a
     * pagehide handler to prevent accumulation across reloads.
     * @param {number} h
     */
    offVaultLockState: (h) => off(h)
  });
}
// When origin does NOT match: expose nothing. The bridge does not exist for
// non-internal origins — no version, no methods, no surface.
