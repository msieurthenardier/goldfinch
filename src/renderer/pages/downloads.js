'use strict';

/**
 * downloads.js — the goldfinch://downloads internal page controller.
 *
 * Renders the merged downloads list (in-progress + persisted terminal) from the
 * origin-checked internal bridge, subscribes to live id-keyed progress/done
 * broadcasts and patches the affected row by id (no full reload per tick), and wires
 * the full per-item control set + list-level "Clear now".
 *
 * CSP: served as a same-origin subresource under default-src 'self' (no
 * 'unsafe-inline'). NO inline event handlers; NO dynamic <script>/<style> injection.
 * All DOM is built with createElement + textContent (filenames/urls are
 * model-controlled but rendered as text regardless).
 *
 * Control gating (by record.state):
 *   - Open / Show     → completed only (in-progress records carry a real PARTIAL
 *                       savePath, so gate on state, not savePath presence).
 *   - Pause / Resume  → in-progress (progressing/paused) only.
 *   - Cancel          → in-progress only.
 *   - Remove          → terminal only (cancel an in-progress item first).
 *   - Retry           → failed/cancelled terminal records only.
 *
 * The actionable savePath is resolved MAIN-SIDE by id — the page never sends a path.
 */

(function () {
  // The bridge only exists on the genuine goldfinch://downloads origin.
  const bridge = window.goldfinchInternal;
  if (!bridge) return;

  const listEl = /** @type {HTMLElement|null} */ (document.getElementById('downloads-list'));
  const emptyEl = /** @type {HTMLElement|null} */ (document.getElementById('downloads-empty'));
  const clearBtn = /** @type {HTMLButtonElement|null} */ (document.getElementById('downloads-clear'));
  if (!listEl || !emptyEl || !clearBtn) return;

  const TERMINAL_STATES = new Set(['completed', 'cancelled', 'interrupted']);
  const IN_PROGRESS_STATES = new Set(['progressing', 'paused']);
  // States a Retry is offered for (a failed/cancelled record).
  const RETRY_STATES = new Set(['cancelled', 'interrupted']);

  // id → row element, so a live broadcast can patch the affected row in place.
  /** @type {Map<number, HTMLElement>} */
  const rowsById = new Map();

  /**
   * Human-readable byte size.
   * @param {number} n
   * @returns {string}
   */
  function fmtSize(n) {
    if (!Number.isFinite(n) || n <= 0) return '';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let v = n;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return (i === 0 ? v : v.toFixed(1)) + ' ' + units[i];
  }

  /**
   * A short status/size line for a record.
   * @param {any} rec
   * @returns {string}
   */
  function statusLine(rec) {
    const state = rec.state;
    if (state === 'completed') {
      const size = fmtSize(rec.total || rec.received);
      return size ? 'Completed · ' + size : 'Completed';
    }
    if (state === 'cancelled') return 'Cancelled';
    if (state === 'interrupted') return 'Failed';
    // Electron keeps state='progressing' while paused; check the boolean.
    if (rec.paused) {
      const size = rec.total > 0
        ? fmtSize(rec.received) + ' of ' + fmtSize(rec.total)
        : fmtSize(rec.received);
      return size ? 'Paused · ' + size : 'Paused';
    }
    // progressing
    if (rec.total > 0) {
      return 'Downloading · ' + fmtSize(rec.received) + ' of ' + fmtSize(rec.total);
    }
    return 'Downloading · ' + fmtSize(rec.received);
  }

  /**
   * Run an action and refresh the row/list afterwards (so a no-op on a pruned id, or
   * a state transition, reflects immediately). `open` may return an error notice.
   * @param {number} id
   * @param {string} action
   * @param {HTMLElement} [noticeEl]
   */
  function runAction(id, action, noticeEl) {
    bridge.downloadsAction(id, action)
      .then((res) => {
        if (res && res.error && noticeEl) {
          noticeEl.textContent = 'Could not open file (it may have been moved or deleted).';
        }
        // Pause/resume/cancel change live state via broadcasts; remove/retry/clear
        // change the persisted set with no broadcast, so re-fetch to stay correct.
        if (action === 'remove' || action === 'retry' || (res && res.ok === false)) {
          refresh();
        }
      })
      .catch(() => { refresh(); });
  }

  /**
   * Build (or rebuild) a row element for a record.
   * @param {any} rec
   * @returns {HTMLElement}
   */
  function buildRow(rec) {
    const li = document.createElement('li');
    li.className = 'download-row';
    li.dataset.id = String(rec.id);
    li.dataset.state = rec.state;
    li.dataset.paused = rec.paused ? 'true' : 'false';

    const main = document.createElement('div');
    main.className = 'download-main';

    const name = document.createElement('div');
    name.className = 'download-name';
    name.textContent = rec.filename || '(unnamed)';
    main.appendChild(name);

    const status = document.createElement('div');
    status.className = 'download-status';
    status.textContent = statusLine(rec);
    main.appendChild(status);

    // Live progress bar for in-progress records.
    if (IN_PROGRESS_STATES.has(rec.state)) {
      const bar = document.createElement('div');
      bar.className = 'download-progress';
      const fill = document.createElement('div');
      fill.className = 'download-progress-fill';
      const pct = rec.total > 0 ? Math.min(100, Math.round((rec.received / rec.total) * 100)) : 0;
      fill.style.width = pct + '%';
      bar.appendChild(fill);
      main.appendChild(bar);
    }

    // Inline notice (e.g. open-failed), announced via the row.
    const notice = document.createElement('div');
    notice.className = 'download-notice';
    main.appendChild(notice);

    li.appendChild(main);

    // ── Controls (keyboard-focusable <button>s), gated by state ──
    const controls = document.createElement('div');
    controls.className = 'download-controls';

    /**
     * @param {string} label
     * @param {string} action
     * @param {boolean} [primary]
     */
    function addBtn(label, action, primary) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'download-btn' + (primary ? ' primary' : '');
      b.textContent = label;
      b.setAttribute('aria-label', label + ' ' + (rec.filename || 'download'));
      b.addEventListener('click', () => runAction(rec.id, action, notice));
      controls.appendChild(b);
    }

    if (rec.state === 'completed') {
      addBtn('Open', 'open', true);
      addBtn('Show in folder', 'show');
    }
    if (IN_PROGRESS_STATES.has(rec.state)) {
      // Electron keeps state='progressing' while paused; use the paused boolean.
      addBtn(rec.paused ? 'Resume' : 'Pause', rec.paused ? 'resume' : 'pause');
      addBtn('Cancel', 'cancel');
    }
    if (RETRY_STATES.has(rec.state)) {
      addBtn('Retry', 'retry');
    }
    if (TERMINAL_STATES.has(rec.state)) {
      addBtn('Remove', 'remove');
    }

    li.appendChild(controls);
    return li;
  }

  /**
   * Full render from a records array (newest first). Rebuilds the list + the
   * id→row index.
   * @param {Array<any>} records
   */
  function render(records) {
    rowsById.clear();
    listEl.textContent = '';
    // Newest first by id (ids are monotonic).
    const sorted = records.slice().sort((a, b) => b.id - a.id);
    for (const rec of sorted) {
      const row = buildRow(rec);
      rowsById.set(rec.id, row);
      listEl.appendChild(row);
    }
    emptyEl.hidden = sorted.length > 0;
  }

  /** Re-fetch the full list and render. */
  function refresh() {
    return bridge.downloadsList().then(render).catch(() => {});
  }

  /**
   * Patch a single in-progress row from a live progress broadcast. If the row is
   * unknown (a brand-new download first seen via a broadcast), OR the payload signals
   * a terminal/done transition, fall back to a full re-fetch so the row gets full
   * actionable metadata (the broadcast carries no savePath).
   * @param {any} payload  { id, state, received, total, ... }
   */
  function onChanged(payload) {
    if (!payload || typeof payload.id !== 'number') return;
    const row = rowsById.get(payload.id);
    const isTerminal = TERMINAL_STATES.has(payload.state);

    // Unknown id or a terminal transition → re-fetch (backfills savePath/metadata).
    if (!row || isTerminal) {
      refresh();
      return;
    }

    // Live in-progress tick: patch status + progress bar in place (no full reload).
    const status = row.querySelector('.download-status');
    if (status) {
      status.textContent = statusLine({
        state: payload.state,
        received: payload.received,
        total: payload.total,
        paused: payload.paused
      });
    }
    const fill = /** @type {HTMLElement|null} */ (row.querySelector('.download-progress-fill'));
    if (fill && payload.total > 0) {
      fill.style.width = Math.min(100, Math.round((payload.received / payload.total) * 100)) + '%';
    }
    // A pause/resume changes the gated control set (Pause↔Resume button). Electron keeps
    // state='progressing' while paused, so compare the paused boolean, not the state string.
    const payloadPaused = Boolean(payload.paused);
    const rowPaused = row.dataset.paused === 'true';
    if (payloadPaused !== rowPaused) {
      refresh();
    }
  }

  // ── Wire-up ──
  clearBtn.addEventListener('click', () => {
    bridge.downloadsClear().then(refresh).catch(() => {});
  });

  // Initial load.
  refresh();

  // Live updates over download-progress + download-done. Clean up the handles on
  // pagehide to prevent listener accumulation across electronmon reloads (the
  // settings page's on/off-handle pattern).
  const handles = bridge.onDownloadsChanged(onChanged);
  window.addEventListener('pagehide', () => bridge.offDownloadsChanged(handles), { once: true });
})();
