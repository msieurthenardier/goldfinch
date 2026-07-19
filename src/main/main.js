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

// --- Overlay sender-identity reverse lookups (F7 DD5) ---------------------------------
// Pre-F7 the sheet and find overlay were single global views, so a sender-identity check
// was a one-line compare against that view. Under per-window instances each window has
// its own view, and these IPC handlers are registered ONCE at module scope (they cannot
// close over a record) — so the sender must be reverse-looked-up to find which window's
// manager owns it. Same discipline as the registry's getWindowForChrome /
// getWindowForGuest (window-registry.js): identity compare, null when no match.
//
// A sender matching NO record is DROPPED, never re-routed to another window's manager —
// the established rule (see chromeForAttachment's gone-attachment drop below: cross-
// window token spaces collide). Both tolerate a null slot (nulled at `close`, AC8b) and
// a destroyed view on any record.

/**
 * The record whose SHEET view's webContents IS this sender. Null when no match.
 * @param {any} sender
 */
function recordForSheetSender(sender) {
  if (!sender) return null;
  for (const rec of registry.records()) {
    const v = rec.sheet ? rec.sheet.getView() : null;
    if (v && !v.webContents.isDestroyed() && v.webContents === sender) return rec;
  }
  return null;
}

/**
 * The record whose FIND-OVERLAY view's webContents IS this sender. Null when no match.
 * @param {any} sender
 */
function recordForFindSender(sender) {
  if (!sender) return null;
  for (const rec of registry.records()) {
    const v = rec.findOverlay ? rec.findOverlay.getView() : null;
    if (v && !v.webContents.isDestroyed() && v.webContents === sender) return rec;
  }
  return null;
}

// --- Menu-overlay DD4 IPC (channels 1/2/4/5). Chrome-class trust domain, but every
// handler validates event.sender by IDENTITY (DD8, F7 pattern): chrome contents for
// open/close; the sheet's own webContents for activated/dismissed. Payload-declared
// identity is never trusted. Channels 3/6/7 are .send()s (manager → sheet/chrome). ---

// Channel 1 — chrome → main: open (or model-replace) a menu on the sheet.
// Sender identity check widened to registry membership (F6 Leg 2): ANY registered
// window's chrome may open — with one window this is the same identity compare.
// F7 DD5: the open drives the SENDER window's OWN sheet manager (rec.sheet). The
// attachment the manager records is therefore always this same window — the machinery
// goes inert but stays (menu-overlay-manager.js is byte-unchanged this leg; retiring
// its now-unread attachment accessor inherits to leg 3).
// Null-tolerant (AC8b): the slot is nulled at `close`, so an IPC arriving in the
// close→closed gap resolves a live record with a null manager and no-ops here rather
// than reconstructing a view onto the dying window.
ipcMain.on('menu-overlay:open', (event, payload) => {
  const rec = registry.getWindowForChrome(event.sender);
  if (!rec || !rec.sheet) return;
  const activeEntry = rec.activeTabWcId != null ? rec.tabViews.get(rec.activeTabWcId) : null;
  const bounds = activeEntry && !activeEntry.view.webContents.isDestroyed()
    ? activeEntry.view.getBounds()
    : null;
  rec.sheet.openMenu(payload, { contentView: rec.win.contentView, win: rec.win, bounds });
});

// Channel 2 — chrome → main: programmatic close. `reason` is allowlisted
// (mirrors SHEET_DISMISS_REASONS' style below) — 'toggle' (trigger re-click
// close), 'superseded' (mutual exclusion / other programmatic close; the
// fallback for anything unrecognized), plus the omnibox-suggestions close
// triggers added this flight (DD5 amendment): 'escape', 'blur', 'navigation',
// 'input-empty', 'activated'.
const MENU_CLOSE_REASONS = new Set([
  'toggle', 'superseded', 'escape', 'blur', 'navigation', 'input-empty', 'activated'
]);
ipcMain.on('menu-overlay:close', (event, payload) => {
  const rec = registry.getWindowForChrome(event.sender);
  if (!rec || !rec.sheet) return;
  const r = payload && payload.reason;
  rec.sheet.closeMenuOverlay(MENU_CLOSE_REASONS.has(r) ? r : 'superseded');
});

// Channel 4 — sheet → main: item activated. Stale tokens dropped; channel 7 (from
// the close) is emitted BEFORE channel 6, so chrome resets trigger state first and
// the action wins any focus race (round-2 design lock). Leg 3: the payload may
// carry an optional `value` string (the input-dialog's text) — shape-validated by
// the pure sanitizeActivatedValue helper (string, ≤24; anything else DROPPED — the
// payload is still forwarded, just without `value`).
ipcMain.on('menu-overlay:activated', (event, payload) => {
  // F7 DD5: reverse-look-up the SHEET-sender's record — that record IS the menu's
  // owner, so channel 6 lands in its own chrome (no attachment capture needed; the
  // window is fixed for a per-window sheet, where the pre-F7 code had to capture the
  // attachment before the close cleared it).
  const rec = recordForSheetSender(event.sender);
  if (!rec || !rec.sheet) return;
  const { id, token, value } = payload || {};
  if (typeof id !== 'string' || typeof token !== 'number') return;
  const cur = rec.sheet.getCurrentMenu();
  if (!cur || token !== cur.token) return; // stale sheet report
  rec.sheet.closeMenuOverlay('activated', token);
  /** @type {{ menuType: string, id: string, value?: string }} */
  const out = { menuType: cur.menuType, id };
  const v = sanitizeActivatedValue(value);
  if (v !== undefined) out.value = v;
  chromeForAttachment(rec.win)?.send('menu-overlay-activated', out);
});

// Channel 5 — sheet → main: dismissed. `reason` allowlisted to the page-attributable
// flavors; anything else is treated as the page's default flavor ('blur'). Stale
// tokens are dropped inside closeMenuOverlay.
const SHEET_DISMISS_REASONS = new Set(['escape', 'outside-click', 'blur']);
ipcMain.on('menu-overlay:dismissed', (event, payload) => {
  const rec = recordForSheetSender(event.sender);
  if (!rec || !rec.sheet) return;
  const { reason, token } = payload || {};
  if (typeof token !== 'number') return;
  rec.sheet.closeMenuOverlay(SHEET_DISMISS_REASONS.has(reason) ? reason : 'blur', token);
});


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

ipcMain.handle('download-media', async (event, { webContentsId, url, suggestedName, saveDir }) => {
  const wc = typeof webContentsId === 'number' ? webContents.fromId(webContentsId) : null;
  // Class 1 (F6 DD2): the fallback chain resolves the SENDER's window record —
  // its active tab, then its chrome (accessor-rule fallback for a non-chrome sender).
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

ipcMain.handle('choose-download-dir', async (event) => {
  // Class 1 (F6 DD2): parent the dialog to the SENDER's window (accessor-rule
  // fallback keeps a parent when the sender is somehow recordless).
  const rec = registry.getWindowForChrome(event.sender) || registry.getLastFocused();
  const dialogOpts = /** @type {Electron.OpenDialogOptions} */ ({
    title: 'Choose a folder to download all media into',
    properties: ['openDirectory', 'createDirectory']
  });
  const res = rec
    ? await dialog.showOpenDialog(/** @type {Electron.BaseWindow} */ (rec.win), dialogOpts)
    : await dialog.showOpenDialog(dialogOpts);
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

// Settings read channel. INTENTIONALLY NOT behind the internal-sender guard — trust domain
// is the file:// chrome (window.goldfinch surface in chrome-preload.js), same as shields-get.
// Web webviews have no ipcRenderer.invoke, so only the chrome + internal guest can reach IPC.
ipcMain.handle('settings-get', (_e, key) => key ? settings.get(key) : settings.getAll());

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
// Class 1 (F6 DD2/DD3): each control resolves the SENDER's window — window 2's
// controls must never minimize/close window 1.
ipcMain.on('window-minimize', (event) => {
  registry.getWindowForChrome(event.sender)?.win.minimize();
});
ipcMain.on('window-toggle-maximize', (event) => {
  const rec = registry.getWindowForChrome(event.sender);
  if (!rec) return;
  if (rec.win.isMaximized()) rec.win.unmaximize();
  else rec.win.maximize();
});
// DD6: close() → 'closed' → 'window-all-closed' → app.quit() (non-darwin); NOT app.quit() directly.
ipcMain.on('window-close', (event) => {
  registry.getWindowForChrome(event.sender)?.win.close();
});
ipcMain.handle('window-is-maximized', (event) => {
  const rec = registry.getWindowForChrome(event.sender);
  return !!(rec && rec.win.isMaximized());
});

// New Window command (M09 F6 Leg 4, DD5): kebab item + Ctrl/Cmd+N, both through
// the one-classifier path → dispatchChromeAction('new-window') → this invoke.
// Chrome-trust domain, sender-gated by registry membership (the tab-create
// discipline). The window boots its home tab exactly like first launch (no
// noBootTab), and registry.create seeds last-focused — so the DD8 automation
// accessor deterministically retargets to the new window (WSLg-safe).
ipcMain.handle('window-create', (event) => {
  if (!registry.getWindowForChrome(event.sender)) return null;
  const rec = createWindow();
  return rec.win.id;
});

// Boot-config invoke (DD5 / review L4 transport + review H1 barrier). Joins the
// chrome renderer's boot-gating Promise.all: returns { bootTab } (false only for
// move-created windows — the registry record's create-chain flag). Serving this
// invoke IS the H1 readiness proof: the chrome document's module evaluation has
// completed (the invoke is issued from module tail code, and the
// onAdoptTab/onTabMovedAway registrations sit ABOVE the boot gate), so the
// queued adopt-protocol sends flush here — a send any earlier would hit a
// pre-boot document and be silently dropped with no retry.
ipcMain.handle('window-boot-config', (event) => {
  const rec = registry.getWindowForChrome(event.sender);
  if (!rec) return { bootTab: true };
  rec.bootConfigServed = true;
  const queued = rec.pendingChromeSends.splice(0);
  const cc = rec.chromeView.webContents;
  for (const buildMsg of queued) {
    if (cc.isDestroyed()) break;
    const [channel, payload] = buildMsg();
    cc.send(channel, payload);
  }
  // M09 Flight 9 / DD4 / AC4: a restored window carries its ordered saved tab list on
  // the record — serve it so the renderer boot loop creates each tab fresh (suppressing
  // the home boot tab). Otherwise the unchanged bootTab decision (default-off byte-identity).
  return rec.restoreTabs ? { bootTab: false, restoreTabs: rec.restoreTabs } : { bootTab: !rec.noBootTab };
});

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

// --- Find-overlay DD4 IPC (M05 Flight 7). Chrome-class trust domain, but every
// handler still validates event.sender — a guest page must never be able to open or
// drive the overlay. Open/close route through the shared session functions above. ------

// Sender: a chrome webContents ONLY (the renderer's openFind / activateTab restore).
// Identity check widened to registry membership (F6 Leg 2) — any window's chrome.
ipcMain.on('find-overlay:open', (event, payload) => {
  if (!registry.getWindowForChrome(event.sender)) return;
  const { wcId, findText } = payload || {};
  // F7 DD5: owner-resolved — the session opens on the manager of the window that OWNS
  // the target tab (the pre-F7 shared entry did the same owner resolve internally).
  // Null-tolerant (AC8b): a target in a dying window no-ops rather than reconstructing.
  registry.getWindowForGuest(wcId)?.findOverlay?.openSession(wcId, typeof findText === 'string' ? findText : '');
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
  // F7 DD5: the overlay sender is reverse-looked-up (each window has its own view);
  // a chrome sender closes ITS OWN window's session.
  const fromRec = recordForFindSender(event.sender);
  const fromOverlay = fromRec != null;
  const rec = fromRec || registry.getWindowForChrome(event.sender);
  if (!rec || !rec.findOverlay) return;
  // Notify BEFORE closing — closeSession nulls the session wcId.
  // Class 3 (F6 DD2): the session tab's OWNING window's chrome gets the close.
  const sessionWcId = rec.findOverlay.getSessionTabWcId();
  if (fromOverlay && sessionWcId != null) {
    chromeForTab(sessionWcId)?.send('find-overlay-closed', { wcId: sessionWcId });
  }
  rec.findOverlay.closeSession({ refocusGuest: fromOverlay });
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
  // F7 DD5: reverse-look-up the FIND-sender's record; the session-state half (the
  // HAT-1 flag mapping above included) lives in that window's manager.
  const rec = recordForFindSender(event.sender);
  if (!rec || !rec.findOverlay) return;
  rec.findOverlay.query(payload || {});
});

// --- Tear-off pill overlay IPC (M09 F10 Leg L4-rebuild). Chrome-origin, fire-and-forget:
// the renderer drives show/move/hide as a tear-off drag arms, follows the cursor, and
// ends. The sender's own window is resolved (getWindowForChrome); a guest page has no
// tearoffOverlay path to reach. Coordinates are 1:1 DIP (e.clientX/Y → pill setBounds). --
ipcMain.on('tearoff-overlay:show', (event, { x, y } = {}) => {
  registry.getWindowForChrome(event.sender)?.tearoffOverlay?.show(x, y);
});
ipcMain.on('tearoff-overlay:move', (event, { x, y } = {}) => {
  registry.getWindowForChrome(event.sender)?.tearoffOverlay?.setPosition(x, y);
});
ipcMain.on('tearoff-overlay:hide', (event) => {
  registry.getWindowForChrome(event.sender)?.tearoffOverlay?.hide();
});

// Guest media-list / privacy-fp forwarding from webview-preload to chrome renderer.
// Web <WebContentsView> tabs send via ipcRenderer.send (not sendToHost).
// Class 3 (F6 DD2 / review F1): the SENDER guest's OWNING window's chrome, resolved
// at event time — leg 4's adopt lost-state ruling (media list + privacy aggregate
// repopulate in the TARGET window after a move) depends on this owner routing.
ipcMain.on('guest-media-list', (event, mediaList) => {
  const wcId = event.sender.id;
  chromeForTab(wcId)?.send('tab-media-list', { wcId, mediaList });
});

ipcMain.on('guest-privacy-fp', (event, fpCounts) => {
  const wcId = event.sender.id;
  chromeForTab(wcId)?.send('tab-privacy-fp', { wcId, fpCounts });
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
registerInternalHandler(ipcMain, 'internal-open-tab-in-jar', (_e, p) => {
  if (p === null || typeof p !== 'object') {
    return { ok: false, error: 'open-tab-in-jar — malformed-payload' };
  }
  const entry = jars.list().find((j) => j.id === p.jarId);
  if (!entry) return { ok: false, error: 'open-tab-in-jar — unknown-jar' };
  if (typeof p.url !== 'string' || !isSafeTabUrl(p.url)) {
    return { ok: false, error: 'open-tab-in-jar — bad-args' };
  }
  getChromeContents()?.send('open-tab', { url: p.url, openerPartition: entry.partition });
  return { ok: true };
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
app.on('session-created', sessionRuntime.onSessionCreated);

app.whenReady().then(() => {
  // App database open (M10 Flight 1, Leg 2 / DD4, DD7, DD9): folded into the
  // reshaped initProfileAndStores below, immediately after its dev-profile
  // setPath redirect and before every store load (shields/settings/jars/
  // downloads all read/write through this handle). This replaces leg 1's
  // interim sibling call, which ran ahead of the redirect and so opened a dev
  // (unpackaged) launch's app.db in the pre-redirect userData dir — see
  // flight-log.md's Decisions section for the leg-1 nuance this resolves.
  initProfileAndStores(app, { appDb, shields, settings, jars, downloads });
  // History store: opened as a SIBLING call right after initProfileAndStores
  // returns — deliberately NOT by widening that function's unit-pinned 4-store
  // load(path) signature (test/unit/init-profile-order.test.js hardcodes it). The
  // dev-profile setPath redirect has already run by the time initProfileAndStores
  // returns, so userData is correct here for free (Architect-pinned, flight DD8 /
  // Technical Approach). historyRecorder is module-scoped so wireTabViewEvents'
  // closure (built per tab-create) can see it.
  historyStore.open(app.getPath('userData'));
  // Session store load (M09 Flight 9 / AC2), a SIBLING to historyStore.open above —
  // UNCONDITIONAL, deliberately NOT gated on the restoreSession setting. session-store
  // .write() now resolves its row through the already-open app-db singleton (M10 Flight 1
  // / DD4/DD7) rather than a load()-set dir — the failure mode if load() were skipped
  // shifts from "throws without a dir" to "doc store unresolved", same uncaught-throw-
  // wedges-quit hazard (the F6 hang class), so load() here remains load-bearing. When
  // restore is off the loaded snapshot sits INERT (never read()); for a user who never
  // enabled it, no session row/file exists so load()'s row read is genuinely empty. The
  // dev-profile setPath('userData') redirect has already run, so userData is correct
  // here (same discipline as history).
  sessionStore.load(app.getPath('userData'));
  historyRecorder = createHistoryRecorder({
    store: historyStore,
    listJars: () => jars.list(),
    broadcast: broadcastToChromeAndInternal
  });
  // Prune once at open, then hourly — unref'd so the interval never holds the
  // process open on its own (mirrors no other long-lived interval in main.js
  // needing this, but the house pattern for background timers).
  pruneAllJars();
  setInterval(pruneAllJars, 60 * 60 * 1000).unref();
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

  // Session restore (M09 Flight 9 / DD4 / AC4), gated on the setting. read() returns
  // null unless restore is ON and a non-empty usable snapshot exists (leg 2 guarantees
  // it can never yield zero windows), so OFF falls through to today's EXACT single
  // createWindow() — the byte-identical default-off path. On restore, rebuild each saved
  // window with noBootTab (no home tab) and stash its ordered saved tab list on the
  // record (createWindow returns it); window-boot-config serves that list to the renderer,
  // which CREATES each tab FRESH (never adopt — there is no live source view at cold start).
  const restoreSnap = settings.get('restoreSession') === true ? sessionStore.read() : null;
  if (restoreSnap) {
    for (const w of restoreSnap.windows) {
      const rec = createWindow({ noBootTab: true });
      rec.restoreTabs = w.tabs;
    }
  } else {
    createWindow();
  }

  // In-memory dev-enable override (DD3/DD4). Computed ONCE here (after app.whenReady,
  // so app.isPackaged is settled), alongside the launch logic. It writes NOTHING to the
  // settings store — it satisfies the bind decision, the flip-OFF guard, and the auth
  // gate in dev while the persisted `automationEnabled` stays false (human-only invariant).
  // `!app.isPackaged` makes `--automation-dev` a complete no-op in a packaged build (DD4).
  devEnableOverride = !app.isPackaged && isMcpAutomationEnabled(process.argv);

  // Dev-only automation seam (DD7 — interim; folded into the gated transport at Flight 3).
  // Registered ONCE at startup, after createWindow() so a window record exists.
  // Never registered in production: gated on the dev flag AND !app.isPackaged (DD4).
  // The sender check (registry chrome membership) isolates the seam to the chrome
  // renderers — a guest webview has its own webContents and cannot pass this check.
  // No webContents.debugger anywhere (DD8).
  if (isMcpAutomationEnabled(process.argv) && !app.isPackaged) {
    // isTabViewWcId (F8 DD8): same hardening as the MCP engine accessor above — the
    // dev seam is not admin-tier, so chrome-class overlay wcIds must refuse here too.
    const engine = createEngine(getChromeContents, {
      getDownloads: () => downloadsManager.listAll(),
      grabWindow,
      // F7 DD1/DD2 — the SECOND injection site, kept in parity with the MCP engine
      // accessor above (AC12 greps for 2 on each of the three).
      listWindows,
      enumerateWindows,
      // DD8 widening (review F3 — the SECOND injection site, kept in parity with
      // the MCP engine accessor above): all-windows membership + any-chrome.
      isTabViewWcId: (id) => registry.isTabViewWcId(id),
      isChromeContents: (wc) => registry.isChromeContents(wc),
      // F7 DD6: owner routing + window raise — the SECOND injection site, kept in
      // parity with the MCP engine accessor above (the leg's AC6 greps for 2 on each).
      chromeForTab,
      raiseWindowForTab,
      // History read accessors (Mission 08 Flight 5): same injection as the MCP
      // getEngine accessor above, kept in parity for this dev-only seam.
      getHistoryReads: { listRecent: (id, o) => historyStore.listRecent(id, o), search: (id, q, o) => historyStore.search(id, q, o) },
      isKnownJar: (id) => jars.list().some((j) => j.id === id),
    });
    ipcMain.handle('automation:dev-invoke', async (event, { op, args } = {}) => {
      // event.sender identity is sufficient here (unlike internal-ipc's senderFrame.origin
      // check): this handler is NEVER registered in production (dev-gated), and a guest
      // webview is never a registered chrome, so the membership check fully isolates it.
      // Widened to registry membership (F6 Leg 2 / review F3): any window's chrome.
      if (!registry.getWindowForChrome(event.sender)) {
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
  // NO overlay role here (F7 DD5): overlays are per-window instances destroyed by
  // their own window's `close` handler — the sole destruction site. app.quit() closes
  // every window, so every window destroys its own; a registry-iterating teardown here
  // would run FIRST and double-destroy. The F8 DD5 find-before-sheet ordering pin
  // traveled to that `close` handler with the code.
  // Session-restore snapshot write (M09 Flight 9 / DD3), the FIRST-quit-event capture on
  // the menu-Exit / Cmd+Q path (before-quit fires first, full registry alive). Set the
  // coordination flag FIRST so every subsequent per-window `close` write is suppressed and
  // cannot shrink this authoritative full-set snapshot. Setting-gated AND non-empty-guarded
  // (an empty registry writes nothing — the close-last-window path leaves this a no-op and
  // lets `close` own that write). Whole block try/catch: session-store.write() propagates
  // fs errors by design, and an UNCAUGHT throw in before-quit wedges the quit (the F6 hang
  // class) — log-and-continue instead.
  sessionQuitting = true;
  try {
    if (settings.get('restoreSession') === true && registry.records().length) {
      sessionStore.write(buildSessionSnapshot({ windows: registry.records(), jarsList: jars.list() }));
    }
  } catch (err) {
    console.error('[session-store] before-quit snapshot write failed:', err);
  }
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

// History store close (M08 Flight 1 / DD2) — a NEW, deliberately LATER lifecycle
// seam than before-quit's teardown: will-quit fires after windows are torn down,
// guaranteeing no in-flight navigation can still be writing when the store closes
// (Architect review). close() checkpoints the WAL file.
app.on('will-quit', () => {
  try {
    historyStore.close();
  } catch {
    // best-effort — quit must not hang or crash on a close failure
  }
  // App database close (M10 Flight 1, Leg 1 / DD2, DD7) — a sibling to
  // historyStore.close() above; order between the two DBs is immaterial,
  // both run after before-quit's writers. close() checkpoints the WAL file.
  try {
    appDb.close();
  } catch {
    // best-effort — quit must not hang or crash on a close failure
  }
});
