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
    offShieldsChanged: (h) => off(h),

    // Automation status/address (Flight 5, Leg 2). Activity listeners are Leg 4.

    /**
     * Read the live automation-surface status.
     * @returns {Promise<{ enabled: boolean, host: string, port: number, bound: boolean, error: (string|null) }>}
     */
    automationGetStatus: () => ipcRenderer.invoke('automation:get-status'),

    /**
     * Persist the automation port and live-rebind the running surface to it
     * (Flight 5, Leg 7). Resolves with the fresh status; rejects ("Invalid port")
     * when the value fails the main-side validator.
     * @param {number} port
     * @returns {Promise<{ enabled: boolean, host: string, port: number, bound: boolean, error: (string|null) }>}
     */
    automationSetPort: (port) => ipcRenderer.invoke('automation:set-port', port),

    /**
     * Advisory scan for a free loopback port for the "find free port" affordance.
     * @returns {Promise<{ port: (number|null) }>}
     */
    automationFindFreePort: () => ipcRenderer.invoke('automation:find-free-port'),

    /**
     * Write text to the system clipboard (fallback when navigator.clipboard is
     * blocked at runtime under contextIsolation + sandbox — DD4).
     * @param {string} text
     * @returns {Promise<{ ok: boolean }>}
     */
    clipboardWrite: (text) => ipcRenderer.invoke('clipboard:write', text),

    // Automation key management (Flight 5, Leg 3 / SC9). Mint returns the
    // show-once plaintext; list/revoke deal in hashes only (never plaintext).

    /**
     * List jars joined with key presence, plus the admin env gate + admin-key
     * state. Never returns hashes or plaintext.
     * @returns {Promise<{ jars: Array<{ id: string, name: string, color: string, hasKey: boolean }>, adminEnabled: boolean, adminKeySet: boolean }>}
     */
    automationListKeys: () => ipcRenderer.invoke('automation:list-keys'),

    /**
     * Generate (or rotate) the per-jar automation key; returns the show-once
     * plaintext. Rejects for an unknown/burner jarId.
     * @param {string} jarId
     * @returns {Promise<{ key: string }>}
     */
    automationJarKeyMint: (jarId) => ipcRenderer.invoke('automation:jar-key-mint', jarId),

    /**
     * Revoke the per-jar automation key (deletes its hash). No-op if absent.
     * @param {string} jarId
     * @returns {Promise<{ ok: boolean }>}
     */
    automationJarKeyRevoke: (jarId) => ipcRenderer.invoke('automation:jar-key-revoke', jarId),

    /**
     * Generate (or rotate) the admin key; returns the show-once plaintext, or
     * { key: null } when the GOLDFINCH_AUTOMATION_ADMIN env gate is unset.
     * @returns {Promise<{ key: (string|null) }>}
     */
    automationAdminKeyMint: () => ipcRenderer.invoke('automation:admin-key-mint'),

    /**
     * Revoke the admin key (clears its hash).
     * @returns {Promise<{ ok: boolean }>}
     */
    automationAdminKeyRevoke: () => ipcRenderer.invoke('automation:admin-key-revoke'),

    // Automation activity (Flight 5, Leg 4 / SC10 / DD6). Read-only audit snapshot
    // ({ sessions, log }) + live broadcast for the settings-page Activity viewer.

    /**
     * Read the current automation activity snapshot (active sessions + action log).
     * Carries no key/hash. Returns { sessions: [], log: [] } when the surface is off.
     * @returns {Promise<{ sessions: any[], log: any[] }>}
     */
    automationGetActivity: () => ipcRenderer.invoke('automation:get-activity'),

    /**
     * Subscribe to automation-activity-changed broadcasts.
     * cb receives the updated { sessions, log } snapshot.
     * Returns a numeric handle for use with offAutomationActivity.
     * @param {(snap: { sessions: any[], log: any[] }) => void} cb
     * @returns {number}
     */
    onAutomationActivity: (cb) => on('automation-activity-changed', cb),

    /**
     * Unsubscribe the automation-activity listener registered under handle h.
     * Call from a pagehide handler to prevent accumulation across reloads.
     * @param {number} h
     */
    offAutomationActivity: (h) => off(h)
  });
}
// When origin does NOT match: expose nothing. The bridge does not exist for
// non-internal origins — no version, no methods, no surface.
