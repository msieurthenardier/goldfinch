// @ts-check

// Shared modal-card controller for the menu-overlay sheet's DIALOG-STYLE templates
// (M12 Flight 3 first-run-setup, DD5 template-registry / modal-card refactor).
//
// Extracted from the inline vault-unlock / vault-capture wiring in menu-overlay.js so
// the backdrop + Tab-trap + Escape + one-report-token discipline becomes an IMPORTABLE,
// behaviorally unit-testable module (a11y won't run headless; menu-overlay.js is an
// IIFE with no controller test — this is the only real net for the landed F2 unlock UI).
//
// Two exports:
//   createSheetReport(bridge) — the one-report-per-open-token state machine (exactly one
//     of activated / dismissed per token, first send wins), shared module-wide across
//     EVERY sheet template (menu / popup / dialog / suggestions / vault-* alike).
//   attachModalCard(opts) — wires a backdrop-card node's dialog-local keyboard (Escape +
//     Tab-cycle) + backdrop-click dismissal onto a menu-controller entry. PARAMETERIZES
//     dismissibility: vault-recovery-show passes { dismissible: false } so Escape /
//     backdrop / blur cannot close it (the one-time recovery key is unrecoverable).
//
// The roving vault-picker does NOT use attachModalCard — its keyboard contract is the
// shared menu-controller roving-tabindex path, not a dialog-local Tab-cycle.

/**
 * The one-report-per-open-token discipline. `token` is the live open token this render
 * answers for (null = none); `sent` guards exactly one activated/dismissed per token;
 * `lastStimulus` is the dismissal flavor (defaults to / resets to 'blur' — the flavor
 * chrome's re-click suppress window keys on). Extracted so the state machine is unit-
 * testable against a fake bridge without a live sheet.
 * @param {{ sendActivated: (payload: any) => void, sendDismissed: (payload: any) => void }} bridge
 */
export function createSheetReport(bridge) {
  /** @type {number | null} */
  let token = null;
  let sent = false;
  let lastStimulus = 'blur';

  return {
    /** Begin a new open: adopt the token, reset the once-guard + flavor. */
    begin(/** @type {number} */ t) {
      token = t;
      sent = false;
      lastStimulus = 'blur';
    },
    /** Null the live token (the pre-render null-out): a closing entry's onClose then
     * reports nothing — the superseded menu's channel-7 was already emitted by main. */
    silence() {
      token = null;
    },
    get token() {
      return token;
    },
    get sent() {
      return sent;
    },
    set sent(v) {
      sent = v;
    },
    get lastStimulus() {
      return lastStimulus;
    },
    set lastStimulus(v) {
      lastStimulus = v;
    },
    /** Report the dismissal for the live token — UNLESS an activation already reported
     * for it (activation wins) or no token is live (silent rebuild / model-replace).
     * Resets the flavor to 'blur' after every send. */
    reportDismissed() {
      if (!sent && token != null) {
        sent = true;
        bridge.sendDismissed({ reason: lastStimulus, token });
      }
      lastStimulus = 'blur';
    },
    /** One-shot activated send (first send wins over the onClose dismissal).
     * @param {{ id: string, value?: string }} payload @returns {boolean} */
    sendActivatedOnce(payload) {
      if (sent || token == null) return false;
      sent = true;
      bridge.sendActivated(Object.assign({}, payload, { token }));
      return true;
    },
  };
}

/**
 * Wire a backdrop-card node's dialog-local Escape + Tab-cycle + backdrop-click dismissal.
 * Escape and backdrop-click close ONLY when `dismissible` (default true) — a
 * non-dismissible card (vault-recovery-show) swallows both. Tab-cycling always traps
 * (never leaks focus out of the sheet). `close(stimulus)` is supplied by the caller and
 * sets the shared lastStimulus + calls menuController.close(entry).
 *
 * @param {{
 *   node: any,
 *   getCycle: () => any[],
 *   close: (stimulus: string) => void,
 *   dismissible?: boolean,
 *   activeElement?: () => any,
 * }} opts
 */
export function attachModalCard(opts) {
  const { node, getCycle, close } = opts;
  const dismissible = opts.dismissible !== false;
  const activeElement =
    opts.activeElement || (() => (node.ownerDocument ? node.ownerDocument.activeElement : null));

  node.addEventListener('keydown', (/** @type {any} */ e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      if (dismissible) close('escape');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const cycle = getCycle();
      if (!cycle || !cycle.length) return;
      const i = cycle.indexOf(activeElement());
      const n = (i + (e.shiftKey ? -1 : 1) + cycle.length) % cycle.length;
      cycle[n].focus();
    }
  });

  // Backdrop click (outside the card) dismisses — parity with the inline input-dialog /
  // vault-unlock backdrops. The controller's global pointerdown can't own it (the
  // backdrop contains every in-sheet target), so this local handler does.
  node.addEventListener('click', (/** @type {any} */ e) => {
    if (e.target === node && dismissible) close('outside-click');
  });
}
