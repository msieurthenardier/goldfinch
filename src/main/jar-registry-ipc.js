'use strict';

// Registry/default IPC domain. Chrome and guarded-internal twins are always
// registered from the same named handler object.

const { registerInternalHandler } = require('./internal-ipc');

function registerJarRegistryIpc({
  ipcMain,
  registerInternal = registerInternalHandler,
  jars,
  session,
  wipeJarData,
  revokeJarKey,
  settings,
  broadcast,
  broadcastJarsChanged,
  // M12 F4 Leg 6 (DD7): accessor for the memoized vault-store singleton (mirrors
  // register-vault-ipc's getVaultStore injection). handleRemove removes the deleted
  // jar's `.gfvault` fail-soft. GATED — offline tests that omit it skip the step
  // (the existing injection-gated precedent).
  getVaultStore
}) {
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

  // Delete composition (DD6 + M12 F4 Leg 6 / DD7). Order: remove → wipe (incl.
  // history purge) → revoke → deleteVault → settings-changed → jars-changed. The
  // wipe AND the vault removal are fail-soft (registry removal already happened —
  // matching identity-new's error containment); revoke/broadcasts run regardless.
  // `handleRemove` emits no history broadcast — the section leaves the DOM entirely
  // (flight DD2).
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
    // Remove the deleted jar's `.gfvault` (M12 F4 Leg 6 / DD7). FAIL-SOFT, exactly
    // like the wipe containment above: the registry entry is already gone, so a
    // vault-unlink failure (permissions, races) sets vaultRemoved:false but NEVER
    // fails the jar delete — revoke/broadcasts run regardless. The store op is
    // ENOENT-tolerant (a no-vault jar → deleted:false, the common case), guards the
    // GLOBAL vault internally, and there is NO manager row to prune. Gated on the
    // injection (offline tests omit getVaultStore → the step is skipped).
    let vaultRemoved = false;
    if (getVaultStore) {
      try {
        vaultRemoved = getVaultStore().deleteVault(removed.id).deleted;
      } catch {
        vaultRemoved = false;
      }
    }
    broadcast('settings-changed', settings.getAll());
    broadcastJarsChanged();
    return { ok: true, removed, wiped, vaultRemoved };
  }

  ipcMain.handle('jars-list', handleList);
  ipcMain.handle('jars-add', handleAdd);
  ipcMain.handle('jars-rename', handleRename);
  ipcMain.handle('jars-set-default', handleSetDefault);
  ipcMain.handle('jars-get-default', handleGetDefault);
  ipcMain.handle('jars-remove', handleRemove);

  registerInternal(ipcMain, 'internal-jars-list', handleList);
  registerInternal(ipcMain, 'internal-jars-add', handleAdd);
  registerInternal(ipcMain, 'internal-jars-rename', handleRename);
  registerInternal(ipcMain, 'internal-jars-set-default', handleSetDefault);
  registerInternal(ipcMain, 'internal-jars-get-default', handleGetDefault);
  registerInternal(ipcMain, 'internal-jars-remove', handleRemove);
}

module.exports = { registerJarRegistryIpc };
