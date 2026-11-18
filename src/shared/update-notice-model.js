// Pure, DOM-free model for the update notice (Mission 23 Flight 3, leg `update-notice`). One
// projection feeds BOTH surfaces — Settings -> About and the kebab item — from main's validated
// state `{ current, available, releaseUrl, checkEnabled }`. It re-validates what it shows (the
// OFFERED version only if `parseStableTag('v' + version)` returns the same string; the running
// version if it is a well-formed semantic version, prerelease and build suffix allowed), so no
// unexpected text can reach either surface even if the state were wrong. Never throws.

import { parseStableTag, isWellFormedVersion, installerUrlFor } from './update-version.js';

const EMPTY = {
  noticeText: '',
  showNotice: false,
  openLabel: '',
  kebabLabel: '',
  openAriaLabel: '',
  showDownload: false,
  downloadLabel: '',
  downloadAriaLabel: '',
  hintText: ''
};

/** @param {unknown} v @returns {v is string} */
function isStableVersion(v) {
  return typeof v === 'string' && parseStableTag('v' + v) === v;
}

export const DOWNLOAD_HINT = 'Downloads the installer for this computer. Run it to update.';
export const NO_DIRECT_HINT = 'Download the installer for your system from the release page, then run it to update.';
export const DOWNLOAD_STARTED_HINT = 'Download started — find it in Downloads, then run it to update.';
export const DOWNLOAD_FAILED_HINT = 'Could not start the download. Use the release page instead.';

/**
 * The hint after a click, from main's answer to the no-argument download call (or null when the call
 * itself was rejected).
 * @param {any} result
 * @returns {string}
 */
export function downloadResultHint(result) {
  return result && typeof result === 'object' && result.ok === true ? DOWNLOAD_STARTED_HINT : DOWNLOAD_FAILED_HINT;
}

/**
 * @param {any} state
 * @returns {{ versionText: string, noticeText: string, showNotice: boolean, openLabel: string, kebabLabel: string, openAriaLabel: string, showDownload: boolean, downloadLabel: string, downloadAriaLabel: string, hintText: string }}
 */
export function updateNoticeModel(state) {
  try {
    const s = state && typeof state === 'object' ? state : {};
    const versionText = isWellFormedVersion(s.current) ? `Goldfinch ${s.current}` : 'Goldfinch';
    if (isStableVersion(s.available) && typeof s.releaseUrl === 'string' && s.releaseUrl !== '') {
      // A direct installer is offered only for a name main's pure chooser could have produced for
      // exactly this version; anything else shows the release-page hint and no button.
      const showDownload = typeof s.downloadName === 'string' && installerUrlFor(s.downloadName, s.available) !== null;
      return {
        versionText,
        noticeText: `Version ${s.available} is available.`,
        showNotice: true,
        openLabel: 'View release notes',
        kebabLabel: `Update available — ${s.available}`,
        openAriaLabel: `View release notes for version ${s.available}`,
        showDownload,
        downloadLabel: showDownload ? 'Download now' : '',
        downloadAriaLabel: showDownload ? `Download version ${s.available}` : '',
        hintText: showDownload ? DOWNLOAD_HINT : NO_DIRECT_HINT
      };
    }
    return { ...EMPTY, versionText };
  } catch {
    return { ...EMPTY, versionText: 'Goldfinch' };
  }
}
