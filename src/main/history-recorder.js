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
// keeps a per-wcId map of the last recorded visit's `{ visitId, jarId }` (the
// jarId is needed for the history-changed broadcast and cannot be recovered
// from `lastByJar`, which is keyed by jar, not by tab). Cache contract: the
// store row is the source of truth; the map is write-through bookkeeping,
// invalidated by the next navigation on that wcId or by forgetTab(wcId). A
// crashed tab (no tab-close) leaks its map entry — accepted, bounded (wcIds
// are never reused), mirrors the pre-existing tabViews crash gap (flight DD4,
// Architect review).
//
// The recorder never throws out of a handler: every store call is
// try/catch-wrapped so a store hiccup cannot break navigation.

/**
 * @typedef {{ id: string, partition: string }} JarLike
 */

/**
 * @param {{
 *   store: {
 *     recordVisit: (v: { jarId: string, url: string, title: string | null, visitedAt: number }) => number,
 *     setTitle: (visitId: number, title: string) => void
 *   },
 *   listJars: () => Array<JarLike>,
 *   broadcast: (channel: string, payload: any) => void,
 *   now?: () => number,
 *   suppressionMs?: number
 * }} deps
 */
function createHistoryRecorder({ store, listJars, broadcast, now = () => Date.now(), suppressionMs = 30_000 }) {
  /** @type {Map<string, { url: string, ts: number }>} */
  const lastByJar = new Map();
  /** @type {Map<number, { visitId: number, jarId: string }>} */
  const lastVisitByWc = new Map();

  /**
   * @param {{ wcId: number, partition: string, url: string }} args
   * @returns {number | null} the new visit id, or null when the navigation was gated out
   */
  function handleNavigation({ wcId, partition, url }) {
    // 1. Positive allowlist (DD5) — O(#jars) linear scan per navigation; jar
    // counts are small (a handful), so this is deliberate, not a perf risk.
    const jar = listJars().find((j) => j.partition === partition);
    if (!jar) return null;

    // 2. Scheme allowlist (DD4) — http(s) only. new URL() throws on a
    // malformed/relative string, which also falls out here as "not recorded".
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

    // 3. Consecutive-duplicate suppression (DD4) — jar-scoped, not tab-scoped:
    // two tabs in the same jar visiting the same URL within the window both
    // suppress after the first. Suppressed hits do NOT refresh `ts`.
    const last = lastByJar.get(jar.id);
    if (last && last.url === url && now() - last.ts < suppressionMs) {
      return null;
    }

    try {
      const visitedAt = now();
      const visitId = store.recordVisit({ jarId: jar.id, url, title: null, visitedAt });
      lastByJar.set(jar.id, { url, ts: visitedAt });
      lastVisitByWc.set(wcId, { visitId, jarId: jar.id });
      broadcast('history-changed', { jarId: jar.id });
      return visitId;
    } catch (err) {
      console.error('[history]', err);
      return null;
    }
  }

  /**
   * @param {number} wcId
   * @param {string} title
   */
  function handleTitleUpdated(wcId, title) {
    if (typeof title !== 'string' || title.length === 0) return;
    const entry = lastVisitByWc.get(wcId);
    if (!entry) return;
    try {
      store.setTitle(entry.visitId, title);
      broadcast('history-changed', { jarId: entry.jarId });
    } catch (err) {
      console.error('[history]', err);
    }
  }

  /**
   * @param {number} wcId
   */
  function forgetTab(wcId) {
    lastVisitByWc.delete(wcId);
  }

  return { handleNavigation, handleTitleUpdated, forgetTab };
}

module.exports = { createHistoryRecorder };
