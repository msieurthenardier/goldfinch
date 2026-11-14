// @ts-check
'use strict';

// Per-tab media-proxy tokens. The chrome loads page media through `goldfinch-media://proxy/<token>/<url>`;
// the proxy fetches through the session of the tab the token names. A token is therefore a capability for
// one tab's session, so it is unguessable (192 bits, base64url), it is never sent to a guest, it is never
// logged, and it belongs to ONE DOCUMENT: the main frame's frame token at the time it was minted.
//
// Electron-free and injectable (`randomBytes`), so the lifecycle runs under `node --test`.
//
// Rules (the unit matrix pins each):
//  - `issue` is called on every media list. The list's sender frame must be the tab's CURRENT main frame
//    (both frame tokens present and equal), else nothing is issued - a late list from a document that has
//    already been replaced is dropped, never handed the new document's token.
//  - The stored token is reused while the document is the same; a new document gets a new token and the
//    old reverse entry is deleted.
//  - `onCommit` (did-navigate, main frame, cross-document - a reload included) invalidates the token
//    unless it was already minted for the document that is now current (a list that arrived before the
//    commit event). It fails closed when the current frame token cannot be read.
//  - `forget` (webContents destroyed) drops the tab. The token follows the webContents across a window move.
//  - `resolve` is the ONLY authority the proxy handler asks: unknown, replaced and decimal-tab-number
//    addresses all resolve to `null`.

const crypto = require('node:crypto');

/** Random bytes per token (24 bytes = 192 bits = 32 base64url characters). */
const TOKEN_BYTES = 24;

/**
 * @param {{ randomBytes?: (n: number) => Buffer }} [deps]
 */
function createMediaProxyTokens({ randomBytes = crypto.randomBytes } = {}) {
  /** @type {Map<number, { token: string, frameToken: string }>} */
  const byTab = new Map();
  /** @type {Map<string, number>} */
  const byToken = new Map();

  /** @param {number} wcId */
  function drop(wcId) {
    const rec = byTab.get(wcId);
    if (!rec) return;
    byTab.delete(wcId);
    byToken.delete(rec.token);
  }

  /**
   * @param {number} wcId
   * @param {unknown} senderFrameToken
   * @param {unknown} mainFrameToken
   * @returns {string | null} the tab's token for the current document, or null (drop the list)
   */
  function issue(wcId, senderFrameToken, mainFrameToken) {
    if (typeof senderFrameToken !== 'string' || senderFrameToken === '') return null;
    if (typeof mainFrameToken !== 'string' || mainFrameToken === '') return null;
    if (senderFrameToken !== mainFrameToken) return null;
    const rec = byTab.get(wcId);
    if (rec && rec.frameToken === mainFrameToken) return rec.token;
    if (rec) drop(wcId);
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    byTab.set(wcId, { token, frameToken: mainFrameToken });
    byToken.set(token, wcId);
    return token;
  }

  /**
   * A cross-document main-frame commit on the tab.
   * @param {number} wcId
   * @param {unknown} currentMainFrameToken
   */
  function onCommit(wcId, currentMainFrameToken) {
    const rec = byTab.get(wcId);
    if (!rec) return;
    if (typeof currentMainFrameToken === 'string' && rec.frameToken === currentMainFrameToken) return;
    drop(wcId);
  }

  /** @param {number} wcId */
  function forget(wcId) {
    drop(wcId);
  }

  /**
   * @param {unknown} token
   * @returns {number | null}
   */
  function resolve(token) {
    if (typeof token !== 'string') return null;
    const wcId = byToken.get(token);
    return wcId === undefined ? null : wcId;
  }

  return { issue, onCommit, forget, resolve };
}

module.exports = { createMediaProxyTokens, TOKEN_BYTES };
