'use strict';

// An INDEPENDENT oracle for `.gfvault` documents (Mission 23 Flight 2 leg `vault-format-v2`, AC1(a)).
// Raw `node:crypto` only, literal AAD strings written out here, the document shape written out by
// hand. It NEVER requires vault-crypto or vault-store, so a bug shared by the reader and the writer
// cannot hide in a fixture built by this file. Every "version 1 still opens" test uses it, and the
// version-2 builders/openers let a test prove a store-written file against hand-written AADs.
//
// The strings (these ARE the format; do not import them from anywhere):
//   items blob           v1 `gfvault/items/1`            v2 `gfvault/items/2/<vaultId>`
//   vault key envelope   v1 `gfvault/mrk-env/v1`         v2 `gfvault/mrk-env/v2/<vaultId>`
//   access envelope      `gfvault/env/1/hkdf-access/<keyId>` (pinned at 1 for every document version)
//   access wrapping key  HKDF-SHA256(secret utf8, salt, info `gfvault/access/v1`) -> 32 bytes

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const FORMAT = 'gfvault';

const itemsAad = (version, id) => Buffer.from(version === 1 ? 'gfvault/items/1' : `gfvault/items/${version}/${id}`);
const mrkAad = (version, id) => Buffer.from(version === 1 ? 'gfvault/mrk-env/v1' : `gfvault/mrk-env/v${version}/${id}`);
const accessAad = (keyId) => Buffer.from(`gfvault/env/1/hkdf-access/${keyId}`);

function seal(plaintext, key, aad) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(aad);
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  return { iv: iv.toString('base64'), ct: ct.toString('base64'), tag: c.getAuthTag().toString('base64') };
}

function open(blob, key, aad) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'));
  d.setAAD(aad);
  d.setAuthTag(Buffer.from(blob.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(blob.ct, 'base64')), d.final()]);
}

const accessWrappingKey = (secret, salt) =>
  Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret, 'utf8'), salt, Buffer.from('gfvault/access/v1'), 32));

/** A fresh access envelope for `vaultKey` under `{ secret, keyId }`. */
function accessEnvelope(vaultKey, { secret, keyId }) {
  const salt = crypto.randomBytes(16);
  return {
    keyId,
    type: 'hkdf-access',
    salt: salt.toString('base64'),
    ...seal(vaultKey, accessWrappingKey(secret, salt), accessAad(keyId))
  };
}

function newAccessKey() {
  return { secret: crypto.randomBytes(32).toString('base64url'), keyId: crypto.randomBytes(8).toString('base64url') };
}

/**
 * Build a `.gfvault` document by hand. `vaultId` is the slot id the key envelope and items are
 * bound to (version 2); `docVaultId` is the plaintext field (defaults to `vaultId`).
 * @returns {{ doc: object, vaultKey: Buffer }}
 */
function buildDoc({ version = 1, vaultId, docVaultId, mrk, vaultKey, items, accessKeys = [], kdf }) {
  const key = vaultKey || crypto.randomBytes(32);
  const doc = {
    format: FORMAT,
    version,
    vaultId: docVaultId ?? vaultId,
    kdf: kdf || { algo: 'scrypt', N: 4096, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
    envelopes: [
      { keyId: 'mrk', type: 'mrk', ...seal(key, mrk, mrkAad(version, vaultId)) },
      ...accessKeys.map((k) => accessEnvelope(key, k))
    ],
    items: seal(Buffer.from(JSON.stringify(items)), key, itemsAad(version, vaultId))
  };
  return { doc, vaultKey: key };
}

/** Write a built document at `<dir>/vaults/<fileId>.gfvault` (creates the directory). */
function writeDoc(dir, fileId, doc) {
  const vdir = path.join(dir, 'vaults');
  fs.mkdirSync(vdir, { recursive: true });
  fs.writeFileSync(path.join(vdir, `${fileId}.gfvault`), JSON.stringify(doc));
}

/** Open a document (object or JSON text) with the master key; `slotId` is the id it must be bound to. */
function openWithMaster(docOrText, mrk, slotId) {
  const doc = typeof docOrText === 'string' || Buffer.isBuffer(docOrText) ? JSON.parse(docOrText) : docOrText;
  const env = doc.envelopes.find((e) => e.keyId === 'mrk');
  const vaultKey = open(env, mrk, mrkAad(doc.version, slotId));
  return { vaultKey, items: JSON.parse(open(doc.items, vaultKey, itemsAad(doc.version, slotId)).toString('utf8')) };
}

/** Open a document with an access secret (the envelope AAD has no vault id). Returns the vault key. */
function openAccessEnvelope(docOrText, secret) {
  const doc = typeof docOrText === 'string' || Buffer.isBuffer(docOrText) ? JSON.parse(docOrText) : docOrText;
  for (const env of doc.envelopes) {
    if (env.keyId === 'mrk') continue;
    try {
      return open(env, accessWrappingKey(secret, Buffer.from(env.salt, 'base64')), accessAad(env.keyId));
    } catch {
      /* next */
    }
  }
  throw new Error('oracle: no access envelope opened');
}

/** Decrypt the items of a document with a vault key at an explicit version and id. */
function openItems(doc, vaultKey, version, id) {
  return JSON.parse(open(doc.items, vaultKey, itemsAad(version, id)).toString('utf8'));
}

module.exports = {
  itemsAad,
  mrkAad,
  accessAad,
  seal,
  open,
  accessEnvelope,
  newAccessKey,
  buildDoc,
  writeDoc,
  openWithMaster,
  openAccessEnvelope,
  openItems
};
