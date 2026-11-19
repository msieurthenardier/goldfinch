'use strict';

// Shared fixture for unit tests that construct a registrar owning a gated handler (Mission 23 Flight 2,
// leg `admin-reach`). It builds a REAL reveal gate (`src/main/reveal-gate.js`) around fakes - never a stub
// that always says yes - so a handler called through it takes the real decision path.
//
//   const rg = makeTestRevealGate();                     // not applicable: no admin session, nothing marked
//   const rg = makeTestRevealGate({ admin: true });      // an admin session is attached
//   registerXIpc({ ..., revealGate: rg.gate });
//   const p = handler(rg.event(7), arg);                  // an event from tab 7's main frame
//   rg.dialogs[0].answer(1);                              // the operator picks the affirmative button
//   rg.navigate(7);                                       // tab 7 commits a new document
//
// Fakes: one "window" object per sender id (`rg.windowOf(7)`); `showConfirm` records each dialog's options
// and signal and settles on `answer(index)`, or (like Electron) resolves on abort with the cancel index; a
// `neverSettles` option models a dialog whose window closed and never settles.

const { createRevealGate, createDocumentMarks } = require('../../src/main/reveal-gate');

/**
 * @param {{ admin?: boolean, scripted?: number[], neverSettles?: boolean, trace?: (line: string) => void,
 *           setTimeout?: any, clearTimeout?: any, hasWindow?: (id: number) => boolean,
 *           isActive?: (sender: any) => boolean, sameWindow?: boolean, now?: () => number }} [opts]
 */
function makeTestRevealGate(opts = {}) {
  const state = { admin: opts.admin === true };
  const marks = createDocumentMarks();
  for (const id of opts.scripted || []) marks.markScripted(id);
  /** @type {Map<number, any>} */
  const windows = new Map();
  /** @type {Array<{ options: any, signal: AbortSignal, win: any, answer: (i: number) => void }>} */
  const dialogs = [];
  /** @type {Array<{ senderId: number, win: any, onGone: () => void }>} */
  const watchers = [];
  const lines = [];

  /** @param {number} id */
  const windowOf = (id) => {
    if (opts.sameWindow) id = 0;
    if (!windows.has(id)) windows.set(id, { id: `win-${id}` });
    return windows.get(id);
  };

  const gate = createRevealGate({
    hasAdminSession: () => state.admin,
    isTouched: (wcId) => marks.isScripted(wcId),
    hasGrant: (wcId, key) => marks.hasGrant(wcId, key),
    addGrant: (wcId, key, epoch) => marks.grant(wcId, key, epoch),
    grantEpoch: () => marks.epoch(),
    dropGrant: (key) => marks.dropGrant(key),
    noteWrite: (key, title, o) => marks.noteWrite(key, title, o),
    writeNote: (key) => marks.writeNote(key),
    clearWriteNote: (key) => marks.clearWriteNote(key),
    clearAllGrants: () => marks.clearGrants(),
    windowFor: (sender) => (opts.hasWindow && !opts.hasWindow(sender.id) ? null : windowOf(sender.id)),
    showConfirm: (win, options, signal) =>
      new Promise((resolve) => {
        const entry = {
          options,
          signal,
          win,
          answer: (/** @type {number} */ i) =>
            resolve({ response: i, cancelId: options.cancelId, checkboxChecked: false })
        };
        dialogs.push(entry);
        if (opts.neverSettles) return;
        signal.addEventListener('abort', () => resolve({ cancelId: options.cancelId, checkboxChecked: false }), {
          once: true
        });
        if (signal.aborted) resolve({ cancelId: options.cancelId, checkboxChecked: false });
      }),
    watch: (sender, win, onGone) => {
      const w = { senderId: sender.id, win, onGone };
      watchers.push(w);
      return () => {
        const i = watchers.indexOf(w);
        if (i >= 0) watchers.splice(i, 1);
      };
    },
    ...(opts.isActive ? { isActive: opts.isActive } : {}),
    ...(opts.now ? { now: opts.now } : {}),
    ...(opts.setTimeout ? { setTimeout: opts.setTimeout } : {}),
    ...(opts.clearTimeout ? { clearTimeout: opts.clearTimeout } : {}),
    trace: opts.trace || ((line) => lines.push(line))
  });

  return {
    gate,
    marks,
    dialogs,
    lines,
    watchers,
    state,
    windowOf,
    /** An IPC event from tab `id`'s MAIN frame. */
    event: (/** @type {number} */ id = 7, extra = {}) => ({
      sender: { id, mainFrame: { frameTreeNodeId: 1 } },
      senderFrame: { frameTreeNodeId: 1, origin: 'goldfinch://vault' },
      ...extra
    }),
    /** The sender's main-frame commit: every watcher for it fires and the document's marks drop. */
    navigate(/** @type {number} */ id) {
      marks.onCommit(id);
      for (const w of [...watchers]) if (w.senderId === id) w.onGone();
    },
    /** The sender's window is about to close. */
    closeWindow(/** @type {number} */ id) {
      for (const w of [...watchers]) if (w.senderId === id) w.onGone();
    }
  };
}

module.exports = { makeTestRevealGate };
