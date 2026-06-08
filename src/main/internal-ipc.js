// @ts-check
'use strict';

// Origin-checked internal IPC bridge helpers.
//
// This module is deliberately ELECTRON-FREE (no require('electron') at the top)
// so the pure predicate isTrustedInternalSender can be unit-tested offline without
// an Electron stub. The ipcMain reference is INJECTED into registerInternalHandler
// rather than imported here.

// Chromium/Blink serializes a {standard, secure} scheme's frame origin to
// 'goldfinch://settings' (tuple origin), which is what event.senderFrame.origin
// returns in-process — the correct value to match. Beware: Node's WHATWG
// new URL('goldfinch://settings').origin returns the string 'null' (Node doesn't know
// the scheme is standard, so it treats it as an opaque origin), so a
// `node -e "console.log(new URL('goldfinch://settings').origin)"` sanity check
// will mislead. Do NOT "fix" this constant to match Node's output.
const INTERNAL_ORIGIN = 'goldfinch://settings';

/**
 * Returns true only when both conditions are met:
 *   1. origin is the exact Chromium-serialized tuple origin for goldfinch://settings
 *   2. isInternalSession is strictly === true (not just truthy)
 *
 * null/undefined origin → false. Truthy-but-not-true session (e.g. 1) → false.
 *
 * @param {string | null | undefined} origin
 * @param {unknown} isInternalSession
 * @returns {boolean}
 */
function isTrustedInternalSender(origin, isInternalSession) {
  return origin === INTERNAL_ORIGIN && isInternalSession === true;
}

/**
 * Register an ipcMain.handle channel guarded by isTrustedInternalSender.
 *
 * Extraction path:
 *   event.sender      = the webview's WebContents
 *   event.sender.session = session.fromPartition(INTERNAL_PARTITION), which carries
 *                          __goldfinchInternal = true (set in the session-created hook
 *                          and again post-creation in whenReady as belt-and-suspenders)
 *   event.senderFrame = the frame that sent the IPC; .origin is the Chromium-serialized
 *                       tuple origin string ('goldfinch://settings' for in-process frames
 *                       on the registered privileged scheme).
 *
 * If the sender is not trusted the registered fn THROWS, which Electron translates into
 * a rejected ipcRenderer.invoke() promise on the renderer side.
 *
 * @param {{ handle: (channel: string, fn: (event: any, ...args: any[]) => any) => void }} ipcMain
 * @param {string} channel
 * @param {(event: any, ...args: any[]) => any} handler
 */
function registerInternalHandler(ipcMain, channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    // Extract origin safely: senderFrame may be null if the frame was destroyed
    // mid-IPC (e.g. the webview navigated away). Null frame → null origin → reject.
    const origin = event.senderFrame ? event.senderFrame.origin : null;
    // event.sender is the webview's WebContents; .session is the Session object
    // (fromPartition(INTERNAL_PARTITION)); .__goldfinchInternal is the trusted marker.
    // Pass the RAW value to isTrustedInternalSender so its strict === true check is
    // the single source of truth. Pre-coercing with !! would let a truthy-but-not-true
    // value (e.g. 1) pass the wrapper while the predicate would reject it directly.
    const isInternal = event.sender && event.sender.session ? event.sender.session.__goldfinchInternal : undefined;
    if (!isTrustedInternalSender(origin, isInternal)) {
      throw new Error('forbidden: non-internal sender for ' + channel);
    }
    return handler(event, ...args);
  });
}

module.exports = { INTERNAL_ORIGIN, isTrustedInternalSender, registerInternalHandler };
