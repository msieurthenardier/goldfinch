// @ts-check
'use strict';

// F7 DD4 — pick a desktopCapturer source by WINDOW IDENTITY.
//
// This module is deliberately ELECTRON-FREE: it takes the already-fetched sources
// array and a mediaSourceId string, so the selection rule is unit-testable offline
// with plain fakes. That matters more here than anywhere else in the flight —
// recon S2: main.js skips the whole desktopCapturer branch under Wayland and
// `dev:automation` selects Wayland, so THE CALLER IS DEAD CODE ON THE DEV RIG.
// This module's unit test is DD4's only rig-provable half; the cross-platform half
// is HAT/operator-scoped on a non-Wayland desktop. No test may claim live proof of
// a fix the rig cannot reproduce.
//
// What this replaces: a best-size-match scoring loop that picked whichever source
// had the largest area overlap with the window's bounds. With two similar-sized
// windows open it could grab an UNRELATED window and report success — "capture *a*
// window that happens to be the same size" is not a contract, and the exact
// identity is on the record (BaseWindow.getMediaSourceId(), electron.d.ts:2809).

/**
 * @typedef {{ id?: string, name?: string, thumbnail?: any, [k: string]: any }} SourceLike
 */

/**
 * The source whose id EXACTLY equals mediaSourceId, or null.
 *
 * ONE SEMANTIC: exact match or null. There is deliberately NO scoring, NO
 * "closest", and NO fallback — that is the whole point of DD4. A miss is a miss;
 * the caller falls through to its composite path, which is already correctly bound
 * to the resolved record. Returning a "best effort" source here would re-introduce
 * precisely the bug this module exists to delete, and it would do so silently.
 *
 * Tolerant of a null/empty sources array and of sources lacking an id (skipped),
 * so a malformed capturer response yields null rather than throwing mid-capture.
 *
 * @param {SourceLike[] | null | undefined} sources  desktopCapturer.getSources() result
 * @param {string | null | undefined} mediaSourceId  win.getMediaSourceId()
 * @returns {SourceLike | null}  the identity-matched source, or null
 */
function pickSourceByMediaSourceId(sources, mediaSourceId) {
  if (typeof mediaSourceId !== 'string' || mediaSourceId.length === 0) return null;
  for (const src of sources || []) {
    if (!src || typeof src.id !== 'string') continue; // malformed entry — skip, never throw
    if (src.id === mediaSourceId) return src;
  }
  return null;
}

module.exports = { pickSourceByMediaSourceId };
