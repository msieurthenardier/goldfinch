'use strict';

// Unit tests for src/main/vault/vault-sheet-errors.js (M18 F3 L1, DD9) — the extracted
// error-class -> reason mapper every one of main.js's eight vault sheet delegates
// routes its catch through. Pins: every mapped class per delegate config, the exact
// result SHAPE (`false` vs `{ok:false}` vs `{ok:false, reason}`), an unmapped/unknown
// class returning `null` (caller rethrows), and that a class absent from a delegate's
// config is genuinely NOT admitted there (the deliberate per-delegate width from
// squawk-0058 — e.g. vaultRotateRecovery never admits VaultStateError).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  mapVaultSheetError,
  VAULT_IMPORT_PREVIEW_CONFIG,
  VAULT_RESTORE_COMMIT_CONFIG,
  VAULT_UNLOCK_CONFIG,
  VAULT_MINT_ACCESS_KEY_CONFIG,
  VAULT_COMPROMISE_ROTATE_CONFIG,
  VAULT_ROTATE_RECOVERY_CONFIG,
  VAULT_ROTATE_ADMIN_KEY_CONFIG,
  VAULT_CHANGE_MASTER_CONFIG,
  VAULT_RECOVER_CONFIG
} = require('../../src/main/vault/vault-sheet-errors');
const vs = require('../../src/main/vault/vault-store');

class UnknownError extends Error {}

test('VAULT_UNLOCK_CONFIG: VaultAuthError maps to the bare boolean false (the one bare-boolean delegate)', () => {
  const mapped = mapVaultSheetError(new vs.VaultAuthError('wrong password'), VAULT_UNLOCK_CONFIG);
  assert.equal(mapped, false);
});

test('VAULT_UNLOCK_CONFIG: an unmapped class returns null (caller rethrows)', () => {
  assert.equal(mapVaultSheetError(new UnknownError('boom'), VAULT_UNLOCK_CONFIG), null);
  assert.equal(mapVaultSheetError(new vs.VaultBusyError('busy'), VAULT_UNLOCK_CONFIG), null, 'busy is not admitted');
});

// RENAMED from VAULT_IMPORT_CONFIG (M18 F3 Leg 3 / DD2 ruling 10): the secret step no
// longer resolves a destination, so it can no longer throw a coded VaultCollisionError
// — that check moved to the commit step (VAULT_RESTORE_COMMIT_CONFIG below), where a
// destination collision is a per-vault OUTCOME in the reply, never a thrown error.
test('VAULT_IMPORT_PREVIEW_CONFIG: auth -> bare {ok:false}; format/busy/state carry reasons; collision NOT admitted (moved to commit)', () => {
  assert.deepEqual(mapVaultSheetError(new vs.VaultAuthError('x'), VAULT_IMPORT_PREVIEW_CONFIG), { ok: false });
  assert.deepEqual(mapVaultSheetError(new vs.VaultFormatError('x'), VAULT_IMPORT_PREVIEW_CONFIG), {
    ok: false,
    reason: 'format'
  });
  assert.deepEqual(mapVaultSheetError(new vs.VaultBusyError('x'), VAULT_IMPORT_PREVIEW_CONFIG), {
    ok: false,
    reason: 'busy'
  });
  assert.deepEqual(mapVaultSheetError(new vs.VaultStateError('x'), VAULT_IMPORT_PREVIEW_CONFIG), {
    ok: false,
    reason: 'state'
  });
  // VaultCollisionError EXTENDS VaultStateError (module header note) — the preview
  // structurally can never THROW one (it never resolves a destination), but the config
  // no longer names 'collision' as its own key at all; were one ever caught here it
  // would fall through to the admitted VaultStateError check, same as any other state error.
  assert.deepEqual(mapVaultSheetError(new vs.VaultCollisionError('x'), VAULT_IMPORT_PREVIEW_CONFIG), {
    ok: false,
    reason: 'state'
  });
});

test('VAULT_RESTORE_COMMIT_CONFIG: busy + state carry reasons; auth is NOT admitted (the secret was already verified at preview)', () => {
  assert.deepEqual(mapVaultSheetError(new vs.VaultBusyError('x'), VAULT_RESTORE_COMMIT_CONFIG), {
    ok: false,
    reason: 'busy'
  });
  assert.deepEqual(mapVaultSheetError(new vs.VaultStateError('x'), VAULT_RESTORE_COMMIT_CONFIG), {
    ok: false,
    reason: 'state'
  });
  assert.equal(
    mapVaultSheetError(new vs.VaultAuthError('x'), VAULT_RESTORE_COMMIT_CONFIG),
    null,
    'auth is never a ruled commit outcome — the same held secret re-derives the identical unwrap'
  );
});

test('VAULT_MINT_ACCESS_KEY_CONFIG: auth bare, state + busy carry reasons', () => {
  assert.deepEqual(mapVaultSheetError(new vs.VaultAuthError('x'), VAULT_MINT_ACCESS_KEY_CONFIG), { ok: false });
  assert.deepEqual(mapVaultSheetError(new vs.VaultStateError('x'), VAULT_MINT_ACCESS_KEY_CONFIG), {
    ok: false,
    reason: 'state'
  });
  assert.deepEqual(mapVaultSheetError(new vs.VaultBusyError('x'), VAULT_MINT_ACCESS_KEY_CONFIG), {
    ok: false,
    reason: 'busy'
  });
  assert.equal(
    mapVaultSheetError(new vs.VaultFormatError('x'), VAULT_MINT_ACCESS_KEY_CONFIG),
    null,
    'format not admitted here'
  );
});

test('VAULT_COMPROMISE_ROTATE_CONFIG: the widest config — five reasons, auth carries a reason (unlike the bare-shape siblings)', () => {
  assert.deepEqual(mapVaultSheetError(new vs.VaultPasswordReuseError('x'), VAULT_COMPROMISE_ROTATE_CONFIG), {
    ok: false,
    reason: 'reuse'
  });
  assert.deepEqual(mapVaultSheetError(new vs.VaultAuthError('x'), VAULT_COMPROMISE_ROTATE_CONFIG), {
    ok: false,
    reason: 'auth'
  });
  assert.deepEqual(mapVaultSheetError(new vs.VaultFormatError('x'), VAULT_COMPROMISE_ROTATE_CONFIG), {
    ok: false,
    reason: 'format'
  });
  assert.deepEqual(mapVaultSheetError(new vs.VaultBusyError('x'), VAULT_COMPROMISE_ROTATE_CONFIG), {
    ok: false,
    reason: 'busy'
  });
  assert.deepEqual(mapVaultSheetError(new vs.VaultStateError('x'), VAULT_COMPROMISE_ROTATE_CONFIG), {
    ok: false,
    reason: 'state'
  });
});

test('VAULT_ROTATE_RECOVERY_CONFIG: auth bare, busy carries a reason; state is NOT admitted (deliberately narrower width)', () => {
  assert.deepEqual(mapVaultSheetError(new vs.VaultAuthError('x'), VAULT_ROTATE_RECOVERY_CONFIG), { ok: false });
  assert.deepEqual(mapVaultSheetError(new vs.VaultBusyError('x'), VAULT_ROTATE_RECOVERY_CONFIG), {
    ok: false,
    reason: 'busy'
  });
  assert.equal(
    mapVaultSheetError(new vs.VaultStateError('x'), VAULT_ROTATE_RECOVERY_CONFIG),
    null,
    'a VaultStateError here must still propagate — never a ruled outcome for this delegate'
  );
});

test('VAULT_ROTATE_ADMIN_KEY_CONFIG: same shape as VAULT_ROTATE_RECOVERY_CONFIG, kept as an independently-editable config', () => {
  assert.deepEqual(mapVaultSheetError(new vs.VaultAuthError('x'), VAULT_ROTATE_ADMIN_KEY_CONFIG), { ok: false });
  assert.deepEqual(mapVaultSheetError(new vs.VaultBusyError('x'), VAULT_ROTATE_ADMIN_KEY_CONFIG), {
    ok: false,
    reason: 'busy'
  });
  assert.equal(mapVaultSheetError(new vs.VaultStateError('x'), VAULT_ROTATE_ADMIN_KEY_CONFIG), null);
});

test('VAULT_CHANGE_MASTER_CONFIG: auth bare, busy carries a reason', () => {
  assert.deepEqual(mapVaultSheetError(new vs.VaultAuthError('x'), VAULT_CHANGE_MASTER_CONFIG), { ok: false });
  assert.deepEqual(mapVaultSheetError(new vs.VaultBusyError('x'), VAULT_CHANGE_MASTER_CONFIG), {
    ok: false,
    reason: 'busy'
  });
  assert.equal(mapVaultSheetError(new vs.VaultStateError('x'), VAULT_CHANGE_MASTER_CONFIG), null);
});

test('VAULT_RECOVER_CONFIG: auth bare, format + busy carry reasons', () => {
  assert.deepEqual(mapVaultSheetError(new vs.VaultAuthError('x'), VAULT_RECOVER_CONFIG), { ok: false });
  assert.deepEqual(mapVaultSheetError(new vs.VaultFormatError('x'), VAULT_RECOVER_CONFIG), {
    ok: false,
    reason: 'format'
  });
  assert.deepEqual(mapVaultSheetError(new vs.VaultBusyError('x'), VAULT_RECOVER_CONFIG), {
    ok: false,
    reason: 'busy'
  });
  assert.equal(mapVaultSheetError(new vs.VaultStateError('x'), VAULT_RECOVER_CONFIG), null);
});

test('a genuinely unknown error class returns null for EVERY config (caller must rethrow)', () => {
  const e = new UnknownError('boom');
  for (const config of [
    VAULT_IMPORT_PREVIEW_CONFIG,
    VAULT_RESTORE_COMMIT_CONFIG,
    VAULT_UNLOCK_CONFIG,
    VAULT_MINT_ACCESS_KEY_CONFIG,
    VAULT_COMPROMISE_ROTATE_CONFIG,
    VAULT_ROTATE_RECOVERY_CONFIG,
    VAULT_ROTATE_ADMIN_KEY_CONFIG,
    VAULT_CHANGE_MASTER_CONFIG,
    VAULT_RECOVER_CONFIG
  ]) {
    assert.equal(mapVaultSheetError(e, config), null);
  }
});

test('VaultCollisionError extends VaultStateError — a config admitting only "state" still catches a collision (matches the pre-extraction ladder behavior)', () => {
  // None of the eight delegates actually admit both 'state' and 'collision' (see the
  // module header), but VAULT_MINT_ACCESS_KEY_CONFIG admits 'state' alone, and a
  // VaultCollisionError IS a VaultStateError — pin that this is not accidentally
  // excluded by the subclass relationship.
  assert.deepEqual(mapVaultSheetError(new vs.VaultCollisionError('x'), VAULT_MINT_ACCESS_KEY_CONFIG), {
    ok: false,
    reason: 'state'
  });
});
