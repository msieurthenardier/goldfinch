#!/usr/bin/env node
// NSS user-store TRUST-ANCHOR import/remove helper for the TLS-trust behavior
// spec (Mission 20 Flight 2 Leg 4, DD14) — the `import-client-cert.mjs`
// precheck/import/remove shape, applied to a CA instead of a client cert.
//
// ⚠️ OPERATOR-MACHINE MUTATION: `--import` installs the fixture's SECOND
// throwaway CA (`trusted-ca.pem`, gen-certs.mjs) into YOUR user NSS database
// (~/.pki/nssdb) as a TRUSTED SSL-server CA (`certutil -A -t "C,,"`) — that is
// what makes Chromium accept `serve-tls.mjs --cert-set trusted`'s certificate
// with no `-k`/`--ignore-certificate-errors`. The operation is REVERSIBLE:
// `--remove` deletes exactly the imported entry (by its fixed nickname).
// Nothing else is touched.
//
// PRECHECK, never install: `certutil` comes from the `libnss3-tools` package
// and is NOT assumed present. Verified BEFORE any mutation; if missing this
// helper fails with the install hint and touches nothing.
//
// `--remove` is IDEMPOTENT BY PRECHECK (edge case: a crashed prior run left
// the anchor behind, or this is simply run twice): a `certutil -L -n <nick>`
// lookup that finds nothing prints a "not present" note and exits 0 — never
// treated as a failure. Any OTHER `certutil -D` error still fails hard.
//
// Usage:
//   node import-trust-anchor.mjs --import   # trust certs/trusted-ca.pem (run gen-certs.mjs first)
//   node import-trust-anchor.mjs --remove   # remove the imported trust anchor (idempotent)

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const caPath = path.join(here, 'certs', 'trusted-ca.pem');

// Mirrors gen-certs.mjs's TRUSTED_CA_SUBJECT's CN — kept as a literal here
// (this file is ESM, gen-certs.mjs's const is module-scoped, and duplicating
// one short string is simpler than a shared-constants module for a two-file
// fixture pair) — see gen-certs.mjs's own comment pointing back at this file.
const NICKNAME = 'Goldfinch Fixture Trusted CA';
const NSS_DB = `sql:${process.env.HOME}/.pki/nssdb`;

function binPresent(bin) {
  const res = spawnSync(bin, ['-H'], { encoding: 'utf8' });
  // -H prints usage and exits non-zero — only ENOENT means absent.
  return !(res.error && res.error.code === 'ENOENT');
}

const mode = process.argv[2];
if (mode !== '--import' && mode !== '--remove') {
  console.error('Usage: node import-trust-anchor.mjs --import | --remove');
  process.exit(1);
}

if (!binPresent('certutil')) {
  console.error(
    'import-trust-anchor: certutil not found — install the libnss3-tools package '
      + '(e.g. `sudo apt install libnss3-tools`). Nothing was imported or removed.'
  );
  process.exit(1);
}

// A precheck lookup — `certutil -L -d <db> -n <nick>` — is nonzero when the
// nickname is absent. Used by BOTH modes: --import wants to know before it
// writes (informational only — a re-import over an existing identical
// nickname is harmless, certutil just overwrites), --remove uses it to make
// itself idempotent (see the module header).
function nicknamePresent() {
  const res = spawnSync('certutil', ['-L', '-d', NSS_DB, '-n', NICKNAME], { encoding: 'utf8' });
  return res.status === 0;
}

if (mode === '--import') {
  if (!fs.existsSync(caPath)) {
    console.error(
      `import-trust-anchor: ${caPath} not found — run \`node tests/behavior/fixtures/web-compat/gen-certs.mjs\` first.`
    );
    process.exit(1);
  }
  // `-t "C,,"` — the first trust-flag position, `C`, is "trusted CA for SSL
  // server certificates" (the two trailing empty positions are email/object-
  // signing trust, left unset — this fixture never needs either).
  const res = spawnSync('certutil', ['-A', '-n', NICKNAME, '-t', 'C,,', '-i', caPath, '-d', NSS_DB], {
    encoding: 'utf8'
  });
  if (res.status !== 0) {
    console.error(`import-trust-anchor: certutil -A failed:\n${res.stderr || res.stdout}`);
    console.error(
      'Hint: if the NSS database does not exist yet, initialize it once with '
        + '`certutil -d sql:$HOME/.pki/nssdb -N --empty-password` (see README.md).'
    );
    process.exit(1);
  }
  console.log(`import-trust-anchor: imported "${NICKNAME}" as a trusted SSL-server CA into ${NSS_DB}.`);
  console.log('Reverse with: node import-trust-anchor.mjs --remove');
} else {
  if (!nicknamePresent()) {
    console.log(`import-trust-anchor: "${NICKNAME}" is not present in ${NSS_DB} — nothing to remove.`);
    process.exit(0);
  }
  const res = spawnSync('certutil', ['-D', '-d', NSS_DB, '-n', NICKNAME], { encoding: 'utf8' });
  if (res.status !== 0) {
    console.error(`import-trust-anchor: certutil -D failed:\n${res.stderr || res.stdout}`);
    process.exit(1);
  }
  console.log(`import-trust-anchor: removed "${NICKNAME}" from ${NSS_DB}.`);
}
