'use strict';
// @ts-check

// Sortie 06 Leg 1 (AC14): routes vault-human's `onCaptureDropped` metadata. Electron-free,
// injected deps, unit-testable without a manager. Two independent routes, each tolerant of a
// null owner (tab-close, move and window-close drops can fire after the record is gone):
//   1. to the OWNING window's save-prompt manager (AC6: it flips a SHOWN capture to "expired"
//      unless the drop was its own), ALWAYS;
//   2. owner-routed at event time (CLAUDE.md routing class 3) to that tab's chrome as
//      `vault-capture-dropped { captureId }`, ONLY when the record was released as an offer.
// Never a fan-out.

/**
 * @param {{ captureId: string, wcId: number, offered?: boolean, cause?: string }} info
 * @param {{
 *   managerForTab: (wcId: number) => (any | null | undefined),
 *   chromeForTab: (wcId: number) => (any | null | undefined)
 * }} deps
 */
function routeCaptureDropped({ captureId, wcId, offered, cause }, { managerForTab, chromeForTab }) {
  const manager = managerForTab(wcId);
  if (manager) manager.onCaptureDropped({ captureId, cause });
  if (offered !== true) return;
  const chrome = chromeForTab(wcId);
  if (chrome && !(typeof chrome.isDestroyed === 'function' && chrome.isDestroyed())) {
    chrome.send('vault-capture-dropped', { captureId });
  }
}

module.exports = { routeCaptureDropped };
