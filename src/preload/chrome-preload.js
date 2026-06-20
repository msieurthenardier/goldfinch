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

  // --- page context menu (human/page path; rendered by the chrome menuController, Leg 4) ---
  // Subscription: fired by main's guest context-menu listener (Leg-1 spike POSITIVE on both the
  // guest contents and the <webview> tag — we wire the guest side, which is auto-guarded for
  // internal goldfinch:// guests, DD6). Mirrors onZoomChanged / onDevtoolsStateChanged. Payload
  // { wcId, params }. Leg 4 renders #page-context-menu from it.
  onPageContextMenu: (cb) => ipcRenderer.on('page-context-menu', (_e, d) => cb(d)),
  // Correction round-trip: chrome -> main -> guest replaceMisspelling. One-way send (no return),
  // mirroring zoomApply / print. Main acts on the PASSED webContentsId (never activeTab() —
  // TOCTOU) and refuses the internal session (DD6). The correction path is main-side either way,
  // independent of which side delivers the params.
  correctMisspelling: ({ webContentsId, word }) =>
    ipcRenderer.send('page-context-correct', { webContentsId, word }),
  // Edit-action dispatch for the page context menu (Cut/Copy/Paste/Undo/Redo). One-way send,
  // mirroring correctMisspelling's discipline. Main acts on the PASSED webContentsId (never
  // activeTab() — TOCTOU), refuses the internal session (DD6), and restricts `action` to a
  // fixed allowlist {cut,copy,paste,undo,redo} (NOT a run-any-method primitive). Leg 1
  // deferred these explicitly — they are NOT misspelling corrections and cannot ride
  // page-context-correct (whose narrow `word`-string contract is part of its audited surface).
  pageContextAction: ({ webContentsId, action }) =>
    ipcRenderer.send('page-context-action', { webContentsId, action }),
  // OS-clipboard write for the page menu's Copy link / Copy image address / Copy selection.
  // The chrome renderer is contextIsolation/nodeIntegration-off (no require('electron')) and the
  // clipboard:write IPC is internal-origin-gated (settings page only), so neither is reachable
  // here; navigator.clipboard.writeText is unreliable from a file:// doc right after a guest
  // context-menu steals focus. This narrow one-way bridge writes a STRING to the OS clipboard via
  // main's clipboard.writeText — same chrome-only trust domain as window-minimize/zoom-apply
  // (writing a string is not a guest mutation). NOT origin-gated.
  clipboardWriteText: (text) => ipcRenderer.send('chrome-clipboard-write', text),

  // --- main -> renderer events ---
  onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (_e, data) => cb(data)),
  onDownloadDone: (cb) => ipcRenderer.on('download-done', (_e, data) => cb(data)),
  onOpenTab: (cb) => ipcRenderer.on('open-tab', (_e, url) => cb(url)),
  // Fired by main's before-input-event Ctrl+F capture (DD2/SC4). No payload —
  // the renderer resolves the active tab via activeTab(). Mirrors onOpenTab.
  onOpenFind: (cb) => ipcRenderer.on('open-find', () => cb()),

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
