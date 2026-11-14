'use strict';

// Per-tab witness of REAL pointer input, and the admission of the vault fill icon's two gesture
// messages against it (Mission 23 Flight 1, leg `vault-fill-trust`, revised DD4). Electron-free: the
// listener that feeds it lives in guest-wiring.js and the clock/zoom/origin come in as arguments.
//
// It records, per tab and ONLY, the last real left-button press, left-button release and right-button
// press (view-local coordinates and a monotonic time) - nothing else about the input, no history.
// `input-event` is not preventable and carries no page code; `before-mouse-event` IS preventable and
// is deliberately not used. Records are keyed by the tab's webContents id, which survives a window
// move, so the record follows the tab; `forget` clears it on tab destruction.
//
// One trace line per admission decision when the trace is on (`GOLDFINCH_IPC_TRACE=1`, supplied by
// the caller as `trace`): never a URL, title, coordinate or item data - the decision only.

const { emptyRecord, verifyGesture } = require('./gesture-verifier');

/** @typedef {import('./gesture-verifier').GestureKind} GestureKind */

/**
 * @param {{ now?: () => number, trace?: (line: string) => void }} [deps]
 */
function createGestureWitness({ now = () => performance.now(), trace = () => {} } = {}) {
  /** @type {Map<number, { record: import('./gesture-verifier').WitnessRecord, lastAccepted: { gesture: number | null, 'icon-menu': number | null } }>} */
  const tabs = new Map();

  /** @param {number} wcId */
  function stateFor(wcId) {
    let s = tabs.get(wcId);
    if (!s) {
      s = { record: emptyRecord(), lastAccepted: { gesture: null, 'icon-menu': null } };
      tabs.set(wcId, s);
    }
    return s;
  }

  /**
   * Feed one `input-event`. Every event type that is not a mouse press or release returns on the first
   * line (the listener fires for every input the guest receives, including each mouse move).
   * @param {number} wcId
   * @param {any} input  Electron's `InputEvent`
   */
  function onInput(wcId, input) {
    if (!input || (input.type !== 'mouseDown' && input.type !== 'mouseUp')) return;
    const isLeft = input.button === 'left';
    const isRight = input.button === 'right';
    if (!isLeft && !isRight) return;
    if (isRight && input.type !== 'mouseDown') return;
    const { x, y } = input;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return;
    const stamp = { x, y, t: now() };
    const { record } = stateFor(wcId);
    if (isRight) record.rightDown = stamp;
    else if (input.type === 'mouseDown') record.leftDown = stamp;
    else record.leftUp = stamp;
  }

  /**
   * Decide one gesture message against the witnessed input. On acceptance the witnessed click is
   * CONSUMED (one real click raises at most one sheet) and the rate clock starts; a refusal consumes
   * nothing (a bogus message sent first must not burn the operator's real click).
   * @param {{ kind: GestureKind, wcId: number, message: unknown, zoom: number, origin: string | null }} arg
   * @returns {{ ok: true } | { ok: false, reason: string }}
   */
  function admit({ kind, wcId, message, zoom, origin }) {
    const label = kind === 'icon-menu' ? '[vault-icon-menu]' : '[vault-gesture]';
    const s = tabs.get(wcId);
    const t = now();
    const decision = verifyGesture({
      kind,
      record: s ? s.record : null,
      message,
      zoom,
      now: t,
      origin,
      lastAcceptedAt: s ? s.lastAccepted[kind] : null
    });
    if (!decision.ok) {
      const refusal = /** @type {any} */ (decision);
      trace(`${label} refused reason=${refusal.reason}`);
      return decision;
    }
    // A state exists: an accepted verdict needs a witnessed record.
    const st = /** @type {NonNullable<typeof s>} */ (s);
    if (kind === 'icon-menu') st.record.rightDown = null;
    else {
      st.record.leftDown = null;
      st.record.leftUp = null;
    }
    st.lastAccepted[kind] = t;
    trace(`${label} accepted`);
    return decision;
  }

  /** Clear a tab's record (tab destroyed). @param {number} wcId */
  function forget(wcId) {
    tabs.delete(wcId);
  }

  return { onInput, admit, forget, _size: () => tabs.size };
}

module.exports = { createGestureWitness };
