'use strict';

const { app, BrowserWindow, Menu, ipcMain, session, webContents, dialog, shell, protocol, net, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { registrableDomain, hostnameOf, classify } = require('./trackers');
const shields = require('./shields');
const jars = require('./jars');
const { isSafeTabUrl, isInternalPageUrl } = require('../shared/url-safety');
const { INTERNAL_PARTITION } = require('../shared/internal-page');
const { sanitizeFilename, isWithinDir } = require('./download-path');
const { createResolver } = require('./internal-assets');
const settings = require('./settings-store');
const { registerInternalHandler } = require('./internal-ipc');
const { isAutomationDevEnabled, isMcpAutomationEnabled, shouldAutoMint } = require('../shared/automation-dev');
const { createEngine } = require('./automation/engine');
const { createMcpServer, enableAndMintJarKey, mintAdminKey, revokeJarKey, revokeAdminKey, resolvePort, freePortInRange } = require('./automation/mcp-server');

const PAGE_PARTITION = 'persist:goldfinch';

// Dedicated, in-memory session for internal `goldfinch://` pages. INTERNAL_PARTITION is
// imported from the shared module above (single source of truth) — it must match
// byte-for-byte the `partition` the trusted webview sets (leg 3). No `persist:` prefix —
// the stub is static and has no state to persist (DD3).

// Register `goldfinch://` as a privileged scheme at MODULE LOAD — before app ready, which
// registerSchemesAsPrivileged requires. `standard: true` is LOAD-BEARING: it gives the
// scheme real origin/host semantics so `new URL('goldfinch://settings').host === 'settings'`
// (the host-based routing the handler relies on) and yields a secure context for the strict
// CSP; `secure: true` marks it a trusted origin. Do NOT "simplify" these privileges away. (DD2)
protocol.registerSchemesAsPrivileged([{ scheme: 'goldfinch', privileges: { standard: true, secure: true } }]);

// Fixed host -> per-path allowlist for the internal scheme. Each entry is
// { [normalizedPathname]: absoluteFilePath }. Absolute paths stay HERE (in main.js
// with __dirname access); internal-assets.js is __dirname-free so it can be unit-tested
// with a synthetic map. Adding a page (Flight 5+) is an explicit edit here, never a
// directory passthrough — paths are NOT derived from the URL, so traversal is structurally
// impossible. `asar:false` + `files: src/**/*` ship these unpacked, so pathToFileURL
// resolves in dev and packaged builds alike.
const INTERNAL_PAGES = {
  settings: {
    '/': path.join(__dirname, '..', 'renderer', 'pages', 'settings.html'),
    '/settings.css': path.join(__dirname, '..', 'renderer', 'pages', 'settings.css'),
    '/settings.js': path.join(__dirname, '..', 'renderer', 'pages', 'settings.js'),
    // Pure pagination/freshness module loaded by settings.html as a same-origin
    // <script> before settings.js. Kept in src/shared/ for the lint-clean UMD tail
    // + node-test require(); served here so the goldfinch://settings guest can load
    // it (the internal scheme serves ONLY this allowlist — a ../shared/ path 404s).
    '/audit-paging.js': path.join(__dirname, '..', 'shared', 'audit-paging.js')
  }
};

// Build the resolver once at startup; handleInternal calls it per request.
const resolveInternal = createResolver(INTERNAL_PAGES);

// Strict CSP for internal pages, set in the protocol.handle RESPONSE headers (DD3) — NOT via
// onHeadersReceived (custom-protocol responses bypass the webRequest pipeline, so that hook
// would silently never fire). `frame-ancestors 'none'` is the in-page half of the anti-embed
// guarantee; `default-src 'self'` forbids inline script/style (the stub uses neither).
const INTERNAL_CSP = "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'";

// Set to true immediately BEFORE session.fromPartition(INTERNAL_PARTITION). That call emits
// `session-created` SYNCHRONOUSLY, before any post-creation marker on the session could be
// set — so the hook must read THIS module-scoped flag to skip the web-content wirings
// (applyShields + wireDownloadHandler). The post-creation `__goldfinchInternal` marker is
// only belt-and-suspenders. (DD3 / leg acceptance criterion)
let creatingInternalSession = false;

// protocol.handle handler for the internal session. Serves ONLY the fixed INTERNAL_PAGES
// allowlist (host + path, GET); 404s everything else; 405s non-GET; never throws
// (an unhandled throw in protocol.handle yields a failed load with no diagnostics).
// Content-type is derived from the resolved map entry's file extension (via contentTypeFor
// inside createResolver), never from the raw URL pathname — traversal is structurally
// impossible because the file path comes from the fixed map, not from pathname arithmetic.
async function handleInternal(request) {
  if (request.method !== 'GET') {
    return new Response('Method not allowed', { status: 405 });
  }
  const url = new URL(request.url);
  const resolved = resolveInternal(url.host, url.pathname);
  if (!resolved) {
    return new Response('Not found', { status: 404 });
  }
  try {
    const res = await net.fetch(pathToFileURL(resolved.file).toString());
    if (!res.ok) return new Response('Not found', { status: 404 });
    // Re-wrap so we control the headers — do NOT pass net.fetch's file: headers verbatim.
    // res.body is a ReadableStream, accepted by the Response constructor.
    return new Response(res.body, {
      headers: {
        'Content-Type': resolved.contentType,
        'Content-Security-Policy': INTERNAL_CSP
      }
    });
  } catch {
    return new Response('Internal error', { status: 500 });
  }
}

let mainWindow = null;
// The loopback MCP automation server (Flight 3). Module-scoped so the shutdown
// hooks (before-quit / window-all-closed) can reach it. Stays null unless the
// process was launched with --automation-dev (isMcpAutomationEnabled, DD4).
let mcpServer = null;
// Bind-status of the MCP automation server, captured at start (Flight 5 / DD1).
// Queryable via the origin-checked `automation:get-status` IPC so the Settings UI
// can show whether the surface is active and which port it bound. `enabled` is the
// MCP surface being active in this process; `bound` flips true only after start()
// resolves; `error` carries the EADDRINUSE/other message on failure.
let mcpStatus = { enabled: false, host: '127.0.0.1', port: null, bound: false, error: null };
// Concurrency guard for live port-rebind (Flight 5, Leg 7). Two quick saves must
// not overlap a stop()/start() pair; the second rebind waits for the first.
let rebinding = null;

// Create + start a fresh MCP server instance, capturing bind-status into mcpStatus
// (Flight 5 / DD1 + Leg 7). NO explicit `port` is passed, so createMcpServer runs
// resolvePort (env GOLDFINCH_MCP_PORT > persisted automationPort > default) — which
// is exactly what makes a live-rebind pick up a newly-saved port and keeps the
// precedence coherent with a fresh launch. Sets bound=true on a successful bind, or
// records the error (e.g. EADDRINUSE) and leaves bound=false on failure.
async function startMcpServerInstance() {
  mcpServer = createMcpServer({
    // Engine accessor now takes an options bag so the per-session admin Server
    // can build an allowInternal engine (DD6 / Leg 2). createEngine forwards it.
    getEngine: (engineOpts) => createEngine(() => mainWindow, engineOpts),
    // Jar-scoping context (Leg 2). fromId / fromPartition are the SAME handles
    // the engine uses (webContents.fromId / session.fromPartition) so the
    // façade's membership compare and the engine's op resolve cannot diverge.
    scopeCtx: {
      jars,
      fromId: (id) => webContents.fromId(id),
      fromPartition: (partition) => session.fromPartition(partition),
      getChromeContents: () => (mainWindow ? mainWindow.webContents : null),
    },
    // Audit fan-out (Flight 4, Leg 3, DD8): every recorded tool call and every
    // session open/close broadcasts the new audit snapshot over the M02 channel.
    broadcast: (payload) => broadcastToChromeAndInternal('automation-activity-changed', payload),
  });
  // Capture the resolved port up front; bound flips true once start() resolves.
  mcpStatus = { enabled: true, host: '127.0.0.1', port: mcpServer.port, bound: false, error: null };
  try {
    await mcpServer.start();
    mcpStatus.bound = true;
  } catch (err) {
    // A bind failure (e.g. EADDRINUSE) must not crash the app — record it for the
    // status surface and leave the rest of the browser running. On a failed rebind
    // the surface is down on a bad port; the operator re-saves a good one.
    mcpStatus.bound = false;
    mcpStatus.error = (err && err.message) || String(err);
    console.error('[mcp] failed to start automation server:', err && err.message);
  }
}

// Live-rebind the running MCP server to the current resolved port (Flight 5, Leg 7).
// No-op when the surface is not active in this process (nothing to rebind). Stops
// the old listener + all sessions, then starts a fresh instance via resolvePort, so
// a port saved in Settings applies live (live-rebind == next-launch precedence). A
// simple promise-chain guard serializes overlapping saves.
async function rebindMcpServer() {
  if (!mcpServer) return; // surface not active — nothing to rebind
  if (rebinding) { await rebinding; }
  rebinding = (async () => {
    await mcpServer.stop();
    await startMcpServerInstance();
  })();
  try {
    await rebinding;
  } finally {
    rebinding = null;
  }
}

// Shared get-status return shape (Leg 7). `port` reflects the bound port when the
// surface is active; when disabled, mcpStatus.port is null so we compute the
// would-be resolved port. Host is hard-pinned to loopback (SC7).
function currentAutomationStatus() {
  return {
    enabled: mcpStatus.enabled,
    host: '127.0.0.1',
    port: mcpStatus.port != null ? mcpStatus.port : resolvePort(() => settings),
    bound: mcpStatus.bound,
    error: mcpStatus.error,
  };
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  /** @type {Electron.BrowserWindowConstructorOptions} */
  const frameOpts = isMac
    ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 12, y: 14 } } // mac inset — recheck on a mac (open question)
    : { frame: false };
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1e1f25',
    title: 'Goldfinch',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    ...frameOpts,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'chrome-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // <webview> tag is how we embed real Chromium web pages as tabs.
      webviewTag: true,
      sandbox: false,
      // Dev-only: inject --automation-dev into the renderer process.argv so chrome-preload.js
      // can gate the automationDevInvoke bridge method without access to the browser-process
      // --remote-debugging-port switch (which is not in the renderer's own process.argv).
      // Conditional spread so the key is simply absent in normal/release runs (AC3). (DD7)
      ...(isAutomationDevEnabled(process.argv) ? { additionalArguments: ['--automation-dev'] } : {})
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Run each <webview> preload in the page's MAIN world so the privacy hooks
  // can wrap fingerprinting APIs directly (CSP-immune). nodeIntegration stays
  // off, so pages get no Node; the preload's vars stay module-scoped.
  //
  // EXCEPTION: the trusted internal `goldfinch://` webview (identified by its
  // partition) runs CONTEXT-ISOLATED + sandboxed with no node — it's privileged
  // local chrome, not untrusted web content, and its minimal preload uses only
  // contextBridge (sandbox-compatible). (DD5 / leg 3)
  mainWindow.webContents.on('will-attach-webview', (_e, webPreferences, params) => {
    if (params.partition === INTERNAL_PARTITION) {
      webPreferences.contextIsolation = true;
      webPreferences.nodeIntegration = false;
      webPreferences.sandbox = true;
      return;
    }
    webPreferences.contextIsolation = false;
    webPreferences.sandbox = false;
    webPreferences.nodeIntegration = false;
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Forward maximize state to the renderer so the custom window controls can
  // sync their label/icon/data-state (DD7 read path).
  mainWindow.on('maximize', () => mainWindow.webContents.send('window-maximized-change', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window-maximized-change', false));
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
    // Session-aware navigation guard (DD4). The internal `goldfinch://` session may
    // navigate only within its own allowlist; every web-origin webview keeps the
    // stricter web rule (still rejects goldfinch://, file:, data:, javascript:, …).
    // Optional access → a missing/falsy session falls through to the stricter web branch.
    contents.on('will-navigate', (e, url) => {
      if (/** @type {any} */ (contents.session)?.__goldfinchInternal) {
        // Internal session: only ever on the internal allowlist (goldfinch://settings).
        if (!isInternalPageUrl(url)) e.preventDefault();
      } else {
        // Web session: unchanged.
        if (!isSafeTabUrl(url)) e.preventDefault();
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Downloads. The renderer asks us to download a media URL using the *page's*
// own session (so cookies / referer / auth are preserved). We resolve the
// originating webview by its webContents id.
// ---------------------------------------------------------------------------
const pendingDownloads = new Map(); // url -> { suggestedName }
const approvedDownloadDirs = new Set(); // session-scoped; populated by choose-download-dir

ipcMain.handle('download-media', async (_event, { webContentsId, url, suggestedName, saveDir }) => {
  const wc = typeof webContentsId === 'number' ? webContents.fromId(webContentsId) : null;
  const downloader = wc || (mainWindow && mainWindow.webContents);
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

// Build a non-colliding path inside dir for filename, sanitizing the name.
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
    console.warn('[uniquePath] candidate escaped dir, falling back:', candidate);
    candidate = path.join(dir, 'download');
  }
  return candidate;
}

ipcMain.handle('choose-download-dir', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a folder to download all media into',
    properties: ['openDirectory', 'createDirectory']
  });
  if (res.canceled || !res.filePaths.length) return null;
  const chosen = res.filePaths[0];
  approvedDownloadDirs.add(path.resolve(chosen));
  return chosen;
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

// ---------------------------------------------------------------------------
// Privacy monitor (observe-only). Watches page network traffic, classifies
// third-party / tracker requests, flags mixed content, and logs permission
// requests. Aggregated per tab and streamed to the renderer.
// ---------------------------------------------------------------------------
const SENSITIVE_PERMISSIONS = new Set([
  'media',
  'geolocation',
  'notifications',
  'midi',
  'midiSysex',
  'clipboard-read',
  'hid',
  'serial',
  'usb',
  'bluetooth',
  'idle-detection',
  'display-capture'
]);

const privacyByTab = new Map(); // webContentsId -> aggregate
const privacySendTimers = new Map();

function blankAgg(firstParty) {
  return {
    firstParty: firstParty || '',
    secure: true,
    total: 0,
    mixedContent: 0,
    blocked: 0, // tracker requests cancelled (raw)
    strippedDomains: {}, // distinct domains whose URLs were cleaned
    cookieBlockedDomains: {}, // distinct third-party domains whose cookies were dropped
    thirdPartyDomains: {}, // domain -> count
    // each category: { domain -> { blocked } }
    trackers: { ads: {}, analytics: {}, social: {}, other: {} }
  };
}

function serializeAgg(a) {
  const cats = ['ads', 'analytics', 'social', 'other'];
  let count = 0,
    blockedT = 0;
  const trackers = { count: 0, blocked: 0, allowed: 0 };
  for (const cat of cats) {
    trackers[cat] = Object.entries(a.trackers[cat]).map(([domain, v]) => {
      count++;
      if (v.blocked) blockedT++;
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
    stripped: Object.keys(a.strippedDomains).length, // distinct domains
    cookiesBlocked: Object.keys(a.cookieBlockedDomains).length, // distinct domains
    thirdPartyCount: Object.keys(a.thirdPartyDomains).length,
    thirdPartyList: Object.entries(a.thirdPartyDomains)
      .map(([domain, count]) => ({ domain, count }))
      .sort((x, y) => y.count - x.count)
      .slice(0, 200),
    trackers
  };
}

function schedulePrivacySend(id) {
  if (privacySendTimers.has(id)) return;
  privacySendTimers.set(
    id,
    setTimeout(() => {
      privacySendTimers.delete(id);
      const agg = privacyByTab.get(id);
      if (agg && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('privacy-net', { webContentsId: id, agg: serializeAgg(agg) });
      }
    }, 350)
  );
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
  if (!agg) {
    agg = blankAgg('');
    privacyByTab.set(id, agg);
  }
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
  // Belt-and-suspenders: the internal session is excluded primarily by the module-flag
  // skip in the `session-created` hook (it fires synchronously during fromPartition, before
  // this marker is set). This guard only catches any later explicit applyShields call.
  if (ses.__goldfinchInternal) return;
  if (ses.__goldfinchShields) return; // wire each session once
  ses.__goldfinchShields = true;

  ses.webRequest.onBeforeRequest((details, cb) => {
    const fp = tabFirstParty(details.webContentsId) || registrableDomain(hostnameOf(details.url));
    let action = 'allow';
    let response = {};

    // Block known trackers (never the top-level document).
    if (details.resourceType !== 'mainFrame' && shields.active('block', fp)) {
      const c = classify(details.url, fp);
      if (c.thirdParty && c.tracker) {
        action = 'block';
        response = { cancel: true };
      }
    }
    // Strip tracking params (redirect to the clean URL).
    if (action === 'allow' && shields.active('strip', fp)) {
      const clean = shields.stripUrl(details.url);
      if (clean && clean !== details.url) {
        action = 'strip';
        response = { redirectURL: clean };
      }
    }
    try {
      recordRequest(details, action);
    } catch {
      /* never break traffic */
    }
    cb(response);
  });

  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    const fp = tabFirstParty(details.webContentsId) || registrableDomain(hostnameOf(details.url));
    const headers = details.requestHeaders;
    if (shields.active('strip', fp) && headers.Referer) {
      try {
        headers.Referer = new URL(headers.Referer).origin + '/';
      } catch {
        delete headers.Referer;
      }
    }
    if (shields.active('isolate', fp) && details.resourceType !== 'mainFrame' && headers.Cookie) {
      const c = classify(details.url, fp);
      if (c.thirdParty) {
        delete headers.Cookie;
        const agg = privacyByTab.get(details.webContentsId);
        if (agg && c.domain) {
          agg.cookieBlockedDomains[c.domain] = 1;
          schedulePrivacySend(details.webContentsId);
        }
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

// Settings read channel. INTENTIONALLY NOT behind the internal-sender guard — trust domain
// is the file:// chrome (window.goldfinch surface in chrome-preload.js), same as shields-get.
// Web webviews have no ipcRenderer.invoke, so only the chrome + internal guest can reach IPC.
ipcMain.handle('settings-get', (_e, key) => key ? settings.get(key) : settings.getAll());

/**
 * Broadcast a channel+payload to both audiences that need settings/shields change events:
 *  1. The chrome renderer (`mainWindow.webContents`, a file:// BrowserWindow) — sent separately
 *     because the __goldfinchInternal filter below intentionally excludes it (it is not an
 *     internal-session webContents).
 *  2. Every webContents whose session carries __goldfinchInternal === true (the settings guest
 *     and any other future goldfinch:// internal pages).
 * Leg 4 reuses this helper for the shields-changed broadcast to the settings guest.
 * @param {string} channel
 * @param {unknown} payload
 */
function broadcastToChromeAndInternal(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
  for (const wc of webContents.getAllWebContents()) {
    if (!wc.isDestroyed() && wc.session && /** @type {any} */ (wc.session).__goldfinchInternal === true) {
      wc.send(channel, payload);
    }
  }
}

// Shields config IPC. INTENTIONALLY NOT behind the internal-sender guard — their trust
// domain is the file:// chrome (window.goldfinch surface in chrome-preload.js), not the
// goldfinch:// internal session. Do not "close" these channels with registerInternalHandler.
ipcMain.handle('shields-get', () => shields.get());
ipcMain.handle('shields-set', (_e, patch) => {
  const cfg = shields.set(patch || {});
  broadcastToChromeAndInternal('shields-changed', cfg);
  return cfg;
});
ipcMain.handle('shields-pause', (_e, { site, paused }) => {
  const cfg = shields.setPaused(site, paused);
  broadcastToChromeAndInternal('shields-changed', cfg);
  return cfg;
});

// Internal-session-only settings IPC. These channels are guarded by registerInternalHandler:
// the wrapper verifies that event.senderFrame.origin === 'goldfinch://settings' AND the
// sender's session carries __goldfinchInternal === true before forwarding to the handler.
// A non-trusted sender gets a rejected invoke (the throw propagates as a promise rejection).
registerInternalHandler(ipcMain, 'internal-settings-get', (_e, key) => key ? settings.get(key) : settings.getAll());
registerInternalHandler(ipcMain, 'internal-settings-set', (_e, key, value) => {
  const cfg = settings.set(key, value);
  broadcastToChromeAndInternal('settings-changed', settings.getAll());
  return cfg;
});
registerInternalHandler(ipcMain, 'internal-shields-get', () => shields.get());
registerInternalHandler(ipcMain, 'internal-shields-set', (_e, patch) => {
  const cfg = shields.set(patch || {});
  broadcastToChromeAndInternal('shields-changed', cfg);
  return cfg;
});

// Automation bind-status surface (Flight 5 / DD1). The shape is shared with
// set-port via currentAutomationStatus() (Leg 7) — `port` reflects the bound port
// when the surface is active, else the would-be resolved port; host is hard-pinned
// to loopback (SC7 — never configurable).
registerInternalHandler(ipcMain, 'automation:get-status', () => currentAutomationStatus());
// Persist the port AND live-rebind the running surface to it (Flight 5, Leg 7).
// settings.set throws on an invalid port → rejected invoke → the renderer shows
// "Invalid port". rebindMcpServer rebinds if the surface is active (resolvePort
// picks up the new setting), or is a no-op otherwise. Returns the fresh status so
// the renderer renders the now-active port without a separate get-status round-trip.
registerInternalHandler(ipcMain, 'automation:set-port', async (_e, port) => {
  settings.set('automationPort', port);
  await rebindMcpServer();
  return currentAutomationStatus();
});
// Advisory free-port scan over the loopback dynamic range for the Settings UI's
// "find a free port" affordance (leg 2). Returns { port: null } if none free.
registerInternalHandler(ipcMain, 'automation:find-free-port', async () => ({ port: await freePortInRange() }));

// Clipboard write fallback (Flight 5, Leg 2 — DD4). navigator.clipboard is the
// primary path in the secure goldfinch://settings page, but it can be blocked at
// runtime under contextIsolation + sandbox; this origin-checked IPC gives the
// settings copy buttons a reliable fallback. First copy consumer is leg 2's MCP
// address; leg 3's key copy reuses the shared copyText() helper that calls this.
registerInternalHandler(ipcMain, 'clipboard:write', (_e, text) => {
  clipboard.writeText(String(text == null ? '' : text));
  return { ok: true };
});

// Automation key management (Flight 5, Leg 3 / SC9). All origin-checked
// (registerInternalHandler) — the secure goldfinch://settings page is the only
// allowed sender. Mint returns the show-once plaintext (the ONLY way plaintext
// leaves main — never persisted, never logged); list/revoke deal in hashes only.
// `list-keys` is the single source for the admin env gate (AC2 — get-status does
// NOT report it). Generate and rotate are the same mint op (DD5); the UI labels
// the button per hasKey/adminKeySet.
registerInternalHandler(ipcMain, 'automation:list-keys', () => {
  const hashes = settings.get('automationKeyHashes') || {};
  return {
    jars: jars.list().map((j) => ({ id: j.id, name: j.name, color: j.color, hasKey: !!hashes[j.id] })),
    adminEnabled: !!process.env.GOLDFINCH_AUTOMATION_ADMIN,
    adminKeySet: (settings.get('automationAdminKeyHash') || '') !== '',
  };
});
registerInternalHandler(ipcMain, 'automation:jar-key-mint', (_e, jarId) => {
  // enableAndMintJarKey flips automationEnabled=true via a direct settings.set;
  // broadcast settings-changed so the enable toggle's onSettingsChanged listener
  // re-syncs without a reload. (Admin-mint/revoke do NOT touch automationEnabled.)
  const key = enableAndMintJarKey(jarId, settings, jars);
  broadcastToChromeAndInternal('settings-changed', settings.getAll());
  return { key };
});
registerInternalHandler(ipcMain, 'automation:jar-key-revoke', (_e, jarId) => { revokeJarKey(jarId, settings); return { ok: true }; });
registerInternalHandler(ipcMain, 'automation:admin-key-mint', () => ({ key: mintAdminKey(settings) }));
registerInternalHandler(ipcMain, 'automation:admin-key-revoke', () => { revokeAdminKey(settings); return { ok: true }; });

// Read-only automation activity snapshot (Flight 5, Leg 4 / SC10 / DD6).
// INTENTIONALLY a bare ipcMain.handle — NOT registerInternalHandler — for the SAME
// reason as `settings-get`/`shields-get` above: BOTH the file:// chrome toolbar
// indicator AND the goldfinch://settings audit viewer read it. The chrome's file://
// origin fails the internal-origin check, so wrapping this in registerInternalHandler
// would silently break the chrome indicator. Do NOT "fix" it that way. This is safe:
// the payload is non-secret operator-facing audit state (sessions + an action log; it
// carries NO key or hash), and only the chrome + internal preloads can reach IPC at
// all — a web webview has no ipcRenderer. The sibling automation:* handlers above ARE
// origin-checked because only the settings page calls them; this one is the deliberate
// exception because the chrome also reads it.
ipcMain.handle('automation:get-activity', () => (mcpServer ? mcpServer.getActivity() : { sessions: [], log: [] }));

// Per-jar fingerprint seed. Stable for a session so a site sees a consistent
// (but fake) fingerprint; different per jar = a different "persona". Rerolled
// by New Identity (stage 3).
const farbleSeeds = new WeakMap();
function seedForSession(ses) {
  let s = farbleSeeds.get(ses);
  if (s == null) {
    s = Math.floor(Math.random() * 0xffffffff) >>> 0;
    farbleSeeds.set(ses, s);
  }
  return s;
}
function rerollSeed(ses) {
  farbleSeeds.set(ses, Math.floor(Math.random() * 0xffffffff) >>> 0);
}

// The webview preload asks (synchronously, at document-start) whether to farble
// and with which seed.
ipcMain.on('shields-farble', (event, url) => {
  const site = registrableDomain(hostnameOf(url || ''));
  event.returnValue = {
    farble: shields.active('farble', site),
    seed: seedForSession(event.sender.session)
  };
});

// --- window controls (custom frameless min/max/close, win+linux) ---
ipcMain.on('window-minimize', () => mainWindow && mainWindow.minimize());
ipcMain.on('window-toggle-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
// DD6: close() → 'closed' → 'window-all-closed' → app.quit() (non-darwin); NOT app.quit() directly.
ipcMain.on('window-close', () => mainWindow && mainWindow.close());
ipcMain.handle('window-is-maximized', () => !!(mainWindow && mainWindow.isMaximized()));

// Kebab-menu Exit (mission SC4): quit on ALL platforms. Distinct from `window-close`
// (the window button), whose `window-all-closed` path does not quit on macOS (main.js:536-537).
ipcMain.on('app-quit', () => app.quit());

// Right-click a pinned toolbar icon → native "Unpin {item}" context menu.
// Writes via `settings.set` + `broadcastToChromeAndInternal` (DD7). Chrome-trusted one-way
// send (same trust domain as window-minimize/app-quit — no origin-check needed).
ipcMain.on('toolbar-context-menu', (_e, item) => {
  if (!mainWindow) return;
  if (item !== 'media' && item !== 'shields') return;
  const label = 'Unpin ' + (item === 'media' ? 'Media' : 'Shields');
  const menu = Menu.buildFromTemplate([
    { label, click: () => {
      const pins = { ...settings.get('toolbarPins'), [item]: false };
      settings.set('toolbarPins', pins);
      broadcastToChromeAndInternal('settings-changed', settings.getAll());
    } }
  ]);
  menu.popup({ window: mainWindow });
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
  let first = 0,
    third = 0;
  const list = all
    .map((ck) => {
      const d = registrableDomain(ck.domain.replace(/^\./, ''));
      const isThird = !!fp && d !== fp;
      isThird ? third++ : first++;
      return { name: ck.name, domain: ck.domain, third: isThird, secure: ck.secure, session: !ck.expirationDate };
    })
    .sort((a, b) => (a.third === b.third ? 0 : a.third ? 1 : -1));
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
      try {
        await ses.cookies.remove(`${proto}://${host}${ck.path || '/'}`, ck.name);
        removed++;
      } catch {
        /* skip */
      }
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
  // PRIMARY exclusion of the internal session: this hook fires synchronously inside
  // session.fromPartition(INTERNAL_PARTITION) (see whenReady), so the module flag is the
  // only reliable discriminator — a post-creation marker isn't set yet. Skip BOTH the web
  // Shields/tracker hooks and the download handler, which have no business on a bundled
  // local page. (DD3)
  if (creatingInternalSession) {
    /** @type {any} */ (ses).__goldfinchInternal = true;
    return;
  }
  applyShields(ses);
  wireDownloadHandler(ses);
});

app.whenReady().then(() => {
  shields.load();
  settings.load(app.getPath('userData'));
  jars.load();
  // Cover the sessions that may already exist before the hook was attached.
  wireDownloadHandler(session.defaultSession);
  applyShields(session.defaultSession);
  const pageSession = session.fromPartition(PAGE_PARTITION);
  wireDownloadHandler(pageSession);
  applyShields(pageSession);

  // Dedicated internal session for `goldfinch://` pages. Set the flag BEFORE fromPartition
  // so the synchronous `session-created` hook skips applyShields + wireDownloadHandler for
  // it, then register the scheme handler on THIS session's protocol (session-scoped — the
  // global protocol would bind the default session and the internal webview wouldn't see it). (DD2/DD3)
  creatingInternalSession = true;
  const internalSession = session.fromPartition(INTERNAL_PARTITION); // emits session-created synchronously NOW
  creatingInternalSession = false;
  /** @type {any} */ (internalSession).__goldfinchInternal = true; // belt-and-suspenders for any later applyShields call
  internalSession.protocol.handle('goldfinch', handleInternal);

  createWindow();

  // Dev-only automation seam (DD7 — interim; folded into the gated transport at Flight 3).
  // Registered ONCE at startup, after createWindow() so mainWindow exists.
  // Never registered in production (no --remote-debugging-port → isAutomationDevEnabled false).
  // The identity check (event.sender === mainWindow.webContents) isolates the seam to the
  // chrome renderer — a guest webview has its own webContents and cannot pass this check.
  // No webContents.debugger anywhere (DD8).
  if (isAutomationDevEnabled(process.argv)) {
    const engine = createEngine(() => mainWindow);
    ipcMain.handle('automation:dev-invoke', async (event, { op, args } = {}) => {
      // event.sender identity is sufficient here (unlike internal-ipc's senderFrame.origin
      // check): this handler is NEVER registered in production (dev-gated), and a guest webview
      // has a different webContents than mainWindow's, so the identity check fully isolates it.
      if (!mainWindow || event.sender !== mainWindow.webContents) {
        throw new Error('automation: dev-seam is chrome-renderer-only');
      }
      if (typeof engine[op] !== 'function') throw new Error('automation: unknown op ' + op);
      return engine[op](...(Array.isArray(args) ? args : []));
    });
  }

  // Loopback MCP automation server (Flight 3, DD1–DD4). Gated on the NARROWER
  // isMcpAutomationEnabled predicate — only `--automation-dev`, NOT
  // `--remote-debugging-port` — so dev:debug (CDP) does NOT co-bind the MCP
  // server (structural CDP-decoupling; the whole point of the narrower gate).
  // Started after createWindow() so the (lazy) engine accessor sees a live
  // window. The SC7 Origin/Host guard is wired inside createMcpServer and runs
  // before any MCP processing — the server never binds without it.
  if (isMcpAutomationEnabled(process.argv)) {
    // Start the surface via the shared factory (Leg 7) — same option-bag + bind-status
    // capture as a live rebind. Fire-and-forget here, matching the original launch
    // behavior (the app does not block on the bind).
    void startMcpServerInstance();

    // Dev-only AUTO-MINT-TO-STDOUT affordance (Flight 4, Leg 5). The real key
    // management now lives in goldfinch://settings (Flight 5, Leg 3) via the
    // origin-checked automation:jar-key-mint / automation:admin-key-mint IPC; that
    // surface is renderer-driven and so unreachable by an external headless /
    // behavior-test harness. This block lets such a harness flip the surface on and
    // read a key WITHOUT a renderer round-trip. DEV-ONLY and least-privilege:
    //   - Fires ONLY under the double gate shouldAutoMint(argv, env): the EXACT
    //     `--automation-dev` token (already true in this branch) AND
    //     GOLDFINCH_AUTOMATION_DEV_MINT === '1'. A shipped build never carries
    //     `--automation-dev`, so this can never run in production.
    //   - A plain `npm run dev:automation` (no GOLDFINCH_AUTOMATION_DEV_MINT) does
    //     NOT enable the surface and prints NOTHING — off-by-default stays observable.
    //   - Mints for the canonical persistent 'default' jar (always present in
    //     jars.list(); the mint guard rejects unknown/burner ids). Admin key minted
    //     only when GOLDFINCH_AUTOMATION_ADMIN is also set (gated in mintAdminKey).
    //   - Prints the result ONCE to stdout as a single parseable line so the FD can
    //     scrape the Bearer key. The plaintext key is never persisted (only its hash).
    if (shouldAutoMint(process.argv, process.env)) {
      try {
        const key = enableAndMintJarKey('default', settings, jars);
        const adminKey = process.env.GOLDFINCH_AUTOMATION_ADMIN ? mintAdminKey(settings) : null;
        // enableAndMintJarKey flips automationEnabled=true. Single parseable line.
        process.stdout.write('AUTOMATION_DEV_MINT ' + JSON.stringify({ key, adminKey }) + '\n');
      } catch (err) {
        console.error('[mcp] dev auto-mint failed:', err && err.message);
      }
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Primary MCP stop hook — before-quit fires on a real quit across ALL platforms,
// including macOS (where window-all-closed does NOT quit). stop() is idempotent,
// so both this and the window-all-closed secondary firing is safe.
app.on('before-quit', () => { mcpServer?.stop(); });

app.on('window-all-closed', () => {
  // Secondary MCP stop, INSIDE the non-darwin branch: on macOS closing all
  // windows does not quit (the app stays dock-resident), so we must NOT tear the
  // server down there while the app lives — before-quit handles macOS.
  if (process.platform !== 'darwin') {
    mcpServer?.stop();
    app.quit();
  }
});
