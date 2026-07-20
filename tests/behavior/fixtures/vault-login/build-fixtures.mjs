#!/usr/bin/env node
// Headless vault-fixture builder for the `vault-mcp-surface` behavior test
// (Mission 12, Flight 1, Leg 4). No UI exists for the vault yet (DD9), so this
// script drives the ELECTRON-FREE `vault-store` API directly to stage a manager
// + global vault + two jar vaults, each seeded with a Login item for the fixture
// origin (the test jar's login carries a TOTP secret), and mints a per-jar access
// key for each jar. It prints the run secrets the operator exports for the test.
//
// USAGE:
//   node tests/behavior/fixtures/vault-login/build-fixtures.mjs <userDataDir>
//
// <userDataDir> is Goldfinch's userData directory (the store writes under
// <userDataDir>/vaults/). Point it at the dev profile the `npm run dev:automation`
// build uses, or a throwaway dir for a dry run.
//
// OUTPUT (stdout JSON): { jarKeyIds, jarAccessSecrets, adminPrivateKeyB64,
// recoveryKeyDisplay, fixtureOrigin }. Capture these for the run — the access
// secrets, admin private key, and recovery key are returned EXACTLY once and are
// never persisted in plaintext.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// CJS interop (the scripts/dev-launch.mjs precedent): the vault-store is an
// Electron-free CJS module, requireable straight from a plain-Node ESM context.
const vaultStore = require('../../../../src/main/vault/vault-store.js');

// The stable local origin the behavior test serves the login page at (see
// ./index.html + ./README.md). The seeded Login items carry THIS as their origin
// so vault-context.fill's top-frame exact-origin match succeeds.
const FIXTURE_ORIGIN = 'http://127.0.0.1:8099';

// The two fixture jars. Injecting listJars with these ids is REQUIRED — the
// store's _resolveTarget throws "unknown or non-persistent jar" for any non-global
// target absent from listJars() (the default is `() => []`, so jar writes would
// hard-fail without this).
const JAR_IDS = ['jar-a', 'jar-b'];

// Retained across setup + BOTH step-up mints: mintAccessKey re-unwraps the master
// envelope with this password (DD6 step-up), so it must survive to every mint.
const MASTER_PASSWORD = 'fixture-master-correct-horse-battery';

async function main() {
  const userDataDir = process.argv[2];
  if (!userDataDir) {
    console.error('usage: node build-fixtures.mjs <userDataDir>');
    process.exit(2);
  }

  const store = vaultStore.load(userDataDir, {
    listJars: () => JAR_IDS.map((id) => ({ id })),
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
  // recovery display + admin private key exactly once (neither is persisted).
  const { recoveryKeyDisplay, adminPrivateKeyB64 } = await store.setup({ masterPassword: MASTER_PASSWORD });

  // Seed one Login item per vault, all at the fixture origin so fills match.
  store.saveItem('global', {
    type: 'login',
    title: 'Global account',
    origin: FIXTURE_ORIGIN,
    username: 'admin-user@example.com',
    password: 'GlobalPassw0rd!',
  });

  // The test jar (jar-a): its Login carries an otpauth:// TOTP secret so
  // vaultTotp has a code to compute (RFC 6238 base32 secret).
  store.saveItem('jar-a', {
    type: 'login',
    title: 'Jar A account',
    origin: FIXTURE_ORIGIN,
    username: 'jar-a-user@example.com',
    password: 'JarAPassw0rd!',
    totp: 'otpauth://totp/Goldfinch:jar-a-user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Goldfinch&period=30&digits=6',
  });

  store.saveItem('jar-b', {
    type: 'login',
    title: 'Jar B account',
    origin: FIXTURE_ORIGIN,
    username: 'jar-b-user@example.com',
    password: 'JarBPassw0rd!',
  });

  // Mint a per-jar access key for each jar (step-up re-auth with the master
  // password). Each opens ONLY its own vault (no MRK envelope) — the strict
  // per-jar scope the behavior test asserts at the file level.
  const jarKeyIds = {};
  const jarAccessSecrets = {};
  for (const jarId of JAR_IDS) {
    const { secret, keyId } = await store.mintAccessKey(jarId, { masterPassword: MASTER_PASSWORD });
    jarKeyIds[jarId] = keyId;
    jarAccessSecrets[jarId] = secret;
  }

  process.stdout.write(JSON.stringify({
    jarKeyIds,
    jarAccessSecrets,
    adminPrivateKeyB64,
    recoveryKeyDisplay,
    fixtureOrigin: FIXTURE_ORIGIN,
  }, null, 2) + '\n');
}

main().catch((err) => {
  console.error('build-fixtures failed:', err && (err.stack || err.message || err));
  process.exit(1);
});
