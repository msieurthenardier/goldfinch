'use strict';

const { app, BaseWindow, WebContentsView, ipcMain, session, webContents, desktopCapturer, dialog, shell, protocol, net, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { registrableDomain, hostnameOf, classify } = require('./trackers');
const shields = require('./shields');
const jars = require('./jars');
const { registerJarIpc } = require('./jar-ipc');
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
const { computeFindOverlayBounds } = require('./find-overlay-geometry');
const { createMenuOverlayManager } = require('./menu-overlay-manager');
// F8 Leg 3 / AC5: pure channel-4 `value` validator (string, ≤24) — unit-tested;
// deliberately NOT part of the manager (the manager never touches channel 4).
const { sanitizeActivatedValue } = require('./menu-overlay-value');
const {
  isMcpAutomationEnabled,
  shouldAutoMint,
  shouldBindAutomation,
} = require('../shared/automation-dev');
const { resolveAutoMintTarget } = require('./auto-mint');
const { createEngine } = require('./automation/engine');
const { createMcpServer, mintJarKey, mintAdminKey, revokeJarKey, revokeAdminKey, resolvePort, freePortInRange } = require('./automation/mcp-server');
const { makeAutomationToggle } = require('./automation/toggle');
// DevTools human-path: import the SHARED open/close helper (Flight-3 DD1, one code path with the
// M03 ops) and the SHARED internal-session predicate. The sibling chrome handlers (zoom/print)
// inline `wc.session?.__goldfinchInternal`; this handler imports isInternalContents so the human
// path and the MCP ops single-source the SAME internal-detection function (it is ELECTRON-FREE).
const { toggleDevTools } = require('./devtools');
const { isInternalContents } = require('./automation/resolve');
// DD13 (F8 Leg 2): pure dual-export accelerator mapper for the menu-overlay sheet's
// before-input-event forwarding + the internal-tab guard decision (both unit-tested).
const { sheetAcceleratorAction, isGuestActionAllowed } = require('../shared/sheet-accelerator');
const { crossViewNavAction } = require('../shared/cross-view-nav');
// DD8 (M06 F3 Leg 4): the generalized guest-focus chrome-shortcut forwarder reuses
// the SAME pure classifier the chrome DOM keydown handler uses (renderer.js),
// consulted against a per-guest-kind allowlist (web vs internal) — see
// handleGuestChromeShortcut below.
const { keydownToAction } = require('../shared/keydown-action');
const { isChromeActionForwardable } = require('../shared/guest-forward-allowlist');

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

// ── Linux ozone backend note (F8 Leg-6 HAT fix): the WSLg X11/XWayland path
// swallows the first cross-window click-to-activate; the DEV launch therefore
// selects the Wayland backend when a compositor socket is reachable. The
// selection CANNOT live here — Electron resolves the ozone platform before any
// app code runs (an in-app `app.commandLine.appendSwitch('ozone-platform', …)`
// changes what child processes REPORT but not the platform actually used —
// measured via xwininfo). It lives in `scripts/dev-launch.mjs` (the `npm run
// dev` / `dev:automation` entry), which applies the pure decision helper
// `src/main/ozone-platform.js` and passes `--ozone-platform=wayland` on the
// real command line. See those two files + the Leg-6 flight-log entry for the
// full diagnosis and harness evidence.

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
    '/audit-paging.js': path.join(__dirname, '..', 'shared', 'audit-paging.js'),
    // Injection-safe color validator (M06 F4 Leg 5 HAT F7): the automation-key
    // list guards the jar color it tints the robot glyph / unkeyed dot with, the
    // same isSafeColor/FALLBACK_COLOR idiom jars.js uses — precedent: jars serves
    // this same shared module (see the jars host entry below).
    '/safe-color.js': path.join(__dirname, '..', 'shared', 'safe-color.js')
  },
  // Second internal page (Flight 5, Leg 2): the app-level downloads surface. Same
  // allowlist-driven serving as settings — handleInternal/createResolver/INTERNAL_CSP
  // are unchanged. Adding it here is the explicit edit that registers the page.
  downloads: {
    '/': path.join(__dirname, '..', 'renderer', 'pages', 'downloads.html'),
    '/downloads.css': path.join(__dirname, '..', 'renderer', 'pages', 'downloads.css'),
    '/downloads.js': path.join(__dirname, '..', 'renderer', 'pages', 'downloads.js')
  },
  // Third internal page (Flight 3, Leg 1): the jar-management surface. Same
  // allowlist-driven serving as settings/downloads. Its script list pulls three
  // shared modules straight from src/shared/ (burner.js, safe-color.js,
  // jar-page-model.js) — precedent: settings serves audit-paging.js from shared.
  jars: {
    '/': path.join(__dirname, '..', 'renderer', 'pages', 'jars.html'),
    '/jars.css': path.join(__dirname, '..', 'renderer', 'pages', 'jars.css'),
    '/jars.js': path.join(__dirname, '..', 'renderer', 'pages', 'jars.js'),
    '/jar-page-model.js': path.join(__dirname, '..', 'shared', 'jar-page-model.js'),
    '/safe-color.js': path.join(__dirname, '..', 'shared', 'safe-color.js'),
    '/burner.js': path.join(__dirname, '..', 'shared', 'burner.js'),
    // Per-jar data controls (M06 Flight 4, Leg 1): the pure clearable-data-class
    // list, loaded before jars.js (see jars.html's script-order comment).
    '/jar-data-classes.js': path.join(__dirname, '..', 'shared', 'jar-data-classes.js')
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

// --- Find-overlay view state (M05 Flight 7, DD1/DD2) ---------------------------------
// The floating find bar is a dedicated chrome-class WebContentsView stacked above the
// active guest. Lazy singleton: created on first show, reused via add/removeChildView,
// destroyed only at window `closed`. Module-level is load-bearing — DD3 (Leg 2) reads
// `overlayView` at found-in-page event time, not captured at tab construction.
// NOTE: the overlay's webContents never enters `tabViews`, so automation enumerateTabs
// is unaffected by construction (no MCP-enumerable drift).
/** @type {Electron.WebContentsView | null} */
let overlayView = null;
// Tracks stack presence (removeChildView of a non-child is undefined behavior — gate on this).
let overlayVisible = false;
// Latest active-guest DIP bounds, for (re)positioning the overlay on show.
let lastGuestBounds = null;
// Overlay find session: wcId of the tab the overlay currently targets (null = closed).
// Single source of "overlay find is open, targeting tab X". DD9: per-tab
// findText/findOpen stay in the renderer; main holds ONLY the live session.
let findOverlayTabWcId = null;
function isFindOverlayActive(wcId) { return wcId != null && wcId === findOverlayTabWcId; }
// Last text actually issued to wc.findInPage for the live overlay session (null = none
// yet / reset). HAT-1 (M05 F7 Leg 4): Electron's FindInPageOptions.findNext means
// "begin a NEW find session" (true) vs "follow-up in the current session" (false) —
// the INVERSE of the legacy <webview>-era reading the retired chrome bar used. A
// follow-up request does NOT re-search when the text changed (Chromium keeps advancing
// the old session), so main tracks the last-queried text and forces a new session on
// any text change. See the find-overlay:query handler for the mapping.
let findOverlayLastQueryText = null;
// Overlay page readiness (AC7 init race): flipped by the construction-time
// did-finish-load listener; reset whenever overlayView is nulled/recreated.
let overlayReady = false;
// At most ONE queued init seed ({ findText }, latest wins), delivered (with focus)
// by did-finish-load when the open raced the first page load. Cleared on session
// close so a stale seed never fires against a closed session.
let pendingOverlayInit = null;

// Full overlay teardown (AC7 crash recovery + shared by window `closed`): destroy the
// webContents if still alive, drop the view, reset visibility/readiness, clear any
// queued init AND the find session — the next open recreates cleanly.
function teardownFindOverlayView() {
  if (overlayView) {
    if (overlayVisible && mainWindow) {
      mainWindow.contentView.removeChildView(overlayView);
    }
    if (!overlayView.webContents.isDestroyed()) {
      // destroy() is real but absent from the public WebContents type — any-cast
      // (same repo-precedented pattern as the tab-close path).
      /** @type {any} */ (overlayView.webContents).destroy();
    }
  }
  overlayView = null;
  overlayVisible = false;
  overlayReady = false;
  pendingOverlayInit = null;
  findOverlayTabWcId = null;
  findOverlayLastQueryText = null;
}

// Lazy-construct the overlay view. Chrome-class webPreferences (mirrors chromeView).
function ensureFindOverlayView() {
  // Destroyed-recreate guard: a destroyed webContents means the view is dead — null it
  // so a fresh one is built (ready flag/init queue reset with it).
  if (overlayView && overlayView.webContents.isDestroyed()) {
    overlayView = null;
    overlayVisible = false;
    overlayReady = false;
    pendingOverlayInit = null;
  }
  if (overlayView) return overlayView;
  overlayReady = false;
  overlayView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'find-overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  // AC7 readiness + init-race handling: the listener is installed at construction on
  // THIS webContents, so a queued one-shot init always attaches to the live page.
  overlayView.webContents.on('did-finish-load', () => {
    overlayReady = true;
    if (pendingOverlayInit && findOverlayTabWcId != null) {
      const seed = pendingOverlayInit;
      pendingOverlayInit = null;
      deliverOverlayInit(seed.findText);
    } else {
      pendingOverlayInit = null;
    }
  });
  // AC7 crash recovery: after render-process-gone the WebContents object is ALIVE
  // (isDestroyed() stays false), so the recreate guard above never fires for a crash —
  // this listener is what guarantees the next open rebuilds instead of re-showing a
  // dead view.
  overlayView.webContents.on('render-process-gone', () => {
    teardownFindOverlayView();
  });
  // Transparent so the guest shows through around the rounded bar; if the platform
  // compositor renders it opaque (WSLg caveat), the opaque themed rect is the
  // flight-accepted variation.
  overlayView.setBackgroundColor('#00000000');
  overlayView.webContents.loadFile(path.join(__dirname, '..', 'renderer', 'find-overlay.html')).catch((err) => {
    console.warn('[find-overlay] loadFile rejected:', err && (err.code || err.message || err));
  });
  return overlayView;
}

// Show = position (when guest bounds are known) + addChildView + setVisible(true).
// The re-add of an existing child RAISES it — the same idiom the guest re-add uses in
// tab-set-active. DD2 invariant: callers in tab-set-active must call this strictly
// AFTER the guest addChildView, or the guest buries the overlay.
function showFindOverlay() {
  const view = ensureFindOverlayView();
  if (!mainWindow) return;
  if (lastGuestBounds) {
    // Guard required: computeFindOverlayBounds does not tolerate null. If no guest
    // bounds have ever been seen, skip — the next tab-set-bounds corrects it.
    view.setBounds(computeFindOverlayBounds(lastGuestBounds));
  }
  mainWindow.contentView.addChildView(view);
  view.setVisible(true);
  overlayVisible = true;
}

// Hide = removeChildView — NEVER setVisible(false)-only (DD7: a hidden-but-present
// sibling still occupies the compositing stack). The view is kept for reuse.
function hideFindOverlay() {
  if (!overlayVisible) return;
  if (mainWindow && overlayView) {
    mainWindow.contentView.removeChildView(overlayView);
  }
  overlayVisible = false;
}

// Send the init seed + focus the overlay (DD6: overlayView.webContents.focus() here;
// the page focuses/selects its input in its onInit handler). Callers must have checked
// readiness — openFindOverlaySession queues via pendingOverlayInit when not ready.
function deliverOverlayInit(findText) {
  if (!overlayView || overlayView.webContents.isDestroyed()) return;
  overlayView.webContents.send('find-overlay:init', { findText });
  overlayView.webContents.focus();
}

// Open the overlay find session for a web tab (DD4). Shared entry for the
// `find-overlay:open` IPC handler and the dev-gated Ctrl+F stimulus.
function openFindOverlaySession(wcId, findText) {
  const entry = tabViews.get(wcId);
  // Find is web-tab-only (DD4): refuse absent, internal (trusted), or destroyed targets.
  if (!entry || entry.trusted || entry.view.webContents.isDestroyed()) return;
  if (isFindOverlayActive(wcId)) {
    // AC6e: re-open on the already-targeted tab re-focuses WITHOUT re-seeding init —
    // re-init would wipe whatever the user has typed in the overlay input.
    if (overlayView && !overlayView.webContents.isDestroyed()) {
      overlayView.webContents.focus();
    }
    return;
  }
  if (findOverlayTabWcId != null) {
    // Defensive retarget: a session open for a DIFFERENT tab is closed first (clears
    // the old guest's highlight; no refocus). Unreachable via this leg's Ctrl+F
    // stimulus (it fires on the focused/active guest) but makes the seam safe for
    // Leg 3's renderer-driven opens.
    closeFindOverlaySession({ refocusGuest: false });
  }
  findOverlayTabWcId = wcId;
  findOverlayLastQueryText = null; // fresh session target — first query must begin a new engine session
  showFindOverlay();
  const seed = typeof findText === 'string' ? findText : '';
  if (overlayReady) {
    deliverOverlayInit(seed);
  } else {
    // AC7 first-open init race: the page hasn't finished loading — queue exactly one
    // seed (latest wins); the construction-time did-finish-load delivers init + focus.
    pendingOverlayInit = { findText: seed };
  }
}

// Close the overlay find session. `refocusGuest` MUST be true ONLY on the explicit
// close path (Esc / ✕ → `find-overlay:close`). Every implicit close — tab-switch,
// tab-close, window teardown — passes false: refocusing there would land OS focus on
// a hidden/destroyed view and steal focus from tab-strip keyboard navigation (a
// pinned keyboard-nav contract). (AC5)
function closeFindOverlaySession({ refocusGuest }) {
  if (findOverlayTabWcId == null) return;
  const wc = getTabContents(findOverlayTabWcId); // null when destroyed/mid-destruction
  if (wc) {
    // Chrome-bar closeFind parity: clear the highlight on close.
    wc.stopFindInPage('clearSelection');
    if (refocusGuest) wc.focus();
  }
  hideFindOverlay();
  findOverlayTabWcId = null;
  findOverlayLastQueryText = null;
  pendingOverlayInit = null;
}

// --- Menu-overlay sheet (M05 Flight 8, DD2/DD4/DD9) -----------------------------------
// A lazy-singleton transparent WebContentsView covering the active guest's bounds,
// stacked above the live guest — the surface hosting the chrome menus (kebab as of
// Leg 2; container/site-info Leg 3; context/unpin Leg 4). Lifecycle + the menu-open
// state machine live in the extracted, Electron-free manager module
// (menu-overlay-manager.js); ONLY Electron construction stays here (createSheetView).
// The sheet's webContents NEVER enters `tabViews` (DD8 — invisible to enumerateTabs by
// construction; addressable by probed wcId for test driving). NOT gated on
// entry.trusted anywhere (DD7 — internal tabs are in scope, opposite of the find bar).

// Electron construction for the sheet view (injected into the manager). Chrome-class
// webPreferences (mirrors the find overlay); transparent background is the
// CP1-probed DD2 setting.
function createSheetView() {
  const view = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'menu-overlay-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  view.setBackgroundColor('#00000000');
  // DD13 accelerator forwarding: while a menu is open, OS keyboard focus sits in the
  // sheet's webContents — neither chrome's keydown handlers nor the guest
  // before-input-event capture see anything. Forward the UNION of the guest-captured
  // set and the chrome keydownToAction set via the pure mapper; unmodified APG keys
  // (Arrow/Home/End/Enter/Space/Escape/Tab) return null and stay with the sheet page.
  view.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const hit = sheetAcceleratorAction({ key: input.key, control: input.control, meta: input.meta, shift: input.shift });
    if (!hit) return;
    // Always swallow a matched accelerator (the sheet page must not see it), and
    // respect the isAutoRepeat guards exactly as the guest branches do (devtools +
    // downloads guarded; zoom/print/find deliberately not — parity).
    event.preventDefault();
    if (hit.autoRepeatGuard && input.isAutoRepeat) return;
    if (hit.scope === 'chrome') {
      // Chrome-class actions ride the main→chrome channel; the renderer's extracted
      // dispatchChromeAction runs the same switch bodies as its keydown handler.
      getChromeContents()?.send('chrome-shortcut-action', { action: hit.action });
      return;
    }
    // Guest-class: replicate the guest before-input-event branch bodies against the
    // ACTIVE guest — guarded by isInternalContents (the original capture sat inside
    // the !__goldfinchInternal guard, so F12/zoom/print/Ctrl+Shift+I are inert on
    // internal tabs today and must stay so; Ctrl+J is tab-independent and exempt —
    // see isGuestActionAllowed). Ctrl+F over an internal active tab is a FULL no-op
    // (menu stays open, keystroke swallowed — symmetric with the guard).
    const wc = getActiveTabContents();
    const activeIsInternal = !wc || isInternalContents(wc);
    if (!isGuestActionAllowed(hit.action, activeIsInternal)) return;
    switch (hit.action) {
      case 'devtools':
        if (wc) toggleDevTools(wc);
        break;
      case 'zoom-in':
        applyZoom(wc, 'in');
        break;
      case 'zoom-out':
        applyZoom(wc, 'out');
        break;
      case 'zoom-reset':
        applyZoom(wc, 'reset');
        break;
      case 'print':
        // Replicates the guest branch verbatim (incl. its lack of an autoRepeat guard).
        if (wc) {
          wc.print({}, (ok, reason) => {
            if (!ok) console.warn('print failed:', reason);
          });
        }
        break;
      case 'find':
        // DD5 conflict resolution: the menu closes BEFORE find opens (the find bar
        // and an open menu never co-exist), then chrome's openFind drives
        // find-overlay:open exactly as the guest-captured Ctrl+F does.
        menuOverlay.closeMenuOverlay('superseded');
        getChromeContents()?.send('open-find');
        break;
      case 'downloads':
        getChromeContents()?.send('open-downloads');
        break;
    }
  });
  view.webContents
    .loadFile(path.join(__dirname, '..', 'renderer', 'menu-overlay.html'))
    .catch((err) => {
      console.warn('[menu-overlay] loadFile rejected:', err && (err.code || err.message || err));
    });
  return view;
}

const menuOverlay = createMenuOverlayManager({
  getContentView: () => (mainWindow ? mainWindow.contentView : null),
  createSheetView,
  // Channel-7 emitter (menu-overlay-closed → chrome).
  sendToChrome: (channel, payload) => {
    const cc = getChromeContents();
    if (cc && !cc.isDestroyed()) cc.send(channel, payload);
  },
  // DD5 sheet-show hook: find bar hidden while a menu is open (parity).
  hideFindOverlay,
  // DD5 close hook with the THREE-reason skip set: 'tab-switch' defers to
  // tab-set-active's own per-tab find-restore logic; 'tab-hide' just hid the find
  // overlay one line earlier and restore belongs to tab-set-active's re-add (the
  // close runs BEFORE activeTabWcId is nulled in that handler, so restoring here
  // would paint the bar over a hidden guest and then double-handle); 'tab-close'
  // is skipped explicitly rather than relying on the activeTabWcId null-out
  // ordering. Every other reason (escape/outside-click/blur/toggle/activated/
  // superseded/teardown) re-shows iff the find session targets the active tab —
  // at window teardown findOverlayTabWcId is already nulled (teardownFindOverlayView
  // runs FIRST in the `closed` handler), so the teardown restore naturally no-ops,
  // while a sheet-crash teardown (find session still live) restores as desired.
  restoreFindOverlay: (reason) => {
    if (reason === 'tab-switch' || reason === 'tab-hide' || reason === 'tab-close') return;
    if (isFindOverlayActive(activeTabWcId)) showFindOverlay();
  },
  // Reason-resolved refocus, main-side half (escape/activated): webContents-level
  // focus — chrome-side els.kebab.focus() alone cannot move keyboard focus off the
  // sheet in a multi-view BaseWindow (F7 closeFindOverlaySession precedent).
  focusChrome: () => getChromeContents()?.focus()
});

// --- Menu-overlay DD4 IPC (channels 1/2/4/5). Chrome-class trust domain, but every
// handler validates event.sender by IDENTITY (DD8, F7 pattern): chrome contents for
// open/close; the sheet's own webContents for activated/dismissed. Payload-declared
// identity is never trusted. Channels 3/6/7 are .send()s (manager → sheet/chrome). ---

// True iff the sender is the live sheet webContents.
function isSheetSender(event) {
  const v = menuOverlay.getView();
  return !!v && !v.webContents.isDestroyed() && event.sender === v.webContents;
}

// Channel 1 — chrome → main: open (or model-replace) a menu on the sheet.
ipcMain.on('menu-overlay:open', (event, payload) => {
  if (event.sender !== getChromeContents()) return;
  menuOverlay.openMenu(payload);
});

// Channel 2 — chrome → main: programmatic close. `reason` is allowlisted to
// 'toggle' (trigger re-click close — distinct in logs, no focus move) or
// 'superseded' (mutual exclusion / other programmatic close; the default).
ipcMain.on('menu-overlay:close', (event, payload) => {
  if (event.sender !== getChromeContents()) return;
  const r = payload && payload.reason;
  menuOverlay.closeMenuOverlay(r === 'toggle' ? 'toggle' : 'superseded');
});

// Channel 4 — sheet → main: item activated. Stale tokens dropped; channel 7 (from
// the close) is emitted BEFORE channel 6, so chrome resets trigger state first and
// the action wins any focus race (round-2 design lock). Leg 3: the payload may
// carry an optional `value` string (the input-dialog's text) — shape-validated by
// the pure sanitizeActivatedValue helper (string, ≤24; anything else DROPPED — the
// payload is still forwarded, just without `value`).
ipcMain.on('menu-overlay:activated', (event, payload) => {
  if (!isSheetSender(event)) return;
  const { id, token, value } = payload || {};
  if (typeof id !== 'string' || typeof token !== 'number') return;
  const cur = menuOverlay.getCurrentMenu();
  if (!cur || token !== cur.token) return; // stale sheet report
  menuOverlay.closeMenuOverlay('activated', token);
  /** @type {{ menuType: string, id: string, value?: string }} */
  const out = { menuType: cur.menuType, id };
  const v = sanitizeActivatedValue(value);
  if (v !== undefined) out.value = v;
  getChromeContents()?.send('menu-overlay-activated', out);
});

// Channel 5 — sheet → main: dismissed. `reason` allowlisted to the page-attributable
// flavors; anything else is treated as the page's default flavor ('blur'). Stale
// tokens are dropped inside closeMenuOverlay.
const SHEET_DISMISS_REASONS = new Set(['escape', 'outside-click', 'blur']);
ipcMain.on('menu-overlay:dismissed', (event, payload) => {
  if (!isSheetSender(event)) return;
  const { reason, token } = payload || {};
  if (typeof token !== 'number') return;
  menuOverlay.closeMenuOverlay(SHEET_DISMISS_REASONS.has(reason) ? reason : 'blur', token);
});


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
  // Under the Wayland ozone backend (Leg-6 HAT fix — the dev launcher passes
  // --ozone-platform=wayland when a compositor socket is reachable), the app's
  // own surface is NOT in desktopCapturer's window-source list (X-window based;
  // no PipeWire under WSLg), so the best-size heuristic below would grab an
  // UNRELATED window. Skip straight to the capturePage composite fallback.
  const onWayland = app.commandLine.getSwitchValue('ozone-platform') === 'wayland';
  if (!onWayland) {
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

    // Get the #webviews slot bounds from the chrome renderer so we know
    // where to draw the guest PNG on the composite canvas.
    const guestBoundsJson = await cc.executeJavaScript(
      'JSON.stringify(document.getElementById("webviews")?.getBoundingClientRect() ?? null)'
    );
    const guestBounds = guestBoundsJson ? JSON.parse(guestBoundsJson) : null;

    // Layer list, bottom-up: guest at the slot offset, then the overlay views in
    // their z-order (find bar, then the menu-overlay sheet — the sheet is added
    // after the find re-assert on every show path, so it stacks above). Without
    // the overlay layers a Wayland-path captureWindow would silently omit an
    // OPEN MENU / find bar that IS on the real screen (the x11 desktopCapturer
    // path captured real window pixels, hiding this gap until the Leg-6 ozone
    // switch). View bounds are window-content DIPs — the same space as the
    // chrome DOM rect (the chrome view fills the window at 0,0).
    /** @type {{ b64: string, x: number, y: number, w: number, h: number }[]} */
    const layers = [];
    if (tabB64 && guestBounds) {
      layers.push({ b64: tabB64, x: guestBounds.x, y: guestBounds.y, w: guestBounds.width, h: guestBounds.height });
    }
    if (overlayVisible && overlayView && !overlayView.webContents.isDestroyed()) {
      const img = await overlayView.webContents.capturePage();
      const b = overlayView.getBounds();
      if (img && b.width && b.height) layers.push({ b64: img.toPNG().toString('base64'), x: b.x, y: b.y, w: b.width, h: b.height });
    }
    const sheetView = menuOverlay.isVisible() ? menuOverlay.getView() : null;
    if (sheetView && !sheetView.webContents.isDestroyed()) {
      const img = await /** @type {Electron.WebContents} */ (sheetView.webContents).capturePage();
      const b = /** @type {Electron.WebContentsView} */ (/** @type {unknown} */ (sheetView)).getBounds();
      if (img && b.width && b.height) layers.push({ b64: img.toPNG().toString('base64'), x: b.x, y: b.y, w: b.width, h: b.height });
    }

    if (layers.length === 0) {
      // No guest and no overlays — chrome-only capture.
      return chromeB64;
    }

    // Composite in the chrome renderer: draw chrome, then each layer in order.
    const layerArgs = JSON.stringify(layers.map((l) => ({ u: 'data:image/png;base64,' + l.b64, x: l.x, y: l.y, w: l.w, h: l.h })));
    const compositeB64 = await cc.executeJavaScript(`(function(chromeDataUrl, layers) {
      function load(src) {
        return new Promise(function(resolve, reject) {
          var img = new Image();
          img.onload = function() { resolve(img); };
          img.onerror = function() { reject(new Error('img load failed')); };
          img.src = src;
        });
      }
      return load(chromeDataUrl).then(function(chromeImg) {
        return Promise.all(layers.map(function(l) {
          return load(l.u).then(function(img) { return { img: img, l: l }; }, function() { return null; });
        })).then(function(loaded) {
          var canvas = document.createElement('canvas');
          canvas.width = chromeImg.naturalWidth;
          canvas.height = chromeImg.naturalHeight;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(chromeImg, 0, 0);
          loaded.forEach(function(e) {
            if (!e) return;
            ctx.drawImage(e.img, Math.round(e.l.x), Math.round(e.l.y), Math.round(e.l.w), Math.round(e.l.h));
          });
          return canvas.toDataURL('image/png').replace(/^data:image\\/png;base64,/, '');
        });
      });
    })('data:image/png;base64,${chromeB64}', ${layerArgs})`);

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
    // isTabViewWcId (F8 DD8 defense-in-depth): non-tab, non-chrome wcIds (e.g. the
    // menu-overlay sheet, the find overlay) resolve only at the admin tier.
    getEngine: (engineOpts) => createEngine(getChromeContents, { ...engineOpts, getDownloads: () => downloadsManager.listAll(), grabWindow, isTabViewWcId: (id) => tabViews.has(id) }),
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
    // Find-overlay teardown (DD1): destroys the lazy singleton and clears the find
    // session + ready flag + queued init (AC6f — no refocus concern, everything is
    // tearing down; teardownFindOverlayView never refocuses).
    // ORDERING PIN (F8 DD5): this runs BEFORE closeMenuOverlay('teardown') — it nulls
    // findOverlayTabWcId, so the teardown-reason find-restore naturally no-ops
    // mid-window-teardown (the sheet-crash render-process-gone teardown, where the
    // find session is still live, restores as desired).
    teardownFindOverlayView();
    // Menu-overlay close family (F8 DD4): emit the 'teardown' close (channel 7 is a
    // no-op here — chrome contents already nulled — but the menu state is reset so a
    // relaunch starts clean), then destroy the lazy singleton (DD9).
    menuOverlay.closeMenuOverlay('teardown');
    menuOverlay.teardown();
  });

  // Menu-overlay close family (F8 DD4): BaseWindow blur — app switch closes any open
  // menu. On an app switch the sheet's own blur ALSO fires (dismissed{blur}, stale by
  // then): closeMenuOverlay is idempotent + stale-token-guarded, so chrome sees
  // exactly one channel-7 close and the DD5 restore runs once. No refocus on 'blur'
  // (never steal focus from the other app on return). Window MINIMIZE is deliberately
  // NOT in the close family: where the platform fires blur on minimize the menu
  // closes via this path; where it doesn't (WSLg uncertainty), a menu surviving
  // minimize-restore is an accepted variation (leg AC3) — HAT observes.
  mainWindow.on('blur', () => menuOverlay.closeMenuOverlay('blur'));

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
// Each web guest WebContentsView gets the media-scanner preload (webview-preload.js)
// injected via its webPreferences.preload, set at construction time in tab-create
// so pages can never opt out.
// ---------------------------------------------------------------------------
// wireGuestContents — wires event listeners onto a guest webContents. Called from
// the global app.on('web-contents-created') handler AND
// explicitly for new WebContentsViews in ipcMain.handle('tab-create') (because
// web-contents-created fires SYNCHRONOUSLY during new WebContentsView(), before the
// tabViews registry entry can be set — so the global handler cannot identify them).
//
// handleGuestCrossViewNav — the guest→chrome keyboard bridge (M05 Flight 5 Leg 2).
// Two keys must cross the multi-WebContentsView boundary from a focused guest back
// to the chrome view: Ctrl/Cmd+L (focus the address bar) and an unmodified Tab
// (hand focus off to the chrome's pinned first control, the address bar). Both are
// chrome-level — not guest features — so they apply to WEB and INTERNAL guests
// alike; this helper is invoked from BOTH the web-guest before-input-event and the
// minimal internal-guest one. The pure decision (which key, if any) lives in the
// unit-tested crossViewNavAction; here we run the side effects. Returns true iff it
// handled (swallowed) the key so callers can early-return.
function handleGuestCrossViewNav(event, input) {
  if (input.type !== 'keyDown') return false;
  const nav = crossViewNavAction({
    key: input.key,
    control: input.control,
    meta: input.meta,
    shift: input.shift,
    alt: input.alt,
  });
  if (!nav) return false;
  // Swallow the key so the guest never sees it (both keys leave the guest).
  event.preventDefault();
  // Held key: swallow but don't re-hand-off — a repeated Tab/Ctrl+L must not thrash
  // focus back to chrome on every keyDown repeat (mirrors the guest branches' own
  // isAutoRepeat guards).
  if (input.isAutoRepeat) return true;
  // Focus-then-send (F4 rule): OS-focus the chrome VIEW before the focus-address IPC.
  // dispatchChromeAction('focus-address') only DOM-focuses els.address; for the input
  // to actually accept typing the chrome view must hold OS keyboard focus (which, on a
  // focused guest, it does not). Reuse getChromeContents()?.focus() (the focusChrome
  // primitive). Both cross-view keys resolve to the pinned address bar, so both ride
  // the existing chrome-shortcut-action:focus-address channel.
  getChromeContents()?.focus();
  getChromeContents()?.send('chrome-shortcut-action', { action: 'focus-address' });
  return true;
}

// Generalized chrome-class accelerator forwarder (DD8, M06 F3 Leg 4). Replaces
// the accumulating handleGuest* one-offs — flagged at Flight 2's debrief
// ("before more handleGuest* functions accumulate") — with ONE classifier-driven
// forwarder: classify the keystroke with the SAME pure `keydownToAction` the
// chrome DOM keydown handler uses (renderer.js), and forward it as a single
// `chrome-shortcut-action` send iff the per-guest-kind allowlist
// (`isChromeActionForwardable`, src/shared/guest-forward-allowlist.js) admits
// it. Parity goal (FD ruling): an accelerator that works under chrome focus
// works identically under guest focus.
//
// ABSORBS the former handleGuestNewTab (M06 F2 HAT D2 fix — Ctrl/Cmd+T silently
// swallowed under guest focus with no forward anywhere): new-tab is now just
// one member of the WEB/INTERNAL allowlists, going through the same classify+
// allowlist path as every other forwarded action. Ctrl+T still forwards on both
// guest branches (no regression) — Ctrl+Shift+T does NOT (keydownToAction only
// matches lowercase 't'): an intentional drop, not a bug — parity with chrome
// focus, and Ctrl+Shift+T is reserved unassigned for a future "reopen closed
// tab" feature (FD ruling, pinned by a classifier-level unit test).
//
// Main-side-handled keys (zoom/print/find/downloads/devtools) are NOT in either
// allowlist, so this forwarder no-ops for them (returns false, no
// preventDefault) and callers fall through unchanged to their existing branches
// below — this function adds no regression surface over those.
//
// MUST be called AFTER handleGuestCrossViewNav in both guest branches
// (design-review catch): crossViewNavAction and keydownToAction both map
// Ctrl+L → focus-address; handleGuestCrossViewNav's early return is what makes
// that safe. Calling this first would double-dispatch focus-address.
//
// @param {Electron.Event} event
// @param {Electron.Input} input
// @param {'web' | 'internal'} guestKind
// @returns {boolean} whether it handled (swallowed) the key
function handleGuestChromeShortcut(event, input, guestKind) {
  if (input.type !== 'keyDown') return false;
  const action = keydownToAction({
    key: input.key,
    ctrl: input.control,
    meta: input.meta,
    shift: input.shift,
    // Guests hold no lightbox state (lightbox is chrome-only UI); none of the
    // actions either allowlist admits are lightbox-gated in keydownToAction
    // (devtools/zoom/find are excluded by the allowlist itself), so this is safe.
    lightboxOpen: false,
  });
  if (!isChromeActionForwardable(action, guestKind)) return false;
  event.preventDefault();
  // Swallow but don't stack/repeat-fire on a held key (mirrors the former
  // handleGuestNewTab / Ctrl+J downloads guard below).
  if (!input.isAutoRepeat) getChromeContents()?.send('chrome-shortcut-action', { action });
  return true;
}

function wireGuestContents(contents) {
  // Open target=_blank / window.open as new tabs in our own UI instead of
  // spawning native Electron windows.
  //
  // Popup inheritance (DD7, M06 F3 Leg 4): forward the OPENER's session partition
  // alongside the URL, read from the existing per-view tabViews registry (set at
  // tab-create time, cleaned up on tab-close — no staleness risk; `contents` here
  // IS the opener guest's webContents, keyed by its own wcId). The renderer
  // resolves `openerPartition` into a container decision via the pure
  // `inheritFromPartition` (src/shared/inherit-container.js) and consumes it
  // through the SAME path as context-menu opens. A missing registry entry (e.g.
  // the opener closed before this IPC lands) yields `openerPartition: undefined`,
  // which inheritFromPartition resolves to default routing — never a throw.
  contents.setWindowOpenHandler(({ url }) => {
    const openerPartition = tabViews.get(contents.id)?.partition;
    getChromeContents()?.send('open-tab', { url, openerPartition });
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
      // Cross-view keyboard bridge (M05 F5 Leg 2) FIRST — Ctrl+L / unmodified Tab hand
      // focus back to the chrome view. Contained approach: this single call sits above
      // the existing accelerator branches, which stay UNTOUCHED (no regression surface
      // over F12/zoom/print/find/downloads/devtools). crossViewNavAction returns null
      // for every one of those keys, so it never shadows them.
      if (handleGuestCrossViewNav(event, input)) return;
      // Generalized chrome-class accelerator forwarder (DD8, M06 F3 Leg 4) — same
      // contained-call pattern as the cross-view bridge just above, and MUST stay
      // second (after cross-view nav, before everything below — see the ordering
      // comment on handleGuestChromeShortcut). The WEB allowlist
      // (new-tab/close-tab/focus-address/toggle-panel/toggle-privacy/reload) never
      // overlaps the keys handled by the branches below (devtools/zoom/print/find/
      // downloads are excluded from the allowlist itself), so this never shadows an
      // existing accelerator.
      if (handleGuestChromeShortcut(event, input, 'web')) return;
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
      // Find in page (SC4 / DD2, M05 F7). Suppress Chromium's native find and tell
      // the chrome renderer to open the floating find OVERLAY (a main-owned
      // chrome-class WebContentsView, not chrome DOM): the renderer's openFind
      // resolves per-tab state and drives find-overlay:open back into main. No
      // payload — the renderer infers via activeTab(). The __goldfinchInternal
      // skip already excludes internal sessions, satisfying DD5.
      if (input.key === 'f' || input.key === 'F') {
        event.preventDefault();
        // No chrome focus here (DD6): main focuses the overlay webContents in
        // openFindOverlaySession when the renderer drives find-overlay:open —
        // a chrome-view focus would actively fight that.
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
    // Custom page context menu (DD2/DD6). The context-menu event fires on the
    // main-process guest webContents. We forward ONLY the params; the chrome
    // renderer builds the model (pure pageContextModel) and opens it on the
    // menu-overlay sheet at the 1:1 guest coords (M05 F8). Internal goldfinch://
    // guests are excluded by the !__goldfinchInternal guard (DD6).
    contents.on('context-menu', (event, params) => {
      event.preventDefault();
      if (!mainWindow) return;
      if (isInternalContents(contents)) return;
      getChromeContents()?.send('page-context-menu', { wcId: contents.id, params });
    });
  } else {
    // Internal goldfinch:// guests get NO before-input-event from the block above
    // (it sits inside the !__goldfinchInternal guard, so F12/zoom/print/find/downloads/
    // devtools are all inert on internal tabs — intentional). But the two CROSS-VIEW
    // keys (Ctrl+L, Tab) are chrome-level, not guest features, and must still work when
    // an internal tab holds OS focus — the only viable capture is a main-side
    // before-input-event on the internal guest's webContents (a chrome renderer-keydown
    // fallback never fires while the internal view holds focus). Register a SEPARATE,
    // MINIMAL handler that calls ONLY handleGuestCrossViewNav and the generalized
    // forwarder with the INTERNAL allowlist (new-tab + close-tab only — DD8 FD
    // ruling, deliberately thin; extend one action at a time at future leg
    // design) — so internal tabs gain the keyboard bridge and Ctrl+T (M06 F2 HAT
    // D2 fix, absorbed — dispatchChromeAction('new-tab') has no isInternalTab
    // gate, so it must work here too) plus Ctrl+W, but no other accelerator.
    // Cross-view nav MUST run first (early return) — see the ordering comment on
    // handleGuestChromeShortcut (Ctrl+L double-dispatch otherwise).
    contents.on('before-input-event', (event, input) => {
      if (handleGuestCrossViewNav(event, input)) return;
      handleGuestChromeShortcut(event, input, 'internal');
    });
  }
}

// Wire tab-strip event forwarding for a WebContentsView guest (Flight 3, Leg 1).
// Forwards did-navigate / title / favicon / loading to the chrome renderer; the
// found-in-page count fans out to the find-overlay webContents (path B, DD3).
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
    // Count path B (DD3, M05 Flight 7): when the overlay find session targets THIS
    // tab, fan the count directly to the overlay webContents — no renderer round-trip
    // (the old chrome fan-out was retired at the F7 cutover; the chrome count display
    // was its only consumer).
    // `overlayView` is the module-level ref resolved at event time (never captured at
    // tab construction — the overlay is lazy). The isFindOverlayActive(wcId) guard
    // also drops stale results from a non-target tab after a fast tab switch.
    if (isFindOverlayActive(wcId) && overlayView && !overlayView.webContents.isDestroyed()) {
      overlayView.webContents.send('find-overlay:count', {
        activeMatchOrdinal: result.activeMatchOrdinal,
        matches: result.matches
      });
    }
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
    // Base web session (always present).
    applySpellcheck(session.defaultSession, enabled);
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
// M06 Flight 4 Leg 1 (DD8 broadcast-invariant net finding): this handler mutates
// `automationPort` via settings.set but never broadcast settings-changed — a
// genuine pre-existing gap the F7 fix (see jar-key-revoke/admin-mint/admin-revoke
// below) did not cover. Fixed to match those siblings, so any other open
// internal tab / the chrome sees the new port without a separate reload.
registerInternalHandler(ipcMain, 'automation:set-port', async (_e, port) => {
  settings.set('automationPort', port);
  broadcastToChromeAndInternal('settings-changed', settings.getAll());
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
// F7 (Flight 3, Leg 6 HAT): revoke/admin-mint/admin-revoke ALSO mutate
// `automationKeyHashes` / `automationAdminKeyHash` (both settings values) but
// were missing the broadcast mint already carries — a pre-existing gap against
// the documented convention ("any IPC handler that mutates settings directly
// or transitively MUST broadcast settings-changed itself"). Without it, a
// revoke/rotate only updated the acting settings-page tab (which refresh()es
// itself locally); the chrome toolbar's automation indicator (and any OTHER
// open internal tab) would silently lag until the next unrelated broadcast.
// Fixed here to match jar-key-mint's existing broadcast, needed for the F7
// indicator to react live to a revoke.
registerInternalHandler(ipcMain, 'automation:jar-key-revoke', (_e, jarId) => {
  revokeJarKey(jarId, settings);
  broadcastToChromeAndInternal('settings-changed', settings.getAll());
  return { ok: true };
});
registerInternalHandler(ipcMain, 'automation:admin-key-mint', () => {
  const key = mintAdminKey(settings);
  broadcastToChromeAndInternal('settings-changed', settings.getAll());
  return { key };
});
registerInternalHandler(ipcMain, 'automation:admin-key-revoke', () => {
  revokeAdminKey(settings);
  broadcastToChromeAndInternal('settings-changed', settings.getAll());
  return { ok: true };
});

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
  // Both add entry points emit jars-changed (DD6). broadcastJarsChanged's const
  // destructuring sits at the jar section further down — legal (the handler runs
  // long after module evaluation).
  broadcastJarsChanged();
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
  // Captured BEFORE the null-out below — one line lower and this is always false.
  const wasActive = activeTabWcId === wcId;
  mainWindow.contentView.removeChildView(entry.view);
  if (!entry.view.webContents.isDestroyed()) {
    entry.view.webContents.destroy();
  }
  tabViews.delete(wcId);
  if (activeTabWcId === wcId) activeTabWcId = null;
  // Find-overlay session teardown (AC6d): the session target is being destroyed —
  // close the session with NO refocus (nothing sensible to focus; the stopFind inside
  // close tolerates the mid-destruction guest via getTabContents' guards, and the
  // entry is already deleted above so it resolves null). Placed with the Leg-1
  // overlay lines, AFTER tabViews.delete.
  if (wcId === findOverlayTabWcId) closeFindOverlaySession({ refocusGuest: false });
  // Belt-and-suspenders (DD1, Leg 1): closing the active tab, or the last web tab
  // (all-internal remaining), removes the overlay from the stack even sessionless.
  // Menu-overlay close family (F8 DD4): closing the ACTIVE tab while a menu is open
  // closes the menu ('tab-close' — restore explicitly skipped in the DD5 hook, not
  // left to the activeTabWcId null-out accident). Deliberately NO "no web tabs left"
  // mirror — the sheet serves internal tabs as well (DD7); active-tab lifecycle
  // covers it.
  if (wasActive) {
    hideFindOverlay();
    menuOverlay.closeMenuOverlay('tab-close');
  }
  const anyWebTabLeft = [...tabViews.values()].some((e) => e.trusted === false);
  if (!anyWebTabLeft) hideFindOverlay();
});

ipcMain.on('tab-hide', (_event, wcId) => {
  // Find-overlay hide (DD5): hiding the active guest (the pending-activation hide)
  // takes the overlay out of the stack too. Restore needs no code here —
  // late-activation lands in tab-set-active's re-add.
  // Menu-overlay close family (F8 DD4): hiding the active guest while a sheet menu
  // is open CLOSES the menu ('tab-hide'). The DD5 hook skips the find-restore for
  // this reason (the close runs BEFORE activeTabWcId is nulled below — a restore
  // here would paint the bar over a hidden guest).
  if (wcId === activeTabWcId) {
    hideFindOverlay();
    menuOverlay.closeMenuOverlay('tab-hide');
  }
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
    // Hoisted rounded bounds so the guest setBounds and lastGuestBounds share one object.
    const rounded = bounds
      ? { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) }
      : null;
    if (rounded) {
      entry.view.setBounds(rounded);
    }
    if (!entry.view.webContents.isDestroyed()) {
      entry.view.setVisible(true);
    }
    entry.active = true;
    // Raise the active guest view to the top so page input works.
    if (mainWindow) {
      mainWindow.contentView.addChildView(entry.view);
    }
    // Find-overlay z-order re-assert (DD2 invariant): strictly AFTER the guest re-add
    // above, or the guest buries the overlay. Do not "optimize" this away when the
    // overlay is already visible — every guest re-add raises the guest.
    if (findOverlayTabWcId != null && wcId !== findOverlayTabWcId) {
      // AC6a: activating a DIFFERENT tab (internal or web alike — also covers DD7)
      // CLOSES the session: stopFind clearSelection on the old guest, hide, clear
      // state. NO refocus — the new guest was already added/raised above; refocusing
      // the OLD guest would land OS focus on a view about to be hidden and steal
      // focus from tab-strip keyboard navigation (AC5).
      closeFindOverlaySession({ refocusGuest: false });
    } else if (isFindOverlayActive(wcId)) {
      // AC6b / DD5 restore: re-activating the session's own tab re-shows the
      // overlay — the session survives a hide/re-add cycle.
      // isFindOverlayActive(wcId) implies !entry.trusted (open refuses trusted).
      if (rounded) lastGuestBounds = rounded;
      showFindOverlay();
    }
    // Menu-overlay sheet (F8 DD4/DD9/DD7): strictly AFTER the guest re-add AND the
    // find-overlay re-assert above, so the sheet sits top-of-stack. No entry.trusted
    // gate — the sheet serves internal tabs too (DD7).
    if (rounded) menuOverlay.syncBounds(rounded);
    if (activeTabWcId !== null && activeTabWcId !== wcId) {
      // Close family: activating a DIFFERENT tab (any driver, incl. MCP activateTab —
      // the DD4 "never blurs the sheet" path) closes any open menu. The DD5 hook
      // skips the find-restore for 'tab-switch' — this handler's own per-tab
      // find-restore logic above governs.
      menuOverlay.closeMenuOverlay('tab-switch');
    } else if (menuOverlay.isMenuOpen()) {
      // Same-tab re-activation with a menu open: the re-add keeps the sheet
      // top-of-stack via re-add-last.
      menuOverlay.show();
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
  const rounded = { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) };
  entry.view.setBounds(rounded);
  // Find-overlay position-sync (DD2): the overlay tracks the ACTIVE guest's bounds —
  // resize/maximize/panel toggles all funnel here via sendActiveBounds/ResizeObserver/
  // trigger-send-bounds.
  if (wcId === activeTabWcId) {
    lastGuestBounds = rounded;
    if (overlayVisible && overlayView) {
      overlayView.setBounds(computeFindOverlayBounds(rounded));
    }
    // Menu-overlay geometry-follow (F8 DD12): identity mapping — the sheet's bounds
    // ARE the active guest's rounded bounds. The manager stores always, applies only
    // while visible.
    menuOverlay.syncBounds(rounded);
  }
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

// --- Find-overlay DD4 IPC (M05 Flight 7). Chrome-class trust domain, but every
// handler still validates event.sender — a guest page must never be able to open or
// drive the overlay. Open/close route through the shared session functions above. ------

// Sender: the chrome webContents ONLY (the renderer's openFind / activateTab restore).
ipcMain.on('find-overlay:open', (event, payload) => {
  if (event.sender !== getChromeContents()) return;
  const { wcId, findText } = payload || {};
  openFindOverlaySession(wcId, typeof findText === 'string' ? findText : '');
});

// Sender: chrome OR the overlay itself. The SENDER resolves the close semantics
// (design decision, Leg 3 — no payload flag, nothing to spoof):
// - overlay sender = the user explicitly closed the bar (Esc/✕) → refocus the guest
//   (AC5, the only refocusing close path) AND notify the chrome (find-overlay-closed)
//   so it clears the tab's findOpen — otherwise switch-back would ghost-reopen.
// - chrome sender = programmatic navigation-close → NO focus move (a page-initiated
//   redirect must not yank OS focus into the guest, e.g. mid-typing in the address
//   bar) and NO notification (the chrome initiated it; no echo needed).
ipcMain.on('find-overlay:close', (event) => {
  const overlayWc = overlayView && !overlayView.webContents.isDestroyed() ? overlayView.webContents : null;
  const fromOverlay = overlayWc != null && event.sender === overlayWc;
  if (!fromOverlay && event.sender !== getChromeContents()) return;
  // Notify BEFORE closing — closeFindOverlaySession nulls findOverlayTabWcId.
  if (fromOverlay && findOverlayTabWcId != null) {
    getChromeContents()?.send('find-overlay-closed', { wcId: findOverlayTabWcId });
  }
  closeFindOverlaySession({ refocusGuest: fromOverlay });
});

// Sender: the overlay ONLY. Forwards the query text to the chrome for per-tab state
// sync (DD9 — EVERY query, empty included: deletion sync, so tab.findText tracks a
// delete-to-empty and switch-back restores a blank bar, not resurrected text), then
// resolves the session's target guest and runs findInPage. Empty text skips findInPage
// (the page blanks its own count; NO stopFindInPage — the highlight persists until
// close). A hidden-but-live guest is allowed — counts land when the overlay
// re-shows. A stale/destroyed target resolves null → no-op.
//
// FLAG MAPPING (HAT-1 fix): the payload's `findNext` keeps the chrome-bar shape
// ("this is a STEP request"), but Electron's FindInPageOptions.findNext means "begin a
// NEW find session" — the inverse. A step continues the engine session (Electron
// findNext:false) ONLY when the text is unchanged since the last issued query; every
// text change — incremental typing, backspace edits — and every first query of a
// session begins a NEW session (Electron findNext:true) so the edited term re-searches
// immediately instead of advancing the stale session. (The pre-F7 inset bar had the
// same inversion — pre-existing defect, not carried contract.)
ipcMain.on('find-overlay:query', (event, payload) => {
  if (!overlayView || overlayView.webContents.isDestroyed() || event.sender !== overlayView.webContents) return;
  const wc = getTabContents(findOverlayTabWcId);
  if (!wc) return;
  const { text, findNext, forward, matchCase } = payload || {};
  if (typeof text !== 'string') return;
  getChromeContents()?.send('find-overlay-text', { wcId: findOverlayTabWcId, text });
  if (!text) {
    // Deleted-to-empty: no engine call (highlight persists), but the session text is
    // gone — the next non-empty query must begin a new engine session.
    findOverlayLastQueryText = null;
    return;
  }
  const isStep = !!findNext && text === findOverlayLastQueryText;
  findOverlayLastQueryText = text;
  wc.findInPage(text, { findNext: !isStep, forward: forward !== false, matchCase: !!matchCase });
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
// The six jar-registry channels (list/add/rename/remove/set-default/get-default) live in
// jar-ipc.js (M06 F1 Leg 3) — unit-testable via injected deps, and they don't feed this file.
// The mutating channels are deliberately chrome-trusted (bare ipcMain.handle, same domain as
// new-container-create); Flight 3 adds internal-origin-gated variants for the management page (DD7).
// broadcastJarsChanged is reused by new-container-create above (the picker's add entry point).
const { broadcastJarsChanged } = registerJarIpc({
  ipcMain,
  jars,
  session,
  rerollSeed,
  revokeJarKey,
  settings,
  broadcast: broadcastToChromeAndInternal
});

// New Identity: wipe a jar's cookies + storage and reroll its fingerprint seed,
// so the site can no longer link you to who you just were.
ipcMain.handle('identity-new', async (_e, { partition }) => {
  if (!partition) return { ok: false };
  const ses = session.fromPartition(partition);
  // Same internal-session guard as privacy-cookies (the privacy panel can stay open
  // across a switch to Settings / goldfinch:// — never wipe the privileged partition).
  if (/** @type {any} */ (ses).__goldfinchInternal) {
    return { ok: false };
  }
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
  // DD4: strictly per-tab — a missing/destroyed webContents (or the internal Settings
  // session, reachable if the privacy panel stays open across a tab switch) returns the
  // channel's empty shape instead of silently falling back to a cross-jar session.
  if (!wc || /** @type {any} */ (wc.session).__goldfinchInternal) {
    return { firstParty: null, first: 0, third: 0, total: 0, list: [] };
  }
  const ses = wc.session;
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
  // DD4: strictly per-tab — see privacy-cookies above for the internal-session guard
  // rationale (the privacy panel can stay open across a switch to Settings).
  if (!wc || /** @type {any} */ (wc.session).__goldfinchInternal) {
    return { removed: 0 };
  }
  const ses = wc.session;
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

ipcMain.handle('privacy-clear-storage', async (_e, { url, webContentsId }) => {
  const wc = webContentsId != null ? webContents.fromId(webContentsId) : null;
  // DD4: strictly per-tab (this handler previously always acted on the legacy
  // partition — a real cross-jar bug for any non-legacy tab). Same internal-session
  // guard as its two siblings: newly reachable here since this handler never touched
  // `wc` before this leg.
  if (!wc || /** @type {any} */ (wc.session).__goldfinchInternal) {
    return { ok: false, error: 'no-tab' };
  }
  try {
    const origin = new URL(url).origin;
    await wc.session.clearStorageData({ origin });
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
  // re-applies the correct state to defaultSession after stores load anyway.
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
  // Cover the session that may already exist before the hook was attached.
  // No other pre-warm: jar sessions (including the migrated legacy `default` jar) get
  // Shields/downloads/spellcheck lazily at their first `session-created` firing above —
  // routing goes through the live default flag now, so there is no reserved partition
  // to warm ahead of use (M06 F2 DD5).
  wireDownloadHandler(session.defaultSession);
  applyShields(session.defaultSession);
  applySpellcheck(session.defaultSession, settings.get('spellcheck'));

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
    // isTabViewWcId (F8 DD8): same hardening as the MCP engine accessor above — the
    // dev seam is not admin-tier, so chrome-class overlay wcIds must refuse here too.
    const engine = createEngine(getChromeContents, { getDownloads: () => downloadsManager.listAll(), grabWindow, isTabViewWcId: (id) => tabViews.has(id) });
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
    //   - Mints for the RESOLVED default jar (M06 F2 DD7): resolveAutoMintTarget(jars)
    //     reads jars.getDefault() and returns its id, or null when the resolved
    //     default is the Burner sentinel (empty registry — the mint guard refuses
    //     burner ids, so minting is skipped with one parseable stderr notice instead
    //     of a thrown/caught guard error). Admin key minted only when
    //     GOLDFINCH_AUTOMATION_ADMIN is also set (gated in mintAdminKey).
    //   - Prints the result ONCE to stdout as a single parseable line so the FD can
    //     scrape the Bearer key. The plaintext key is never persisted (only its hash).
    if (shouldAutoMint(process.argv, process.env)) {
      try {
        const target = resolveAutoMintTarget(jars);
        if (target === null) {
          console.error('[mcp] dev auto-mint skipped: default is Burner (no persistent jars)');
        }
        const key = target === null ? null : mintJarKey(target, settings, jars);
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
