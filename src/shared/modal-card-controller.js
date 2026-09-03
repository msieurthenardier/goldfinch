// @ts-check

// Shared modal-card controller for the menu-overlay sheet's DIALOG-STYLE templates
// (M12 Flight 3 first-run-setup, DD5 template-registry / modal-card refactor).
//
// Extracted from the inline vault-unlock / vault-capture wiring in menu-overlay.js so
// the backdrop + Tab-trap + Escape + one-report-token discipline becomes an IMPORTABLE,
// behaviorally unit-testable module (a11y won't run headless; menu-overlay.js is an
// IIFE with no controller test — this is the only real net for the landed F2 unlock UI).
//
// Four exports:
//   createSheetReport(bridge) — the one-report-per-open-token state machine (exactly one
//     of activated / dismissed per token, first send wins), shared module-wide across
//     EVERY sheet template (menu / popup / dialog / suggestions / vault-* alike).
//   createSheetEntry(opts) — the hand-repeated menuController.register sheet-lifecycle
//     scaffolding (show/hide + trailing reportDismissed + no-op focusReturn), extracted
//     from the ~19 near-identical register sites in menu-overlay.js so every sheet's
//     lifecycle envelope becomes IMPORTABLE and unit-testable with mock nodes (F14/F23).
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
    /** Silently adopt a superseding token WITHOUT resetting the once-guard or flavor —
     * the in-place downloads repaint path (M11 F1 Leg 4): the sheet stays open and
     * nothing has activated/dismissed it, so `sent` / `lastStimulus` carry forward
     * (unlike `begin`, which resets them). Keeps a later dismissal reporting against
     * the CURRENT token rather than the stale one it superseded. */
    adoptToken(/** @type {number} */ t) {
      token = t;
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
    }
  };
}

/**
 * Extract the hand-repeated `menuController.register({...})` sheet-lifecycle scaffolding
 * into one importable factory (F14/F23). Wraps an INJECTED `register` (+ injected
 * `reportDismissed`) so it is unit-testable with mock nodes — no real DOM, no
 * menu-overlay IIFE load, no `menuController` global.
 *
 * ENVELOPE COMPOSITION ORDER — load-bearing; this is the primary regression vector.
 * The seam owns only the two invariant edges and lets each sheet keep its variable middle:
 *
 *   OPEN  — the `onOpen` hook owns show (`classList.remove('hidden')`) + focus. The order
 *           of those two varies per sheet (some focus after unhide; the input-dialog
 *           clears `value` BEFORE unhide; `suggestions` never focuses at all), so the
 *           factory owns NOTHING on open — it only forwards the roving start-index
 *           (including the `-1` "focus last" path) through to the hook.
 *   CLOSE — hide (`classList.add('hidden')`) → the `onClose` hook (everything a site does
 *           between hide and report: scrub / field-reset / drop-ref / hideOverflowIndicator)
 *           → `reportDismissed()`. The factory owns ONLY the bracketing hide + the trailing
 *           report; the hook owns the middle.
 *
 * The factory does NOT touch `lastStimulus` — `reportDismissed` already resets it to
 * 'blur' after send, and external dismiss handlers (`picker.close`, the downloads
 * local-keydown, the popup keydown) set the flavor before calling `menuController.close`.
 *
 * `focusReturn` defaults to a no-op — matching every current register site (all pass
 * `focusReturn: () => {}`; none rely on the controller's `else entry.trigger.focus()`
 * path, because every sheet here is a backdrop whose trigger === menu === its own node).
 *
 * @param {{
 *   register: (entry: any) => any,
 *   reportDismissed: () => void,
 *   node: any,
 *   trigger?: any,
 *   menu?: any,
 *   items?: () => any[],
 *   dismissible?: boolean,
 *   survivesBlur?: boolean,
 *   focusReturn?: () => void,
 *   onOpen?: (startIndex?: number) => void,
 *   onClose?: () => void,
 * }} opts
 * @returns {any} the registered menu entry
 */
export function createSheetEntry(opts) {
  const { register, reportDismissed, node } = opts;
  const onOpen = opts.onOpen;
  const onClose = opts.onClose;
  /** @type {any} */
  const entry = {
    trigger: opts.trigger || node,
    menu: opts.menu || node,
    // Forward the roving start-index (incl. the -1 focus-last path) to the sheet hook,
    // which owns show + focus. The factory adds nothing on open.
    onOpen(/** @type {number} */ startIndex) {
      if (onOpen) onOpen(startIndex);
    },
    onClose() {
      node.classList.add('hidden'); // factory-owned hide — idempotent, safe on an already-hidden node
      if (onClose) onClose(); // sheet middle: scrub / field-reset / drop-ref / hideOverflowIndicator
      reportDismissed(); // factory-owned trailing report
    },
    focusReturn: opts.focusReturn || (() => {})
  };
  if (opts.items) entry.items = opts.items;
  if (opts.dismissible !== undefined) entry.dismissible = opts.dismissible;
  // M18 F3 L1 (DD8): same opt-in shape as dismissible above — read by menu-controller.js's
  // window-blur listener. Every current call site that sets it passes `survivesBlur: true`
  // (the vault-credential entries); omitted entirely by every non-vault sheet.
  if (opts.survivesBlur !== undefined) entry.survivesBlur = opts.survivesBlur;
  return register(entry);
}

/**
 * Press-gated backdrop dismiss (HAT FIX 2, M15 F2 Leg 4 HAT fixes — H6). Bug:
 * a text-selection drag that STARTS inside a card and RELEASES on the
 * backdrop synthesizes a `click` whose `target` resolves to the backdrop
 * node (the nearest common ancestor) — a naive `e.target === node` check
 * then dismisses the sheet mid-selection. Fix: gate the dismiss on the PRESS
 * having ALSO started on the backdrop, not just the click's landing target.
 *
 * `pointerdown`, not `mousedown` — the established idiom in this file family
 * (menu-controller.js's document-level outside-dismiss): it fires before
 * focus shifts, and this file family's CDP/automation dismissal clicks
 * dispatch pointerdown→click, so a pointerdown listener observes every real
 * dismissal too.
 *
 * The bug class exists at FOUR sites: `attachModalCard` below, plus three
 * hand-rolled duplicates in menu-overlay.js (new-container dialog,
 * vault-picker, cert-picker) that intentionally do NOT use attachModalCard
 * (it also wires Escape + Tab-cycling, and the vault-picker's roving
 * keyboard contract is documented above as deliberately not using it — a
 * retrofit onto attachModalCard would silently change three sheets'
 * keyboard behavior). This one small helper is used at all four sites
 * instead, leaving every keyboard contract untouched.
 * @param {{ node: any, dismiss: () => void }} opts
 */
export function attachBackdropPressGate({ node, dismiss }) {
  let pressStartedOnBackdrop = false;
  node.addEventListener('pointerdown', (/** @type {any} */ e) => {
    pressStartedOnBackdrop = e.target === node;
  });
  node.addEventListener('click', (/** @type {any} */ e) => {
    const shouldDismiss = pressStartedOnBackdrop && e.target === node;
    pressStartedOnBackdrop = false; // reset unconditionally — both branches
    if (shouldDismiss) dismiss();
  });
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
  const activeElement = opts.activeElement || (() => (node.ownerDocument ? node.ownerDocument.activeElement : null));

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
  // backdrop contains every in-sheet target), so this local handler does. HAT FIX 2:
  // press-gated via attachBackdropPressGate (see its doc comment above) — a
  // text-selection drag starting inside the card and releasing on the backdrop must
  // NOT dismiss.
  attachBackdropPressGate({
    node,
    dismiss: () => {
      if (dismissible) close('outside-click');
    }
  });
}
