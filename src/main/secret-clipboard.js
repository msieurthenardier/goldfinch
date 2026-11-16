'use strict';

// The one place the OS clipboard is written from main (leg `clipboard-and-file-modes`, flight DD7).
// Electron-free: the clipboard and the timer functions are injected.
//
// A SECRET write arms one clear, `CLIPBOARD_SECRET_CLEAR_MS` later; a later write of any kind
// replaces the pending clear (a later secret arms its own, a later plain write cancels it - the
// clipboard no longer holds the secret). The timed clear and `flush()` (called first in
// `before-quit`) share ONE routine: read the clipboard and clear it only if it still holds EXACTLY
// the text we wrote. If the read throws, or holds anything else, the routine SKIPS - it never
// clears blind, because wiping an unrelated copy is worse than leaving a secret the operator
// copied on purpose.
//
// Electron 45's `clipboard.readText()` / `writeText()` return PROMISES (measured, leg AC1; the
// pre-leg inline code compared the promise to the string, so its clear never fired). The routine
// awaits the read, which also works with a synchronous fake.

const CLIPBOARD_SECRET_CLEAR_MS = 20000;

/**
 * @param {{
 *   clipboard: { writeText: (t: string) => any, readText: () => any, clear: () => any },
 *   setTimer?: (fn: () => void, ms: number) => any,
 *   clearTimer?: (t: any) => void,
 *   clearMs?: number,
 *   logger?: { error?: (...a: any[]) => void }
 * }} deps
 */
function createSecretClipboard({
  clipboard,
  // Late-bound so a test enabling MockTimers after construction still drives them.
  setTimer = (/** @type {any[]} */ ...a) => /** @type {any} */ (setTimeout)(...a),
  clearTimer = (/** @type {any} */ t) => clearTimeout(t),
  clearMs = CLIPBOARD_SECRET_CLEAR_MS,
  logger = console
}) {
  /** @type {{ text: string, timer: any } | null} */
  let pending = null;
  let generation = 0;

  function cancel() {
    if (pending !== null) {
      clearTimer(pending.timer);
      pending = null;
    }
  }

  /** @param {{ text: string }} entry @param {number} gen */
  async function clearIfHolds(entry, gen) {
    try {
      const current = await clipboard.readText();
      // A write that landed while the read was in flight owns the clipboard now.
      if (gen !== generation) return false;
      if (current !== entry.text) return false;
      // `clear()` returns a promise in Electron 45: awaited, so the result reflects completion and a
      // rejection is caught here rather than left unhandled.
      await clipboard.clear();
      return true;
    } catch (error) {
      logger.error?.('[secret-clipboard] clear skipped or failed:', error);
      return false;
    }
  }

  /** @param {string} text @param {{ secret?: boolean }} [opts] */
  function write(text, opts) {
    const value = String(text == null ? '' : text);
    cancel();
    generation += 1;
    try {
      const result = clipboard.writeText(value);
      if (result && typeof result.catch === 'function') {
        result.catch((/** @type {unknown} */ error) => logger.error?.('[secret-clipboard] write failed:', error));
      }
    } catch (error) {
      logger.error?.('[secret-clipboard] write failed:', error);
    }
    if (opts && opts.secret === true) {
      const entry = { text: value, timer: /** @type {any} */ (null) };
      const gen = generation;
      entry.timer = setTimer(() => {
        if (pending === entry) pending = null;
        void clearIfHolds(entry, gen);
      }, clearMs);
      if (entry.timer && typeof entry.timer.unref === 'function') entry.timer.unref();
      pending = entry;
    }
  }

  /** Runs the pending clear now. Idempotent; touches the clipboard only when a clear is pending. */
  function flush() {
    if (pending === null) return Promise.resolve(false);
    const entry = pending;
    cancel();
    return clearIfHolds(entry, generation);
  }

  return { write, flush };
}

module.exports = { createSecretClipboard, CLIPBOARD_SECRET_CLEAR_MS };
