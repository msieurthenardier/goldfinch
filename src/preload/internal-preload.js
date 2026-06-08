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
  // DD5: listener-handle map — lets on() return a numeric handle and off(h) remove
  // the exact wrapper, preventing accumulation across guest reloads (electronmon
  // reloads the goldfinch://settings guest; without off/pagehide cleanup, each reload
  // would leave an extra ipcRenderer listener permanently registered in the preload).
  // contextBridge cannot return a function, but it CAN return a number, so handles
  // are the right cross-boundary currency.
  let nextHandle = 1;
  const listeners = new Map();

  /**
   * Register a wrapper for channel and return a numeric handle.
   * @param {string} channel
   * @param {(x: any) => void} cb
   * @returns {number}
   */
  function on(channel, cb) {
    const wrapper = (_e, x) => cb(x);
    const h = nextHandle++;
    listeners.set(h, { channel, wrapper });
    ipcRenderer.on(channel, wrapper);
    return h;
  }

  /**
   * Remove the listener registered under handle h.
   * @param {number} h
   */
  function off(h) {
    const e = listeners.get(h);
    if (e) {
      ipcRenderer.removeListener(e.channel, e.wrapper);
      listeners.delete(h);
    }
  }

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
     * Subscribe to settings-changed broadcasts.
     * cb receives the full updated config object.
     * Returns a numeric handle for use with offSettingsChanged.
     * @param {(all: object) => void} cb
     * @returns {number}
     */
    onSettingsChanged: (cb) => on('settings-changed', cb),

    /**
     * Unsubscribe the settings-changed listener registered under handle h.
     * Call from a pagehide handler to prevent accumulation across reloads.
     * @param {number} h
     */
    offSettingsChanged: (h) => off(h),

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
     * Subscribe to shields-changed broadcasts.
     * cb receives the updated shields config object.
     * Returns a numeric handle for use with offShieldsChanged.
     * @param {(cfg: object) => void} cb
     * @returns {number}
     */
    onShieldsChanged: (cb) => on('shields-changed', cb),

    /**
     * Unsubscribe the shields-changed listener registered under handle h.
     * Call from a pagehide handler to prevent accumulation across reloads.
     * @param {number} h
     */
    offShieldsChanged: (h) => off(h)
  });
}
// When origin does NOT match: expose nothing. The bridge does not exist for
// non-internal origins — no version, no methods, no surface.
