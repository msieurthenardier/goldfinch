// @ts-check

// Chrome-side opener for the corner save prompt (Sortie 06 Leg 1; flight DD1/DD6/DD9).
// Constructed INSIDE vault-controller.js (never renderer.js - the line budget). It owns:
//   - the chrome-minted MONOTONIC token for each prompt (main drops every page message and
//     every close carrying a stale token);
//   - vault-choice labelling (AC20): the offer's `choices` (vault ids) become
//     `{ vaultId, label }`; a jar that no longer resolves in `jarsClient.containers` becomes
//     `{ vaultId, label: 'Unknown vault', disabled: true }` - shown but not selectable (main
//     still validates);
//   - the anchor: `#vault-indicator`'s `getBoundingClientRect().right` in CSS px, sent with the
//     open and re-sent via `savePromptAnchor` while a prompt is presented - a ResizeObserver on
//     the indicator (a hide-by-pin collapses its size to 0) and a window `resize` listener (chrome
//     zoom / window resize). Both are idle while no prompt is presented. MAIN converts to DIP with
//     the chrome webContents' LIVE zoom factor; no scale is trusted from here;
//   - the single `save-prompt-closed` subscription, which ignores stale tokens and hands the
//     remaining work to the controller (the per-reason effects table is the shared
//     `savePromptCloseEffects`, applied by the controller).
//
// Cache contract (anchor): source of truth = the indicator's live rect; rebuild triggers = the
// ResizeObserver and window resize; max staleness = one event.
//
// The prompt carries METADATA ONLY - this module never sees a password.

import { SAVE_PROMPT_CLOSE_REASONS } from '../../shared/save-prompt-close-effects.js';
import { savePromptAnnouncement } from '../../shared/vault-capture-template.js';

// Re-announce delay (R9): clear the live region, then set the text after a short TIMER - never
// requestAnimationFrame, which does not fire in a hidden or background chrome window.
const ANNOUNCE_DELAY_MS = 30;

/**
 * The reasons this chrome client expects from main for Leg 1. Leg 2 adds `unlock-requested` /
 * `unlock-abandoned`. Drift-guarded against the shared table in save-prompt-close-effects.test.js:
 * a subset of SAVE_PROMPT_CLOSE_REASONS, and every table reason is either here or in
 * `DEFERRED_REASONS`.
 */
export const CLIENT_HANDLED_REASONS = Object.freeze([
  'saved',
  'dismissed',
  'timeout',
  'expired',
  'tab-switch',
  'tab-hide',
  'tab-close',
  'tab-moved',
  'teardown',
  'vault-lock',
  // Leg 2: the locked prompt's consent close - the controller queues the capture and opens the
  // unlock sheet in the next task.
  'unlock-requested'
]);

/**
 * Table reasons main never emits: `unlock-abandoned` is applied chrome-side by `handleClosed`
 * (the unlock SHEET closing while still locked) - no prompt is shown when an unlock is
 * abandoned, so nothing emits it as a `save-prompt-closed`.
 */
export const DEFERRED_REASONS = Object.freeze(['unlock-abandoned']);

/**
 * @param {{
 *   goldfinch: any,
 *   jarsClient: { containers: any[] },
 *   getIndicator: () => (HTMLElement | null | undefined),
 *   getStatusNode?: () => ({ textContent: string | null } | null | undefined),
 *   setTimeout?: (fn: () => void, ms: number) => any,
 *   clearTimeout?: (h: any) => void,
 *   onClosed: (info: { captureId: string, wcId: number, reason: string }) => void,
 *   win?: { addEventListener: Function, removeEventListener: Function } | null
 * }} deps
 */
export function createSavePromptClient({
  goldfinch,
  jarsClient,
  getIndicator,
  getStatusNode = () => (typeof document !== 'undefined' ? document.getElementById('save-prompt-status') : null),
  setTimeout: _setTimeout = (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: _clearTimeout = (h) => globalThis.clearTimeout(h),
  onClosed,
  win = typeof window !== 'undefined' ? window : null
}) {
  /** @type {any} */
  let announceHandle = null;
  let nextToken = 1;
  /** @type {{ token: number, captureId: string, wcId: number } | null} */
  let current = null;
  /** @type {ResizeObserver | null} */
  let observer = null;
  let resizeListener = /** @type {(() => void) | null} */ (null);

  /** The vault indicator's right edge in CSS px, or null when it is hidden / unmeasured. */
  function measureAnchor() {
    const el = getIndicator();
    if (!el || typeof el.getBoundingClientRect !== 'function') return null;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && Number.isFinite(rect.right) && rect.right > 0 ? rect.right : null;
  }

  function sendAnchor() {
    if (!current) return;
    goldfinch.savePromptAnchor({ token: current.token, right: measureAnchor() });
  }

  function startTracking() {
    stopTracking();
    const el = getIndicator();
    if (el && typeof ResizeObserver === 'function') {
      observer = new ResizeObserver(() => sendAnchor());
      observer.observe(el);
    }
    resizeListener = () => sendAnchor();
    if (win) win.addEventListener('resize', resizeListener);
  }

  function stopTracking() {
    if (observer) observer.disconnect();
    observer = null;
    if (resizeListener && win) win.removeEventListener('resize', resizeListener);
    resizeListener = null;
  }

  /**
   * One polite announcement per successful OFFER presentation (convert in place and re-ask
   * included; result-only presentations write nothing). Clears the node first so identical text
   * re-announces, then sets it after a timer. textContent only; host only - no username/label.
   * @param {any} model
   */
  function announce(model) {
    const text = savePromptAnnouncement(model, { withHint: true });
    if (!text) return;
    const node = getStatusNode();
    if (!node) return;
    node.textContent = '';
    if (announceHandle != null) _clearTimeout(announceHandle);
    announceHandle = _setTimeout(() => {
      announceHandle = null;
      node.textContent = text;
    }, ANNOUNCE_DELAY_MS);
  }

  /** @param {string} vaultId @returns {{ vaultId: string, label: string, disabled?: boolean }} */
  function labelChoice(vaultId) {
    if (vaultId === 'global') return { vaultId, label: 'Global' };
    const jar = jarsClient.containers.find((/** @type {any} */ c) => c.id === vaultId);
    return jar ? { vaultId, label: jar.name } : { vaultId, label: 'Unknown vault', disabled: true };
  }

  /**
   * Decorate an offer model with display labels. Result-only models pass through untouched.
   * @param {any} model
   */
  function decorate(model) {
    if (!model || typeof model !== 'object' || typeof model.result === 'string') return model;
    const choices = Array.isArray(model.choices)
      ? model.choices.map((/** @type {any} */ c) => (typeof c === 'string' ? labelChoice(c) : c))
      : [];
    const out = { ...model, choices };
    if (model.mode === 'update' && typeof model.defaultVaultId === 'string') {
      out.vaultLabel = labelChoice(model.defaultVaultId).label;
    }
    return out;
  }

  /**
   * Ask main to present the entry in the corner prompt.
   * @param {{ captureId: string, wcId: number, model: any, queue: { index: number, total: number } | null }} entry
   * @returns {Promise<{ presented: boolean, reason?: string }>}
   */
  async function present({ captureId, wcId, model, queue }) {
    const token = nextToken++;
    /** @type {{ presented: boolean, reason?: string }} */
    let res;
    try {
      res = await goldfinch.savePromptOpen({
        token,
        captureId,
        wcId,
        model: decorate(model),
        anchor: measureAnchor(),
        queue
      });
    } catch {
      return { presented: false, reason: 'gone' };
    }
    if (res && res.presented) {
      current = { token, captureId, wcId };
      startTracking();
      announce(model);
      return { presented: true };
    }
    return { presented: false, reason: (res && res.reason) || 'gone' };
  }

  goldfinch.onSavePromptClosed((/** @type {{ token: number, captureId: string, reason: string }} */ d) => {
    // Stale-token closes (an older prompt's late event) are dropped.
    if (!current || !d || d.token !== current.token) return;
    const { wcId } = current;
    current = null;
    stopTracking();
    if (announceHandle != null) _clearTimeout(announceHandle);
    announceHandle = null;
    onClosed({
      captureId: d.captureId,
      wcId,
      reason: SAVE_PROMPT_CLOSE_REASONS.has(d.reason) ? d.reason : 'dismissed'
    });
  });

  return { present, isOpen: () => current != null, labelChoice, decorate };
}
