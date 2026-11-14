// @ts-check
'use strict';

// History recorder: the recording GATE (flight DD4/DD5) — decides whether a
// navigation becomes a `visits` row and keeps the small bookkeeping the
// decision needs (per-jar duplicate suppression, per-wcId title backfill).
//
// Design — Electron-free, injected-deps factory (DD8), NOT a module
// singleton: main.js builds exactly one instance at boot, but the unit suite
// builds many against fake stores/broadcasters. Mirrors createMenuOverlayManager.
//
// Decision gates, in order (handleNavigation):
//   1. Positive allowlist (DD5): the tab's partition must resolve to a
//      registered jar (`listJars().find(j => j.partition === partition)`).
//      Burner (`burner:<n>`), internal (`goldfinch-internal`), and any
//      unregistered partition match nothing here — record nothing, by
//      construction, no "is not a burner" negative check anywhere.
//   2. Scheme allowlist (DD4): only `http:`/`https:` URLs are recorded. This
//      structurally excludes `goldfinch://`, `about:blank`, and anything else.
//   3. Consecutive-duplicate suppression (DD4): a per-jar in-memory
//      `{ url, ts }` map bounds reload/redirect spam — the SAME url within
//      `suppressionMs` of the jar's last recorded visit is dropped. The map
//      entry's `ts` is deliberately NOT refreshed on a suppressed hit, so a
//      reload loop cannot extend the suppression window indefinitely; only a
//      genuinely NEW recorded visit moves `ts` forward.
//
// Title backfill: `page-title-updated` arrives after navigation. The recorder
// keeps a per-wcId map of the last recorded visit's `{ visitId, jarId, url, visitedAt }` (the
// jarId is needed for the history-changed broadcast and cannot be recovered
// from `lastByJar`, which is keyed by jar, not by tab). All four travel to the store, which updates a
// row only when id, jar, URL AND time all match (Mission 23 Flight 1, leg `jar-isolation`): the row id
// is reissued by SQLite after a clear/prune/delete, so a handle that outlives its row can never land on
// another visit - in another jar or the same one. The broadcast fires only when a row changed, and a
// handle that matched nothing is forgotten. Cache contract: the
// store row is the source of truth; the map is write-through bookkeeping,
// invalidated by the next navigation on that wcId or by forgetTab(wcId). A
// crashed tab (no tab-close) leaks its map entry — accepted, bounded (wcIds
// are never reused), mirrors the pre-existing tabViews crash gap (flight DD4,
// Architect review).
//
// Bounds (Mission 23 Flight 1, leg `prompts-and-bounds`): a page controls both its title and its address, so
// both are bounded before they reach the store. A title is cut to TITLE_MAX_CHARS and title writes for one tab
// are limited to one per TITLE_INTERVAL_MS: the first update in an interval is written at once, later ones
// replace a single pending value that is written when the interval ends (so a page's FINAL title is always
// recorded). The pending value is dropped when the tab is forgotten or a new visit is recorded for it. An
// address longer than ADDRESS_MAX_CHARS is NOT recorded (never truncated: a truncated address is a wrong
// address). Any main-frame navigation that is seen but not recorded (over the cap, an unrecorded scheme or
// jar, a store failure) CLEARS the tab's last-visit handle and pending title, so the new page's title is
// written nowhere; a suppressed duplicate of the tab's own last address keeps the handle. An address is stored without `user:pass@`
// (`displayUrl`). The limiter reads the injected clock and uses an injected timer, so it is unit-tested
// without real time.
//
// The recorder never throws out of a handler: every store call is
// try/catch-wrapped so a store hiccup cannot break navigation.

const { displayUrl, capTitle, TITLE_MAX_CHARS } = require('../shared/display-url');

/** Minimum time between two title writes for one tab. */
const TITLE_INTERVAL_MS = 1000;
/** Longest address recorded, in characters; a longer one is skipped. */
const ADDRESS_MAX_CHARS = 8192;

/**
 * @typedef {{ id: string, partition: string }} JarLike
 */

/**
 * @param {{
 *   store: {
 *     recordVisit: (v: { jarId: string, url: string, title: string | null, visitedAt: number }) => number,
 *     setTitle: (visit: { visitId: number, jarId: string, url: string, visitedAt: number }, title: string) => boolean
 *   },
 *   listJars: () => Array<JarLike>,
 *   broadcast: (channel: string, payload: any) => void,
 *   now?: () => number,
 *   suppressionMs?: number,
 *   setTimer?: (fn: () => void, ms: number) => any,
 *   clearTimer?: (handle: any) => void
 * }} deps
 */
function createHistoryRecorder({
  store,
  listJars,
  broadcast,
  now = () => Date.now(),
  suppressionMs = 30_000,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h)
}) {
  /** @type {Map<string, { url: string, ts: number }>} */
  const lastByJar = new Map();
  /** @type {Map<number, { visitId: number, jarId: string, url: string, visitedAt: number }>} */
  const lastVisitByWc = new Map();
  /** Per-tab title limiter state: when the last write happened, the one coalesced pending title, its timer. @type {Map<number, { lastWriteAt: number, pending: string | null, timer: any }>} */
  const titleState = new Map();

  /** @param {number} wcId */
  function dropTitleState(wcId) {
    const st = titleState.get(wcId);
    if (st && st.timer !== null) clearTimer(st.timer);
    titleState.delete(wcId);
  }

  /**
   * A main-frame navigation was seen but not recorded: the tab's last-visit handle and any pending title
   * belong to the PREVIOUS page, and the new page's title must be written nowhere.
   * @param {number} wcId
   */
  function unrecorded(wcId) {
    lastVisitByWc.delete(wcId);
    dropTitleState(wcId);
    return null;
  }

  /**
   * @param {{ wcId: number, partition: string, url: string }} args
   * @returns {number | null} the new visit id, or null when the navigation was gated out
   */
  function handleNavigation({ wcId, partition, url }) {
    // 1. Positive allowlist (DD5) — O(#jars) linear scan per navigation; jar
    // counts are small (a handful), so this is deliberate, not a perf risk.
    const jar = listJars().find((j) => j.partition === partition);
    if (!jar) return unrecorded(wcId);

    // 1b. Address bound: an over-long address is not recorded (and the tab's last-visit handle is cleared).
    if (typeof url !== 'string' || url.length > ADDRESS_MAX_CHARS) return unrecorded(wcId);

    // 2. Scheme allowlist (DD4) — http(s) only. new URL() throws on a
    // malformed/relative string, which also falls out here as "not recorded".
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return unrecorded(wcId);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return unrecorded(wcId);
    // The stored address never carries `user:pass@`.
    url = displayUrl(url);

    // 3. Consecutive-duplicate suppression (DD4) — jar-scoped, not tab-scoped:
    // two tabs in the same jar visiting the same URL within the window both
    // suppress after the first. Suppressed hits do NOT refresh `ts`.
    const last = lastByJar.get(jar.id);
    if (last && last.url === url && now() - last.ts < suppressionMs) {
      // The SAME address as this tab's own last visit: the title still belongs to that visit, keep the
      // handle. Anything else (another tab's visit of this address) leaves the tab with no visit of its own.
      const own = lastVisitByWc.get(wcId);
      if (own && own.url === url) return null;
      return unrecorded(wcId);
    }

    try {
      const visitedAt = now();
      const visitId = store.recordVisit({ jarId: jar.id, url, title: null, visitedAt });
      lastByJar.set(jar.id, { url, ts: visitedAt });
      lastVisitByWc.set(wcId, { visitId, jarId: jar.id, url, visitedAt });
      // A pending title belonged to the previous visit.
      dropTitleState(wcId);
      broadcast('history-changed', { jarId: jar.id });
      return visitId;
    } catch (err) {
      console.error('[history]', err);
      return unrecorded(wcId);
    }
  }

  /**
   * @param {number} wcId
   * @param {string} title already capped
   */
  function writeTitle(wcId, title) {
    const entry = lastVisitByWc.get(wcId);
    if (!entry) return;
    try {
      if (store.setTitle(entry, title)) broadcast('history-changed', { jarId: entry.jarId });
      else lastVisitByWc.delete(wcId);
    } catch (err) {
      console.error('[history]', err);
    }
  }

  /**
   * @param {number} wcId
   * @param {string} title
   */
  function handleTitleUpdated(wcId, title) {
    if (typeof title !== 'string' || title.length === 0) return;
    if (!lastVisitByWc.has(wcId)) return;
    const capped = capTitle(title);
    const t = now();
    let st = titleState.get(wcId);
    if (!st || (st.timer === null && t - st.lastWriteAt >= TITLE_INTERVAL_MS)) {
      // First update in an interval: written at once.
      if (!st) {
        st = { lastWriteAt: t, pending: null, timer: null };
        titleState.set(wcId, st);
      }
      st.lastWriteAt = t;
      writeTitle(wcId, capped);
      return;
    }
    // Inside the interval: replace the single pending value; one timer writes it when the interval ends.
    st.pending = capped;
    if (st.timer !== null) return;
    const state = st;
    const remaining = Math.max(0, TITLE_INTERVAL_MS - (t - state.lastWriteAt));
    const handle = setTimer(() => {
      state.timer = null;
      const pending = state.pending;
      state.pending = null;
      if (pending === null || titleState.get(wcId) !== state) return;
      state.lastWriteAt = now();
      writeTitle(wcId, pending);
    }, remaining);
    if (handle && typeof handle.unref === 'function') handle.unref();
    state.timer = handle;
  }

  /**
   * @param {number} wcId
   */
  function forgetTab(wcId) {
    lastVisitByWc.delete(wcId);
    dropTitleState(wcId);
  }

  /**
   * Cancel every pending title timer (and its pending value). Called from `before-quit`, before the
   * store closes, so no timer fires a write against a closed database.
   */
  function cancelPendingTitles() {
    for (const wcId of [...titleState.keys()]) dropTitleState(wcId);
  }

  return { handleNavigation, handleTitleUpdated, forgetTab, cancelPendingTitles };
}

module.exports = { createHistoryRecorder, TITLE_MAX_CHARS, TITLE_INTERVAL_MS, ADDRESS_MAX_CHARS };
