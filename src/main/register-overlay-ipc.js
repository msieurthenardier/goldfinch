'use strict';

// Electron-free registrar for the per-window menu, find, and tear-off overlays.
// Sender identity is resolved from live registry/view ownership on every message.

const MENU_CLOSE_REASONS = new Set([
  'toggle', 'superseded', 'escape', 'blur', 'navigation', 'input-empty', 'activated'
]);
const SHEET_DISMISS_REASONS = new Set(['escape', 'outside-click', 'blur']);

// M14 F1 L3 (flight DD4): the cert-picker row-id namespace — a LOCAL mirror of
// src/shared/cert-picker-template.js's CERT_PICK_PREFIX/parseCertPickIndex
// (that file is src/shared/ ESM; this registrar stays require(cjs)-clean). The
// template unit suite cross-pins the two literals so they cannot drift.
const CERT_PICK_PREFIX = 'cert:';

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
  vaultRotateRecovery,
  vaultRotateAdminKey,
  vaultChangeMaster,
  vaultRecover,
  writeClipboard,
  authAnswerFromSheet,
  certSelectFromSheet,
  validateBookmarkEdit,
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
    const bounds = activeEntry && !activeEntry.view.webContents.isDestroyed()
      ? activeEntry.view.getBounds()
      : null;
    rec.sheet.openMenu(payload, { contentView: rec.win.contentView, win: rec.win, bounds });
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
          recoveryKey: res && res.recoveryKeyDisplay,
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
          rec.sheet.closeMenuOverlay('activated', current.token);
          // The minted secret + keyId — main→chrome→sheet (channel-3 init carries the
          // model). Shown ONCE on the dismiss-locked vault-accesskey-show sheet.
          chromeForAttachment(rec.win)?.send('vault-accesskey-show', {
            secret: res.secret,
            keyId: res.keyId,
          });
          return { ok: true };
        }
        return { ok: false };
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
        const chromeId = chromeForAttachment(rec.win)?.id;
        const res = await vaultImport(chromeId, buf, kind); // { ok, reason? }
        if (res && res.ok) {
          rec.sheet.closeMenuOverlay('activated', current.token);
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
            replacing: true,
          });
          return { ok: true };
        }
        return { ok: false };
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
            adminPrivateKey: res.adminPrivateKeyB64,
          });
          return { ok: true };
        }
        return { ok: false };
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
      if (typeof token !== 'number'
        || !(oldSecret instanceof Uint8Array) || !(newSecret instanceof Uint8Array)) {
        return { ok: false };
      }
      const current = rec.sheet.getCurrentMenu();
      if (!current || token !== current.token) return { ok: false };
      const oldBuf = Buffer.from(oldSecret);
      const newBuf = Buffer.from(newSecret);
      try {
        const res = await vaultChangeMaster(oldBuf, newBuf); // { ok }
        if (res && res.ok) {
          rec.sheet.closeMenuOverlay('activated', current.token);
          return { ok: true };
        }
        return { ok: false };
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
      if (typeof token !== 'number'
        || !(recoverySecret instanceof Uint8Array) || !(newSecret instanceof Uint8Array)) {
        return { ok: false };
      }
      const current = rec.sheet.getCurrentMenu();
      if (!current || token !== current.token) return { ok: false };
      const recoveryBuf = Buffer.from(recoverySecret);
      const newBuf = Buffer.from(newSecret);
      try {
        const res = await vaultRecover(recoveryBuf, newBuf); // { ok }
        if (res && res.ok) {
          rec.sheet.closeMenuOverlay('activated', current.token);
          return { ok: true };
        }
        return { ok: false };
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

  // M15 F1 Leg 2 (flight DD4/AC "Popover payload path (DD3-preserving)"): the
  // bookmark-edit sheet's DEDICATED submit channel — the form payload does NOT
  // ride channel-4 `menu-overlay:activated` (24-char value cap; close-on-
  // activation). Mirrors the sibling secret-channel handlers' DISCIPLINE minus
  // the Buffer/zeroize half (this payload carries no secret): sender identity
  // via recordForSheetSender, open-token freshness gate, close-only-on-success.
  // Per-field validation (name/url) runs through the pure, Electron-free
  // validateBookmarkEditFields (the menu-overlay-value.js testability
  // pattern) — a failure is rejection path (a): the invoke returns
  // { ok:false } and the sheet STAYS OPEN with a generic inline error (no
  // close). `action:'remove'` skips field validation entirely (no name/url
  // needed) and always closes-and-forwards. On success main does NOT touch
  // bookmarksStore itself — it forwards to the OWNING window's chrome via
  // chromeForAttachment(rec.win)?.send('bookmark-edit-submit', payload) (the
  // vault-setup forward precedent); the chrome subscriber issues the actual
  // bookmarkUpdate/bookmarkRemove — chrome is the sole bookmark-mutation
  // issuer (AC invariant). Rejection path (b) — a cross-entry `duplicate-url`
  // collision — is invisible to this per-field validator by construction; it
  // can only surface AFTER close, from the chrome's own bookmarkUpdate call
  // (see the leg's Edge Cases) — a `reason:'invalid-url'` response reaching
  // the chrome post-close should therefore be unreachable given this
  // validator ran first. Gated on the validateBookmarkEdit injection so
  // offline overlay tests that don't wire it never register this channel.
  if (validateBookmarkEdit) {
    ipcMain.handle('menu-overlay:bookmark-edit-submit', (event, payload) => {
      const rec = recordForSheetSender(event.sender);
      if (!rec || !rec.sheet) return { ok: false };
      const { token, id, action } = payload || {};
      if (typeof token !== 'number' || typeof id !== 'string') return { ok: false };
      const current = rec.sheet.getCurrentMenu();
      if (!current || token !== current.token) return { ok: false };
      if (action === 'remove') {
        rec.sheet.closeMenuOverlay('activated', current.token);
        chromeForAttachment(rec.win)?.send('bookmark-edit-submit', { id, action: 'remove' });
        return { ok: true };
      }
      const validated = validateBookmarkEdit({
        name: payload && payload.name,
        url: payload && payload.url,
      });
      if (!validated.ok) return { ok: false };
      rec.sheet.closeMenuOverlay('activated', current.token);
      chromeForAttachment(rec.win)?.send('bookmark-edit-submit', {
        id,
        action: 'save',
        name: validated.name,
        url: validated.url,
      });
      return { ok: true };
    });
  }

  ipcMain.on('find-overlay:open', (event, payload) => {
    if (!registry.getWindowForChrome(event.sender)) return;
    const { wcId, findText } = payload || {};
    registry.getWindowForGuest(wcId)?.findOverlay?.openSession(
      wcId,
      typeof findText === 'string' ? findText : ''
    );
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
