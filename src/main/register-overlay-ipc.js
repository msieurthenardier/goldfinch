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
