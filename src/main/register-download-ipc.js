'use strict';

const DOWNLOADS_ACTIONS = new Set(['pause', 'resume', 'cancel', 'remove', 'retry', 'open', 'show']);

function registerDownloadIpc({
  ipcMain,
  webContents,
  registry,
  getTabContents,
  path,
  fs,
  sanitizeFilename,
  isWithinDir,
  dialog,
  shell,
  getDownloadsPath,
  getDownloadsManager,
  buildRegisterRecord,
  buildProgressPayload,
  buildDonePayload,
  broadcast,
  registerInternalHandler,
  getChromeContents,
  now = Date.now,
  logger = console,
}) {
  const pendingDownloads = new Map();
  const approvedDownloadDirs = new Set();
  const liveDownloadItems = new Map();

  function uniquePath(dir, filename) {
    const safe = sanitizeFilename(filename);
    const ext = path.extname(safe);
    const base = path.basename(safe, ext);
    let candidate = path.join(dir, safe);
    let n = 1;
    while (fs.existsSync(candidate)) {
      candidate = path.join(dir, `${base} (${n})${ext}`);
      n++;
    }
    if (!isWithinDir(dir, candidate)) {
      logger.warn('[uniquePath] candidate escaped dir, falling back:', candidate);
      candidate = path.join(dir, 'download');
    }
    return candidate;
  }

  ipcMain.handle('download-media', async (event, payload) => {
    const { webContentsId, url, suggestedName, saveDir } = /** @type {any} */ (payload || {});
    const wc = typeof webContentsId === 'number' ? webContents.fromId(webContentsId) : null;
    const rec = registry.getWindowForChrome(event.sender) || registry.getLastFocused();
    const senderActiveTab = rec && rec.activeTabWcId != null ? getTabContents(rec.activeTabWcId) : null;
    const downloader = wc || senderActiveTab || (rec ? rec.chromeView.webContents : null);
    if (!downloader) return { ok: false, error: 'No web contents available to download with.' };
    if (saveDir != null && !approvedDownloadDirs.has(path.resolve(saveDir))) {
      return { ok: false, error: 'Download directory not approved.' };
    }
    pendingDownloads.set(url, { suggestedName, saveDir });
    try {
      downloader.downloadURL(url);
      return { ok: true };
    } catch (err) {
      pendingDownloads.delete(url);
      return { ok: false, error: String(err && err.message ? err.message : err) };
    }
  });

  ipcMain.handle('choose-download-dir', async (event) => {
    const rec = registry.getWindowForChrome(event.sender) || registry.getLastFocused();
    const opts = { title: 'Choose a folder to download all media into', properties: ['openDirectory', 'createDirectory'] };
    const result = rec
      ? await dialog.showOpenDialog(rec.win, opts)
      : await dialog.showOpenDialog(opts);
    if (result.canceled || !result.filePaths.length) return null;
    const chosen = result.filePaths[0];
    approvedDownloadDirs.add(path.resolve(chosen));
    return chosen;
  });

  ipcMain.handle('show-item-in-folder', (_event, savePath) => {
    if (savePath) shell.showItemInFolder(savePath);
  });

  function wireDownloadHandler(sess) {
    if (sess.__goldfinchDownloads) return;
    sess.__goldfinchDownloads = true;
    sess.on('will-download', (_event, item) => {
      const url = item.getURL();
      const meta = pendingDownloads.get(url);
      const suggested = (meta && meta.suggestedName) || item.getFilename() || 'download';
      item.setSavePath(meta && meta.saveDir
        ? uniquePath(meta.saveDir, suggested)
        : uniquePath(getDownloadsPath(), suggested));

      const manager = getDownloadsManager();
      const record = buildRegisterRecord(item, { url, startTime: now() });
      const id = manager ? manager.register(record) : -1;
      if (id !== -1) liveDownloadItems.set(id, item);

      item.on('updated', (_e, state) => {
        const payload = buildProgressPayload(item, { id, url, state });
        const current = getDownloadsManager();
        current?.update(id, {
          state: payload.state,
          received: payload.received,
          total: payload.total,
          paused: payload.paused
        });
        broadcast('download-progress', payload);
      });

      item.once('done', (_e, state) => {
        pendingDownloads.delete(url);
        const payload = buildDonePayload(item, { id, url, state });
        getDownloadsManager()?.finalize(id, { state, savePath: payload.savePath, endTime: now() });
        liveDownloadItems.delete(id);
        broadcast('download-done', payload);
      });
    });
  }

  registerInternalHandler(ipcMain, 'internal-downloads-list', () =>
    getDownloadsManager()?.listAll() || []
  );

  registerInternalHandler(ipcMain, 'internal-downloads-action', (_event, payload) => {
    const id = payload && payload.id;
    const action = payload && payload.action;
    const manager = getDownloadsManager();
    if (typeof id !== 'number' || !DOWNLOADS_ACTIONS.has(action) || !manager) return { ok: false };
    const record = manager.listAll().find((entry) => entry.id === id);

    if (action === 'pause' || action === 'resume' || action === 'cancel') {
      const item = liveDownloadItems.get(id);
      if (item) {
        item[action]();
        if (action !== 'cancel') {
          const progress = buildProgressPayload(item, {
            id,
            url: item.getURL(),
            state: item.getState?.() || 'progressing'
          });
          manager.update(id, {
            state: progress.state,
            received: progress.received,
            total: progress.total,
            paused: progress.paused
          });
          broadcast('download-progress', progress);
        }
      }
    } else if (action === 'remove') {
      manager.remove(id);
    } else if (action === 'retry') {
      const url = record ? record.url : null;
      const chrome = getChromeContents();
      if (url && chrome && !chrome.isDestroyed()) chrome.downloadURL(url);
    } else if (action === 'open') {
      const savePath = record ? record.savePath : null;
      if (!savePath) return { ok: false };
      return Promise.resolve(shell.openPath(savePath))
        .then((error) => ({ ok: !error, error: error || undefined }));
    } else if (action === 'show') {
      const savePath = record ? record.savePath : null;
      if (savePath) shell.showItemInFolder(savePath);
    }
    return { ok: true };
  });

  registerInternalHandler(ipcMain, 'internal-downloads-clear', () => {
    getDownloadsManager()?.clear();
    return { ok: true };
  });

  return { wireDownloadHandler };
}

module.exports = { registerDownloadIpc };
