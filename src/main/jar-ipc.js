'use strict';

// IPC surface for the v2 jar lifecycle (M06 Flight 1 Leg 3 / DD6, DD7, CP3) plus
// the per-jar data controls (M06 Flight 4, Leg 1 / DD2, DD3, DD4).
//
// The store (jars.js) stays PURE — it only mutates and persists the registry.
// Session side-effects live here, in the handler layer (DD6): delete composes
// jars.remove() → partition wipe → seed reroll → automation-key revoke →
// settings-changed broadcast → jars-changed broadcast. After EVERY successful
// mutation (add / rename / remove / setDefault) a `jars-changed` event carrying
// { containers, defaultId } is broadcast to the chrome renderer + every
// internal-session webContents (the injected `broadcast` is main.js's
// broadcastToChromeAndInternal — the same mechanism as shields-changed /
// settings-changed). Nothing subscribes until Flight 2; fire-and-forget by design.
//
// Flight 4 adds `jars-clear-data` (granular class clears, DD2/DD3) and
// `jars-wipe` (the full identity wipe — data + fingerprint reroll, DD3/DD4);
// wipe broadcasts `jar-wiped { id }` so the chrome renderer can reload the jar's
// open tabs (leg 3 owns the listener/sweep). Neither channel mutates the jar
// registry or broadcasts settings-changed/jars-changed — they act only on the
// jar's session partition.
//
// Trust domain (DD7 / F3 DD1): the chrome channels (bare `ipcMain.handle`, same
// domain as the picker's `new-container-create`) and the internal-origin-gated
// `internal-jars-*` variants (registerInternalHandler, for the goldfinch://jars
// management page — Flight 3) are BOTH registered here, each pair sharing the
// exact same handler function body (extracted below) so behavior can never drift
// between the two trust domains. `registerInternalHandler` is self-contained —
// it bakes `isTrustedInternalSender` internally and is Electron-free
// (internal-ipc.js) — so this module requires `./internal-ipc` directly (like
// the existing `../shared/burner` require) and reuses the already-injected
// `ipcMain`; no deps-object change.
//
// This module is ELECTRON-FREE: every live handle (`ipcMain`, `session`,
// `rerollSeed`, `revokeJarKey`, `settings`, `broadcast`, `historyStore`) is
// injected at registerJarIpc(deps), so the whole surface is unit-testable
// without Electron (the init-profile / downloads-manager / menu-overlay-manager
// extraction precedent — and it keeps the fourteen-plus handlers out of the
// main.js god file).
//
// M08 Flight 3, Leg 1 adds the `history` data class (DD1: discriminator-first
// dispatch inside handleClearData — see the `custom` check below), history
// purge on wipe/remove via the extracted `wipeJarData` helper (DD2), and the
// `jars-set-retention` / `internal-jars-set-retention` twins (DD4).
//
// M10 Flight 2, Leg 2 adds the Cookies + Other-site-data panel twins
// (`jars-cookies-*` / `jars-sitedata-*`, DD2/DD3 VERDICT) and the DD10
// `jar-data-changed { jarId, classes }` invalidation broadcast.
//
// M10 Flight 2, Leg 3 generalizes retention to cookies + site data (DD4
// VERDICT, DD4b, DD6, DD7, DD10): `handleSetRetention` gains the immediate
// one-jar sweep (SEQUENCING-ordered — snapshot aged-out origins BEFORE
// `pruneOneJar`, see the handler's own doc comment), every destructive jar
// path (`wipeJarData`, the cookies class of `handleClearData`,
// `handleCookiesRemove`) clears the jar's `cookie_seen` bookkeeping
// (DD7 lifecycle), and the sweep's per-jar result feeds the DD10 broadcast
// with the actually-swept class subset. The sweep engine
// (`./retention-sweep`) and its `cookie_seen` bookkeeping store
// (`./app-db`'s `createCookieSeenStore`) are BOTH Electron-free and
// required directly (the `./internal-ipc` precedent above) rather than
// threaded through this module's deps — `app-db.js` is a module singleton,
// so this module's `cookieSeen` instance and main.js's `session-created`
// cookies-listener instance both resolve against the SAME live table.

const fs = require('fs/promises');
const path = require('path');
const { BURNER } = require('../shared/burner');
const { jarDataClassById } = require('../shared/jar-data-classes');
const { registerInternalHandler } = require('./internal-ipc');
const { cookieUrl, originFromIndexedDbDirname, mergeOriginTiers } = require('./jar-data-helpers');
// app-db.js and retention-sweep.js are BOTH Electron-free (like internal-ipc
// above) — required directly rather than threaded through registerJarIpc's
// deps object (the internal-ipc precedent this module's own header comment
// names). appDb is the SAME module-singleton main.js's cookies listener
// requires, so both writers share one `cookie_seen` table (M10 Flight 2,
// Leg 3 / DD4 VERDICT, DD7).
const appDb = require('./app-db');
const { createRetentionSweep } = require('./retention-sweep');

/**
 * Register the jar-registry IPC channels plus the per-jar data-control
 * channels (Flight 4, Leg 1 — clear-data/wipe; Flight 3 Leg 1 — set-retention)
 * and return the jars-changed broadcaster (main.js reuses it in the picker's
 * `new-container-create` — the second add entry point, whose renderer-tangled
 * flow stays in main.js).
 *
 * @param {{
 *   ipcMain: { handle: (channel: string, fn: (event: any, payload?: any) => any) => void },
 *   jars: typeof import('./jars'),
 *   session: { fromPartition: (partition: string) => any },
 *   rerollSeed: (ses: any) => void,
 *   revokeJarKey: (jarId: string, settings: any) => void,
 *   settings: { get: (k: string) => any, set: (k: string, v: any) => any, getAll: () => any },
 *   broadcast: (channel: string, payload: unknown) => void,
 *   historyStore: typeof import('./history-store')
 * }} deps
 */
function registerJarIpc({ ipcMain, jars, session, rerollSeed, revokeJarKey, settings, broadcast, historyStore }) {
  // Retention sweep engine (M10 Flight 2, Leg 3 / DD4 VERDICT, DD4b, DD6,
  // DD10) — built ONCE per registerJarIpc call, wired to THIS module's own
  // injected `session`/`historyStore` and app-db.js's module-singleton
  // cookie_seen table (main.js's cookies listener writes the SAME table
  // through its own createCookieSeenStore() instance — both resolve
  // against the one live sqlite handle regardless of instance identity).
  const cookieSeen = appDb.createCookieSeenStore();
  const retentionSweep = createRetentionSweep({
    cookieSeen,
    historyOrigins: (jarId, cutoffMs) => historyStore.expiredOriginsForJar(jarId, cutoffMs),
    sessionFor: (jar) => session.fromPartition(jar.partition),
    cookieUrl,
    now: () => Date.now()
  });

  // `defaultId` derivation: getDefault() returns the module's own frozen BURNER
  // object (same reference) when the store is empty, so reference identity is
  // exact — null ⇔ Burner is the default. The containers array is jars.list()'s
  // live array; the real IPC boundary structured-clones it per send.
  function broadcastJarsChanged() {
    const d = jars.getDefault();
    broadcast('jars-changed', { containers: jars.list(), defaultId: d === BURNER ? null : d.id });
  }

  // Payload guard, shared shape: renderer payloads are untrusted input — a
  // missing/undefined/primitive payload must return the channel's failure value,
  // never throw. The explicit object check runs BEFORE any `'in'` access (the
  // `in` operator throws on primitives, so a bare `if (!p)` doesn't cover
  // 'x' / 42).

  // Handler bodies (F3 DD1): each is registered TWICE below — once bare on the
  // chrome-trusted channel, once through registerInternalHandler on the
  // internal-origin-gated `internal-jars-*` twin. Extract, don't fork: a
  // behavior fix here fixes both trust domains at once.

  function handleList() {
    return jars.list();
  }

  function handleAdd(_e, p) {
    if (p === null || typeof p !== 'object') return null;
    // Mirror new-container-create's name guard (main.js) so the two add entry
    // points agree: {} or { name: 42 } → null, never a jar named "undefined".
    if (!p.name || typeof p.name !== 'string') return null;
    const container = jars.add(p.name, p.color);
    broadcastJarsChanged();
    return container;
  }

  function handleRename(_e, p) {
    if (p === null || typeof p !== 'object') return null;
    // Build the patch from ONLY the fields present in the payload: an absent
    // field must stay absent so the store preserves it (rename treats undefined
    // as "not provided", so an explicit { name: undefined } can't clobber either).
    const patch = {};
    if ('name' in p) patch.name = p.name;
    if ('color' in p) patch.color = p.color;
    const container = jars.rename(p.id, patch);
    if (container) broadcastJarsChanged();
    return container;
  }

  function handleSetDefault(_e, p) {
    if (p === null || typeof p !== 'object') return false;
    // setDefault(currentHolder) returns true (idempotent success, Leg 1
    // contract), so a no-op change re-broadcasts — deliberate, harmless.
    const ok = jars.setDefault(p.id);
    if (ok) broadcastJarsChanged();
    return ok;
  }

  function handleGetDefault() {
    return jars.getDefault();
  }

  // Delete composition (DD6). Order: remove → wipe (incl. history purge) →
  // revoke → settings-changed → jars-changed. Only the wipe is fail-soft
  // (registry removal already happened — matching identity-new's error
  // containment); revoke/broadcasts run regardless. `handleRemove` emits no
  // history broadcast — the section leaves the DOM entirely (flight DD2).
  async function handleRemove(_e, p) {
    if (p === null || typeof p !== 'object') return { ok: false };
    const removed = jars.remove(p.id);
    if (!removed) return { ok: false };
    // Wipe the removed jar's partition. fromPartition on an already-cold
    // partition creates the session just to wipe it — harmless (empty wipe)
    // and unavoidable without tracking liveness.
    const ses = session.fromPartition(removed.partition);
    let wiped = true;
    try {
      await wipeJarData(ses, removed.id);
    } catch {
      wiped = false;
    }
    // Idempotent, hash-only (no-op when the jar had no automation key). The
    // settings-changed broadcast is unconditional — matching the mint path's
    // unconditional broadcast — so an open settings page never shows a stale
    // key list (the revoke IPC path today doesn't broadcast; this delete path
    // closes that gap).
    revokeJarKey(removed.id, settings);
    broadcast('settings-changed', settings.getAll());
    broadcastJarsChanged();
    return { ok: true, removed, wiped };
  }

  // wipeJarData(ses, jarId): the clearStorageData + clearCache + rerollSeed
  // composition, now also purging the jar's history — extracted here honoring
  // the M06 F4 DD3 "revisit at the next copy" trigger's INTENT (this
  // composition already appeared three times pre-flight — handleRemove,
  // handleWipe, and main.js's identity-new — and this flight's new purge
  // concern is what tips the extraction; main.js's identity-new copy stays
  // separate per flight DD3, and deliberately does NOT purge history).
  // Failure isolation (design review, pinned shape): the SESSION calls
  // (clearStorageData/clearCache) and rerollSeed stay UN-CAUGHT here — they
  // propagate to the caller's OWN existing try/catch around the wipeJarData()
  // call, preserving handleRemove's fail-soft `wiped=false` continuation and
  // handleWipe's fail-hard return exactly (a session throw skips rerollSeed
  // AND the purge below — nothing was wiped, so neither should run). ONLY the
  // `historyStore.clearJar(jarId)` line gets its own inner try/catch:
  // fail-soft, logged (`console.error('[history]', …)`), never flips the
  // caller's `ok`. It runs AFTER the session calls / reroll (session wipe
  // first, purge second — flight DD2). M10 Flight 2, Leg 3 / DD7: the jar's
  // cookie_seen bookkeeping rows die with it too — same fail-soft shape,
  // run alongside the history purge (order between the two purges is
  // immaterial; both are metadata cleanup after the session data is
  // already gone).
  // @param {any} ses
  // @param {string} jarId
  // @returns {Promise<number>} purged-row count (0 on purge failure)
  async function wipeJarData(ses, jarId) {
    await ses.clearStorageData();
    await ses.clearCache();
    // Fresh persona if the slug is ever re-created (session objects are
    // per-partition-string for the app's lifetime).
    rerollSeed(ses);
    let purged = 0;
    try {
      purged = historyStore.clearJar(jarId);
    } catch (e) {
      console.error('[history]', e);
    }
    try {
      cookieSeen.deleteByJar(jarId);
    } catch (e) {
      console.error('[retention-sweep]', e);
    }
    return purged;
  }

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

  // Chrome-trusted channels (unchanged trust domain — DD7).
  ipcMain.handle('jars-list', handleList);
  ipcMain.handle('jars-add', handleAdd);
  ipcMain.handle('jars-rename', handleRename);
  ipcMain.handle('jars-set-default', handleSetDefault);
  ipcMain.handle('jars-get-default', handleGetDefault);
  ipcMain.handle('jars-remove', handleRemove);
  ipcMain.handle('jars-clear-data', handleClearData);
  ipcMain.handle('jars-wipe', handleWipe);
  ipcMain.handle('jars-set-retention', handleSetRetention);
  ipcMain.handle('jars-cookies-list', handleCookiesList);
  ipcMain.handle('jars-cookies-remove', handleCookiesRemove);
  ipcMain.handle('jars-sitedata-list', handleSiteDataList);
  ipcMain.handle('jars-sitedata-remove-origin', handleSiteDataRemoveOrigin);

  // Internal-origin-gated twins (F3 DD1) — same handler bodies, reached only by
  // an allowlisted goldfinch:// internal page (the jars management page).
  registerInternalHandler(ipcMain, 'internal-jars-list', handleList);
  registerInternalHandler(ipcMain, 'internal-jars-add', handleAdd);
  registerInternalHandler(ipcMain, 'internal-jars-rename', handleRename);
  registerInternalHandler(ipcMain, 'internal-jars-set-default', handleSetDefault);
  registerInternalHandler(ipcMain, 'internal-jars-get-default', handleGetDefault);
  registerInternalHandler(ipcMain, 'internal-jars-remove', handleRemove);
  registerInternalHandler(ipcMain, 'internal-jars-clear-data', handleClearData);
  registerInternalHandler(ipcMain, 'internal-jars-wipe', handleWipe);
  registerInternalHandler(ipcMain, 'internal-jars-set-retention', handleSetRetention);
  registerInternalHandler(ipcMain, 'internal-jars-cookies-list', handleCookiesList);
  registerInternalHandler(ipcMain, 'internal-jars-cookies-remove', handleCookiesRemove);
  registerInternalHandler(ipcMain, 'internal-jars-sitedata-list', handleSiteDataList);
  registerInternalHandler(ipcMain, 'internal-jars-sitedata-remove-origin', handleSiteDataRemoveOrigin);

  return { broadcastJarsChanged };
}

module.exports = { registerJarIpc };
