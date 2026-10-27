#!/usr/bin/env node
// NSS user-store import/remove helper for the web-compat client-cert behavior
// spec (M14 F1 L3, flight DD6).
//
// ⚠️ OPERATOR-MACHINE MUTATION: `--import` writes the fixture client cert into
// YOUR user NSS database (~/.pki/nssdb) — that is what makes Chromium offer it
// in the chooser. The PKCS#12 bundle carries THREE things (gen-certs.mjs uses
// `-certfile ca.pem`): the client cert, its private key, and the Throwaway CA.
// The operation is REVERSIBLE: `--remove` deletes all three — the client cert
// WITH its key (`certutil -F`), any orphaned key still carrying the fixture
// nickname (left by an older cert-only `--remove`), and the Throwaway CA — by
// their fixed nicknames. Nothing else is touched. Idempotent: an absent entry
// is success (mirrors import-trust-anchor.mjs).
//
// PRECHECK, never install: pk12util + certutil come from the `libnss3-tools`
// package and are NOT assumed present. Both binaries are verified BEFORE any
// mutation; if either is missing this helper fails with the install hint and
// touches nothing.
//
// Usage:
//   node import-client-cert.mjs --import   # import certs/client.p12 (run gen-certs.mjs first)
//   node import-client-cert.mjs --remove   # remove fixture client cert + key + Throwaway CA

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const p12Path = path.join(here, 'certs', 'client.p12');

const NICKNAME = 'Goldfinch Fixture Client'; // stamped by gen-certs.mjs's -name
// The CA bundled into the p12 (gen-certs.mjs CA_SUBJECT '/CN=Goldfinch Fixture Throwaway CA');
// pk12util nicknames it by its subject CN.
const CA_NICKNAME = 'Goldfinch Fixture Throwaway CA';
const NSS_DB = `sql:${process.env.HOME}/.pki/nssdb`;
const P12_PASSWORD = 'goldfinch'; // fixture-only (gen-certs.mjs)

function binPresent(bin) {
  const res = spawnSync(bin, ['-H'], { encoding: 'utf8' });
  // -H prints usage and exits non-zero on both tools — only ENOENT means absent.
  return !(res.error && res.error.code === 'ENOENT');
}

const mode = process.argv[2];
if (mode !== '--import' && mode !== '--remove') {
  console.error('Usage: node import-client-cert.mjs --import | --remove');
  process.exit(1);
}

// Precheck BOTH tools before touching anything (even --import needs certutil
// for the documented reversal path).
if (!binPresent('pk12util') || !binPresent('certutil')) {
  console.error(
    'import-client-cert: pk12util/certutil not found — install the libnss3-tools package '
      + '(e.g. `sudo apt install libnss3-tools`). Nothing was imported or removed.'
  );
  process.exit(1);
}

if (mode === '--import') {
  if (!fs.existsSync(p12Path)) {
    console.error(
      `import-client-cert: ${p12Path} not found — run \`node tests/behavior/fixtures/web-compat/gen-certs.mjs\` first.`
    );
    process.exit(1);
  }
  const res = spawnSync('pk12util', ['-i', p12Path, '-d', NSS_DB, '-W', P12_PASSWORD], { encoding: 'utf8' });
  if (res.status !== 0) {
    console.error(`import-client-cert: pk12util failed:\n${res.stderr || res.stdout}`);
    console.error(
      'Hint: if the NSS database does not exist yet, initialize it once with '
        + '`certutil -d sql:$HOME/.pki/nssdb -N --empty-password` (see README.md).'
    );
    process.exit(1);
  }
  console.log(`import-client-cert: imported "${NICKNAME}" (cert + private key) and "${CA_NICKNAME}" into ${NSS_DB}.`);
  console.log('Reverse with: node import-client-cert.mjs --remove');
} else {
  const certutil = (...args) => spawnSync('certutil', [...args, '-d', NSS_DB], { encoding: 'utf8' });
  // `certutil -L -n <nick>` is nonzero when the nickname is absent.
  const certPresent = (nick) => certutil('-L', '-n', nick).status === 0;
  // Key IDs (hex) of private keys whose nickname is the fixture's. An older
  // cert-only `--remove` leaves the key behind still listed under that nickname.
  // stdin is closed so a token password prompt can never hang this.
  const fixtureKeyIds = () => {
    const res = spawnSync('certutil', ['-K', '-d', NSS_DB], { encoding: 'utf8', input: '' });
    if (res.status !== 0) return [];
    const ids = [];
    for (const line of res.stdout.split('\n')) {
      const m = /^<\s*\d+>\s+\S+\s+([0-9a-f]+)\s+(.*?)\s*$/.exec(line);
      if (m && m[2] === NICKNAME) ids.push(m[1]);
    }
    return ids;
  };
  const fail = (what, res) => {
    console.error(`import-client-cert: ${what} failed:\n${res.stderr || res.stdout}`);
    process.exit(1);
  };

  const removed = [];
  if (certPresent(NICKNAME)) {
    // -F deletes the key AND the associated certificate.
    const res = certutil('-F', '-n', NICKNAME);
    if (res.status !== 0) fail(`certutil -F -n "${NICKNAME}"`, res);
    removed.push(`"${NICKNAME}" (cert + key)`);
  }
  for (const id of fixtureKeyIds()) {
    const res = certutil('-F', '-k', id);
    if (res.status !== 0) fail(`certutil -F -k ${id}`, res);
    removed.push(`orphaned key ${id.slice(0, 12)}`);
  }
  if (certPresent(CA_NICKNAME)) {
    const res = certutil('-D', '-n', CA_NICKNAME);
    if (res.status !== 0) fail(`certutil -D -n "${CA_NICKNAME}"`, res);
    removed.push(`"${CA_NICKNAME}"`);
  }
  console.log(
    removed.length
      ? `import-client-cert: removed ${removed.join(', ')} from ${NSS_DB}.`
      : `import-client-cert: no fixture entries present in ${NSS_DB} — nothing to remove.`
  );
}
