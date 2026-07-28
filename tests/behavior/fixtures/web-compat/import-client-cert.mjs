#!/usr/bin/env node
// NSS user-store import/remove helper for the web-compat client-cert behavior
// spec (M14 F1 L3, flight DD6).
//
// ⚠️ OPERATOR-MACHINE MUTATION: `--import` writes the fixture client cert into
// YOUR user NSS database (~/.pki/nssdb) — that is what makes Chromium offer it
// in the chooser. The operation is REVERSIBLE: `--remove` deletes exactly the
// imported entry (by its fixed nickname). Nothing else is touched.
//
// PRECHECK, never install: pk12util + certutil come from the `libnss3-tools`
// package and are NOT assumed present. Both binaries are verified BEFORE any
// mutation; if either is missing this helper fails with the install hint and
// touches nothing.
//
// Usage:
//   node import-client-cert.mjs --import   # import certs/client.p12 (run gen-certs.mjs first)
//   node import-client-cert.mjs --remove   # remove the imported fixture cert

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const p12Path = path.join(here, 'certs', 'client.p12');

const NICKNAME = 'Goldfinch Fixture Client'; // stamped by gen-certs.mjs's -name
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
  console.log(`import-client-cert: imported "${NICKNAME}" into ${NSS_DB}.`);
  console.log('Reverse with: node import-client-cert.mjs --remove');
} else {
  const res = spawnSync('certutil', ['-D', '-d', NSS_DB, '-n', NICKNAME], { encoding: 'utf8' });
  if (res.status !== 0) {
    console.error(`import-client-cert: certutil -D failed (was "${NICKNAME}" imported?):\n${res.stderr || res.stdout}`);
    process.exit(1);
  }
  console.log(`import-client-cert: removed "${NICKNAME}" from ${NSS_DB}.`);
}
