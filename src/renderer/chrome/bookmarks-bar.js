// bookmarks-bar.js — the bookmarks bar + its overflow sheet (M15 F1
// "Bookmarking Core and Surfaces" Leg 3). Houses ALL bar/overflow business
// logic per the leg's line-budget FD ruling (renderer.js gets only thin
// wiring: construction, the extended single onChanged closure, and the
// window-controller.js toggle→sendActiveBounds glue lives there, not here).
//
// Rendering: one <button class="bm-item"> per bookmarksClient.list entry, in
// list order, inserted ahead of the always-present #bookmarks-overflow
// chevron (the one fixed child every render preserves).
//
// Overflow: a ResizeObserver on the bar + a cumulative item-width walk (NEW
// pattern — no in-repo precedent; the tab strip is pure CSS) decides how many
// trailing items fit. The rest get `.hidden`; the chevron opens sheet
// menuType `bookmarks-overflow` with a chrome-side SNAPSHOT of exactly the
// overflowed entries (index-dispatched, per DD9 — the sheet is a dumb
// renderer). Re-entrancy guard: skip re-partitioning when the bar's own
// measured size is unchanged from the last pass (design-review-adopted
// defense against ResizeObserver loop-limit warnings during rapid resizes).
//
// Keyboard model (flight-log-noted leg decision): plain document tab order
// over native <button>s, NOT the APG toolbar roving-tabindex pattern — the
// simpler, still keyboard-operable option for a small, infrequently-focused
// row (index.html carries no role="toolbar" for #bookmarks-bar).

/** The chevron's reserved footprint (px) — a fixed literal matching the CSS
 * #bookmarks-overflow width, so the partition math never has to measure a
 * possibly-hidden chevron (display:none reads 0-width). */
const CHEVRON_WIDTH = 24;

/** Pure: derive a one-character monogram tile letter from a bookmark's title
 * (falling back to its URL, then '#'). @param {string} text @returns {string} */
export function monogramLetter(text) {
  const s = (text || '').trim();
  return s ? s[0].toUpperCase() : '#';
}

/** Pure: the "{title}\n{url}" native tooltip text (AC). @param {{title?: string, url?: string}} b */
export function tooltipFor(b) {
  const title = (b && b.title) || (b && b.url) || '';
  return `${title}\n${(b && b.url) || ''}`;
}

/**
 * Pure: which trailing items overflow, given each visible item's measured
 * width, the bar's available content width, and the chevron's reserved
 * footprint. Greedy left-to-right accumulation against a budget that reserves
 * the chevron's width the moment overflow is possible at all (a chevron that
 * itself doesn't fit still renders — DD8 Edge Case "window too narrow for
 * even one item: all items collapse; chevron alone remains").
 * @param {number[]} itemWidths
 * @param {number} availableWidth
 * @param {number} [chevronWidth]
 * @returns {{ visibleCount: number, overflowing: boolean }}
 */
export function partitionOverflow(itemWidths, availableWidth, chevronWidth = CHEVRON_WIDTH) {
  if (!itemWidths.length) return { visibleCount: 0, overflowing: false };
  const total = itemWidths.reduce((a, b) => a + b, 0);
  if (total <= availableWidth) return { visibleCount: itemWidths.length, overflowing: false };
  const budget = availableWidth - chevronWidth;
  let running = 0;
  let visibleCount = 0;
  for (const w of itemWidths) {
    if (running + w > budget) break;
    running += w;
    visibleCount++;
  }
  return { visibleCount, overflowing: true };
}

/** Pure: the overflow sheet's row model, built from the SNAPSHOT (the
 * overflowed bookmark entries only) — `{id:'bookmark:<i>', label}` per DD9
 * index dispatch (snapshot-local indices). @param {any[]} snapshot */
export function overflowSheetModel(snapshot) {
  return snapshot.map((b, i) => ({ id: `bookmark:${i}`, label: (b && (b.title || b.url)) || '' }));
}

/**
 * Pure: resolve a channel-4 / per-row-contextmenu id (`bookmark:<i>` /
 * `bookmark-edit:<i>`) against the snapshot's bounds — VALIDATED-NO-OP
 * discipline (DD9): an out-of-range/malformed id resolves null, never throws.
 * @param {unknown} id @param {any[]} snapshot
 * @returns {{ kind: 'bookmark'|'bookmark-edit', index: number, bookmark: any } | null}
 */
export function resolveOverflowRowId(id, snapshot) {
  const m = typeof id === 'string' ? /^(bookmark|bookmark-edit):(\d+)$/.exec(id) : null;
  if (!m) return null;
  const index = Number(m[2]);
  if (!Number.isInteger(index) || index < 0 || index >= snapshot.length) return null;
  return { kind: /** @type {'bookmark'|'bookmark-edit'} */ (m[1]), index, bookmark: snapshot[index] };
}

/**
 * @param {{
 *   document: Document, ResizeObserver: any, els: any,
 *   bookmarksClient: any, navigate: (url: string) => void,
 *   createTab: (url: string, container: any, opts?: any) => any,
 *   openBookmarkEditOverlay: (bookmark: any, anchorEl?: any) => void,
 *   overlayMenuClient: { open: Function, close: Function, trigger: Function },
 *   overlayMenuState: { open: boolean },
 *   rightAnchorOf: (el: any) => any
 * }} deps
 */
export function createBookmarksBar({
  document, ResizeObserver, els,
  bookmarksClient, navigate, createTab, openBookmarkEditOverlay,
  overlayMenuClient, overlayMenuState, rightAnchorOf
}) {
  /** @type {any[]} the chrome-side snapshot the overflow sheet was last opened with. */
  let overflowSnapshot = [];
  /** @type {{ width: number, height: number } | null} re-entrancy guard. */
  let lastMeasuredSize = null;

  function itemEls() {
    return [...els.bookmarksBar.children].filter((el) => el.classList.contains('bm-item'));
  }

  function clearItems() {
    for (const el of itemEls()) el.remove();
  }

  /** @param {any} b */
  function buildItemButton(b) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bm-item';
    btn.title = tooltipFor(b);

    if (typeof b.icon === 'string' && b.icon.startsWith('data:image')) {
      const img = document.createElement('img');
      img.className = 'bm-icon';
      img.alt = '';
      img.src = b.icon;
      btn.appendChild(img);
    } else {
      const mono = document.createElement('span');
      mono.className = 'bm-mono';
      mono.textContent = monogramLetter(b.title || b.url);
      btn.appendChild(mono);
    }

    const label = document.createElement('span');
    label.className = 'bm-label';
    label.textContent = b.title || b.url || '';
    btn.appendChild(label);

    // Left-click / Enter (native <button> synthesizes click) navigates the
    // CURRENT tab via the same navigation path omnibox suggestion acceptance
    // uses (the untrusted gate stays intact — never a trusted create).
    // Ctrl/Cmd+click rides the SAME click event to a background open instead
    // (three-arg createTab form — options in the THIRD slot; see DD10 note
    // below on auxclick for why the 2-arg form is forbidden here).
    btn.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey) {
        createTab(b.url, null, { background: true });
      } else {
        navigate(b.url);
      }
    });
    // Middle-click (auxclick button 1): background-open. THREE-arg createTab
    // form is non-negotiable — createTab(url, null, { background: true }) —
    // the 2-arg form would land { background: true } in the CONTAINER
    // parameter, silently defeating background-open AND corrupting jar
    // resolution (design-review correction, leg-3 AC).
    btn.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      createTab(b.url, null, { background: true });
    });
    // Right-click: the leg-2 quick-edit popover, anchored at THIS item — the
    // bookmark object is captured in this closure at BUILD time (TOCTOU rule:
    // render() rebuilds the whole bar on every bookmarks-changed re-query, so
    // a stale closure never survives past the next change it would matter for).
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openBookmarkEditOverlay(b, btn);
    });

    return btn;
  }

  /** @param {number} availableWidth */
  function applyOverflowPartition(availableWidth) {
    const items = itemEls();
    if (!items.length) {
      els.bookmarksOverflow.classList.add('hidden');
      overflowSnapshot = [];
      return;
    }
    // Measure TRUE widths — un-hide everything first (a previously-hidden
    // item reads 0-width via getBoundingClientRect under display:none).
    for (const el of items) el.classList.remove('hidden');
    const widths = items.map((el) => el.getBoundingClientRect().width);
    const { visibleCount, overflowing } = partitionOverflow(widths, availableWidth, CHEVRON_WIDTH);
    overflowSnapshot = overflowing ? bookmarksClient.list.slice(visibleCount) : [];
    items.forEach((el, i) => el.classList.toggle('hidden', i >= visibleCount));
    els.bookmarksOverflow.classList.toggle('hidden', !overflowing);
  }

  /** ResizeObserver callback body: re-entrancy-guarded re-measure (design
   * review — defends against ResizeObserver loop-limit warnings). */
  function onResize() {
    const rect = els.bookmarksBar.getBoundingClientRect();
    if (
      lastMeasuredSize &&
      rect.width === lastMeasuredSize.width &&
      rect.height === lastMeasuredSize.height
    ) {
      return; // unchanged since the last pass — no re-partition needed
    }
    lastMeasuredSize = { width: rect.width, height: rect.height };
    applyOverflowPartition(rect.width);
  }

  /** Full re-render from bookmarksClient.list — idempotent, called on boot
   * and on every post-refresh signal (the extended onChanged closure). Always
   * re-partitions directly (bypassing the resize guard): the CONTENT changed
   * even when the bar's own box didn't. */
  function render() {
    clearItems();
    for (const b of bookmarksClient.list) {
      els.bookmarksBar.insertBefore(buildItemButton(b), els.bookmarksOverflow);
    }
    const rect = els.bookmarksBar.getBoundingClientRect();
    lastMeasuredSize = { width: rect.width, height: rect.height };
    applyOverflowPartition(rect.width);
  }

  // Right-aligned (HAT fix, Leg 5): the chevron sits at the bar's far right,
  // so the menu's RIGHT edge anchors to it and the box grows leftward —
  // the kebab idiom — instead of bleeding past the viewport's right edge.
  const overflowAnchor = () => rightAnchorOf(els.bookmarksOverflow);

  /** @param {number} [startIndex] */
  function openOverflowMenu(startIndex = 0) {
    overlayMenuClient.open('bookmarks-overflow', overflowSheetModel(overflowSnapshot), overflowAnchor(), startIndex);
  }

  els.bookmarksOverflow.addEventListener('click', () => {
    overlayMenuClient.trigger('bookmarks-overflow', () => openOverflowMenu(0));
  });
  els.bookmarksOverflow.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
      e.preventDefault();
      openOverflowMenu(0);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      openOverflowMenu(-1);
    }
  });

  /** Channel-6 dispatch for menuType 'bookmarks-overflow' (renderer.js calls
   * this from dispatchOverlayActivation) — VALIDATED-NO-OP on every id.
   * @param {string} id */
  function dispatch(id) {
    const resolved = resolveOverflowRowId(id, overflowSnapshot);
    if (!resolved) return;
    if (resolved.kind === 'bookmark') {
      navigate(resolved.bookmark.url);
    } else {
      openBookmarkEditOverlay(resolved.bookmark, els.bookmarksOverflow);
    }
  }

  /** DD9 cache freshness: called from the extended onChanged closure — if the
   * overflow sheet is open when bookmarks-changed re-query completes, close
   * it (valid 'superseded' reason); the next open re-snapshots. */
  function closeOverflowIfOpen() {
    if (overlayMenuState.open) overlayMenuClient.close('superseded');
  }

  new ResizeObserver(onResize).observe(els.bookmarksBar);

  return { render, dispatch, closeOverflowIfOpen };
}
