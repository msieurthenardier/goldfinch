#!/usr/bin/env node
// Card seeder for the vault-card fixture (issue #152).
//
// Unlike vault-login's build-fixtures.mjs, this does NOT provision a profile — it
// seeds payment-card items into an ALREADY SET-UP vault so the fill path is
// testable immediately against a dev profile you already use. It drives the
// Electron-free vault-store directly (the build-fixtures.mjs CJS-interop
// precedent); the running app reads the same `.gfvault` files on next unlock.
//
// USAGE:
//   node tests/behavior/fixtures/vault-card/seed-cards.mjs <userDataDir> <masterPassword> [jarId]
//
// <userDataDir>    Goldfinch's userData dir (dev profile: ~/.config/goldfinch-dev).
// <masterPassword> the vault master password — needed to unlock before writing.
// [jarId]          optional: also seed a jar-scoped card into this jar. Omit to
//                  seed the GLOBAL vault only (which is reachable from every jar,
//                  so it is enough to exercise fill).
//
// Run with the app CLOSED. The store is a file-backed substrate with no
// cross-process locking, so a concurrent write from the running app could
// interleave; quitting first avoids the question entirely.
//
// The PANs below are the standard publicly-documented test numbers (Visa 4242…,
// Mastercard 5555…, Amex 3782…). They are not real accounts and are Luhn-valid,
// which matters: the capture path's plausibility gate rejects Luhn-invalid input,
// so a made-up number would not round-trip.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const appDb = require('../../../../src/main/app-db.js');
const jars = require('../../../../src/main/jars.js');
const vaultStore = require('../../../../src/main/vault/vault-store.js');

// Two cards in the GLOBAL vault (reachable from every jar) so the picker has more
// than one row to choose between, plus an optional jar-scoped third.
const GLOBAL_CARDS = [
  {
    type: 'card',
    title: 'Fixture Visa',
    cardholder: 'A Lovelace',
    brand: 'Visa',
    last4: '4242',
    number: '4242424242424242',
    cvv: '123',
    expiry: '12/28',
  },
  {
    type: 'card',
    title: 'Fixture Amex',
    cardholder: 'A Lovelace',
    brand: 'Amex',
    last4: '0005',
    number: '378282246310005',
    cvv: '1234',
    expiry: '03/27',
  },
];

const JAR_CARD = {
  type: 'card',
  title: 'Fixture Mastercard (jar-scoped)',
  cardholder: 'G Hopper',
  brand: 'Mastercard',
  last4: '4444',
  number: '5555555555554444',
  cvv: '321',
  expiry: '07/29',
};

async function main() {
  const [userDataDir, masterPassword, jarId] = process.argv.slice(2);
  if (!userDataDir || !masterPassword) {
    console.error('usage: node seed-cards.mjs <userDataDir> <masterPassword> [jarId]');
    process.exit(2);
  }

  appDb.open(userDataDir);
  jars.load(userDataDir);

  const store = vaultStore.load(userDataDir, {
    listJars: () => jars.list(),
    getAutoLockMinutes: () => 10,
  });

  if (!store.isSetUp()) {
    console.error(
      `no vault manager under ${userDataDir}/vaults — set one up in the app first ` +
      '(goldfinch://vault), or use vault-login/build-fixtures.mjs for a fresh profile.'
    );
    process.exit(1);
  }

  try {
    await store.unlock(masterPassword);
  } catch (err) {
    console.error(`unlock failed: ${err && err.message ? err.message : err}`);
    process.exit(1);
  }

  // IDEMPOTENT by PAN: `saveItem` with no id always creates, so a re-run would
  // otherwise pile up duplicate copies of every fixture card. Skipping on an exact
  // digits-compared PAN match mirrors the capture path's own identity rule, and
  // makes this safe to re-run while iterating.
  const digits = (n) => String(n == null ? '' : n).replace(/\D/g, '');
  const seedInto = (vaultId, card, seeded) => {
    const existing = store.listItems(vaultId)
      .find((it) => it.type === 'card' && digits(it.number) === digits(card.number));
    if (existing) {
      seeded.push({ vaultId, id: existing.id, title: card.title, last4: card.last4, skipped: 'already present' });
      return;
    }
    const saved = store.saveItem(vaultId, card);
    seeded.push({ vaultId, id: saved.id, title: card.title, last4: card.last4 });
  };

  const seeded = [];
  for (const card of GLOBAL_CARDS) seedInto('global', card, seeded);

  if (jarId) {
    const known = jars.list().some((j) => j.id === jarId);
    if (!known) {
      console.error(`unknown jarId "${jarId}" — known: ${jars.list().map((j) => j.id).join(', ')}`);
      process.exit(1);
    }
    seedInto(jarId, JAR_CARD, seeded);
  }

  store.lockNow();
  appDb.close();

  console.log(JSON.stringify({ seeded, jars: jars.list().map((j) => ({ id: j.id, name: j.name })) }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
