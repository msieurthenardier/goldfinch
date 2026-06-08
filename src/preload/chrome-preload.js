'use strict';

// Preload for the browser UI (the renderer that draws toolbar, tabs, media panel).
// Exposes a minimal, audited surface to the renderer via contextBridge.

const { contextBridge, ipcRenderer } = require('electron');
const { INTERNAL_PARTITION } = require('../shared/internal-page');

contextBridge.exposeInMainWorld('goldfinch', {
  // --- platform ---
  platform: process.platform,

  // --- window controls ---
  windowMinimize: () => ipcRenderer.send('window-minimize'),
  windowToggleMaximize: () => ipcRenderer.send('window-toggle-maximize'),
  windowClose: () => ipcRenderer.send('window-close'),
  appQuit: () => ipcRenderer.send('app-quit'),
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

  // --- cookie jars / identities ---
  jarsList: () => ipcRenderer.invoke('jars-list'),
  jarsAdd: (payload) => ipcRenderer.invoke('jars-add', payload),
  identityNew: (payload) => ipcRenderer.invoke('identity-new', payload),

  // --- main -> renderer events ---
  onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (_e, data) => cb(data)),
  onDownloadDone: (cb) => ipcRenderer.on('download-done', (_e, data) => cb(data)),
  onOpenTab: (cb) => ipcRenderer.on('open-tab', (_e, url) => cb(url)),

  // Absolute path to the webview preload, so the renderer can set it on
  // <webview webpreferences> / preload attribute.
  webviewPreloadPath: `file://${require('path').join(__dirname, 'webview-preload.js')}`,

  // Absolute path to the TRUSTED internal-page preload, set on the Settings webview's
  // preload attribute (distinct surface from webviewPreloadPath; runs context-isolated).
  internalPreloadPath: `file://${require('path').join(__dirname, 'internal-preload.js')}`,

  // The internal partition string (single source of truth, src/shared/internal-page.js),
  // set as the trusted webview's `partition` attribute so it matches the main-process
  // internal session byte-for-byte.
  internalPartition: INTERNAL_PARTITION
});
