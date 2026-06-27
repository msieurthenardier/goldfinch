'use strict';

const { app, BaseWindow, WebContentsView, ipcMain, session, webContents, desktopCapturer, dialog, shell, protocol, net, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { registrableDomain, hostnameOf, classify } = require('./trackers');
const shields = require('./shields');
const jars = require('./jars');
const { isSafeTabUrl, isInternalPageUrl } = require('../shared/url-safety');
const { INTERNAL_PARTITION } = require('../shared/internal-page');
const { initProfileAndStores } = require('./init-profile');
const { sanitizeFilename, isWithinDir } = require('./download-path');
const { createResolver } = require('./internal-assets');
const settings = require('./settings-store');
const downloads = require('./downloads-store');
const { createManager } = require('./downloads-manager');
const { buildRegisterRecord, buildProgressPayload, buildDonePayload } = require('./downloads-payload');
const { registerInternalHandler } = require('./internal-ipc');
const { isMcpAutomationEnabled, shouldAutoMint, shouldBindAutomation } = require('../shared/automation-dev');
const { createEngine } = require('./automation/engine');
const { createMcpServer, mintJarKey, mintAdminKey, revokeJarKey, revokeAdminKey, resolvePort, freePortInRange } = require('./automation/mcp-server');
const { makeAutomationToggle } = require('./automation/toggle');
// DevTools human-path: import the SHARED open/close helper (Flight-3 DD1, one code path with the
// M03 ops) and the SHARED internal-session predicate. The sibling chrome handlers (zoom/print)
// inline `wc.session?.__goldfinchInternal`; this handler imports isInternalContents so the human
// path and the MCP ops single-source the SAME internal-detection function (it is ELECTRON-FREE).
const { toggleDevTools } = require('./devtools');
const { isInternalContents } = require('./automation/resolve');

// A closed stdout/stderr reader (e.g. the launcher of `npm run dev:automation` detaching, or a
// truncating pipe under --enable-logging) makes Electron's console forwarding + the AUTOMATION_DEV_MINT
// write throw EPIPE. With no handler that surfaces as a modal "main process" crash dialog. Swallow
// EPIPE; surface anything else via emitWarning — NOT throw (a throw inside an 'error' listener re-raises
// as uncaught, the very crash we're preventing) and NOT console.* (routes back to the broken stream).
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err) => {
    if (err && err.code === 'EPIPE') return;
    process.emitWarning(err);
  });
}

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
  },
  // Second internal page (Flight 5, Leg 2): the app-level downloads surface. Same
  // allowlist-driven serving as settings — handleInternal/createResolver/INTERNAL_CSP
  // are unchanged. Adding it here is the explicit edit that registers the page.
  downloads: {
    '/': path.join(__dirname, '..', 'renderer', 'pages', 'downloads.html'),
    '/downloads.css': path.join(__dirname, '..', 'renderer', 'pages', 'downloads.css'),
    '/downloads.js': path.join(__dirname, '..', 'renderer', 'pages', 'downloads.js')
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
// The chrome WebContentsView hosted inside the BaseWindow (DD2). mainWindow is now a
// BaseWindow with no `.webContents`; ALL chrome-renderer access routes through chromeView's
// webContents via getChromeContents() below. Null until createWindow() runs / after close.
/** @type {Electron.WebContentsView | null} */
let chromeView = null;
// The single canonical chrome-contents accessor (DD2). Returns the chrome view's webContents
// or null when the view is absent (startup/teardown). EVERY former chrome-renderer webContents
// site routes through this; the engine + scope-ctx seams point at this same accessor.
const getChromeContents = () => (chromeView ? chromeView.webContents : null);

// Tab-view registry: keyed by guest webContents.id → { view, partition, trusted, active }
const tabViews = new Map();
// Active tab's wcId (null when no web tab is active)
let activeTabWcId = null;


// Returns the guest webContents for a tab view by its wcId (or null if not found/destroyed).
function getTabContents(wcId) {
  const entry = tabViews.get(wcId);
  if (!entry) return null;
  const wc = entry.view.webContents;
  return (wc && !wc.isDestroyed()) ? wc : null;
}

// Returns the active web tab's webContents (or null).
function getActiveTabContents() {
  return activeTabWcId != null ? getTabContents(activeTabWcId) : null;
}

// The loopback MCP automation server (Flight 3). Module-scoped so the shutdown
// hooks (before-quit / window-all-closed) can reach it. Stays null until the
// surface binds: in production the Settings `automationEnabled` toggle is the sole
// bind gate (Flight 8); in dev an unpackaged run with --automation-dev force-binds
// via the dev-enable override (no-op when packaged, DD4).
let mcpServer = null;
// Bind-status of the MCP automation server, captured at start (Flight 5 / DD1).
// Queryable via the origin-checked `automation:get-status` IPC so the Settings UI
// can show whether the surface is active and which port it bound. `enabled` is the
// MCP surface being active in this process; `bound` flips true only after start()
// resolves; `error` carries the EADDRINUSE/other message on failure.
let mcpStatus = { enabled: false, host: '127.0.0.1', port: null, bound: false, error: null };
// In-memory dev-enable override (DD3/DD4, Flight 8). Module-scoped so both
// startMcpServerInstance (auth gate) and applyAutomationEnabledChange (flip-OFF
// guard) can read it; assigned once in app.whenReady (after app.isPackaged is
// settled) to `!app.isPackaged && isMcpAutomationEnabled(process.argv)`. Writes
// NOTHING to the settings store — the persisted `automationEnabled` stays the sole
// human-written value. Never active in a packaged build.
let devEnableOverride = false;

// Grab a screenshot of the main window as a base64 PNG (Flight 3, Leg 1).
// Tries desktopCapturer first (with correct thumbnailSize); falls back to a
// chrome+guest canvas composite on WSLg (dep-free, via executeJavaScript).
// Injected into the engine via deps.grabWindow so observe.js stays Electron-free.
async function grabWindow() {
  if (!mainWindow) return null;
  try {
    const bounds = mainWindow.getBounds();
    // FIX 2(a): request thumbnail at the actual window content size so we get a
    // full-resolution capture, not the 150px-wide default thumbnail.
    const { width: cw, height: ch } = mainWindow.getContentBounds();
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      fetchWindowIcons: false,
      thumbnailSize: { width: cw, height: ch },
    });
    let best = null;
    let bestScore = -1;
    for (const src of sources) {
      if (!src.thumbnail) continue;
      const size = src.thumbnail.getSize();
      if (!size || !size.width || !size.height) continue;
      const score = Math.min(size.width, bounds.width) * Math.min(size.height, bounds.height);
      if (score > bestScore) { bestScore = score; best = src; }
    }
    if (best && best.thumbnail) {
      return best.thumbnail.toPNG().toString('base64');
    }
  } catch {
    /* desktopCapturer unavailable */
  }
  // FIX 2(b) — WSLg / Wayland fallback: build a REAL chrome+guest composite in the
  // chrome renderer via executeJavaScript. Steps:
  //   1. capturePage() on chrome and active guest in parallel.
  //   2. Ask the chrome renderer for the #webviews bounding rect (the guest's offset).
  //   3. Draw chrome first, then guest at its offset, on an offscreen <canvas>;
  //      return the composite as a data URL.
  // This is dep-free and avoids shipping a broken chrome-only screenshot.
  try {
    const cc = getChromeContents();
    const atc = getActiveTabContents();
    if (!cc || cc.isDestroyed()) return null;

    // Capture both views in parallel.
    const [chromeImg, tabImg] = await Promise.all([
      cc.capturePage(),
      atc && !atc.isDestroyed() ? atc.capturePage() : Promise.resolve(null),
    ]);
    if (!chromeImg) return null;

    const chromeB64 = chromeImg.toPNG().toString('base64');
    const tabB64 = tabImg ? tabImg.toPNG().toString('base64') : null;

    if (!tabB64) {
      // No active guest — chrome-only capture.
      return chromeB64;
    }

    // Get the #webviews slot bounds from the chrome renderer so we know
    // where to draw the guest PNG on the composite canvas.
    const guestBoundsJson = await cc.executeJavaScript(
      'JSON.stringify(document.getElementById("webviews")?.getBoundingClientRect() ?? null)'
    );
    const guestBounds = guestBoundsJson ? JSON.parse(guestBoundsJson) : null;

    if (!guestBounds) {
      // Can't locate the slot — return chrome PNG only.
      return chromeB64;
    }

    // Composite in the chrome renderer: draw chrome, then guest at the slot offset.
    const compositeB64 = await cc.executeJavaScript(`(function(chromeDataUrl, tabDataUrl, gx, gy, gw, gh) {
      return new Promise(function(resolve, reject) {
        var chromeImg = new Image();
        chromeImg.onload = function() {
          var tabImg = new Image();
          tabImg.onload = function() {
            var canvas = document.createElement('canvas');
            canvas.width = chromeImg.naturalWidth;
            canvas.height = chromeImg.naturalHeight;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(chromeImg, 0, 0);
            ctx.drawImage(tabImg, Math.round(gx), Math.round(gy), Math.round(gw), Math.round(gh));
            resolve(canvas.toDataURL('image/png').replace(/^data:image\\/png;base64,/, ''));
          };
          tabImg.onerror = function() { resolve(null); };
          tabImg.src = tabDataUrl;
        };
        chromeImg.onerror = function() { reject(new Error('chrome img load failed')); };
        chromeImg.src = chromeDataUrl;
      });
    })('data:image/png;base64,${chromeB64}', 'data:image/png;base64,${tabB64}', ${guestBounds.x}, ${guestBounds.y}, ${guestBounds.width}, ${guestBounds.height})`);

    return compositeB64 || chromeB64;
  } catch {
    /* fallback failed */
  }
  return null;
}

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
    getEngine: (engineOpts) => createEngine(getChromeContents, { ...engineOpts, getDownloads: () => downloadsManager.listAll(), grabWindow }),
    // Jar-scoping context (Leg 2). fromId / fromPartition are the SAME handles
    // the engine uses (webContents.fromId / session.fromPartition) so the
    // façade's membership compare and the engine's op resolve cannot diverge.
    scopeCtx: {
      jars,
      fromId: (id) => webContents.fromId(id),
      fromPartition: (partition) => session.fromPartition(partition),
      getChromeContents,
    },
    // Audit fan-out (Flight 4, Leg 3, DD8): every recorded tool call and every
    // session open/close broadcasts the new audit snapshot over the M02 channel.
    broadcast: (payload) => broadcastToChromeAndInternal('automation-activity-changed', payload),
    // In-memory dev-enable override (DD3/DD4, Flight 8). Read LAZILY per request by
    // the auth gate so it tracks the module-scoped value. It lets a dev `dev:automation`
    // run resolve identity with the persisted toggle off, but a valid Bearer key is
    // STILL required (the override does NOT waive the key).
    devEnableOverride: () => devEnableOverride,
    // GOLDFINCH_MCP_PORT is DEV-ONLY (DD6, Leg 5): honored only in an unpackaged
    // build. In a packaged build the env is ignored everywhere; the port comes
    // from the persisted automationPort + free-port fallback.
    honorEnv: !app.isPackaged,
  });
  // Capture the resolved (attempted) port up front; this is what the failure UI
  // shows if start() rejects. bound flips true once start() resolves.
  mcpStatus = { enabled: true, host: '127.0.0.1', port: mcpServer.port, bound: false, error: null };
  try {
    await mcpServer.start();
    // Re-read the bound port post-start: in fallback mode start() may have bound a
    // DIFFERENT free port than the attempted one. mcpServer.port is a live getter.
    // The fallback is ephemeral — we never settings.set('automationPort', …) here.
    mcpStatus.port = mcpServer.port;
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

// The serialized automation toggle core (Flight 9, Leg 7 / DD8(a)). Both the live
// flip ON/OFF and the live port-rebind run through ONE shared `inFlight` chain inside
// this unit, so a concurrent flip + flip / flip + rebind / rebind + rebind cannot
// interleave their stop()/start() pairs (the F8 double-bind / lost-no-op race). The
// extracted module IS the production path — main.js's two functions below are thin
// delegators. The factory mediates the module-scoped `mcpServer` (getServer/setServer)
// and `mcpStatus` (setStatus); start/stop are startMcpServerInstance / mcpServer.stop().
const automationToggle = makeAutomationToggle({
  start: startMcpServerInstance,
  stop: () => mcpServer.stop(),
  getServer: () => mcpServer,
  setServer: (server) => { mcpServer = server; },
  isDevOverride: () => devEnableOverride,
  setStatus: (status) => { mcpStatus = status; },
});

// Live-rebind the running MCP server to the current resolved port (Flight 5, Leg 7).
// No-op when the surface is not active in this process (nothing to rebind). Stops the
// old listener + all sessions, then starts a fresh instance via resolvePort, so a port
// saved in Settings applies live. Serialized through the shared `inFlight` chain in
// automationToggle (Leg 7 / DD8(a)) — overlapping saves and interleaved flips cannot
// race.
function rebindMcpServer() {
  return automationToggle.rebind();
}

// DD2 (Flight 8): the human `automationEnabled` toggle is the SOLE bind gate in
// production. A live flip ON cold-starts the server from null; a live flip OFF tears
// it down and stays down. Hooked off the `automationEnabled` write in the
// `internal-settings-set` handler. The dev-enable override flip-OFF keeps the surface
// bound (DD3/DD4). Serialized through the shared `inFlight` chain in automationToggle
// (Leg 7 / DD8(a)): two concurrent flip-ONs result in exactly ONE start (no
// double-bind), and a flip concurrent with a rebind cannot stop()-on-null.
function applyAutomationEnabledChange(enabled) {
  return automationToggle.applyEnabledChange(enabled);
}

// Shared get-status return shape (Leg 7). `port` reflects the bound port when the
// surface is active; when disabled, mcpStatus.port is null so we compute the
// would-be resolved port. Host is hard-pinned to loopback (SC7).
function currentAutomationStatus() {
  return {
    enabled: mcpStatus.enabled,
    host: '127.0.0.1',
    port: mcpStatus.port != null ? mcpStatus.port : resolvePort(() => settings, { honorEnv: !app.isPackaged }),
    bound: mcpStatus.bound,
    error: mcpStatus.error,
  };
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  /** @type {Electron.BaseWindowConstructorOptions} */
  const frameOpts = isMac
    ? { titleBarStyle: 'hidden', trafficLightPosition: { x: 12, y: 14 } } // mac inset — recheck on a mac (open question)
    : { frame: false };
  // DD1/DD2: the window host is now a BaseWindow (no webPreferences, no `.webContents`).
  // The chrome (index.html + renderer.js) is hosted in a child WebContentsView; ALL
  // renderer access goes through getChromeContents(). backgroundColor/min size/icon/title
  // and the per-platform frameOpts carry over unchanged (DD4/DD6).
  const initialWidth = 1400;
  const initialHeight = 900;
  mainWindow = new BaseWindow({
    width: initialWidth,
    height: initialHeight,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1e1f25',
    title: 'Goldfinch',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    ...frameOpts,
  });

  // The chrome WebContentsView carries the webPreferences that used to live on the
  // BrowserWindow (DD1/DD2). Guest tabs are per-tab WebContentsViews wired explicitly
  // in tab-create (Flight 3 — all <webview> machinery removed in Leg 4).
  chromeView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'chrome-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Dev-only: inject --automation-dev into the renderer process.argv so chrome-preload.js
      // can gate the automationDevInvoke bridge method. The chrome renderer's own process.argv
      // does not otherwise carry the dev-automation switch, so it must be injected explicitly.
      // Conditional spread so the key is simply absent in normal/release runs (AC3). (DD7)
      // Gated on `!app.isPackaged` (DD4, Flight 8): the dev flag is a complete no-op in a
      // packaged build, so additionalArguments is always absent there.
      ...(isMcpAutomationEnabled(process.argv) && !app.isPackaged ? { additionalArguments: ['--automation-dev'] } : {})
    }
  });

  // BaseWindow exposes children via contentView — addChildView is on contentView, NOT
  // the window itself (DD3).
  mainWindow.contentView.addChildView(chromeView);
  // Opaque dark background matching the shell (Flight-2 DD6): prevents a white flash
  // before the chrome renderer paints its first frame on slow/WSLg starts.
  chromeView.setBackgroundColor('#1e1f25');
  // DD3: chrome view fills the window. Set initial bounds from the constructed size (not
  // getContentBounds() at the construction instant, which can lag the requested size on some
  // platforms and flash a gap); steady-state geometry is owned by the resize handler below.
  chromeView.setBounds({ x: 0, y: 0, width: initialWidth, height: initialHeight });

  chromeView.webContents.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));


  mainWindow.on('closed', () => {
    mainWindow = null;
    chromeView = null;
  });

  // DD3: keep the chrome view sized to the window. No-op if the view is already gone
  // (resize can fire during teardown).
  // FIX 1 belt-and-suspenders: after the chrome view bounds are updated, push
  // 'trigger-send-bounds' to the renderer so it immediately re-measures #webviews
  // and resends the active guest's bounds. Belt-and-suspenders alongside the
  // renderer-side ResizeObserver (which fires per CSS layout frame during transitions).
  mainWindow.on('resize', () => {
    if (!chromeView) return;
    const { width, height } = mainWindow.getContentBounds();
    chromeView.setBounds({ x: 0, y: 0, width, height });
    getChromeContents()?.send('trigger-send-bounds');
  });

  // Forward maximize state to the renderer so the custom window controls can
  // sync their label/icon/data-state (DD7 read path).
  // Leg 1 re-points only the .send payload through the chrome contents (required for AC7's
  // zero-match grep). The maximize/unmaximize event REGISTRATION stays on mainWindow — a
  // BaseWindow still emits these — and is Leg 2's concern (DD4 window-control re-point).
  mainWindow.on('maximize', () => {
    getChromeContents()?.send('window-maximized-change', true);
    getChromeContents()?.send('trigger-send-bounds');
  });
  mainWindow.on('unmaximize', () => {
    getChromeContents()?.send('window-maximized-change', false);
    getChromeContents()?.send('trigger-send-bounds');
  });
}

// ---------------------------------------------------------------------------
// Page zoom. A discrete ladder mirroring Chrome's familiar steps. applyZoom reads
// the guest's current factor, steps to the next/prev rung (or resets to 1.0),
// clamps to [ZOOM_MIN, ZOOM_MAX], applies it, and broadcasts the new level so the
// renderer's address-bar zoom chip can reflect it (DD1/DD2).
// ---------------------------------------------------------------------------
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 5.0;
const ZOOM_LADDER = [
  0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 4.0, 5.0
];

// Resolve the next factor for an action ('in'|'out'|'reset') from the current one.
function nextZoomFactor(current, action) {
  if (action === 'reset') return 1.0;
  // Find the current rung (nearest, since setZoomFactor stores arbitrary floats).
  let idx = 0;
  let best = Infinity;
  for (let i = 0; i < ZOOM_LADDER.length; i++) {
    const d = Math.abs(ZOOM_LADDER[i] - current);
    if (d < best) { best = d; idx = i; }
  }
  if (action === 'in') idx = Math.min(idx + 1, ZOOM_LADDER.length - 1);
  else if (action === 'out') idx = Math.max(idx - 1, 0);
  return ZOOM_LADDER[idx];
}

function applyZoom(wc, action) {
  if (!wc || wc.isDestroyed()) return;
  const current = wc.getZoomFactor();
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, nextZoomFactor(current, action)));
  wc.setZoomFactor(next);
  getChromeContents()?.send('zoom-changed', { wcId: wc.id, factor: next });
}

// ---------------------------------------------------------------------------
// Each <webview> gets the media-scanner preload injected. The webview's
// `webpreferences` attribute in the renderer references this path indirectly,
// but we also enforce it here so pages can never opt out.
// ---------------------------------------------------------------------------
// wireGuestContents — wires event listeners onto a guest webContents. Called for
// <webview> elements from the global app.on('web-contents-created') handler AND
// explicitly for new WebContentsViews in ipcMain.handle('tab-create') (because
// web-contents-created fires SYNCHRONOUSLY during new WebContentsView(), before the
// tabViews registry entry can be set — so the global handler cannot identify them).
function wireGuestContents(contents) {
  // Open target=_blank / window.open as new tabs in our own UI instead of
  // spawning native Electron windows.
  contents.setWindowOpenHandler(({ url }) => {
    getChromeContents()?.send('open-tab', url);
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
  // Page-scoped zoom capture (DD6). This is the path that fires while the PAGE
  // has focus (the normal case); the renderer keydown handler is the fallback for
  // when the chrome shell is focused. Skip the internal session entirely (DD3) —
  // internal pages never zoom.
  if (!(/** @type {any} */ (contents.session)?.__goldfinchInternal)) {
    contents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      // DevTools F12 (SC5 / DD2). MODIFIER-LESS — must sit BETWEEN the keyDown filter (above)
      // and the modifier gate (below): before the gate or it never fires (F12 has no modifier);
      // after the keyDown filter or a keyUp F12 would double-fire. The outer __goldfinchInternal
      // skip already excludes internal sessions (DD5). Guard isAutoRepeat so a HELD F12
      // doesn't rapid-toggle (main-side before-input-event repeats keyDown while held).
      if (input.key === 'F12') {
        if (!input.isAutoRepeat) toggleDevTools(contents);  // contents IS the guest wc — pre-guarded by the outer skip
        event.preventDefault();
        return;
      }
      if (!(input.control || input.meta)) return;
      // Match '=' regardless of shift (US-layout Ctrl+Shift+= → zoom in) and '+'.
      let action = null;
      if (input.key === '=' || input.key === '+') action = 'in';
      else if (input.key === '-') action = 'out';
      else if (input.key === '0') action = 'reset';
      // Native print (SC2). Save-as-PDF is a destination within the OS dialog.
      // print() returns immediately; on WSLg with no CUPS printer it fails
      // silently, so surface the failureReason via the callback (DD/WSLg note).
      if (input.key === 'p' || input.key === 'P') {
        contents.print({}, (ok, reason) => {
          if (!ok) console.warn('print failed:', reason);
        });
        event.preventDefault();
        return;
      }
      // Find in page (SC4 / DD2). Suppress Chromium's native find and open the
      // renderer-side floating find bar. Modelled on the zoom-changed broadcast:
      // send to the chrome renderer where the bar lives (NOT on the open-tab path
      // inside setWindowOpenHandler). No payload — the renderer infers via activeTab().
      // The __goldfinchInternal skip already excludes internal sessions, satisfying DD5.
      if (input.key === 'f' || input.key === 'F') {
        event.preventDefault();
        getChromeContents()?.send('open-find');
        return;
      }
      // Downloads Ctrl+J (DD2) — page-focused capture; open the downloads page in the chrome
      // renderer (onOpenDownloads), mirroring the find path. isAutoRepeat guard is REQUIRED:
      // this path has no isInternalTab guard, so a HELD Ctrl+J would stack downloads tabs
      // (before-input-event repeats keyDown while held — mirrors the F12/Ctrl+Shift+I branches).
      if ((input.key === 'j' || input.key === 'J') && !input.isAutoRepeat) {
        event.preventDefault();
        getChromeContents()?.send('open-downloads');
        return;
      }
      // DevTools Ctrl+Shift+I (SC5 / DD2) — the conventional alternate to F12, in the gated
      // section. Same isAutoRepeat guard so a held chord doesn't rapid-toggle. contents is the
      // guest wc, pre-guarded by the outer __goldfinchInternal skip (DD5).
      if (input.control && input.shift && (input.key === 'I' || input.key === 'i')) {
        if (!input.isAutoRepeat) toggleDevTools(contents);
        event.preventDefault();
        return;
      }
      if (!action) return;
      applyZoom(contents, action);
      event.preventDefault();
    });
    // DevTools live-state broadcast (Flight-3 DD3). The leg-1 spike was POSITIVE: both
    // devtools-opened/devtools-closed fire on the main-process guest webContents (unlike
    // found-in-page, which fired only on the renderer <webview> tag — Flight-2 D1). We wire the
    // GUEST side here and forward to the chrome renderer (mirrors the zoom-changed broadcast) so
    // Leg 2's toolbar button updates live — including a DevTools-window-initiated close, which the
    // on-demand isDevtoolsOpen reconcile alone would miss until the next tab activation.
    const sendDevtoolsState = (open) => {
      getChromeContents()?.send('devtools-state-changed', { wcId: contents.id, open });
    };
    contents.on('devtools-opened', () => sendDevtoolsState(true));
    contents.on('devtools-closed', () => sendDevtoolsState(false));
    // HTML page context menu (DD2/DD6, Leg 2b — freeze-frame approach, Option A). The
    // context-menu event fires on the main-process guest webContents. We forward ONLY the
    // params; the chrome renderer applies the freeze-frame via its own proven
    // freezeGuest()/captureActiveGuest() path on menu open (the same path the kebab/container
    // menus use and the operator confirmed working). An event-time capturePage() here proved
    // unreliable on WSLg (intermittently threw/returned empty → freeze skipped → live guest
    // occluded the HTML menu), so we deliberately do NOT capture in this handler. Internal
    // goldfinch:// guests are excluded by the !__goldfinchInternal guard (DD6).
    contents.on('context-menu', (event, params) => {
      event.preventDefault();
      if (!mainWindow) return;
      if (isInternalContents(contents)) return;
      getChromeContents()?.send('page-context-menu', { wcId: contents.id, params });
    });
  }
}

// Wire tab-strip event forwarding for a WebContentsView guest (Flight 3, Leg 1).
// Forwards did-navigate / title / favicon / loading / find to the chrome renderer.
function wireTabViewEvents(view, wcId) {
  const wc = view.webContents;
  const sendToChrome = (channel, payload) => {
    const cc = getChromeContents();
    if (cc && !cc.isDestroyed()) cc.send(channel, payload);
  };
  // guard: wraps a handler so it no-ops if the webContents is already destroyed.
  // Uses rest args to forward all event arguments through unchanged.
  const guard = (fn) => (...args) => { if (!wc.isDestroyed()) fn(...args); };

  wc.on('did-navigate', guard(() => {
    sendToChrome('tab-did-navigate', { wcId, url: wc.getURL() });
    sendToChrome('tab-nav-state', { wcId, canGoBack: wc.canGoBack(), canGoForward: wc.canGoForward() });
  }));
  wc.on('did-navigate-in-page', guard(() => {
    sendToChrome('tab-did-navigate-in-page', { wcId, url: wc.getURL() });
    sendToChrome('tab-nav-state', { wcId, canGoBack: wc.canGoBack(), canGoForward: wc.canGoForward() });
  }));
  wc.on('page-title-updated', guard((_e, title) => {
    sendToChrome('tab-title', { wcId, title });
  }));
  wc.on('page-favicon-updated', guard((_e, favicons) => {
    sendToChrome('tab-favicon', { wcId, favicons });
  }));
  wc.on('did-start-loading', guard(() => {
    sendToChrome('tab-loading', { wcId, loading: true });
  }));
  wc.on('did-stop-loading', guard(() => {
    sendToChrome('tab-loading', { wcId, loading: false });
  }));
  wc.on('did-finish-load', guard(() => {
    sendToChrome('tab-did-finish-load', { wcId });
    sendToChrome('tab-nav-state', { wcId, canGoBack: wc.canGoBack(), canGoForward: wc.canGoForward() });
  }));
  wc.on('dom-ready', guard(() => {
    sendToChrome('tab-dom-ready', { wcId, tabWcId: wcId });
  }));
  wc.on('found-in-page', guard((_e, result) => {
    sendToChrome('tab-found-in-page', { wcId, result });
  }));
}

// ---------------------------------------------------------------------------
// Downloads. The renderer asks us to download a media URL using the *page's*
// own session (so cookies / referer / auth are preserved). We resolve the
// originating webview by its webContents id.
// ---------------------------------------------------------------------------
const pendingDownloads = new Map(); // url -> { suggestedName, saveDir }
const approvedDownloadDirs = new Set(); // session-scoped; populated by choose-download-dir

// App-level downloads model (Flight 5, Leg 1 / DD3). MODULE-SCOPED — not a whenReady
// local — because wireDownloadHandler is also invoked from the synchronous
// session-created hook for web jars created before whenReady, so its closure must
// reference a manager that is already assigned. Instantiated once at store-load time
// (the initProfileAndStores call site below). A will-download cannot realistically
// fire before a window exists, but module-scoping removes the undefined-manager hazard.
/** @type {ReturnType<typeof createManager> | null} */
let downloadsManager = null;
// Live DownloadItem references keyed by the manager id. SEAM FOR LEG 2: the
// pause/resume/cancel/open/show action handlers will look items up here. This leg only
// keeps the reference; it wires no action IPC channels.
/** @type {Map<number, Electron.DownloadItem>} */
const liveDownloadItems = new Map();

ipcMain.handle('download-media', async (_event, { webContentsId, url, suggestedName, saveDir }) => {
  const wc = typeof webContentsId === 'number' ? webContents.fromId(webContentsId) : null;
  const downloader = wc || getActiveTabContents() || getChromeContents();
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
      // Bulk / media download: save straight into the chosen, pre-approved folder.
      item.setSavePath(uniquePath(meta.saveDir, suggested));
    } else {
      // Chrome-like SILENT default-save (DD5): drop the native save dialog and write
      // straight into the OS Downloads folder. Correctness leans on uniquePath's (n)
      // dedup. setSavePath BEFORE register so getSavePath() is the real target.
      item.setSavePath(uniquePath(app.getPath('downloads'), suggested));
    }

    // getSavePath() is now final (set above). The record + payloads are built by the
    // electron-free downloads-payload helper, which reads the display name as
    // basename(getSavePath()) (NOT getFilename()) and `paused` from isPaused(). The live
    // `item` is passed whole as the accessor bag (it structurally satisfies the accessors).
    // Register in the app-level model. Module-scoped manager (assigned at store-load
    // time); guard defensively in case a will-download somehow fires before load.
    const record = buildRegisterRecord(item, { url, startTime: Date.now() });
    const id = downloadsManager ? downloadsManager.register(record) : -1;
    if (id !== -1) liveDownloadItems.set(id, item);

    item.on('updated', (_e, state) => {
      // Single-source assembly: the helper hoists the byte getters and reads isPaused()
      // once, and the manager.update patch reuses those values — so the same bindings feed
      // manager.update AND the broadcast (byte-identical to the prior inline payload).
      const payload = buildProgressPayload(item, { id, url, state });
      if (downloadsManager) {
        downloadsManager.update(id, {
          state: payload.state,
          received: payload.received,
          total: payload.total,
          paused: payload.paused
        });
      }
      // id-keyed broadcast through the fan-out helper (DD3): the chrome renderer AND
      // every internal session see it. Carries BOTH id (for the downloads page, leg 2)
      // AND url (for the renderer's URL-keyed toast/bulk tracker — it has no id).
      broadcastToChromeAndInternal('download-progress', payload);
    });

    item.once('done', (_e, state) => {
      pendingDownloads.delete(url);
      const payload = buildDonePayload(item, { id, url, state });
      if (downloadsManager) {
        downloadsManager.finalize(id, { state, savePath: payload.savePath, endTime: Date.now() });
      }
      liveDownloadItems.delete(id);
      broadcastToChromeAndInternal('download-done', payload);
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
      const cc = getChromeContents();
      if (agg && cc && !cc.isDestroyed()) {
        cc.send('privacy-net', { webContentsId: id, agg: serializeAgg(agg) });
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

// Spellcheck is opt-in and gated at the SESSION layer (DD1 architect [HIGH]):
// setSpellCheckerLanguages is session-scoped, so it reaches already-attached guests
// (webPreferences.spellcheck is immutable after attach). Web sessions only — NEVER the
// internal session (goldfinch:// has no business spellchecking, and we never want it to
// trigger the dictionary CDN fetch). Premise-audit (flight-log Leg 2) confirmed at the API
// level: a web session defaults to enabled+['en-US']; setSpellCheckerLanguages([]) disables
// (isSpellCheckerEnabled()===false) and ['en-US'] re-enables, live on an already-open guest.
// IDEMPOTENT BY NATURE: unlike applyShields (which wires webRequest hooks exactly once and
// therefore carries a __goldfinchShields guard), setSpellCheckerLanguages is safe to re-call
// on whenReady + every toggle + every session-created — do NOT add a __goldfinchSpellcheck guard.
function applySpellcheck(ses, enabled) {
  if (!ses || ses.__goldfinchInternal) return; // DD1: never the internal session
  ses.setSpellCheckerLanguages(enabled ? ['en-US'] : []);
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
    const cc = getChromeContents();
    if (cc && id != null && !cc.isDestroyed()) {
      cc.send('privacy-permission', { webContentsId: id, permission, granted });
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
 *  1. The chrome renderer (`getChromeContents()`, the file:// chrome WebContentsView) — sent separately
 *     because the __goldfinchInternal filter below intentionally excludes it (it is not an
 *     internal-session webContents).
 *  2. Every webContents whose session carries __goldfinchInternal === true (the settings guest
 *     and any other future goldfinch:// internal pages).
 * Leg 4 reuses this helper for the shields-changed broadcast to the settings guest.
 * @param {string} channel
 * @param {unknown} payload
 */
function broadcastToChromeAndInternal(channel, payload) {
  const cc = getChromeContents();
  if (cc && !cc.isDestroyed()) {
    cc.send(channel, payload);
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
registerInternalHandler(ipcMain, 'internal-settings-set', async (_e, key, value) => {
  const cfg = settings.set(key, value);
  broadcastToChromeAndInternal('settings-changed', settings.getAll());
  // DD2 (Flight 8): the toggle is the sole bind gate — drive the live surface to match.
  // No explicit status broadcast: the automation-activity-changed channel carries an
  // activity snapshot { sessions, log }, not a status object, so pushing status here
  // would break the indicator/audit-viewer consumers. The indicator clears for free via
  // stop()'s transport-close cascade; the Settings status-line is refreshed by the
  // renderer re-fetch after settingsSet resolves.
  if (key === 'automationEnabled') {
    await applyAutomationEnabledChange(value === true);
  }
  // Spellcheck live side-effect (DD1 architect [HIGH]): drive EVERY live web session so the
  // toggle reaches already-open tabs. setSpellCheckerLanguages is an imperative per-session
  // push with NO lazy-read fallback (unlike shields' webRequest hooks that lazily read global
  // state), so driving only the two base sessions would leave an already-open per-jar /
  // container / burner tab stale. webContents.getAllWebContents() is the only live-session
  // route (the broadcastToChromeAndInternal precedent above); applySpellcheck no-ops the
  // internal session belt-and-suspenders. NOTE (premise-audit, flight-log Leg 2): the API-level
  // toggle is confirmed live, but squiggle RENDERING was inconclusive under WSLg — the toggle
  // help + behavior spec carry the conservative new-tabs-only wording pending macOS/HAT.
  if (key === 'spellcheck') {
    const enabled = value === true;
    // Base web sessions (always present).
    applySpellcheck(session.defaultSession, enabled);
    applySpellcheck(session.fromPartition(PAGE_PARTITION), enabled);
    // Every live web jar/container/burner session (already-open tabs).
    const seen = new Set();
    for (const wc of webContents.getAllWebContents()) {
      const ses = wc.session;
      if (!ses || /** @type {any} */ (ses).__goldfinchInternal || seen.has(ses)) continue;
      seen.add(ses);
      applySpellcheck(ses, enabled);
    }
  }
  return cfg;
});
registerInternalHandler(ipcMain, 'internal-shields-get', () => shields.get());
registerInternalHandler(ipcMain, 'internal-shields-set', (_e, patch) => {
  const cfg = shields.set(patch || {});
  broadcastToChromeAndInternal('shields-changed', cfg);
  return cfg;
});

// Downloads surface IPC (Flight 5, Leg 2). All origin-checked via
// registerInternalHandler — the goldfinch://downloads page is the only allowed sender;
// web content cannot invoke them (no web gate is relaxed). The savePath for open/show
// is resolved MAIN-SIDE by id from the trusted manager/store — the renderer NEVER
// supplies a path (avoids an arbitrary-open vector).
registerInternalHandler(ipcMain, 'internal-downloads-list', () =>
  downloadsManager ? downloadsManager.listAll() : []
);
// Single dispatch surface with a main-side action allowlist (mirrors the
// page-context-action allowlisted-dispatch pattern): one origin-checked surface, one
// validation point. Every branch tolerates a missing/pruned id (no-op, no throw — the
// DD3 cache contract). Returns { ok } so the page can refresh on a no-op.
const DOWNLOADS_ACTIONS = new Set(['pause', 'resume', 'cancel', 'remove', 'retry', 'open', 'show']);
registerInternalHandler(ipcMain, 'internal-downloads-action', (_e, payload) => {
  const id = payload && payload.id;
  const action = payload && payload.action;
  if (typeof id !== 'number' || !DOWNLOADS_ACTIONS.has(action) || !downloadsManager) {
    return { ok: false };
  }

  // Resolve the trusted record by id main-side (open/show/retry need it).
  const record = downloadsManager.listAll().find((r) => /** @type {any} */ (r).id === id);

  switch (action) {
    case 'pause':
    case 'resume':
    case 'cancel': {
      // Live-item-only ops: act on the DownloadItem registry. No-op on a missing id.
      const item = liveDownloadItems.get(id);
      if (item) {
        item[action]();
        // pause() and resume() do not reliably emit 'updated', so push an explicit
        // broadcast so the downloads page can flip the Pause↔Resume button immediately.
        // cancel() fires 'done' which already broadcasts — skip it.
        if (action !== 'cancel') {
          // Route through the same progress builder so the shape has one definition. The
          // `state || 'progressing'` fallback is computed here (the helper takes state as
          // given); the helper reads url/received/total/paused/filename off the live item.
          // Single-source assembly: isPaused() is read once in the helper and the
          // manager.update patch reuses payload.paused (byte-identical to the prior inline).
          const payload = buildProgressPayload(item, {
            id,
            url: item.getURL(),
            state: item.getState?.() || 'progressing'
          });
          if (downloadsManager) {
            downloadsManager.update(id, {
              state: payload.state,
              received: payload.received,
              total: payload.total,
              paused: payload.paused
            });
          }
          broadcastToChromeAndInternal('download-progress', payload);
        }
      }
      break;
    }
    case 'remove':
      // History-only — never deletes the file. Terminal records only (the page gates
      // the affordance); manager.remove tolerates a missing id.
      downloadsManager.remove(id);
      break;
    case 'retry': {
      // Re-issue a FRESH download for a failed/cancelled record. The chrome contents uses
      // session.defaultSession (no partition in webPreferences), which is download-wired
      // at whenReady, so downloadURL registers through wireDownloadHandler and gets a
      // NEW id/new record; the old failed record stays visible (DD3). No fallback needed.
      const url = record ? /** @type {any} */ (record).url : null;
      const cc = getChromeContents();
      if (url && cc && !cc.isDestroyed()) {
        cc.downloadURL(url);
      }
      break;
    }
    case 'open': {
      // Resolve savePath main-side by id; open only a real path. shell.openPath returns
      // a non-empty error string when the file is gone — return it so the page can show
      // an inline notice (don't throw).
      const savePath = record ? /** @type {any} */ (record).savePath : null;
      if (savePath) {
        const error = shell.openPath(savePath);
        return Promise.resolve(error).then((e) => ({ ok: !e, error: e || undefined }));
      }
      return { ok: false };
    }
    case 'show': {
      const savePath = record ? /** @type {any} */ (record).savePath : null;
      if (savePath) shell.showItemInFolder(savePath);
      break;
    }
  }
  return { ok: true };
});
registerInternalHandler(ipcMain, 'internal-downloads-clear', () => {
  if (downloadsManager) downloadsManager.clear();
  return { ok: true };
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
  // mintJarKey changes only `automationKeyHashes` (DD3 — it no longer enables the
  // surface; enabling is human-only via the toggle). `automationKeyHashes` IS a
  // setting, so broadcast settings-changed: the key list's hasKey/adminKeySet
  // rendering re-syncs without a reload. The enable toggle's onSettingsChanged
  // listener sees no automationEnabled change and leaves the checkbox untouched.
  const key = mintJarKey(jarId, settings, jars);
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

// OS-clipboard string write for the page context menu's Copy link / Copy image address /
// Copy selection (Leg 4). Chrome-trusted one-way send — same trust domain as window-minimize/
// app-quit (no origin-check needed). Distinct from the internal-origin-gated `clipboard:write`
// (settings page only): the chrome renderer cannot reach that one, and navigator.clipboard is
// unreliable from a file:// doc right after a guest context-menu steals focus. Writes a STRING
// only (coerced) — not a guest mutation, no general-write concern.
ipcMain.handle('chrome-clipboard-write', (_e, text) => {
  clipboard.writeText(String(text == null ? '' : text));
});

// New container creation: renderer collected the name (via inline input) and sends it here.
// We create the jar and return it; the renderer calls createTab directly with the container object.
ipcMain.handle('new-container-create', async (_event, { name }) => {
  if (!name || typeof name !== 'string') return null;
  const c = jars.add(name);
  return c;
});

// ---------------------------------------------------------------------------
// Tab view IPC handlers (Flight 3, Leg 1 — web tab lifecycle via WebContentsView)
// ---------------------------------------------------------------------------

ipcMain.handle('tab-create', (_event, { url, partition, trusted }) => {
  // -----------------------------------------------------------------------
  // Pick webPreferences by trust level (Leg 3).
  //
  // INTERNAL (trusted=true): byte-exact webPreferences set at construction time on the
  // trusted `tab-create` path. The partition MUST come from the INTERNAL_PARTITION constant —
  // any literal drift silently resolves a different session → marker absent → gates,
  // protocol.handle, bridge, and automation exclusion all fail open. (DD0 / security)
  //
  // WEB (trusted=false): web prefs — contextIsolation:false so the farbling preload runs
  // in the page main world (required). NO spellcheck key — the session-layer applier
  // (applySpellcheck) owns the live web toggle; a constructed view's spellcheck pref is
  // immutable after attach, so inheriting the session default is correct. (DD3)
  // -----------------------------------------------------------------------
  let preloadPath;
  let webPreferencesObj;
  if (trusted) {
    preloadPath = path.join(__dirname, '..', 'preload', 'internal-preload.js');
    webPreferencesObj = {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      partition: INTERNAL_PARTITION,
      spellcheck: false,
    };
  } else {
    preloadPath = path.join(__dirname, '..', 'preload', 'webview-preload.js');
    webPreferencesObj = {
      preload: preloadPath,
      contextIsolation: false,
      sandbox: false,
      nodeIntegration: false,
      partition: partition,
      // NO spellcheck key — the session-layer applier (applySpellcheck) owns the web toggle
    };
  }
  const view = new WebContentsView({ webPreferences: webPreferencesObj });
  mainWindow.contentView.addChildView(view);

  // Seed initial bounds
  if (mainWindow) {
    const { width, height } = mainWindow.getContentBounds();
    view.setBounds({ x: 0, y: 0, width, height });
  }
  view.setVisible(false);

  const wcId = view.webContents.id;
  tabViews.set(wcId, { view, partition: trusted ? INTERNAL_PARTITION : partition, trusted, active: false });

  // Explicit construction-time wiring: web-contents-created fires synchronously
  // during new WebContentsView(), so the global handler cannot identify the view yet.
  // Wire explicitly here so all guest event listeners are installed before loadURL.
  wireGuestContents(view.webContents);

  // Tab-strip event forwarding
  wireTabViewEvents(view, wcId);

  view.webContents.loadURL(url).catch((err) => {
    console.warn('[tab-create] loadURL rejected:', err && (err.code || err.message || err));
  });
  return wcId;
});

ipcMain.on('tab-close', (_event, wcId) => {
  const entry = tabViews.get(wcId);
  if (!entry) return;
  mainWindow.contentView.removeChildView(entry.view);
  if (!entry.view.webContents.isDestroyed()) {
    entry.view.webContents.destroy();
  }
  tabViews.delete(wcId);
  if (activeTabWcId === wcId) activeTabWcId = null;
});

ipcMain.on('tab-hide', (_event, wcId) => {
  const entry = tabViews.get(wcId);
  if (!entry) return;
  if (!entry.view.webContents.isDestroyed()) {
    entry.view.setVisible(false);
  }
  entry.active = false;
  if (activeTabWcId === wcId) activeTabWcId = null;
});

ipcMain.on('tab-navigate', (_event, { wcId, verb, args }) => {
  const wc = getTabContents(wcId);
  if (!wc || wc.isDestroyed()) return;
  if (verb === 'loadURL' && args && args[0]) {
    wc.loadURL(args[0]).catch((err) => {
      console.warn('[tab-navigate] loadURL rejected:', err && (err.code || err.message || err));
    });
  } else if (verb === 'reload') {
    wc.reload();
  } else if (verb === 'stop') {
    wc.stop();
  } else if (verb === 'goBack') {
    wc.goBack();
  } else if (verb === 'goForward') {
    wc.goForward();
  }
});

ipcMain.on('tab-set-active', (_event, { wcId, bounds }) => {
  // Atomic: set-bounds → setVisible(true) incoming → setVisible(false) outgoing
  const entry = tabViews.get(wcId);
  if (entry) {
    if (bounds) {
      entry.view.setBounds({ x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) });
    }
    if (!entry.view.webContents.isDestroyed()) {
      entry.view.setVisible(true);
    }
    entry.active = true;
    // Raise the active guest view to the top so page input works.
    if (mainWindow) {
      mainWindow.contentView.addChildView(entry.view);
    }
  }
  // Hide old active tab
  if (activeTabWcId !== null && activeTabWcId !== wcId) {
    const oldEntry = tabViews.get(activeTabWcId);
    if (oldEntry && !oldEntry.view.webContents.isDestroyed()) {
      oldEntry.view.setVisible(false);
    }
    if (oldEntry) oldEntry.active = false;
  }
  activeTabWcId = wcId;
});

ipcMain.on('tab-set-bounds', (_event, { wcId, bounds }) => {
  const entry = tabViews.get(wcId);
  if (!entry || entry.view.webContents.isDestroyed()) return;
  entry.view.setBounds({ x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) });
});

ipcMain.on('tab-find', (_event, { wcId, text, options, stop }) => {
  const wc = getTabContents(wcId);
  if (!wc || wc.isDestroyed()) return;
  if (stop) {
    wc.stopFindInPage(options || 'clearSelection');
  } else if (text) {
    wc.findInPage(text, options || {});
  }
});

// Site-info / menu freeze-frame: capture the active guest page as a PNG data URL.
// Called by the renderer before hiding the guest and showing the freeze image.
// Returns a data URL string, or null if no active guest is available.
//
// INTERNAL CAPTURE IS REQUIRED (Leg 3 HAT fix): after Leg 3, internal goldfinch:// tabs are
// opaque WebContentsViews — they occlude the HTML chrome menus (kebab/container/site-info)
// exactly like web tabs. So the freeze-frame must be able to capture an internal page too,
// or those menus render behind the opaque internal view. The earlier "never capture internal"
// guard rested on the now-invalid "internal never freezes" premise.
//
// Why this is safe (NOT a leak, NOT an automation op): the ONLY caller is the trusted chrome
// renderer's freeze helper — `captureActiveGuest` is exposed solely on chrome-preload, never on
// any guest preload. It captures, as a still, a page the chrome ALREADY displays in its own
// #webviews region; nothing crosses a trust boundary that the chrome doesn't already hold.
// (`isInternalContents` is intentionally NOT applied here; it remains used elsewhere in main.js.)
ipcMain.handle('capture-active-guest', async () => {
  const wc = getActiveTabContents();
  if (!wc || wc.isDestroyed()) return null;
  try {
    const img = await wc.capturePage();
    // toDataURL returns a data: URI (PNG, base64-encoded).
    return img.toDataURL();
  } catch {
    return null;
  }
});

// Guest media-list / privacy-fp forwarding from webview-preload to chrome renderer.
// Web <WebContentsView> tabs send via ipcRenderer.send (not sendToHost).
ipcMain.on('guest-media-list', (event, mediaList) => {
  const wcId = event.sender.id;
  const cc = getChromeContents();
  if (cc && !cc.isDestroyed()) {
    cc.send('tab-media-list', { wcId, mediaList });
  }
});

ipcMain.on('guest-privacy-fp', (event, fpCounts) => {
  const wcId = event.sender.id;
  const cc = getChromeContents();
  if (cc && !cc.isDestroyed()) {
    cc.send('tab-privacy-fp', { wcId, fpCounts });
  }
});

// rescan-media for WebContentsView tabs (push from chrome → tab wc).
ipcMain.on('rescan-media', (_event, { wcId } = {}) => {
  if (wcId == null) return;
  const wc = getTabContents(wcId);
  if (!wc || wc.isDestroyed()) return;
  wc.send('rescan-media');
});

// Renderer fallback zoom path (chrome-focused case). The renderer already filters
// internal tabs; we guard again here (defense in depth) before applying.
ipcMain.on('zoom-apply', (_e, { webContentsId, action }) => {
  const wc = typeof webContentsId === 'number' ? webContents.fromId(webContentsId) : null;
  if (!wc || wc.isDestroyed()) return;
  if (/** @type {any} */ (wc.session)?.__goldfinchInternal) return;
  applyZoom(wc, action);
});

// Query the guest's ACTUAL current engine zoom (DD1 stale-cache fix). Chromium's
// per-origin host-zoom map re-zooms ALL same-origin tabs in a jar when ANY one is
// zoomed, but only the active tab emits zoom-changed — so a cached factor goes stale
// for non-active same-origin tabs. The renderer queries this on demand (tab switch,
// load, zoom change) instead of reading the cache, so the address-bar label always
// reflects the live factor. Distinct from the automation `getZoom` MCP tool (a
// different layer); this CHROME-IPC channel is named `get-zoom`. Returns null for a
// dead/missing/internal target (renderer falls back to 1.0 / hides the control).
ipcMain.handle('get-zoom', (_e, { webContentsId }) => {
  const wc = typeof webContentsId === 'number' ? webContents.fromId(webContentsId) : null;
  if (!wc || wc.isDestroyed()) return null;
  if (/** @type {any} */ (wc.session)?.__goldfinchInternal) return null;
  return wc.getZoomFactor();
});

// Renderer kebab Print… path (SC2). The renderer already filters internal tabs;
// we guard again here (defense in depth) before printing. The print() callback
// surfaces WSLg no-printer failures instead of swallowing them.
ipcMain.on('print', (_e, { webContentsId }) => {
  const wc = typeof webContentsId === 'number' ? webContents.fromId(webContentsId) : null;
  if (!wc || wc.isDestroyed()) return;
  if (/** @type {any} */ (wc.session)?.__goldfinchInternal) return;
  wc.print({}, (ok, reason) => {
    if (!ok) console.warn('print failed:', reason);
  });
});

// DevTools human path (Flight-3 DD1). Two-way invoke (over zoom's one-way send) because the
// renderer button reflects the AUTHORITATIVE open/closed state. Acts on the PASSED webContentsId,
// NEVER re-resolving via activeTab() — the active tab can change mid-round-trip, and the user
// targeted the tab whose wcId the renderer captured at call time (TOCTOU guard, DD1). Guards a
// dead/missing target (return false, no throw) and refuses an internal-session target via the
// SHARED isInternalContents predicate (DD5 — never DevTools on goldfinch://). The actual
// open/close mechanics live in the shared toggleDevTools helper, also called by the M03 MCP ops.
ipcMain.handle('toggle-devtools', (_e, { webContentsId }) => {
  const wc = typeof webContentsId === 'number' ? webContents.fromId(webContentsId) : null;
  if (!wc || wc.isDestroyed()) return false;
  if (isInternalContents(wc)) return false;             // DD5; never on goldfinch://
  return toggleDevTools(wc);                            // shared helper → post-toggle isDevToolsOpened()
});
// On-demand open-state read for the on-activation reconcile (DD3). Exposed for Leg 2's button.
ipcMain.handle('is-devtools-open', (_e, { webContentsId }) => {
  const wc = typeof webContentsId === 'number' ? webContents.fromId(webContentsId) : null;
  if (!wc || wc.isDestroyed()) return false;
  if (isInternalContents(wc)) return false;
  return wc.isDevToolsOpened();
});

// Spelling correction round-trip (DD2/DD6). chrome -> main -> guest. Acts on the PASSED
// webContentsId (never activeTab() — the active tab can change mid-round-trip; the user
// targeted the tab whose wcId the renderer captured at right-click time, TOCTOU guard).
// Refuses the internal session via the SHARED isInternalContents predicate (DD6 — never write
// into a goldfinch:// guest). NOT a general write primitive: it performs replaceMisspelling
// ONLY, a single narrowly-typed action gated on a non-empty string word. (Edit-action
// correction — cut/copy/paste/undo/redo — is Leg 4's to add with its own action-allowlist.)
// Dead/destroyed targets return safely; replaceMisspelling is itself a no-op outside an active
// misspelling/editing context, so the main side never throws.
ipcMain.handle('page-context-correct', (_e, { webContentsId, word }) => {
  const wc = typeof webContentsId === 'number' ? webContents.fromId(webContentsId) : null;
  if (!wc || wc.isDestroyed()) return;
  if (isInternalContents(wc)) return;                   // DD6; never on goldfinch://
  if (typeof word === 'string' && word) {
    // Re-focus the guest first: opening the chrome context menu pulls focus off the guest editable,
    // and replaceMisspelling is a no-op unless the guest holds the active editing/misspelling context
    // (symptom without this: the first suggestion click does nothing, the second works once focus has
    // returned). Focusing the guest webContents restores the context before the replace.
    wc.focus();
    wc.replaceMisspelling(word);
  }
});

// Page-context edit-action dispatch (Leg 4 — the cut/copy/paste/undo/redo Leg 1 deferred).
// Mirrors page-context-correct's trust discipline EXACTLY: acts on the PASSED webContentsId
// (never activeTab() — the user targeted the tab whose wcId the renderer captured at right-click
// time, TOCTOU guard), guards a dead/missing target, and refuses the internal session (DD6 —
// never drive edit methods on a goldfinch:// guest). NOT a general "run any method" primitive:
// `action` is restricted to a FIXED allowlist; anything else is ignored. A separate channel
// (rather than widening page-context-correct's narrow `word`-string contract) keeps each
// surface's audited trust contract self-evident. wc.paste() reads the OS clipboard into the
// guest — same as a native menu Paste, the user-invoked intended behavior, not a new exfil path.
const PAGE_CONTEXT_ACTIONS = new Set(['cut', 'copy', 'paste', 'undo', 'redo']);
ipcMain.handle('page-context-action', (_e, { webContentsId, action }) => {
  const wc = typeof webContentsId === 'number' ? webContents.fromId(webContentsId) : null;
  if (!wc || wc.isDestroyed()) return;
  if (isInternalContents(wc)) return;                   // DD6; never on goldfinch://
  if (!PAGE_CONTEXT_ACTIONS.has(action)) return;        // fixed allowlist — not a verb dispatcher
  wc[action]();                                          // wc.cut()/copy()/paste()/undo()/redo()
});

// Unpin a toolbar item from the custom toolbar-mode context menu (Leg 5; replaces the retired
// native Electron popup-menu handler). Chrome-trusted one-way send — same trust domain as
// window-minimize/app-quit/chrome-clipboard-write (no origin check). NOT a general settings-write
// surface: item-allowlisted, writes only toolbarPins[item] = false. Same write+broadcast the native
// handler did, so applyToolbarPins' settings-changed reaction keeps the toolbar in sync live.
ipcMain.on('unpin-toolbar-item', (_e, item) => {
  if (item !== 'media' && item !== 'shields' && item !== 'devtools') return;  // fixed allowlist
  const pins = { ...settings.get('toolbarPins'), [item]: false };             // READ-MERGE current
  settings.set('toolbarPins', pins);
  broadcastToChromeAndInternal('settings-changed', settings.getAll());
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
  // Apply the current spellcheck setting to this fresh web jar (DD1 session-layer gating).
  // Read defensively: a session-created can fire before initProfileAndStores loads the store
  // (settings.get would then throw on null dir) — treat an unreadable store as OFF. whenReady
  // re-applies the correct state to defaultSession/pageSession after stores load anyway.
  let spellcheckOn;
  try { spellcheckOn = settings.get('spellcheck') === true; } catch { spellcheckOn = false; }
  applySpellcheck(ses, spellcheckOn);
});

app.whenReady().then(() => {
  initProfileAndStores(app, { shields, settings, jars, downloads });
  // Instantiate the app-level downloads manager ONCE, right after the stores load,
  // injecting the loaded downloads-store. Module-scoped so the synchronous
  // session-created hook's wireDownloadHandler closure can reference it. (DD3)
  downloadsManager = createManager(downloads);
  // Cover the sessions that may already exist before the hook was attached.
  wireDownloadHandler(session.defaultSession);
  applyShields(session.defaultSession);
  applySpellcheck(session.defaultSession, settings.get('spellcheck'));
  const pageSession = session.fromPartition(PAGE_PARTITION);
  wireDownloadHandler(pageSession);
  applyShields(pageSession);
  applySpellcheck(pageSession, settings.get('spellcheck'));

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

  // In-memory dev-enable override (DD3/DD4). Computed ONCE here (after app.whenReady,
  // so app.isPackaged is settled), alongside the launch logic. It writes NOTHING to the
  // settings store — it satisfies the bind decision, the flip-OFF guard, and the auth
  // gate in dev while the persisted `automationEnabled` stays false (human-only invariant).
  // `!app.isPackaged` makes `--automation-dev` a complete no-op in a packaged build (DD4).
  devEnableOverride = !app.isPackaged && isMcpAutomationEnabled(process.argv);

  // Dev-only automation seam (DD7 — interim; folded into the gated transport at Flight 3).
  // Registered ONCE at startup, after createWindow() so mainWindow exists.
  // Never registered in production: gated on the dev flag AND !app.isPackaged (DD4).
  // The identity check (event.sender === getChromeContents()) isolates the seam to the
  // chrome renderer — a guest webview has its own webContents and cannot pass this check.
  // No webContents.debugger anywhere (DD8).
  if (isMcpAutomationEnabled(process.argv) && !app.isPackaged) {
    const engine = createEngine(getChromeContents, { getDownloads: () => downloadsManager.listAll(), grabWindow });
    ipcMain.handle('automation:dev-invoke', async (event, { op, args } = {}) => {
      // event.sender identity is sufficient here (unlike internal-ipc's senderFrame.origin
      // check): this handler is NEVER registered in production (dev-gated), and a guest webview
      // has a different webContents than mainWindow's, so the identity check fully isolates it.
      if (event.sender !== getChromeContents()) {
        throw new Error('automation: dev-seam is chrome-renderer-only');
      }
      if (typeof engine[op] !== 'function') throw new Error('automation: unknown op ' + op);
      return engine[op](...(Array.isArray(args) ? args : []));
    });
  }

  // Loopback MCP automation server. DD2 (Flight 8): the human `automationEnabled`
  // toggle is the SOLE bind gate in production — so a packaged build with the toggle
  // persisted ON binds at launch. The `devEnableOverride` term (DD3/DD4) keeps the
  // dev harness binding regardless of the persisted toggle, satisfying BOTH the bind
  // decision and the auth gate WITHOUT writing `automationEnabled` (the human-only
  // invariant is preserved even in dev). It is `!app.isPackaged && isMcpAutomationEnabled`
  // — the isMcpAutomationEnabled predicate keys only on `--automation-dev` and is
  // structurally independent of any legacy browser-process CDP debugging switch, so the
  // MCP server is bound only by the dev-automation flag; and `!app.isPackaged` makes the
  // flag a complete no-op in a packaged build (DD4).
  // Started after createWindow() so the (lazy) engine accessor sees a live window. The
  // SC7 Origin/Host guard is wired inside createMcpServer and runs before any MCP
  // processing — the server never binds without it.
  if (shouldBindAutomation({ automationEnabled: settings.get('automationEnabled') === true, devForceBind: devEnableOverride })) {
    // Start the surface via the shared factory (Leg 7) — same option-bag + bind-status
    // capture as a live rebind. Fire-and-forget here, matching the original launch
    // behavior (the app does not block on the bind).
    void startMcpServerInstance();
  }

  // Dev-only AUTO-MINT-TO-STDOUT affordance, gated on the dev-enable override (which
  // already ANDs `!app.isPackaged` — DD4). The surface is enabled in dev by the
  // override, not by minting (DD3).
  if (devEnableOverride) {
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
        const key = mintJarKey('default', settings, jars);
        const adminKey = process.env.GOLDFINCH_AUTOMATION_ADMIN ? mintAdminKey(settings) : null;
        // mintJarKey mints the key hash only (no enable side-effect); the surface is
        // enabled by the dev-enable override. Single parseable line.
        process.stdout.write('AUTOMATION_DEV_MINT ' + JSON.stringify({ key, adminKey }) + '\n');
      } catch (err) {
        console.error('[mcp] dev auto-mint failed:', err && err.message);
      }
    }
  }

  app.on('activate', () => {
    if (BaseWindow.getAllWindows().length === 0) createWindow();
  });
});

// Primary MCP stop hook — before-quit fires on a real quit across ALL platforms,
// including macOS (where window-all-closed does NOT quit). stop() is idempotent,
// so both this and the window-all-closed secondary firing is safe.
app.on('before-quit', () => {
  // Best-effort teardown persist of in-progress downloads as 'interrupted' (DD3).
  // BEFORE mcpServer?.stop() (flush first; stop() may be slower). This is NOT
  // guaranteed — a sync handler racing an I/O write — and the contract remains
  // "in-progress is not durable". The loop is bounded by the in-progress count
  // (typically 0–few), so the synchronous writes are acceptable quit latency.
  downloadsManager?.flushInterrupted();
  mcpServer?.stop();
});

app.on('window-all-closed', () => {
  // Secondary MCP stop, INSIDE the non-darwin branch: on macOS closing all
  // windows does not quit (the app stays dock-resident), so we must NOT tear the
  // server down there while the app lives — before-quit handles macOS.
  if (process.platform !== 'darwin') {
    mcpServer?.stop();
    app.quit();
  }
});
