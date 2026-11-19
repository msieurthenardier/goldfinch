// @ts-check
'use strict';

// Vault wiring (Mission 24 Flight 3, leg 2): the lazy vault store and its lock fan-out, the
// lock-state broadcast, the import/restore delegates, the autolock holds, the compromise and
// sever state, the bundle save path and the lazy vault-human / browser-import-flow
// constructors. Moved verbatim out of main.js; Electron-FREE: every live handle is injected
// (a late-bound one as a getter), so it runs under node --test with fakes.
//
// NOT moved (composition primitives handed to many registrars and both createEngine sites,
// grep-pinned in main.js): gestureWitness, injectedInput, mediaProxyTokens, documentMarks and
// the revealGate construction. Only the lazy constructors live here.

const crypto = require('crypto');
const fs = require('fs');
const { validateExportPath } = require('./export-path');
const {
  mapVaultSheetError,
  VAULT_IMPORT_PREVIEW_CONFIG,
  VAULT_RESTORE_COMMIT_CONFIG
} = require('./vault-sheet-errors');
const { createVaultHuman } = require('./vault-human');
const { runVaultLockTeardown } = require('../vault-lock-teardown');
const { routeCaptureDropped } = require('../save-prompt-drop-router');
// The window-scoped held-import store (extracted + unit-tested in vault/pending-imports.js).
const { createPendingImportStore } = require('./pending-imports');
// M19 F1 Leg 1/2 (DD6): the browser-CSV-import held-PLAINTEXT-payload store — a SIBLING
// module to pending-imports.js, not a second instance of it.
const { createPendingBrowserImportStore } = require('./pending-browser-imports');
const { createBrowserImportFlow } = require('./browser-import-flow');
const { createSuppressionHolder } = require('./autolock-suppression');
const { createCompromiseRevealStore, COMPROMISE_REASON, ADOPT_REASON } = require('./pending-compromise-reveals');
const { computeSeverOfferRoute } = require('./sever-offer');
// M18 F3 L1 (DD9): the H2 resurface composition, extracted — see the module for the full rationale.
const { resurfaceCompromiseReveal: resurfaceOneCompromiseReveal } = require('./resurface-compromise-reveal');

/**
 * @typedef {object} VaultWiringDeps
 * @property {any} app Electron `app` (only `getPath('userData')` is read)
 * @property {any} dialog Electron `dialog`
 * @property {any} webContents Electron `webContents` (only `fromId`)
 * @property {any} registry the window registry
 * @property {any} jars the jars registry
 * @property {any} settings the settings store
 * @property {any} vaultStoreModule `./vault-store` (injected so a test can count `load()` calls)
 * @property {() => any} getMcpServer late-bound: the MCP server mounts later and conditionally
 * @property {any} documentMarks
 * @property {any} revealGate
 * @property {(line: string) => void} gestureTrace
 * @property {(wcId: number) => any} chromeForTab
 * @property {(channel: string, ...args: any[]) => void} broadcastToChromeAndInternal
 */

/**
 * @param {VaultWiringDeps} deps
 */
function createVaultWiring(deps) {
  const {
    app,
    dialog,
    webContents,
    registry,
    jars,
    settings,
    vaultStoreModule,
    getMcpServer,
    documentMarks,
    revealGate,
    gestureTrace,
    chromeForTab,
    broadcastToChromeAndInternal
  } = deps;

  // Lazily-constructed, memoized vault-store instance (M12 F1 Leg 3). Constructed
  // once (reads manager.json if present — no side effects otherwise), shares the
  // app's jars registry + the vaultAutoLockMinutes setting. The MCP vault context
  // uses its stateless read methods; F2 (M12) additionally drives the STATEFUL
  // human unlock() through it (DD4/DD10) and wires onLock/onUnlock so every lock-
  // state transition — human unlock, idle auto-lock — broadcasts to every chrome.
  // M18 F3 L1 (DD8 close-on-lock): on vault lock (manual `vaultLockNow()` OR the idle
  // autolock timer — the store's `lockNow`, which never routes through
  // `vaultLockNow()`), close every window's open ALLOWLISTED vault credential sheet.
  // Design review found NOTHING did this before: `vaultLockNow()` → broadcastVaultLockState()
  // is broadcast-only, and credential sheets hold no autolock-suppression hold, so the idle
  // timer could fire under an open sheet — DD8's blur-survival ruling raises the stakes
  // (half-typed secrets now also outlive an app switch), so this leg adds the close.
  // Fan out via registry.records() → rec.sheet and call closeMenuOverlay('vault-lock')
  // UNCONDITIONALLY per window: closeMenuOverlay is idempotent (a no-op with no menu open)
  // AND scopes the 'vault-lock' reason itself to the credential allowlist minus
  // vault-unlock (menu-overlay-manager.js, closesOnVaultLock) — so an open non-vault menu
  // (kebab, downloads, …), a dismiss-locked show sheet, or an open vault-unlock prompt is
  // never force-closed by this call. `rec.sheet` is nulled during window-close teardown
  // (window-factory.js), hence the optional-chaining guard.
  function closeVaultCredentialSheetsOnLock() {
    for (const rec of registry.records()) {
      rec.sheet?.closeMenuOverlay('vault-lock');
    }
  }

  let _vaultStore = null;
  function getVaultStore() {
    if (_vaultStore === null) {
      _vaultStore = vaultStoreModule.load(app.getPath('userData'), {
        listJars: () => jars.list(),
        // Diagnostics only (a vault file naming another vault's id; later, the upgrade).
        log: (line) => console.warn(line),
        getAutoLockMinutes: () => settings.get('vaultAutoLockMinutes'),
        // M18 F3 Leg 3 (DD3 ruling 4): restoreProfile's 'new' directive create-then-verify
        // step — injected so vault-store.js stays jars.js-free (Electron-free discipline).
        createJar: (name, color) => jars.add(name, color),
        verifyJarPersisted: (id) => jars.verifyPersisted(id),
        // DD10: single source of truth = the store's MRK-present state, pushed on
        // every transition. onUnlock fires from _installMrk (all three unlock
        // paths); onLock fires from lockNow + the idle timer. Both are guarded
        // inside the store, so a broadcast throw can never reject unlock()/lockNow().
        // DD8 (M18 F3 L1): close the allowlisted credential sheets FIRST, then broadcast —
        // the sheet closes before the chrome indicator / vault page settle into the new
        // locked state, never after. M18 F3 L3 (DD5 ruling 4): also drop EVERY held
        // multi-vault import record — the safety-drop matrix's lock row (manual AND idle,
        // since both route through this one onLock hook).
        // Sortie 07: the same hook also zeroizes every live MCP session's vault keys (isolated step
        // in runVaultLockTeardown) - the operator's lock is authoritative over automation.
        onLock: () => {
          // Leg 07: a lock voids every reveal-gate per-item grant, so a locked-then-unlocked vault asks again.
          documentMarks.clearGrants();
          _pendingVaultImports.dropAll();
          _pendingBrowserImports.dropAll();
          // Leg 1 (capture-hold-safety, DD5): drop every held capture too — the
          // safety valve this leg closes before Leg 4 makes holding the normal
          // state. Uses the MEMOIZED reference, not the force-constructing
          // getVaultHuman(), so a lock in a session that never captured anything
          // never constructs vault-human. Sortie 06 Leg 1 (AC15): every window's corner
          // save prompt closes `vault-lock` BEFORE the drop (so no prompt flashes
          // "expired"); the ordering lives in vault-lock-teardown.js. A `mode:'locked'`
          // record is safe to drop here too: the chrome's `pendingCaptureUnlock` ids are
          // drained by the post-unlock `advance()`, and a `vaultCaptureFinalize` on an
          // already-dropped id simply answers `expired`, which the chrome presents as a
          // prompt result state - nothing is written and nothing dangles.
          runVaultLockTeardown({
            records: () => registry.records(),
            vaultHuman: _vaultHuman,
            // Sortie 07: the operator's lock zeroizes every MCP session's vault keys (sessions
            // stay open). Reads the LIVE module `mcpServer` at call time - null/disabled is a no-op.
            zeroizeAutomationVaults: () => getMcpServer()?.zeroizeAllVaultSessions(),
            closeSheets: closeVaultCredentialSheetsOnLock,
            broadcast: broadcastVaultLockState
          });
        },
        onUnlock: () => broadcastVaultLockState()
      });
    }
    return _vaultStore;
  }

  // DD10 lock-state projection. `{ setUp, unlocked }` is the WHOLE truth the chrome
  // indicator needs; it is pushed on every transition (onLock/onUnlock) and also
  // fetched once at chrome init (getVaultLockState) — a fresher push always wins.
  function computeVaultLockState() {
    const store = getVaultStore();
    return { setUp: store.isSetUp(), unlocked: store.isUnlocked() };
  }
  function broadcastVaultLockState() {
    const state = computeVaultLockState();
    broadcastToChromeAndInternal('vault-lock-state', state);
    // Also push a MINIMAL locked flag to guest tabs so the decorative in-field lock icon
    // reflects the state live (unlock / lock / idle auto-lock) without a page reload. Guests
    // are excluded from broadcastToChromeAndInternal by design (no privileged app-state); this
    // sends ONLY the boolean, which is non-secret — the chrome indicator already shows it.
    for (const record of registry.records()) {
      for (const entry of record.tabViews.values()) {
        const wc = entry.view && entry.view.webContents;
        if (wc && !wc.isDestroyed()) {
          try {
            wc.send('vault-lock-changed', { unlocked: state.unlocked });
          } catch {
            /* view torn down mid-send */
          }
        }
      }
    }
  }

  // M18 F3 L4 (HAT fix 3): the vault-import-labels-ready notification's carrier. The leg's own
  // ruling (3(c)) specified the vault-lock-state BROADCAST idiom — profile-wide, every chrome +
  // every internal page, exactly `broadcastVaultLockState` above — because the mapping-modal
  // listener lives on the vault PAGE's own internal webContents (internal-preload.js), a
  // DIFFERENT webContents than the window's chrome. The shipped register-overlay-ipc.js used a
  // targeted `chrome.send(...)` instead (this window's chrome only), so the notification never
  // reached the page: the sheet closed successfully but no labels fetch ever fired and no
  // mapping modal opened (operator-reproduced at the HAT; wrong-password re-prompt worked fine
  // since the preview step itself never touched this channel). Fixed by routing through the
  // same `broadcastToChromeAndInternal` fan-out as every other profile-wide vault push. No
  // payload rides this notification (unchanged contract) — each page's handler runs its own
  // window-scoped labels fetch and is a safe no-op when that fetch returns nothing (already
  // true page-side; only the transport was wrong).
  function notifyVaultImportLabelsReady() {
    broadcastToChromeAndInternal('vault-import-labels-ready');
  }

  // Portable vault RESTORE held state (M12 F4 Leg 1 export-import, DD1/DD2; re-modeled M18 F3
  // Leg 3 / DD2). The restore is a multi-step flow: the vault page picks a bundle file
  // (main-side dialog + read), the chrome-owned vault-import-unlock sheet PREVIEWS the secret
  // (a store preview op — no write, no destination binding), and the page's mapping modal
  // collects a per-vault directive before the operator commits. The bundle (ciphertext), and
  // later the verified secret + non-secret labels, are held HERE across all of that — never on
  // the page, never on the sheet.
  //
  // PER-OWNING-WINDOW (PR#112 finding 5): previously ONE process-global record, so in a
  // multi-window session window A's pick could be overwritten by window B. The record is keyed
  // by the OWNING CHROME webContents id (the common identity of both the page tab — via
  // chromeForTab(tabId) — and the secret sheet, which renders IN that chrome). Every step
  // resolves ONLY its own window's record, so windows can never touch each other's import. Each
  // record also carries an opaque `handle` minted at pick; the page echoes it on the mutating
  // steps (finding 5), a per-transaction guard against a stale record within one window.
  // The window-scoped held-import store (extracted + unit-tested in vault/pending-imports.js).
  const _pendingVaultImports = createPendingImportStore({ mintHandle: () => crypto.randomUUID() });

  // M19 F1 Leg 1/2 (DD6): the browser-CSV-import held-PLAINTEXT-payload store — a SIBLING
  // module to pending-imports.js, not a second instance of it (leg 1 ruling 1: restore's
  // hold-record shape and untimed hold are pinned; a browser import's timer arms AT hold,
  // since the read Buffer IS the plaintext from the moment it is held). Dropped on lock
  // (onLock below) and on window close (releaseVaultHoldsForWindow below).
  const _pendingBrowserImports = createPendingBrowserImportStore({ mintHandle: () => crypto.randomUUID() });

  // M18 F2 L4 (flight DD5): the ONE refcounted idle-autolock suppression holder —
  // the single authority over the store's `setAutoLockSuspended` flag (flag =
  // holders > 0, a holder being a distinct `(chromeId, reason)` pair). Both
  // one-time-reveal flows — the fresh-adopt recovery reveal ('adopt') and the
  // compromise-mode recovery reveal ('compromise') — acquire/release through it,
  // so neither flow's teardown can un-suppress while the other still has a live
  // dismiss-locked reveal (the pre-migration two-independent-`size===0`-checks
  // hazard). The store accessor is lazy (transition-only pushes), so an unrelated
  // window close never force-constructs the store.
  const _autolockSuppression = createSuppressionHolder({
    setSuspended: (on) => getVaultStore().setAutoLockSuspended(on)
  });

  // Window-teardown cleanup (M17 F4 L3 AC4, generalized by M18 F2 L4 DD5; M18 F3 L3 DD5
  // ruling 4 added the held-import drop — the recon leak this leg closes): drop this window's
  // held multi-vault import record (secret zeroized, if held) and release ALL of that window's
  // suppression holds. A pending COMPROMISE or ADOPT reveal deliberately survives the window
  // (H2 hold-and-resurface): only its hold is released here; the reveal itself re-surfaces —
  // re-keyed and re-held — on the next chrome boot. No-op store-wise when the window held
  // nothing (the holder pushes only on 0↔>0 transitions), so an unrelated close never
  // force-constructs the store.
  function releaseVaultHoldsForWindow(chromeId) {
    if (chromeId == null) return;
    _pendingVaultImports.clear(chromeId);
    _pendingBrowserImports.clear(chromeId);
    _autolockSuppression.releaseWindow(chromeId);
    // Leg 1 (capture-hold-safety, DD5): drop this window's held captures too.
    // Memoized reference (not getVaultHuman()) so an unrelated window close never
    // force-constructs vault-human; `close` fires before `closed`, so the record is
    // still resolvable at this point.
    _vaultHuman?.dropCapturesForWindow(chromeId);
  }

  // M18 F2 L4 (design-review H1/H2): the per-window pending vault-credential reveals — the
  // one-time recovery key stashed at op resolution BEFORE any sheet interaction, keyed by the
  // owning chrome id, consumed on the recovery-show ack, re-keyed to a freshly booted window
  // when the original died mid-op. GENERALIZED (M18 F3 L3 / DD6 ruling 5) to also carry the
  // fresh-adopt reveal (reason 'adopt') — adopt no longer mints an admin pair, so its recovery
  // key IS its whole one-time-secret surfacing chain now; the old two-sheet admin-key chain
  // (`_pendingAdoptAdminKeys` + stash/take + the ack-chained `vault-adminkey-show` send) is
  // DELETED, not duplicated. Wired onto the suppression holder so stash/ack/rekey move the
  // per-reason hold atomically with the record.
  // M18 F3 L1 (DD9): the H2 resurface composition, extracted — see the module for the
  // full rationale. main.js's own resurfaceCompromiseReveal(rec) below keeps only the
  // Electron plumbing (chrome webContents resolution + liveChromeIds + the send binding).
  const _compromiseReveals = createCompromiseRevealStore(_autolockSuppression);

  // M18 F2 L4 (flight DD6): the compromise-mode revocation report — held main-side in
  // memory for the APP SESSION (never persisted; manager.json stays crypto-only) and
  // exposed on the internal vault-state surface so the page's persistent "Everything
  // rotated" card survives reloads and re-renders. Set at op resolution (the card
  // renders from it on the next state fetch regardless of whether the completion
  // broadcast ever fired); cleared on operator dismissal or app relaunch.
  /** @type {{ admin: boolean, vaultIds: string[], generation: { completedAt: number, nonce: string } } | null} */
  let _compromiseReport = null;

  // M18 F3 L3 (DD7 ruling 6): mint a fresh generation-identity pair — the SAME
  // `{ completedAt, nonce }` shape `restoreProfile`'s own result carries (leg 2) — for
  // the two main-side session-state stash sites below. Minted HERE, never via a
  // vault-store touch: the restore result's own generation is a distinct value.
  function mintGeneration() {
    return { completedAt: Date.now(), nonce: crypto.randomBytes(16).toString('hex') };
  }

  // M18 F3 L3 (DD7): the post-fresh-adopt sever offer — plain in-memory session state
  // (the `_compromiseReport` idiom: survives page reloads, clears on operator dismiss or
  // relaunch; `manager.json` stays crypto-only). Set on EVERY fresh adopt (the restore
  // commit handler); cleared on explicit dismiss and on a successful change-master /
  // recover completion (ruling 6's success hooks). The offer is non-secret display state
  // only — it gates nothing cryptographic.
  /** @type {{ secretKind: 'master'|'recovery', generation: { completedAt: number, nonce: string } } | null} */
  let _severOffer = null;

  // The page's state projection route (DD7) — the (secretKind × lock-state) truth table itself
  // is the extracted, unit-tested `computeSeverOfferRoute` (vault/sever-offer.js); this wrapper
  // owns only reading the session-held offer + the CURRENT lock state. Returns null when no
  // offer is pending.
  /** @returns {{ route: 'change-master' | 'recover' } | null} */
  function severOfferRoute() {
    if (!_severOffer) return null;
    const unlocked = getVaultStore().isUnlocked();
    const route = computeSeverOfferRoute(_severOffer.secretKind, unlocked);
    return { route };
  }

  // Stash the pending compromise reveal + report at op resolution (H2: this runs
  // BEFORE any sheet interaction — the stash + hold must be durable-in-memory before
  // the handler touches a possibly-dead sheet/window handle).
  function stashCompromiseReveal(chromeId, { recoveryKey, revoked }) {
    _compromiseReport = revoked
      ? {
          admin: revoked.admin === true,
          vaultIds: Array.isArray(revoked.vaultIds) ? revoked.vaultIds.filter((id) => typeof id === 'string') : [],
          generation: mintGeneration()
        }
      : { admin: false, vaultIds: [], generation: mintGeneration() };
    _compromiseReveals.stash(chromeId, recoveryKey, COMPROMISE_REASON);
  }

  // The recovery-show ack (H1, GENERALIZED M18 F3 L3 / DD6 ruling 5 — the old two-sheet
  // admin-key chain's separate ack branch is gone; this is now the SOLE ack path): consume
  // THIS window's pending reveal if present — releasing exactly the (chromeId, reason)
  // hold — then fire the completion broadcast for EITHER flow (design-review M3 for
  // compromise; ruling 5 for adopt — a fresh adopt also ends unlocked, so re-broadcasting
  // vault-lock-state is equally correct there; chrome's handlers treat the duplicate state
  // as inert). A window with no pending marker (setup / rotate-recovery acks) is a strict
  // no-op: no broadcast.
  function ackVaultReveal(chromeId) {
    if (!_compromiseReveals.ack(chromeId)) return false;
    broadcastVaultLockState();
    return true;
  }

  // H2 resurface: on a chrome boot, re-key any ORPHANED pending reveal — compromise OR
  // adopt (M18 F3 L3 / DD6 ruling 5) — (its owning window is gone) to the freshly booted
  // window and re-open the dismiss-locked recovery-show sheet there. The recovery-show
  // display needs no unlock, so this works whatever the lock state. At most one reveal can
  // be orphaned in practice (the store's busy gate serializes rotations/restores), but the
  // scan is written over the full set anyway. An app-quit with a reveal still pending
  // loses it — the accepted, documented residual (docs/vault.md).
  function resurfaceCompromiseReveal(rec) {
    const chrome = rec && rec.chromeView ? rec.chromeView.webContents : null;
    if (!chrome || chrome.isDestroyed()) return;
    const liveChromeIds = new Set();
    for (const r of registry.records()) {
      const cc = r.chromeView && r.chromeView.webContents;
      if (cc && !cc.isDestroyed()) liveChromeIds.add(cc.id);
    }
    resurfaceOneCompromiseReveal({
      chromeId: chrome.id,
      liveChromeIds,
      reveals: _compromiseReveals,
      send: (payload) => chrome.send('vault-recovery-show', payload)
    });
  }

  // Pick a save location for an export bundle — runs the save dialog ONLY (no build, no write).
  // The vault page's Export modal calls this to choose a location up front, then binds
  // source→path at submit time via vaultSaveBundleToFile(bundle, savePath). Holds NO main-side
  // state (unlike import) — the picked path is returned to the page and round-trips back on
  // submit. No parent window (a top-level modal). Returns { path } | { canceled }.
  async function vaultPickSavePath(target) {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Export vault bundle',
      defaultPath: `vault-${typeof target === 'string' && target ? target : 'export'}.gfvaultbundle`,
      filters: [
        { name: 'Goldfinch vault bundle', extensions: ['gfvaultbundle', 'json'] },
        { name: 'All files', extensions: ['*'] }
      ]
    });
    if (canceled || !filePath) return { canceled: true };
    return { path: filePath };
  }

  // Build a ciphertext-only export bundle → write it (fully main-side; the bundle never transits
  // to the page). Dual-mode: with a pre-chosen `savePath` (the vault page's Export modal, which
  // picked the location up front via vaultPickSavePath) write directly, NO dialog; without one
  // (the jars delete-first export offer) run the save dialog then write. No parent window keeps
  // this reachable from the internal-handler without a registry lookup. Returns { ok, path } |
  // { canceled }.
  async function vaultSaveBundleToFile(bundle, savePath) {
    let filePath = typeof savePath === 'string' && savePath ? savePath : null;
    // A validated typed path is written EXCLUSIVELY (flag:'wx') so it can never truncate an
    // existing file even across the validate→write TOCTOU (PR#112 finding 7); the dialog-picked
    // path (else branch) keeps the default overwrite flag — the native picker already confirmed it.
    let exclusive = false;
    if (filePath) {
      // M12 F5 HAT tail: a renderer-supplied path (the page Export modal now honors a typed/pasted
      // path) is UNTRUSTED — validate before the direct write (canonical extension; not a symlink /
      // directory; must NOT already exist; existing, writable parent dir) so this is never a
      // write-anywhere / clobber-anywhere primitive. The no-path branch below stays dialog-bound
      // (Electron's showSaveDialog is the trusted picker, with its own overwrite confirmation).
      const v = validateExportPath(filePath);
      if (!v.ok) return { ok: false, error: 'invalid-path', reason: v.reason };
      filePath = v.path;
      exclusive = true;
    } else {
      const { canceled, filePath: picked } = await dialog.showSaveDialog({
        title: 'Export vault bundle',
        defaultPath: `vault-${bundle && bundle.sourceVaultId ? bundle.sourceVaultId : 'export'}.gfvaultbundle`,
        filters: [
          { name: 'Goldfinch vault bundle', extensions: ['gfvaultbundle', 'json'] },
          { name: 'All files', extensions: ['*'] }
        ]
      });
      if (canceled || !picked) return { canceled: true };
      filePath = picked;
    }
    try {
      // Exclusive create for a typed path (finding 7): 'wx' throws EEXIST rather than truncating a
      // file that appeared between validation and write. The dialog path keeps the default overwrite.
      // Owner-only on creation (`mode` applies only when the file is created).
      fs.writeFileSync(
        filePath,
        JSON.stringify(bundle),
        exclusive ? { encoding: 'utf8', flag: 'wx', mode: 0o600 } : { encoding: 'utf8', mode: 0o600 }
      );
    } catch (err) {
      if (exclusive && err && err.code === 'EEXIST') {
        return { ok: false, error: 'invalid-path', reason: 'exists' };
      }
      return { ok: false, error: 'write-failed' };
    }
    // Overwrite path (the dialog's "replace" choice): writeFileSync's mode does not apply to an existing
    // file, so tighten it after the write. Best-effort; the bundle is already written either way.
    if (!exclusive) {
      try {
        fs.chmodSync(filePath, 0o600);
      } catch (err) {
        console.warn('[vault-export] could not set owner-only mode (continuing):', err && err.code);
      }
    }
    return { ok: true, path: filePath };
  }

  // Open a bundle file (main-side dialog + read + JSON parse) and HOLD { bundle, handle } for
  // the sheet's secret step (M18 F3 Leg 3 / DD2 ruling 1 — destination is NO LONGER bound at
  // pick; the whole destination/mode decision moves to the COMMIT-time mapping step, downstream
  // of the secret). Returns { ok, path, importHandle } | { canceled } | { error } (never throws
  // into the internal handler). The bundle's deeper crypto validation happens at the preview
  // step (loud there).
  async function vaultImportBeginFromFile(chromeId) {
    // No resolvable owning window → refuse (finding 5): a record must belong to a window.
    if (typeof chromeId !== 'number') return { error: 'no-window' };
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Import vault bundle',
      properties: ['openFile'],
      filters: [
        { name: 'Goldfinch vault bundle', extensions: ['gfvaultbundle', 'json'] },
        { name: 'All files', extensions: ['*'] }
      ]
    });
    if (canceled || !filePaths || !filePaths[0]) return { canceled: true };
    let bundle;
    try {
      // Cap the bundle file at 16 MiB before parsing (PR#112 finding 4): a real vault
      // bundle is tiny; a huge file is a resource-exhaustion / malformed input, refused
      // before JSON.parse allocates it. (MAX_IMPORT_ITEMS bounds the decrypted count too.)
      const MAX_BUNDLE_BYTES = 16 * 1024 * 1024;
      const stat = fs.statSync(filePaths[0]);
      if (stat.size > MAX_BUNDLE_BYTES) return { error: 'too-large' };
      bundle = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
    } catch {
      return { error: 'unreadable' };
    }
    // The store mints + returns the opaque handle (finding 5); keyed by the OWNING CHROME id so
    // no other window can see or mutate this record. A re-pick in the same window replaces (and
    // safely drops/zeroizes) any prior record — including a secret-bearing one (DD5 matrix).
    const handle = _pendingVaultImports.hold(chromeId, { bundle });
    return { ok: true, path: filePaths[0], importHandle: handle };
  }

  // Drop THIS window's held record for ANY reason (DD5's ONE drop helper): explicit
  // cancel/dismiss at the pick step OR (post-secret) the mapping step, zeroizing the secret
  // when held. Scoped to the owning window (and its handle when supplied) so one window can
  // never drop another's transaction. Always safe to call (a no-op when this window holds
  // nothing). `why` is a documentation tag only (every drop path behaves identically — DD5
  // ruling 4's design is ONE helper, not reason-branched behavior).
  function dropPendingVaultImport(chromeId, _why, handle) {
    _pendingVaultImports.clear(chromeId, handle);
  }

  // The page's explicit cancel/dismiss — kept as its own name for the internal-handler call
  // site's clarity (an alias of dropPendingVaultImport with the 'cancel' tag).
  function clearPendingVaultImport(chromeId, handle) {
    dropPendingVaultImport(chromeId, 'cancel', handle);
  }

  // The `menu-overlay:vault-import` delegate (M18 F3 Leg 3 / DD2 ruling 2/3(c) — the reshaped
  // `vaultImportFromSheet`): PREVIEW the held bundle's secret via the store's decrypt-then-
  // discard op — no write, no destination resolved. On success, stash an INDEPENDENT COPY of
  // the verified secret + the store's non-secret labels onto THIS window's held record (arming
  // the DD5 safety-drop timer) — a copy, because the overlay handler's own dual-zeroize wipes
  // its `buf` right after this delegate returns, and the held record needs a buffer that
  // survives that wipe for the later commit (ruling 1: "one extra scrypt derive at commit —
  // accepted"). Neither the labels nor the secret ride this invoke's reply: the page is
  // notified separately (labels-ready, no payload) and fetches its own record's labels via a
  // window-scoped invoke.
  async function vaultImportPreviewFromSheet(chromeId, buf, secretKind) {
    // Peek (don't consume): a wrong secret must leave THIS window's record intact so the sheet
    // re-prompts without forcing a re-pick.
    const pending = _pendingVaultImports.peek(chromeId);
    if (!pending) return { ok: false };
    try {
      const { labels } = await getVaultStore().previewRestoreBundle(pending.bundle, { secret: buf, secretKind });
      _pendingVaultImports.stashSecret(chromeId, { secret: Buffer.from(buf), secretKind, labels }, pending.handle);
      return { ok: true };
    } catch (e) {
      // A wrong secret → { ok:false } (the sheet re-prompts, nothing stashed). Other admitted
      // classes ride as non-secret reasons; unknowns propagate (the handler still dual-zeroizes).
      // M18 F3 L3 (DD9): routed through the extracted mapper — VAULT_IMPORT_PREVIEW_CONFIG.
      const mapped = mapVaultSheetError(e, VAULT_IMPORT_PREVIEW_CONFIG);
      if (mapped !== null) return mapped;
      throw e;
    }
  }

  // The page's window-scoped labels fetch (DD2 ruling 3(c)): a NON-SECRET projection —
  // { handle, labels } — of THIS window's held record, or null when nothing is held past the
  // secret step (no record, a record still awaiting its secret, or the record was dropped
  // meanwhile — lock, timer, window-close). The page treats null as a strict no-op, never
  // assuming the labels-ready event implies its own record.
  function vaultImportFetchLabels(chromeId) {
    return _pendingVaultImports.peekLabels(chromeId);
  }

  // The multi-vault restore COMMIT (M18 F3 Leg 3 / DD2 ruling 3(e)): consume THIS window's held
  // record — requiring an EXACT handle match against a record that has already passed the
  // secret step (a bare pick, a stale/dropped record, or a mismatched handle all refuse loudly,
  // never a partial write — the "start over" edge case) — run restoreProfile with the
  // operator's mapping, and always zeroize the held secret. On a FRESH adopt: stash the reveal
  // (H2 ordering — BEFORE the sheet send) under the ADOPT reason, surface the sever offer
  // (DD7), and open the dismiss-locked recovery-show sheet. Returns the per-vault outcomes +
  // generation on success, or a non-secret `{ ok:false, reason }` refusal.
  async function vaultImportCommit(chromeId, handle, mapping) {
    const peeked = _pendingVaultImports.peek(chromeId);
    if (!peeked || peeked.handle !== handle || peeked.secret === undefined) {
      // Never consume a record that doesn't match — a stale commit for a superseded handle
      // (a re-pick replaced it meanwhile) must leave the NEW live record untouched.
      return { ok: false, reason: 'state' };
    }
    const pending = /** @type {any} */ (_pendingVaultImports.take(chromeId));
    try {
      const res = await getVaultStore().restoreProfile(pending.bundle, {
        secret: pending.secret,
        secretKind: pending.secretKind,
        mapping
      });
      revealGate.dropAllGrants();
      broadcastVaultLockState();
      if (res.fresh) {
        const secretKind = pending.secretKind === 'recovery' ? 'recovery' : 'master';
        _severOffer = { secretKind, generation: mintGeneration() };
        // H2 ordering (DD6 ruling 5): stash the reveal BEFORE the sheet send — durable
        // in memory before touching a possibly-dead chrome handle.
        _compromiseReveals.stash(chromeId, res.recoveryKeyDisplay, ADOPT_REASON);
        webContents.fromId(chromeId)?.send('vault-recovery-show', {
          recoveryKey: res.recoveryKeyDisplay,
          replacing: true
        });
      }
      return { ok: true, fresh: res.fresh, results: res.results, generation: res.generation };
    } catch (e) {
      // M18 F3 L3 (DD9/DD10): routed through the extracted mapper — VAULT_RESTORE_COMMIT_CONFIG
      // ('busy'/'state' reasons; unknowns propagate — the handler still zeroizes below).
      const mapped = mapVaultSheetError(e, VAULT_RESTORE_COMMIT_CONFIG);
      if (mapped !== null) return mapped;
      throw e;
    } finally {
      // restoreProfile never retains the caller's secret argument beyond the call — safe (and
      // required, ruling 3(e): "zeroizes the secret") to zeroize once it has settled either way.
      pending.secret.fill(0);
    }
  }

  // DD7: dismiss the post-adopt sever offer — display-state plumbing, not a secret channel.
  function vaultImportSeverDismiss() {
    _severOffer = null;
  }

  // M12 F2 Leg 3 (pick-and-fill): the human fill orchestration, memoized like the
  // store. The tab-entry lookup is the trusted Leg-1 registry idiom
  // (getWindowForGuest → tabViews.get) — never renderer-supplied partition data.
  // fillDelegate is F1's exact channel: webContents.send targets the TOP frame only,
  // so a cross-origin iframe is never reached, and the credential built inside
  // vault-human is never returned to chrome.
  let _vaultHuman = null;
  function getVaultHuman() {
    if (_vaultHuman === null) {
      _vaultHuman = createVaultHuman({
        getVaultStore,
        fromId: (id) => webContents.fromId(id),
        getTabEntry: (id) => registry.getWindowForGuest(id)?.tabViews.get(id),
        listJars: () => jars.list(),
        // Mission 23 Flight 1 (`vault-fill-trust`): every message on this HUMAN deps block carries a
        // `{ human: true }` marker (main-to-guest, so a page cannot forge it): the guest then fills only
        // the field its own gesture bound - never the page's first form - and an automation fill (the
        // other deps block, unmarked) never consumes that pending target.
        fillDelegate: ({ wcId, credential }) => {
          webContents.fromId(wcId)?.send('vault-fill', credential, { human: true });
        },
        // Card fill (issue #152): the same shape and the same trust boundary as
        // fillDelegate above — webContents.send targets the TOP frame only, so a
        // cross-origin iframe is never reached, and the card is never returned to
        // chrome. A distinct channel because it lands on different DOM anchors.
        fillCardDelegate: ({ wcId, card }) => {
          webContents.fromId(wcId)?.send('vault-fill-card', card, { human: true });
        },
        // Identity fill (M21 F3 Leg 3, DD7/AC19): the same shape and the same
        // trust boundary as fillDelegate/fillCardDelegate above — webContents.send
        // targets the TOP frame only, so a cross-origin iframe is never reached,
        // and the identity is never returned to chrome. A distinct channel
        // because it lands on different DOM anchors.
        fillIdentityDelegate: ({ wcId, identity }) => {
          webContents.fromId(wcId)?.send('vault-fill-identity', identity, { human: true });
        },
        // Generate-in-picker fill (Mission 21, Flight 4, Leg 3, AC13): the same
        // trust boundary as fillDelegate/fillCardDelegate/fillIdentityDelegate
        // above — webContents.send targets the TOP frame only, so a cross-origin
        // iframe is never reached, and the generated candidates are never
        // returned to chrome. Wired ONLY here (the HUMAN fill path) — never on
        // the MCP automation vault-human deps block below (generation stays off
        // the MCP surface entirely, per the leg's instruction).
        fillGeneratedDelegate: ({ wcId, candidates }) => {
          webContents.fromId(wcId)?.send('vault-fill-generated', { candidates });
        },
        // Mission 23 Flight 1 (`vault-fill-trust`): the picker-context refusal trace line.
        gestureTrace,
        // Leg 4 (capture-save): the held-record safety-drop timer, injected so the
        // ~2-min timeout is unit-testable (mirrors the vault-store idle timer).
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (handle) => clearTimeout(handle),
        now: () => Date.now(),
        // Leg 1 (capture-hold-safety): chromeId → owned tab wcIds, so
        // dropCapturesForWindow can bridge its tab-keyed captures against a
        // chrome id. Null-safe at every hop — a destroyed/unknown chrome id
        // resolves [], never a throw.
        // Sortie 06 Leg 1 (AC14): non-secret drop metadata -> the owning window's save-prompt
        // manager (always) and, when the record was released as an offer, that tab's chrome.
        onCaptureDropped: (info) =>
          routeCaptureDropped(info, {
            managerForTab: (wcId) => registry.getWindowForGuest(wcId)?.savePrompt ?? null,
            chromeForTab
          }),
        tabWcIdsForChrome: (chromeId) => {
          const wc = webContents.fromId(chromeId);
          const rec = wc ? registry.getWindowForChrome(wc) : null;
          return rec ? [...rec.tabViews.keys()] : [];
        },
        // M21 F3 Leg 4, LD9: an optional capture-lifecycle trace, gated behind the
        // SAME GOLDFINCH_VAULT_TRACE env var and the SAME `[vault-capture]` prefix
        // as register-browser-ipc.js's own vaultTrace, so one debugging session
        // reads as one coherent stream. vault-human.js defaults this to a no-op
        // when omitted (it is Electron-free and cannot reach console/env itself).
        trace:
          process.env.GOLDFINCH_VAULT_TRACE === '1'
            ? (event, detail) => console.info('[vault-capture]', event, JSON.stringify(detail))
            : undefined
      });
    }
    return _vaultHuman;
  }

  // M19 F1 Leg 2 (DD5/DD13): the browser-CSV-import flow, memoized like getVaultHuman.
  // windowForChrome resolves the OWNING window's BaseWindow to parent the native confirm
  // dialog on (registry.getWindowForChrome takes a webContents object; a record's `.win`
  // as a dialog parent is the register-download-ipc.js:83 precedent — parentless also
  // works, which the `?? undefined` fallback in the flow relies on).
  let _browserImportFlow = null;
  function getBrowserImportFlow() {
    if (_browserImportFlow === null) {
      _browserImportFlow = createBrowserImportFlow({
        getStore: getVaultStore,
        pending: _pendingBrowserImports,
        dialog,
        fs,
        windowForChrome: (chromeId) => registry.getWindowForChrome(webContents.fromId(chromeId))?.win ?? null,
        listJars: () => jars.list()
      });
    }
    return _browserImportFlow;
  }

  // Raw-slot accessors for main.js (Mission 24 F3 leg 2). The peek readers NEVER construct:
  // a never-constructed store is a locked one, and quit / power events must not load it.
  function peekVaultStore() {
    return _vaultStore;
  }
  function peekVaultHuman() {
    return _vaultHuman;
  }
  function getCompromiseReport() {
    return _compromiseReport;
  }
  function clearCompromiseReport() {
    _compromiseReport = null;
  }
  function clearSeverOffer() {
    _severOffer = null;
  }

  return {
    getVaultStore,
    peekVaultStore,
    getVaultHuman,
    peekVaultHuman,
    getBrowserImportFlow,
    computeVaultLockState,
    broadcastVaultLockState,
    notifyVaultImportLabelsReady,
    releaseVaultHoldsForWindow,
    severOfferRoute,
    stashCompromiseReveal,
    ackVaultReveal,
    resurfaceCompromiseReveal,
    getCompromiseReport,
    clearCompromiseReport,
    clearSeverOffer,
    vaultPickSavePath,
    vaultSaveBundleToFile,
    vaultImportBeginFromFile,
    dropPendingVaultImport,
    clearPendingVaultImport,
    vaultImportPreviewFromSheet,
    vaultImportFetchLabels,
    vaultImportCommit,
    vaultImportSeverDismiss
  };
}

module.exports = { createVaultWiring };
