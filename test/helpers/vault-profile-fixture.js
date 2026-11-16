'use strict';

// Profiles for the version-2 vault suites. Everything is built at run time: the store builds the
// manager and any version-2 file; the independent oracle (`vault-oracle.js`, raw node:crypto)
// builds every version-1 file, so a "version 1 still opens" test never trusts the code under test
// to have written its own previous-version input.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const vs = require('../../src/main/vault/vault-store');
const oracle = require('./vault-oracle');

const FAST = { algo: 'scrypt', N: 2 ** 12, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MASTER = 'a throwaway master password for the v2 suites';
const JARS = [
  { id: 'work', name: 'Work', color: '#2196f3' },
  { id: 'play', name: 'Play', color: '#e91e63' },
  { id: 'third', name: 'Third', color: '#4caf50' }
];

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'gf-v2-'));
const rm = (d) => fs.rmSync(d, { recursive: true, force: true });
const vaultFile = (dir, id) => path.join(dir, 'vaults', `${id}.gfvault`);
const readDoc = (dir, id) => JSON.parse(fs.readFileSync(vaultFile(dir, id), 'utf8'));
const bytesOf = (dir, id) => (fs.existsSync(vaultFile(dir, id)) ? fs.readFileSync(vaultFile(dir, id)) : null);

/** A store over `dir` with fast parameters and the fixture's jars (`extra` overrides). */
function makeStore(dir, extra = {}) {
  return vs.load(dir, { scryptParams: FAST, getAutoLockMinutes: () => 10, listJars: () => JARS, ...extra });
}

/** Items covering every type; ids are fixed so a round trip can be compared by deep equality. */
function sampleItems(tag) {
  return [
    {
      id: `${tag}-login`,
      type: 'login',
      title: `${tag} login`,
      username: `${tag}-user`,
      origin: `https://${tag}.example`,
      password: `${tag}-pw`,
      totp: 'JBSWY3DPEHPK3PXP',
      notes: 'a note',
      createdAt: 1000,
      updatedAt: 1000
    },
    {
      id: `${tag}-card`,
      type: 'card',
      title: `${tag} card`,
      cardholder: 'A Holder',
      brand: 'visa',
      last4: '4242',
      number: '4242424242424242',
      cvv: '123',
      expiry: '12/30',
      confirmedOrigins: ['https://shop.example'],
      createdAt: 1000,
      updatedAt: 1000
    },
    {
      id: `${tag}-note`,
      type: 'note',
      title: `${tag} note`,
      body: 'secret body',
      createdAt: 1000,
      updatedAt: 1000
    }
  ];
}

/** The identity item (at most one per vault). */
const identityItem = (tag) => ({
  id: `${tag}-identity`,
  type: 'identity',
  title: `${tag} me`,
  fullName: 'Ada Lovelace',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  confirmedOrigins: ['https://id.example'],
  createdAt: 1000,
  updatedAt: 1000
});

/**
 * A set-up store (manager version 1, global file version 2 from setup) whose listed vaults are
 * then written by the ORACLE at version 1 under the store's own master key (the store stays unlocked from setup; no
 * re-unlock, which would upgrade them) with its key cache dropped. `v1` maps vault id to `{ items, accessKeys? }`; every other id in `v2`
 * (default: none) is written by the store at version 2.
 * @returns {Promise<{ dir: string, store: any, admin: string, recovery: string, v1Keys: Record<string, Buffer> }>}
 */
async function makeProfile({ v1 = {}, v2 = {}, extra = {}, dir = tmpDir() } = {}) {
  const store = makeStore(dir, extra);
  const { recoveryKeyDisplay, adminPrivateKeyB64 } = await store.setup({ masterPassword: MASTER });
  const v1Keys = {};
  for (const [id, spec] of Object.entries(v1)) {
    const built = oracle.buildDoc({
      version: 1,
      vaultId: id,
      mrk: store.mrk,
      items: spec.items,
      accessKeys: spec.accessKeys || []
    });
    oracle.writeDoc(dir, id, built.doc);
    v1Keys[id] = built.vaultKey;
  }
  for (const [id, spec] of Object.entries(v2)) {
    for (const it of spec.items) store.saveItem(id, it);
  }
  // No lock/unlock here: an unlock UPGRADES version-1 files (leg `vault-upgrade`), and these profiles exist to
  // hold them. Dropping the key cache is what the re-unlock was for (the oracle just overwrote files whose keys
  // `setup`/`saveItem` may have cached).
  store.vaultKeys = new Map();
  return { dir, store, admin: adminPrivateKeyB64, recovery: recoveryKeyDisplay, v1Keys };
}

/** Decrypt a file with the oracle at the version it states, bound to `slotId`. */
const openFile = (dir, id, mrk, slotId = id) => oracle.openWithMaster(readDoc(dir, id), mrk, slotId);

module.exports = {
  FAST,
  MASTER,
  JARS,
  tmpDir,
  rm,
  vaultFile,
  readDoc,
  bytesOf,
  makeStore,
  makeProfile,
  sampleItems,
  identityItem,
  openFile,
  oracle
};
