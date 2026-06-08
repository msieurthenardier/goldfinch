'use strict';

// Preload for trusted internal `goldfinch://` pages (the Settings page).
// Runs under contextIsolation:true + sandbox:true (set in will-attach-webview's
// INTERNAL_PARTITION branch). In a sandbox:true + contextIsolation:true preload,
// `location` IS available and reflects the URL being loaded at the time the preload
// is injected — so `location.origin` reads 'goldfinch://settings' for the real settings
// page and the web origin for any other content.
//
// The main-side registerInternalHandler check is the AUTHORITATIVE security boundary.
// This guard is defense-in-depth: even if the preload runs in the wrong context (e.g.
// after a navigation into web content — webPreferences are immutable post-attach), the
// bridge simply isn't exposed, and any stored reference to it would fail at the
// main-side origin check anyway.

const { contextBridge, ipcRenderer } = require('electron');

// Only expose the bridge when this preload is running in the genuine internal page.
// When the origin does not match, expose NOTHING — not even `version`.
if (location.origin === 'goldfinch://settings') {
  contextBridge.exposeInMainWorld('goldfinchInternal', {
    version: 1,

    /**
     * Read a single setting by key, or all settings if key is omitted/falsy.
     * @param {string} [key]
     * @returns {Promise<any>}
     */
    settingsGet: (key) => ipcRenderer.invoke('internal-settings-get', key),

    /**
     * Write a single setting. Resolves with the updated config; rejects if the
     * key is unknown or the value fails validation (main-side set() throws).
     * @param {string} key
     * @param {unknown} value
     * @returns {Promise<any>}
     */
    settingsSet: (key, value) => ipcRenderer.invoke('internal-settings-set', key, value),

    /**
     * Subscribe to settings-changed broadcasts (emitted by legs 3+).
     * cb receives the full updated config object.
     * @param {(all: object) => void} cb
     */
    onSettingsChanged: (cb) => ipcRenderer.on('settings-changed', (_e, all) => cb(all)),

    /**
     * Read the current global Shields config.
     * @returns {Promise<object>}
     */
    shieldsGet: () => ipcRenderer.invoke('internal-shields-get'),

    /**
     * Write a partial Shields config patch. Resolves with the updated config;
     * broadcasts shields-changed to both the chrome and all internal guests.
     * @param {object} patch
     * @returns {Promise<object>}
     */
    shieldsSet: (patch) => ipcRenderer.invoke('internal-shields-set', patch),

    /**
     * Subscribe to shields-changed broadcasts (emitted by leg 4+).
     * cb receives the updated shields config object.
     * @param {(cfg: object) => void} cb
     */
    onShieldsChanged: (cb) => ipcRenderer.on('shields-changed', (_e, cfg) => cb(cfg))
  });
}
// When origin does NOT match: expose nothing. The bridge does not exist for
// non-internal origins — no version, no methods, no surface.
