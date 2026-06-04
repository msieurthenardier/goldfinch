'use strict';

const { app, BrowserWindow, ipcMain, session, webContents, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { registrableDomain, hostnameOf, classify } = require('./trackers');

const PAGE_PARTITION = 'persist:goldfinch';

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

  // Run each <webview> preload in the page's MAIN world so the privacy hooks
  // can wrap fingerprinting APIs directly (CSP-immune). nodeIntegration stays
  // off, so pages get no Node; the preload's vars stay module-scoped.
  mainWindow.webContents.on('will-attach-webview', (_e, webPreferences) => {
    webPreferences.contextIsolation = false;
    webPreferences.sandbox = false;
    webPreferences.nodeIntegration = false;
  });

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

// ---------------------------------------------------------------------------
// Privacy monitor (observe-only). Watches page network traffic, classifies
// third-party / tracker requests, flags mixed content, and logs permission
// requests. Aggregated per tab and streamed to the renderer.
// ---------------------------------------------------------------------------
const SENSITIVE_PERMISSIONS = new Set([
  'media', 'geolocation', 'notifications', 'midi', 'midiSysex',
  'clipboard-read', 'hid', 'serial', 'usb', 'bluetooth',
  'idle-detection', 'display-capture'
]);

const privacyByTab = new Map(); // webContentsId -> aggregate
const privacySendTimers = new Map();

function blankAgg(firstParty) {
  return {
    firstParty: firstParty || '',
    secure: true,
    total: 0,
    mixedContent: 0,
    thirdPartyDomains: {}, // domain -> count
    trackers: { ads: [], analytics: [], social: [], other: [] }
  };
}

function serializeAgg(a) {
  const tCount = a.trackers.ads.length + a.trackers.analytics.length + a.trackers.social.length + a.trackers.other.length;
  return {
    firstParty: a.firstParty,
    secure: a.secure,
    total: a.total,
    mixedContent: a.mixedContent,
    thirdPartyCount: Object.keys(a.thirdPartyDomains).length,
    thirdPartyList: Object.entries(a.thirdPartyDomains)
      .map(([domain, count]) => ({ domain, count }))
      .sort((x, y) => y.count - x.count).slice(0, 200),
    trackers: { ...a.trackers, count: tCount }
  };
}

function schedulePrivacySend(id) {
  if (privacySendTimers.has(id)) return;
  privacySendTimers.set(id, setTimeout(() => {
    privacySendTimers.delete(id);
    const agg = privacyByTab.get(id);
    if (agg && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('privacy-net', { webContentsId: id, agg: serializeAgg(agg) });
    }
  }, 350));
}

function recordRequest(details) {
  const id = details.webContentsId;
  if (id == null) return;

  if (details.resourceType === 'mainFrame') {
    // New top-level navigation -> reset this tab's privacy aggregate.
    const agg = blankAgg(registrableDomain(hostnameOf(details.url)));
    agg.secure = details.url.startsWith('https:');
    privacyByTab.set(id, agg);
    schedulePrivacySend(id);
    return;
  }

  let agg = privacyByTab.get(id);
  if (!agg) { agg = blankAgg(''); privacyByTab.set(id, agg); }
  agg.total++;
  if (agg.secure && details.url.startsWith('http:')) agg.mixedContent++;

  const c = classify(details.url, agg.firstParty);
  if (c.thirdParty && c.domain) {
    agg.thirdPartyDomains[c.domain] = (agg.thirdPartyDomains[c.domain] || 0) + 1;
    if (c.tracker && agg.trackers[c.tracker] && !agg.trackers[c.tracker].includes(c.domain)) {
      agg.trackers[c.tracker].push(c.domain);
    }
  }
  schedulePrivacySend(id);
}

function setupPrivacy(ses) {
  ses.webRequest.onBeforeRequest((details, cb) => {
    try { recordRequest(details); } catch { /* never block traffic */ }
    cb({}); // observe-only: never cancel
  });

  // Sensitive permissions are denied by default (Electron otherwise grants
  // them to any site); everything is logged for the panel.
  ses.setPermissionRequestHandler((wc, permission, callback) => {
    const granted = !SENSITIVE_PERMISSIONS.has(permission);
    const id = wc ? wc.id : null;
    if (mainWindow && id != null && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('privacy-permission', { webContentsId: id, permission, granted });
    }
    callback(granted);
  });
  ses.setPermissionCheckHandler((_wc, permission) => !SENSITIVE_PERMISSIONS.has(permission));
}

ipcMain.handle('privacy-cookies', async (_e, { webContentsId, url }) => {
  const wc = webContentsId != null ? webContents.fromId(webContentsId) : null;
  const ses = wc ? wc.session : session.fromPartition(PAGE_PARTITION);
  const fp = registrableDomain(hostnameOf(url || (wc && wc.getURL()) || ''));
  const all = await ses.cookies.get({});
  let first = 0, third = 0;
  const list = all.map((ck) => {
    const d = registrableDomain(ck.domain.replace(/^\./, ''));
    const isThird = !!fp && d !== fp;
    isThird ? third++ : first++;
    return { name: ck.name, domain: ck.domain, third: isThird, secure: ck.secure, session: !ck.expirationDate };
  }).sort((a, b) => (a.third === b.third ? 0 : a.third ? 1 : -1));
  return { firstParty: fp, first, third, total: all.length, list: list.slice(0, 300) };
});

ipcMain.handle('privacy-clear-cookies', async (_e, { webContentsId, scope, url }) => {
  const wc = webContentsId != null ? webContents.fromId(webContentsId) : null;
  const ses = wc ? wc.session : session.fromPartition(PAGE_PARTITION);
  const fp = registrableDomain(hostnameOf(url || (wc && wc.getURL()) || ''));
  const all = await ses.cookies.get({});
  let removed = 0;
  for (const ck of all) {
    const isThird = !!fp && registrableDomain(ck.domain.replace(/^\./, '')) !== fp;
    if (scope === 'all' || (scope === 'third' && isThird)) {
      const host = ck.domain.replace(/^\./, '');
      const proto = ck.secure ? 'https' : 'http';
      try { await ses.cookies.remove(`${proto}://${host}${ck.path || '/'}`, ck.name); removed++; } catch { /* skip */ }
    }
  }
  return { removed };
});

ipcMain.handle('privacy-clear-storage', async (_e, { url }) => {
  try {
    const origin = new URL(url).origin;
    await session.fromPartition(PAGE_PARTITION).clearStorageData({ origin });
    return { ok: true, origin };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

app.whenReady().then(() => {
  // Downloads can be initiated from the main window (default session) OR from a
  // <webview> tab, which runs in the "persist:goldfinch" partition — a separate
  // session. Wire both so our save logic (dialog / silent saveDir) always runs.
  wireDownloadHandler(session.defaultSession);
  wireDownloadHandler(session.fromPartition(PAGE_PARTITION));
  setupPrivacy(session.fromPartition(PAGE_PARTITION));
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
