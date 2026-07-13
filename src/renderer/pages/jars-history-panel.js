// @ts-check

/**
 * jars-history-panel.js — the History panel's content module (M08 Flight 3
 * Leg 2 / flight DD5–DD7; reworked M08 Flight 6 Leg 4 for H1/H2/H3 — HAT
 * findings). `jars.js` builds one instance per persistent jar's History
 * region and delegates to it; this module owns everything INSIDE the mount
 * `<div class="jar-history-mount">` it is handed — the retention select, the
 * search input, the visit list + numbered pager, and per-row delete. It
 * never reaches jars.js's page-level transient/reconcile state or its
 * per-section DOM registry, and never touches anything outside its own
 * `mountEl` — its only channels are the constructor deps and the four
 * returned hooks (DD7's DOM-contract divert criterion).
 *
 * DOM contract (DD7, Architect review): the History region has EXACTLY TWO
 * children — (a) jars.js's own `.jar-data-controls` block (Clear-History
 * button + confirm, from `buildRegionControls()`) and (b) this module's
 * mount. jars.js never writes inside (b); this module never touches (a) or
 * the region node itself — it only ever sees the mount element.
 *
 * Views + staleness (DD6): a single monotonic `viewGen` counter is bumped by
 * every `refresh()` call (initial fetch, search-debounce fetch, a pager page
 * click, and `onHistoryChanged` re-fetch alike) — an async response paints
 * only if its captured token is still current, so a late/out-of-order
 * response (a stale search result, a page fetch landing after a reset) is
 * silently discarded rather than corrupting the view.
 *
 * H1 — numbered pager (M08 F6 Leg 4, design review): the cursor/append
 * "Show more" model is GONE — REWORKED, not additively patched. The recent
 * (non-search) view fetches one page at a time via `bridge.historyPage`
 * (offset-paged; `{ jarId, page, pageSize }` -> `{ ok, visits, total }`), and
 * a numbered pager bar (prev/next + page numbers, ellipsis for large counts)
 * replaces the old Show-more button AND the old "Showing X of many" status
 * line (H5 closed — that logic no longer exists). Search stays single-shot
 * via `historySearch` (bounded matches, not numerically paged this leg); a
 * full-page search result shows a plain "Showing first N" note instead.
 *
 * H2 — rows as links, new tab in the SAME jar (M08 F6 Leg 4, design review):
 * each row's primary line is a real `<a href>` (hover shows destination,
 * keyboard-focusable). BOTH `click` and `auxclick` are intercepted — middle-
 * click fires `auxclick`, NOT `click`; left uncaught it falls through to the
 * jars-page's own `setWindowOpenHandler`, which forwards the INTERNAL
 * partition (a jar-isolation surprise, wrong jar). Both handlers
 * `preventDefault()` and call `bridge.openTabInJar({ jarId, url })`, so
 * left/ctrl/middle activation all route through the jar-scoped opener into
 * the correct jar (foreground tab; no true background-tab affordance —
 * accepted, noted in the leg).
 *
 * H3 — trashcan delete icon (M08 F6 Leg 4, design review): the row delete
 * `×` glyph is replaced with the Lucide trash-2 icon. jars.js has its own
 * module-scoped `buildIcon()`/`ICON_DELETE` (not exported — this module must
 * not reach into jars.js internals), so they are DUPLICATED below (~35
 * lines) rather than extracted to a third shared module (this icon has
 * already churned twice; a 3-file extraction wasn't worth it). See jars.js's
 * copy for the canonical source if the icon ever needs to change again —
 * change BOTH copies.
 *
 * Patch discipline: the retention `<select>` and the search `<input>` are
 * built ONCE at construction and never destroyed/recreated — only the list
 * container's children, the status line, and the pager bar's children are
 * replaced on paint. The search input therefore lives outside the repainted
 * subtree by construction, so a paint never disturbs its focus/caret.
 *
 * No unit suite for this module (house practice for page controllers) —
 * static nets (typecheck/lint/grep-ACs) only; live behavior verification is
 * deferred to the hat-reverification closing leg.
 */

const RETENTION_PRESETS = Object.freeze([7, 14, 30, 90, 180, 365]);
const PAGE_LIMIT = 50;
const SEARCH_DEBOUNCE_MS = 250;

// ---------------------------------------------------------------------------
// H3 — duplicated trash-2 icon (cross-ref: src/renderer/pages/jars.js's own
// module-scoped buildIcon()/ICON_DELETE, git 4e1d980 for provenance). NOT
// exported from jars.js, so this module carries its own copy rather than
// reaching into jars.js internals (design review — see module doc above).
// ---------------------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Build a small inline SVG icon from a flat shape list (16x16 box, viewBox
 * 24x24, stroke=currentColor so it inherits the button's text color). Built
 * entirely via createElementNS — NEVER innerHTML/a template string — matching
 * this page's textContent-only CSP convention. Identical to jars.js's copy;
 * keep both in sync if the icon ever changes.
 * @param {ReadonlyArray<{tag: string, attrs: Record<string, string>}>} shapes
 * @returns {SVGSVGElement}
 */
function buildIcon(shapes) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('jar-icon');
  for (const shape of shapes) {
    const el = document.createElementNS(SVG_NS, shape.tag);
    for (const key of Object.keys(shape.attrs)) el.setAttribute(key, shape.attrs[key]);
    svg.appendChild(el);
  }
  return svg;
}

// Lucide "trash-2" path data (ISC license) — same icon set/style vendored
// elsewhere in this page (toolbar/pin-toggle static SVG, jars.js's delete
// button). Identical shape list to jars.js's ICON_DELETE.
/** @type {ReadonlyArray<{tag: string, attrs: Record<string, string>}>} */
const ICON_DELETE = [
  { tag: 'path', attrs: { d: 'M3 6h18' } },
  { tag: 'path', attrs: { d: 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6' } },
  { tag: 'path', attrs: { d: 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2' } },
  { tag: 'line', attrs: { x1: '10', x2: '10', y1: '11', y2: '17' } },
  { tag: 'line', attrs: { x1: '14', x2: '14', y1: '11', y2: '17' } }
];

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
  // line, pager bar (H1 rework — replaces the old Show-more button).
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

  const pagerEl = document.createElement('nav');
  pagerEl.className = 'jar-history-pager';
  pagerEl.setAttribute('aria-label', 'History pages');
  pagerEl.hidden = true;
  mountEl.appendChild(pagerEl);

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
  // List + search + pager state.
  // ---------------------------------------------------------------------

  let viewGen = 0;
  let initialFetchStarted = false;
  let currentQuery = '';
  let currentPage = 1;
  let totalPages = 1;
  /** @type {number|null} */
  let searchDebounceHandle = null;

  /**
   * H2 (design review): the primary line is a real `<a href>`. Both `click`
   * AND `auxclick` are intercepted so left/ctrl/middle click all route
   * through the jar-scoped opener — see the module doc H2 section for why
   * `auxclick` matters (middle-click never fires `click`).
   * @param {string} url
   * @returns {(e: MouseEvent) => void}
   */
  function makeOpenInJarHandler(url) {
    return (e) => {
      e.preventDefault();
      bridge.openTabInJar({ jarId, url }).catch(() => onError('Could not open tab'));
    };
  }

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
    const link = document.createElement('a');
    link.className = 'jar-history-row-primary';
    link.href = row.url;
    link.textContent = primary;
    const openInJar = makeOpenInJarHandler(row.url);
    link.addEventListener('click', openInJar);
    link.addEventListener('auxclick', openInJar);
    textWrap.appendChild(link);

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

    // H3: trashcan icon replaces the '×' glyph. aria-hidden decoration
    // (buildIcon sets it) — the button's own aria-label carries the
    // accessible name, unchanged.
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'jar-history-row-delete';
    deleteBtn.appendChild(buildIcon(ICON_DELETE));
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

  /**
   * H1 (design review): windowed page-number list with ellipsis for large
   * counts — always includes page 1, the last page, and a small window
   * around `current`. Returns `1` alone for a single-page view.
   * @param {number} current
   * @param {number} total
   * @returns {Array<number|'…'>}
   */
  function computePageNumbers(current, total) {
    if (total <= 1) return [1];
    const delta = 1;
    /** @type {Set<number>} */
    const pages = new Set([1, total, current]);
    for (let i = current - delta; i <= current + delta; i++) {
      if (i >= 1 && i <= total) pages.add(i);
    }
    const sorted = Array.from(pages).sort((a, b) => a - b);
    /** @type {Array<number|'…'>} */
    const out = [];
    let prev = 0;
    for (const p of sorted) {
      if (prev && p - prev > 1) out.push('…');
      out.push(p);
      prev = p;
    }
    return out;
  }

  /** @param {number} page */
  function goToPage(page) {
    const clamped = Math.max(1, Math.min(page, totalPages));
    if (clamped === currentPage) return;
    currentPage = clamped;
    refresh();
  }

  /**
   * Paint the pager bar (prev/next + numbers, disabled ends). Hidden
   * entirely for a single-page (or empty) view — replaces the old Show-more
   * button AND the old "Showing X of many" status line (H5 closed).
   * @param {number} current
   * @param {number} total
   */
  function paintPager(current, total) {
    pagerEl.textContent = '';
    if (total <= 1) {
      pagerEl.hidden = true;
      return;
    }
    pagerEl.hidden = false;

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.className = 'jar-btn jar-history-pager-nav';
    prevBtn.textContent = '‹';
    prevBtn.setAttribute('aria-label', 'Previous page');
    prevBtn.disabled = current <= 1;
    prevBtn.addEventListener('click', () => goToPage(current - 1));
    pagerEl.appendChild(prevBtn);

    for (const p of computePageNumbers(current, total)) {
      if (p === '…') {
        const span = document.createElement('span');
        span.className = 'jar-history-pager-ellipsis';
        span.textContent = '…';
        span.setAttribute('aria-hidden', 'true');
        pagerEl.appendChild(span);
        continue;
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'jar-btn jar-history-pager-page';
      btn.textContent = String(p);
      if (p === current) {
        btn.classList.add('jar-history-pager-page-current');
        btn.setAttribute('aria-current', 'page');
      }
      btn.addEventListener('click', () => goToPage(p));
      pagerEl.appendChild(btn);
    }

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'jar-btn jar-history-pager-nav';
    nextBtn.textContent = '›';
    nextBtn.setAttribute('aria-label', 'Next page');
    nextBtn.disabled = current >= total;
    nextBtn.addEventListener('click', () => goToPage(current + 1));
    pagerEl.appendChild(nextBtn);
  }

  /**
   * Query + paint one view: either the active search (single-shot,
   * unpaged) or the current recent page (numbered pager), guarded by the
   * view-generation token (DD6). A page click, a search-debounce fetch, the
   * initial fetch, and an `onHistoryChanged` re-fetch all funnel through
   * here — REWORKED from the old cursor/append model (H1, design review),
   * not additively patched.
   */
  function refresh() {
    const isSearch = currentQuery !== '';

    viewGen += 1;
    const token = viewGen;

    const request = isSearch
      ? bridge.historySearch({ jarId, query: currentQuery, limit: PAGE_LIMIT })
      : bridge.historyPage({ jarId, page: currentPage, pageSize: PAGE_LIMIT });

    request
      .then((result) => {
        if (token !== viewGen) return; // stale — a newer view superseded this fetch
        if (!result || !result.ok) {
          onError('Could not load history');
          return;
        }

        // Self-correction: if the jar's row count shrank (e.g. a delete
        // emptied the last page) and currentPage now overshoots the new
        // total, snap back and re-fetch a valid page. The re-fetch bumps
        // viewGen again, so this (now-stale) paint is skipped.
        if (!isSearch) {
          const freshTotalPages = Math.max(1, Math.ceil((result.total || 0) / PAGE_LIMIT));
          if (currentPage > freshTotalPages) {
            currentPage = freshTotalPages;
            refresh();
            return;
          }
          totalPages = freshTotalPages;
        }

        const rows = Array.isArray(result.visits) ? result.visits : [];
        listEl.textContent = '';
        for (const row of rows) listEl.appendChild(buildRow(row));

        if (isSearch) {
          pagerEl.hidden = true;
          if (rows.length === 0) {
            statusLine.textContent = 'No visits recorded';
          } else if (rows.length === PAGE_LIMIT) {
            // Search is bounded/single-page this leg — a full page is a
            // plain truncation note, never "of many" (no ambiguity: H5).
            statusLine.textContent = `Showing first ${PAGE_LIMIT}`;
          } else {
            statusLine.textContent = '';
          }
        } else {
          statusLine.textContent = rows.length === 0 ? 'No visits recorded' : '';
          paintPager(currentPage, totalPages);
        }
      })
      .catch(() => {
        if (token !== viewGen) return;
        onError('Could not load history');
      });
  }

  searchInput.addEventListener('input', () => {
    if (searchDebounceHandle != null) window.clearTimeout(searchDebounceHandle);
    const value = searchInput.value;
    searchDebounceHandle = window.setTimeout(() => {
      searchDebounceHandle = null;
      currentQuery = value.trim();
      currentPage = 1; // reset paging whenever the view changes (into or out of search)
      refresh();
    }, SEARCH_DEBOUNCE_MS);
  });

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
    refresh(); // re-run the CURRENT view (recent page or active search)
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
