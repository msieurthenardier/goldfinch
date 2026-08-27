import { bookmarkUrlsMatch } from '../../shared/bookmark-url.js';
import { moveIndex } from '../../shared/tab-order.js';
import { overflowDropToIndex } from '../../shared/bookmark-drag.js';

// Bookmarks cache client (M15 F1 "Bookmarking Core and Surfaces" Leg 2;
// rewritten jar-aware M15 F2 "Jar-Scoped Bookmarks" Leg 3, L3-DD-A/A2/B/E;
// L3-DD-F's resolved-rejection feedback REMOVED M15 F3 "Drag Interactions"
// Leg 2, DD9).
// Holds a `Map<jarId, list>` — per-jar entries populated lazily, never
// app-wide. `findByUrl(jarId, url)`/`listFor(jarId)` are SYNCHRONOUS over the
// map (empty array / null on a miss — the DD6 first-sight flash, accepted);
// `ensureJar(jarId)` triggers an async `bookmarksGet({ jarId })` refresh once
// per unseen jar (in-flight de-dup) and is the read paths' (star refresh, bar
// render) job to call. `onBookmarksChanged({ jarId })` re-queries ONLY if
// that jar is already cached (nothing cached, nothing stale). A jars-changed
// broadcast evicts map entries for jar ids no longer live (L3-DD-A, the
// recyclable-id defense) — an INDEPENDENT bridge subscription beside
// jars-client.js's own, reading the broadcast's own `containers` array
// directly rather than jars-client's reactive state, so eviction never
// depends on subscription-registration order between the two clients (Edge
// Case: neither of eviction/orphan-tab-close may assume the other already
// ran). The same "last known containers" snapshot backs L3-DD-A2's
// late-resolve-after-eviction check (see `isJarStillKnown` below) — before
// the FIRST jars-changed broadcast ever arrives there is nothing to evict
// against, so the check fails OPEN (assume valid) rather than dropping a
// legitimate cold-boot fetch.
//
// This module also HOUSES the bookmark business logic the leg's line-budget
// ruling keeps out of renderer.js: the shared star-activation decision (star
// click / Ctrl+D / page-context "Bookmark this page" all funnel through
// `activateStar` — now also inert on burner tabs, L3-DD-D) and the
// bookmark-edit sheet's submit-forward subscriber body (`handleEditSubmit` —
// renderer.js wires only the one-line subscription). L3-DD-E: the popover's
// owning jar is captured at OPEN via `captureEditJar(jarId)` into module
// state, read back by `handleEditSubmit` at submit time — never re-resolved
// from "whatever is active now" (the DD13 TOCTOU this guards against).
// A resolved `{ ok:false }` submit is deliberately UNHANDLED here (M15 F3
// Leg 2, DD9 — see `handleEditSubmit`'s call sites); the module carries no
// operator-feedback dependency at all.
//
// `isInternalTab` is injected LAZILY the same way jarsClient receives
// `isWebTab`/`isInternalTab`/`activateTab`/`closeTab` from renderer.js: a
// closure over `tabController`, which is assigned after this client is
// constructed. `onChanged(jarId)` (optional) fires after EVERY successful
// cache repopulation for that jar — both a broadcast-triggered re-query and
// an `ensureJar` first-sight fetch — so the repaint is uniform regardless of
// which path populated the entry (L3-DD-A). `jarsBoot`/`getDefaultJarId`
// (L3-DD-B) sequence the boot prefetch behind the jars client's own boot,
// since the default jar id is unknowable at construction time and can
// legitimately resolve to `null` (Burner holds the flag) — both `null` and
// `undefined` are explicit no-ops, never an errant fetch for a fake id.
export function createBookmarksClient({ bridge, isInternalTab, onChanged, jarsBoot, getDefaultJarId }) {
  /** @type {Map<string, any[]>} jarId -> cached list, synchronous reads only. */
  const map = new Map();
  /** @type {Map<string, Promise<void>>} jarId -> in-flight ensureJar fetch (de-dup). */
  const inFlight = new Map();
  /** Most recent jars-changed broadcast's `containers` array, or `null`
   * before the first one ever arrives (L3-DD-A2 cold-start: fail open). */
  let lastContainers = null;

  /** @param {string} jarId @returns {boolean} */
  function isJarStillKnown(jarId) {
    return lastContainers == null || lastContainers.some((c) => c && c.id === jarId);
  }

  /** @param {string} jarId @param {any} list */
  function applyJarList(jarId, list) {
    map.set(jarId, Array.isArray(list) ? list : []);
  }

  /**
   * Once-per-unseen-jar async refresh (L3-DD-A). No-ops when already cached
   * or already in flight. A resolve for a jar evicted meanwhile is DROPPED,
   * never stored (L3-DD-A2) — storing it would recreate the recycled-id
   * hazard the eviction exists to prevent.
   * @param {string} jarId
   * @returns {Promise<void>|undefined}
   */
  function ensureJar(jarId) {
    if (jarId == null || map.has(jarId) || inFlight.has(jarId)) return inFlight.get(jarId);
    const p = bridge
      .bookmarksGet({ jarId })
      .then((list) => {
        inFlight.delete(jarId);
        if (!isJarStillKnown(jarId)) return; // L3-DD-A2: dropped — evicted mid-flight
        applyJarList(jarId, list);
        if (onChanged) onChanged(jarId);
      })
      .catch(() => {
        inFlight.delete(jarId);
      });
    inFlight.set(jarId, p);
    return p;
  }

  /** Synchronous cache lookup by the DD2 exact-URL predicate, scoped to one
   * jar. Null on a cache miss for that jar (DD6 first-sight bound) — never
   * triggers a fetch itself; callers pair this with `ensureJar`.
   * @param {string} jarId @param {string} url */
  function findByUrl(jarId, url) {
    const list = map.get(jarId);
    if (!list) return null;
    return list.find((b) => bookmarkUrlsMatch(b.url, url)) || null;
  }

  /** Synchronous ordered list for one jar — empty array on a cache miss.
   * @param {string} jarId @returns {any[]} */
  function listFor(jarId) {
    return map.get(jarId) || [];
  }

  bridge.onBookmarksChanged((payload) => {
    const jarId = payload && typeof payload.jarId === 'string' ? payload.jarId : null;
    if (jarId == null || !map.has(jarId)) return; // DD6: nothing cached -> nothing stale
    bridge
      .bookmarksGet({ jarId })
      .then((list) => {
        applyJarList(jarId, list);
        if (onChanged) onChanged(jarId);
      })
      .catch(() => {});
  });

  // L3-DD-A eviction: independent subscription, reads the broadcast's OWN
  // containers array (never jars-client's reactive state) so this never
  // depends on subscription-registration order against jars-client.js's own
  // onJarsChanged handler.
  bridge.onJarsChanged((payload) => {
    if (!payload || !Array.isArray(payload.containers)) return;
    lastContainers = payload.containers;
    const live = new Set(payload.containers.map((c) => c && c.id));
    for (const jarId of [...map.keys()]) {
      if (!live.has(jarId)) map.delete(jarId);
    }
  });

  // L3-DD-B: joined in the boot Promise.all for contract stability, but now a
  // warm-start prefetch of the DEFAULT jar only (the most likely first-active
  // jar) rather than an everything-fetch. Explicit no-op for both `null`
  // (Burner holds the default flag) and `undefined` (jarsClient's own boot
  // hasn't resolved a default yet, which cannot happen here since this is
  // chained behind jarsBoot itself).
  const boot = jarsBoot.then(() => {
    const id = getDefaultJarId ? getDefaultJarId() : undefined;
    return id != null ? ensureJar(id) : undefined;
  });

  /**
   * The shared star-activation decision (AC "Star click / Ctrl+D behavior"):
   * unbookmarked page → bookmarkAdd (title falls back to the tab's URL —
   * never the literal 'New tab' boot seed) then resolve to the CREATED entry;
   * bookmarked page → resolve to the EXISTING entry directly. Inert (resolves
   * null) on internal tabs, burner tabs (L3-DD-D), or a tab with no live
   * wcId — the caller opens the popover only on a non-null resolution, so
   * this single guard covers the star (hidden anyway), Ctrl+D (forwarded
   * web-guest-only besides), and the page-context item (TOCTOU-safe: the
   * caller re-resolves the tab from a captured wcId before calling this).
   * @param {any} tab
   * @returns {Promise<any | null>}
   */
  async function activateStar(tab) {
    if (!tab || tab.wcId == null || !tab.container || (isInternalTab && isInternalTab(tab)) || tab.container.burner)
      return null;
    const jarId = tab.container.id;
    const existing = findByUrl(jarId, tab.url);
    if (existing) return existing;
    const title = tab.title && tab.title !== 'New tab' ? tab.title : tab.url || '';
    const res = await bridge.bookmarkAdd({ jarId, url: tab.url, title, icon: tab.favicon ?? undefined });
    return res && res.ok ? res.bookmark : null;
  }

  /** @type {string | null} the jar captured at popover-open time (L3-DD-E). */
  let capturedJarId = null;

  /** Capture the popover's owning jar at OPEN — read back by
   * `handleEditSubmit` at submit time, never re-resolved from "whatever is
   * active now" (the DD13 TOCTOU this guards against). @param {string|null} jarId */
  function captureEditJar(jarId) {
    capturedJarId = jarId ?? null;
  }

  /**
   * The bookmark-edit sheet's forwarded-submit handler (main → chrome, over
   * `onBookmarkEditSubmit` — the AC's "chrome issues all bookmark mutations"
   * invariant). Fire-and-forget: a RESOLVED `{ ok:false }` gets no operator
   * feedback here (M15 F3 Leg 2, DD9 — L3-DD-F's fallback surface removed).
   *
   * HAT FIX 1 (M15 F2 Leg 4 — H5) made main's `register-overlay-ipc.js`
   * consult the store and reject BEFORE closing the sheet, so the sheet's own
   * inline error line is the operator-visible feedback for the common case.
   * The RESIDUAL RACE is UNHANDLED and accepted: main's pre-close read-check
   * and this handler's own bookmarkUpdate/bookmarkRemove are two SEPARATE
   * round trips, so another window can still mutate the store in the gap —
   * and by then `register-overlay-ipc.js:573` has already closed the sheet
   * before forwarding, so the inline-error path HAT FIX 1 built is
   * structurally unavailable from here. The only other surface L3-DD-F had
   * was a chrome-DOCUMENT one, which the guest `WebContentsView` is layered
   * OVER — it claimed to inform the operator while rendering nowhere the
   * operator can see (a pre-existing, mission-level known issue wider than
   * this flight). Correctness is unaffected either way: the cache's own
   * `bookmarks-changed` re-query (or its absence, on a rejected mutation)
   * re-derives star and bar to truth independently.
   * @param {{ id?: unknown, action?: unknown, name?: unknown, url?: unknown }} payload
   */
  function handleEditSubmit(payload) {
    if (!payload || typeof payload.id !== 'string') return;
    const jarId = capturedJarId;
    if (payload.action === 'remove') {
      // Resolved { ok:false } is the UNHANDLED residual race (DD9, above);
      // .catch swallows genuine IPC failures.
      bridge.bookmarkRemove({ id: payload.id, jarId }).catch(() => {});
    } else {
      // Same: resolved rejection unhandled (DD9), IPC failure swallowed.
      bridge.bookmarkUpdate({ id: payload.id, title: payload.name, url: payload.url, jarId }).catch(() => {});
    }
  }

  /**
   * The drag-reorder commit (M15 F3 Leg 3, DD6b/DD7) — the module's home for
   * this for the same reason `activateStar`/`handleEditSubmit` live here: the
   * bookmark business logic renderer.js's line budget keeps out of the
   * composition root.
   *
   * THE INPUT IS A FRESH `bookmarksGet`, NOT `listFor` (DD6b), and the reason
   * is a correctness one rather than a stylistic one. DD7 mandates FULL id
   * lists; `listFor` is a cache read whose staleness bound is one broadcast
   * round trip. If another window added a bookmark this window has not yet
   * processed, a cache-derived payload OMITS that id — and the store's
   * forgiving rule then appends it silently at the END (`bookmarks-store.js`'s
   * reorder), relocating another window's bookmark, returning `{ok:true}`, and
   * broadcasting the damage as if it were intended. The store's tolerance is a
   * safety net against malformed input, not a licence to send stale input.
   *
   * `moveIndex` is IMPORTED UNCHANGED from `tab-order.js` and composes exactly
   * with `dropIndexFromPointer`, whose "insertion index among the remaining
   * slots" IS `toIndex`'s contract (the pairing `commitTabMove` already uses).
   * A hand-rolled splice pair is the classic forward-move off-by-one. Its
   * SAME-ARRAY-REFERENCE no-op return is what gives two behaviours for free:
   *   - a drop back into the original position issues NO reorder and therefore
   *     no broadcast (AC4);
   *   - a bookmark deleted by another window between dragstart and this read
   *     misses `indexOf`, so the commit is skipped rather than sending an id
   *     the store would ignore.
   *
   * Failure disposition: a rejected read/write is swallowed (the cache's own
   * `bookmarks-changed` path re-derives the surfaces to truth independently),
   * and a resolved `{ok:false, reason:'unknown-jar'}` — the jar deleted
   * mid-drag — is a silent no-op, consistent with DD9's disposition of the
   * residual-race feedback.
   *
   * @param {string | null} jarId captured at dragstart, never resolved at drop time
   * @param {string} bookmarkId from the dragstart snapshot (dataTransfer has left protected mode by now)
   * @param {number} toIndex the drop index from `classifyBookmarkDrop`
   * @returns {Promise<boolean>} whether a reorder was actually issued
   */
  function commitReorder(jarId, bookmarkId, toIndex) {
    return reorderWith(jarId, bookmarkId, () => toIndex);
  }

  /**
   * Bar → overflow drop commit (M15 F3 Leg 5a, AC4/AC10). The ONLY difference
   * from `commitReorder` is WHERE `toIndex` comes from: the ruled formula in
   * `bookmark-drag.js`'s `overflowDropToIndex`, evaluated against the length of
   * the FRESH order this commit just read — never against a cached length. That
   * placement is the whole reason the two entry points exist rather than one:
   * the clamp's third term (`orderLength - 1`) is only knowable after the DD6b
   * read, and it is what stops a drop past the last overflow row from becoming
   * a silent no-op.
   *
   * `visibleCount` and `dropIndex` both arrive from the DRAGSTART-time hold, not
   * from any live read — see `bookmarks-bar.js`'s `dragHold`.
   *
   * @param {string | null} jarId captured at dragstart (DD13 TOCTOU discipline)
   * @param {string} bookmarkId from the dragstart snapshot
   * @param {number} visibleCount STORED alongside the snapshot the sheet rendered
   * @param {number} dropIndex snapshot-local index from `overflowDropIndexY`
   * @returns {Promise<boolean>} whether a reorder was actually issued
   */
  function commitOverflowDrop(jarId, bookmarkId, visibleCount, dropIndex) {
    return reorderWith(jarId, bookmarkId, (n) => overflowDropToIndex(visibleCount, dropIndex, n));
  }

  /** The shared body of both commits: DD6b fresh read → id list → `moveIndex`
   * → `bookmarkReorder`, with the same-reference no-op short-circuit. The only
   * varying part is how `toIndex` is derived, which is why it arrives as a
   * function of the fresh order's length rather than as a number.
   * @param {string | null} jarId @param {string} bookmarkId
   * @param {(orderLength: number) => number} toIndexFor */
  async function reorderWith(jarId, bookmarkId, toIndexFor) {
    if (jarId == null || typeof bookmarkId !== 'string') return false;
    let list;
    try {
      list = await bridge.bookmarksGet({ jarId });
    } catch {
      return false;
    }
    if (!Array.isArray(list)) return false;
    const order = list.map((b) => b && b.id);
    const next = moveIndex(order, order.indexOf(bookmarkId), toIndexFor(order.length));
    if (next === order) return false; // same reference — nothing moved, no call, no broadcast
    try {
      await bridge.bookmarkReorder({ jarId, ids: next });
    } catch {
      return false;
    }
    return true;
  }

  return {
    boot,
    ensureJar,
    findByUrl,
    listFor,
    activateStar,
    captureEditJar,
    handleEditSubmit,
    commitReorder,
    commitOverflowDrop
  };
}

/**
 * Pure: translate a store-shaped bookmark entry ({id, title, url, icon,
 * addedAt}) into the bookmark-edit sheet's model shape ({id, name, url}) —
 * the mirror of handleEditSubmit's name→title mapping above, and the SINGLE
 * choke point every open path (star / Ctrl+D / page-context via
 * activateStar's resolution; bar right-click; overflow right-click) must
 * route through — renderer.js's openBookmarkEditOverlay is the one caller.
 * A missing/non-string/empty title falls back to the entry's url (never a
 * blank field) — the same "never blank" idiom as activateStar's own title
 * fallback above.
 * @param {any} entry
 * @returns {{ id: any, name: string, url: any }}
 */
export function bookmarkEntryToEditModel(entry) {
  const title = entry && typeof entry.title === 'string' && entry.title ? entry.title : (entry && entry.url) || '';
  return { id: entry && entry.id, name: title, url: entry && entry.url };
}
