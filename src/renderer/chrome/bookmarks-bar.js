// bookmarks-bar.js — the bookmarks bar + its overflow sheet (M15 F1
// "Bookmarking Core and Surfaces" Leg 3; jar-resolved M15 F2 "Jar-Scoped
// Bookmarks" Leg 3). Houses ALL bar/overflow business logic per the leg's
// line-budget FD ruling (renderer.js gets only thin wiring: construction,
// the extended single onChanged closure, and the window-controller.js
// toggle→sendActiveBounds glue lives there, not here).
//
// Rendering: `render(jarId)` renders `bookmarksClient.listFor(jarId)` — the
// last-rendered jarId is remembered (`currentJarId`) so the ResizeObserver's
// re-partition pass and the overflow snapshot both stay scoped to the SAME
// jar without needing the caller to re-pass it. One <button class="bm-item">
// per entry, in list order, inserted ahead of the always-present
// #bookmarks-overflow chevron (the one fixed child every render preserves).
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

/** #bookmarks-bar's own flex `gap` and per-side horizontal `padding` (px) —
 * fixed literals pinned against styles.css the same way CHEVRON_WIDTH is (no
 * getComputedStyle round-trip inside a ResizeObserver callback; the CSS rule
 * carries the matching back-reference comment). M15 F2 Leg 4 behavior-test fix
 * (`bookmarks-bar` spec): the M15 F1 Leg 3 partition math budgeted for item
 * widths and the chevron ONLY, so on a full bar the chevron was laid out past
 * the bar's content edge and clipped away by `overflow: hidden` — DOM-present,
 * still Tab-focusable, but invisible (a focus-order defect too). The bar's own
 * chrome — 2×6px padding, 2px between every flex child — has to be paid for. */
const BAR_GAP = 2;
const BAR_PADDING_X = 6;

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
 * width, the bar's available CONTENT width (padding already excluded — see
 * applyOverflowPartition), the chevron's reserved footprint, and the flex gap
 * between every pair of adjacent children. Greedy left-to-right accumulation
 * against a budget that reserves the chevron's width the moment overflow is
 * possible at all (a chevron that itself doesn't fit still renders — DD8 Edge
 * Case "window too narrow for even one item: all items collapse; chevron alone
 * remains").
 *
 * The gap can't be pre-subtracted by the caller: the number of gaps is
 * (visibleCount) — one before each item after the first, plus one between the
 * last visible item and the chevron — and visibleCount is exactly what this
 * function computes. So both the no-overflow test and the accumulation loop
 * price gaps themselves (M15 F2 Leg 4 behavior-test fix; ignoring them
 * over-budgeted the row by up to 2px × children and pushed the chevron out of
 * the clipped bar).
 * @param {number[]} itemWidths
 * @param {number} availableWidth
 * @param {number} [chevronWidth]
 * @param {number} [gap]
 * @returns {{ visibleCount: number, overflowing: boolean }}
 */
export function partitionOverflow(itemWidths, availableWidth, chevronWidth = CHEVRON_WIDTH, gap = BAR_GAP) {
  if (!itemWidths.length) return { visibleCount: 0, overflowing: false };
  // Nothing overflows only if every item AND the (n-1) gaps between them fit —
  // the gap-free version of this test let a set that fits only when gaps are
  // ignored take the no-overflow branch, clipping the LAST item instead.
  const total = itemWidths.reduce((a, b) => a + b, 0) + gap * (itemWidths.length - 1);
  if (total <= availableWidth) return { visibleCount: itemWidths.length, overflowing: false };
  let running = 0; // laid-out width of the items admitted so far, gaps included
  let visibleCount = 0;
  for (const w of itemWidths) {
    const next = running + w + (visibleCount ? gap : 0);
    // …plus the gap that will sit between the last visible item and the chevron.
    if (next + gap + chevronWidth > availableWidth) break;
    running = next;
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
 *   openBookmarkEditOverlay: (bookmark: any, anchorEl?: any, jarId?: string|null) => void,
 *   activeContainer: () => any,
 *   overlayMenuClient: { open: Function, close: Function, trigger: Function },
 *   overlayMenuState: { open: boolean },
 *   rightAnchorOf: (el: any) => any
 * }} deps
 */
export function createBookmarksBar({
  document, ResizeObserver, els,
  bookmarksClient, navigate, createTab, openBookmarkEditOverlay, activeContainer,
  overlayMenuClient, overlayMenuState, rightAnchorOf
}) {
  /** @type {any[]} the chrome-side snapshot the overflow sheet was last opened with. */
  let overflowSnapshot = [];
  /** @type {{ width: number, height: number } | null} re-entrancy guard. */
  let lastMeasuredSize = null;
  /** @type {string | null} the jarId the bar is CURRENTLY rendered for — set
   * by every render() call, read by the resize-triggered re-partition and by
   * the overflow snapshot, both of which must stay scoped to that same jar. */
  let currentJarId = null;

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
    // below on auxclick for why the 2-arg form is forbidden here). M15 F2 L3
    // DD7b: the container is the ACTIVE tab's (via `activeContainer()`), not
    // `null` — a `null` container resolves the current DEFAULT jar (or a
    // fresh burner), which would silently open a work-jar bookmark in the
    // wrong jar on middle/Ctrl-click.
    btn.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey) {
        createTab(b.url, activeContainer(), { background: true });
      } else {
        navigate(b.url);
      }
    });
    // Middle-click (auxclick button 1): background-open. THREE-arg createTab
    // form is non-negotiable — createTab(url, activeContainer(), { background:
    // true }) — the 2-arg form would land { background: true } in the
    // CONTAINER parameter, silently defeating background-open AND corrupting
    // jar resolution (design-review correction, leg-3 AC).
    btn.addEventListener('auxclick', (e) => {
      if (e.button !== 1) return;
      e.preventDefault();
      createTab(b.url, activeContainer(), { background: true });
    });
    // Right-click: the leg-2 quick-edit popover, anchored at THIS item — the
    // bookmark object is captured in this closure at BUILD time (TOCTOU rule:
    // render() rebuilds the whole bar on every bookmarks-changed re-query, so
    // a stale closure never survives past the next change it would matter
    // for). `currentJarId` (M15 F2 L3 DD13/L3-DD-E) is the bar's OWN rendered
    // jar — the same value `activeContainer().id` would give by construction,
    // passed explicitly so the popover's captured jar never depends on the
    // active tab still being what it was when this row was built.
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openBookmarkEditOverlay(b, btn, currentJarId);
    });

    return btn;
  }

  /** Takes the bar's MEASURED (border-box) width, as `getBoundingClientRect()`
   * reports it, and partitions against its CONTENT width — #bookmarks-bar has
   * `padding: 0 6px` and no left/right border, so the usable run is 2×
   * BAR_PADDING_X narrower than the measured box. Passing the border-box width
   * straight through was half of the M15 F2 Leg 4 chevron-clipping defect.
   * @param {number} barWidth */
  function applyOverflowPartition(barWidth) {
    const availableWidth = Math.max(0, barWidth - BAR_PADDING_X * 2);
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
    const { visibleCount, overflowing } = partitionOverflow(widths, availableWidth, CHEVRON_WIDTH, BAR_GAP);
    overflowSnapshot = overflowing ? bookmarksClient.listFor(currentJarId).slice(visibleCount) : [];
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

  /** Full re-render from `bookmarksClient.listFor(jarId)` — idempotent,
   * called on boot and on every post-refresh signal (the extended onChanged
   * closure), always for the ACTIVE tab's jar. Always re-partitions directly
   * (bypassing the resize guard): the CONTENT changed even when the bar's
   * own box didn't. @param {string|null} [jarId] */
  function render(jarId = currentJarId) {
    currentJarId = jarId;
    clearItems();
    for (const b of bookmarksClient.listFor(jarId)) {
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
      openBookmarkEditOverlay(resolved.bookmark, els.bookmarksOverflow, currentJarId);
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
