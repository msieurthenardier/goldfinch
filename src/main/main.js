'use strict';

const { app, BrowserWindow, ipcMain, session, webContents, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { registrableDomain, hostnameOf, classify } = require('./trackers');
const shields = require('./shields');
const jars = require('./jars');

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
  if (sess.__goldfinchDownloads) return; // wire each session once
  sess.__goldfinchDownloads = true;
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
    blocked: 0,             // tracker requests cancelled (raw)
    strippedDomains: {},    // distinct domains whose URLs were cleaned
    cookieBlockedDomains: {}, // distinct third-party domains whose cookies were dropped
    thirdPartyDomains: {}, // domain -> count
    // each category: { domain -> { blocked } }
    trackers: { ads: {}, analytics: {}, social: {}, other: {} }
  };
}

function serializeAgg(a) {
  const cats = ['ads', 'analytics', 'social', 'other'];
  let count = 0, blockedT = 0;
  const trackers = { count: 0, blocked: 0, allowed: 0 };
  for (const cat of cats) {
    trackers[cat] = Object.entries(a.trackers[cat]).map(([domain, v]) => {
      count++; if (v.blocked) blockedT++;
      return { domain, blocked: v.blocked };
    });
  }
  trackers.count = count;
  trackers.blocked = blockedT;
  trackers.allowed = count - blockedT;
  return {
    firstParty: a.firstParty,
    secure: a.secure,
    total: a.total,
    mixedContent: a.mixedContent,
    blocked: a.blocked, // raw request count (kept for reference)
    stripped: Object.keys(a.strippedDomains).length,      // distinct domains
    cookiesBlocked: Object.keys(a.cookieBlockedDomains).length, // distinct domains
    thirdPartyCount: Object.keys(a.thirdPartyDomains).length,
    thirdPartyList: Object.entries(a.thirdPartyDomains)
      .map(([domain, count]) => ({ domain, count }))
      .sort((x, y) => y.count - x.count).slice(0, 200),
    trackers
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

// action: 'allow' | 'block' | 'strip'
function recordRequest(details, action) {
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
  if (action === 'block') agg.blocked++;
  if (action === 'strip') agg.strippedDomains[registrableDomain(hostnameOf(details.url))] = 1;
  if (agg.secure && details.url.startsWith('http:')) agg.mixedContent++;

  const c = classify(details.url, agg.firstParty);
  if (c.thirdParty && c.domain) {
    agg.thirdPartyDomains[c.domain] = (agg.thirdPartyDomains[c.domain] || 0) + 1;
    if (c.tracker && agg.trackers[c.tracker]) {
      const entry = agg.trackers[c.tracker][c.domain] || (agg.trackers[c.tracker][c.domain] = { blocked: false });
      if (action === 'block') entry.blocked = true;
    }
  }
  schedulePrivacySend(id);
}

// First-party registrable domain for a tab (from its privacy aggregate).
function tabFirstParty(id) {
  const agg = privacyByTab.get(id);
  return agg ? agg.firstParty : '';
}

// Applied to EVERY session/jar (via app.on('session-created')). One handler per
// webRequest event: it both records privacy data (observe) and enforces the
// active Shields (block / strip / isolate).
function applyShields(ses) {
  if (ses.__goldfinchShields) return; // wire each session once
  ses.__goldfinchShields = true;

  ses.webRequest.onBeforeRequest((details, cb) => {
    const fp = tabFirstParty(details.webContentsId) || registrableDomain(hostnameOf(details.url));
    let action = 'allow';
    let response = {};

    // Block known trackers (never the top-level document).
    if (details.resourceType !== 'mainFrame' && shields.active('block', fp)) {
      const c = classify(details.url, fp);
      if (c.thirdParty && c.tracker) { action = 'block'; response = { cancel: true }; }
    }
    // Strip tracking params (redirect to the clean URL).
    if (action === 'allow' && shields.active('strip', fp)) {
      const clean = shields.stripUrl(details.url);
      if (clean && clean !== details.url) { action = 'strip'; response = { redirectURL: clean }; }
    }
    try { recordRequest(details, action); } catch { /* never break traffic */ }
    cb(response);
  });

  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    const fp = tabFirstParty(details.webContentsId) || registrableDomain(hostnameOf(details.url));
    const headers = details.requestHeaders;
    if (shields.active('strip', fp) && headers.Referer) {
      try { headers.Referer = new URL(headers.Referer).origin + '/'; } catch { delete headers.Referer; }
    }
    if (shields.active('isolate', fp) && details.resourceType !== 'mainFrame' && headers.Cookie) {
      const c = classify(details.url, fp);
      if (c.thirdParty) {
        delete headers.Cookie;
        const agg = privacyByTab.get(details.webContentsId);
        if (agg && c.domain) { agg.cookieBlockedDomains[c.domain] = 1; schedulePrivacySend(details.webContentsId); }
      }
    }
    cb({ requestHeaders: headers });
  });

  ses.webRequest.onHeadersReceived((details, cb) => {
    const fp = tabFirstParty(details.webContentsId) || registrableDomain(hostnameOf(details.url));
    const headers = details.responseHeaders || {};
    if (shields.active('isolate', fp) && details.resourceType !== 'mainFrame' && classify(details.url, fp).thirdParty) {
      for (const k of Object.keys(headers)) {
        if (k.toLowerCase() === 'set-cookie') delete headers[k];
      }
    }
    cb({ responseHeaders: headers });
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

// Shields config IPC.
ipcMain.handle('shields-get', () => shields.get());
ipcMain.handle('shields-set', (_e, patch) => {
  const cfg = shields.set(patch || {});
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('shields-changed', cfg);
  return cfg;
});
ipcMain.handle('shields-pause', (_e, { site, paused }) => {
  const cfg = shields.setPaused(site, paused);
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('shields-changed', cfg);
  return cfg;
});

// Per-jar fingerprint seed. Stable for a session so a site sees a consistent
// (but fake) fingerprint; different per jar = a different "persona". Rerolled
// by New Identity (stage 3).
const farbleSeeds = new WeakMap();
function seedForSession(ses) {
  let s = farbleSeeds.get(ses);
  if (s == null) { s = Math.floor(Math.random() * 0xffffffff) >>> 0; farbleSeeds.set(ses, s); }
  return s;
}
function rerollSeed(ses) { farbleSeeds.set(ses, Math.floor(Math.random() * 0xffffffff) >>> 0); }

// The webview preload asks (synchronously, at document-start) whether to farble
// and with which seed.
ipcMain.on('shields-farble', (event, url) => {
  const site = registrableDomain(hostnameOf(url || ''));
  event.returnValue = {
    farble: shields.active('farble', site),
    seed: seedForSession(event.sender.session)
  };
});

// --- cookie jars / container identities ---
ipcMain.handle('jars-list', () => jars.list());
ipcMain.handle('jars-add', (_e, { name, color }) => jars.add(name, color));

// New Identity: wipe a jar's cookies + storage and reroll its fingerprint seed,
// so the site can no longer link you to who you just were.
ipcMain.handle('identity-new', async (_e, { partition }) => {
  if (!partition) return { ok: false };
  const ses = session.fromPartition(partition);
  try {
    await ses.clearStorageData();
    await ses.clearCache();
    rerollSeed(ses);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

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

// Apply Shields + downloads to EVERY jar the app ever creates. This is the
// keystone for the multi-jar model: containers, burners and per-site jars all
// inherit protection automatically.
app.on('session-created', (ses) => {
  applyShields(ses);
  wireDownloadHandler(ses);
});

app.whenReady().then(() => {
  shields.load();
  jars.load();
  // Cover the sessions that may already exist before the hook was attached.
  wireDownloadHandler(session.defaultSession);
  applyShields(session.defaultSession);
  const pageSession = session.fromPartition(PAGE_PARTITION);
  wireDownloadHandler(pageSession);
  applyShields(pageSession);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
