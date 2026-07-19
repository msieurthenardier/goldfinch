'use strict';

// Per-jar data, wipe, retention, cookie, and site-data IPC domain. Electron-
// free: every live session/store handle is injected by the facade.

const fs = require('fs/promises');
const path = require('path');
const { jarDataClassById } = require('../shared/jar-data-classes');
const { registerInternalHandler } = require('./internal-ipc');
const { cookieUrl, originFromIndexedDbDirname, mergeOriginTiers } = require('./jar-data-helpers');

function registerJarDataIpc({
  ipcMain,
  registerInternal = registerInternalHandler,
  jars,
  session,
  historyStore,
  cookieSeen,
  retentionSweep,
  wipeJarData,
  broadcast,
  broadcastJarsChanged
}) {
  // Per-jar data controls (M06 Flight 4, Leg 1 / DD2, DD3). Partition lookup is
  // inline `jars.list().find(...)` (the store deliberately exposes no `get(id)`
  // helper — do not add one for these two call sites). Burner is never a store
  // entry (no `partition` field on the identity object — src/shared/burner.js),
  // so `find` misses and both handlers reject it the same way as an unknown id;
  // this also covers `burner-<n>` ephemeral tab ids, which are never store
  // entries either.

  // handleClearData: strict fail-closed (DD2) — every requested class id must be
  // known BEFORE any session call runs (no partial application on a malformed
  // payload). Classes apply in payload order; duplicates are valid and simply
  // re-apply (harmless — not deduped, kept dumb per the leg spec).
  //
  // DD1 (M08 F3): dispatch is discriminator-FIRST — `d.custom === 'history'`
  // routes to `historyStore.clearJar` before the `d.storages` check, so a
  // naive storages-falsy fallthrough can never route a history clear into
  // `ses.clearCache()`. The history branch gets its OWN error fragment
  // (`history-failure`, static) for mixed-class diagnosability, and logs
  // (`console.error('[history]', …)`, house convention) on a store throw.
  async function handleClearData(_e, p) {
    if (p === null || typeof p !== 'object') return { ok: false, error: 'jars: clear-data — malformed-payload' };
    const entry = jars.list().find((j) => j.id === p.id);
    if (!entry) return { ok: false, error: 'jars: clear-data — unknown-jar' };
    if (!Array.isArray(p.classes) || p.classes.length === 0) {
      return { ok: false, error: 'jars: clear-data — invalid-classes' };
    }
    // Pre-validate every class id BEFORE any session/store call — strict
    // fail-closed, no partial application on a malformed payload.
    for (const classId of p.classes) {
      if (!jarDataClassById(classId)) return { ok: false, error: `jars: clear-data — unknown-class: ${classId}` };
    }
    const ses = session.fromPartition(entry.partition);
    const cleared = [];
    let historyDeleted = 0;
    try {
      for (const classId of p.classes) {
        const d = jarDataClassById(classId); // already validated above
        if (d.custom === 'history') {
          try {
            historyDeleted = historyStore.clearJar(p.id);
          } catch (e) {
            console.error('[history]', e); // house convention (Q1: yes, log)
            return { ok: false, error: 'jars: clear-data — history-failure' };
          }
          cleared.push(classId);
          continue;
        }
        if (d.storages) {
          await ses.clearStorageData({ storages: d.storages });
          // M10 Flight 2, Leg 3 / DD7: a cookies-class clear wipes every
          // cookie for the jar, so its cookie_seen bookkeeping dies too —
          // fail-soft, logged, never flips this call's ok (the session
          // clear already succeeded; a bookkeeping-cleanup hiccup just
          // means the next sweep's stamp pass re-treats a survivor as
          // "new", a harmless staleness).
          if (classId === 'cookies') {
            try {
              cookieSeen.deleteByJar(p.id);
            } catch (e) {
              console.error('[retention-sweep]', e);
            }
          }
        } else {
          // cache sentinel (DD2): clearCache() has no storages-set form, so it
          // pairs with a shadercache-only clearStorageData call.
          await ses.clearCache();
          await ses.clearStorageData({ storages: ['shadercache'] });
        }
        cleared.push(classId);
      }
    } catch (e) {
      // Fail-soft (matching the delete path's session-call containment stance):
      // a thrown session call returns { ok: false, error } with no partial-success shape.
      return { ok: false, error: `jars: clear-data — session-failure: ${String(e && e.message ? e.message : e)}` };
    }
    // Mixed ['history','cookies'] clears in request order with per-branch
    // error attribution; the history-changed broadcast fires only when the
    // history class was actually requested AND rows were deleted (n>0 gate,
    // same as history-ipc's clear).
    if (cleared.includes('history') && historyDeleted > 0) {
      broadcast('history-changed', { jarId: p.id });
    }
    // DD10 (design review, HIGH): jar-data-changed invalidates the Cookies /
    // Other-site-data panels — fired once, carrying only the classes ∩
    // {cookies, storage} that were ACTUALLY cleared this call (cache/history
    // clears alone never fire it; those panels have nothing to invalidate).
    const jarDataClasses = cleared.filter((c) => c === 'cookies' || c === 'storage');
    if (jarDataClasses.length > 0) {
      broadcast('jar-data-changed', { jarId: p.id, classes: jarDataClasses });
    }
    return { ok: true, cleared };
  }

  // handleWipe: the full identity wipe — same composition as identity-new
  // (main.js:2461, `clearStorageData()` + `clearCache()` + `rerollSeed`), now
  // routed through the shared `wipeJarData` helper (which also purges
  // history — DD2), plus the `jar-wiped` broadcast (DD4), minus registry
  // removal and automation-key revoke (the jar persists; its automation key
  // stays valid — DD3). The `jar-wiped` broadcast fires BEFORE resolving
  // (house broadcast-before-resolve rule) and ONLY on the success path — a
  // thrown session call returns { ok: false, error } with no broadcast and no
  // reroll/purge (nothing was wiped; no reload should fire). `jar-wiped`
  // ordering stays exactly as shipped (it drives tab reloads); `history-changed
  // { jarId }` fires immediately AFTER it, only when the purge deleted rows
  // (n>0 gate) — a purge failure or a no-op purge stays silent, still ok:true.
  async function handleWipe(_e, p) {
    if (p === null || typeof p !== 'object') return { ok: false, error: 'jars: wipe — malformed-payload' };
    const entry = jars.list().find((j) => j.id === p.id);
    if (!entry) return { ok: false, error: 'jars: wipe — unknown-jar' };
    const ses = session.fromPartition(entry.partition);
    /** @type {number} */
    let purged;
    try {
      purged = await wipeJarData(ses, entry.id);
    } catch (e) {
      return { ok: false, error: `jars: wipe — session-failure: ${String(e && e.message ? e.message : e)}` };
    }
    broadcast('jar-wiped', { id: entry.id });
    if (purged > 0) broadcast('history-changed', { jarId: entry.id });
    // DD10: a wipe always clears cookies + storage (+ cache), so the
    // Cookies/Other-site-data invalidation fires unconditionally on success
    // (unlike handleClearData's request-scoped filter above).
    broadcast('jar-data-changed', { jarId: entry.id, classes: ['cookies', 'storage'] });
    return { ok: true };
  }

  // handleSetRetention (flight DD4): jars.setRetention REJECTS invalid `days`
  // (returns null) rather than coercing it like the load-time cleanRetention —
  // so an unknown-jar rejection and an invalid-days rejection (both surface as
  // `null` from setRetention) must be disambiguated by checking jars.list()
  // membership FIRST. On success: broadcast jars-changed (existing
  // broadcastJarsChanged) FIRST, then run historyStore.pruneOneJar in its own
  // try/catch (fail-soft, logged — never flips `ok`), broadcasting
  // history-changed { jarId } only when rows were deleted. Returns
  // { ok: true, container } — the first `{ ok, container }` wrapper shape in
  // this module (the validation-failure branches force an `ok` envelope;
  // design review Q2: confirmed deliberate).
  //
  // M10 Flight 2, Leg 3 / DD4b, DD6, DD10 — the immediate one-jar retention
  // sweep. **SEQUENCING (leg-3 design review, HIGH — Context SEQUENCING):**
  // the aged-out-origin snapshot is taken BEFORE `pruneOneJar` runs, in the
  // SAME cutoff window `pruneOneJar` is about to delete — a post-prune
  // snapshot would see nothing for exactly the origins the storage sweep
  // targets (their visit rows are gone). Order, pinned: (1) snapshot via
  // `historyStore.expiredOriginsForJar`, (2) `historyStore.pruneOneJar`
  // (sync, unchanged), (3) the async cookie/storage sweep from the
  // snapshot (DD6: fire-and-forget, never awaited by this handler — the
  // invoke must resolve before the sweep finishes). The sweep's completion
  // broadcasts `jar-data-changed` (DD10) carrying only the classes actually
  // swept — never on the invoke itself, which would paint pre-sweep state.
  function handleSetRetention(_e, p) {
    if (p === null || typeof p !== 'object') return { ok: false, error: 'jars: set-retention — malformed-payload' };
    const known = jars.list().some((j) => j.id === p.id);
    if (!known) return { ok: false, error: 'jars: set-retention — unknown-jar' };
    const container = jars.setRetention(p.id, p.days);
    if (!container) return { ok: false, error: 'jars: set-retention — invalid-days' };
    broadcastJarsChanged();
    const now = Date.now();
    let agedOutOrigins = [];
    try {
      agedOutOrigins = historyStore.expiredOriginsForJar(p.id, now - p.days * 86_400_000);
    } catch (e) {
      console.error('[history]', e);
    }
    try {
      const deleted = historyStore.pruneOneJar(p.id, p.days, now);
      if (deleted > 0) broadcast('history-changed', { jarId: p.id });
    } catch (e) {
      console.error('[history]', e);
    }
    retentionSweep
      .sweepJar(container, agedOutOrigins)
      .then((result) => {
        if (result.classes.length > 0) {
          broadcast('jar-data-changed', { jarId: p.id, classes: result.classes });
        }
      })
      .catch((e) => console.error('[retention-sweep]', e));
    return { ok: true, container };
  }

  // Cookies + Other-site-data panel twins (M10 Flight 2, Leg 2 / flight DD2,
  // DD3 VERDICT). Same validation order as every handler above (malformed →
  // unknown jar → act) and the same static `jars: <op> — <code>` error-string
  // convention. Neither read twin broadcasts anything (DD2/DD10: only
  // handleClearData/handleWipe fire jar-data-changed this leg — per-item
  // deletes rely on the CALLING panel re-querying itself directly, not on an
  // invalidation broadcast).

  // handleCookiesList: NO `value` field crosses the payload (DD7 — the
  // listing needs only name/domain/expiry/flags, least-privilege). A session
  // read failure (should not happen in practice — cookies.get has no
  // documented rejection path, but session calls are never trusted not to
  // throw elsewhere in this file) is fail-soft, same shape as the mutation
  // handlers' session-failure branch.
  async function handleCookiesList(_e, p) {
    if (p === null || typeof p !== 'object') return { ok: false, error: 'jars: cookies-list — malformed-payload' };
    const entry = jars.list().find((j) => j.id === p.id);
    if (!entry) return { ok: false, error: 'jars: cookies-list — unknown-jar' };
    const ses = session.fromPartition(entry.partition);
    /** @type {any[]} */
    let raw;
    try {
      raw = await ses.cookies.get({});
    } catch (e) {
      return { ok: false, error: `jars: cookies-list — session-failure: ${String(e && e.message ? e.message : e)}` };
    }
    const cookies = raw.map((c) => ({
      name: c.name,
      domain: c.domain,
      path: c.path,
      expirationDate: c.expirationDate ?? null,
      secure: !!c.secure,
      hostOnly: !!c.hostOnly,
      session: !!c.session
    }));
    return { ok: true, cookies };
  }

  // handleCookiesRemove: payload carries the listed cookie's identity fields
  // (name/domain/path/secure — NOT value, which the list response never
  // sent) so the URL can be reconstructed the same way DD2 verified
  // (cookieUrl, spike-confirmed for both host-only and domain-attribute
  // cookies). `name` may be the empty string (an `=value`-form cookie — edge
  // case) — an explicit `typeof` check, not a truthiness check, so that case
  // is not rejected as malformed. `domain` must be present (a cookie always
  // has one on the wire, per Electron's Cookie shape); `path`/`secure` are
  // optional (cookieUrl defaults path to '/', treats a missing secure as
  // insecure/http).
  async function handleCookiesRemove(_e, p) {
    if (p === null || typeof p !== 'object') return { ok: false, error: 'jars: cookies-remove — malformed-payload' };
    const entry = jars.list().find((j) => j.id === p.id);
    if (!entry) return { ok: false, error: 'jars: cookies-remove — unknown-jar' };
    if (typeof p.name !== 'string' || typeof p.domain !== 'string') {
      return { ok: false, error: 'jars: cookies-remove — malformed-payload' };
    }
    const ses = session.fromPartition(entry.partition);
    const url = cookieUrl({ domain: p.domain, path: p.path, secure: p.secure });
    try {
      await ses.cookies.remove(url, p.name);
    } catch (e) {
      return { ok: false, error: `jars: cookies-remove — session-failure: ${String(e && e.message ? e.message : e)}` };
    }
    // M10 Flight 2, Leg 3 / DD7: a per-cookie delete removes its bookkeeping
    // row too — fail-soft, logged, never flips an otherwise-successful
    // removal to ok:false (a cleanup miss just means the next sweep's stamp
    // pass re-treats a survivor as "new", a harmless staleness). `path`
    // defaults to '/' matching cookieUrl's own default, so the identity
    // used for the delete matches whatever the listener would have stored.
    try {
      cookieSeen.deleteByIdentity(entry.id, p.name, p.domain, p.path || '/');
    } catch (e) {
      console.error('[retention-sweep]', e);
    }
    return { ok: true };
  }

  // handleCookiesValue (F3 HAT walkthrough fix-rider, operator-requested):
  // reveal a single cookie's value on demand. Same three-phase validation as
  // handleCookiesRemove (object-shape -> unknown-jar -> per-field `typeof`
  // checks on name/domain/path — NOT truthiness, so an empty-name cookie
  // stays revealable, same DD-precedent handleCookiesRemove already pins).
  // Unlike handleCookiesRemove, `path` is REQUIRED here (not defaulted) —
  // the identity must match the exact row jars-cookies-list rendered, and
  // that response always carries a `path` string.
  //
  // Fetches every cookie via `ses.cookies.get({})` (unfiltered) and matches
  // client-side on the exact {name, domain, path} triple — deliberately NOT
  // `CookiesGetFilter.domain`, which SUBDOMAIN-matches (Electron's own
  // `cookies.get` doc) and could hand back a parent-domain cookie's value
  // for a child-domain request. One-line limitation note (jar-data-helpers.js
  // habit): this identity tuple's uniqueness is contingent on Electron 42's
  // `Cookie` shape carrying no CHIPS/partitioned-cookie field — re-check this
  // assumption on any Electron version bump.
  async function handleCookiesValue(_e, p) {
    if (p === null || typeof p !== 'object') return { ok: false, error: 'jars: cookies-value — malformed-payload' };
    const entry = jars.list().find((j) => j.id === p.id);
    if (!entry) return { ok: false, error: 'jars: cookies-value — unknown-jar' };
    if (typeof p.name !== 'string' || typeof p.domain !== 'string' || typeof p.path !== 'string') {
      return { ok: false, error: 'jars: cookies-value — malformed-payload' };
    }
    const ses = session.fromPartition(entry.partition);
    /** @type {any[]} */
    let raw;
    try {
      raw = await ses.cookies.get({});
    } catch (e) {
      return { ok: false, error: `jars: cookies-value — session-failure: ${String(e && e.message ? e.message : e)}` };
    }
    const match = raw.find((c) => c.name === p.name && c.domain === p.domain && c.path === p.path);
    if (!match) return { ok: false, error: 'jars: cookies-value — not-found' };
    return { ok: true, value: match.value };
  }

  // handleSiteDataList: composite union (DD3 VERDICT) of (i) an IndexedDB-dir
  // scrape of `ses.storagePath` (a property, not a method — verified against
  // electron.d.ts at leg design) and (ii) historyStore.originsForJar. Both
  // sides degrade to empty rather than erroring: no storagePath, an absent
  // `IndexedDB/` directory (ENOENT — never wiped/never wrote any), or an
  // empty history all yield an empty list for their side, never a rejected
  // promise. An unparseable directory entry (originFromIndexedDbDirname ->
  // null) is skipped, never thrown (DD3's "defensive, degrade to unknown"
  // bar). A history-store throw is caught and logged (house convention,
  // matching handleClearData's history branch) and treated as zero visited
  // origins rather than failing the whole list.
  async function handleSiteDataList(_e, p) {
    if (p === null || typeof p !== 'object') return { ok: false, error: 'jars: sitedata-list — malformed-payload' };
    const entry = jars.list().find((j) => j.id === p.id);
    if (!entry) return { ok: false, error: 'jars: sitedata-list — unknown-jar' };
    const ses = session.fromPartition(entry.partition);

    /** @type {string[]} */
    const storedOrigins = [];
    const storagePath = ses.storagePath;
    if (storagePath) {
      const idbDir = path.join(storagePath, 'IndexedDB');
      /** @type {string[]} */
      let dirEntries = [];
      try {
        dirEntries = await fs.readdir(idbDir);
      } catch {
        // absent dir (never written) -> empty tier, not an error; dirEntries
        // already initialized to [] above.
      }
      for (const name of dirEntries) {
        const o = originFromIndexedDbDirname(name);
        if (o) storedOrigins.push(o);
      }
    }

    /** @type {string[]} */
    let visitedOrigins = [];
    try {
      visitedOrigins = historyStore.originsForJar(p.id).map((r) => r.origin);
    } catch (e) {
      console.error('[history]', e); // house convention (handleClearData precedent); visitedOrigins stays []
    }

    const origins = mergeOriginTiers(storedOrigins, visitedOrigins);
    return { ok: true, origins };
  }

  // handleSiteDataRemoveOrigin: `storages` is the storage class set MINUS
  // cookies (the site-data panel's own class, JAR_DATA_CLASSES' 'storage'
  // descriptor — reused rather than re-listed, so a future storage-class
  // addition/removal there is picked up here with no separate edit).
  async function handleSiteDataRemoveOrigin(_e, p) {
    if (p === null || typeof p !== 'object') {
      return { ok: false, error: 'jars: sitedata-remove-origin — malformed-payload' };
    }
    const entry = jars.list().find((j) => j.id === p.id);
    if (!entry) return { ok: false, error: 'jars: sitedata-remove-origin — unknown-jar' };
    if (typeof p.origin !== 'string' || p.origin.length === 0) {
      return { ok: false, error: 'jars: sitedata-remove-origin — malformed-payload' };
    }
    const ses = session.fromPartition(entry.partition);
    const storageClass = /** @type {{ storages: readonly string[] }} */ (jarDataClassById('storage'));
    try {
      await ses.clearStorageData({ origin: p.origin, storages: storageClass.storages });
    } catch (e) {
      return {
        ok: false,
        error: `jars: sitedata-remove-origin — session-failure: ${String(e && e.message ? e.message : e)}`
      };
    }
    return { ok: true };
  }

  ipcMain.handle('jars-clear-data', handleClearData);
  ipcMain.handle('jars-wipe', handleWipe);
  ipcMain.handle('jars-set-retention', handleSetRetention);
  ipcMain.handle('jars-cookies-list', handleCookiesList);
  ipcMain.handle('jars-cookies-remove', handleCookiesRemove);
  ipcMain.handle('jars-cookies-value', handleCookiesValue);
  ipcMain.handle('jars-sitedata-list', handleSiteDataList);
  ipcMain.handle('jars-sitedata-remove-origin', handleSiteDataRemoveOrigin);

  registerInternal(ipcMain, 'internal-jars-clear-data', handleClearData);
  registerInternal(ipcMain, 'internal-jars-wipe', handleWipe);
  registerInternal(ipcMain, 'internal-jars-set-retention', handleSetRetention);
  registerInternal(ipcMain, 'internal-jars-cookies-list', handleCookiesList);
  registerInternal(ipcMain, 'internal-jars-cookies-remove', handleCookiesRemove);
  registerInternal(ipcMain, 'internal-jars-cookies-value', handleCookiesValue);
  registerInternal(ipcMain, 'internal-jars-sitedata-list', handleSiteDataList);
  registerInternal(ipcMain, 'internal-jars-sitedata-remove-origin', handleSiteDataRemoveOrigin);
}

module.exports = { registerJarDataIpc };
