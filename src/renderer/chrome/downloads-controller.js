// @ts-check

import { initialState, reduce, deriveModel, IDLE_TIMEOUT_MS } from './downloads-indicator-model.js';

/**
 * Owns the app-scoped downloads indicator and its downloads-sheet behavior.
 * The chrome composition root supplies only the shared overlay transport.
 * @param {{
 *   els: Record<string, any>, goldfinch: any,
 *   openOverlayMenu: (menuType: string, model: any[], anchor: any, startIndex?: number, opts?: any) => boolean,
 *   closeOverlayMenu: (reason: string) => void,
 *   triggerOverlayMenu: (menuType: string, open: () => void) => void,
 *   openDownloadsPage: () => void,
 *   rightSheetAnchor: (webviewsRect: DOMRect, triggerRect: DOMRect) => any,
 *   requestAnimationFrame?: (cb: FrameRequestCallback) => number,
 *   cancelAnimationFrame?: (id: number) => void,
 *   scheduleTimeout?: typeof setTimeout,
 *   cancelTimeout?: typeof clearTimeout,
 *   now?: () => number
 * }} deps
 */
export function createDownloadsController({
  els,
  goldfinch,
  openOverlayMenu,
  closeOverlayMenu,
  triggerOverlayMenu,
  openDownloadsPage,
  rightSheetAnchor,
  requestAnimationFrame: requestFrame = requestAnimationFrame,
  cancelAnimationFrame: cancelFrame = cancelAnimationFrame,
  scheduleTimeout = setTimeout,
  cancelTimeout = clearTimeout,
  now = Date.now,
}) {
  let state = initialState();
  /** @type {ReturnType<typeof setTimeout> | null} */
  let expiryTimer = null;
  /** @type {number | null} */
  let paintRaf = null;
  const observedIds = new Set();
  const openIds = new Set();
  const btn = els.downloadsIndicator;
  const badge = els.downloadsIndicatorBadge;

  function render() {
    if (!btn) return;
    const model = deriveModel(state);
    btn.classList.toggle('hidden', !model.visible);
    btn.classList.toggle('downloads-active', model.active);
    btn.classList.toggle('downloads-recent', model.visible && !model.active);
    btn.classList.toggle('downloads-recent-new', model.attention);
    btn.setAttribute('aria-label', model.ariaLabel);
    btn.title = model.ariaLabel;
    if (!badge) return;
    if (model.activeCount > 0) {
      badge.textContent = String(model.activeCount);
      badge.classList.remove('hidden');
    } else {
      badge.textContent = '';
      badge.classList.add('hidden');
    }
  }

  function scheduleExpiry() {
    if (expiryTimer !== null) cancelTimeout(expiryTimer);
    const elapsed = state.lastCompletionAt == null ? 0 : Math.max(0, now() - state.lastCompletionAt);
    const delay = Math.max(0, IDLE_TIMEOUT_MS - elapsed);
    expiryTimer = scheduleTimeout(() => {
      expiryTimer = null;
      state = reduce(state, { type: 'expire', now: now() });
      render();
      schedulePopupPaint();
    }, delay);
  }

  /** @returns {Array<{ id: number, filename: string, state?: string, received?: number, total?: number, paused?: boolean, active: boolean }>} */
  function snapshot() {
    const inFlight = [...state.inFlight.values()].map((entry) => ({ ...entry, active: true }));
    const recent = state.recent.map((entry) => ({
      id: entry.id,
      filename: entry.filename,
      state: entry.state,
      received: undefined,
      total: undefined,
      paused: undefined,
      active: false,
    }));
    return [...inFlight, ...recent];
  }

  function popupModel() {
    const rows = snapshot().map((entry) => ({
      id: entry.id,
      filename: entry.filename,
      completed: entry.state === 'completed',
      received: entry.received,
      total: entry.total,
      paused: entry.paused,
    }));
    openIds.clear();
    for (const row of rows) openIds.add(row.id);
    return rows;
  }

  function anchor() {
    return rightSheetAnchor(
      els.webviews.getBoundingClientRect(),
      els.downloadsIndicator.getBoundingClientRect()
    );
  }

  function openPopup() {
    const model = popupModel();
    if (!model.length) return;
    openOverlayMenu('downloads', model, anchor(), 0);
  }

  function paintPopup() {
    const model = popupModel();
    if (!model.length) {
      closeOverlayMenu('input-empty');
      return;
    }
    openOverlayMenu('downloads', model, anchor(), 0, { noFocus: true });
  }

  function schedulePopupPaint() {
    if (!overlayState.open || paintRaf !== null) return;
    paintRaf = requestFrame(() => {
      paintRaf = null;
      if (overlayState.open) paintPopup();
    });
  }

  function applyEvent(event) {
    const id = event && event.d && event.d.id;
    if (typeof id === 'number') observedIds.add(id);
    state = reduce(state, event);
    render();
    scheduleExpiry();
    schedulePopupPaint();
  }

  const overlayState = {
    open: false,
    token: 0,
    blurClosedAt: -Infinity,
    ariaTarget: () => els.downloadsIndicator,
    refocus(reason) {
      if (paintRaf !== null) {
        cancelFrame(paintRaf);
        paintRaf = null;
      }
      state = reduce(state, { type: 'acknowledge' });
      render();
      if ((reason === 'escape' || reason === 'activated') && deriveModel(state).visible) {
        els.downloadsIndicator.focus();
      } else {
        els.address.focus();
      }
    },
  };

  if (goldfinch && typeof goldfinch.onDownloadProgress === 'function') {
    goldfinch.onDownloadProgress((d) => applyEvent({ type: 'progress', d }));
  }
  if (goldfinch && typeof goldfinch.onDownloadDone === 'function') {
    goldfinch.onDownloadDone((d) => applyEvent({ type: 'done', d, now: now() }));
  }
  if (goldfinch && typeof goldfinch.downloadsSnapshot === 'function') {
    Promise.resolve(goldfinch.downloadsSnapshot()).then((rows) => {
      state = reduce(state, { type: 'hydrate', d: rows, seen: observedIds, now: now() });
      render();
      scheduleExpiry();
      schedulePopupPaint();
    }).catch(() => {});
  }

  render();

  btn?.addEventListener('click', () => {
    if (!btn.classList.contains('hidden')) triggerOverlayMenu('downloads', openPopup);
  });
  btn?.addEventListener('keydown', (event) => {
    if (!['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    if (!btn.classList.contains('hidden')) openPopup();
  });

  function handleActivation(payload) {
    if (!payload || payload.menuType !== 'downloads' || typeof payload.id !== 'string') return false;
    const { id } = payload;
    if (id === 'dl:page') {
      openDownloadsPage();
      return true;
    }
    const openPrefix = 'dl:open:';
    const folderPrefix = 'dl:folder:';
    const action = id.startsWith(openPrefix) ? 'open' : id.startsWith(folderPrefix) ? 'folder' : null;
    if (!action) return true;
    const downloadId = Number(id.slice(action === 'open' ? openPrefix.length : folderPrefix.length));
    if (!Number.isInteger(downloadId) || !openIds.has(downloadId)) return true;
    if (action === 'open') goldfinch.openDownloadedFile(downloadId);
    else goldfinch.revealDownloadedFile(downloadId);
    return true;
  }

  function showDownloadsIndicatorForAudit() {
    applyEvent({
      type: 'done',
      d: { id: -1, filename: 'audit-sample.bin', state: 'completed', savePath: null },
      now: now(),
    });
  }

  function openDownloadsOverlayForAudit() {
    showDownloadsIndicatorForAudit();
    // Fill the cap so the real a11y sweep exercises the overflow region, not
    // merely the one-row popup shape.
    for (let i = 1; i < 25; i++) {
      applyEvent({
        type: 'done',
        d: { id: -1 - i, filename: `audit-sample-${i + 1}.bin`, state: 'completed' },
        now: now(),
      });
    }
    openPopup();
  }

  return {
    overlayState,
    handleActivation,
    showDownloadsIndicatorForAudit,
    openDownloadsOverlayForAudit,
  };
}
