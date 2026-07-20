// @ts-check

// Chrome controller for the top-bar downloads indicator (M11 F1 Leg 2, DD1/DD5).
// Subscribes INDEPENDENTLY to the additive download-progress / download-done
// broadcasts (chrome-preload.js's onDownloadProgress/onDownloadDone are plain
// ipcRenderer.on registrations — this controller coexists with media-controller.js's
// download toast subscriber; both fire, neither is disturbed). It folds the stream
// through the pure downloads-indicator-model reducer and applies deriveModel to the
// #downloads-indicator button — the model→DOM half of the split, mirroring
// renderAutomationIndicator. It owns the ONLY impure concern the reducer excludes:
// the 5-minute idle-timeout timer that dispatches the `expire` event.
//
// Leg 3 consumes this controller: acknowledge() on popup close, getSnapshot() for the
// popup's list model, isVisible() to guard focus restoration, and forceShowForAudit()
// as the a11y-sweep seam (mirrors the devtools-button audit hook).

import { initialState, reduce, deriveModel, IDLE_TIMEOUT_MS } from './downloads-indicator-model.js';

/**
 * @param {{ els: Record<string, any>, goldfinch: any }} deps
 */
export function createDownloadsController({ els, goldfinch }) {
  let state = initialState();
  /** @type {ReturnType<typeof setTimeout> | null} */
  let expiryTimer = null;

  const btn = els.downloadsIndicator;
  const badge = els.downloadsIndicatorBadge;

  function render() {
    if (!btn) return;
    const model = deriveModel(state);

    btn.classList.toggle('hidden', !model.visible);
    // State via WORDS (aria-label) is the source of truth for AT; the classes are a
    // visual accent only. active = at least one in-flight download; recent = visible
    // because of a completion (acknowledged or not — HAT fix, Leg 4: acknowledgment no
    // longer hides the button); recent-new = recent AND not yet acknowledged (the
    // un-viewed "attention" emphasis, cleared by acknowledge() without hiding).
    btn.classList.toggle('downloads-active', model.active);
    btn.classList.toggle('downloads-recent', model.visible && !model.active);
    btn.classList.toggle('downloads-recent-new', model.attention);
    btn.setAttribute('aria-label', model.ariaLabel);
    btn.title = model.ariaLabel;

    if (badge) {
      // Badge = in-flight count; hidden at 0 (recent-only state is carried by the
      // .downloads-recent class + the aria-label, per DD5's badge ruling).
      if (model.activeCount > 0) {
        badge.textContent = String(model.activeCount);
        badge.classList.remove('hidden');
      } else {
        badge.textContent = '';
        badge.classList.add('hidden');
      }
    }
  }

  function scheduleExpiry() {
    if (expiryTimer !== null) clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => {
      expiryTimer = null;
      state = reduce(state, { type: 'expire', now: Date.now() });
      render();
    }, IDLE_TIMEOUT_MS);
  }

  if (goldfinch && typeof goldfinch.onDownloadProgress === 'function') {
    goldfinch.onDownloadProgress((d) => {
      state = reduce(state, { type: 'progress', d });
      render();
      scheduleExpiry();
    });
  }
  if (goldfinch && typeof goldfinch.onDownloadDone === 'function') {
    goldfinch.onDownloadDone((d) => {
      state = reduce(state, { type: 'done', d, now: Date.now() });
      render();
      scheduleExpiry();
    });
  }

  // Reflect the initial (empty → hidden) state.
  render();

  return {
    /** Leg 3 calls this on popup CLOSE (via the overlay state's refocus). HAT fix (Leg 4):
     * no longer hides the indicator — it only clears the `attention` (new/unseen) visual
     * emphasis; the button stays visible per `recent`/`active` until the idle expiry. A
     * later completion re-raises attention via reduce's ack reset. */
    acknowledge() {
      state = reduce(state, { type: 'acknowledge' });
      render();
    },
    /**
     * The ordered list Leg 3 renders: in-flight first (newest activity), then recent
     * (newest-first). In-flight items carry progress fields; recent items carry savePath.
     * @returns {Array<{ id: number, filename: string, state?: string, active: boolean, received?: number, total?: number, paused?: boolean, savePath?: string|null }>}
     */
    getSnapshot() {
      const inFlight = [...state.inFlight.values()].map((e) => ({
        id: e.id,
        filename: e.filename,
        state: e.state,
        received: e.received,
        total: e.total,
        paused: e.paused,
        active: true,
      }));
      const recent = state.recent.map((e) => ({
        id: e.id,
        filename: e.filename,
        state: e.state,
        savePath: e.savePath,
        active: false,
      }));
      return [...inFlight, ...recent];
    },
    /** @returns {boolean} */
    isVisible() {
      return deriveModel(state).visible;
    },
    /**
     * a11y-sweep seam (mirrors the devtools-button audit hook): force the indicator
     * into a visible recent state by injecting a synthetic completed entry, so the
     * accessibility audit can exercise the button even with no real download history.
     */
    forceShowForAudit() {
      state = reduce(state, {
        type: 'done',
        d: { id: -1, filename: 'audit-sample.bin', state: 'completed', savePath: null },
        now: Date.now(),
      });
      render();
    },
  };
}
