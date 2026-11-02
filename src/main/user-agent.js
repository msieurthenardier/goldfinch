// @ts-check
'use strict';

// Squawk 0169: Electron's default UA carries `<app.getName()>/<app.getVersion()>`
// (`goldfinch/0.19.9`) between `Gecko)` and `Chrome/`. With a tiny install base
// that token is a near-unique fingerprint Shields' farbling cannot cover.
// Squawk 0119 stripped BOTH it and `Electron/`; squawk 0145 reverted that
// because dropping `Electron/` loops Cloudflare's managed challenge. This
// strips ONLY the app token (plus one separating space) and leaves
// `Electron/<ver>`, `Chrome/<ver>` and everything else byte-identical.
//
// Electron-free and pure: name/version are injected, never hardcoded.

/**
 * @param {unknown} userAgent
 * @param {unknown} appName
 * @param {unknown} appVersion
 * @returns {unknown}
 */
function stripAppToken(userAgent, appName, appVersion) {
  if (typeof userAgent !== 'string' || userAgent === '') return userAgent;
  if (typeof appName !== 'string' || appName === '') return userAgent;
  if (typeof appVersion !== 'string' || appVersion === '') return userAgent;
  // Never let a weird app name touch the runtime tokens.
  if (/^(?:electron|chrome)$/i.test(appName)) return userAgent;
  const esc = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
  const token = `${esc(appName)}/${esc(appVersion)}`;
  // Mid/trailing token: drop it with its LEADING space; leading token: drop it
  // with its trailing space.
  const mid = new RegExp(` ${token}(?= |$)`);
  if (mid.test(userAgent)) return userAgent.replace(mid, '');
  return userAgent.replace(new RegExp(`^${token}(?: |$)`), '');
}

module.exports = { stripAppToken };
