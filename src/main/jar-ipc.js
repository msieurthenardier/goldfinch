'use strict';

// IPC surface for the v2 jar lifecycle (M06 Flight 1 Leg 3 / DD6, DD7, CP3).
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
// precedent — and it keeps the twelve handlers out of the main.js god file).

const { BURNER } = require('../shared/burner');
const { registerInternalHandler } = require('./internal-ipc');

/**
 * Register the six jar-registry IPC channels and return the jars-changed
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

  // Chrome-trusted channels (unchanged trust domain — DD7).
  ipcMain.handle('jars-list', handleList);
  ipcMain.handle('jars-add', handleAdd);
  ipcMain.handle('jars-rename', handleRename);
  ipcMain.handle('jars-set-default', handleSetDefault);
  ipcMain.handle('jars-get-default', handleGetDefault);
  ipcMain.handle('jars-remove', handleRemove);

  // Internal-origin-gated twins (F3 DD1) — same handler bodies, reached only by
  // an allowlisted goldfinch:// internal page (the jars management page).
  registerInternalHandler(ipcMain, 'internal-jars-list', handleList);
  registerInternalHandler(ipcMain, 'internal-jars-add', handleAdd);
  registerInternalHandler(ipcMain, 'internal-jars-rename', handleRename);
  registerInternalHandler(ipcMain, 'internal-jars-set-default', handleSetDefault);
  registerInternalHandler(ipcMain, 'internal-jars-get-default', handleGetDefault);
  registerInternalHandler(ipcMain, 'internal-jars-remove', handleRemove);

  return { broadcastJarsChanged };
}

module.exports = { registerJarIpc };
