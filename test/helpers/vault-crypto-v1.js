'use strict';

// vault-crypto with the version-1 call arguments filled in (leg `vault-binding`, AC4).
// vault-crypto no longer defaults a version or a vault id; the many direct crypto tests
// were written when it did. This wrapper supplies version 1 and one fixed test vault id
// to every call that omits them, and passes everything else through untouched, so the
// assertions in those tests stand exactly as written. Tests of the new explicit
// behaviour use the raw module (`.raw`).

const raw = require('../../src/main/vault/vault-crypto');

const TEST_VAULT_ID = 'test-vault';

module.exports = {
  ...raw,
  raw,
  TEST_VAULT_ID,
  encryptItems: (payload, key, version = 1, vaultId = TEST_VAULT_ID) =>
    raw.encryptItems(payload, key, version, vaultId),
  decryptItems: (blob, key, version = 1, vaultId = TEST_VAULT_ID) => raw.decryptItems(blob, key, version, vaultId),
  serializeVault: (obj, opts = {}) => raw.serializeVault(obj, { version: 1, ...opts }),
  wrapMaster: (key, pw, opts = {}) => raw.wrapMaster(key, pw, { version: 1, ...opts }),
  unwrapMaster: (env, pw, opts = {}) => raw.unwrapMaster(env, pw, { version: 1, ...opts }),
  wrapRecovery: (key, material, opts = {}) => raw.wrapRecovery(key, material, { version: 1, ...opts }),
  unwrapRecovery: (env, material, opts = {}) => raw.unwrapRecovery(env, material, { version: 1, ...opts }),
  sealToAdmin: (key, pub, opts = {}) => raw.sealToAdmin(key, pub, { version: 1, ...opts }),
  openAdminSeal: (env, priv, opts = {}) => raw.openAdminSeal(env, priv, { version: 1, ...opts })
};
