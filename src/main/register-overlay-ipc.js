'use strict';

// Electron-free registrar for the per-window menu, find, and tear-off overlays.
// Sender identity is resolved from live registry/view ownership on every message.

const MENU_CLOSE_REASONS = new Set([
  'toggle', 'superseded', 'escape', 'blur', 'navigation', 'input-empty', 'activated'
]);
const SHEET_DISMISS_REASONS = new Set(['escape', 'outside-click', 'blur']);

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
  writeClipboard,
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
