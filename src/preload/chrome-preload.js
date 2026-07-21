'use strict';

// Preload for the browser UI (the renderer that draws toolbar, tabs, media panel).
// Exposes a minimal, audited surface to the renderer via contextBridge.

const { contextBridge, ipcRenderer } = require('electron');
const { INTERNAL_PARTITION } = require('../shared/internal-page');
const { isMcpAutomationEnabled } = require('../shared/automation-dev');

contextBridge.exposeInMainWorld('goldfinch', {
  // --- platform ---
  platform: process.platform,

  // --- window controls ---
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowToggleMaximize: () => ipcRenderer.send('window-toggle-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),
  appQuit: () => ipcRenderer.send('app-quit'),
  unpinToolbarItem: (item) => ipcRenderer.send('unpin-toolbar-item', item),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  onWindowMaximizedChange: (cb) => ipcRenderer.on('window-maximized-change', (_e, isMax) => cb(isMax)),
  // New Window command (M09 F6 Leg 4, DD5): kebab item + Ctrl/Cmd+N →
  // dispatchChromeAction('new-window') → this invoke. Resolves the new
  // BaseWindow id (unused by the renderer today — informational).
  windowCreate: () => ipcRenderer.invoke('window-create'),
  // Boot-config invoke (DD5/L4 + the H1 readiness barrier): joins the boot-gating
  // Promise.all; { bootTab: false } only for move-created windows. Serving it
  // main-side is what releases any queued adopt-tab/tab-nav-state pair.
  windowBootConfig: () => ipcRenderer.invoke('window-boot-config'),

  // --- downloads ---
  downloadMedia: (payload) => ipcRenderer.invoke('download-media', payload),
  chooseDownloadDir: () => ipcRenderer.invoke('choose-download-dir'),
  showItemInFolder: (savePath) => ipcRenderer.invoke('show-item-in-folder', savePath),

  // --- privacy ---
  onPrivacyNet: (cb) => ipcRenderer.on('privacy-net', (_e, data) => cb(data)),
  onPrivacyPermission: (cb) => ipcRenderer.on('privacy-permission', (_e, data) => cb(data)),
  privacyCookies: (payload) => ipcRenderer.invoke('privacy-cookies', payload),
  privacyClearCookies: (payload) => ipcRenderer.invoke('privacy-clear-cookies', payload),
  privacyClearStorage: (payload) => ipcRenderer.invoke('privacy-clear-storage', payload),

  // --- settings (chrome-trusted; read + subscribe only — writing is the settings page's job) ---
  settingsGet: (key) => ipcRenderer.invoke('settings-get', key),
  onSettingsChanged: (cb) => ipcRenderer.on('settings-changed', (_e, all) => cb(all)),

  // --- history (chrome-trusted; M08 Flight 4 Leg 1 — the omnibox's first history
  // bridge method, bare-handle like settingsGet above) ---
  historySuggest: (payload) => ipcRenderer.invoke('history-suggest', payload),

  // --- shields ---
  shieldsGet: () => ipcRenderer.invoke('shields-get'),
  shieldsSet: (patch) => ipcRenderer.invoke('shields-set', patch),
  shieldsPause: (payload) => ipcRenderer.invoke('shields-pause', payload),
  onShieldsChanged: (cb) => ipcRenderer.on('shields-changed', (_e, cfg) => cb(cfg)),

  // --- automation activity (chrome-trusted read + subscribe; SC10/DD6 toolbar indicator) ---
  // Bare read of the non-secret audit snapshot ({ sessions, log }); the raw on()
  // pattern matches onShieldsChanged. The matching automation:get-activity handler in
  // main.js is intentionally NOT origin-checked so this file:// surface can reach it.
  automationGetActivity: () => ipcRenderer.invoke('automation:get-activity'),
  onAutomationActivity: (cb) => ipcRenderer.on('automation-activity-changed', (_e, d) => cb(d)),

  // --- cookie jars / identities ---
  jarsList: () => ipcRenderer.invoke('jars-list'),
  jarsAdd: (payload) => ipcRenderer.invoke('jars-add', payload),
  jarsRename: (payload) => ipcRenderer.invoke('jars-rename', payload),
  jarsRemove: (payload) => ipcRenderer.invoke('jars-remove', payload),
  jarsSetDefault: (payload) => ipcRenderer.invoke('jars-set-default', payload),
  jarsGetDefault: () => ipcRenderer.invoke('jars-get-default'),
  // Retention-edit (M10 Flight 2, Leg 3 / behavior-spec finalization): the
  // ALREADY chrome-trusted `jars-set-retention` channel (M08 Flight 3, Leg
  // 1 / DD4) had no chrome-bridge wrapper before this leg — the goldfinch://
  // jars page's own retention `<select>` drives it via
  // window.goldfinchInternal.jarsSetRetention (internal-preload.js), which
  // an `evaluate` call cannot reach (internal-session evaluate is uniformly
  // refused — the apparatus fact this flight's behavior spec is built on).
  // This wrapper gives the behavior test's step 6 the SAME mechanism class
  // every prior act-path mutation already uses (a chrome-target `evaluate`
  // call against window.goldfinch), instead of the unproven alternative of
  // literally driving the internal page's `<select>` element.
  jarsSetRetention: (payload) => ipcRenderer.invoke('jars-set-retention', payload),
  // Fired by main after every jar mutation with { containers, defaultId }
  // (defaultId null ⇔ Burner). Renderer subscribes as of Flight 2 (DD2).
  onJarsChanged: (cb) => ipcRenderer.on('jars-changed', (_e, d) => cb(d)),
  identityNew: (payload) => ipcRenderer.invoke('identity-new', payload),
  // Per-jar data controls (Flight 4, Leg 1): granular class clears + full
  // identity wipe. Parity with the internal-preload.js jars wrappers, and the
  // behavior-test act path (DD9) drives these via chrome-target evaluate.
  jarsClearData: (payload) => ipcRenderer.invoke('jars-clear-data', payload),
  jarsWipe: (payload) => ipcRenderer.invoke('jars-wipe', payload),
  // Fired by main after jars-wipe succeeds, with { id } (Flight 4, Leg 3) — the
  // chrome renderer's cue to reload the jar's open web tabs (DD4). Same
  // one-liner shape as onJarsChanged; no off* — chrome preload has no
  // handle-based subscription cleanup.
  onJarWiped: (cb) => ipcRenderer.on('jar-wiped', (_e, d) => cb(d)),

  // --- page zoom ---
  zoomApply: ({ webContentsId, action }) => ipcRenderer.send('zoom-apply', { webContentsId, action }),
  onZoomChanged: (cb) => ipcRenderer.on('zoom-changed', (_e, d) => cb(d)),
  // Query the guest's live engine zoom factor (request/response). Authoritative source
  // for the address-bar label — distinct from the automation `getZoom` MCP tool.
  getZoom: ({ webContentsId }) => ipcRenderer.invoke('get-zoom', { webContentsId }),

  // --- native print (Save-as-PDF is a destination in the OS dialog) ---
  print: ({ webContentsId }) => ipcRenderer.send('print', { webContentsId }),

  // --- devtools (human path; the agent path is the MCP openDevTools/closeDevTools ops, DD1) ---
  // Two-way invoke (over zoom's one-way send) because the toolbar button (Leg 2) must reflect the
  // AUTHORITATIVE open/closed state: toggleDevtools resolves to the POST-toggle wc.isDevToolsOpened().
  // isDevtoolsOpen serves the on-activation reconcile (DD3) — exposed here, consumed by Leg 2.
  // The explicit webContentsId is captured at call time; main acts on THAT id, never activeTab() (TOCTOU).
  toggleDevtools: ({ webContentsId }) => ipcRenderer.invoke('toggle-devtools', { webContentsId }),
  isDevtoolsOpen: ({ webContentsId }) => ipcRenderer.invoke('is-devtools-open', { webContentsId }),
  // Fired by main's guest devtools-opened/devtools-closed listener (leg-1 spike POSITIVE — the events
  // fire on the guest webContents, which is the side we wire). Mirrors onZoomChanged; Leg 2
  // subscribes for live button updates. Payload { wcId, open }.
  onDevtoolsStateChanged: (cb) => ipcRenderer.on('devtools-state-changed', (_e, d) => cb(d)),

  // --- new container create (renderer collects name, main creates jar) ---
  // After "New container…": renderer collected the name via inline input; main creates the
  // jar and signals back 'chrome-new-tab-in-container'. Returns the new container object.
  newContainerCreate: (name) => ipcRenderer.invoke('new-container-create', { name }),

  // --- main → renderer: page context menu ---
  // Fired by main's guest context-menu listener with { wcId, params }. Renderer
  // builds the model and opens it on the menu-overlay sheet.
  onPageContextMenu: (cb) => ipcRenderer.on('page-context-menu', (_e, d) => cb(d)),

  // --- clipboard (renderer-side context-menu actions that need main-process clipboard) ---
  clipboardWriteText: (text) => ipcRenderer.invoke('chrome-clipboard-write', text),

  // --- spellcheck correction (renderer context menu "Fix" action) ---
  correctMisspelling: (word) => ipcRenderer.invoke('page-context-correct', word),

  // --- page context action (cut/copy/paste/undo/redo on the guest) ---
  pageContextAction: (action) => ipcRenderer.invoke('page-context-action', action),

  // FIX 1 belt-and-suspenders: main pushes this after maximize/unmaximize/resize so the
  // renderer immediately re-measures and re-sends the #webviews slot bounds to the active
  // guest, bypassing the rAF coalescing guard. Used only for geometry correction; the rAF
  // path remains the primary debounce for user-paced events (panel toggle, window drag).
  onTriggerSendBounds: (cb) => ipcRenderer.on('trigger-send-bounds', () => cb()),

  // --- main -> renderer events ---
  onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (_e, data) => cb(data)),
  onDownloadDone: (cb) => ipcRenderer.on('download-done', (_e, data) => cb(data)),
  // DD7 (M06 F3 Leg 4): payload is now `{ url, openerPartition }` — main resolves
  // the opener's partition from tabViews at popup time; the renderer resolves it
  // into a container decision via inheritFromPartition. Forward the object as-is.
  onOpenTab: (cb) => ipcRenderer.on('open-tab', (_e, payload) => cb(payload)),
  // Fired by main's before-input-event Ctrl+F capture (DD2/SC4). No payload —
  // the renderer resolves the active tab via activeTab(). Mirrors onOpenTab.
  onOpenFind: (cb) => ipcRenderer.on('open-find', () => cb()),
  // Fired by main's before-input-event Ctrl+J capture (DD2). No payload — the renderer
  // opens goldfinch://downloads via openDownloads(). Mirrors onOpenFind.
  onOpenDownloads: (cb) => ipcRenderer.on('open-downloads', () => cb()),

  // --- web tab lifecycle (Flight 3, Leg 1) ---
  tabCreate: (payload) => ipcRenderer.invoke('tab-create', payload),
  // stripIndex (M09 F4 Leg 1, optional/additive): the tab's visual position
  // at close time (from the renderer's orderedTabIds(), snapshotted BEFORE
  // DOM removal), carried so main can record it on a closed-tab-stack entry.
  tabClose: (wcId, stripIndex) => ipcRenderer.send('tab-close', wcId, stripIndex),
  // tabReopen (M09 F4 Leg 2, DD2 step 2): pops the closed-tab stack main-side and
  // returns the popped entry (or null on an empty stack, a silent renderer no-op) —
  // {url, title, partition?, stripIndex, navEntries, navIndex, jarFallback}.
  // `partition` is present iff the entry's original jar still exists; otherwise
  // omitted with `jarFallback: true` so the renderer knows to announce the fallback.
  tabReopen: () => ipcRenderer.invoke('tab-reopen'),
  // Tab context menu (M09 F5 Leg 1, DD3): snapshot a web tab's live navigation
  // history for Duplicate ({entries, index}, or null for internal/dead targets),
  // and read the closed-tab stack's size for the reopen-closed omission rule.
  tabHistorySnapshot: ({ webContentsId }) => ipcRenderer.invoke('tab-history-snapshot', { webContentsId }),
  closedTabStackSize: () => ipcRenderer.invoke('closed-tab-stack-size'),
  // DD6 push-cache (M09 F6 Leg 3): main pushes { size } on every closed-tab-stack
  // mutation; the chrome caches it so the tab-context opener is synchronous. The
  // closedTabStackSize invoke above remains as the cache's boot seed only.
  onClosedTabStackChanged: (cb) => ipcRenderer.on('closed-tab-stack-changed', (_e, d) => cb(d)),
  // Move to new window (M09 F6 Leg 4, DD5 / review H2): the invoke carries the
  // SOURCE renderer's strip snapshot — a burner's synthesized container and the
  // favicon exist only renderer-side; main shape-validates, re-parents the live
  // guest, and relays into adopt-tab (target) + tab-moved-away (source).
  tabMoveToNewWindow: (payload) => ipcRenderer.invoke('tab-move-to-new-window', payload),
  // Tear-off (M09 F8 Leg 3, DD5/DD16): the same move, requested by DRAG rather than by
  // menu, over the same payload — and NO coordinate rides it, because the renderer already
  // answered "did the pointer leave the strip?" against its own viewport. It differs from
  // tabMoveToNewWindow only in the RETURN: the menu ITEM can be omitted at build time when
  // a move is impossible, but a drag cannot be, so refusals come back DISCRIMINATED for the
  // renderer to announce instead of as the bare null the menu path ignores.
  tabTearOff: (payload) => ipcRenderer.invoke('tab-tear-off', payload),
  // Move to an EXISTING window (M09 F8 Leg 4, DD8) — the same payload as the two
  // paths above plus the destination's `windowId`. That id is a REQUEST, not a
  // claim: main re-resolves it through the registry and re-validates that the tab
  // belongs to THIS window, so the renderer cannot name a tab it does not own nor
  // a window that has since closed. Refusals come back discriminated (DD5).
  tabMoveToWindow: (payload) => ipcRenderer.invoke('tab-move-to-window', payload),
  // Cross-window drop adopt (M09 F11 Leg 3, DD1/DD2): the TARGET window's drop handler
  // invokes with the dragged identity payload. Main resolves the SOURCE from the
  // payload's wcId (the inversion of tabMoveToWindow above), gated on the source's
  // live tab-drag-started registration — refusals come back discriminated (DD5).
  tabAdoptByDrop: (payload) => ipcRenderer.invoke('tab-adopt-by-drop', payload),
  // DD2 provenance bookends: chrome-only dragstart/dragend declarations. Main verifies
  // the SENDER owns the wcId and registers it, so a guest-forged MIME payload dies at
  // the adopt gate ('not-dragging'); dragend clears on a main-side grace timer.
  tabDragStarted: (wcId) => ipcRenderer.send('tab-drag-started', wcId),
  tabDragEnded: (wcId) => ipcRenderer.send('tab-drag-ended', wcId),
  // DD8 push-cache, the closed-tab-stack mirror above: main pushes { targets } —
  // one { windowId, label } per OTHER window — whenever the window set, an active
  // tab, or an active tab's title changes. The chrome caches it so the tab-context
  // opener stays synchronous. moveTargets() is the cache's boot seed only.
  moveTargets: () => ipcRenderer.invoke('move-targets'),
  onMoveTargetsChanged: (cb) => ipcRenderer.on('move-targets-changed', (_e, d) => cb(d)),
  // adopt-tab (main → target chrome, queued behind the window-boot-config
  // barrier): strip insertion WITHOUT createTab — the webContents already lives.
  onAdoptTab: (cb) => ipcRenderer.on('adopt-tab', (_e, d) => cb(d)),
  // tab-moved-away (main → source chrome): strip removal WITHOUT destroy — the
  // closeTab mirror minus stack capture and the tabClose IPC.
  onTabMovedAway: (cb) => ipcRenderer.on('tab-moved-away', (_e, d) => cb(d)),
  tabHide: (wcId) => ipcRenderer.send('tab-hide', wcId),
  tabNavigate: (payload) => ipcRenderer.send('tab-navigate', payload),
  tabSetActive: (wcId, bounds) => ipcRenderer.send('tab-set-active', { wcId, bounds }),
  tabSetBounds: (wcId, bounds) => ipcRenderer.send('tab-set-bounds', { wcId, bounds }),
  tabFind: (payload) => ipcRenderer.send('tab-find', payload),
  rescanMedia: (payload) => ipcRenderer.send('rescan-media', payload),

  // --- tear-off pill overlay (M09 F10 Leg L4-rebuild) ---
  // The "Release to open in a new window" pill is a main-owned overlay WebContentsView
  // floating over the guest (not chrome DOM — the DOM ghost was occluded once the drag
  // left the strip band). Fire-and-forget: show on arm, move on each pointermove (the
  // renderer rAF-coalesces), hide on leave/drop/cancel.
  tearoffOverlayShow: (pos) => ipcRenderer.send('tearoff-overlay:show', pos),
  tearoffOverlayMove: (pos) => ipcRenderer.send('tearoff-overlay:move', pos),
  tearoffOverlayHide: () => ipcRenderer.send('tearoff-overlay:hide'),

  // --- menu-overlay sheet (M05 Flight 8, DD4) ---
  // The chrome owns menu state/model-building/actions; the sheet is presentation-only.
  // Channel 1: open (or model-replace) a menu — {menuType, model, anchor, startIndex, token}.
  menuOverlayOpen: (payload) => ipcRenderer.send('menu-overlay:open', payload),
  // Channel 2: programmatic close — reason allowlisted main-side to 'toggle' (trigger
  // re-click close, no focus move) | 'superseded' (default) | 'escape' | 'blur' |
  // 'navigation' | 'input-empty' | 'activated' (the omnibox-suggestions close
  // triggers added this flight — DD5 amendment).
  menuOverlayClose: (/** @type {{ reason?: 'toggle' | 'superseded' | 'escape' | 'blur' | 'navigation' | 'input-empty' | 'activated' }} */ payload = {}) =>
    ipcRenderer.send('menu-overlay:close', { reason: payload.reason }),
  // Channel 6: an item was activated on the sheet — {menuType, id}; chrome executes the action.
  onMenuOverlayActivated: (cb) => ipcRenderer.on('menu-overlay-activated', (_e, d) => cb(d)),
  // Channel 7: the menu closed for ANY reason — {menuType, reason, token}; chrome drops
  // stale tokens, resets aria-expanded, records blur-suppress, refocuses per reason.
  onMenuOverlayClosed: (cb) => ipcRenderer.on('menu-overlay-closed', (_e, d) => cb(d)),
  // DD13: chrome-class accelerators forwarded from the sheet's before-input-event —
  // {action}; handled by the extracted dispatchChromeAction (same bodies as keydown).
  onChromeShortcutAction: (cb) => ipcRenderer.on('chrome-shortcut-action', (_e, d) => cb(d)),

  // --- find overlay (M05 Flight 7) ---
  // The find bar is a main-owned chrome-class WebContentsView floating over the
  // guest (not chrome DOM). The chrome drives open (openFind / per-tab restore)
  // and close (navigation-close; main resolves NO refocus for a chrome sender),
  // and subscribes to per-tab state sync: text on every overlay query (empty
  // included — deletion sync), closed ONLY on an overlay-side user Esc/✕.
  findOverlayOpen: ({ wcId, findText }) => ipcRenderer.send('find-overlay:open', { wcId, findText }),
  findOverlayClose: () => ipcRenderer.send('find-overlay:close'),
  onFindOverlayClosed: (cb) => ipcRenderer.on('find-overlay-closed', (_e, d) => cb(d)),
  onFindOverlayText: (cb) => ipcRenderer.on('find-overlay-text', (_e, d) => cb(d)),

  // Push subscriptions from main for tab events
  onTabDidNavigate: (cb) => ipcRenderer.on('tab-did-navigate', (_e, d) => cb(d)),
  onTabDidNavigateInPage: (cb) => ipcRenderer.on('tab-did-navigate-in-page', (_e, d) => cb(d)),
  onTabTitle: (cb) => ipcRenderer.on('tab-title', (_e, d) => cb(d)),
  onTabFavicon: (cb) => ipcRenderer.on('tab-favicon', (_e, d) => cb(d)),
  onTabLoading: (cb) => ipcRenderer.on('tab-loading', (_e, d) => cb(d)),
  onTabDidFinishLoad: (cb) => ipcRenderer.on('tab-did-finish-load', (_e, d) => cb(d)),
  onTabDomReady: (cb) => ipcRenderer.on('tab-dom-ready', (_e, d) => cb(d)),
  onTabMediaList: (cb) => ipcRenderer.on('tab-media-list', (_e, d) => cb(d)),
  onTabPrivacyFp: (cb) => ipcRenderer.on('tab-privacy-fp', (_e, d) => cb(d)),
  // Vault gesture (M12 F2 Leg 1, DD1/DD3): main forwards a TRUSTED lock-icon
  // click as { wcId } (the trusted, main-derived tab id) — carries no secret.
  // The pick-and-fill leg's consumer raises the chrome-owned unlock/pick prompt.
  onVaultGesture: (cb) => ipcRenderer.on('vault-gesture', (_e, d) => cb(d)),
  // Vault lock-state (M12 F2 Leg 2 chrome-unlock, DD10): the toolbar lock
  // indicator subscribes to every transition push, then fetches the initial
  // state once. Payload `{ setUp, unlocked }` — non-secret projection of the
  // vault-store's MRK-present state.
  onVaultLockState: (cb) => ipcRenderer.on('vault-lock-state', (_e, d) => cb(d)),
  getVaultLockState: () => ipcRenderer.invoke('vault-lock-state-get'),
  // Human pick-and-fill (M12 F2 Leg 3, DD5/DD6): the picker's reachable-items read
  // (metadata only — never a password) and the human fill dispatch (returns
  // { filled, reason? } — the password is resolved + sent ONLY in main). Both are
  // chrome-originated invokes; the wcId is the trusted, main-derived gesture tab id.
  vaultReachableItems: (wcId) => ipcRenderer.invoke('vault-reachable-items', wcId),
  vaultFillHuman: (payload) => ipcRenderer.invoke('vault-fill-human', payload),
  // Capture-save (M12 F2 Leg 4, DD7): main forwards a save/update offer as
  // { captureId, model } (model = origin/username/mode/defaultVaultId/choices — NO
  // password). The chrome opens the vault-capture sheet with it; the sheet's own Save
  // invoke reports the choice. On a dismiss (close WITHOUT a save) the chrome calls
  // vaultCaptureDismiss so main drops+zeroizes the held record immediately (not only on
  // the 2-min timeout). The captured password never crosses to chrome.
  onVaultCaptureOffer: (cb) => ipcRenderer.on('vault-capture-offer', (_e, d) => cb(d)),
  vaultCaptureDismiss: (captureId) => ipcRenderer.invoke('vault-capture-dismiss', captureId),
  onTabNavState: (cb) => ipcRenderer.on('tab-nav-state', (_e, d) => cb(d)),

  // The internal partition string (single source of truth, src/shared/internal-page.js),
  // set as the trusted webview's `partition` attribute so it matches the main-process
  // internal session byte-for-byte.
  internalPartition: INTERNAL_PARTITION,

  // Dev-only automation seam (DD7 — interim; folded at Flight 3). Absent in normal/release
  // runs (isMcpAutomationEnabled false when the --automation-dev marker is not injected). Chrome-
  // renderer-only: the guest webview uses webview-preload.js (no automationDevInvoke there),
  // and main.js also rejects any sender that isn't mainWindow.webContents.
  ...(isMcpAutomationEnabled(process.argv)
    ? { automationDevInvoke: (/** @type {string} */ op, /** @type {any[]} */ args) => ipcRenderer.invoke('automation:dev-invoke', { op, args }) }
    : {})
});
