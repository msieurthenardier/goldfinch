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
//
// Drag reorder (M15 F3 "Drag Interactions" Leg 3, DD2/DD3/DD4/DD6b/DD7): bar
// items are native HTML5 drag sources, following tab-controller.js's shape —
// a session snapshotted at `dragstart`, `dragover` for the indicator preview,
// `drop` for the commit, `dragend` for cleanup and the single suppressed-render
// flush. All index math is the pure src/shared/bookmark-drag.js +
// src/shared/tab-order.js pair; nothing here re-derives it.
//
// Drag onto the PAGE (M15 F3 Leg 4, DD5/DD6): the same drag, released over a
// guest instead of the bar. The bar declares the drag to main at `dragstart`
// (bare — no bookmark identity crosses), holds the dragged url past its own
// `dragend` for a bounded window, and navigates the tab main names when the
// drop signal comes back. See `dragHold` for why the holder is the PRIMARY
// path rather than a race guard.
//
// Drag into the OVERFLOW SHEET (M15 F3 Leg 5a, DD2/DD4/DD8): the same drag
// again, released over the sheet's row list. Three parts live here — the
// SPRING-LOAD (dwelling on the chevron mid-drag opens the overflow menu, the
// Chrome/Finder folder-target idiom the operator specified), the
// snapshot↔rendered-rows LOCKSTEP close that keeps index dispatch honest, and
// the commit of the drop index main hands back. The sheet owns its own
// placement indicator and its own drop target (menu-overlay.js); this file
// never learns where inside the menu the pointer was.

//
// Drag OUT OF the overflow sheet (M15 F3 Leg 5b, DD2/DD3/DD4/DD8): the reverse
// direction, and the one where this file owns a session it never started. The
// sheet's rows became drag sources (menu-overlay.js); the chrome learns of the
// gesture only through main's forwarded start/end lifecycle signals, and builds
// a FOREIGN-DRAG SESSION from them — the same geometry snapshot a local
// `dragstart` takes, minus a dragged slot of its own (`draggedIndex: -1`, the
// external-source case). See `foreign`.

import {
  BOOKMARK_DND_MIME,
  visibleSlotRects,
  classifyBookmarkDrop,
  indicatorX,
  isOverChevron,
  barDropToIndex
} from '../../shared/bookmark-drag.js';

/** The chevron's reserved footprint (px) — a fixed literal matching the CSS
 * #bookmarks-overflow width, so the partition math never has to measure a
 * possibly-hidden chevron (display:none reads 0-width).
 *
 * EXPORTED (M15 F3 Leg 2, DD10) solely so `test/unit/bookmarks-bar-css-pin.test.js`
 * can assert it against the styles.css rule it mirrors. Publishing it does NOT
 * touch the evaluate-seam closed set (that is renderer.js's
 * `Object.assign(globalThis, …)` tail) — no FD ruling required. */
export const CHEVRON_WIDTH = 24;

/** #bookmarks-bar's own flex `gap` and per-side horizontal `padding` (px) —
 * fixed literals pinned against styles.css the same way CHEVRON_WIDTH is (no
 * getComputedStyle round-trip inside a ResizeObserver callback; the CSS rule
 * carries the matching back-reference comment). M15 F2 Leg 4 behavior-test fix
 * (`bookmarks-bar` spec): the M15 F1 Leg 3 partition math budgeted for item
 * widths and the chevron ONLY, so on a full bar the chevron was laid out past
 * the bar's content edge and clipped away by `overflow: hidden` — DOM-present,
 * still Tab-focusable, but invisible (a focus-order defect too). The bar's own
 * chrome — 2×6px padding, 2px between every flex child — has to be paid for.
 *
 * EXPORTED (M15 F3 Leg 2, DD10) for the same CSS↔JS pin test as CHEVRON_WIDTH
 * above — the pin is now a RED TEST, not only a pair of back-referencing
 * comments. */
export const BAR_GAP = 2;
export const BAR_PADDING_X = 6;

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

/** How long the chrome keeps the dragged bookmark's url resolvable AFTER its own
 * `dragend` (M15 F3 Leg 4, AC7). Its OWN constant, deliberately independent of
 * main's `BOOKMARK_DRAG_END_GRACE_MS`: the two bound different things — main's
 * grace bounds FORGERY (how long a fabricated signal can still be forwarded),
 * this one bounds RESOLUTION (how long a legitimate signal can still find the
 * url). Set longer than main's so main's declaration gate — the security bound —
 * is always what expires first; this holder is never the authority. */
const DRAG_HOLD_MS = 2000;

/** How long the pointer must sit on the chevron, mid-drag, before the overflow
 * menu springs open (M15 F3 Leg 5a, AC2). The dwell is the whole of the Edge
 * Case "drag passes over the chevron en route elsewhere": `dragover` fires
 * continuously while the pointer rests on a target (operator session 3 recorded
 * 65 of them on the chevron during one deliberate hover), so a drag merely
 * crossing it accumulates nothing. Measured against an injected clock rather
 * than counted in events, because the event RATE is a Chromium implementation
 * detail and a count would silently re-tune itself on a faster machine. */
const SPRING_DWELL_MS = 250;

/**
 * The hard ceiling on a FOREIGN (sheet-sourced) drag session (M15 F3 Leg 5b,
 * AC3). Its own constant on `DRAG_HOLD_MS`'s shape, bounding a third thing again:
 * that one bounds RESOLUTION and main's bounds FORGERY — this one bounds a
 * LATCH.
 *
 * The session is opened by a signal from another process and can only be closed
 * by one, so a path that fails to send `end` (a sheet render-process-gone, a
 * teardown mid-gesture) would leave `dragActive` true forever, freezing BOTH bar
 * rebuild paths and the overflow close for the rest of the session with no
 * recovery. Operator session 4 measured that the sheet DOES receive its own
 * `dragend` despite the blur-close → `removeChildView`, so this is
 * defence-in-depth rather than the primary recovery — which is why it is set
 * generously rather than tightly: it must never expire under a slow but
 * legitimate human drag (a few seconds at most), and expiry is non-destructive
 * anyway (the session is gone, so a late drop commits nothing).
 */
const FOREIGN_DRAG_MAX_MS = 15000;

/**
 * @param {{
 *   document: Document, ResizeObserver: any, els: any,
 *   bookmarksClient: any, navigate: (url: string) => void,
 *   createTab: (url: string, container: any, opts?: any) => any,
 *   openBookmarkEditOverlay: (bookmark: any, anchorEl?: any, jarId?: string|null) => void,
 *   activeContainer: () => any,
 *   overlayMenuClient: { open: Function, close: Function, trigger: Function },
 *   overlayMenuState: { open: boolean },
 *   rightAnchorOf: (el: any) => any,
 *   tabNavigate?: (payload: { wcId: number, verb: string, args: any[] }) => void,
 *   bookmarkDragStarted?: () => void,
 *   bookmarkDragEnded?: () => void,
 *   now?: () => number
 * }} deps
 */
export function createBookmarksBar({
  document,
  ResizeObserver,
  els,
  bookmarksClient,
  navigate,
  createTab,
  openBookmarkEditOverlay,
  activeContainer,
  overlayMenuClient,
  overlayMenuState,
  rightAnchorOf,
  // M15 F3 Leg 4. `navigate` is ACTIVE-TAB-ONLY and therefore cannot serve AC9
  // (the drop may land on a background tab's guest) — `tabNavigate` is the
  // per-wcId form of the SAME untrusted path (navigation-controller.js's
  // `navigate` bottoms out in exactly this call). Defaulted to no-ops so an
  // offline fixture that predates this leg constructs without them.
  tabNavigate = () => {},
  bookmarkDragStarted = () => {},
  bookmarkDragEnded = () => {},
  // M15 F3 Leg 5a: the spring-load dwell's clock. Defaulted (renderer.js passes
  // nothing) so the wiring costs no renderer.js lines; injectable so the dwell
  // is pinned by a deterministic test rather than by a sleep.
  now = () => Date.now()
}) {
  /** @type {any[]} the chrome-side snapshot the overflow sheet was last opened with. */
  let overflowSnapshot = [];
  /**
   * How many entries were on the BAR when `overflowSnapshot` was written
   * (M15 F3 Leg 5a, AC4). STORED, and written in the SAME statement pair as the
   * snapshot itself — never derived at use time.
   *
   * ⚠ DO NOT REPLACE THIS WITH `listFor(currentJarId).length -
   * overflowSnapshot.length`. That derivation is arithmetically correct in every
   * state and TEMPORALLY UNSAFE: `overflowSnapshot` is frozen for the duration of
   * a drag (`dragActive` suppresses both writers), while `listFor` is a LIVE cache
   * read that the broadcast path updates BEFORE `onChanged` fires. Another window
   * adding one bookmark mid-drag shifts the derived value by exactly one and the
   * commit writes the item to the wrong position. The derive option was deleted at
   * design review so nobody picks it.
   * @type {number}
   */
  let overflowVisibleCount = 0;
  /** @type {{ width: number, height: number } | null} re-entrancy guard. */
  let lastMeasuredSize = null;
  /** @type {string | null} the jarId the bar is CURRENTLY rendered for — set
   * by every render() call, read by the resize-triggered re-partition and by
   * the overflow snapshot, both of which must stay scoped to that same jar. */
  let currentJarId = null;

  /**
   * The live drag session, or null (M15 F3 Leg 3, DD2). Snapshotted ONCE at
   * `dragstart` and never re-measured: the insertion indicator is
   * absolutely-positioned and therefore out of the flex flow, so it cannot
   * reflow the row and invalidate these rects (AC5 — that is why the CSS needs
   * `#bookmarks-bar { position: relative }`).
   * @type {{
   *   bookmarkId: string, jarId: string | null, draggedIndex: number,
   *   slotRects: Array<{left: number, width: number}>,
   *   barRect: { left: number, top: number, right: number, bottom: number },
   *   chevronRect: { left: number, top: number, right: number, bottom: number }
   * } | null}
   */
  let dnd = null;
  /** AC7's ONE suppression gate, consulted by BOTH rebuild paths (`render()`
   * and the ResizeObserver re-partition) — not two independent guards.
   * Flushed by exactly one `render()` in `dragend`. */
  let dragActive = false;
  /** Leg 5a AC7: a `closeOverflowIfOpen()` that arrived while a drag was live
   * and was therefore SUPPRESSED (closing the sheet mid-gesture would destroy
   * the spring-loaded drop target). Flushed in `dragend` — the flush is the
   * deferred CLOSE, not merely the deferred `render()`. */
  let pendingOverflowClose = false;
  /** Leg 5a AC2: when the pointer first entered the chevron in the live drag,
   * or null whenever it is not on the chevron. The dwell is `now() - this`. */
  let springDwellStart = /** @type {number | null} */ (null);

  /**
   * Everything about the dragged bookmark that must OUTLIVE this window's own
   * `dragend` — retained for `DRAG_HOLD_MS` (M15 F3 Leg 4 AC7, extended by
   * Leg 5a AC4b).
   *
   * ⚠ THIS IS THE PRIMARY PATH, NOT A RARE RACE. Both consumers arrive from
   * ANOTHER process after crossing at least two IPC hops, while `dragend` fires
   * locally in this renderer at release. Leg 4 MEASURED this exact topology and
   * recorded the verdict: **`dragend` wins on virtually every drop.** Without
   * the hold, `dnd = null` in `dragend` leaves the drop resolving to nothing
   * INTERMITTENTLY — the worst available failure shape, since it gets reported
   * as "sometimes drag doesn't work" and never reproduces under a debugger.
   *
   * ONE RECORD, ONE TIMER, TWO CONSUMERS — the design-review question answered
   * explicitly. Leg 5a does NOT arm a second independent hold beside leg 4's:
   * a single physical release lands on exactly ONE surface (a guest OR the
   * sheet), so at most one consumer can ever fire, and sharing the slot makes
   * that "only one can be consumed" invariant STRUCTURAL — whichever consumer
   * wins releases the record and the other can no longer resolve. Two
   * independent holds would both be armed on every gesture, expire on two
   * timers, and leave the invariant as a comment.
   *
   * Every field is captured at DRAGSTART, never re-resolved at drop time:
   *   - `url` — so a bookmark deleted mid-drag still navigates to what the
   *     operator dragged (they asked for that page);
   *   - `jarId` — the DD13 TOCTOU discipline (a tab switch mid-drag must not
   *     re-home the commit);
   *   - `visibleCount` — the value paired with the snapshot the sheet rendered
   *     (see `overflowVisibleCount`), which `dragend`'s own `render()` is about
   *     to overwrite.
   * @type {{ url: string | null, bookmarkId: string, jarId: string | null, visibleCount: number } | null}
   */
  let dragHold = null;
  /** @type {any} the pending hold expiry, or null. */
  let dragHoldTimer = null;

  /**
   * The FOREIGN drag session (M15 F3 Leg 5b, AC4), or null: a drag whose source
   * is an overflow-sheet ROW, not a bar item. Leg 3 built no such thing — its
   * `dragover`/`drop` handlers `return` on `!dnd`, and slot geometry was only
   * ever captured inside a LOCAL `dragstart`, which never fires for this gesture.
   *
   * It carries the same geometry `dnd` does, snapshotted once at the `start`
   * signal on the same discipline (the indicator is out of flow, so nothing here
   * can be invalidated by showing it), plus:
   *   - `draggedIndex: -1` — the EXTERNAL-SOURCE case. The dragged row is not on
   *     the bar at all, so no slot is excluded and `dropIndexFromPointer` returns
   *     a plain insertion index in `[0, slotRects.length]` (see its JSDoc — the
   *     past-the-end answer is what `barDropToIndex`'s clamp consumes).
   *   - `token` — the sheet's open token, re-checked against the `end` signal.
   *     Main gates `end` on sender identity alone (it cannot do better; the sheet
   *     is already blur-closed by then), so this is where that freshness check
   *     lives: a stale `end` from a previous gesture cannot cancel this session.
   *   - `bookmarkId`/`jarId` — resolved HERE, at `start`, from this module's own
   *     snapshot and `currentJarId`. Nothing on the wire names either (DD6), and
   *     the jar is captured at start rather than at drop (DD13 TOCTOU).
   * @type {{
   *   token: number, bookmarkId: string, jarId: string | null, draggedIndex: number,
   *   slotRects: Array<{left: number, width: number}>,
   *   barRect: { left: number, top: number, right: number, bottom: number },
   *   chevronRect: { left: number, top: number, right: number, bottom: number }
   * } | null}
   */
  let foreign = null;
  /** @type {any} AC3's latch bound — the pending `FOREIGN_DRAG_MAX_MS` expiry, or null. */
  let foreignTimer = null;

  function clearDragHoldTimer() {
    if (dragHoldTimer != null) {
      clearTimeout(dragHoldTimer);
      dragHoldTimer = null;
    }
  }
  /** Drop the held record immediately — used on consumption (one commit per drag). */
  function releaseDragHold() {
    clearDragHoldTimer();
    dragHold = null;
  }

  /** The insertion indicator (AC5). Absolutely positioned, so it is NOT a flex
   * item and changes no layout in the row: the bar keeps its fixed 30px height,
   * the chevron stays inside the `overflow: hidden` box, and the dragstart rect
   * snapshot the drop commits against stays valid. Its width/colour live in
   * styles.css ALONE — deliberately no JS constant, since a fourth
   * `export const <NUMBER>` in this file is a CSS-pin decision, not an edit
   * (bookmarks-bar-css-pin.test.js's under-pinning guard). */
  const dropIndicator = document.createElement('div');
  dropIndicator.className = 'bm-drop-indicator hidden';
  // Inserted BEFORE the chevron, not appended: `#bookmarks-overflow` is the
  // bar's one fixed LAST child and render()/the overflow tests rely on that.
  els.bookmarksBar.insertBefore(dropIndicator, els.bookmarksOverflow);

  function hideIndicator() {
    dropIndicator.classList.add('hidden');
  }

  /**
   * AC5's indicator, and Leg 5b's AC6 — the SAME indicator serves both
   * directions, so an overflow → bar drag gets the drop feedback whose absence
   * was the defect the operator reported for the forward direction. The session
   * is passed in rather than read from `dnd`, because a foreign session is the
   * other legitimate source of one.
   * @param {number} index the drop index among the REMAINING slots
   * @param {{ slotRects: Array<{left: number, width: number}>, draggedIndex: number,
   *          barRect: { left: number } }} session
   */
  function showIndicatorAt(index, session) {
    const x = indicatorX(session.slotRects, index, session.draggedIndex);
    if (x == null) {
      hideIndicator();
      return;
    }
    // Viewport x -> bar-relative: #bookmarks-bar has no border, so its padding
    // box (the absolute containing block) starts at its own rect.left.
    dropIndicator.style.left = `${x - session.barRect.left}px`;
    dropIndicator.classList.remove('hidden');
  }

  function itemEls() {
    return [...els.bookmarksBar.children].filter((el) => el.classList.contains('bm-item'));
  }

  /** The four edges of an element's viewport rect, as the drag sessions store
   * them (read ONCE per gesture — see `dnd`). @param {any} el */
  function edgesOf(el) {
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }

  /** The hidden-filtered `{left,width}` slot array both sessions snapshot. The
   * filtering is the whole point (DD3): a `.hidden` item is `display: none` and
   * reports a zero-width rect AT LEFT 0, which would inflate every index. */
  function measureSlotRects() {
    return visibleSlotRects(
      itemEls().map((el) => {
        const r = el.getBoundingClientRect();
        return { rect: { left: r.left, width: r.width }, hidden: el.classList.contains('hidden') };
      })
    );
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
    //
    // ⚠ NO CLICK-SUPPRESSION FLAG, AND DO NOT ADD ONE (M15 F3 Leg 3 AC9).
    // Native HTML5 DnD fires no trailing `click`, so a drag can never reach
    // this handler and can never navigate. CLAUDE.md's tab-activation invariant
    // says the same thing for the tab strip — "no suppression flag; don't
    // reintroduce one" — and this codebase deliberately removed such a flag
    // once already. A guard here would be dead code that reads as load-bearing.
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

    // ---- native drag SOURCE (DD2) ----------------------------------------
    // The codebase's FIRST draggable <button> (the tab source is a <div>), so
    // the property is set explicitly — buttons are not draggable by default,
    // and a source that never arms is indistinguishable from "nothing
    // happened" downstream.
    btn.draggable = true;
    btn.addEventListener('dragstart', (e) => {
      const dt = e.dataTransfer;
      // Refuse rather than start a session we could never commit.
      if (!dt || !b || typeof b.id !== 'string') {
        e.preventDefault();
        return;
      }
      // DD2's three types. The custom one carries the bookmark ID (the chrome's
      // own dispatch key); the two standard ones carry the url so a page with a
      // real drop zone gets a normal url drop (DD5's "page wins" only means
      // something because of these).
      dt.setData(BOOKMARK_DND_MIME, b.id);
      dt.setData('text/uri-list', b.url || '');
      dt.setData('text/plain', b.url || '');
      dt.effectAllowed = 'move';

      // Leg 5b: a LOCAL drag takes sole ownership of the one suppression gate.
      // A foreign session still latched from an earlier gesture (its `end` lost,
      // its timer not yet due) is discarded rather than left to share it — the
      // two can never be live together, since one pointer produces one gesture.
      discardForeignDrag();

      // Session snapshot — geometry read ONCE (see `dnd`'s declaration).
      dnd = {
        bookmarkId: b.id,
        // Jar captured at dragstart, NEVER resolved at drop time — the DD13
        // TOCTOU discipline the edit popover already follows. A tab switch
        // mid-drag must not re-home the commit to a different jar.
        jarId: currentJarId,
        // itemEls() is full-list order and the hide is a strict tail, so a
        // VISIBLE item's index here is its index in both the full list and the
        // hidden-filtered slot array (see bookmark-drag.js's header note).
        draggedIndex: itemEls().indexOf(btn),
        slotRects: measureSlotRects(),
        barRect: edgesOf(els.bookmarksBar),
        // Leg 5a: the spring-load target's own rect, snapshotted on the SAME
        // discipline as barRect (read once, never re-measured mid-gesture). A
        // HIDDEN chevron reads 0,0,0,0 and `isOverChevron` refuses a zero-area
        // rect, so "no overflow → nothing to spring" needs no separate branch.
        chevronRect: edgesOf(els.bookmarksOverflow)
      };
      dragActive = true; // AC7: both rebuild paths are suppressed from here
      springDwellStart = null;

      // ---- cross-surface holds, chrome half (Leg 4 DD6, Leg 5a AC4b) -----
      // Capture EVERYTHING the two out-of-process consumers will need NOW (see
      // `dragHold`), then DECLARE the drag to main. The declaration is bare: it
      // says a bookmark drag is in flight in this window and nothing else, which
      // is the whole of what main is allowed to know — the guest's drop signal
      // carries no url and no id either, so the pair cannot be aimed at a url of
      // a page's choosing.
      clearDragHoldTimer();
      dragHold = {
        url: typeof b.url === 'string' && b.url ? b.url : null,
        bookmarkId: b.id,
        jarId: currentJarId,
        visibleCount: overflowVisibleCount
      };
      bookmarkDragStarted();
    });
    // dragend: the single cleanup + flush point. Reached by every ending —
    // a committed drop, a drop outside the bar, and an Escape-cancelled drag
    // (the browser aborts into dragend with no drop, so the order is unchanged).
    btn.addEventListener('dragend', () => {
      dnd = null;
      dragActive = false; // lifted BEFORE the flush, or render() would suppress itself
      springDwellStart = null;
      hideIndicator();
      render(); // AC7's single flush — reconciles whatever was suppressed
      // Leg 5a AC7: the flush includes the deferred CLOSE, not only the deferred
      // render. `render()` alone would leave a sheet open over a pre-drop
      // snapshot, because `closeOverflowIfOpen` was swallowed while the drag was
      // live. (AC6b's other half — a dragend `render()` that REWRITES the
      // snapshot under a live sheet — is handled inside applyOverflowPartition,
      // which closes on any snapshot change; that is deliberately NOT done here,
      // where an unconditional close would race the sheet's in-flight drop
      // report and turn the happy path into a silent no-op.)
      if (pendingOverflowClose) {
        pendingOverflowClose = false;
        closeOverflowIfOpen();
      }
      // Leg 4: end the declaration main-side (it clears on ITS own grace timer,
      // never synchronously) and start the chrome-side hold. `dnd` is gone above
      // — `dragHold` is deliberately NOT, because the drop report for THIS
      // release has almost certainly not arrived yet (see `dragHold`).
      bookmarkDragEnded();
      if (dragHold != null) {
        clearDragHoldTimer();
        dragHoldTimer = setTimeout(() => {
          dragHoldTimer = null;
          dragHold = null;
        }, DRAG_HOLD_MS);
      }
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
      writeOverflowSnapshot([], 0);
      return;
    }
    // Measure TRUE widths — un-hide everything first (a previously-hidden
    // item reads 0-width via getBoundingClientRect under display:none).
    for (const el of items) el.classList.remove('hidden');
    const widths = items.map((el) => el.getBoundingClientRect().width);
    const { visibleCount, overflowing } = partitionOverflow(widths, availableWidth, CHEVRON_WIDTH, BAR_GAP);
    writeOverflowSnapshot(
      overflowing ? bookmarksClient.listFor(currentJarId).slice(visibleCount) : [],
      overflowing ? visibleCount : 0
    );
    items.forEach((el, i) => el.classList.toggle('hidden', i >= visibleCount));
    els.bookmarksOverflow.classList.toggle('hidden', !overflowing);
  }

  /** Identity of a snapshot, for the lockstep comparison below. Ids only — a
   * title/icon edit changes what a row READS but not which entry index N
   * dispatches to, and closing the sheet on a cosmetic edit would be a gratuitous
   * dismissal mid-gesture. @param {any[]} snapshot */
  function snapshotKey(snapshot) {
    return snapshot.map((b) => (b && b.id) || '\x00').join('\x01');
  }

  /**
   * The SINGLE writer of `overflowSnapshot`/`overflowVisibleCount` — the pair is
   * written together, in one statement, so nothing can observe a snapshot paired
   * with a stale count (AC4).
   *
   * It is also where the AC6 invariant lives: **snapshot ↔ rendered-rows
   * LOCKSTEP.** The overflow sheet dispatches by INDEX into the snapshot
   * (`bookmark:<i>`, DD9), which is safe exactly while the snapshot the sheet
   * rendered is still the snapshot this module holds. `closeOverflowIfOpen` has
   * one caller (renderer.js's cache `onChanged`), so it covers the `render()`
   * path and NOT `onResize()` — and `win.on('resize')` does not close the sheet.
   * That is a PRE-EXISTING desync: before this leg, a window resize with the
   * overflow menu open silently rewrote the snapshot under live rows, and a row
   * click then dispatched an index into the new one. Closing here, on a CHANGE
   * rather than on every pass, disposes of it at the one site that can see the
   * change, and covers `dragend`'s unconditional `render()` (AC6b) by the same
   * rule without a second mechanism.
   *
   * Deliberately conditional on the ids actually changing: the bar → overflow
   * happy path re-partitions at `dragend` to an IDENTICAL snapshot (the store
   * mutation has not landed yet), so an unconditional close here would race the
   * sheet's in-flight drop report and refuse the operator's own drop.
   *
   * @param {any[]} snapshot @param {number} visibleCount
   */
  function writeOverflowSnapshot(snapshot, visibleCount) {
    const changed = snapshotKey(snapshot) !== snapshotKey(overflowSnapshot);
    overflowSnapshot = snapshot;
    overflowVisibleCount = visibleCount;
    if (changed) closeOverflowIfOpen();
  }

  /** ResizeObserver callback body: re-entrancy-guarded re-measure (design
   * review — defends against ResizeObserver loop-limit warnings). */
  function onResize() {
    // AC7 (the rebuild path that gets MISSED): a re-partition rebuilds nothing
    // but re-hides/un-hides every item, which changes the slot geometry the
    // live session snapshotted. `lastMeasuredSize` is deliberately NOT updated
    // here — dragend's flush re-measures and re-partitions unconditionally.
    if (dragActive) return;
    const rect = els.bookmarksBar.getBoundingClientRect();
    if (lastMeasuredSize && rect.width === lastMeasuredSize.width && rect.height === lastMeasuredSize.height) {
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
    // AC7 (the rebuild path reachable with NO tab switch at all): any same-jar
    // `bookmarks-changed` — another window's edit — lands here and would
    // clearItems() the live drag source out from under the gesture. `jarId` is
    // still recorded above so dragend's flush paints the CURRENT truth rather
    // than the jar the drag started in.
    if (dragActive) return;
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
   * it (valid 'superseded' reason); the next open re-snapshots. Also the
   * lockstep close `writeOverflowSnapshot` issues (AC6).
   *
   * Leg 5a AC7: SUPPRESSED while a drag session is live. The sheet is the drop
   * TARGET of the gesture in progress — closing it mid-drag is the same class of
   * defect as leg 3's `render()` destroying the drag SOURCE. The suppressed close
   * is not dropped: it sets a pending flag that `dragend` flushes, so a sheet is
   * never left open over a snapshot that changed while it was unclosable. */
  function closeOverflowIfOpen() {
    if (dragActive) {
      pendingOverflowClose = true;
      return;
    }
    if (overlayMenuState.open) overlayMenuClient.close('superseded');
  }

  /**
   * Main → chrome: the overflow sheet reported a drop at snapshot index `index`
   * (M15 F3 Leg 5a, AC4/AC4b/AC8/AC10). renderer.js subscribes this to
   * `onBookmarkOverflowDrop`.
   *
   * The split mirrors `handleDropSignal`'s and is the same DD6 discipline: WHERE
   * comes from the payload (an index main accepted only from the sheet's own
   * webContents, under a live token, with `menuType === 'bookmarks-overflow'`),
   * WHAT comes from this module's own dragstart-time hold and never from the
   * wire. There is no bookmark id, no url, and no jar on that channel, so a
   * message arriving outside a real drag can resolve to nothing.
   *
   * By the time this runs, `dragend` has almost certainly already fired and
   * `render()` has already rewritten `overflowSnapshot`/`overflowVisibleCount`
   * (leg 4 measured that ordering) — which is exactly why every input below
   * comes from `dragHold` rather than from live state.
   *
   * VALIDATED-NO-OP on every input: a malformed payload, or a report with no
   * live hold, does nothing.
   * @param {{ index?: unknown } | undefined | null} payload
   */
  function handleOverflowDrop(payload) {
    const index = payload && payload.index;
    if (!Number.isInteger(index) || /** @type {number} */ (index) < 0) return;
    const hold = dragHold;
    if (!hold) return;
    // One commit per drag on this side too — and, because leg 4's navigation
    // shares this record, releasing here also makes a stray guest drop signal
    // for the same gesture resolve to nothing. One release, one outcome.
    releaseDragHold();
    bookmarksClient.commitOverflowDrop(hold.jarId, hold.bookmarkId, hold.visibleCount, /** @type {number} */ (index));
  }

  function clearForeignTimer() {
    if (foreignTimer != null) {
      clearTimeout(foreignTimer);
      foreignTimer = null;
    }
  }

  /** Drop a foreign session WITHOUT flushing — for the one case where another
   * owner is taking the gate over (a local `dragstart`) and will flush itself. */
  function discardForeignDrag() {
    clearForeignTimer();
    foreign = null;
  }

  /**
   * End a foreign session and flush what it suppressed — the exact counterpart of
   * a local `dragend`, and the ONLY place the suppression is lifted for this
   * direction (M15 F3 Leg 5b, AC3/AC7). Idempotent: the sheet's `end` signal, the
   * `FOREIGN_DRAG_MAX_MS` latch bound, and a committed drop all land here, and a
   * single gesture legitimately reaches it more than once.
   */
  function endForeignDrag() {
    if (!foreign) return;
    discardForeignDrag();
    dragActive = false; // lifted BEFORE the flush, or render() would suppress itself
    springDwellStart = null;
    hideIndicator();
    render(); // the single flush — reconciles every rebuild swallowed meanwhile
    // AC7: the flush is the deferred CLOSE as well as the deferred render. Same
    // rule and same reason as `dragend`'s (a sheet left open over a pre-drop
    // snapshot); `writeOverflowSnapshot`'s ids-changed rule owns the other half.
    if (pendingOverflowClose) {
      pendingOverflowClose = false;
      closeOverflowIfOpen();
    }
  }

  /**
   * Main → chrome: the overflow sheet's OWN drag lifecycle (M15 F3 Leg 5b,
   * AC3/AC4/AC8). renderer.js subscribes this to `onBookmarkSheetDrag`.
   *
   * This is the whole of what the chrome ever learns about a sheet-sourced drag:
   * there is no local `dragstart`/`dragend` for it, so `start` is where the
   * foreign session's geometry snapshot is taken and where the AC7 suppression is
   * armed, and `end` (or the AC3 timer) is the only way either is released.
   *
   * The DD6 split again, with the roles as they must be here: WHERE the drag came
   * from is a snapshot INDEX main accepted only from the sheet's own webContents
   * under a live token with `menuType === 'bookmarks-overflow'`; WHAT it resolves
   * to — the bookmark, its jar — comes from this module's own state and never
   * from the wire.
   *
   * VALIDATED-NO-OP on every input: a malformed payload, an index outside the
   * live snapshot, a `start` while a LOCAL drag owns the gate, or an `end` whose
   * token does not match the live session all do nothing.
   * @param {{ phase?: unknown, token?: unknown, index?: unknown } | undefined | null} payload
   */
  function handleSheetDrag(payload) {
    const phase = payload && payload.phase;
    const token = payload && payload.token;
    if (typeof token !== 'number') return;
    if (phase === 'end') {
      // The token freshness check main cannot perform for `end` (the sheet is
      // legitimately closed by then, so it has no current menu to compare
      // against) lives HERE, where the live session still knows its own token.
      if (foreign && foreign.token === token) endForeignDrag();
      return;
    }
    if (phase !== 'start') return;
    const index = payload && payload.index;
    if (!Number.isInteger(index) || /** @type {number} */ (index) < 0) return;
    if (dnd) return; // a local drag owns the gate — never two live sessions
    const b = overflowSnapshot[/** @type {number} */ (index)];
    if (!b || typeof b.id !== 'string') return; // outside the live snapshot
    discardForeignDrag(); // a superseded foreign session never outlives its successor
    foreign = {
      token,
      bookmarkId: b.id,
      jarId: currentJarId,
      // The external-source case: the dragged row is not among the bar's slots,
      // so nothing is excluded (tab-order.js's `dropIndexFromPointer` JSDoc).
      draggedIndex: -1,
      slotRects: measureSlotRects(),
      barRect: edgesOf(els.bookmarksBar),
      chevronRect: edgesOf(els.bookmarksOverflow)
    };
    dragActive = true; // AC7: both rebuild paths + the overflow close are suppressed
    springDwellStart = null;
    foreignTimer = setTimeout(endForeignDrag, FOREIGN_DRAG_MAX_MS);
  }

  // ---- native drag TARGET (DD2/DD3) --------------------------------------
  //
  // Both listeners sit on `document`, not on #bookmarks-bar, and both are
  // MIME-gated. Two independent reasons, neither of them stylistic:
  //
  //  1. The indicator has to be RETRACTED when the pointer leaves the bar, and
  //     a bar-scoped `dragover` simply stops firing there — it can never
  //     observe the `outside` zone. (`dragleave` is not a substitute: it fires
  //     on every child-to-child transition inside the bar.)
  //  2. `dragover` must `preventDefault()` for a drop to be delivered at all,
  //     and the payload carries `text/uri-list` — so an un-accepted release
  //     anywhere on the chrome document would hand Chromium's DEFAULT url-drop
  //     handling a chance to navigate the chrome frame itself. Accepting the
  //     drag document-wide, and swallowing the drop when it lands outside the
  //     bar, closes that off. This is chrome-document only; the guest is a
  //     separate WebContentsView and its own default is untouched (DD5b is
  //     measured against the guest, not this).
  document.addEventListener('dragover', (e) => {
    const dt = e.dataTransfer;
    if (!dt || !dt.types || !dt.types.includes(BOOKMARK_DND_MIME)) return;
    e.preventDefault();
    dt.dropEffect = 'move'; // MANDATORY (tab-controller.js:499, "spike probe3") — else the drop is silently rejected
    // Leg 5b: EITHER session drives the preview — a local bar drag (`dnd`) or a
    // sheet-sourced foreign one. They differ only in `draggedIndex` (-1 for the
    // foreign case) and in whether the chevron may spring, so the geometry code
    // below is shared rather than mirrored.
    const session = dnd || foreign;
    if (!session) return; // a bookmark drag from somewhere we have no session for
    // ---- spring-load, and the two-indicator rule (Leg 5a, AC2/AC2a) --------
    // The chevron sits INSIDE barRect, so without this branch the code below
    // would classify `reorder` and paint the BAR's indicator across the chevron
    // while the sheet is springing — two indicators drawing two contradictory
    // destinations for one gesture. RULED: **the chevron wins while the pointer
    // is on it.** The bar indicator retracts, the sheet's own indicator (which
    // menu-overlay.js owns) is the only one drawn, and the release ruling below
    // matches — a drop here writes nothing, because nothing was drawn for it.
    if (isOverChevron(session.chevronRect, e.clientX, e.clientY)) {
      hideIndicator();
      // Spring-loading is the BAR → OVERFLOW direction only. A sheet-sourced drag
      // is already coming OUT of that menu; re-opening it under the pointer would
      // offer the operator a target for a gesture they just left. The chevron
      // still swallows the release for both (see the `drop` handler).
      if (session === dnd) springLoad();
      return;
    }
    springDwellStart = null; // left the chevron — the dwell restarts from scratch
    const zone = classifyBookmarkDrop(session.barRect, session.slotRects, e.clientX, e.clientY, session.draggedIndex);
    if (zone.zone !== 'reorder') {
      hideIndicator();
      return;
    }
    showIndicatorAt(zone.index, session);
  });

  /**
   * The dwell half of AC2. Called once per `dragover` while the pointer is on the
   * chevron; opens the overflow menu once the pointer has been there for
   * `SPRING_DWELL_MS`.
   *
   * ⚠ OPENS VIA `openOverflowMenu` (which calls `overlayMenuClient.open`),
   * NEVER via `overlayMenuClient.trigger`. `trigger` refuses to re-open within
   * `BLUR_REOPEN_SUPPRESS_MS` (300 ms) of a blur close — and the sheet is closed
   * by exactly a blur at drag start — so copying the chevron's own click path
   * (`:trigger`, a few lines below) would silently never spring. Operator
   * session 3's throwaway probe used `open`, which is why it worked.
   */
  function springLoad() {
    if (overlayMenuState.open) {
      springDwellStart = null;
      return;
    } // already sprung
    if (!overflowSnapshot.length) return; // nothing to open — inert, not an error
    const t = now();
    if (springDwellStart == null) {
      springDwellStart = t;
      return;
    }
    if (t - springDwellStart < SPRING_DWELL_MS) return;
    springDwellStart = null;
    openOverflowMenu(0);
  }

  document.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    // `types` is read SYNCHRONOUSLY, before anything async — see the protected-
    // mode warning below.
    if (!dt || !dt.types || !dt.types.includes(BOOKMARK_DND_MIME)) return;
    e.preventDefault();
    // Captured: `dragend` (local) / the `end` signal (foreign) nulls the live
    // session while the commit is still in flight.
    const session = dnd || foreign;
    if (!session) return;
    hideIndicator();
    // Edge Case "release ON the chevron" — RULED: the chevron SWALLOWS it.
    // The chevron is inside barRect, so leg 3's classification would call this a
    // `reorder` and commit a move to the end of the visible run. But AC2a just
    // suppressed the bar indicator across the chevron, so that would be a write
    // with no preview — the operator was aiming at the overflow, and nothing was
    // ever drawn at the position this would write to. Inert instead; the sprung
    // sheet is the affordance that carries an indicator and therefore a commit.
    if (isOverChevron(session.chevronRect, e.clientX, e.clientY)) return;
    const zone = classifyBookmarkDrop(session.barRect, session.slotRects, e.clientX, e.clientY, session.draggedIndex);
    if (zone.zone !== 'reorder') return; // outside the bar — drag-onto-page's zone, not ours
    // ---- overflow → bar, the reverse commit (Leg 5b, AC5/AC8) --------------
    // `zone.index` is the plain insertion index among the VISIBLE slots (the
    // dragged row is not one of them — `draggedIndex: -1`), and because the
    // overflow hide is a strict tail that index IS the full-list index. The clamp
    // is what keeps the indicator honest at the far right edge; the reasoning
    // lives in `barDropToIndex`, not here. Everything else — the bookmark, the
    // jar — comes from the session captured at the `start` signal, exactly as the
    // local branch takes it from `dragstart`; nothing is read off the event, whose
    // MIME value the sheet wrote and which this handler deliberately ignores.
    if (session === foreign) {
      const toIndex = barDropToIndex(zone.index, session.slotRects.length);
      const { jarId, bookmarkId } = session;
      endForeignDrag(); // consume: one commit per gesture, and the flush this ending owes
      bookmarksClient.commitReorder(jarId, bookmarkId, toIndex);
      return;
    }
    // ⚠ `dataTransfer` LEAVES PROTECTED MODE when this dispatch ends. The
    // commit `await`s a fresh bookmarksGet (DD6b), so any `getData`/`types`
    // read after that await returns EMPTY and the drop silently does nothing.
    // The bookmark id therefore comes from the dragstart snapshot — never off
    // the event — and everything the event can tell us is read above, now.
    bookmarksClient.commitReorder(session.jarId, session.bookmarkId, zone.index);
  });

  /**
   * Main → chrome: a bookmark drop landed in the guest `targetWcId`
   * (M15 F3 Leg 4, DD5/DD6/AC9). renderer.js subscribes this to
   * `onBookmarkDrop`.
   *
   * Everything about WHERE comes from the payload's wcId — which main derived
   * from `event.sender.id`, the guest that actually received the drop, never
   * from anything a renderer said. Everything about WHAT comes from this
   * module's own hold, never from the payload (there is no url on that wire).
   * That split is DD6, and it is why a page fabricating a `DragEvent` cannot
   * aim anything: with no drag in flight there is no held url and main refuses
   * the forward anyway.
   *
   * The navigation rides the EXISTING UNTRUSTED PATH and is deliberately NOT
   * re-validated here. The enforcing gate is main's `tab-navigate` handler —
   * `ownsTab(event, wcId)` plus the trust-branched
   * `isInternal ? isInternalPageUrl : isSafeTabUrl` — exactly as for a bar click
   * or an omnibox commit. (It is NOT `will-navigate`: Electron does not emit
   * that for a programmatic `loadURL`. `will-redirect`/`will-frame-navigate`
   * remain a second line for post-loadURL redirects, not the first.) A
   * chrome-side pre-filter would be a second, drifting copy of a rule that
   * already runs on the authoritative side.
   *
   * VALIDATED-NO-OP on every input: a malformed payload, or a signal with no
   * live hold, does nothing.
   * @param {{ targetWcId?: unknown } | undefined | null} payload
   */
  function handleDropSignal(payload) {
    const wcId = payload && payload.targetWcId;
    if (!Number.isInteger(wcId)) return;
    const url = dragHold && dragHold.url;
    if (typeof url !== 'string' || !url) return;
    // One navigation per drag on this side too (main consumes its declaration
    // on the same forward — this is the chrome's own half of that contract).
    releaseDragHold();
    tabNavigate({ wcId: /** @type {number} */ (wcId), verb: 'loadURL', args: [url] });
  }

  new ResizeObserver(onResize).observe(els.bookmarksBar);

  return { render, dispatch, closeOverflowIfOpen, handleDropSignal, handleOverflowDrop, handleSheetDrag };
}
