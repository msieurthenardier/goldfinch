import { bookmarkUrlsMatch } from '../../shared/bookmark-url.js';

// Bookmarks cache client (M15 F1 "Bookmarking Core and Surfaces" Leg 2). Cloned
// from jars-client.js's boot/applyState/subscribe triad: boots via
// bookmarksGet(), re-queries on the bookmarks-changed broadcast (invalidation-
// not-snapshot — DD3), and exposes a synchronous lookup by URL (the DD2
// bookmarkUrlsMatch predicate) plus the ordered list. Cache freshness contract
// (AC): source of truth is the main-side store; rebuild trigger is the
// broadcast; staleness is bounded by one broadcast round-trip.
//
// This module also HOUSES the bookmark business logic the leg's line-budget
// ruling keeps out of renderer.js: the shared star-activation decision (star
// click / Ctrl+D / page-context "Bookmark this page" all funnel through
// `activateStar`) and the bookmark-edit sheet's submit-forward subscriber body
// (`handleEditSubmit` — renderer.js wires only the one-line subscription).
//
// `isInternalTab` is injected LAZILY the same way jarsClient receives
// `isWebTab`/`isInternalTab`/`activateTab`/`closeTab` from renderer.js: a
// closure over `tabController`, which is assigned after this client is
// constructed. `onChanged` (optional) is the 5th star-sync path's hook —
// called after every BROADCAST-triggered re-query completes (never after the
// initial boot refresh, which the caller's own boot-race Promise.all already
// gates); renderer.js passes a lazy `() => refreshStar(activeTab())` closure
// the same way, referencing bindings not yet assigned at construction time.
export function createBookmarksClient({ bridge, isInternalTab, onChanged }) {
  const state = { list: [] };

  function applyState(list) {
    state.list = Array.isArray(list) ? list : [];
  }

  function refresh() {
    return bridge.bookmarksGet().then((list) => applyState(list)).catch(() => {});
  }

  const boot = refresh();

  bridge.onBookmarksChanged(() => {
    refresh().then(() => { if (onChanged) onChanged(); });
  });

  /** Synchronous cache lookup by the DD2 exact-URL predicate. */
  function findByUrl(url) {
    return state.list.find((b) => bookmarkUrlsMatch(b.url, url)) || null;
  }

  /**
   * The shared star-activation decision (AC "Star click / Ctrl+D behavior"):
   * unbookmarked page → bookmarkAdd (title falls back to the tab's URL — never
   * the literal 'New tab' boot seed) then resolve to the CREATED entry;
   * bookmarked page → resolve to the EXISTING entry directly. Inert (resolves
   * null) on internal tabs / a tab with no live wcId — the caller opens the
   * popover only on a non-null resolution, so this single guard covers the
   * star (hidden anyway), Ctrl+D (forwarded web-guest-only besides), and the
   * page-context item (TOCTOU-safe: the caller re-resolves the tab from a
   * captured wcId before calling this).
   * @param {any} tab
   * @returns {Promise<any | null>}
   */
  async function activateStar(tab) {
    if (!tab || tab.wcId == null || (isInternalTab && isInternalTab(tab))) return null;
    const existing = findByUrl(tab.url);
    if (existing) return existing;
    const title = tab.title && tab.title !== 'New tab' ? tab.title : (tab.url || '');
    const res = await bridge.bookmarkAdd({ url: tab.url, title, icon: tab.favicon ?? undefined });
    return res && res.ok ? res.bookmark : null;
  }

  /**
   * The bookmark-edit sheet's forwarded-submit handler (main → chrome, over
   * `onBookmarkEditSubmit` — the AC's "chrome issues all bookmark mutations"
   * invariant). Fire-and-forget: a store-side rejection (cross-entry
   * `duplicate-url`, a since-vanished `not-found`) is the leg's accepted
   * minimal v1 presentation — the cache's own `bookmarks-changed` re-query
   * (or its absence, on a rejected mutation) re-derives the star/cache to
   * truth with no further UI here.
   * @param {{ id?: unknown, action?: unknown, name?: unknown, url?: unknown }} payload
   */
  function handleEditSubmit(payload) {
    if (!payload || typeof payload.id !== 'string') return;
    if (payload.action === 'remove') {
      bridge.bookmarkRemove({ id: payload.id }).catch(() => {});
    } else {
      bridge.bookmarkUpdate({ id: payload.id, title: payload.name, url: payload.url }).catch(() => {});
    }
  }

  return {
    state,
    boot,
    applyState,
    findByUrl,
    activateStar,
    handleEditSubmit,
    get list() { return state.list; },
  };
}
