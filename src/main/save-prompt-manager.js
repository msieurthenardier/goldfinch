'use strict';
// @ts-check

// Corner save-prompt lifecycle + timer state machine (Sortie 06 Leg 1; flight DD1/DD4/DD5/DD6).
// Electron-free: every live Electron handle is injected (the find-overlay-manager /
// menu-overlay-manager precedent), so this module is `node --test`-able with fakes and never
// imports Electron. window-factory.js constructs ONE instance PER WINDOW and stores it on that
// window's registry record (`rec.savePrompt`); deps close over THAT window's record/handles, so
// two windows' prompts can never see each other's blur/focus/sheet/tab events.
//
// Injected deps:
//   - getContentView(): THIS window's contentView (null when the window is gone).
//   - createView(): constructs the transparent chrome-class WebContentsView (Electron
//     construction stays in window-factory.js).
//   - getActiveGuestBounds(): THIS window's LIVE active-guest DIP bounds (null when none).
//   - isFindVisible() / isSheetVisible() / isFullscreen(): live reads of the sibling overlay
//     state. MAIN is the authority on "a sheet is visible" (DD1/N4): `present()` REFUSES, it
//     never queues; the chrome queue owns deferral.
//   - computeBounds(args): the pure save-prompt-geometry helper.
//   - chromeZoomFactor(): the chrome webContents' LIVE zoom factor. The chrome sends the vault
//     indicator's right edge in CSS px; MAIN converts to DIP with this (no chrome-supplied
//     scale is trusted).
//   - sendToChrome(channel, payload): class-1b emitter to THIS window's chrome.
//   - captureSave({captureId, vaultId}) / captureDismiss(captureId): the vault-human delegates.
//   - focusActiveGuest(): boolean - focus THIS window's active guest through the shared
//     `focus-active-guest.js` predicate (refuses a taken-over/destroyed guest; never throws).
//   - setTimeout / clearTimeout / now: injectable clock (MockTimers recipe; defaults resolve the
//     globals at CALL time so `t.mock.timers.enable()` works whenever it is enabled).
//
// NEVER FOCUSED ON APPEARANCE (DD2): `present()`/`show()`/`raise()` never focus the prompt. The
// operator's page keeps focus; the prompt gets it only by a physical click or an explicit F6
// (`focusPrompt()`, the ONE `webContents.focus(` call in this file - source-scan pinned).
//
// HELD FOCUS (Leg 3, R3): `heldFocus` mirrors the prompt webContents' own `focus`/`blur`
// (trusted, main-side; the page's focusin/focusout stay the timer's pause input). `close()`
// captures it at its TOP; for `saved`/`dismissed` (the `refocusGuest` effect) it hands focus back
// to the window's active guest through the injected `focusActiveGuest()` AFTER the hide - never
// to the prompt itself, never to the chrome. A window blur clears it.
//
// ONE PROMPT, ONE TOKEN (AC3): `current = { token, captureId, wcId, ... }` is the single holder.
// Every page->main message with a different token is dropped by the callers (the IPC module
// checks `isCurrentToken`; `reportHeight` checks itself).
//
// SETTLING (AC6): `settling` is set BEFORE the manager itself calls `captureSave` /
// `captureDismiss` (and by every `close`), so the prompt's own drop of its capture can never
// surface as the "expired" state. Only an EXTERNAL drop of the SHOWN capture (CAPTURE_DROP_MS,
// tab-changed, finalize) flips to the expired result.
//
// TIMER (DD4): 10 s, started when the prompt is SHOWN (after its first height report, so the
// operator never loses time to a blank/loading frame). Paused while ANY of four inputs is true:
// pointer, focus, windowBlur, sheet. Resume restores the remaining time. Result states
// (`showResult`) start NO new 10 s and are not held open by pointer/focus.
//
// POINTER SEAM (AC9): pointer-inside reaches the timer through EXACTLY ONE method,
// `setPointerInside(bool)`. The page's pointerenter/leave is today's only caller; a main-side
// cursor-point hit test could replace the source without touching timer logic (P1 fallback).
//
// HIDE ORDER (squawk 0100, AC8): `close()` removes the child view SYNCHRONOUSLY (callers in
// tab-set-active rely on it completing before the find/sheet `syncBounds` fan-out). Only the
// natural result-timer close defers its hide one macrotask, so a resize right at the close is
// never in the same tick as the hide. A `:height` report is applied only while shown and never
// after the close (current is nulled first).
//
// Cache contract for `lastGuestBounds`: source of truth = this window's active guest bounds.
// Rebuild trigger = tab-set-bounds on the active tab (`syncBounds`) + the anchor re-send
// (`setAnchor`). Max staleness = one event.
//
// Lifecycle: lazy (created on the first present()); destroyed-recreate guard;
// render-process-gone / did-fail-load self-teardown (the shown capture is dropped as
// `dismissed`); show = position + add-after-guest; hide = visibility-gated removeChildView;
// teardown destroys the webContents (the SOLE destruction caller is the per-window `close`
// handler).

const { savePromptCloseEffects } = require('../shared/save-prompt-close-effects');
const { resultNounOf } = require('../shared/vault-capture-template');

const SAVE_PROMPT_TIMEOUT_MS = 10_000;
const SAVE_PROMPT_SHOW_FALLBACK_MS = 1500;
const SAVE_PROMPT_FALLBACK_HEIGHT = 160;
const SAVE_PROMPT_SUCCESS_HOLD_MS = 2500;
const SAVE_PROMPT_FAILURE_HOLD_MS = 4000;
const MAX_CONTENT_HEIGHT = 4000;

/** Result-only model kinds (finalize outcomes; `saved` is built dynamically in present()) -> text, hold, close reason. */
const RESULT_MODELS = Object.freeze({
  unchanged: { kind: 'success', text: 'Already saved', holdMs: SAVE_PROMPT_SUCCESS_HOLD_MS, closeReason: 'dismissed' },
  expired: {
    kind: 'failure',
    text: 'This save request expired',
    holdMs: SAVE_PROMPT_FAILURE_HOLD_MS,
    closeReason: 'expired'
  },
  'tab-changed': {
    kind: 'failure',
    text: 'Not saved — the tab changed',
    holdMs: SAVE_PROMPT_FAILURE_HOLD_MS,
    closeReason: 'expired'
  },
  locked: {
    kind: 'failure',
    text: 'Vault locked — not saved',
    holdMs: SAVE_PROMPT_FAILURE_HOLD_MS,
    closeReason: 'dismissed'
  },
  error: {
    kind: 'failure',
    text: "Couldn't save to that vault",
    holdMs: SAVE_PROMPT_FAILURE_HOLD_MS,
    closeReason: 'dismissed'
  }
});

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} Bounds
 * @typedef {{
 *   webContents: {
 *     on: (event: string, cb: (...a: any[]) => void) => any,
 *     isDestroyed: () => boolean,
 *     destroy?: () => void,
 *     send?: (channel: string, payload?: any) => void,
 *     focus: () => void
 *   },
 *   setBounds: (b: Bounds) => void,
 *   setVisible: (v: boolean) => void
 * }} PromptViewLike
 * @typedef {{
 *   addChildView: (v: PromptViewLike) => void,
 *   removeChildView: (v: PromptViewLike) => void
 * }} ContentViewLike
 */

/**
 * @param {{
 *   getContentView: () => (ContentViewLike | null),
 *   createView: () => PromptViewLike,
 *   getActiveGuestBounds?: () => (Bounds | null),
 *   isFindVisible?: () => boolean,
 *   isSheetVisible?: () => boolean,
 *   isFullscreen?: () => boolean,
 *   computeBounds: (args: any) => Bounds,
 *   chromeZoomFactor?: () => number,
 *   sendToChrome?: (channel: string, payload: any) => void,
 *   captureSave?: (arg: { captureId: string, vaultId: any }) => any,
 *   captureDismiss?: (captureId: string) => void,
 *   focusActiveGuest?: () => boolean,
 *   setTimeout?: (fn: () => void, ms: number) => any,
 *   clearTimeout?: (h: any) => void,
 *   now?: () => number
 * }} deps
 */
function createSavePromptManager({
  getContentView,
  createView,
  getActiveGuestBounds = () => null,
  isFindVisible = () => false,
  isSheetVisible = () => false,
  isFullscreen = () => false,
  computeBounds,
  chromeZoomFactor = () => 1,
  sendToChrome = () => {},
  captureSave = () => ({ saved: false }),
  captureDismiss = () => {},
  focusActiveGuest = () => false,
  setTimeout: _setTimeout = (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: _clearTimeout = (h) => globalThis.clearTimeout(h),
  now = () => Date.now()
}) {
  /** @type {PromptViewLike | null} */
  let view = null;
  // Stack presence (removeChildView of a non-child is undefined behavior - gate on this).
  let visible = false;
  let ready = false;
  /** @type {Bounds | null} */
  let lastGuestBounds = null;
  /** @type {any | null} init payload queued before the first page load finished */
  let pendingInit = null;
  let loadFailed = false;
  // Leg 3 (R3): the prompt webContents currently holds OS focus (its own focus/blur events).
  let heldFocus = false;

  /**
   * @type {null | {
   *   token: number, captureId: string, wcId: number, model: any, queue: any,
   *   kind: 'offer' | 'result', anchorCss: number | null, contentHeight: number | null,
   *   shown: boolean, saving: boolean, consenting?: boolean, result: null | { kind: string, text: string },
   *   holdMs?: number, resultCloseReason?: string
   * }}
   */
  let current = null;
  let settling = false;

  // Timer state.
  let remainingMs = SAVE_PROMPT_TIMEOUT_MS;
  /** @type {number | null} */
  let runStart = null;
  /** @type {any} */
  let timerHandle = null;
  /** @type {any} */
  let resultHandle = null;
  /** @type {any} */
  let fallbackHandle = null;
  /** @type {any} */
  let deferredHideHandle = null;
  const pause = { pointer: false, focus: false, windowBlur: false, sheet: false };
  let lastPushedKey = '';

  const isPaused = () => (current == null ? false : pause.pointer || pause.focus || pause.windowBlur || pause.sheet);

  function liveWc() {
    return view && !view.webContents.isDestroyed() ? view.webContents : null;
  }

  /** @param {string} channel @param {any} [payload] */
  function sendToPage(channel, payload) {
    const wc = liveWc();
    if (wc) wc.send?.(channel, payload);
  }

  function currentRemaining() {
    return runStart == null ? remainingMs : Math.max(0, remainingMs - (now() - runStart));
  }

  function pushTimer(force = false) {
    if (!current || current.kind !== 'offer' || !current.shown) return;
    const payload = { token: current.token, remainingMs: Math.round(currentRemaining()), paused: isPaused() };
    const key = `${current.token}:${payload.remainingMs}:${payload.paused}:${runStart == null ? 'p' : 'r'}`;
    if (!force && key === lastPushedKey) return;
    lastPushedKey = key;
    sendToPage('save-prompt:timer', payload);
  }

  function clearTimerHandle() {
    if (timerHandle != null) _clearTimeout(timerHandle);
    timerHandle = null;
  }

  // Reconcile the running/paused state of the 10 s timer against the live inputs.
  function syncTimer() {
    const eligible = !!current && current.kind === 'offer' && current.shown && !settling;
    if (!eligible) {
      if (runStart != null) {
        remainingMs = currentRemaining();
        runStart = null;
      }
      clearTimerHandle();
      return;
    }
    const shouldRun = !isPaused();
    if (shouldRun && runStart == null) {
      runStart = now();
      clearTimerHandle();
      timerHandle = _setTimeout(onExpire, remainingMs);
    } else if (!shouldRun && runStart != null) {
      remainingMs = currentRemaining();
      runStart = null;
      clearTimerHandle();
    }
    pushTimer();
  }

  function onExpire() {
    timerHandle = null;
    if (!current || current.kind !== 'offer') return;
    runStart = null;
    remainingMs = 0;
    close('timeout');
  }

  function clearAllTimers() {
    clearTimerHandle();
    runStart = null;
    if (resultHandle != null) _clearTimeout(resultHandle);
    resultHandle = null;
    if (fallbackHandle != null) _clearTimeout(fallbackHandle);
    fallbackHandle = null;
  }

  function cancelDeferredHide() {
    if (deferredHideHandle != null) _clearTimeout(deferredHideHandle);
    deferredHideHandle = null;
  }

  function computeCurrentBounds() {
    const guest = getActiveGuestBounds() || lastGuestBounds;
    if (!guest || !current) return null;
    const zoom = chromeZoomFactor();
    const anchorRightDip =
      typeof current.anchorCss === 'number' && Number.isFinite(current.anchorCss) && current.anchorCss > 0
        ? current.anchorCss * (Number.isFinite(zoom) && zoom > 0 ? zoom : 1)
        : null;
    return computeBounds({
      guest,
      anchorRightDip,
      findVisible: isFindVisible(),
      contentHeight: current.contentHeight == null ? SAVE_PROMPT_FALLBACK_HEIGHT : current.contentHeight
    });
  }

  // Position + add-after-guest. The re-add of an existing child RAISES it. Callers in
  // tab-set-active invoke the public show() strictly AFTER the guest re-add.
  function raise() {
    const cv = getContentView();
    if (!cv || !view) return;
    const b = computeCurrentBounds();
    if (b) view.setBounds(b);
    cv.addChildView(view);
    view.setVisible(true);
    visible = true;
  }

  function hide() {
    cancelDeferredHide();
    if (!visible) return;
    const cv = getContentView();
    if (cv && view) cv.removeChildView(view);
    visible = false;
  }

  function teardownView() {
    if (view) {
      if (visible) {
        const cv = getContentView();
        if (cv) cv.removeChildView(view);
      }
      const wc = view.webContents;
      if (!wc.isDestroyed() && typeof wc.destroy === 'function') wc.destroy();
    }
    view = null;
    visible = false;
    ready = false;
    pendingInit = null;
    loadFailed = false;
    heldFocus = false;
  }

  // The page crashed / failed to load: the shown capture can never be answered -> drop it as
  // `dismissed`, then tear the view down so the next present() rebuilds a fresh one.
  function onPageGone() {
    if (current) close('dismissed');
    teardownView();
  }

  function ensureView() {
    if (view && (view.webContents.isDestroyed() || loadFailed)) {
      if (!view.webContents.isDestroyed() && loadFailed) teardownView();
      view = null;
      visible = false;
      ready = false;
      pendingInit = null;
      loadFailed = false;
      heldFocus = false;
    }
    if (view) return view;
    ready = false;
    loadFailed = false;
    const v = createView();
    view = v;
    v.webContents.on('did-finish-load', () => {
      if (view !== v) return;
      ready = true;
      if (pendingInit && current) {
        const seed = pendingInit;
        pendingInit = null;
        sendToPage('save-prompt:init', seed);
      } else {
        pendingInit = null;
      }
    });
    v.webContents.on('focus', () => {
      if (view === v) heldFocus = true;
    });
    v.webContents.on('blur', () => {
      if (view === v) heldFocus = false;
    });
    v.webContents.on('did-fail-load', (_e, _code, _desc, _url, isMainFrame) => {
      if (view !== v) return;
      if (isMainFrame === false) return;
      loadFailed = true;
      onPageGone();
    });
    v.webContents.on('render-process-gone', () => {
      if (view !== v) return;
      onPageGone();
    });
    return v;
  }

  function initPayloadFor(c) {
    return {
      token: c.token,
      captureId: c.captureId,
      model: c.model,
      queue: c.queue,
      remainingMs: Math.round(currentRemaining()),
      paused: isPaused(),
      ...(c.result ? { result: c.result } : {})
    };
  }

  // First show for the current prompt (its height arrived, or the fail-safe fired).
  function revealCurrent() {
    if (!current || current.shown) return;
    if (fallbackHandle != null) _clearTimeout(fallbackHandle);
    fallbackHandle = null;
    cancelDeferredHide();
    current.shown = true;
    raise();
    if (current.kind === 'result') {
      armResultTimer(current.holdMs || SAVE_PROMPT_FAILURE_HOLD_MS);
    } else {
      remainingMs = SAVE_PROMPT_TIMEOUT_MS;
      runStart = null;
      lastPushedKey = '';
      syncTimer();
      pushTimer(true);
    }
  }

  /** @param {number} holdMs */
  function armResultTimer(holdMs) {
    if (resultHandle != null) _clearTimeout(resultHandle);
    resultHandle = _setTimeout(() => {
      resultHandle = null;
      if (!current) return;
      const reason = current.resultCloseReason || 'dismissed';
      close(reason, { deferHide: true });
    }, holdMs);
  }

  /**
   * Present (or model-replace) a prompt. Refuses, never queues (DD1/N4).
   * @param {{ token: number, captureId: string, wcId: number, model: any, anchor?: any, queue?: any }} args
   * @returns {{ presented: boolean, reason?: string }}
   */
  function present({ token, captureId, wcId, model, anchor, queue }) {
    if (isSheetVisible()) return { presented: false, reason: 'sheet-open' };
    if (isFullscreen()) return { presented: false, reason: 'fullscreen' };
    if (!getContentView()) return { presented: false, reason: 'gone' };

    // Model-replace: the single holder is overwritten; the old prompt's timers die with it.
    clearAllTimers();
    // A view still in the stack only because of a deferred (result-close) hide is not a live
    // prompt to model-replace: the new prompt takes the normal first-show path.
    const wasVisible = visible && deferredHideHandle == null;
    cancelDeferredHide();
    ensureView();

    /** @type {{ kind: string, text: string, holdMs: number, closeReason: string } | null} */
    let resultModel =
      model && typeof model.result === 'string' && Object.hasOwn(RESULT_MODELS, model.result)
        ? RESULT_MODELS[/** @type {keyof typeof RESULT_MODELS} */ (model.result)]
        : null;
    // Leg 2 (AC8): the `saved` result is DYNAMIC - "<Noun> saved to <vault>" - built here from
    // the sanitized { kind, vaultLabel }; textContent-only on the page. Display-only: a
    // compromised chrome could show a fake "saved", the same class as the other result models.
    if (!resultModel && model && model.result === 'saved') {
      const label = typeof model.vaultLabel === 'string' && model.vaultLabel ? model.vaultLabel : 'your vault';
      resultModel = {
        kind: 'success',
        text: `${resultNounOf(model)} saved to ${label}`,
        holdMs: SAVE_PROMPT_SUCCESS_HOLD_MS,
        closeReason: 'saved'
      };
    }

    settling = false;
    remainingMs = SAVE_PROMPT_TIMEOUT_MS;
    runStart = null;
    lastPushedKey = '';
    // A fresh prompt has had no pointer/focus yet; the page re-reports them on its own events.
    pause.pointer = false;
    pause.focus = false;
    current = {
      token,
      captureId,
      wcId,
      model,
      queue,
      kind: resultModel ? 'result' : 'offer',
      anchorCss: typeof anchor === 'number' ? anchor : null,
      contentHeight: null,
      shown: false,
      saving: false,
      consenting: false,
      result: resultModel ? { kind: resultModel.kind, text: resultModel.text } : null
    };
    if (resultModel) {
      current.holdMs = resultModel.holdMs;
      current.resultCloseReason = resultModel.closeReason;
    }
    const payload = initPayloadFor(current);
    if (ready) {
      pendingInit = null;
      sendToPage('save-prompt:init', payload);
    } else {
      pendingInit = payload;
    }
    // Height fail-safe: never leave a presented-but-invisible prompt behind.
    const tok = token;
    fallbackHandle = _setTimeout(() => {
      fallbackHandle = null;
      if (!current || current.token !== tok || current.shown) return;
      current.contentHeight = SAVE_PROMPT_FALLBACK_HEIGHT;
      revealCurrent();
    }, SAVE_PROMPT_SHOW_FALLBACK_MS);
    // A model-replace while already in the stack keeps the card up; the new init repaints it.
    if (wasVisible) {
      current.shown = true;
      current.contentHeight = SAVE_PROMPT_FALLBACK_HEIGHT;
      if (fallbackHandle != null) _clearTimeout(fallbackHandle);
      fallbackHandle = null;
      raise();
      if (current.kind === 'result') armResultTimer(current.holdMs || SAVE_PROMPT_FAILURE_HOLD_MS);
      else syncTimer();
    }
    return { presented: true };
  }

  /**
   * Close the current prompt. Idempotent. Sends the eager scrub (`:clear`) BEFORE removing the
   * view, then emits exactly one `save-prompt-closed` to this window's chrome.
   * @param {string} reason
   * @param {{ deferHide?: boolean }} [opts]
   */
  function close(reason, { deferHide = false } = {}) {
    if (!current) return false;
    const c = current;
    // Leg 3 (R3): capture CURRENT focus before anything below can change it.
    const held = heldFocus;
    heldFocus = false;
    // Settle FIRST: nothing the prompt does to its own capture may read as an external drop.
    settling = true;
    current = null;
    clearAllTimers();
    pause.pointer = false;
    pause.focus = false;
    lastPushedKey = '';
    const fx = savePromptCloseEffects(reason);
    const refocus = fx.refocusGuest && held;
    if (fx.dismissShown) {
      try {
        captureDismiss(c.captureId);
      } catch {
        // the record is main-side; a throwing delegate must not wedge the close.
      }
    }
    pendingInit = null;
    sendToPage('save-prompt:clear', { token: c.token });
    if (deferHide) {
      if (visible) {
        cancelDeferredHide();
        deferredHideHandle = _setTimeout(() => {
          deferredHideHandle = null;
          if (current) return;
          hide();
          if (refocus) refocusGuest();
        }, 0);
      } else if (refocus) {
        refocusGuest();
      }
    } else {
      hide();
      if (refocus) refocusGuest();
    }
    sendToChrome('save-prompt-closed', { token: c.token, captureId: c.captureId, reason });
    return true;
  }

  /** Hand focus back to the page (R3/R5). Never throws: a refusal or a throwing delegate is a no-op. */
  function refocusGuest() {
    try {
      focusActiveGuest();
    } catch {
      // the guest may be mid-teardown; the close must not wedge.
    }
  }

  /**
   * Replace the offer with a result state (role=status) in the same view. Starts no new 10 s.
   * @param {string} kind  'success' | 'failure'
   * @param {string} text
   * @param {number} holdMs
   * @param {string} closeReason
   */
  function showResult(kind, text, holdMs, closeReason) {
    if (!current) return;
    settling = true;
    current.kind = 'result';
    current.result = { kind, text };
    current.holdMs = holdMs;
    current.resultCloseReason = closeReason;
    clearTimerHandle();
    runStart = null;
    sendToPage('save-prompt:result', { token: current.token, kind, text });
    if (current.shown) armResultTimer(holdMs);
    else if (resultHandle != null) {
      _clearTimeout(resultHandle);
      resultHandle = null;
    }
  }

  // ---- keyboard (Leg 3; flight DD2) ----------------------------------------------------------

  /** An interactive offer is up (not a result, not saving/consenting/settling) (R2). */
  function canFocusPrompt() {
    return (
      !!current &&
      visible &&
      ready &&
      current.shown &&
      current.kind === 'offer' &&
      !current.saving &&
      !current.consenting &&
      !settling &&
      liveWc() != null
    );
  }

  /**
   * F6 from the page: move OS focus into the prompt, then ask the page to focus its primary
   * button. The ONE `webContents.focus(` call in this module. A no-op unless interactive.
   * @returns {boolean}
   */
  function focusPrompt() {
    if (!canFocusPrompt() || !current || !view) return false;
    view.webContents.focus();
    sendToPage('save-prompt:focus-first', { token: current.token });
    return true;
  }

  /** Esc closes ("Not now") only on an interactive offer - never a result, saving or consenting (R4). */
  function canDismissByKey() {
    return !!current && visible && current.kind === 'offer' && !current.saving && !current.consenting && !settling;
  }

  // ---- page-originated signals -------------------------------------------------------------

  /** @param {number} token */
  function isCurrentToken(token) {
    return current != null && token === current.token;
  }

  /** Pointer seam (AC9): the ONE entry for pointer-inside. @param {boolean} inside */
  function setPointerInside(inside) {
    if (!current) return;
    pause.pointer = inside === true;
    syncTimer();
  }

  /** @param {boolean} inside */
  function setFocusInside(inside) {
    if (!current) return;
    pause.focus = inside === true;
    syncTimer();
  }

  /** Window blur/minimize (true) vs focus/restore (false) - EVENT-fed only (AC16). @param {boolean} blurred */
  function setWindowBlurred(blurred) {
    pause.windowBlur = blurred === true;
    // A blurred window's prompt must never pull focus back into the page on close (R3).
    if (blurred === true) heldFocus = false;
    syncTimer();
  }

  /** A menu-overlay sheet became visible / hidden in this window. @param {boolean} sheetVisible */
  function setSheetVisible(sheetVisible) {
    pause.sheet = sheetVisible === true;
    syncTimer();
  }

  /**
   * Page-reported content height. Applied only while a prompt is current; the first report for
   * the token shows the view.
   * @param {number} token
   * @param {number} height
   */
  function reportHeight(token, height) {
    if (!current || token !== current.token) return;
    const h = Number.isFinite(height) ? Math.min(Math.max(height, 0), MAX_CONTENT_HEIGHT) : 0;
    current.contentHeight = h;
    if (!current.shown) {
      revealCurrent();
      return;
    }
    if (visible && view) {
      const b = computeCurrentBounds();
      if (b) view.setBounds(b);
    }
  }

  // ---- geometry ----------------------------------------------------------------------------

  /** @param {Bounds} rounded */
  function syncBounds(rounded) {
    lastGuestBounds = rounded;
    if (visible && view && current) {
      const b = computeCurrentBounds();
      if (b) view.setBounds(b);
    }
  }

  /** Anchor re-send (CSS px of the indicator's right edge). @param {any} right */
  function setAnchor(right) {
    if (!current) return;
    current.anchorCss = typeof right === 'number' && Number.isFinite(right) ? right : null;
    if (visible && view) {
      const b = computeCurrentBounds();
      if (b) view.setBounds(b);
    }
  }

  /** Re-raise above the guest (callers invoke it strictly AFTER the guest re-add). */
  function show() {
    if (!visible || !current || !current.shown) return;
    raise();
  }

  // ---- save / dismiss / external drop ------------------------------------------------------

  function canSave() {
    if (!current || current.kind !== 'offer' || current.saving || settling) return false;
    const mode = current.model && current.model.mode;
    return mode === 'save' || mode === 'update';
  }

  /** @param {any} model @param {any} vaultId */
  function vaultLabelFor(model, vaultId) {
    const list = Array.isArray(model && model.choices) ? model.choices : [];
    const hit = list.find((/** @type {any} */ c) => c && typeof c === 'object' && c.vaultId === vaultId);
    if (hit && typeof hit.label === 'string' && hit.label) return hit.label;
    if (model && typeof model.vaultLabel === 'string' && model.vaultLabel) return model.vaultLabel;
    return vaultId === 'global' ? 'Global' : 'your vault';
  }

  /**
   * The Save action (after the IPC's four guards). Flips to `saving` SYNCHRONOUSLY so a second
   * :save (double-click) fails the kind guard.
   * @param {any} vaultId
   * @returns {{ saved: boolean, reason?: string }}
   */
  function save(vaultId) {
    if (!canSave() || !current) return { saved: false, reason: 'kind' };
    const c = current;
    c.saving = true;
    settling = true;
    clearTimerHandle();
    if (runStart != null) {
      remainingMs = currentRemaining();
      runStart = null;
    }
    sendToPage('save-prompt:saving', { token: c.token });
    /** @type {any} */
    let res;
    try {
      res = captureSave({ captureId: c.captureId, vaultId });
    } catch {
      showResult('failure', "Couldn't save to that vault", SAVE_PROMPT_FAILURE_HOLD_MS, 'dismissed');
      return { saved: false, reason: 'error' };
    }
    if (res && res.saved === true) {
      const noun = resultNounOf(c.model);
      const effectiveVault = c.model && c.model.mode === 'update' ? c.model.defaultVaultId : vaultId;
      showResult(
        'success',
        `${noun} saved to ${vaultLabelFor(c.model, effectiveVault)}`,
        SAVE_PROMPT_SUCCESS_HOLD_MS,
        'saved'
      );
      return { saved: true };
    }
    if (res && res.reason === 'locked') {
      showResult('failure', 'Vault locked — not saved', SAVE_PROMPT_FAILURE_HOLD_MS, 'dismissed');
      return { saved: false, reason: 'locked' };
    }
    if (res && typeof res.reason === 'string') {
      showResult('failure', "Couldn't save to that vault", SAVE_PROMPT_FAILURE_HOLD_MS, 'dismissed');
      return { saved: false, reason: res.reason };
    }
    showResult('failure', 'This save request expired', SAVE_PROMPT_FAILURE_HOLD_MS, 'expired');
    return { saved: false, reason: 'expired' };
  }

  // ---- locked-offer consent (Leg 2; flight DD7) ---------------------------------------------

  /**
   * Guard 3 of `save-prompt:consent`: the prompt is in its OFFER state with a `locked` model and
   * is not saving / settling / already consenting. Sets the dedicated in-flight flag
   * SYNCHRONOUSLY so a double-click sends exactly one consent (this is NOT `save()`'s `saving`).
   * @returns {boolean}
   */
  function beginConsent() {
    if (!current || current.kind !== 'offer' || current.saving || current.consenting || settling) return false;
    if (!current.model || current.model.mode !== 'locked') return false;
    current.consenting = true;
    return true;
  }

  /** Roll the in-flight flag back after a refusal that leaves the prompt up. */
  function endConsent() {
    if (current) current.consenting = false;
  }

  /** Consent recorded main-side: hand off to the chrome's unlock sheet (no capture dismissed). */
  function consentGranted() {
    close('unlock-requested');
  }

  /** ✕ / Not now. */
  function dismiss() {
    close('dismissed');
  }

  /**
   * vault-human's `onCaptureDropped` for THIS window (AC6/AC14). Ignores non-shown ids and any
   * drop while settling (the prompt's own save/dismiss/timeout/close).
   * @param {{ captureId: string, cause?: string }} info
   */
  function onCaptureDropped({ captureId, cause }) {
    if (!current || current.captureId !== captureId || settling) return;
    if (cause === 'superseded') {
      // A newer same-family offer replaced this one: close silently, the newer offer queues
      // behind it (no "expired" flash).
      close('dismissed');
      return;
    }
    showResult('failure', 'This save request expired', SAVE_PROMPT_FAILURE_HOLD_MS, 'expired');
  }

  function teardown() {
    if (current) close('teardown');
    clearAllTimers();
    cancelDeferredHide();
    teardownView();
    current = null;
    settling = false;
    pause.pointer = false;
    pause.focus = false;
    pause.windowBlur = false;
    pause.sheet = false;
  }

  return {
    present,
    close,
    showResult,
    save,
    dismiss,
    canSave,
    beginConsent,
    endConsent,
    consentGranted,
    onCaptureDropped,
    setPointerInside,
    setFocusInside,
    setWindowBlurred,
    setSheetVisible,
    reportHeight,
    syncBounds,
    setAnchor,
    show,
    hide,
    teardown,
    isCurrentToken,
    isVisible: () => visible,
    isPaused,
    isReady: () => ready,
    getView: () => view,
    currentCaptureId: () => (current ? current.captureId : null),
    currentWcId: () => (current ? current.wcId : null),
    currentToken: () => (current ? current.token : null),
    canFocusPrompt,
    focusPrompt,
    canDismissByKey,
    isHeldFocus: () => heldFocus,
    isOfferState: () => !!current && current.kind === 'offer' && !current.saving
  };
}

module.exports = {
  createSavePromptManager,
  SAVE_PROMPT_TIMEOUT_MS,
  SAVE_PROMPT_SHOW_FALLBACK_MS,
  SAVE_PROMPT_SUCCESS_HOLD_MS,
  SAVE_PROMPT_FAILURE_HOLD_MS
};
