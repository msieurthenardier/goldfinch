// @ts-check
'use strict';

// Shared main-side DevTools open/close mechanics (Flight-3 DD1).
//
// One implementation of the actual {mode:'detach'} open / close + the read of
// wc.isDevToolsOpened(), called by BOTH:
//   - the M03 MCP ops (src/main/automation/observe.js openDevTools/closeDevTools)
//   - the human-path IPC handlers (src/main/main.js toggle-devtools / is-devtools-open)
//
// This module is deliberately ELECTRON-FREE at the top (it only calls methods on
// a webContents passed in by the caller), mirroring observe.js's electron-free
// discipline so it is unit-testable offline with a fake wc.
//
// GUARD OWNERSHIP (pinned, Flight-3 DD1 / leg-1): this helper assumes a
// PRE-GUARDED wc and does NOT itself apply isInternalContents. The internal-
// session predicate (resolve.js isInternalContents) is the single shared guard,
// but each caller applies it with its CONTRACT-APPROPRIATE response — the MCP ops
// throw (void contract), the IPC handler returns false (boolean contract). So
// "one code path" means the open/close MECHANICS live here once; the predicate is
// one function; only the failure RESPONSE differs by caller.

/**
 * Open or close DevTools (detached) on a pre-guarded webContents.
 *
 * Detached mode only — in-window docked DevTools via setDevToolsWebContents is a
 * BACKLOG item (not yet implemented); detached is the shipped mode. closeDevTools()
 * on a contents whose DevTools is not open is a no-op in Electron (does not throw),
 * so this is safe to call unconditionally.
 *
 * @param {any} wc    a live, pre-guarded webContents (caller resolved + guarded it)
 * @param {boolean} open  true → open detached; false → close
 * @returns {void}
 */
function setDevTools(wc, open) {
  if (open) wc.openDevTools({ mode: 'detach' });
  else wc.closeDevTools();
}

/**
 * Toggle DevTools on a pre-guarded webContents and return the POST-toggle state.
 *
 * Reads wc.isDevToolsOpened() to decide the direction, flips it, then returns the
 * authoritative post-toggle wc.isDevToolsOpened() so the caller (the human-path
 * IPC handler → renderer button) sets state from the real value rather than an
 * assumed one (Flight-1 KL#2: query Chromium truth on demand).
 *
 * @param {any} wc  a live, pre-guarded webContents
 * @returns {boolean} the post-toggle wc.isDevToolsOpened()
 */
function toggleDevTools(wc) {
  const wasOpen = wc.isDevToolsOpened();
  setDevTools(wc, !wasOpen);
  return wc.isDevToolsOpened();
}

module.exports = { setDevTools, toggleDevTools };
