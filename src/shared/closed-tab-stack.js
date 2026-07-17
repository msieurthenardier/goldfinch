// @ts-check

// Closed-tab stack (M09 Flight 4, DD1) — a pure, bounded, main-process-owned
// data structure. Real ES module (require(esm) from main.js, precedented by
// sheet-accelerator.js). No Electron dependency: main.js owns the singleton
// instance and all capture/reopen wiring; this module is just the container.
//
// Shape: `push`/`pop`/`peek`/`size`, bounded at MAX_ENTRIES (oldest evicted).
// Entries are `{ url, title, jarId, stripIndex, navEntries, navIndex, closedAt }`
// (Flight-9 persistence hook: `toJSON()`/`fromJSON()` — designed now, unused
// this flight, since this flight keeps the stack in-memory only).

/**
 * @typedef {{
 *   url: string,
 *   title: string,
 *   jarId: string,
 *   stripIndex: number,
 *   navEntries: unknown[],
 *   navIndex: number,
 *   closedAt: number
 * }} ClosedTabEntry
 */

const MAX_ENTRIES = 25;

/**
 * @param {{ maxEntries?: number }} [opts]
 */
function createClosedTabStack({ maxEntries = MAX_ENTRIES } = {}) {
  /** @type {ClosedTabEntry[]} */
  const entries = [];

  /**
   * Push a newly closed tab's entry onto the stack (most-recent-last). When
   * the stack is at capacity, the OLDEST entry (index 0) is evicted first —
   * a bounded LIFO, not a ring buffer with wraparound semantics.
   * @param {ClosedTabEntry} entry
   */
  function push(entry) {
    entries.push(entry);
    if (entries.length > maxEntries) entries.shift();
  }

  /**
   * Pop (remove and return) the most-recently-closed entry, or `null` when
   * the stack is empty.
   * @returns {ClosedTabEntry | null}
   */
  function pop() {
    if (entries.length === 0) return null;
    const last = entries.pop();
    return last === undefined ? null : last;
  }

  /**
   * Look at the most-recently-closed entry WITHOUT removing it, or `null`
   * when the stack is empty. Non-mutating.
   * @returns {ClosedTabEntry | null}
   */
  function peek() {
    if (entries.length === 0) return null;
    return entries[entries.length - 1];
  }

  /** @returns {number} */
  function size() {
    return entries.length;
  }

  /**
   * Flight-9 persistence hook (designed, unused this flight — the stack is
   * in-memory only per Open Questions). Returns a plain-data snapshot in
   * oldest-first order (same order as the internal array), safe to
   * `JSON.stringify`.
   * @returns {ClosedTabEntry[]}
   */
  function toJSON() {
    return entries.map((e) => ({ ...e }));
  }

  /**
   * Flight-9 persistence hook counterpart (designed, unused this flight).
   * Replaces the stack's contents with a plain-data snapshot produced by
   * `toJSON()` (or an equivalently-shaped array), oldest-first, bounded to
   * `maxEntries` (keeping the newest `maxEntries` if the snapshot is over
   * capacity — mirrors `push`'s oldest-evicted rule).
   * @param {ClosedTabEntry[]} snapshot
   */
  function fromJSON(snapshot) {
    entries.length = 0;
    const list = Array.isArray(snapshot) ? snapshot : [];
    const start = Math.max(0, list.length - maxEntries);
    for (const e of list.slice(start)) entries.push({ ...e });
  }

  return { push, pop, peek, size, toJSON, fromJSON };
}

export { createClosedTabStack, MAX_ENTRIES };
