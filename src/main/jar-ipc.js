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
// `rerollSeed`, `revokeJarKey`, `settings`, `broadcast`) is injected at
// registerJarIpc(deps), so the whole surface is unit-testable without Electron
// (the init-profile / downloads-manager / menu-overlay-manager extraction
// precedent — and it keeps the fourteen handlers out of the main.js god file).

const { BURNER } = require('../shared/burner');
const { jarDataClassById } = require('../shared/jar-data-classes');
const { registerInternalHandler } = require('./internal-ipc');

/**
 * Register the six jar-registry IPC channels plus the two per-jar data-control
 * channels (Flight 4, Leg 1 — clear-data/wipe) and return the jars-changed
 * broadcaster (main.js reuses it in the picker's `new-container-create` — the
 * second add entry point, whose renderer-tangled flow stays in main.js).
 *
 * @param {{
 *   ipcMain: { handle: (channel: string, fn: (event: any, payload?: any) => any) => void },
 *   jars: typeof import('./jars'),
 *   session: { fromPartition: (partition: string) => any },
 *   rerollSeed: (ses: any) => void,
 *   revokeJarKey: (jarId: string, settings: any) => void,
 *   settings: { get: (k: string) => any, set: (k: string, v: any) => any, getAll: () => any },
 *   broadcast: (channel: string, payload: unknown) => void
 * }} deps
 */
function registerJarIpc({ ipcMain, jars, session, rerollSeed, revokeJarKey, settings, broadcast }) {
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

  // Delete composition (DD6). Order: remove → wipe → reroll → revoke →
  // settings-changed → jars-changed. Only the wipe is fail-soft (registry
  // removal already happened — matching identity-new's error containment);
  // reroll/revoke/broadcasts run regardless.
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
      await ses.clearStorageData();
      await ses.clearCache();
    } catch {
      wiped = false;
    }
    // Fresh persona if the slug is ever re-created (session objects are
    // per-partition-string for the app's lifetime).
    rerollSeed(ses);
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
  async function handleClearData(_e, p) {
    if (p === null || typeof p !== 'object') return { ok: false };
    const entry = jars.list().find((j) => j.id === p.id);
    if (!entry) return { ok: false };
    if (!Array.isArray(p.classes) || p.classes.length === 0) return { ok: false };
    const descriptors = [];
    for (const classId of p.classes) {
      const d = jarDataClassById(classId);
      if (!d) return { ok: false };
      descriptors.push(d);
    }
    const ses = session.fromPartition(entry.partition);
    try {
      for (const d of descriptors) {
        if (d.storages) {
          await ses.clearStorageData({ storages: d.storages });
        } else {
          // cache sentinel (DD2): clearCache() has no storages-set form, so it
          // pairs with a shadercache-only clearStorageData call.
          await ses.clearCache();
          await ses.clearStorageData({ storages: ['shadercache'] });
        }
      }
    } catch {
      // Fail-soft (matching the delete path's session-call containment stance):
      // a thrown session call returns { ok: false } with no partial-success shape.
      return { ok: false };
    }
    return { ok: true, cleared: descriptors.map((d) => d.id) };
  }

  // handleWipe: the full identity wipe — same composition as identity-new
  // (main.js:2461, `clearStorageData()` + `clearCache()` + `rerollSeed`) plus the
  // `jar-wiped` broadcast (DD4), minus registry removal and automation-key
  // revoke (the jar persists; its automation key stays valid — DD3). The
  // broadcast fires BEFORE resolving (house broadcast-before-resolve rule) and
  // ONLY on the success path — a thrown session call returns { ok: false, error }
  // with no broadcast and no reroll (nothing was wiped; no reload should fire).
  async function handleWipe(_e, p) {
    if (p === null || typeof p !== 'object') return { ok: false };
    const entry = jars.list().find((j) => j.id === p.id);
    if (!entry) return { ok: false };
    const ses = session.fromPartition(entry.partition);
    try {
      await ses.clearStorageData();
      await ses.clearCache();
    } catch (e) {
      return { ok: false, error: String(e && e.message ? e.message : e) };
    }
    rerollSeed(ses);
    broadcast('jar-wiped', { id: entry.id });
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

  return { broadcastJarsChanged };
}

module.exports = { registerJarIpc };
