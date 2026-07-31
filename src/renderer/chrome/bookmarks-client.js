import { bookmarkUrlsMatch } from '../../shared/bookmark-url.js';

// Bookmarks cache client (M15 F1 "Bookmarking Core and Surfaces" Leg 2;
// rewritten jar-aware M15 F2 "Jar-Scoped Bookmarks" Leg 3, L3-DD-A/A2/B/E/F).
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
// L3-DD-F: a resolved `{ ok:false }` submit surfaces operator feedback via
// the injected `toast(title, body)` (renderer.js-local wrapper over
// mediaController.toast, late-bound the same way `onChanged` is); the
// `.catch(() => {})` stays for genuine IPC failures only.
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
export function createBookmarksClient({ bridge, isInternalTab, onChanged, toast, jarsBoot, getDefaultJarId }) {
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
    const p = bridge.bookmarksGet({ jarId })
      .then((list) => {
        inFlight.delete(jarId);
        if (!isJarStillKnown(jarId)) return; // L3-DD-A2: dropped — evicted mid-flight
        applyJarList(jarId, list);
        if (onChanged) onChanged(jarId);
      })
      .catch(() => { inFlight.delete(jarId); });
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
    bridge.bookmarksGet({ jarId }).then((list) => {
      applyJarList(jarId, list);
      if (onChanged) onChanged(jarId);
    }).catch(() => {});
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
    if (
      !tab || tab.wcId == null || !tab.container ||
      (isInternalTab && isInternalTab(tab)) ||
      tab.container.burner
    ) return null;
    const jarId = tab.container.id;
    const existing = findByUrl(jarId, tab.url);
    if (existing) return existing;
    const title = tab.title && tab.title !== 'New tab' ? tab.title : (tab.url || '');
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

  /** L3-DD-F: distinct, non-blocking operator feedback for a resolved
   * rejection. Wording is implementer's discretion (flight "Acceptable
   * variations"). @param {string} [reason] */
  function surfaceRejection(reason) {
    if (!toast) return;
    if (reason === 'duplicate-url') {
      toast('Bookmark not saved', 'A bookmark for this URL already exists in this jar.');
    } else {
      toast('Bookmark not saved', 'This bookmark could not be found — it may have been removed.');
    }
  }

  /**
   * The bookmark-edit sheet's forwarded-submit handler (main → chrome, over
   * `onBookmarkEditSubmit` — the AC's "chrome issues all bookmark mutations"
   * invariant). L3-DD-F: no longer fire-and-forget — a RESOLVED
   * `{ ok:false }` (cross-jar `duplicate-url`, a since-vanished `not-found`,
   * a since-deleted-jar `unknown-jar`) surfaces via `toast`; the
   * `.catch(() => {})` remains for genuine IPC failures. The cache's own
   * `bookmarks-changed` re-query (or its absence, on a rejected mutation)
   * still re-derives the star/bar to truth independently of this feedback.
   * @param {{ id?: unknown, action?: unknown, name?: unknown, url?: unknown }} payload
   */
  function handleEditSubmit(payload) {
    if (!payload || typeof payload.id !== 'string') return;
    const jarId = capturedJarId;
    if (payload.action === 'remove') {
      bridge.bookmarkRemove({ id: payload.id, jarId })
        .then((res) => { if (res && res.ok === false) surfaceRejection(res.reason); })
        .catch(() => {});
    } else {
      bridge.bookmarkUpdate({ id: payload.id, title: payload.name, url: payload.url, jarId })
        .then((res) => { if (res && res.ok === false) surfaceRejection(res.reason); })
        .catch(() => {});
    }
  }

  return {
    boot,
    ensureJar,
    findByUrl,
    listFor,
    activateStar,
    captureEditJar,
    handleEditSubmit,
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
