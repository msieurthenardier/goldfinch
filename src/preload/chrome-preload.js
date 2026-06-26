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
  identityNew: (payload) => ipcRenderer.invoke('identity-new', payload),

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
  // Fired by main's guest devtools-opened/devtools-closed listener (leg-1 spike POSITIVE — both the
  // guest contents and the <webview> tag fire; we wire the guest side). Mirrors onZoomChanged; Leg 2
  // subscribes for live button updates. Payload { wcId, open }.
  onDevtoolsStateChanged: (cb) => ipcRenderer.on('devtools-state-changed', (_e, d) => cb(d)),

  // --- new container create (renderer collects name, main creates jar) ---
  // After "New container…": renderer collected the name via inline input; main creates the
  // jar and signals back 'chrome-new-tab-in-container'. Returns the new container object.
  newContainerCreate: (name) => ipcRenderer.invoke('new-container-create', { name }),

  // --- main → renderer: page context menu (with optional freeze-frame dataURL) ---
  // Fired by main's guest context-menu listener with the params + an optional freeze-frame
  // dataURL (captured from the guest before opening). Renderer opens the HTML context menu.
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
  onOpenTab: (cb) => ipcRenderer.on('open-tab', (_e, url) => cb(url)),
  // Fired by main's before-input-event Ctrl+F capture (DD2/SC4). No payload —
  // the renderer resolves the active tab via activeTab(). Mirrors onOpenTab.
  onOpenFind: (cb) => ipcRenderer.on('open-find', () => cb()),
  // Fired by main's before-input-event Ctrl+J capture (DD2). No payload — the renderer
  // opens goldfinch://downloads via openDownloads(). Mirrors onOpenFind.
  onOpenDownloads: (cb) => ipcRenderer.on('open-downloads', () => cb()),

  // --- site-info freeze-frame (Flight 3, Leg 2 sub-step 5) ---
  // Capture the active web guest as a PNG data URL so the renderer can show a
  // still image while the guest is hidden behind the site-info popup. Returns
  // null when no active web guest is available (internal tabs need no freeze).
  captureActiveGuest: () => ipcRenderer.invoke('capture-active-guest'),

  // --- web tab lifecycle (Flight 3, Leg 1) ---
  tabCreate: (payload) => ipcRenderer.invoke('tab-create', payload),
  tabClose: (wcId) => ipcRenderer.send('tab-close', wcId),
  tabHide: (wcId) => ipcRenderer.send('tab-hide', wcId),
  tabNavigate: (payload) => ipcRenderer.send('tab-navigate', payload),
  tabSetActive: (wcId, bounds) => ipcRenderer.send('tab-set-active', { wcId, bounds }),
  tabSetBounds: (wcId, bounds) => ipcRenderer.send('tab-set-bounds', { wcId, bounds }),
  tabFind: (payload) => ipcRenderer.send('tab-find', payload),
  rescanMedia: (payload) => ipcRenderer.send('rescan-media', payload),

  // Push subscriptions from main for tab events
  onTabDidNavigate: (cb) => ipcRenderer.on('tab-did-navigate', (_e, d) => cb(d)),
  onTabDidNavigateInPage: (cb) => ipcRenderer.on('tab-did-navigate-in-page', (_e, d) => cb(d)),
  onTabTitle: (cb) => ipcRenderer.on('tab-title', (_e, d) => cb(d)),
  onTabFavicon: (cb) => ipcRenderer.on('tab-favicon', (_e, d) => cb(d)),
  onTabLoading: (cb) => ipcRenderer.on('tab-loading', (_e, d) => cb(d)),
  onTabDidFinishLoad: (cb) => ipcRenderer.on('tab-did-finish-load', (_e, d) => cb(d)),
  onTabDomReady: (cb) => ipcRenderer.on('tab-dom-ready', (_e, d) => cb(d)),
  onTabMediaList: (cb) => ipcRenderer.on('tab-media-list', (_e, d) => cb(d)),
  onTabFoundInPage: (cb) => ipcRenderer.on('tab-found-in-page', (_e, d) => cb(d)),
  onTabPrivacyFp: (cb) => ipcRenderer.on('tab-privacy-fp', (_e, d) => cb(d)),
  onTabNavState: (cb) => ipcRenderer.on('tab-nav-state', (_e, d) => cb(d)),

  // Absolute path to the webview preload, so the renderer can set it on
  // <webview webpreferences> / preload attribute.
  webviewPreloadPath: `file://${require('path').join(__dirname, 'webview-preload.js')}`,

  // Absolute path to the TRUSTED internal-page preload, set on the Settings webview's
  // preload attribute (distinct surface from webviewPreloadPath; runs context-isolated).
  internalPreloadPath: `file://${require('path').join(__dirname, 'internal-preload.js')}`,

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
