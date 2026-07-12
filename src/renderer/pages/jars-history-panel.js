// @ts-check

/**
 * jars-history-panel.js — the History panel's content module (M08 Flight 3
 * Leg 2 / flight DD5–DD7). `jars.js` builds one instance per persistent
 * jar's History region and delegates to it; this module owns everything
 * INSIDE the mount `<div class="jar-history-mount">` it is handed — the
 * retention select, the search input, the visit list + paging, and per-row
 * delete. It never reaches jars.js's page-level transient/reconcile state
 * or its per-section DOM registry, and never touches anything outside its
 * own `mountEl` — its only channels are the constructor deps and the four
 * returned hooks (DD7's DOM-contract divert criterion).
 *
 * DOM contract (DD7, Architect review): the History region has EXACTLY TWO
 * children — (a) jars.js's own `.jar-data-controls` block (Clear-History
 * button + confirm, from `buildRegionControls()`) and (b) this module's
 * mount. jars.js never writes inside (b); this module never touches (a) or
 * the region node itself — it only ever sees the mount element.
 *
 * Views + staleness (DD6): a single monotonic `viewGen` counter is bumped by
 * every `refresh()` call (initial fetch, search-debounce fetch, Show-more
 * page, and `onHistoryChanged` re-fetch alike) — an async response paints
 * only if its captured token is still current, so a late/out-of-order
 * response (a stale search result, a Show-more page landing after a reset)
 * is silently discarded rather than corrupting the view.
 *
 * Patch discipline: the retention `<select>` and the search `<input>` are
 * built ONCE at construction and never destroyed/recreated — only the list
 * container's children and the status line are replaced on paint. The
 * search input therefore lives outside the repainted subtree by
 * construction, so a paint never disturbs its focus/caret.
 *
 * No unit suite for this module (house practice for page controllers) —
 * static nets (typecheck/lint/grep-ACs) only; live behavior is leg 3.
 */

const RETENTION_PRESETS = Object.freeze([7, 14, 30, 90, 180, 365]);
const PAGE_LIMIT = 50;
const SEARCH_DEBOUNCE_MS = 250;

/**
 * @param {{
 *   bridge: GoldfinchInternalBridge,
 *   jarId: string,
 *   mountEl: HTMLElement,
 *   onError: (message: string) => void,
 *   getRetentionDays: () => number
 * }} deps
 * @returns {{ onExpanded: () => void, onHistoryChanged: () => void, onJarsRow: () => void, destroy: () => void }}
 */
export function createHistoryPanel({ bridge, jarId, mountEl, onError, getRetentionDays }) {
  // ---------------------------------------------------------------------
  // Mount DOM (built once at construction; all textContent — never markup
  // from data). Order: retention row, search row, list container, status
  // line, Show-more button (leg spec #1).
  // ---------------------------------------------------------------------

  const retentionLabel = document.createElement('label');
  retentionLabel.className = 'jar-history-retention-label';
  retentionLabel.appendChild(document.createTextNode('Keep history for:'));
  const retentionSelect = document.createElement('select');
  retentionSelect.className = 'jar-history-retention-select';
  retentionLabel.appendChild(retentionSelect);
  mountEl.appendChild(retentionLabel);

  const searchInput = document.createElement('input');
  searchInput.type = 'search';
  searchInput.className = 'jar-history-search';
  searchInput.setAttribute('aria-label', 'Search history');
  searchInput.placeholder = 'Search history';
  mountEl.appendChild(searchInput);

  const listEl = document.createElement('ul');
  listEl.className = 'jar-history-list';
  listEl.setAttribute('role', 'list');
  mountEl.appendChild(listEl);

  const statusLine = document.createElement('p');
  statusLine.className = 'jar-history-status';
  statusLine.setAttribute('aria-live', 'polite');
  mountEl.appendChild(statusLine);

  const showMoreBtn = document.createElement('button');
  showMoreBtn.type = 'button';
  showMoreBtn.className = 'jar-btn jar-history-show-more';
  showMoreBtn.textContent = 'Show more';
  showMoreBtn.hidden = true;
  mountEl.appendChild(showMoreBtn);

  // ---------------------------------------------------------------------
  // Retention select (DD5): presets + a non-preset "current value" option,
  // instant-apply on change.
  // ---------------------------------------------------------------------

  /** @type {number} */
  let lastKnownRetention = getRetentionDays();

  /** @param {number} days */
  function ensureRetentionOption(days) {
    const has = Array.from(retentionSelect.options).some((opt) => Number(opt.value) === days);
    if (has) return;
    const opt = document.createElement('option');
    opt.value = String(days);
    opt.textContent = `${days} days`;
    retentionSelect.appendChild(opt);
  }

  for (const preset of RETENTION_PRESETS) {
    const opt = document.createElement('option');
    opt.value = String(preset);
    opt.textContent = `${preset} days`;
    retentionSelect.appendChild(opt);
  }
  ensureRetentionOption(lastKnownRetention);
  retentionSelect.value = String(lastKnownRetention);

  retentionSelect.addEventListener('change', () => {
    const days = Number(retentionSelect.value);
    const prior = lastKnownRetention;
    lastKnownRetention = days;
    bridge
      .jarsSetRetention({ id: jarId, days })
      .then((result) => {
        if (!result || !result.ok) {
          lastKnownRetention = prior;
          retentionSelect.value = String(prior);
          onError('Could not update retention');
        }
      })
      .catch(() => {
        lastKnownRetention = prior;
        retentionSelect.value = String(prior);
        onError('Could not update retention');
      });
  });

  // ---------------------------------------------------------------------
  // List + search + paging state.
  // ---------------------------------------------------------------------

  let viewGen = 0;
  let initialFetchStarted = false;
  let currentQuery = '';
  /** @type {Array<{ id: number, url: string, title: (string|null), visitedAt: number }>} */
  let renderedRows = [];
  /** @type {number|null} */
  let searchDebounceHandle = null;

  /**
   * @param {{ id: number, url: string, title: (string|null), visitedAt: number }} row
   * @returns {HTMLLIElement}
   */
  function buildRow(row) {
    const li = document.createElement('li');
    li.className = 'jar-history-row';

    const textWrap = document.createElement('div');
    textWrap.className = 'jar-history-row-text';

    const primary = row.title || row.url;
    const primaryLine = document.createElement('p');
    primaryLine.className = 'jar-history-row-primary';
    primaryLine.textContent = primary;
    textWrap.appendChild(primaryLine);

    // Host is derived defensively (design review): rows carry no host field,
    // and a malformed/relative url must never throw here.
    let host = '';
    try {
      host = new URL(row.url).host;
    } catch {
      // leave host as '' — never throw on a malformed/relative url.
    }
    const time = new Date(row.visitedAt).toLocaleString();
    const secondaryLine = document.createElement('p');
    secondaryLine.className = 'jar-history-row-secondary';
    secondaryLine.textContent = `${host} · ${time}`;
    textWrap.appendChild(secondaryLine);

    li.appendChild(textWrap);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'jar-history-row-delete';
    deleteBtn.textContent = '×';
    deleteBtn.setAttribute('aria-label', `Delete visit: ${primary}`);
    deleteBtn.addEventListener('click', () => {
      // No optimistic removal — the history-changed broadcast drives the
      // repaint (render-from-broadcast rule, DD6).
      bridge
        .historyDelete({ jarId, visitId: row.id })
        .then((result) => {
          if (!result || !result.ok) onError('Could not delete visit');
        })
        .catch(() => onError('Could not delete visit'));
    });
    li.appendChild(deleteBtn);

    return li;
  }

  function paintStatusLine() {
    if (renderedRows.length === 0) {
      statusLine.textContent = 'No visits recorded';
      return;
    }
    statusLine.textContent = `Showing ${renderedRows.length} of many`;
  }

  /**
   * @param {number|undefined} beforeId
   * @returns {Promise<any>}
   */
  function fetchPage(beforeId) {
    if (currentQuery !== '') {
      return bridge.historySearch({ jarId, query: currentQuery, limit: PAGE_LIMIT });
    }
    /** @type {{ jarId: string, limit: number, before?: number }} */
    const payload = { jarId, limit: PAGE_LIMIT };
    if (beforeId !== undefined) payload.before = beforeId;
    return bridge.historyList(payload);
  }

  /**
   * Query + paint (or append) one page, guarded by the view-generation
   * token (DD6). `append: true` is the "Show more" path — it passes the
   * numeric id of the LAST rendered row as the cursor; any other call is a
   * reset (first fetch, search change, history-changed refresh) and omits
   * `before` entirely.
   * @param {{ append?: boolean }} [opts]
   */
  function refresh(opts) {
    const append = !!(opts && opts.append);
    const beforeId = append && renderedRows.length ? renderedRows[renderedRows.length - 1].id : undefined;
    const isSearch = currentQuery !== '';

    viewGen += 1;
    const token = viewGen;
    if (append) showMoreBtn.disabled = true;

    fetchPage(beforeId)
      .then((result) => {
        if (token !== viewGen) return; // stale — a reset or a newer page superseded this one
        if (append) showMoreBtn.disabled = false;
        if (!result || !result.ok) {
          onError('Could not load history');
          return;
        }
        const rows = Array.isArray(result.visits) ? result.visits : [];
        if (append) {
          renderedRows = renderedRows.concat(rows);
          for (const row of rows) listEl.appendChild(buildRow(row));
        } else {
          renderedRows = rows;
          listEl.textContent = '';
          for (const row of rows) listEl.appendChild(buildRow(row));
        }
        // Show-more visibility (pinned): no hasMore flag in the response —
        // show the button iff the last PAGE's length is exactly the limit;
        // search is always single-page.
        showMoreBtn.hidden = isSearch || rows.length !== PAGE_LIMIT;
        paintStatusLine();
      })
      .catch(() => {
        if (token !== viewGen) return;
        if (append) showMoreBtn.disabled = false;
        onError('Could not load history');
      });
  }

  searchInput.addEventListener('input', () => {
    if (searchDebounceHandle != null) window.clearTimeout(searchDebounceHandle);
    const value = searchInput.value;
    searchDebounceHandle = window.setTimeout(() => {
      searchDebounceHandle = null;
      currentQuery = value.trim();
      refresh();
    }, SEARCH_DEBOUNCE_MS);
  });

  showMoreBtn.addEventListener('click', () => refresh({ append: true }));

  // ---------------------------------------------------------------------
  // Hooks
  // ---------------------------------------------------------------------

  function onExpanded() {
    if (initialFetchStarted) return; // subsequent expands no-op once a view has painted
    initialFetchStarted = true;
    refresh();
  }

  function onHistoryChanged() {
    if (!initialFetchStarted) return; // collapsed panels only refresh the count (jars.js's own wiring)
    refresh(); // re-run the CURRENT view (recent or active search) top-page
  }

  function onJarsRow() {
    // No argument (design review — the page-model JarRow lacks
    // retentionDays); re-read via getRetentionDays() instead. Patch-in-place:
    // never overwrite a focused select.
    if (document.activeElement === retentionSelect) return;
    const days = getRetentionDays();
    if (days === lastKnownRetention) return;
    ensureRetentionOption(days);
    retentionSelect.value = String(days);
    lastKnownRetention = days;
  }

  function destroy() {
    if (searchDebounceHandle != null) {
      window.clearTimeout(searchDebounceHandle);
      searchDebounceHandle = null;
    }
    viewGen += 1; // kills any in-flight late paint
    mountEl.textContent = '';
  }

  return { onExpanded, onHistoryChanged, onJarsRow, destroy };
}
