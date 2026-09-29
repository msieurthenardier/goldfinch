'use strict';

// Electron-free default-browser status/action module (sortie 01 leg 2, DD7).
// Every live handle is injected so the decision logic runs under `node --test`
// with fakes. Takes NO page-supplied input anywhere.

// The ONLY shell.openExternal target in src/ (source-scan pinned). A hard-coded
// literal: never derived from input. `Goldfinch` must equal the RegisteredApplications
// value name written by build/installer.nsh (drift-guarded in the packaging pin).
const WIN_DEFAULT_APPS_URL = 'ms-settings:defaultapps?registeredAppUser=Goldfinch';

const SCHEMES = ['http', 'https'];

function createDefaultBrowser({ app, shell, platform, env, logger }) {
  const log = (what, err) => {
    try {
      // Message class only — never a URL or secret.
      logger.warn(`[default-browser] ${what}: ${err && err.name ? err.name : 'error'}`);
    } catch {
      /* logging must never throw */
    }
  };

  function support() {
    if (!app.isPackaged) return 'dev';
    if (platform === 'linux' && env && env.APPIMAGE) return 'appimage';
    if (platform !== 'linux' && platform !== 'darwin' && platform !== 'win32') return 'platform';
    return null;
  }

  function getStatus() {
    const reason = support();
    if (reason) return { supported: false, reason, isDefault: null, platform };
    let isDefault = null;
    if (platform === 'linux' || platform === 'darwin') {
      try {
        isDefault = SCHEMES.every((s) => app.isDefaultProtocolClient(s) === true);
      } catch (err) {
        log('isDefaultProtocolClient failed', err);
        isDefault = false;
      }
    }
    return { supported: true, reason: null, isDefault, platform };
  }

  async function makeDefault() {
    if (support()) return { ok: false, status: getStatus() };
    let ok;
    try {
      if (platform === 'win32') {
        await shell.openExternal(WIN_DEFAULT_APPS_URL);
        ok = true;
      } else {
        // Both schemes are always attempted, even if the first returns false.
        const results = SCHEMES.map((s) => app.setAsDefaultProtocolClient(s));
        ok = results.every((r) => r === true);
      }
    } catch (err) {
      log('make-default failed', err);
      ok = false;
    }
    return { ok, status: getStatus() };
  }

  return { getStatus, makeDefault };
}

module.exports = { createDefaultBrowser, WIN_DEFAULT_APPS_URL };
