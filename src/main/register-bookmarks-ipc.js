'use strict';

// Bookmarks IPC domain (Flight 1 "Bookmarking Core and Surfaces" / DD3, Leg 1).
// SENDER-RESOLVED CHROME IPC ONLY — deliberately no `registerInternal` twins
// (unlike jar-registry-ipc.js): every consumer this flight builds (star, bar,
// overflow model, omnibox merge) lives in the chrome renderer; no internal
// page reads bookmarks (DD3). If a future internal page needs bookmarks, its
// read channel gets re-homed then — not speculatively carved out here.
//
// Broadcast contract (DD3): every mutation broadcasts `bookmarks-changed`
// with an EMPTY payload (invalidation-not-snapshot, like history-changed's
// `{jarId}`-only contract, but bookmarks are app-scoped so there isn't even a
// jarId to carry) via broadcastToChromeAndInternal — subscribers re-query
// their own read path (bookmarksGet) rather than receive a pushed snapshot.
//
// Idempotent-add broadcast suppression (Edge Case — duplicate add race): a
// re-add of an already-bookmarked URL returns the existing entry unchanged;
// the store's `created` flag tells this layer whether anything actually
// mutated, so a duplicate add does not re-broadcast.

// M15 F1 Leg 4 (DD11): pure ESM matcher, required from this CJS module the
// same way bookmarks-store.js pulls in bookmark-url.js (Node ≥22 synchronous
// require(esm)).
const { matchBookmarks } = require('../shared/bookmark-suggest.js');

function registerBookmarksIpc({ ipcMain, bookmarksStore, broadcast }) {
  function handleGet() {
    return bookmarksStore.list();
  }

  // M15 F1 Leg 4 (DD11): app-scoped omnibox suggest source — deliberately NO
  // jarId parameter (bookmarks are app-scoped; the mission's jar-boundary
  // ruling lets bookmark rows surface in any jar). Response envelope mirrors
  // history-suggest's {ok, suggestions} shape (design decision: consistency
  // beats minimalism, so the controller's `res.ok` discipline applies
  // uniformly to both sources) even though the matcher itself never throws —
  // the try/catch is defensive-only (Edge Case: a source failure must
  // degrade to `ok:false`, never throw across the IPC boundary).
  function handleSuggest(_e, p) {
    const query = p !== null && typeof p === 'object' && typeof p.query === 'string' ? p.query : '';
    /** @type {{ limit?: number }} */
    const opts = {};
    if (p !== null && typeof p === 'object' && typeof p.limit === 'number') opts.limit = p.limit;
    try {
      return { ok: true, suggestions: matchBookmarks(bookmarksStore.list(), query, opts) };
    } catch (err) {
      console.error('[bookmarks]', err);
      return { ok: false, suggestions: [] };
    }
  }

  function handleAdd(_e, p) {
    const payload = p !== null && typeof p === 'object' ? p : {};
    const result = bookmarksStore.add({ url: payload.url, title: payload.title, icon: payload.icon });
    if (result.ok && result.created) broadcast('bookmarks-changed', {});
    return result;
  }

  function handleUpdate(_e, p) {
    if (p === null || typeof p !== 'object' || typeof p.id !== 'string') {
      return { ok: false, reason: 'not-found' };
    }
    const result = bookmarksStore.update(p.id, { url: p.url, title: p.title, icon: p.icon });
    if (result.ok) broadcast('bookmarks-changed', {});
    return result;
  }

  function handleRemove(_e, p) {
    if (p === null || typeof p !== 'object' || typeof p.id !== 'string') {
      return { ok: false, reason: 'not-found' };
    }
    const result = bookmarksStore.remove(p.id);
    if (result.ok) broadcast('bookmarks-changed', {});
    return result;
  }

  function handleReorder(_e, p) {
    const ids = p !== null && typeof p === 'object' && Array.isArray(p.ids) ? p.ids : null;
    const result = bookmarksStore.reorder(ids);
    // reorder() always resolves { ok: true, ... } (Edge Cases: a malformed
    // payload is a no-op over the current order, never a failure) — every
    // mutation channel unconditionally broadcasts per DD3/AC5.
    broadcast('bookmarks-changed', {});
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
