#!/usr/bin/env node
// Headless vault-fixture builder for the `vault-mcp-surface` behavior test
// (Mission 12, Flight 1, Leg 4). No UI exists for the vault yet (DD9), so this
// script drives the ELECTRON-FREE main-process modules directly to FULLY
// provision a fresh userData profile that `npm run dev:automation` can be
// launched against and driven by the behavior test with NO UI / manual minting:
//
//   1. Registers two real jars (Jar A / Jar B) in the jar registry (app.db).
//   2. Stages a vault manager + global vault + one vault per jar, each seeded
//      with a Login item for the fixture origin (Jar A's login carries a TOTP
//      secret), and mints a per-jar vault ACCESS key for each jar.
//   3. Provisions the automation TRANSPORT keys (a per-jar key + an admin key)
//      as settings-store hashes and flips `automationEnabled` on — so the
//      running app's MCP auth gate accepts the pre-known bearer tokens with no
//      settings-UI minting step.
//
// The jar registry + settings live in app.db (documents rows); the vault lives
// in self-contained `.gfvault` files under <userDataDir>/vaults/. Both are
// written here so the launched app reads them on boot.
//
// USAGE:
//   node tests/behavior/fixtures/vault-login/build-fixtures.mjs <userDataDir>
//
// <userDataDir> is Goldfinch's userData directory. Point it at the dev profile
// the `npm run dev:automation` build uses, or a throwaway dir for a dry run. It
// must be FRESH/EMPTY — the builder mints a NEW vault manager and refuses an
// already-set-up dir.
//
// OUTPUT (stdout JSON): see the emit block at the bottom. The transport keys,
// vault access secrets, admin vault private key, recovery key, and master
// password are returned EXACTLY once — the transport keys and vault access
// secrets are stored only as hashes / wrapped envelopes, never in plaintext.
// (This is a TEST fixture builder — emitting the operator's run secrets to
// stdout is intended.)

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// CJS interop (the scripts/dev-launch.mjs precedent): these are Electron-free
// CJS main-process modules, requireable straight from a plain-Node ESM context.
const appDb = require('../../../../src/main/app-db.js');
const jars = require('../../../../src/main/jars.js');
const settingsStore = require('../../../../src/main/settings-store.js');
const vaultStore = require('../../../../src/main/vault/vault-store.js');
const { generateKey, hashKey } = require('../../../../src/main/automation/automation-auth.js');

// The stable local origin the behavior test serves the login page at (see
// ./index.html + ./README.md). The seeded Login items carry THIS as their origin
// so vault-context.fill's top-frame exact-origin match succeeds.
const FIXTURE_ORIGIN = 'http://127.0.0.1:8099';

// Retained across setup + BOTH step-up mints: mintAccessKey re-unwraps the master
// envelope with this password (DD6 step-up), so it must survive to every mint.
// Emitted to stdout for the operator's run (a fixture builder — see header).
const MASTER_PASSWORD = 'fixture-master-correct-horse-battery';

async function main() {
  const userDataDir = process.argv[2];
  if (!userDataDir) {
    console.error('usage: node build-fixtures.mjs <userDataDir>');
    process.exit(2);
  }

  // The jar registry + settings persist through app.db's `documents` rows, so
  // the SQLite handle must be open before jars.load / settings-store.load. The
  // launched app opens the same app.db on boot and reads what we write here.
  appDb.open(userDataDir);

  // ---- 1. Register the two fixture jars in the real registry --------------
  // A fresh profile seeds Personal + Work inside load(); add() persists each new
  // jar. Read the REAL minted ids back from list() rather than assuming a slug
  // (the reserved-id remap makes slugs safe, but the ids are the contract).
  jars.load(userDataDir);
  jars.add('Jar A');
  jars.add('Jar B');
  const list = jars.list();
  const jarIdA = requireJarId(list, 'Jar A');
  const jarIdB = requireJarId(list, 'Jar B');

  // ---- 2. Vault fixtures (manager + global + per-jar vaults) ---------------
  // Inject the LIVE jar registry so _resolveTarget accepts the two fixture jars
  // (any non-global target absent from listJars() hard-fails).
  const store = vaultStore.load(userDataDir, {
    listJars: () => jars.list(),
    getAutoLockMinutes: () => 10,
  });

  if (store.isSetUp()) {
    console.error(
      `vault already set up under ${userDataDir}/vaults — use a fresh/empty userDataDir ` +
      '(the builder mints a NEW manager; it does not re-open an existing one).'
    );
    process.exit(1);
  }

  // First-run setup mints the MRK + recovery key + admin keypair; returns the
  // recovery display + admin (vault) private key exactly once (neither persisted).
  const { recoveryKeyDisplay, adminPrivateKeyB64 } = await store.setup({ masterPassword: MASTER_PASSWORD });

  // Seed one Login item per vault, all at the fixture origin so fills match.
  store.saveItem('global', {
    type: 'login',
    title: 'Global account',
    origin: FIXTURE_ORIGIN,
    username: 'admin-user@example.com',
    password: 'GlobalPassw0rd!',
  });

  // Jar A is the test jar: its Login carries an otpauth:// TOTP secret so
  // vaultTotp has a code to compute (RFC 6238 base32 secret).
  store.saveItem(jarIdA, {
    type: 'login',
    title: 'Jar A account',
    origin: FIXTURE_ORIGIN,
    username: 'jar-a-user@example.com',
    password: 'JarAPassw0rd!',
    totp: `otpauth://totp/Goldfinch:jar-a-user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Goldfinch&period=30&digits=6`,
  });

  store.saveItem(jarIdB, {
    type: 'login',
    title: 'Jar B account',
    origin: FIXTURE_ORIGIN,
    username: 'jar-b-user@example.com',
    password: 'JarBPassw0rd!',
  });

  // Mint a per-jar vault ACCESS key for each jar (step-up re-auth with the
  // master password). Each opens ONLY its own vault (no MRK envelope) — the
  // strict per-jar scope the behavior test asserts at the file level.
  const mintA = await store.mintAccessKey(jarIdA, { masterPassword: MASTER_PASSWORD });
  const mintB = await store.mintAccessKey(jarIdB, { masterPassword: MASTER_PASSWORD });

  // ---- 3. Provision transport keys + enable the automation surface ---------
  // The MCP auth gate 401s everything until automationEnabled is true AND a
  // presented bearer token hashes to a stored hash. Generate a per-jar transport
  // key + an admin transport key, persist their HASHES (plaintext never stored),
  // and flip the surface on. set() validates + writes the settings row.
  const jarTransportKeyA = generateKey();
  const jarTransportKeyB = generateKey();
  const adminTransportKey = generateKey();

  settingsStore.load(userDataDir);
  settingsStore.set('automationKeyHashes', {
    [jarIdA]: hashKey(jarTransportKeyA),
    [jarIdB]: hashKey(jarTransportKeyB),
  });
  settingsStore.set('automationAdminKeyHash', hashKey(adminTransportKey));
  settingsStore.set('automationEnabled', true);

  // Flush + release the app.db handle so the launched app can open it cleanly.
  appDb.close();

  // ---- 4. Emit everything the run needs ------------------------------------
  process.stdout.write(JSON.stringify({
    jarIds: { a: jarIdA, b: jarIdB },
    jarTransportKeys: { a: jarTransportKeyA, b: jarTransportKeyB },
    adminTransportKey,
    jarAccessSecrets: { a: mintA.secret, b: mintB.secret },
    jarAccessKeyIds: { a: mintA.keyId, b: mintB.keyId },
    adminVaultPrivateKeyB64: adminPrivateKeyB64,
    recoveryKeyDisplay,
    fixtureOrigin: FIXTURE_ORIGIN,
    masterPassword: MASTER_PASSWORD,
  }, null, 2) + '\n');
}

/**
 * Resolve a jar's real minted id by its display name (fail loudly if absent —
 * a missing jar means the registry write did not take).
 * @param {Array<{ id: string, name: string }>} list
 * @param {string} name
 * @returns {string}
 */
function requireJarId(list, name) {
  const jar = list.find((j) => j.name === name);
  if (!jar) {
    throw new Error(`build-fixtures: jar "${name}" not found in registry after add()`);
  }
  return jar.id;
}

main().catch((err) => {
  try { appDb.close(); } catch { /* best-effort */ }
  console.error('build-fixtures failed:', err && (err.stack || err.message || err));
  process.exit(1);
});
