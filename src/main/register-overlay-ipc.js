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
