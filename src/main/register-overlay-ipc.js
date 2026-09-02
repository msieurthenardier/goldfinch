'use strict';

// Electron-free registrar for the per-window menu, find, and tear-off overlays.
// Sender identity is resolved from live registry/view ownership on every message.

const { bookmarkUrlsMatch } = require('../shared/bookmark-url');

const MENU_CLOSE_REASONS = new Set([
  'toggle',
  'superseded',
  'escape',
  'blur',
  'navigation',
  'input-empty',
  'activated'
]);
const SHEET_DISMISS_REASONS = new Set(['escape', 'outside-click', 'blur']);

// M14 F1 L3 (flight DD4): the cert-picker row-id namespace — a LOCAL mirror of
// src/shared/cert-picker-template.js's CERT_PICK_PREFIX/parseCertPickIndex
// (that file is src/shared/ ESM; this registrar stays require(cjs)-clean). The
// template unit suite cross-pins the two literals so they cannot drift.
const CERT_PICK_PREFIX = 'cert:';

// Squawk 0057: validate the chrome-supplied #webviews slot rect that rides the
// menu-overlay:open payload (`slotBounds`, added by overlay-menus.js's open()).
// Used ONLY when the window has no live active guest view to measure — a
// fresh-install window whose sole tab is the viewless welcome record: without a
// fallback the sheet keeps its default zero bounds and every menu (kebab,
// container picker, site-info) opens invisible until the first page load syncs
// guest bounds. The sender is the identity-checked chrome (the same authority
// that already drives guest geometry via tab-set-bounds); this shape check is
// defensive normalization, not a trust boundary. Rounding mirrors
// register-tab-ipc.js's tab-set-bounds handler.
/** @param {any} b @returns {{ x: number, y: number, width: number, height: number } | null} */
function sanitizeSlotBounds(b) {
  if (!b || typeof b !== 'object') return null;
  const { x, y, width, height } = b;
  if (![x, y, width, height].every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const rounded = { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
  return rounded.width > 0 && rounded.height > 0 ? rounded : null;
}

/** @param {string} id @returns {number | null} */
function parseCertPickIndex(id) {
  if (typeof id !== 'string' || !id.startsWith(CERT_PICK_PREFIX)) return null;
  const rest = id.slice(CERT_PICK_PREFIX.length);
  // Digits only — a bare 'cert:', a negative, or a non-numeric suffix all map
  // to no row (the store then resolves cancel via the trailing close).
  if (!/^\d+$/.test(rest)) return null;
  return Number(rest);
}

function registerOverlayIpc({
  ipcMain,
  registry,
  chromeForAttachment,
  chromeForTab,
  sanitizeActivatedValue,
  vaultUnlock,
  vaultCaptureSave,
  vaultSetup,
  vaultMintAccessKey,
  vaultImport,
  // M17 F4 L3 (AC2/AC3): fresh-adopt one-time-secret surfacing seam. `stashAdoptAdminKey`
  // holds the rotated admin private key for a window (and suspends idle autolock) after the
  // recovery key is shown; `takeAdoptAdminKey` consumes it on the recovery-show ack (clearing
  // suppression) so the adminkey-show sheet opens SECOND, never clobbering the recovery sheet.
  // Optional (offline overlay tests omit them) — the fresh-adopt branch only fires when present.
  stashAdoptAdminKey,
  takeAdoptAdminKey,
  // M18 F2 L4 (compromise-mode rotation): the compromise sheets' delegate + surfacing
  // seams. `vaultCompromiseRotate` runs the store op and maps the five ruled error
  // classes to non-secret reasons; `stashCompromiseReveal` stashes the one-time
  // recovery key + revocation report main-side AND acquires the refcounted autolock-
  // suppression hold (H2 — called BEFORE any sheet interaction); `ackCompromiseReveal`
  // consumes a window's pending compromise marker on the recovery-show ack (H1 —
  // only-if-present, exact-pair release) and fires the completion broadcast. All
  // optional (offline overlay tests omit them).
  vaultCompromiseRotate,
  stashCompromiseReveal,
  ackCompromiseReveal,
  // Squawk 0059: the post-mint page-refresh seam. main.js binds its
  // broadcastVaultLockState here so a successful step-up mint re-broadcasts the
  // (unchanged) lock state — the ONLY channel the vault page refreshes off, so
  // without it the jar's "Access keys" list stays stale until an unrelated
  // re-render. Mirrors the compromise-completion idiom (ackCompromiseReveal's
  // re-broadcast; chrome's handlers are inert on the duplicate state — verified
  // in M18 F2). A narrow bound function, never main's internals; optional
  // (offline overlay tests omit it).
  broadcastVaultLockState,
  vaultRotateRecovery,
  vaultRotateAdminKey,
  vaultChangeMaster,
  vaultRecover,
  writeClipboard,
  authAnswerFromSheet,
  certSelectFromSheet,
  validateBookmarkEdit,
  // HAT FIX 1 (M15 F2 Leg 4 HAT fixes): the bookmarks store's `list` binding
  // ONLY — never the whole store — so the read-only invariant ("chrome is
  // the sole bookmark-MUTATION issuer") is enforced by construction, not by
  // comment. A plain optional reference (leg 2's jar-ipc.js precedent, not a
  // getVaultStore-style accessor): offline overlay tests that don't inject
  // it get the pre-fix no-consultation shape, byte-unchanged.
  list
}) {
  function recordForOverlaySender(sender, key) {
    if (!sender) return null;
    for (const rec of registry.records()) {
      const manager = rec[key];
      const view = manager ? manager.getView() : null;
      if (view && !view.webContents.isDestroyed() && view.webContents === sender) return rec;
    }
    return null;
  }

  const recordForSheetSender = (sender) => recordForOverlaySender(sender, 'sheet');
  const recordForFindSender = (sender) => recordForOverlaySender(sender, 'findOverlay');

  ipcMain.on('menu-overlay:open', (event, payload) => {
    const rec = registry.getWindowForChrome(event.sender);
    if (!rec || !rec.sheet) return;
    const activeEntry = rec.activeTabWcId != null ? rec.tabViews.get(rec.activeTabWcId) : null;
    // Live active-guest bounds stay authoritative when a guest exists; the
    // chrome-measured slotBounds is the VIEWLESS-tab fallback only (squawk
    // 0057 — see sanitizeSlotBounds above: without it, a fresh-install window
    // whose only tab is the welcome record opened every menu at the sheet's
    // default zero bounds, so the kebab appeared dead until first page load).
    const guestBounds =
      activeEntry && !activeEntry.view.webContents.isDestroyed() ? activeEntry.view.getBounds() : null;
    const bounds = guestBounds || sanitizeSlotBounds(payload && payload.slotBounds);
    // Strip the transport-only field — the sheet's init payload contract
    // (menu-overlay-manager.js's MenuOpenPayload) is unchanged.
    let menuPayload = payload;
    if (payload && typeof payload === 'object' && 'slotBounds' in payload) {
      menuPayload = { ...payload };
      delete menuPayload.slotBounds;
    }
    rec.sheet.openMenu(menuPayload, { contentView: rec.win.contentView, win: rec.win, bounds });
  });

  ipcMain.on('menu-overlay:close', (event, payload) => {
    const rec = registry.getWindowForChrome(event.sender);
    if (!rec || !rec.sheet) return;
    const reason = payload && payload.reason;
    rec.sheet.closeMenuOverlay(MENU_CLOSE_REASONS.has(reason) ? reason : 'superseded');
  });

  ipcMain.on('menu-overlay:activated', (event, payload) => {
    const rec = recordForSheetSender(event.sender);
    if (!rec || !rec.sheet) return;
    const { id, token, value } = payload || {};
    if (typeof id !== 'string' || typeof token !== 'number') return;
    const current = rec.sheet.getCurrentMenu();
    if (!current || token !== current.token) return;
    // M14 F1 L3 (flight DD4): cert-picker selections resolve MAIN-SIDE,
    // ledger-FIRST — a deliberate deviation from vault-picker's chrome-side
    // dispatch (main-side gives native record identity + ledger-first
    // ordering, mirroring auth-submit). This MUST run BEFORE the
    // closeMenuOverlay below: that close fires notifySheetClosed(...,
    // 'activated') — a RESOLUTION reason — and without ledger-first ordering
    // every selection would resolve as a cancel. The trailing close then hits
    // the store's exactly-once no-op. Non-index ids (the 'cancel' row, foreign
    // ids) fall through: the close's resolution-cancel handles them.
    if (certSelectFromSheet && current.menuType === 'cert-picker') {
      const certIndex = parseCertPickIndex(id);
      if (certIndex != null) certSelectFromSheet(rec, certIndex);
    }
    rec.sheet.closeMenuOverlay('activated', token);
    // M17 F4 L3 (AC3): the fresh-adopt surfacing chain. The dismiss-locked
    // vault-recovery-show sheet closes ONLY through this activated path; on that
    // ack, if a pending adopt admin key is held for this window, open the SECOND
    // one-time sheet (vault-adminkey-show) — sequentially, so it never supersedes
    // the recovery sheet before it is read. `takeAdoptAdminKey` drops the pending
    // record AND clears the autolock suppression (AC4). A recovery-show with no
    // pending admin key (setup / rotate-recovery) returns undefined here → no send,
    // fully unaffected. The token === current.token guard above already blocks a
    // stale double-fire.
    if (current.menuType === 'vault-recovery-show') {
      const chrome = chromeForAttachment(rec.win);
      const adminPrivateKey = takeAdoptAdminKey?.(chrome?.id);
      if (adminPrivateKey !== undefined) {
        chrome?.send('vault-adminkey-show', { adminPrivateKey });
      } else {
        // M18 F2 L4 (design-review H1): the ack's cross-flow discrimination. The
        // adopt marker is checked FIRST, the compromise marker second (Q2 ruling:
        // both-on-one-window is unreachable — a dismiss-locked sheet blocks the
        // page — but the fixed order makes even the impossible state
        // deterministic). The delegate consumes THIS window's compromise marker
        // ONLY if present — releasing exactly the (chromeId, 'compromise') hold,
        // never "any hold for this window" — then fires the completion broadcast
        // (re-broadcast vault-lock-state; the page refreshes off it). Setup /
        // rotate-recovery acks reach it and no-op, exactly like the adopt branch.
        ackCompromiseReveal?.(chrome?.id);
      }
    }
    const out = { menuType: current.menuType, id };
    const cleanValue = sanitizeActivatedValue(value);
    if (cleanValue !== undefined) out.value = cleanValue;
    chromeForAttachment(rec.win)?.send('menu-overlay-activated', out);
  });

  ipcMain.on('menu-overlay:dismissed', (event, payload) => {
    const rec = recordForSheetSender(event.sender);
    if (!rec || !rec.sheet) return;
    const { reason, token } = payload || {};
    if (typeof token !== 'number') return;
    rec.sheet.closeMenuOverlay(SHEET_DISMISS_REASONS.has(reason) ? reason : 'blur', token);
  });

  // Keep-focus re-grab (sheet→main, one-way; the locked-vault unlock-to-save prompt).
  // A keep-focus menu's own spawning gesture also navigates the guest, and the loading
  // guest pulls OS focus out of the sheet — the sheet reports that blur here and the
  // manager grabs focus back (bounded per session), so keystrokes meant for a visibly-
  // focused password card cannot land in the page's fields instead. Sender-validated by
  // sheet identity like every other sheet→main channel, and GATED ON THE WINDOW STILL
  // BEING FOCUSED: a genuine app-switch blurs the window too, and stealing focus back
  // from another application would be far worse than the flicker it prevents (that case
  // is also already closed main-side by window-factory's win.on('blur')). The manager
  // re-checks the menu's own opt-in, so a sheet with no keep-focus menu open is a no-op.
  ipcMain.on('menu-overlay:refocus', (event) => {
    const rec = recordForSheetSender(event.sender);
    if (!rec || !rec.sheet || !rec.win) return;
    if (rec.win.isDestroyed?.() || !rec.win.isFocused?.()) return;
    rec.sheet.reassertFocus();
  });

  // DD4 (chrome-unlock leg): the master password's DEDICATED request/response
  // secret channel — NOT channel-4 `menu-overlay:activated` (string-only, hard-
  // capped at 24 chars by sanitizeActivatedValue). ipcMain.handle coexists with
  // the ipcMain.on overlay handlers above, and closeMenuOverlay only HIDES the
  // sheet view (never destroys its webContents), so the { ok } reply still reaches
  // the sheet even when we close it on success. The sheet awaits { ok } to re-
  // prompt on a wrong password. Gated on the vaultUnlock injection so callers that
  // don't wire the vault (e.g. offline overlay tests) never register it. Sender-
  // identity + open-token discipline mirrors the activated handler; `secret` is a
  // Uint8Array (the deserialized typed array — a separate main-heap allocation).
  if (vaultUnlock) {
    ipcMain.handle('menu-overlay:vault-unlock', async (event, payload) => {
      const rec = recordForSheetSender(event.sender);
      if (!rec || !rec.sheet) return { ok: false };
      const { token, secret } = payload || {};
      if (typeof token !== 'number' || !(secret instanceof Uint8Array)) return { ok: false };
      const current = rec.sheet.getCurrentMenu();
      if (!current || token !== current.token) return { ok: false };
      // Copy into a zeroizable Buffer (deriveMasterKey, via vaultStore.unlock,
      // accepts string | Buffer). Zeroize BOTH the copy AND the incoming
      // Uint8Array in finally — whether unlock succeeds OR throws — because
      // Buffer.from() COPIES, leaving the deserialized array as a lingering
      // separate allocation.
      const buf = Buffer.from(secret);
      try {
        const ok = await vaultUnlock(buf);
        if (ok) rec.sheet.closeMenuOverlay('activated', current.token);
        return { ok };
      } finally {
        buf.fill(0);
        secret.fill?.(0);
      }
    });
  }

  // DD7 (M12 F2 capture-save): the sheet's Save invoke. Sender-identity + open-token
  // discipline mirror the vault-unlock handler; the payload carries only the captureId
  // + the chosen vaultId (NEVER a password — the captured password lives solely in the
  // main-side held record, keyed by captureId). Gated on the vaultCaptureSave injection
  // so offline overlay tests that don't wire the vault never register it. On { saved }
  // main closes the sheet ('activated'); { saved:false } keeps it open to re-prompt.
  if (vaultCaptureSave) {
    ipcMain.handle('menu-overlay:vault-capture-save', (event, payload) => {
      const rec = recordForSheetSender(event.sender);
      if (!rec || !rec.sheet) return { saved: false };
      const { token, captureId, vaultId } = payload || {};
      if (typeof token !== 'number' || typeof captureId !== 'string') return { saved: false };
      const current = rec.sheet.getCurrentMenu();
      if (!current || token !== current.token) return { saved: false };
      const res = vaultCaptureSave({ captureId, vaultId });
      if (res && res.saved) rec.sheet.closeMenuOverlay('activated', current.token);
      return res || { saved: false };
    });
  }

  // M12 F3 Leg 4 (first-run-setup): the master password's DEDICATED setup channel,
  // mirroring menu-overlay:vault-unlock BYTE-FOR-BYTE (sender identity + open-token +
  // `secret instanceof Uint8Array` + Buffer.from copy + DUAL-ZEROIZE in finally). The
  // difference vs. unlock: on success we (a) close the vault-set sheet and (b) drive the
  // OWNING window's chrome to open the read-only `vault-recovery-show` sheet with the
  // returned recovery key ONLY (adminPrivateKeyB64 is deferred to F4 — NEVER forwarded).
  // A setup throw (e.g. already-set-up) still zeroizes both buffers and rejects the
  // invoke; the sheet catches → surfaces an error and re-prompts. The vaultSetup delegate
  // (main.js) fires the lock-state broadcast on success, so the page moves to unlocked.
  if (vaultSetup) {
    ipcMain.handle('menu-overlay:vault-setup', async (event, payload) => {
      const rec = recordForSheetSender(event.sender);
      if (!rec || !rec.sheet) return { ok: false };
      const { token, secret } = payload || {};
      if (typeof token !== 'number' || !(secret instanceof Uint8Array)) return { ok: false };
      const current = rec.sheet.getCurrentMenu();
      if (!current || token !== current.token) return { ok: false };
      const buf = Buffer.from(secret);
      try {
        const res = await vaultSetup(buf); // { recoveryKeyDisplay, adminPrivateKeyB64 }
        rec.sheet.closeMenuOverlay('activated', current.token);
        // Recovery key ONLY — main→chrome→sheet (channel-3 init carries the model). The
        // admin key is NOT surfaced here (F4's from-scratch admin-provision path owns it).
        chromeForAttachment(rec.win)?.send('vault-recovery-show', {
          recoveryKey: res && res.recoveryKeyDisplay
        });
        return { ok: true };
      } finally {
        buf.fill(0);
        secret.fill?.(0);
      }
    });
  }

  // M12 F3 Leg 5 (access-keys): the vault-stepup sheet's step-up MINT channel, mirroring
  // menu-overlay:vault-setup BYTE-FOR-BYTE (sender identity + open-token + `secret
  // instanceof Uint8Array` + Buffer.from copy + DUAL-ZEROIZE in finally). The payload adds
  // the NON-SECRET `target` vault id — re-validated main-side by the store's _resolveTarget
  // (a compromised sheet cannot mint against a burner/unknown target even if it supplied
  // one). The vaultMintAccessKey delegate (main.js) follows the vaultUnlock pattern: a
  // WRONG step-up password → VaultAuthError → { ok:false } and NOTHING is minted (the
  // step-up re-unwraps the master envelope BEFORE any write). On success we (a) close the
  // vault-stepup sheet and (b) drive the OWNING window's chrome to open the read-only,
  // dismiss-locked vault-accesskey-show sheet with the minted { secret, keyId } — shown
  // ONCE (never in the invoke reply, never in the page DOM). Gated on the vaultMintAccessKey
  // injection so offline overlay tests never register it.
  if (vaultMintAccessKey) {
    ipcMain.handle('menu-overlay:vault-stepup-mint', async (event, payload) => {
      const rec = recordForSheetSender(event.sender);
      if (!rec || !rec.sheet) return { ok: false };
      const { token, secret, target } = payload || {};
      if (typeof token !== 'number' || !(secret instanceof Uint8Array)) return { ok: false };
      const current = rec.sheet.getCurrentMenu();
      if (!current || token !== current.token) return { ok: false };
      const buf = Buffer.from(secret);
      try {
        const res = await vaultMintAccessKey(buf, target); // { ok, secret?, keyId? }
        if (res && res.ok) {
          // Squawk 0059: the mint just wrote a durable access envelope, but the vault
          // page refreshes ONLY off vault-lock-state — re-broadcast it so an open vault
          // page re-lists the jar's access keys immediately (the compromise-completion
          // idiom; chrome treats the duplicate unlocked state as inert). Fired FIRST in
          // the success branch — post-write, before any sheet/window handle is touched —
          // so a window that died during the scrypt await can never skip the refresh.
          broadcastVaultLockState?.();
          rec.sheet.closeMenuOverlay('activated', current.token);
          // The minted secret + keyId — main→chrome→sheet (channel-3 init carries the
          // model). Shown ONCE on the dismiss-locked vault-accesskey-show sheet.
          chromeForAttachment(rec.win)?.send('vault-accesskey-show', {
            secret: res.secret,
            keyId: res.keyId
          });
          return { ok: true };
        }
        // Squawk 0058: forward the delegate's NON-SECRET failure reason (the vault-import
        // idiom) so the sheet can branch its copy — 'state' (no vault for the jar yet) and
        // 'busy' (a rotation in progress) instead of the collapsed wrong-password copy. A
        // plain auth refusal keeps its bare { ok:false } shape (no reason key).
        return res && res.reason ? { ok: false, reason: res.reason } : { ok: false };
      } finally {
        buf.fill(0);
        secret.fill?.(0);
      }
    });
  }

  // M12 F4 Leg 1 (export-import): the vault-import-unlock sheet's secret channel, mirroring
  // menu-overlay:vault-stepup-mint BYTE-FOR-BYTE (sender identity + open-token + `secret
  // instanceof Uint8Array` + Buffer.from copy + DUAL-ZEROIZE in finally). The payload adds the
  // NON-SECRET `secretKind` (master | recovery); the destination target + the bundle are held
  // MAIN-SIDE by the vaultImport delegate (never on this sheet, never on the page). The
  // vaultImport delegate (main.js) follows the vaultUnlock pattern: a WRONG secret →
  // VaultAuthError → { ok:false } and NOTHING is written (importVault does all crypto before
  // any write). On success we close the sheet ('activated'); the fresh-profile adopt leaves the
  // store unlocked (its onUnlock broadcasts the lock-state, moving the page to unlocked).
  // Gated on the vaultImport injection so offline overlay tests never register it.
  if (vaultImport) {
    ipcMain.handle('menu-overlay:vault-import', async (event, payload) => {
      const rec = recordForSheetSender(event.sender);
      if (!rec || !rec.sheet) return { ok: false };
      const { token, secret, secretKind } = payload || {};
      if (typeof token !== 'number' || !(secret instanceof Uint8Array)) return { ok: false };
      const current = rec.sheet.getCurrentMenu();
      if (!current || token !== current.token) return { ok: false };
      const kind = secretKind === 'recovery' ? 'recovery' : 'master';
      const buf = Buffer.from(secret);
      try {
        // PR#112 finding 5: consume THIS window's held import record. The secret sheet is its OWN
        // overlay webContents (distinct from the chrome), so we key by the window's CHROME contents
        // id — chromeForAttachment(rec.win) — which is the SAME object the page's pick step keyed
        // under (chromeForTab(pageTabId)). A window can only ever import its own picked bundle.
        const chrome = chromeForAttachment(rec.win);
        const chromeId = chrome?.id;
        const res = await vaultImport(chromeId, buf, kind); // { ok, fresh?, recoveryKeyDisplay?, adminPrivateKeyB64?, reason? }
        if (res && res.ok) {
          rec.sheet.closeMenuOverlay('activated', current.token);
          // M17 F4 L3 (AC2): a FRESH adopt rotated the recovery key + admin keypair inline
          // (Leg 2) and returned both one-time secrets. Show the recovery key FIRST on its
          // dismiss-locked sheet (mirrors rotate-recovery's send, `replacing:true`), and stash
          // the admin private key for this window — which also suspends idle autolock (AC4).
          // The adminkey-show sheet opens only AFTER the recovery-show ack (AC3, the activated
          // handler), so the two dismiss-locked sheets never clobber each other. The invoke
          // reply stays { ok:true } with NO secret material. Existing-profile adopt
          // (res.fresh !== true) is UNCHANGED — no sends, no stash.
          if (res.fresh === true) {
            stashAdoptAdminKey?.(chromeId, res.adminPrivateKeyB64);
            chrome?.send('vault-recovery-show', { recoveryKey: res.recoveryKeyDisplay, replacing: true });
          }
          return { ok: true };
        }
        // M12 F5 HAT tail (review HIGH-1 / MEDIUM-4): forward the NON-SECRET failure reason so the
        // sheet can distinguish a destination collision ('collision') from a wrong secret. The
        // delegate already converted the coded collision from a throw to a return, so the finally
        // dual-zeroize runs uniformly on every path. A plain wrong-secret refusal keeps its bare
        // { ok:false } shape (no reason key).
        return res && res.reason ? { ok: false, reason: res.reason } : { ok: false };
      } finally {
        buf.fill(0);
        secret.fill?.(0);
      }
    });
  }

  // M12 F4 Leg 2 (key-rotation): the vault-stepup sheet's RECOVERY-ROTATION step-up channel,
  // mirroring menu-overlay:vault-setup BYTE-FOR-BYTE (sender identity + open-token + `secret
  // instanceof Uint8Array` + Buffer.from copy + DUAL-ZEROIZE in finally). The vault-stepup sheet
  // is REUSED for this master-password step-up (DD3); it routes here (not stepup-mint) when in
  // rotate-recovery mode. The vaultRotateRecovery delegate (main.js) maps VaultAuthError →
  // { ok:false } (the vaultUnlock pattern) so a WRONG master password re-prompts and NOTHING is
  // rotated (the step-up re-unwraps the master envelope BEFORE any write). On success we (a) close
  // the sheet and (b) drive the OWNING window's chrome to open the read-only, dismiss-locked
  // vault-recovery-show sheet with the NEW recovery key (POST-write ordering) — shown ONCE (never
  // in the invoke reply, never in the page DOM). Gated on the vaultRotateRecovery injection.
  if (vaultRotateRecovery) {
    ipcMain.handle('menu-overlay:vault-rotate-recovery', async (event, payload) => {
      const rec = recordForSheetSender(event.sender);
      if (!rec || !rec.sheet) return { ok: false };
      const { token, secret } = payload || {};
      if (typeof token !== 'number' || !(secret instanceof Uint8Array)) return { ok: false };
      const current = rec.sheet.getCurrentMenu();
      if (!current || token !== current.token) return { ok: false };
      const buf = Buffer.from(secret);
      try {
        const res = await vaultRotateRecovery(buf); // { ok, recoveryKeyDisplay? }
        if (res && res.ok) {
          rec.sheet.closeMenuOverlay('activated', current.token);
          // The new one-time recovery key — main→chrome→sheet (channel-3 init carries the model).
          // Shown ONCE on the dismiss-locked vault-recovery-show sheet, opened AFTER the write.
          // `replacing: true` (rotate-only; the setup send omits it) tells the sheet to reveal
          // the "this replaces your previous recovery key" line — the rotation INVALIDATES the
          // old key, a footgun if unstated (HAT I9). NON-SECRET flag; the key rides as before.
          chromeForAttachment(rec.win)?.send('vault-recovery-show', {
            recoveryKey: res.recoveryKeyDisplay,
            replacing: true
          });
          return { ok: true };
        }
        // Squawk 0058: forward the delegate's NON-SECRET failure reason ('busy' — the
        // second-wall refusal during a compromise rotation) so the sheet's copy is truthful.
        return res && res.reason ? { ok: false, reason: res.reason } : { ok: false };
      } finally {
        buf.fill(0);
        secret.fill?.(0);
      }
    });
  }

  // M12 F4 Leg 3 (admin-key-provision): the vault-stepup sheet's ADMIN-KEY ROTATION step-up channel,
  // mirroring menu-overlay:vault-rotate-recovery BYTE-FOR-BYTE (sender identity + open-token + `secret
  // instanceof Uint8Array` + Buffer.from copy + DUAL-ZEROIZE in finally). The vault-stepup sheet is
  // REUSED for this master-password step-up (DD4); it routes here (not stepup-mint / rotate-recovery)
  // when in rotate-admin mode. The vaultRotateAdminKey delegate (main.js) maps VaultAuthError →
  // { ok:false } (the vaultUnlock pattern) so a WRONG master password re-prompts and NOTHING is rotated
  // (the step-up re-unwraps the master envelope BEFORE any write). On success we (a) close the sheet and
  // (b) drive the OWNING window's chrome to open the read-only, dismiss-locked vault-adminkey-show sheet
  // with the NEW admin private key (POST-write ordering) — shown ONCE (never in the invoke reply, never
  // in the page DOM). Gated on the vaultRotateAdminKey injection.
  if (vaultRotateAdminKey) {
    ipcMain.handle('menu-overlay:vault-rotate-admin', async (event, payload) => {
      const rec = recordForSheetSender(event.sender);
      if (!rec || !rec.sheet) return { ok: false };
      const { token, secret } = payload || {};
      if (typeof token !== 'number' || !(secret instanceof Uint8Array)) return { ok: false };
      const current = rec.sheet.getCurrentMenu();
      if (!current || token !== current.token) return { ok: false };
      const buf = Buffer.from(secret);
      try {
        const res = await vaultRotateAdminKey(buf); // { ok, adminPrivateKeyB64? }
        if (res && res.ok) {
          rec.sheet.closeMenuOverlay('activated', current.token);
          // The new one-time admin private key — main→chrome→sheet (channel-3 init carries the model).
          // Shown ONCE on the dismiss-locked vault-adminkey-show sheet, opened AFTER the write.
          chromeForAttachment(rec.win)?.send('vault-adminkey-show', {
            adminPrivateKey: res.adminPrivateKeyB64
          });
          return { ok: true };
        }
        // Squawk 0058: forward the delegate's NON-SECRET failure reason ('busy' — the
        // second-wall refusal during a compromise rotation) so the sheet's copy is truthful.
        return res && res.reason ? { ok: false, reason: res.reason } : { ok: false };
      } finally {
        buf.fill(0);
        secret.fill?.(0);
      }
    });
  }

  // M12 F4 Leg 2 (key-rotation): the vault-change-master sheet's TWO-SECRET channel (old + new
  // master passwords), mirroring the vault-setup handler's discipline (sender identity + open-
  // token + `instanceof Uint8Array` + Buffer.from copy) but DUAL-ZEROIZING BOTH secret arrays +
  // BOTH Buffer copies in finally. The confirm check is renderer-side; only old + new cross here.
  // The vaultChangeMaster delegate (main.js) maps VaultAuthError → { ok:false } (the vaultUnlock
  // pattern) so a WRONG old password re-prompts and NOTHING is written (the old-password step-up
  // precedes any write). On success we close the sheet (no one-time display — the new master is
  // operator-chosen). Gated on the vaultChangeMaster injection.
  if (vaultChangeMaster) {
    ipcMain.handle('menu-overlay:vault-change-master', async (event, payload) => {
      const rec = recordForSheetSender(event.sender);
      if (!rec || !rec.sheet) return { ok: false };
      const { token, oldSecret, newSecret } = payload || {};
      if (typeof token !== 'number' || !(oldSecret instanceof Uint8Array) || !(newSecret instanceof Uint8Array)) {
        return { ok: false };
      }
      const current = rec.sheet.getCurrentMenu();
      if (!current || token !== current.token) return { ok: false };
      const oldBuf = Buffer.from(oldSecret);
      const newBuf = Buffer.from(newSecret);
      try {
        const res = await vaultChangeMaster(oldBuf, newBuf); // { ok, reason? }
        if (res && res.ok) {
          rec.sheet.closeMenuOverlay('activated', current.token);
          return { ok: true };
        }
        // Squawk 0058: forward the delegate's NON-SECRET failure reason ('busy' — the
        // second-wall refusal during a compromise rotation) so the sheet's copy is truthful.
        return res && res.reason ? { ok: false, reason: res.reason } : { ok: false };
      } finally {
        oldBuf.fill(0);
        newBuf.fill(0);
        oldSecret.fill?.(0);
        newSecret.fill?.(0);
      }
    });
  }

  // M12 F4 Leg 2 (key-rotation): the vault-recover sheet's TWO-SECRET channel (recovery key + new
  // master password), mirroring the vault-change-master handler (DUAL-ZEROIZE BOTH arrays + BOTH
  // Buffer copies). The confirm check is renderer-side; only recovery + new cross here. The
  // vaultRecover delegate (main.js) maps VaultAuthError → { ok:false } so a WRONG recovery key
  // re-prompts and NOTHING is written (recoverMasterPassword unwraps the recovery envelope BEFORE
  // any write / install). On success the store installs the MRK (the user ends UNLOCKED) and its
  // onUnlock/broadcast moves the page to unlocked; we close the sheet. Gated on the vaultRecover
  // injection.
  if (vaultRecover) {
    ipcMain.handle('menu-overlay:vault-recover', async (event, payload) => {
      const rec = recordForSheetSender(event.sender);
      if (!rec || !rec.sheet) return { ok: false };
      const { token, recoverySecret, newSecret } = payload || {};
      if (typeof token !== 'number' || !(recoverySecret instanceof Uint8Array) || !(newSecret instanceof Uint8Array)) {
        return { ok: false };
      }
      const current = rec.sheet.getCurrentMenu();
      if (!current || token !== current.token) return { ok: false };
      const recoveryBuf = Buffer.from(recoverySecret);
      const newBuf = Buffer.from(newSecret);
      try {
        const res = await vaultRecover(recoveryBuf, newBuf); // { ok, reason? }
        if (res && res.ok) {
          rec.sheet.closeMenuOverlay('activated', current.token);
          return { ok: true };
        }
        // Squawk 0058: forward the delegate's NON-SECRET failure reason ('format' — a
        // malformed recovery display; 'busy' — the second-wall refusal during a compromise
        // rotation) so the sheet can keep its copy truthful.
        return res && res.reason ? { ok: false, reason: res.reason } : { ok: false };
      } finally {
        recoveryBuf.fill(0);
        newBuf.fill(0);
        recoverySecret.fill?.(0);
        newSecret.fill?.(0);
      }
    });
  }

  // M18 F2 L4 (compromise-mode rotation, flight DD4/DD5): the vault-compromise sheet's
  // TWO-SECRET channel (current + new master passwords), mirroring vault-change-master's
  // discipline (sender identity + open-token + `instanceof Uint8Array` + Buffer.from
  // copies + DUAL-ZEROIZE all four buffers in finally) PLUS the menuType guard named as
  // a predicate (the M15 F3 lesson — one persistent sheet document hosts every menuType,
  // and this channel triggers a DESTRUCTIVE whole-hierarchy re-key). Main is
  // AUTHORITATIVE about routing: only a live `vault-compromise` menu reaches
  // `compromiseRotate` (DD4 mode carriage — no renderer-supplied flag).
  //
  // Success path (design-review H2, hold-and-resurface — ORDER IS LOAD-BEARING):
  //  1. STASH the reveal (one-time recovery key + revocation report) main-side and
  //     acquire the suppression hold — BEFORE any sheet interaction, so a window that
  //     died during the 2–3-scrypt await can never lose the reveal to a throw on a
  //     dead handle AFTER a durable commit.
  //  2. NULL-GUARD the window: only when `rec.sheet`/`rec.win` are still alive, close
  //     the credential sheet ('activated'; a mid-op dismissal already closed it — the
  //     stale-token close is a pinned no-op) and open the dismiss-locked
  //     vault-recovery-show sheet (POST-write ordering; the key never rides the invoke
  //     reply). Window gone → the reveal stays pending and re-surfaces on the next
  //     chrome boot (main.js's onChromeBooted re-key).
  // The chromeId is captured BEFORE the await — the record's win/chrome handles may be
  // dead by resolution time, but the stash must still key to the window that submitted.
  // Failure: the delegate's non-secret `reason` ('reuse'|'auth'|'format'|'busy'|'state')
  // rides back so the sheet renders the ruled inline copy; unknown errors reject the
  // invoke (the finally still dual-zeroizes) and the sheet shows the DD5 pre-commit
  // copy. Gated on the vaultCompromiseRotate injection.
  if (vaultCompromiseRotate) {
    ipcMain.handle('menu-overlay:vault-compromise', async (event, payload) => {
      const rec = recordForSheetSender(event.sender);
      if (!rec || !rec.sheet) return { ok: false };
      const { token, oldSecret, newSecret } = payload || {};
      if (typeof token !== 'number' || !(oldSecret instanceof Uint8Array) || !(newSecret instanceof Uint8Array)) {
        return { ok: false };
      }
      const current = rec.sheet.getCurrentMenu();
      if (!current || token !== current.token) return { ok: false };
      if (current.menuType !== 'vault-compromise') return { ok: false };
      const oldBuf = Buffer.from(oldSecret);
      const newBuf = Buffer.from(newSecret);
      try {
        const chromeId = chromeForAttachment(rec.win)?.id;
        const res = await vaultCompromiseRotate({ oldMasterPassword: oldBuf, newMasterPassword: newBuf });
        if (res && res.ok) {
          // H2 step 1 — stash + hold FIRST (before ANY sheet interaction).
          stashCompromiseReveal?.(chromeId, { recoveryKey: res.recoveryKey, revoked: res.revoked });
          // H2 step 2 — the null-guarded window path.
          if (rec.sheet && rec.win && !rec.win.isDestroyed?.()) {
            rec.sheet.closeMenuOverlay('activated', current.token);
            chromeForAttachment(rec.win)?.send('vault-recovery-show', {
              recoveryKey: res.recoveryKey,
              replacing: true
            });
          }
          return { ok: true };
        }
        return res && res.reason ? { ok: false, reason: res.reason } : { ok: false };
      } finally {
        oldBuf.fill(0);
        newBuf.fill(0);
        oldSecret.fill?.(0);
        newSecret.fill?.(0);
      }
    });
  }

  // M18 F2 L4: the vault-compromise-recover sheet's TWO-SECRET channel (recovery key +
  // new master password) — the compromise flow's recovery branch, mirroring the
  // vault-compromise handler above byte-for-byte in discipline (sender identity +
  // open-token + menuType predicate + Uint8Array checks + Buffer copies + DUAL-ZEROIZE
  // all four in finally) and in the H2 success ordering (stash+hold BEFORE the
  // null-guarded close/recovery-show). The recovery key rides as a Buffer; the main
  // delegate decodes it for parseRecoveryKey (the vaultRecover precedent). Gated on the
  // same vaultCompromiseRotate injection.
  if (vaultCompromiseRotate) {
    ipcMain.handle('menu-overlay:vault-compromise-recover', async (event, payload) => {
      const rec = recordForSheetSender(event.sender);
      if (!rec || !rec.sheet) return { ok: false };
      const { token, recoverySecret, newSecret } = payload || {};
      if (typeof token !== 'number' || !(recoverySecret instanceof Uint8Array) || !(newSecret instanceof Uint8Array)) {
        return { ok: false };
      }
      const current = rec.sheet.getCurrentMenu();
      if (!current || token !== current.token) return { ok: false };
      if (current.menuType !== 'vault-compromise-recover') return { ok: false };
      const recoveryBuf = Buffer.from(recoverySecret);
      const newBuf = Buffer.from(newSecret);
      try {
        const chromeId = chromeForAttachment(rec.win)?.id;
        const res = await vaultCompromiseRotate({ recoveryKey: recoveryBuf, newMasterPassword: newBuf });
        if (res && res.ok) {
          stashCompromiseReveal?.(chromeId, { recoveryKey: res.recoveryKey, revoked: res.revoked });
          if (rec.sheet && rec.win && !rec.win.isDestroyed?.()) {
            rec.sheet.closeMenuOverlay('activated', current.token);
            chromeForAttachment(rec.win)?.send('vault-recovery-show', {
              recoveryKey: res.recoveryKey,
              replacing: true
            });
          }
          return { ok: true };
        }
        return res && res.reason ? { ok: false, reason: res.reason } : { ok: false };
      } finally {
        recoveryBuf.fill(0);
        newBuf.fill(0);
        recoverySecret.fill?.(0);
        newSecret.fill?.(0);
      }
    });
  }

  // M12 F3 Leg 4 (first-run-setup): the recovery-show Copy button. The sheet is chrome-
  // class but has no privileged clipboard API of its own; main owns the OS clipboard
  // (the chrome-clipboard-write precedent — string-only). Sender-validated by the sheet's
  // own webContents identity; gated on the writeClipboard injection (offline overlay
  // tests omit it). The recovery key already originated in main — re-copying it is
  // in-domain (never leaves main → the chrome-class sheet → the OS clipboard).
  if (writeClipboard) {
    ipcMain.on('menu-overlay:copy-text', (event, payload) => {
      const rec = recordForSheetSender(event.sender);
      if (!rec || !rec.sheet) return;
      const text = payload && payload.text;
      if (typeof text === 'string' && text) writeClipboard(text);
    });
  }

  // M14 F1 L2 (flight DD2): the auth-basic sheet's DEDICATED credential channel,
  // mirroring menu-overlay:vault-unlock BYTE-FOR-BYTE in discipline (sender
  // identity via recordForSheetSender + open-token freshness gate + `secret
  // instanceof Uint8Array` + Buffer.from copy + DUAL-ZEROIZE in finally) — the
  // password NEVER rides channel-4 `menu-overlay:activated` (string-only,
  // 24-char capped). The payload adds the NON-SECRET username string. The
  // handler NEVER closes the sheet itself — the pending-challenge store owns
  // sheet-closing (single close site: answerFromSheet resolves the exactly-once
  // ledger FIRST, then closes with the resolution-family 'activated'). Gated on
  // the authAnswerFromSheet injection so offline overlay tests never register it.
  if (authAnswerFromSheet) {
    ipcMain.handle('menu-overlay:auth-submit', (event, payload) => {
      const rec = recordForSheetSender(event.sender);
      if (!rec || !rec.sheet) return { answered: false };
      const { token, username, secret } = payload || {};
      if (typeof token !== 'number' || typeof username !== 'string' || !(secret instanceof Uint8Array)) {
        return { answered: false };
      }
      const current = rec.sheet.getCurrentMenu();
      if (!current || token !== current.token) return { answered: false };
      const buf = Buffer.from(secret);
      try {
        return authAnswerFromSheet(rec, username, buf) || { answered: false };
      } finally {
        buf.fill(0);
        secret.fill?.(0);
      }
    });
  }

  // M15 F1 Leg 2 (flight DD4/AC "Popover payload path (DD3-preserving)"), HAT
  // FIX 1 (M15 F2 Leg 4 HAT fixes — H5): the bookmark-edit sheet's DEDICATED
  // submit channel — the form payload does NOT ride channel-4
  // `menu-overlay:activated` (24-char value cap; close-on-activation).
  // Mirrors the sibling secret-channel handlers' DISCIPLINE minus the
  // Buffer/zeroize half (this payload carries no secret): sender identity via
  // recordForSheetSender, open-token freshness gate, close-only-on-success.
  // Per-field validation (name/url) runs through the pure, Electron-free
  // validateBookmarkEditFields — a failure is the ORIGINAL rejection path:
  // the invoke returns { ok:false } and the sheet STAYS OPEN with a generic
  // inline error (no close).
  //
  // HAT FIX 1 folds what was Flight 1's "two rejection paths, two UXes"
  // contract into ONE path. H5 found the second UX (a post-close chrome
  // toast) architecturally invisible — the guest WebContentsView is layered
  // OVER the chrome document, so #toasts never renders (a known issue wider
  // than this flight, recorded separately). Rather than build a new surface,
  // main now CONSULTS the bookmarks store (read-only, via the injected `list`
  // binding — never the whole store, so the "chrome is the sole
  // bookmark-mutation issuer" invariant holds by construction) BEFORE closing
  // the sheet: not-found (the target row is already gone) and, for `save`,
  // duplicate-url (a DIFFERENT row in the SAME jar already has this exact
  // URL — bookmarkUrlsMatch, never a re-derived `===`) both now reject with
  // `{ ok:false, reason }` and leave the sheet open, same as a field-
  // validation failure. `action:'remove'` skips FIELD validation (no
  // name/url needed) but gets the SAME not-found consult — it used to close
  // and forward with zero consultation, hitting the identical
  // invisible-feedback defect on the far side. `list` is gated-optional
  // (offline overlay tests omit it) and jarId-normalized to `null` when the
  // current menu carries none (the audit-seam fixture, or any future
  // non-string jarId) — `list(null)` resolves to zero rows (not-found) rather
  // than throwing (SQLite's bound-parameter contract rejects `undefined`,
  // accepts `null`). On success main still does NOT MUTATE bookmarksStore —
  // it forwards to the OWNING window's chrome via
  // chromeForAttachment(rec.win)?.send('bookmark-edit-submit', payload) (the
  // vault-setup forward precedent); the chrome subscriber issues the actual
  // bookmarkUpdate/bookmarkRemove. A genuine RACE — another window mutates
  // the store in the gap between this read-check and the chrome's own
  // mutation round trip — still survives, narrowly; bookmarks-client.js's
  // `surfaceRejection`/`toast` stays wired as that residual fallback. Gated
  // on the validateBookmarkEdit injection so offline overlay tests that don't
  // wire it never register this channel.
  if (validateBookmarkEdit) {
    ipcMain.handle('menu-overlay:bookmark-edit-submit', (event, payload) => {
      const rec = recordForSheetSender(event.sender);
      if (!rec || !rec.sheet) return { ok: false };
      const { token, id, action } = payload || {};
      if (typeof token !== 'number' || typeof id !== 'string') return { ok: false };
      const current = rec.sheet.getCurrentMenu();
      if (!current || token !== current.token) return { ok: false };

      /** @type {{ ok: true, name: string, url: string } | null} */
      let validated = null;
      if (action !== 'remove') {
        validated = validateBookmarkEdit({
          name: payload && payload.name,
          url: payload && payload.url
        });
        if (!validated.ok) return { ok: false };
      }

      if (list) {
        const jarId = typeof current.jarId === 'string' ? current.jarId : null;
        const rows = list(jarId);
        const row = rows.find((r) => r.id === id);
        if (!row) return { ok: false, reason: 'not-found' };
        if (
          action !== 'remove' &&
          rows.find((r) => r.id !== id && bookmarkUrlsMatch(r.url, /** @type {any} */ (validated).url))
        ) {
          return { ok: false, reason: 'duplicate-url' };
        }
      }

      if (action === 'remove') {
        rec.sheet.closeMenuOverlay('activated', current.token);
        chromeForAttachment(rec.win)?.send('bookmark-edit-submit', { id, action: 'remove' });
        return { ok: true };
      }
      rec.sheet.closeMenuOverlay('activated', current.token);
      chromeForAttachment(rec.win)?.send('bookmark-edit-submit', {
        id,
        action: 'save',
        name: /** @type {any} */ (validated).name,
        url: /** @type {any} */ (validated).url
      });
      return { ok: true };
    });
  }

  // M15 F3 Leg 5a (AC8/AC8b): the bookmarks-overflow sheet's DROP-INDEX channel.
  // A bar item was released over the sheet's row list; the sheet reports WHERE
  // (a snapshot-local insertion index) and nothing else. There is no bookmark id,
  // no url, and no jar on this wire — the chrome resolves all three from its own
  // dragstart-time hold — so the message cannot be aimed even if it were forged.
  //
  // ⚠ THE THREE GUARDS ARE NAMED HERE AS PREDICATES, NOT INHERITED BY CITING A
  // PRECEDENT. The sheet is ONE persistent document shared by every menuType
  // (DD1/DD1a), so a handler that checks only sender identity and token freshness
  // would accept a drop index while `vault-unlock` is on screen. This flight has
  // now recorded FOUR findings of exactly that shape (leg 1 ×2, leg 4, leg 5a),
  // and "cite unlockVault/authSubmit" is precisely the habit the leg-4 log entry
  // says to stop repeating. The guards, in order:
  //   1. recordForSheetSender — the sender IS this window's sheet webContents,
  //      never a payload-declared identity;
  //   2. token freshness against getCurrentMenu() — a stale open cannot report;
  //   3. current.menuType === 'bookmarks-overflow' — the only menuType whose
  //      model this index means anything against.
  // The close mirrors menu-overlay:activated's ordering (close, then forward) and
  // is what ends the gesture deterministically, rather than waiting on a
  // bookmarks-changed broadcast that a no-op commit would never fire.
  ipcMain.on('menu-overlay:overflow-drop', (event, payload) => {
    const rec = recordForSheetSender(event.sender);
    if (!rec || !rec.sheet) return;
    const { token, index } = payload || {};
    if (typeof token !== 'number') return;
    if (!Number.isInteger(index) || index < 0) return;
    const current = rec.sheet.getCurrentMenu();
    if (!current || token !== current.token) return;
    if (current.menuType !== 'bookmarks-overflow') return;
    rec.sheet.closeMenuOverlay('activated', token);
    chromeForAttachment(rec.win)?.send('bookmark-overflow-drop', { index });
  });

  // M15 F3 Leg 5b (AC3): the bookmarks-overflow sheet's DRAG-LIFECYCLE channel —
  // the reverse direction, where the sheet's rows are the drag SOURCE. The chrome
  // has no `dragstart`/`dragend` of its own for such a gesture, so these two
  // signals are the entire bracket: `start` opens the chrome's foreign-drag
  // session (which suppresses both bar-rebuild paths and the overflow close for
  // the drag's duration), `end` closes it.
  //
  // ⚠ THE GUARDS ARE NAMED HERE AS PREDICATES, NOT INHERITED BY CITING THE
  // OVERFLOW-DROP CHANNEL. One persistent sheet document hosts every menuType
  // (DD1/DD1a), and this flight has recorded FOUR findings of a handler that
  // checked only sender identity and token freshness. For `start`, all three:
  //   1. recordForSheetSender — the sender IS this window's sheet webContents;
  //   2. token freshness against getCurrentMenu() — a stale open cannot report;
  //   3. current.menuType === 'bookmarks-overflow' — no other menu's row index
  //      means anything, and no other menu may arm a bar-suppressing session.
  //
  // ⚠ `end` IS DELIBERATELY GATED ON SENDER IDENTITY ALONE, and that asymmetry is
  // reasoned, not an omission. By the time a sheet-sourced drag ends, the sheet
  // has been blur-closed since the drag STARTED (that is what makes this leg's
  // lifecycle channel necessary at all), so `getCurrentMenu()` is null and a
  // token/menuType gate would refuse EVERY `end` — turning the clear signal
  // operator session 4 measured into one that never arrives. The freshness check
  // is not dropped, it MOVES to the chrome, which still holds the live session
  // and matches the forwarded token against it. Safe to relax because `end` is
  // non-destructive by construction: it can only cancel a session, never commit
  // one — an unexpected `end` costs the operator a no-op, never a wrong write.
  ipcMain.on('menu-overlay:sheet-drag', (event, payload) => {
    const rec = recordForSheetSender(event.sender);
    if (!rec || !rec.sheet) return;
    const { phase, token, index } = payload || {};
    if (typeof token !== 'number') return;
    if (phase === 'end') {
      chromeForAttachment(rec.win)?.send('bookmark-sheet-drag', { phase: 'end', token });
      return;
    }
    if (phase !== 'start') return;
    if (!Number.isInteger(index) || index < 0) return;
    const current = rec.sheet.getCurrentMenu();
    if (!current || token !== current.token) return;
    if (current.menuType !== 'bookmarks-overflow') return;
    // No close here: the sheet's own blur close owns that, and closing from this
    // handler would race the drag session it is announcing.
    chromeForAttachment(rec.win)?.send('bookmark-sheet-drag', { phase: 'start', token, index });
  });

  ipcMain.on('find-overlay:open', (event, payload) => {
    if (!registry.getWindowForChrome(event.sender)) return;
    const { wcId, findText } = payload || {};
    registry.getWindowForGuest(wcId)?.findOverlay?.openSession(wcId, typeof findText === 'string' ? findText : '');
  });

  ipcMain.on('find-overlay:close', (event) => {
    const fromRec = recordForFindSender(event.sender);
    const fromOverlay = fromRec != null;
    const rec = fromRec || registry.getWindowForChrome(event.sender);
    if (!rec || !rec.findOverlay) return;
    const sessionWcId = rec.findOverlay.getSessionTabWcId();
    if (fromOverlay && sessionWcId != null) {
      chromeForTab(sessionWcId)?.send('find-overlay-closed', { wcId: sessionWcId });
    }
    rec.findOverlay.closeSession({ refocusGuest: fromOverlay });
  });

  ipcMain.on('find-overlay:query', (event, payload) => {
    const rec = recordForFindSender(event.sender);
    if (!rec || !rec.findOverlay) return;
    rec.findOverlay.query(payload || {});
  });

  ipcMain.on('tearoff-overlay:show', (event, payload) => {
    const { x, y } = /** @type {any} */ (payload || {});
    registry.getWindowForChrome(event.sender)?.tearoffOverlay?.show(x, y);
  });
  ipcMain.on('tearoff-overlay:move', (event, payload) => {
    const { x, y } = /** @type {any} */ (payload || {});
    registry.getWindowForChrome(event.sender)?.tearoffOverlay?.setPosition(x, y);
  });
  ipcMain.on('tearoff-overlay:hide', (event) => {
    registry.getWindowForChrome(event.sender)?.tearoffOverlay?.hide();
  });
}

module.exports = { registerOverlayIpc };
