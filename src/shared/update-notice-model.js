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
        downloadAriaLabel: showDownload ? `Download now — version ${s.available}` : '',
        hintText: showDownload ? DOWNLOAD_HINT : NO_DIRECT_HINT
      };
    }
    return { ...EMPTY, versionText };
  } catch {
    return { ...EMPTY, versionText: 'Goldfinch' };
  }
}

export const CHECK_NOW_COPY = Object.freeze({
  checking: 'Checking…',
  newer: 'Found a newer version — see above.',
  current: "You're up to date.",
  failed: "Couldn't check — try again later.",
  tooSoon: 'Checked moments ago — try again in a few seconds.',
  unavailable: "Checking isn't available in this build.",
  neverChecked: 'Not checked yet'
});

/**
 * The "Check now" row: the button's disabled state, the result line and the "Last checked" line.
 * `lastAnswer` is the latest answer THIS page received to its own press (`'newer' | 'current' |
 * 'failed' | 'too-soon' | 'unavailable' | null`); `pressing` is true while that press is awaiting its
 * answer. `now` (ms) and the formatter `{ time(ms), date(ms) }` are injected so the table is
 * deterministic. "Today" is the local calendar day; a `lastCheck.at` in the future reads as its time.
 * Never throws; `state` is main's validated state and is re-validated here (the offered version is
 * shown only if it is a stable tag, as `updateNoticeModel` does).
 * @param {any} state
 * @param {boolean} pressing
 * @param {string | null} lastAnswer
 * @param {number} now
 * @param {{ time: (ms: number) => string, date: (ms: number) => string }} fmt
 * @returns {{ buttonDisabled: boolean, resultText: string, resultHidden: boolean, lastCheckedText: string }}
 */
export function checkNowView(state, pressing, lastAnswer, now, fmt) {
  try {
    const s = state && typeof state === 'object' ? state : {};
    const unavailable = s.canCheck === false;
    let resultText = '';
    if (pressing) resultText = CHECK_NOW_COPY.checking;
    else if (unavailable || lastAnswer === 'unavailable') resultText = CHECK_NOW_COPY.unavailable;
    else if (lastAnswer === 'newer') {
      // The notice above carries the version; this line only points at it. No claim without a validated
      // offered version (the notice may have cleared since the answer).
      resultText = isStableVersion(s.available) ? CHECK_NOW_COPY.newer : '';
    } else if (lastAnswer === 'current') resultText = CHECK_NOW_COPY.current;
    else if (lastAnswer === 'too-soon') resultText = CHECK_NOW_COPY.tooSoon;
    else if (lastAnswer === 'failed') resultText = CHECK_NOW_COPY.failed;
    /** @type {string} */
    let lastCheckedText = CHECK_NOW_COPY.neverChecked;
    const lc = s.lastCheck;
    if (lc && typeof lc === 'object' && typeof lc.at === 'number' && Number.isFinite(lc.at)) {
      const sameDay = lc.at >= now || new Date(lc.at).toDateString() === new Date(now).toDateString();
      lastCheckedText = sameDay
        ? `Last checked at ${fmt.time(lc.at)}`
        : `Last checked ${fmt.date(lc.at)} at ${fmt.time(lc.at)}`;
    }
    return {
      // A state not yet read (null) disables the button too: it cannot know a check is possible.
      buttonDisabled: pressing || s.canCheck !== true,
      resultText,
      resultHidden: resultText === '',
      lastCheckedText
    };
  } catch {
    return { buttonDisabled: true, resultText: '', resultHidden: true, lastCheckedText: CHECK_NOW_COPY.neverChecked };
  }
}
