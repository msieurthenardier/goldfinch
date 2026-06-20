// @ts-check
'use strict';

// Downloads manager: the app-level canonical downloads model (Flight 5, Leg 1 / DD3).
//
// Holds in-memory IN-PROGRESS records (a Map<id, record>) and merges them with the
// store's TERMINAL records to present one cross-jar list. On a terminal transition a
// record is appended to the store and dropped from memory.
//
// Design:
// - ELECTRON-FREE: a factory createManager(store) with the store INJECTED, so it
//   unit-tests against a pure in-memory fake store (no fs, no electron).
// - ids come from store.getNextId() (persisted, monotonic — see downloads-store.js).
// - In-progress is MEMORY-ONLY: no restart reconciliation; the in-progress history
//   gap on any teardown is accepted for v1 (DD3). flushInterrupted() is a best-effort
//   teardown persist.
//
// Action handlers (pause/resume/cancel/remove/clear/open/show) are wired in later legs
// over the internal-IPC channels; this leg builds the methods they will call
// (remove/clear) but wires no channels.

/**
 * @param {{
 *   getNextId: () => number,
 *   list: () => Array<object>,
 *   append: (record: object) => void,
 *   remove: (id: number) => void,
 *   clear: () => void
 * }} store
 */
function createManager(store) {
  /** @type {Map<number, object>} in-progress records, keyed by id */
  const inProgress = new Map();

  /**
   * Register a newly started download. Assigns a persisted id, stores a
   * 'progressing' record in memory, and returns the id.
   * @param {{ url?: string, filename: string, savePath?: string|null, mime?: string, startTime?: number }} info
   * @returns {number}
   */
  function register({ url, filename, savePath, mime, startTime }) {
    const id = store.getNextId();
    /** @type {object} */
    const rec = {
      id,
      url: url ?? '',
      filename,
      savePath: savePath ?? null,
      state: 'progressing',
      received: 0,
      total: 0,
      paused: false,
      startTime: startTime ?? Date.now()
    };
    if (typeof mime === 'string') /** @type {any} */ (rec).mime = mime;
    inProgress.set(id, rec);
    return id;
  }

  /**
   * Update an in-progress record in memory (no disk write). No-op if id unknown.
   * @param {number} id
   * @param {{ received?: number, total?: number, state?: string, paused?: boolean }} patch
   */
  function update(id, { received, total, state, paused } = {}) {
    const rec = inProgress.get(id);
    if (!rec) return;
    const r = /** @type {any} */ (rec);
    if (received !== undefined) r.received = received;
    if (total !== undefined) r.total = total;
    if (state !== undefined) r.state = state;
    if (paused !== undefined) r.paused = paused;
  }

  /**
   * Finalize a download: build the terminal record, append to the store, and drop
   * it from memory. No-op if id is unknown (e.g. already finalized).
   * @param {number} id
   * @param {{ state: string, savePath?: string|null, endTime?: number, error?: string }} fin
   */
  function finalize(id, { state, savePath, endTime, error } = /** @type {any} */ ({})) {
    const rec = inProgress.get(id);
    if (!rec) return;
    const r = /** @type {any} */ (rec);
    /** @type {object} */
    const terminal = {
      id: r.id,
      url: r.url,
      filename: r.filename,
      savePath: savePath !== undefined ? savePath : r.savePath,
      state,
      received: r.received,
      total: r.total,
      startTime: r.startTime,
      endTime: endTime ?? Date.now()
    };
    if (typeof r.mime === 'string') /** @type {any} */ (terminal).mime = r.mime;
    if (typeof error === 'string') /** @type {any} */ (terminal).error = error;
    store.append(terminal);
    inProgress.delete(id);
  }

  /**
   * The full cross-jar list: in-memory in-progress records merged with the store's
   * terminal records, deduped by id (memory wins — a record briefly in both would
   * be the live one).
   * @returns {Array<object>}
   */
  function listAll() {
    /** @type {Map<number, object>} */
    const byId = new Map();
    for (const r of store.list()) byId.set(/** @type {any} */ (r).id, r);
    // Memory wins: set in-progress AFTER the store so they overwrite any collision.
    for (const r of inProgress.values()) byId.set(/** @type {any} */ (r).id, r);
    return [...byId.values()];
  }

  /**
   * Remove a record from both memory (if present) and the store's history.
   * Leg 2 calls this from the downloads-page action.
   * @param {number} id
   */
  function remove(id) {
    inProgress.delete(id);
    store.remove(id);
  }

  /**
   * Clear the store's terminal history. In-progress memory items stay (they are
   * not history yet).
   */
  function clear() {
    store.clear();
  }

  /**
   * Best-effort teardown persist: append each in-memory in-progress record to the
   * store as 'interrupted'. Tolerates a store throw per record (sync handler vs.
   * I/O write — the contract remains "in-progress is not durable", DD3).
   */
  function flushInterrupted() {
    const now = Date.now();
    for (const rec of inProgress.values()) {
      try {
        const r = /** @type {any} */ (rec);
        /** @type {object} */
        const terminal = {
          id: r.id,
          url: r.url,
          filename: r.filename,
          savePath: r.savePath,
          state: 'interrupted',
          received: r.received,
          total: r.total,
          startTime: r.startTime,
          endTime: now
        };
        if (typeof r.mime === 'string') /** @type {any} */ (terminal).mime = r.mime;
        store.append(terminal);
      } catch {
        // best-effort: a failed flush is tolerated (the gap is accepted, DD3).
      }
    }
  }

  return { register, update, finalize, listAll, remove, clear, flushInterrupted };
}

module.exports = { createManager };
