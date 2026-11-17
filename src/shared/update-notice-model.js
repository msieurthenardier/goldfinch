// Pure, DOM-free model for the update notice (Mission 23 Flight 3, leg `update-notice`). One
// projection feeds BOTH surfaces — Settings -> About and the kebab item — from main's validated
// state `{ current, available, releaseUrl, checkEnabled }`. It re-validates what it shows (a
// version is shown only if `parseStableTag('v' + version)` returns the same string), so no
// unexpected text can reach either surface even if the state were wrong. Never throws.

import { parseStableTag } from './update-version.js';

/** @param {unknown} v @returns {v is string} */
function isStableVersion(v) {
  return typeof v === 'string' && parseStableTag('v' + v) === v;
}

/**
 * @param {any} state
 * @returns {{ versionText: string, noticeText: string, showNotice: boolean, openLabel: string, kebabLabel: string, openAriaLabel: string }}
 */
export function updateNoticeModel(state) {
  try {
    const s = state && typeof state === 'object' ? state : {};
    const versionText = isStableVersion(s.current) ? `Goldfinch ${s.current}` : 'Goldfinch';
    if (isStableVersion(s.available) && typeof s.releaseUrl === 'string' && s.releaseUrl !== '') {
      return {
        versionText,
        noticeText: `Version ${s.available} is available.`,
        showNotice: true,
        openLabel: 'View release notes',
        kebabLabel: `Update available — ${s.available}`,
        openAriaLabel: `View release notes for version ${s.available}`
      };
    }
    return { versionText, noticeText: '', showNotice: false, openLabel: '', kebabLabel: '', openAriaLabel: '' };
  } catch {
    return {
      versionText: 'Goldfinch',
      noticeText: '',
      showNotice: false,
      openLabel: '',
      kebabLabel: '',
      openAriaLabel: ''
    };
  }
}
