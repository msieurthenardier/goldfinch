'use strict';

// Shared fixture for unit tests that construct a registrar module (Mission 23 Flight 1, leg
// `ipc-gate`). It builds a REAL gate (`src/main/ipc-gate.js`, the real classification table)
// around a test's own fake `ipcMain` and registry, so a handler fetched from the fake map and
// called with a hand-built event goes through the gate's sender check — never a stub that
// skips it.
//
//   const gate = makeTestGate({ ipcMain, registry });
//   registerXIpc({ ipcMain, gate, registry, ... });
//   handlers.get('channel')(chromeEvent(chromeSender), arg)   // accepted
//   handlers.get('channel')({ sender: pageSender, senderFrame: {} }, arg)   // refused

const { createIpcGate } = require('../../src/main/ipc-gate');

/**
 * An event as Electron delivers it from `sender`'s main frame.
 * @param {any} sender
 * @param {Record<string, any>} [extra]
 */
function eventFrom(sender, extra = {}) {
  return { sender, senderFrame: { origin: 'file://' }, ...extra };
}

/**
 * An event as Electron delivers it from a TAB GUEST's main frame: the sender carries its `id` and
 * a `mainFrame`, and `senderFrame` is that same frame (matched by frame-tree node id). Pass
 * `extra.senderFrame` to model a subframe or a disposed frame (`null`).
 * @param {number} id
 * @param {Record<string, any>} [extra]
 */
function guestEvent(id, extra = {}) {
  return {
    // `frameToken` is the document identity the media-proxy token is bound to (leg `jar-isolation`).
    sender: { id, mainFrame: { frameTreeNodeId: 1, frameToken: 'doc-1' } },
    senderFrame: { frameTreeNodeId: 1, frameToken: 'doc-1', origin: 'https://page.test' },
    ...extra
  };
}

/**
 * Wrap a fake `ipcMain` so every registered listener receives an event whose `senderFrame`
 * defaults to a frame (an event that states `senderFrame` explicitly — even `null` — keeps it).
 * Opt-in (`autoFrame`) for the older registrar suites that drive handlers with a bare
 * `{ sender }` and are not about the frame check.
 * @param {{ handle?: Function, on?: Function }} ipcMain
 */
function withDefaultFrame(ipcMain) {
  /** @param {Function} fn */
  const wrap =
    (fn) =>
    (/** @type {any} */ event, /** @type {any[]} */ ...args) =>
      fn(
        event && typeof event === 'object' && !('senderFrame' in event) ? { senderFrame: {}, ...event } : event,
        ...args
      );
  return {
    handle: (/** @type {string} */ channel, /** @type {Function} */ fn) => ipcMain.handle?.(channel, wrap(fn)),
    on: (/** @type {string} */ channel, /** @type {Function} */ fn) => ipcMain.on?.(channel, wrap(fn))
  };
}

/**
 * @param {{
 *   ipcMain: { handle: Function, on: Function },
 *   registry: any,
 *   env?: Record<string, string | undefined>,
 *   logger?: any,
 *   autoFrame?: boolean,
 *   isPopupWcId?: (id: number) => boolean
 * }} deps
 */
function makeTestGate({ ipcMain, registry, env = {}, logger = { log() {} }, autoFrame = false, isPopupWcId }) {
  return createIpcGate({
    ipcMain: autoFrame ? withDefaultFrame(ipcMain) : ipcMain,
    registry,
    env,
    logger,
    isPopupWcId
  });
}

/**
 * A minimal registry fake: `chromeSender` is the one window's chrome; `owned` is the set of
 * tab ids that window owns. Extra methods may be supplied (they win).
 * @param {{ chromeSender: any, owned?: Iterable<number>, record?: any, extra?: Record<string, any> }} opts
 */
function makeFakeRegistry({ chromeSender, owned = [], record = { id: 1, tabViews: new Map() }, extra = {} }) {
  const ownedSet = new Set(owned);
  return {
    getWindowForChrome: (/** @type {any} */ sender) => (sender === chromeSender ? record : null),
    getWindowForGuest: (/** @type {number} */ wcId) => (ownedSet.has(wcId) ? record : null),
    ...extra
  };
}

module.exports = { eventFrom, guestEvent, makeTestGate, makeFakeRegistry };
