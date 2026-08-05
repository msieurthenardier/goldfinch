'use strict';

// Bookmarks IPC domain (Flight 1 "Bookmarking Core and Surfaces" DD3, Leg 1;
// rewritten M15 Flight 2 "Jar-Scoped Bookmarks" Leg 2 / flight DD1-DD5, leg
// L2-DD-C). SENDER-RESOLVED CHROME IPC ONLY — deliberately no
// `registerInternal` twins (unlike jar-registry-ipc.js): every consumer this
// flight builds (star, bar, overflow model, omnibox merge) lives in the
// chrome renderer; no internal page reads bookmarks. If a future internal
// page needs bookmarks, its read channel gets re-homed then — not
// speculatively carved out here.
//
// Jar-addressed (DD3): all six handlers take `jarId` in the payload.
// Registry rejection (L2-DD-C, DD8's main-side guard): the FOUR mutation
// channels (add/update/remove/reorder) reject a `jarId` absent from
// `jars.list()` with `{ ok: false, reason: 'unknown-jar' }` — this covers
// burner ids (minted client-side, never entering the registry), `internal`,
// and a deleted jar in one rule. Reads (`bookmarks-get`/`bookmarks-suggest`)
// deliberately SKIP the check — an unknown jar naturally yields zero rows,
// and a read must never fail during the jar-delete race window.
//
// Broadcast contract (DD5): every mutation broadcasts `bookmarks-changed`
// with `{ jarId }` (invalidation-not-snapshot, the history-changed
// precedent) via broadcastToChromeAndInternal — subscribers re-query their
// own read path (bookmarksGet) rather than receive a pushed snapshot.
//
// Idempotent-add broadcast suppression (Edge Case — duplicate add race): a
// re-add of an already-bookmarked URL (same jar) returns the existing entry
// unchanged; the store's `created` flag tells this layer whether anything
// actually mutated, so a duplicate add does not re-broadcast.

// M15 F1 Leg 4 (DD11): pure ESM matcher, required from this CJS module the
// same way bookmarks-store.js pulls in bookmark-url.js (Node ≥22 synchronous
// require(esm)).
const { matchBookmarks } = require('../shared/bookmark-suggest.js');

function registerBookmarksIpc({ ipcMain, bookmarksStore, jars, broadcast }) {
  /** @param {unknown} jarId */
  function isKnownJar(jarId) {
    return typeof jarId === 'string' && jars.list().some((j) => j.id === jarId);
  }

  function handleGet(_e, p) {
    const jarId = p !== null && typeof p === 'object' && typeof p.jarId === 'string' ? p.jarId : '';
    return bookmarksStore.list(jarId);
  }

  // M15 F1 Leg 4 (DD11), jar-scoped M15 F2 Leg 2: per-jar omnibox suggest
  // source. Response envelope mirrors history-suggest's {ok, suggestions}
  // shape even though the matcher itself never throws — the try/catch is
  // defensive-only (Edge Case: a source failure must degrade to `ok:false`,
  // never throw across the IPC boundary). Deliberately SKIPS the
  // unknown-jar check (read path, L2-DD-C) — an unknown jar's list() is
  // naturally empty.
  function handleSuggest(_e, p) {
    const jarId = p !== null && typeof p === 'object' && typeof p.jarId === 'string' ? p.jarId : '';
    const query = p !== null && typeof p === 'object' && typeof p.query === 'string' ? p.query : '';
    /** @type {{ limit?: number }} */
    const opts = {};
    if (p !== null && typeof p === 'object' && typeof p.limit === 'number') opts.limit = p.limit;
    try {
      return { ok: true, suggestions: matchBookmarks(bookmarksStore.list(jarId), query, opts) };
    } catch (err) {
      console.error('[bookmarks]', err);
      return { ok: false, suggestions: [] };
    }
  }

  function handleAdd(_e, p) {
    const payload = p !== null && typeof p === 'object' ? p : {};
    if (!isKnownJar(payload.jarId)) return { ok: false, reason: 'unknown-jar' };
    const result = bookmarksStore.add(payload.jarId, { url: payload.url, title: payload.title, icon: payload.icon });
    if (result.ok && result.created) broadcast('bookmarks-changed', { jarId: payload.jarId });
    return result;
  }

  function handleUpdate(_e, p) {
    if (p === null || typeof p !== 'object' || typeof p.id !== 'string') {
      return { ok: false, reason: 'not-found' };
    }
    // Registry check first, then store validation (Edge Case: a valid jar
    // with an invalid url is 'invalid-url', not 'unknown-jar').
    if (!isKnownJar(p.jarId)) return { ok: false, reason: 'unknown-jar' };
    const result = bookmarksStore.update(p.jarId, p.id, { url: p.url, title: p.title, icon: p.icon });
    if (result.ok) broadcast('bookmarks-changed', { jarId: p.jarId });
    return result;
  }

  function handleRemove(_e, p) {
    if (p === null || typeof p !== 'object' || typeof p.id !== 'string') {
      return { ok: false, reason: 'not-found' };
    }
    if (!isKnownJar(p.jarId)) return { ok: false, reason: 'unknown-jar' };
    const result = bookmarksStore.remove(p.jarId, p.id);
    if (result.ok) broadcast('bookmarks-changed', { jarId: p.jarId });
    return result;
  }

  function handleReorder(_e, p) {
    if (p === null || typeof p !== 'object' || !isKnownJar(p.jarId)) {
      return { ok: false, reason: 'unknown-jar' };
    }
    const ids = Array.isArray(p.ids) ? p.ids : null;
    const result = bookmarksStore.reorder(p.jarId, ids);
    // reorder() always resolves { ok: true, ... } (Edge Cases: a malformed
    // payload is a no-op over the current order, never a failure) — every
    // mutation channel unconditionally broadcasts per DD5/AC.
    broadcast('bookmarks-changed', { jarId: p.jarId });
    return result;
  }

  ipcMain.handle('bookmarks-get', handleGet);
  ipcMain.handle('bookmark-add', handleAdd);
  ipcMain.handle('bookmark-update', handleUpdate);
  ipcMain.handle('bookmark-remove', handleRemove);
  ipcMain.handle('bookmark-reorder', handleReorder);
  ipcMain.handle('bookmarks-suggest', handleSuggest);
}

module.exports = { registerBookmarksIpc };
