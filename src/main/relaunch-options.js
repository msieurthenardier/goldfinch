'use strict';

// Electron-free helper for Restart now (sortie 02 leg 2 / DD11). Electron's
// RelaunchOptions is `{ args?, execPath? }` (re-checked on Electron 45.3.2's electron.d.ts,
// 2026-11-14: still no `env`) — there is NO `env` option, so env hygiene
// (stripping GOLDFINCH_AUTOMATION_DEV_MINT) is the handler's job on the live env, not
// this function's. Reads ONLY `env.APPIMAGE`: an AppImage's `process.execPath` points into
// the transient mount, so the relaunch must target the AppImage file itself. Default args
// are kept (never passed).

/**
 * @param {{ env?: Record<string, string | undefined> }} [input]
 * @returns {{ execPath?: string }}
 */
function relaunchOptions({ env } = {}) {
  const appImage = env && env.APPIMAGE;
  return typeof appImage === 'string' && appImage !== '' ? { execPath: appImage } : {};
}

module.exports = { relaunchOptions };
