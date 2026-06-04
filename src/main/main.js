'use strict';

const { app, BrowserWindow, ipcMain, session, webContents, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1e1f25',
    title: 'Goldfinch',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'chrome-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // <webview> tag is how we embed real Chromium web pages as tabs.
      webviewTag: true,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// Each <webview> gets the media-scanner preload injected. The webview's
// `webpreferences` attribute in the renderer references this path indirectly,
// but we also enforce it here so pages can never opt out.
// ---------------------------------------------------------------------------
app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() === 'webview') {
    // Open target=_blank / window.open as new tabs in our own UI instead of
    // spawning native Electron windows.
    contents.setWindowOpenHandler(({ url }) => {
      if (mainWindow) mainWindow.webContents.send('open-tab', url);
      return { action: 'deny' };
    });
  }
});

// ---------------------------------------------------------------------------
// Downloads. The renderer asks us to download a media URL using the *page's*
// own session (so cookies / referer / auth are preserved). We resolve the
// originating webview by its webContents id.
// ---------------------------------------------------------------------------
const pendingDownloads = new Map(); // url -> { suggestedName }

ipcMain.handle('download-media', async (_event, { webContentsId, url, suggestedName, saveDir }) => {
  const wc = typeof webContentsId === 'number' ? webContents.fromId(webContentsId) : null;
  const downloader = wc || (mainWindow && mainWindow.webContents);
  if (!downloader) return { ok: false, error: 'No web contents available to download with.' };

  pendingDownloads.set(url, { suggestedName, saveDir });
  try {
    downloader.downloadURL(url);
    return { ok: true };
  } catch (err) {
    pendingDownloads.delete(url);
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
});

// Build a non-colliding path inside dir for filename, sanitizing the name.
function uniquePath(dir, filename) {
  const safe = String(filename).replace(/[\/\\:*?"<>|]/g, '_').slice(0, 180) || 'download';
  const ext = path.extname(safe);
  const base = path.basename(safe, ext);
  let candidate = path.join(dir, safe);
  let n = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base} (${n})${ext}`);
    n++;
  }
  return candidate;
}

ipcMain.handle('choose-download-dir', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a folder to download all media into',
    properties: ['openDirectory', 'createDirectory']
  });
  return res.canceled || !res.filePaths.length ? null : res.filePaths[0];
});

function wireDownloadHandler(sess) {
  sess.on('will-download', (_event, item) => {
    const url = item.getURL();
    const meta = pendingDownloads.get(url);
    const suggested = (meta && meta.suggestedName) || item.getFilename() || 'download';

    if (meta && meta.saveDir) {
      // Bulk / silent download: save straight into the chosen folder, no dialog.
      item.setSavePath(uniquePath(meta.saveDir, suggested));
    } else {
      item.setSaveDialogOptions({
        defaultPath: path.join(app.getPath('downloads'), suggested)
      });
    }

    item.on('updated', (_e, state) => {
      if (mainWindow) {
        mainWindow.webContents.send('download-progress', {
          url,
          filename: item.getFilename(),
          state,
          received: item.getReceivedBytes(),
          total: item.getTotalBytes()
        });
      }
    });

    item.once('done', (_e, state) => {
      pendingDownloads.delete(url);
      if (mainWindow) {
        mainWindow.webContents.send('download-done', {
          url,
          filename: item.getFilename(),
          state,
          savePath: state === 'completed' ? item.getSavePath() : null
        });
      }
    });
  });
}

ipcMain.handle('show-item-in-folder', (_event, savePath) => {
  if (savePath) shell.showItemInFolder(savePath);
});

ipcMain.handle('open-external', (_event, url) => {
  if (url) shell.openExternal(url);
});

app.whenReady().then(() => {
  // Downloads can be initiated from the main window (default session) OR from a
  // <webview> tab, which runs in the "persist:goldfinch" partition — a separate
  // session. Wire both so our save logic (dialog / silent saveDir) always runs.
  wireDownloadHandler(session.defaultSession);
  wireDownloadHandler(session.fromPartition('persist:goldfinch'));
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
