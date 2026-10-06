#!/usr/bin/env node
// Throwaway self-signed TLS cert for the third-party-cookies fixture
// (sortie 02). One cert covers all three fixture sites: IP 127.0.0.1 (A),
// DNS localhost (B) and IP 127.0.0.2 (C). The app runs with
// `--insecure-tls-fixtures` (--ignore-certificate-errors), so any self-signed
// cert is accepted. Output goes to ./certs/ — GITIGNORED, regenerated locally,
// 7-day validity. Shells out to `openssl`. Zero Node dependencies.
//
// Usage: node gen-certs.mjs   -> certs/server.pem, certs/server-key.pem

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const certsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'certs');
fs.mkdirSync(certsDir, { recursive: true });

const res = spawnSync(
  'openssl',
  [
    'req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-days', '7', '-nodes',
    '-keyout', 'server-key.pem', '-out', 'server.pem',
    '-subj', '/CN=localhost',
    '-addext', 'subjectAltName = DNS:localhost, IP:127.0.0.1, IP:127.0.0.2, IP:::1',
    '-addext', 'basicConstraints = CA:FALSE',
    '-addext', 'extendedKeyUsage = serverAuth'
  ],
  { cwd: certsDir, encoding: 'utf8' }
);
if (res.error && res.error.code === 'ENOENT') {
  console.error('gen-certs: `openssl` not found on PATH — install openssl to generate the fixture cert.');
  process.exit(1);
}
if (res.status !== 0) {
  console.error(`gen-certs: openssl failed:\n${res.stderr || res.error}`);
  process.exit(1);
}
console.log(`gen-certs: wrote ${path.join(certsDir, 'server.pem')} (+ server-key.pem). Gitignored.`);
