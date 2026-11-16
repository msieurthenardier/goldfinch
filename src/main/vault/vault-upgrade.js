// @ts-check
'use strict';

// The version-1 -> version-2 vault file upgrade, PURE half (Mission 23 Flight 2, leg `vault-upgrade`,
// flight DD6). No I/O, no clock, no logging, no `await`: bytes in, documents out. The store owns the
// guarded caller (`vault-store.js` `_upgradeVaultFiles`), the journal and the three verifications'
// ids. This module owns what a rebuilt document IS and the ONE check that decides whether one is
// right (`verifyDocument`), which the store runs three times with the vault id taken from three
// different places.
//
// REBUILD, per version-1 file: unwrap the vault key under the master key (version-1 AAD), decrypt the
// items, re-wrap the key and re-encrypt the items under the version-2 AADs for the BIND id, and carry
// every access envelope VERBATIM and IN ORDER (their AAD pins version 1 for good: only the holder of
// the access secret could re-wrap one). The informational `kdf` is kept. Working key buffers are
// zeroized in a `finally`; `_vaultKeyFromDoc` (which caches keys) is never used.

const { isDeepStrictEqual } = require('node:util');

const vc = require('./vault-crypto');

/**
 * @typedef {{ id: string, bindId: string, bytes: Buffer }} UpgradeInput
 *   `id` is the slot (registry) id the file was found under; `bindId` is the id the rebuilt file is bound to
 *   (the caller chooses it; it is the slot id unless a test injects otherwise).
 * @typedef {{ id: string, bindId: string, json: Buffer, original: Buffer, items: any, envelopes: any[] }} UpgradedVault
 *   `json` the rebuilt version-2 bytes; `original` the version-1 bytes (ciphertext only); `items` the plaintext
 *   items for equality checks; `envelopes` the SOURCE envelope list (for the verbatim-carry check).
 * @typedef {'current'|'format'|'no-mrk-envelope'|'wrong-key'|'items-unreadable'|'unexpected'} SkipReason
 */

/**
 * Rebuild every version-1 file in `vaults` as version 2. Per-file `try`, no early return in the loop: one bad
 * file never stops the rest. A file already at the write version is skipped as `current` after a PARSE only.
 * @param {{ vaults: UpgradeInput[], mrk: Buffer, readable?: ReadonlySet<number> }} input
 * @returns {{ upgraded: UpgradedVault[], skipped: Array<{ id: string, reason: SkipReason }> }}
 */
function buildUpgrade(input) {
  /** @type {UpgradedVault[]} */
  const upgraded = [];
  /** @type {Array<{ id: string, reason: SkipReason }>} */
  const skipped = [];
  const { vaults, mrk, readable } = input;
  for (const v of vaults) {
    /** @type {SkipReason} */
    let stage = 'format';
    /** @type {Buffer | null} */
    let vaultKey = null;
    try {
      const doc = vc.parseVault(v.bytes, { readable });
      if (doc.version !== 1) {
        skipped.push({ id: v.id, reason: 'current' });
        continue;
      }
      const env = doc.envelopes.find((/** @type {any} */ e) => e.keyId === 'mrk');
      if (!env) {
        skipped.push({ id: v.id, reason: 'no-mrk-envelope' });
        continue;
      }
      stage = 'wrong-key';
      vaultKey = vc.unwrapVaultKey(env, mrk, vc.mrkEnvelopeAad(1, v.id));
      stage = 'items-unreadable';
      const items = vc.decryptItems(doc.items, vaultKey, 1, v.id);
      stage = 'unexpected';
      const newEnv = {
        keyId: 'mrk',
        type: 'mrk',
        ...vc.wrapVaultKey(vaultKey, mrk, vc.mrkEnvelopeAad(vc.WRITE_VAULT_VERSION, v.bindId))
      };
      // The mrk envelope keeps its place; every other envelope is the SAME OBJECT's bytes, untouched.
      const envelopes = doc.envelopes.map((/** @type {any} */ e) => (e.keyId === 'mrk' ? newEnv : e));
      const json = vc.serializeVault(
        {
          vaultId: v.bindId,
          kdf: doc.kdf,
          envelopes,
          items: vc.encryptItems(items, vaultKey, vc.WRITE_VAULT_VERSION, v.bindId)
        },
        { version: vc.WRITE_VAULT_VERSION, readable }
      );
      upgraded.push({
        id: v.id,
        bindId: v.bindId,
        json: Buffer.from(json, 'utf8'),
        original: v.bytes,
        items,
        envelopes: doc.envelopes
      });
    } catch (err) {
      if (stage === 'format' && !(err instanceof vc.VaultFormatError)) stage = 'unexpected';
      skipped.push({ id: v.id, reason: stage });
    } finally {
      if (vaultKey) vaultKey.fill(0);
    }
  }
  return { upgraded, skipped };
}

/**
 * The one correctness check for a rebuilt document, run by the caller three times with `id` taken from three
 * different places. Throws on any disagreement; returns nothing. `doc` is a PARSED document (the caller parses
 * the bytes it holds, or reads through the store's own reader).
 *  - version 2, its plaintext `vaultId` field equals `id`;
 *  - the key envelope unwraps under the master key with the version-2 AAD for `id`;
 *  - the items decrypt with explicit `(2, id)` and deep-equal the originals;
 *  - the non-mrk envelopes are byte-identical to the source's, by key id and order.
 * @param {{ doc: any, id: string, mrk: Buffer, items: any, envelopes: any[] }} args
 * @returns {void}
 */
function verifyDocument({ doc, id, mrk, items, envelopes }) {
  if (doc.version !== vc.WRITE_VAULT_VERSION) {
    throw new vc.VaultFormatError(`upgrade verify: version ${doc.version}, expected ${vc.WRITE_VAULT_VERSION}`);
  }
  if (doc.vaultId !== id) throw new vc.VaultFormatError('upgrade verify: vault id field differs from the slot');
  const env = doc.envelopes.find((/** @type {any} */ e) => e.keyId === 'mrk');
  if (!env) throw new vc.VaultFormatError('upgrade verify: no mrk envelope');
  const key = vc.unwrapVaultKey(env, mrk, vc.mrkEnvelopeAad(vc.WRITE_VAULT_VERSION, id));
  try {
    const got = vc.decryptItems(doc.items, key, vc.WRITE_VAULT_VERSION, id);
    if (!isDeepStrictEqual(got, items)) {
      throw new vc.VaultFormatError('upgrade verify: items differ from the original');
    }
  } finally {
    key.fill(0);
  }
  const want = envelopes
    .filter((/** @type {any} */ e) => e.keyId !== 'mrk')
    .map((/** @type {any} */ e) => JSON.stringify(e));
  const have = doc.envelopes
    .filter((/** @type {any} */ e) => e.keyId !== 'mrk')
    .map((/** @type {any} */ e) => JSON.stringify(e));
  if (want.length !== have.length || want.some((/** @type {string} */ w, /** @type {number} */ i) => w !== have[i])) {
    throw new vc.VaultFormatError('upgrade verify: access envelopes differ from the source');
  }
  // The mrk envelope keeps its original position.
  const srcPos = envelopes.findIndex((/** @type {any} */ e) => e.keyId === 'mrk');
  const outPos = doc.envelopes.findIndex((/** @type {any} */ e) => e.keyId === 'mrk');
  if (srcPos !== outPos) throw new vc.VaultFormatError('upgrade verify: envelope order changed');
}

module.exports = { buildUpgrade, verifyDocument };
