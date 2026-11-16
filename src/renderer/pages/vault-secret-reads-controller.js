// @ts-check
// The vault page's SECRET READS (Mission 23 Flight 2, leg `admin-reach`, flight DD2): the per-field Reveal,
// the per-field Copy and the live one-time-code widget. Each asks the bridge for a secret, and while an admin
// automation session is attached (or script it ran is still alive in this page) main answers with a native
// confirmation first - so each can come back REFUSED (`{ refused: 'not-confirmed' }`, or for a code read
// `{ code: null, refused: 'not-confirmed' }`) and must take that as a normal answer: stay hidden, write nothing
// to the clipboard, and stop asking. No static import (injected deps, the vault-item-actions-controller
// shape), so the shipped file runs under `node --test` against a mock DOM.

/** The status line for a refused read. */
export const REFUSED_TEXT = 'Not shown - the confirmation was not given.';
/** The status line when ANOTHER confirmation was open (nobody was asked; a later try may succeed). */
export const BUSY_TEXT = 'Not confirmed - try again.';
/** How long the code widget waits before asking again after a busy answer. */
export const BUSY_RETRY_MS = 5000;
/** The status line for a reply the page did not expect (neither a secret nor a refusal). */
export const UNEXPECTED_TEXT = 'Could not read this item.';

/**
 * A refusal: main asked the operator and the answer was not "yes" (or no one could be asked).
 * @param {any} res
 */
export function isRefused(res) {
  return !!res && typeof res === 'object' && res.refused === 'not-confirmed';
}

/**
 * A refusal because another confirmation was open, or one was cancelled by the browser (tab not in front, input to the window) (`busy: true` rides beside the usual
 * `refused: 'not-confirmed'`): not a decision by the operator, so it never latches anything.
 * @param {any} res
 */
export function isBusy(res) {
  return isRefused(res) && res.busy === true;
}

/**
 * Classify a `vaultReveal` reply. `item` present (even null - a deleted item) is the success shape;
 * anything else is neither a secret nor a lock, and is never read as "revealed and empty".
 * @param {any} res
 * @param {string} name  the secret field
 * @returns {{ kind: 'locked' } | { kind: 'busy' } | { kind: 'refused' } | { kind: 'unexpected' } | { kind: 'secret', secret: string }}
 */
export function classifyReveal(res, name) {
  if (!res || res.locked) return { kind: 'locked' };
  if (isBusy(res)) return { kind: 'busy' };
  if (isRefused(res)) return { kind: 'refused' };
  if (typeof res !== 'object' || !('item' in res)) return { kind: 'unexpected' };
  const item = res.item;
  return { kind: 'secret', secret: item && item[name] != null ? String(item[name]) : '' };
}

/**
 * Reveal one field: on a secret, hand it to `onSecret`; on a refusal or an unexpected reply the field STAYS
 * HIDDEN and `announce` says why.
 * @param {{
 *   bridge: { vaultReveal: (p: { vaultId: string, itemId: string }) => Promise<any> },
 *   vaultId: string, itemId: string, name: string,
 *   onSecret: (secret: string) => void,
 *   refresh: () => void,
 *   announce: (text: string) => void
 * }} deps
 * @returns {Promise<void>}
 */
export function revealField({ bridge, vaultId, itemId, name, onSecret, refresh, announce }) {
  return Promise.resolve(bridge.vaultReveal({ vaultId, itemId }))
    .then((res) => {
      const c = classifyReveal(res, name);
      if (c.kind === 'locked') return refresh();
      if (c.kind === 'busy') return announce(BUSY_TEXT);
      if (c.kind === 'refused') return announce(REFUSED_TEXT);
      if (c.kind === 'unexpected') return announce(UNEXPECTED_TEXT);
      announce('');
      onSecret(c.secret);
    })
    .catch(() => {});
}

/**
 * Copy one field: a secret goes to the clipboard (marked `{ secret: true }` so main auto-clears it); a
 * refusal or an unexpected reply writes NOTHING - never an empty string over the operator's clipboard.
 * @param {{
 *   bridge: { vaultReveal: (p: { vaultId: string, itemId: string }) => Promise<any>, clipboardWrite: (t: string, o: { secret: boolean }) => any },
 *   vaultId: string, itemId: string, name: string,
 *   refresh: () => void,
 *   announce: (text: string) => void
 * }} deps
 * @returns {Promise<void>}
 */
export function copyField({ bridge, vaultId, itemId, name, refresh, announce }) {
  return Promise.resolve(bridge.vaultReveal({ vaultId, itemId }))
    .then((res) => {
      const c = classifyReveal(res, name);
      if (c.kind === 'locked') return refresh();
      if (c.kind === 'busy') return announce(BUSY_TEXT);
      if (c.kind === 'refused') return announce(REFUSED_TEXT);
      if (c.kind === 'unexpected') return announce(UNEXPECTED_TEXT);
      announce('');
      bridge.clipboardWrite(c.secret, { secret: true });
    })
    .catch(() => {});
}

/**
 * The live one-time-code poller behind the editor's code widget. Counts down locally each second and
 * re-fetches on the period boundary; stops while the page is hidden or the window is blurred.
 *
 * A REFUSAL is handled BEFORE the `stopped` check and LATCHES `denied` (a `busy` answer excepted: it retries): `start()`, the focus handler and the
 * visibility handler all respect it. A native confirmation blurs the window, so without the latch the widget
 * would ask again on every refocus, forever. A CONFIRMED reply that arrives while `stopped` (the dialog's own
 * blur) is not discarded: it is shown, and the countdown resumes when the window regains focus. At most one
 * request is in flight at a time, so a refocus that races the reply never raises a second dialog.
 * @param {{
 *   bridge: { vaultTotpCode: (p: { vaultId: string, itemId: string }) => Promise<any> },
 *   vaultId: string, itemId: string,
 *   codeEl: { textContent: string | null }, countEl: { textContent: string | null },
 *   refresh: () => void,
 *   announce: (text: string) => void,
 *   setTimer?: (fn: () => void, ms: number) => any,
 *   clearTimer?: (h: any) => void
 * }} deps
 */
export function createTotpPoller({
  bridge,
  vaultId,
  itemId,
  codeEl,
  countEl,
  refresh,
  announce,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h)
}) {
  let stopped = false;
  let denied = false;
  let inFlight = false;
  let secondsRemaining = 0;
  /** @type {any} */
  let timer = null;

  function clearPending() {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  function tick() {
    if (stopped) return;
    countEl.textContent = `${secondsRemaining}s`;
    clearPending();
    if (secondsRemaining <= 0) {
      fetchCode();
      return;
    } // period boundary -> re-fetch.
    timer = setTimer(() => {
      secondsRemaining -= 1;
      tick();
    }, 1000);
  }

  function fetchCode() {
    if (denied || inFlight) return;
    inFlight = true;
    Promise.resolve(bridge.vaultTotpCode({ vaultId, itemId }))
      .then((res) => {
        inFlight = false;
        // A BUSY answer (another dialog was open) is not a decision: no latch. Show the dash and ask again
        // shortly (or on the next focus, if the dialog's own blur stopped the widget).
        if (isBusy(res)) {
          clearPending();
          codeEl.textContent = '—';
          countEl.textContent = '';
          if (!stopped) timer = setTimer(fetchCode, BUSY_RETRY_MS);
          return;
        }
        // A refusal first, before any `stopped` check: latch, say so, and never ask again.
        if (isRefused(res)) {
          denied = true;
          clearPending();
          codeEl.textContent = '—';
          countEl.textContent = '';
          announce(REFUSED_TEXT);
          return;
        }
        if (!res || res.locked) {
          if (!stopped) refresh();
          return;
        } // idle-lock mid-poll -> unlock path.
        if (res.code == null) {
          codeEl.textContent = '—';
          countEl.textContent = '';
          return;
        }
        codeEl.textContent = res.code;
        secondsRemaining = typeof res.secondsRemaining === 'number' ? res.secondsRemaining : 0;
        tick(); // a no-op while stopped; `start()` re-fetches (no dialog: the item is already confirmed)
      })
      .catch(() => {
        inFlight = false;
      });
  }

  function start() {
    if (!stopped) return; // already running
    if (denied) return;
    stopped = false;
    fetchCode();
  }
  function stop() {
    stopped = true;
    clearPending();
  }

  return {
    /** Begin polling (the widget's first fetch). */
    begin: fetchCode,
    start,
    stop,
    /** The window / page came back: resume unless a refusal latched. */
    onFocus: start,
    onBlur: stop,
    /** @param {boolean} hidden */
    onVisibility: (hidden) => (hidden ? stop() : start()),
    isDenied: () => denied,
    isStopped: () => stopped
  };
}
