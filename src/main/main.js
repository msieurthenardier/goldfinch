'use strict';

const { app, BaseWindow, WebContentsView, ipcMain, session, webContents, desktopCapturer, dialog, shell, protocol, net, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { registrableDomain, hostnameOf, classify } = require('./trackers');
const shields = require('./shields');
const jars = require('./jars');
const { registerJarIpc } = require('./jar-ipc');
const historyStore = require('./history-store');
// App database (M10 Flight 1, Leg 1 / DD2-DD4): the Electron-free node:sqlite
// substrate backing settings/downloads/session (jars/shields fold in leg 2).
const appDb = require('./app-db');
// Retention sweep engine (M10 Flight 2, Leg 3 / DD4 VERDICT, DD4b, DD6,
// DD10): generalizes retention from history-only pruning to cookies + site
// data. Electron-free — see retention-sweep.js's own header.
const { createRetentionSweep } = require('./retention-sweep');
const { cookieUrl, partitionFromStoragePath, cookieChangeAction } = require('./jar-data-helpers');
const { createHistoryRecorder } = require('./history-recorder');
const { registerHistoryIpc } = require('./history-ipc');
const { isSafeTabUrl, isInternalPageUrl } = require('../shared/url-safety');
const { INTERNAL_PARTITION } = require('../shared/internal-page');
const { initProfileAndStores } = require('./init-profile');
const { sanitizeFilename, isWithinDir } = require('./download-path');
const { createResolver } = require('./internal-assets');
const { createInternalPageMap } = require('./internal-page-map');
const { createBroadcasters } = require('./broadcasts');
const settings = require('./settings-store');
const downloads = require('./downloads-store');
// Password vault store (Mission 12, Flight 1). Wired here only for the automation
// surface's STATELESS read path (Leg 3): a dedicated instance the per-session MCP
// vault context reaches via unlockVaultWithAccessKey / openAllWithAdminKey /
// readVaultItems — none of which mutate the store's human lock state. The human
// unlock UI / IPC is a separate concern (later legs).
const vaultStoreModule = require('./vault/vault-store');
// M09 Flight 9 (session restore): the Electron-free open-window/tab topology store
// (leg 2) + the pure burner-allowlist snapshot builder (leg 2), wired here (leg 3).
const sessionStore = require('./session-store');
const { buildSessionSnapshot } = require('./session-snapshot');
const { createManager } = require('./downloads-manager');
const { buildRegisterRecord, buildProgressPayload, buildDonePayload } = require('./downloads-payload');
const { registerInternalHandler } = require('./internal-ipc');
const { computeFindOverlayBounds } = require('./find-overlay-geometry');
const { createMenuOverlayManager } = require('./menu-overlay-manager');
const { createFindOverlayManager } = require('./find-overlay-manager');
const { createTearoffOverlayManager } = require('./tearoff-overlay-manager');
const { createWindowFactory } = require('./window-factory');
const { createGuestWiring } = require('./guest-wiring');
const { createSessionRuntime } = require('./session-runtime');
const { registerTabIpc } = require('./register-tab-ipc');
const { registerOverlayIpc } = require('./register-overlay-ipc');
const { registerDownloadIpc } = require('./register-download-ipc');
const { registerSettingsIpc } = require('./register-settings-ipc');
const { registerBrowserIpc } = require('./register-browser-ipc');
const { registerAppLifecycle } = require('./app-lifecycle');
// F7 DD2: the pure, Electron-free row builder behind the enumerateWindows op.
// Zero state — every field derives from the live records at call time.
const { buildWindowCensus } = require('./window-census');
// F8 DD8: the pure, Electron-free "Move to window …" target list. Same zero-state
// contract as the census above — derived from the live records at call time.
const { buildMoveTargets } = require('./move-targets');
// F7 DD4: pure, Electron-free identity pick for desktopCapturer sources. Replaces
// a best-size-match heuristic that could grab an unrelated same-sized window.
const { pickSourceByMediaSourceId } = require('./capture-source-picker');
// F7 DD7 (recon S3): bounded capturePage race — a detached-but-live view's capturePage()
// never settles, so every unguarded await wedges the request forever. Pure/Electron-free.
const { withCaptureTimeout } = require('./capture-timeout');
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
const { isChromeActionForwardable, isRepeatSafeAction } = require('../shared/guest-forward-allowlist');
// M09 F4 Leg 1 (DD1): pure, bounded closed-tab stack — main owns the singleton
// instance (created below, near tabViews); the capture/reopen wiring lives here.
const { createClosedTabStack } = require('../shared/closed-tab-stack.js');
// M09 F6 Leg 3 (DD4): the pure capture/pop rules shared by the two capture sites
// (tab-close, window `close`) and the reopen handler — windowId tagging, the
// whole-window insertion-order/append-sentinel capture, the origin-window
// stripIndex pop rule. The stack module above stays entry-shape-agnostic.
const {
  APPEND_SENTINEL,
  captureClosedTabEntry,
  captureWindowCloseEntries,
  reopenStripIndex,
} = require('./closed-tab-capture');
// M09 F6 Leg 2 (DD2/DD3/DD8): the window registry — per-window records replace the
// former mainWindow/chromeView/tabViews/activeTabWcId singletons. Pure module;
// Electron wiring stays here.
const { createWindowRegistry } = require('./window-registry');
// M09 F6 Leg 4 (DD5 / review H2): pure move-to-new-window payload rules — the
// source renderer's strip-snapshot shape validation + the adopt-tab payload
// builder (main-authoritative url/title at send time; favicon/container are
// renderer-only facts). Unit-pinned offline.
const { validateMoveTabPayload, buildAdoptPayload } = require('./move-tab-payload');

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

// Fixed internal assets remain an exact host/path allowlist. The extracted
// builder receives __dirname and path; it never derives a file from a URL.
const INTERNAL_PAGES = createInternalPageMap({ baseDir: __dirname, path });

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

// The window registry (M09 F6, DD2): one record per BaseWindow —
// { win, chromeView, tabViews: Map<wcId, { view, partition, trusted, active }>,
//   activeTabWcId } — created in createWindow(), removed at the window's `closed`.
// App-globals (closedTabStack, stores, MCP, downloads, privacy maps, farbleSeeds)
// stay module-scope; everything per-window-in-nature lives in the record.
const registry = createWindowRegistry();

// M09 Flight 9 / DD3 two-writer coordination: flipped true by `before-quit` (which
// fires FIRST on menu-Exit / Cmd+Q, full registry alive) so the per-window `close`
// writes are SUPPRESSED and never shrink the terminal snapshot window-by-window. On
// the close-last-window path it stays false, so `close` writes the {thisWindow} set.
// Invariant: the terminal on-disk snapshot = the windows alive at the FIRST
// quit-initiating event.
let sessionQuitting = false;

// DD8 accessor interim: the LAST-FOCUSED record's chrome webContents (membership-
// validated in the registry, first-record fallback), or null when no window exists.
// This is the one rule for every ownerless chrome pick (automation engine, sheet
// accelerator, internal-page opens) — per-tab pushes NEVER use it (class 3 below).
//
// F7 DD3: an optional windowId discriminator. Omitted (every pre-F7 caller) → the
// last-focused record, exactly as before. Supplied → THAT window's chrome, or null
// when the id names no registered window — the caller decides whether the miss is a
// named refusal (engine.js's getChromeTarget throws no-such-window rather than
// silently falling back to last-focused, which would be S1's silent-success class).
const getChromeContents = (windowId) => {
  const rec = windowId != null ? registry.get(windowId) : registry.getLastFocused();
  return rec ? rec.chromeView.webContents : null;
};

// F7 DD2: the flight's single window-topology discovery primitive. ZERO STATE —
// buildWindowCensus derives every field from the live records at call time, so
// there is nothing to cache, no rebuild trigger, and nothing to invalidate.
//
// lastFocused resolves by RECORD IDENTITY (window-census.js's contract): the
// registry does not export lastFocusedId (it is closure-local), and passing the
// record keeps window-registry.js unchanged while inheriting its
// membership-validated first-record fallback for free.
const enumerateWindows = () => buildWindowCensus(registry.records(), registry.getLastFocused());

// F7 DD1's seam: the REGISTRY is the ownership authority for the all-windows tab
// census. `ownsTab` is the record's own tabViews membership — the renderer is
// authoritative only for url/title/jarId and NEVER learns windowId.
//
// tabs.js stays ELECTRON-FREE: the only Electron handle that crosses is `chrome`,
// and tabs.js passes it to executeInChrome and NOTHING else (leg 2's rule).
const listWindows = () => registry.records().map((rec) => ({
  windowId: rec.win.id,
  chrome: rec.chromeView.webContents,
  booted: rec.bootConfigServed,
  ownsTab: (/** @type {number} */ wcId) => rec.tabViews.has(wcId),
}));

// Class-3 owner routing (DD2): the chrome webContents of the window OWNING a tab,
// resolved AT EVENT TIME (never captured at wiring time — that event-time resolution
// is what makes DD5's adopt re-bind automatic). Null when unowned or destroyed.
function chromeForTab(wcId) {
  const cc = registry.getChromeForTab(wcId);
  return cc && !cc.isDestroyed() ? cc : null;
}

// F7 DD6: raise the window OWNING a tab (the foreground-to-act contract restated at
// WINDOW scope). Both halves are load-bearing — the idiom is main.js's move handler's:
// programmatic win.focus() fires NO focus event under WSLg (F6 spike verdict 4), so
// noteFocus must seed the DD8 accessor explicitly or nothing downstream
// (getChromeContents / getChromeTarget / grabWindow) ever learns of the raise.
//
// A window mid-teardown resolves to a record whose win is closing: guard and return
// silently. A raise is a SIDE-EFFECT, never a reason to fail the op (mirrors
// chromeForTab's own !cc.isDestroyed() guard above).
function raiseWindowForTab(wcId) {
  const rec = registry.getWindowForGuest(wcId);
  if (!rec || rec.win.isDestroyed?.()) return;
  rec.win.focus();
  registry.noteFocus(rec.win.id);
}

// M09 F4 Leg 1 (DD1): the closed-tab stack singleton — pure data structure,
// main owns capture (tab-close, below) and reopen (Leg 2) wiring around it.
const closedTabStack = createClosedTabStack();

// Push helpers read the live registry on every call. Closed-tab updates are
// chrome-only; move targets are per-record; shared state fans out to every
// chrome plus each trusted internal page, never ordinary web guests.
const {
  broadcastClosedTabStackChanged,
  broadcastMoveTargetsChanged,
  broadcastToChromeAndInternal
} = createBroadcasters({
  registry,
  webContents,
  isInternalContents,
  closedTabStack,
  buildMoveTargets
});

// Resolve a chrome webContents for the sheet's DD7 attachment window (leg 4):
// a live registered window → ITS chrome; a provided-but-gone window → null
// (drop — its chrome is being torn down, and another window's token space must
// never receive its channel 7); no window recorded → the accessor fallback.
function chromeForAttachment(win) {
  if (win) {
    const rec = !win.isDestroyed() ? registry.get(win.id) : null;
    const cc = rec ? rec.chromeView.webContents : null;
    return cc && !cc.isDestroyed() ? cc : null;
  }
  return getChromeContents();
}

// Returns the guest webContents for a tab view by its wcId (or null if not
// found/destroyed). Resolves across ALL windows' records.
function getTabContents(wcId) {
  const owner = registry.getWindowForGuest(wcId);
  const entry = owner ? owner.tabViews.get(wcId) : null;
  if (!entry) return null;
  const wc = entry.view.webContents;
  return (wc && !wc.isDestroyed()) ? wc : null;
}

// (getActiveTabContents — the last-focused active-tab accessor — was deleted in
// F6 Leg 4: its only consumer was the sheet accelerator, which now resolves the
// ATTACHMENT window's active tab per DD7. Re-derive from registry.getLastFocused()
// if an ownerless active-tab pick is ever needed again.)

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
// The history recorder (M08 Flight 1, Leg 2). Module-scoped so wireTabViewEvents'
// closure (built per tab-create, long before or after boot) can reach it — assigned
// once in app.whenReady, right after the history store opens. Stays null until then;
// every call site uses the `?.` guard, so navigations before boot (impossible in
// practice — tabs are created via IPC after the chrome loads) are harmless no-ops.
/** @type {ReturnType<typeof createHistoryRecorder> | null} */
let historyRecorder = null;

// Grab a screenshot of the main window as a base64 PNG (Flight 3, Leg 1).
// Tries desktopCapturer first (with correct thumbnailSize); falls back to a
// chrome+guest canvas composite on WSLg (dep-free, via executeJavaScript).
// Injected into the engine via deps.grabWindow so observe.js stays Electron-free.
async function grabWindow(windowId) {
  // F6 Leg 2 review F2, restated at F7 DD3: resolve the record ONCE so window
  // bounds, chrome, and active tab all come from the SAME record. windowId omitted
  // → the last-focused record (pre-F7 behavior, unchanged); supplied → that window.
  // Everything downstream reads grabRec, so "never mix records mid-capture" holds
  // for free. A null here is the caller's no-such-window signal.
  const grabRec = windowId != null ? registry.get(windowId) : registry.getLastFocused();
  if (!grabRec) return null;
  const grabWin = grabRec.win;
  // Under the Wayland ozone backend (Leg-6 HAT fix — the dev launcher passes
  // --ozone-platform=wayland when a compositor socket is reachable), the app's
  // own surface is NOT in desktopCapturer's window-source list (X-window based;
  // no PipeWire under WSLg), so the best-size heuristic below would grab an
  // UNRELATED window. Skip straight to the capturePage composite fallback.
  const onWayland = app.commandLine.getSwitchValue('ozone-platform') === 'wayland';
  if (!onWayland) {
    try {
    // FIX 2(a): request thumbnail at the actual window content size so we get a
    // full-resolution capture, not the 150px-wide default thumbnail.
    const { width: cw, height: ch } = grabWin.getContentBounds();
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      fetchWindowIcons: false,
      thumbnailSize: { width: cw, height: ch },
    });
    // F7 DD4: bind by window IDENTITY, never by size. The pre-F7 best-size-match
    // scored every source against this window's bounds and took the largest overlap
    // — with two similar-sized windows open it could grab an UNRELATED window and
    // report success. "Capture *a* window that happens to be the same size" is not a
    // contract, and the exact identity is on the record (getMediaSourceId, an X11
    // Window id on Linux — electron.d.ts:2805-2809).
    //
    // NO fallback branch, by design: a miss falls through to the composite path
    // below, which is already correctly bound to grabRec. Do NOT restore "the
    // closest source" — that is the bug, not a safety net.
    const best = pickSourceByMediaSourceId(sources, grabWin.getMediaSourceId());
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
    // Same record as the window bounds above (F2: never mix records mid-capture).
    const cc = grabRec.chromeView.webContents;
    const atc = grabRec.activeTabWcId != null ? getTabContents(grabRec.activeTabWcId) : null;
    if (!cc || cc.isDestroyed()) return null;

    // Capture both views in parallel.
    // F7 DD7 (recon S3): each promise is bounded INDIVIDUALLY — a hang in EITHER would
    // wedge the whole Promise.all forever. Both HARD-REFUSE on timeout: chrome and the
    // active guest ARE the capture, so there is nothing to degrade to (contrast the
    // overlay layers below, which drop). The labels are what make the refusal name its
    // target: Promise.all would otherwise report whichever rejects first with no way to
    // tell the two captures apart.
    const [chromeImg, tabImg] = await Promise.all([
      withCaptureTimeout(cc.capturePage(), 'chrome'),
      atc && !atc.isDestroyed()
        ? withCaptureTimeout(atc.capturePage(), 'active guest')
        : Promise.resolve(null),
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
    // F7 DD5: composite THE CAPTURED window's OWN overlay layers — the pre-F7
    // attachment gates (`=== grabWin`) are gone because each window's managers only
    // ever hold that window's views, so window A's open menu is structurally
    // unreachable from a capture of window B.
    const findView = grabRec.findOverlay && grabRec.findOverlay.isVisible() ? grabRec.findOverlay.getView() : null;
    if (findView && !findView.webContents.isDestroyed()) {
      try {
        const img = await withCaptureTimeout(
          /** @type {Electron.WebContents} */ (findView.webContents).capturePage(), 'find overlay layer');
        // F7 DD7 post-await re-check (TOCTOU): the gate above is SYNCHRONOUS and the await
        // is not — a hideFindOverlay() landing in the gap detaches the view mid-capture.
        // Written against THIS window's instance (leg 1 deleted the `=== grabWin` compares),
        // and NULL-TOLERANT because leg 1 nulls rec.findOverlay in the window's `close`
        // handler, so the slot can go null during the await.
        if (!grabRec.findOverlay || !grabRec.findOverlay.isVisible()) {
          /* detached mid-capture — drop the layer (same disposition as a layer timeout) */
        } else {
          const b = /** @type {Electron.WebContentsView} */ (/** @type {unknown} */ (findView)).getBounds();
          if (img && b.width && b.height) layers.push({ b64: img.toPNG().toString('base64'), x: b.x, y: b.y, w: b.width, h: b.height });
        }
      } catch (err) {
        // F7 DD7 layer degradation: a slow menu must not fail an otherwise-good window
        // capture. Matches the composite's existing tolerance for a failed layer (the
        // `.then(…, function() { return null; })` below already drops one SILENTLY — this
        // one LOGS). Contrast the chrome/guest captures above, which hard-refuse: those
        // ARE the capture.
        console.warn('[capture] dropping find overlay layer:', err && err.message);
      }
    }
    const sheetView = grabRec.sheet && grabRec.sheet.isVisible() ? grabRec.sheet.getView() : null;
    if (sheetView && !sheetView.webContents.isDestroyed()) {
      try {
        const img = await withCaptureTimeout(
          /** @type {Electron.WebContents} */ (sheetView.webContents).capturePage(), 'sheet overlay layer');
        // DD7 post-await re-check (TOCTOU) — see the find layer above. Null-tolerant for
        // the same reason (leg 1 nulls rec.sheet in the window's `close` handler).
        if (!grabRec.sheet || !grabRec.sheet.isVisible()) {
          /* detached mid-capture — drop the layer (same disposition as a layer timeout) */
        } else {
          const b = /** @type {Electron.WebContentsView} */ (/** @type {unknown} */ (sheetView)).getBounds();
          if (img && b.width && b.height) layers.push({ b64: img.toPNG().toString('base64'), x: b.x, y: b.y, w: b.width, h: b.height });
        }
      } catch (err) {
        // DD7 layer degradation — see the find layer above.
        console.warn('[capture] dropping sheet overlay layer:', err && err.message);
      }
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
  } catch (err) {
    // F7 DD7 (AC10): a capture-timeout is a NAMED refusal and must reach the caller.
    // Left alone, this catch-all swallows it and the composite returns null, which
    // observe.captureWindow turns into the generic 'automation: chrome window
    // unavailable' — hiding the cause, i.e. exactly the silence DD7 exists to remove.
    // Re-throw it so captureWindow surfaces 'automation: capture-timeout — …'.
    // NOTE: this makes grabWindow REJECT where it previously only ever resolved-or-
    // null'd. Its sole consumer is observe.captureWindow, which awaits it, so the
    // rejection propagates to the tool adapter as isError — the intended DD7 outcome.
    if (err && /^automation: capture-timeout/.test(err.message || '')) throw err;
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
// Lazily-constructed, memoized vault-store instance for the automation surface's
// stateless read path (M12 F1 Leg 3). Constructed once (reads manager.json if
// present — no side effects otherwise), shares the app's jars registry + the
// vaultAutoLockMinutes setting. Only its stateless methods are used by the MCP
// vault context, so it never mutates human lock state.
let _vaultStore = null;
function getVaultStore() {
  if (_vaultStore === null) {
    _vaultStore = vaultStoreModule.load(app.getPath('userData'), {
      listJars: () => jars.list(),
      getAutoLockMinutes: () => settings.get('vaultAutoLockMinutes'),
    });
  }
  return _vaultStore;
}

async function startMcpServerInstance() {
  mcpServer = createMcpServer({
    // Engine accessor now takes an options bag so the per-session admin Server
    // can build an allowInternal engine (DD6 / Leg 2). createEngine forwards it.
    // isTabViewWcId (F8 DD8 defense-in-depth): non-tab, non-chrome wcIds (e.g. the
    // menu-overlay sheet, the find overlay) resolve only at the admin tier.
    getEngine: (engineOpts) => createEngine(getChromeContents, {
      ...engineOpts,
      getDownloads: () => downloadsManager.listAll(),
      grabWindow,
      // F7 DD1/DD2: the all-windows census seam + the discovery primitive. Kept in
      // parity with the dev-seam engine below — a forgotten injection SILENTLY
      // restores single-window enumerateTabs with no test failure anywhere (the
      // house "Absent → no behavior change" idiom), which is why AC12 greps for 2.
      listWindows,
      enumerateWindows,
      // DD8 widening (F6 Leg 2): ALL-WINDOWS tab membership + the any-registered-
      // chrome predicate (classify/jar-guard widening — a second window's chrome
      // must classify 'chrome', not 'guest').
      isTabViewWcId: (id) => registry.isTabViewWcId(id),
      isChromeContents: (wc) => registry.isChromeContents(wc),
      // F7 DD6 (recon S1): owner routing + the window raise for activateTab. Without
      // BOTH, activateTab silently falls back to the pre-F7 last-focused dispatch —
      // a forgotten injection restores S1 with NO test failure anywhere, which is why
      // the leg grep-pins both live sites.
      chromeForTab,
      raiseWindowForTab,
      // History read accessors (Mission 08 Flight 5): threaded the same way as
      // getDownloads above, backing the getHistory op (jar-confined via scope.js).
      getHistoryReads: { listRecent: (id, o) => historyStore.listRecent(id, o), search: (id, q, o) => historyStore.search(id, q, o) },
      isKnownJar: (id) => jars.list().some((j) => j.id === id),
    }),
    // Jar-scoping context (Leg 2). fromId / fromPartition are the SAME handles
    // the engine uses (webContents.fromId / session.fromPartition) so the
    // façade's membership compare and the engine's op resolve cannot diverge.
    scopeCtx: {
      jars,
      fromId: (id) => webContents.fromId(id),
      fromPartition: (partition) => session.fromPartition(partition),
      getChromeContents,
      // Jar-tier chrome-exclusion widening (DD8 / review L5): any registered
      // chrome is refused for jar identities, not just the accessor's chrome.
      isChromeContents: (wc) => registry.isChromeContents(wc),
    },
    // Audit fan-out (Flight 4, Leg 3, DD8): every recorded tool call and every
    // session open/close broadcasts the new audit snapshot over the M02 channel.
    broadcast: (payload) => broadcastToChromeAndInternal('automation-activity-changed', payload),
    // Password-vault surface (Mission 12, Flight 1, Leg 3). The per-session MCP
    // vault context reaches the vault store's STATELESS methods only (no singleton
    // coupling).
    vaultStore: getVaultStore(),
    // The REAL main→preload fill delegate (Leg 4). vault-context.fill resolves +
    // membership/origin-checks the credential, then hands us `{ wcId, credential }`;
    // we deliver it to the target tab's TOP-FRAME preload over the 'vault-fill'
    // channel. webContents.send targets the main frame only, so a cross-origin
    // iframe is never reached. The credential is NEVER returned across the MCP
    // boundary (vault-context.fill returns `{ filled, id }` only). A tab closed
    // mid-fill → fromId() is null → the optional-chain no-ops safely.
    fillDelegate: ({ wcId, credential }) => {
      webContents.fromId(wcId)?.send('vault-fill', credential);
    },
    getAutoLockMinutes: () => settings.get('vaultAutoLockMinutes'),
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
  // Class 3 (DD2): the zoomed tab's OWNING window's chrome, resolved at event time.
  chromeForTab(wc.id)?.send('zoom-changed', { wcId: wc.id, factor: next });
}

// Electron construction is confined to this dependency map; window-factory.js itself
// remains Electron-free and its close/closed lifecycle runs under strict fake windows.
const { createWindow } = createWindowFactory({
  BaseWindow,
  WebContentsView,
  platform: process.platform,
  argv: process.argv,
  isPackaged: app.isPackaged,
  paths: {
    icon: path.join(__dirname, '..', '..', 'build', 'icon.png'),
    chromePreload: path.join(__dirname, '..', 'preload', 'chrome-preload.js'),
    chromeHtml: path.join(__dirname, '..', 'renderer', 'index.html'),
    findPreload: path.join(__dirname, '..', 'preload', 'find-overlay-preload.js'),
    findHtml: path.join(__dirname, '..', 'renderer', 'find-overlay.html'),
    menuPreload: path.join(__dirname, '..', 'preload', 'menu-overlay-preload.js'),
    menuHtml: path.join(__dirname, '..', 'renderer', 'menu-overlay.html'),
    tearoffHtml: path.join(__dirname, '..', 'renderer', 'tearoff-overlay.html')
  },
  registry,
  isAutomationEnabled: isMcpAutomationEnabled,
  broadcastMoveTargetsChanged,
  createFindOverlayManager,
  createMenuOverlayManager,
  createTearoffOverlayManager,
  computeFindOverlayBounds,
  getTabContents,
  chromeForAttachment,
  sheetAcceleratorAction,
  isInternalContents,
  isGuestActionAllowed,
  toggleDevTools,
  applyZoom,
  captureWindowCloseEntries,
  jars,
  closedTabStack,
  broadcastClosedTabStackChanged,
  settings,
  isSessionQuitting: () => sessionQuitting,
  sessionStore,
  buildSessionSnapshot,
  getHistoryRecorder: () => historyRecorder,
  defer: setImmediate,
  logger: console
});

// Guest event wiring is pure composition: the extracted module sees only injected
// owner lookups, decisions, and side effects. Both entry points read live state.
const { wireGuestContents, wireTabViewEvents } = createGuestWiring({
  registry,
  chromeForTab,
  crossViewNavAction,
  keydownToAction,
  isChromeActionForwardable,
  isRepeatSafeAction,
  isInternalPageUrl,
  isSafeTabUrl,
  toggleDevTools,
  applyZoom,
  isInternalContents,
  getHistoryRecorder: () => historyRecorder,
  broadcastMoveTargetsChanged,
  logger: console
});

// ---------------------------------------------------------------------------
// Downloads. The renderer asks us to download a media URL using the *page's*
// own session (so cookies / referer / auth are preserved). We resolve the
// originating webview by its webContents id.
// ---------------------------------------------------------------------------
// App-level downloads model (Flight 5, Leg 1 / DD3). MODULE-SCOPED — not a whenReady
// local — because wireDownloadHandler is also invoked from the synchronous
// session-created hook for web jars created before whenReady, so its closure must
// reference a manager that is already assigned. Instantiated once at store-load time
// (the initProfileAndStores call site below). A will-download cannot realistically
// fire before a window exists, but module-scoping removes the undefined-manager hazard.
/** @type {ReturnType<typeof createManager> | null} */
let downloadsManager = null;

const { wireDownloadHandler } = registerDownloadIpc({
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
  getDownloadsPath: () => app.getPath('downloads'),
  getDownloadsManager: () => downloadsManager,
  buildRegisterRecord,
  buildProgressPayload,
  buildDonePayload,
  broadcast: broadcastToChromeAndInternal,
  registerInternalHandler,
  getChromeContents,
  now: () => Date.now(),
  logger: console
});

// Settings read channel. INTENTIONALLY NOT behind the internal-sender guard — trust domain
// is the file:// chrome (window.goldfinch surface in chrome-preload.js), same as shields-get.
// Web webviews have no ipcRenderer.invoke, so only the chrome + internal guest can reach IPC.
// Settings, Shields, automation preferences, and clipboard IPC register after
// sessionRuntime construction so the live spellcheck applier is available.

// Shields config IPC. INTENTIONALLY NOT behind the internal-sender guard — their trust
// domain is the file:// chrome (window.goldfinch surface in chrome-preload.js), not the
// goldfinch:// internal session. Do not "close" these channels with registerInternalHandler.

// Internal-session-only settings IPC. These channels are guarded by registerInternalHandler:
// the wrapper verifies that event.senderFrame.origin === 'goldfinch://settings' AND the
// sender's session carries __goldfinchInternal === true before forwarding to the handler.
// A non-trusted sender gets a rejected invoke (the throw propagates as a promise rejection).
// Automation bind-status surface (Flight 5 / DD1). The shape is shared with
// set-port via currentAutomationStatus() (Leg 7) — `port` reflects the bound port
// when the surface is active, else the would-be resolved port; host is hard-pinned
// to loopback (SC7 — never configurable).
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
// Advisory free-port scan over the loopback dynamic range for the Settings UI's
// "find a free port" affordance (leg 2). Returns { port: null } if none free.

// Clipboard write fallback (Flight 5, Leg 2 — DD4). navigator.clipboard is the
// primary path in the secure goldfinch://settings page, but it can be blocked at
// runtime under contextIsolation + sandbox; this origin-checked IPC gives the
// settings copy buttons a reliable fallback. First copy consumer is leg 2's MCP
// address; leg 3's key copy reuses the shared copyText() helper that calls this.

// Automation key management (Flight 5, Leg 3 / SC9). All origin-checked
// (registerInternalHandler) — the secure goldfinch://settings page is the only
// allowed sender. Mint returns the show-once plaintext (the ONLY way plaintext
// leaves main — never persisted, never logged); list/revoke deal in hashes only.
// `list-keys` is the single source for the admin env gate (AC2 — get-status does
// NOT report it). Generate and rotate are the same mint op (DD5); the UI labels
// the button per hasKey/adminKeySet.
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

const { rerollSeed } = registerBrowserIpc({
  ipcMain,
  webContents,
  chromeForTab,
  getTabContents,
  applyZoom,
  isInternalContents,
  toggleDevTools,
  registerInternalHandler,
  jars,
  registry,
  createWindow,
  broadcastJarsChanged: () => broadcastJarsChanged(),
  isSafeTabUrl,
  getChromeContents,
  session,
  registrableDomain,
  hostnameOf,
  shields,
  random: Math.random,
  logger: console
});

// --- window controls (custom frameless min/max/close, win+linux) ---
// Class 1 (F6 DD2/DD3): each control resolves the SENDER's window — window 2's
// controls must never minimize/close window 1.
// DD6: close() → 'closed' → 'window-all-closed' → app.quit() (non-darwin); NOT app.quit() directly.

// New Window command (M09 F6 Leg 4, DD5): kebab item + Ctrl/Cmd+N, both through
// the one-classifier path → dispatchChromeAction('new-window') → this invoke.
// Chrome-trust domain, sender-gated by registry membership (the tab-create
// discipline). The window boots its home tab exactly like first launch (no
// noBootTab), and registry.create seeds last-focused — so the DD8 automation
// accessor deterministically retargets to the new window (WSLg-safe).

// Boot-config invoke (DD5 / review L4 transport + review H1 barrier). Joins the
// chrome renderer's boot-gating Promise.all: returns { bootTab } (false only for
// move-created windows — the registry record's create-chain flag). Serving this
// invoke IS the H1 readiness proof: the chrome document's module evaluation has
// completed (the invoke is issued from module tail code, and the
// onAdoptTab/onTabMovedAway registrations sit ABOVE the boot gate), so the
// queued adopt-protocol sends flush here — a send any earlier would hit a
// pre-boot document and be silently dropped with no retry.

// Kebab-menu Exit (mission SC4): quit on ALL platforms. Distinct from `window-close`
// (the window button), whose `window-all-closed` path does not quit on macOS (main.js:536-537).

// OS-clipboard string write for the page context menu's Copy link / Copy image address /
// Copy selection (Leg 4). Chrome-trusted one-way send — same trust domain as window-minimize/
// app-quit (no origin-check needed). Distinct from the internal-origin-gated `clipboard:write`
// (settings page only): the chrome renderer cannot reach that one, and navigator.clipboard is
// unreliable from a file:// doc right after a guest context-menu steals focus. Writes a STRING
// only (coerced) — not a guest mutation, no general-write concern.

// New container creation: renderer collected the name (via inline input) and sends it here.
// We create the jar and return it; the renderer calls createTab directly with the container object.

// Tab lifecycle and move IPC are registered as one ownership domain.
registerTabIpc({
  ipcMain,
  WebContentsView,
  internalPreloadPath: path.join(__dirname, '..', 'preload', 'internal-preload.js'),
  webPreloadPath: path.join(__dirname, '..', 'preload', 'webview-preload.js'),
  INTERNAL_PARTITION,
  registry,
  wireGuestContents,
  wireTabViewEvents,
  captureClosedTabEntry,
  jars,
  APPEND_SENTINEL,
  closedTabStack,
  broadcastClosedTabStackChanged,
  getHistoryRecorder: () => historyRecorder,
  isSafeTabUrl,
  reopenStripIndex,
  webContents,
  isInternalContents,
  buildMoveTargets,
  createWindow,
  validateMoveTabPayload,
  buildAdoptPayload,
  broadcastMoveTargetsChanged,
  getTabContents,
  schedule: setTimeout,
  cancelScheduled: clearTimeout,
  logger: console
});

registerOverlayIpc({
  ipcMain,
  registry,
  chromeForAttachment,
  chromeForTab,
  sanitizeActivatedValue
});

// Guest media-list / privacy-fp forwarding from webview-preload to chrome renderer.
// Web <WebContentsView> tabs send via ipcRenderer.send (not sendToHost).
// Class 3 (F6 DD2 / review F1): the SENDER guest's OWNING window's chrome, resolved
// at event time — leg 4's adopt lost-state ruling (media list + privacy aggregate
// repopulate in the TARGET window after a move) depends on this owner routing.

// rescan-media for WebContentsView tabs (push from chrome → tab wc).

// Renderer fallback zoom path (chrome-focused case). The renderer already filters
// internal tabs; we guard again here (defense in depth) before applying.

// Query the guest's ACTUAL current engine zoom (DD1 stale-cache fix). Chromium's
// per-origin host-zoom map re-zooms ALL same-origin tabs in a jar when ANY one is
// zoomed, but only the active tab emits zoom-changed — so a cached factor goes stale
// for non-active same-origin tabs. The renderer queries this on demand (tab switch,
// load, zoom change) instead of reading the cache, so the address-bar label always
// reflects the live factor. Distinct from the automation `getZoom` MCP tool (a
// different layer); this CHROME-IPC channel is named `get-zoom`. Returns null for a
// dead/missing/internal target (renderer falls back to 1.0 / hides the control).

// Renderer kebab Print… path (SC2). The renderer already filters internal tabs;
// we guard again here (defense in depth) before printing. The print() callback
// surfaces WSLg no-printer failures instead of swallowing them.

// DevTools human path (Flight-3 DD1). Two-way invoke (over zoom's one-way send) because the
// renderer button reflects the AUTHORITATIVE open/closed state. Acts on the PASSED webContentsId,
// NEVER re-resolving via activeTab() — the active tab can change mid-round-trip, and the user
// targeted the tab whose wcId the renderer captured at call time (TOCTOU guard, DD1). Guards a
// dead/missing target (return false, no throw) and refuses an internal-session target via the
// SHARED isInternalContents predicate (DD5 — never DevTools on goldfinch://). The actual
// open/close mechanics live in the shared toggleDevTools helper, also called by the M03 MCP ops.
// On-demand open-state read for the on-activation reconcile (DD3). Exposed for Leg 2's button.

// Spelling correction round-trip (DD2/DD6). chrome -> main -> guest. Acts on the PASSED
// webContentsId (never activeTab() — the active tab can change mid-round-trip; the user
// targeted the tab whose wcId the renderer captured at right-click time, TOCTOU guard).
// Refuses the internal session via the SHARED isInternalContents predicate (DD6 — never write
// into a goldfinch:// guest). NOT a general write primitive: it performs replaceMisspelling
// ONLY, a single narrowly-typed action gated on a non-empty string word. (Edit-action
// correction — cut/copy/paste/undo/redo — is Leg 4's to add with its own action-allowlist.)
// Dead/destroyed targets return safely; replaceMisspelling is itself a no-op outside an active
// misspelling/editing context, so the main side never throws.

// Page-context edit-action dispatch (Leg 4 — the cut/copy/paste/undo/redo Leg 1 deferred).
// Mirrors page-context-correct's trust discipline EXACTLY: acts on the PASSED webContentsId
// (never activeTab() — the user targeted the tab whose wcId the renderer captured at right-click
// time, TOCTOU guard), guards a dead/missing target, and refuses the internal session (DD6 —
// never drive edit methods on a goldfinch:// guest). NOT a general "run any method" primitive:
// `action` is restricted to a FIXED allowlist; anything else is ignored. A separate channel
// (rather than widening page-context-correct's narrow `word`-string contract) keeps each
// surface's audited trust contract self-evident. wc.paste() reads the OS clipboard into the
// guest — same as a native menu Paste, the user-invoked intended behavior, not a new exfil path.

// Unpin a toolbar item from the custom toolbar-mode context menu (Leg 5; replaces the retired
// native Electron popup-menu handler). Chrome-trusted one-way send — same trust domain as
// window-minimize/app-quit/chrome-clipboard-write (no origin check). NOT a general settings-write
// surface: item-allowlisted, writes only toolbarPins[item] = false. Same write+broadcast the native
// handler did, so applyToolbarPins' settings-changed reaction keeps the toolbar in sync live.

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
  broadcast: broadcastToChromeAndInternal,
  historyStore
});

// Retention sweep engine + its cookie first-seen bookkeeping store (M10
// Flight 2, Leg 3 / DD4 VERDICT, DD4b, DD6, DD7, DD10). ONE instance, used
// by BOTH the `session-created` cookies listener below (writes) and the
// `pruneAllJars` cadence (reads + sweeps) — both resolve against the same
// live `app.db` handle via app-db.js's module-singleton statements
// regardless of instance identity (the createCookieSeenStore()/
// createDocumentStore() precedent: methods read the CURRENT module-scope
// statements at call time, so it's safe to build this before appDb.open()
// has run — it isn't called until session-created/pruneAllJars fire, both
// well after whenReady's appDb.open()).
const cookieSeenStore = appDb.createCookieSeenStore();
const retentionSweep = createRetentionSweep({
  cookieSeen: cookieSeenStore,
  historyOrigins: (jarId, cutoffMs) => historyStore.expiredOriginsForJar(jarId, cutoffMs),
  sessionFor: (jar) => session.fromPartition(jar.partition),
  cookieUrl,
  now: () => Date.now()
});

// --- per-jar history IPC (M08 Flight 1 Leg 3 / DD9) ---
// The four history read/mutate channels live in history-ipc.js, twin-registered
// exactly like the jar-registry channels above. Registered at module scope
// (not inside whenReady, next to the leg-2 boot block) — handlers only touch
// historyStore at invoke time, always after boot, the same lazy-closure
// property that lets registerJarIpc run before jars.load().
registerHistoryIpc({
  ipcMain,
  historyStore,
  jars,
  broadcast: broadcastToChromeAndInternal
});

// H2 (M08 Flight 6 Leg 4, design review): history rows in the goldfinch://jars
// panel open a NEW TAB IN THE SAME JAR. Registered DIRECTLY here (not threaded
// through jar-ipc.js/history-ipc.js as a new dep) because it needs
// getChromeContents() (a main.js module-scoped closure, not injected anywhere)
// and isSafeTabUrl (already required above). Reuses the exact SAME
// open-tab -> chrome's onOpenTab -> inheritFromPartition path that popups and
// context-menu opens use (wireGuestContents's setWindowOpenHandler, above) —
// a jar's own partition resolves to that jar's own container for free.
// Validates the jar exists (jars.list().find) and isSafeTabUrl(url) main-side
// (defense-in-depth — the downstream createTab untrusted branch re-checks it
// too, the documented two-point boundary). Fail-closed static strings, no
// interpolation.

// New Identity: wipe a jar's cookies + storage and reroll its fingerprint seed,
// so the site can no longer link you to who you just were.

// Session-created and retention cadence behavior are dependency-injected; registration
// and interval ownership remain visible here until app lifecycle extraction (Task 9).
const sessionRuntime = createSessionRuntime({
  isCreatingInternalSession: () => creatingInternalSession,
  wireDownloadHandler,
  settings,
  partitionFromStoragePath,
  jars,
  appDb,
  cookieChangeAction,
  cookieSeenStore,
  now: () => Date.now(),
  retentionSweep,
  historyStore,
  broadcast: broadcastToChromeAndInternal,
  registrableDomain,
  hostnameOf,
  classify,
  shields,
  chromeForTab,
  schedule: setTimeout,
  logger: console
});
const { applySpellcheck, applyShields, pruneAllJars } = sessionRuntime;

registerSettingsIpc({
  ipcMain,
  registerInternalHandler,
  settings,
  shields,
  broadcast: broadcastToChromeAndInternal,
  applyAutomationEnabledChange,
  applySpellcheck,
  getDefaultSession: () => session.defaultSession,
  getAllWebContents: () => webContents.getAllWebContents(),
  currentAutomationStatus,
  rebindMcpServer,
  freePortInRange,
  clipboard,
  jars,
  mintJarKey,
  revokeJarKey,
  mintAdminKey,
  revokeAdminKey,
  getMcpServer: () => mcpServer,
  adminEnabled: () => process.env.GOLDFINCH_AUTOMATION_ADMIN
});

registerAppLifecycle({
  app,
  ipcMain,
  sessionRuntime,
  initProfileAndStores,
  profileStores: { appDb, shields, settings, jars, downloads },
  historyStore,
  sessionStore,
  getUserDataPath: () => app.getPath('userData'),
  createHistoryRecorder,
  setHistoryRecorder: (recorder) => { historyRecorder = recorder; },
  listJars: () => jars.list(),
  broadcast: broadcastToChromeAndInternal,
  pruneAllJars,
  scheduleInterval: setInterval,
  createDownloadsManager: createManager,
  downloadsStore: downloads,
  setDownloadsManager: (manager) => { downloadsManager = manager; },
  getDownloadsManager: () => downloadsManager,
  wireDownloadHandler,
  applyShields,
  applySpellcheck,
  settings,
  getDefaultSession: () => session.defaultSession,
  fromPartition: (partition) => session.fromPartition(partition),
  internalPartition: INTERNAL_PARTITION,
  setCreatingInternalSession: (value) => { creatingInternalSession = value; },
  handleInternal,
  createWindow,
  registry,
  isMcpAutomationEnabled,
  shouldBindAutomation,
  shouldAutoMint,
  setDevEnableOverride: (value) => { devEnableOverride = value; },
  startMcpServerInstance,
  createEngine,
  getChromeContents,
  grabWindow,
  listWindows,
  enumerateWindows,
  chromeForTab,
  raiseWindowForTab,
  isKnownJar: (id) => jars.list().some((jar) => jar.id === id),
  resolveAutoMintTarget,
  mintJarKey,
  mintAdminKey,
  getMcpServer: () => mcpServer,
  setSessionQuitting: (value) => { sessionQuitting = value; },
  buildSessionSnapshot,
  appDb,
  getAllWindows: () => BaseWindow.getAllWindows(),
  argv: process.argv,
  env: process.env,
  platform: process.platform,
  stdout: process.stdout,
  logger: console
});
