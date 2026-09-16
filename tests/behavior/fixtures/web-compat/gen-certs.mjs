#!/usr/bin/env node
// Throwaway TLS fixture certificates for the web-compat client-cert behavior
// spec (M14 F1 L3, flight DD6) and the TLS-trust behavior spec (Mission 20
// Flight 2): a throwaway CA, a server cert for 127.0.0.1, a client cert +
// PKCS#12 bundle for NSS import, and — since Flight 2 Leg 4 (DD14) — a SECOND
// throwaway CA + server cert the operator's machine can be made to trust
// (`import-trust-anchor.mjs`), so the untrusted and trusted TLS rows are
// simultaneously reachable in one session with no mid-run trust-store change.
// Everything is written to ./certs/ — GITIGNORED, regenerated locally
// (no-committed-baselines rule) — with short validity (7 days) so a leaked
// fixture cert is worthless.
//
// Shells out to `openssl` (verified present on the dev machine, 3.0.13); fails
// with a clear message if absent. Zero Node dependencies.
//
// Usage: node gen-certs.mjs
// Outputs (in ./certs/):
//   ca.pem / ca-key.pem                     — throwaway CA #1 (untrusted — never imported)
//   server.pem / server-key.pem             — CN=127.0.0.1, SAN IP:127.0.0.1, signed by CA #1
//   client.pem / client-key.pem             — CN=Goldfinch Fixture Client (EKU clientAuth)
//   client.p12                              — PKCS#12 bundle (password: goldfinch) for
//                                             the NSS import helper / curl verification
//   trusted-ca.pem / trusted-ca-key.pem     — throwaway CA #2 (import-trust-anchor.mjs's subject)
//   server-trusted.pem / server-trusted-key.pem — CN=127.0.0.1, SAN IP:127.0.0.1, signed by CA #2

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const certsDir = path.join(here, 'certs');

const CA_SUBJECT = '/CN=Goldfinch Fixture Throwaway CA';
const SERVER_SUBJECT = '/CN=127.0.0.1';
const CLIENT_SUBJECT = '/CN=Goldfinch Fixture Client';
const P12_PASSWORD = 'goldfinch'; // fixture-only; documented in README.md
const DAYS = '7';
// Mission 20 Flight 2 Leg 4 (DD14): the SECOND CA subject — the exact
// nickname import-trust-anchor.mjs installs/removes as an NSS trust anchor.
// Keep these two literals in lockstep (mirrored in import-trust-anchor.mjs).
const TRUSTED_CA_SUBJECT = '/CN=Goldfinch Fixture Trusted CA';

function openssl(args) {
  const res = spawnSync('openssl', args, { cwd: certsDir, encoding: 'utf8' });
  if (res.error && res.error.code === 'ENOENT') {
    console.error('gen-certs: `openssl` not found on PATH — install openssl to generate the fixture certs.');
    process.exit(1);
  }
  if (res.status !== 0) {
    console.error(`gen-certs: openssl ${args.join(' ')} failed:\n${res.stderr || res.error}`);
    process.exit(1);
  }
}

fs.mkdirSync(certsDir, { recursive: true });

// 1) Throwaway CA (self-signed).
openssl(['req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-days', DAYS, '-nodes',
  '-keyout', 'ca-key.pem', '-out', 'ca.pem', '-subj', CA_SUBJECT]);

// 2) Server cert: CN=127.0.0.1 with a SAN IP entry (Chromium requires the SAN;
//    CN alone has been ignored for years). Extensions ride an ext file —
//    spawnSync has no shell process-substitution.
fs.writeFileSync(path.join(certsDir, 'server-ext.cnf'), [
  'subjectAltName = IP:127.0.0.1',
  'basicConstraints = CA:FALSE',
  'keyUsage = digitalSignature, keyEncipherment',
  'extendedKeyUsage = serverAuth',
  '',
].join('\n'));
openssl(['req', '-newkey', 'rsa:2048', '-sha256', '-nodes',
  '-keyout', 'server-key.pem', '-out', 'server.csr', '-subj', SERVER_SUBJECT]);
openssl(['x509', '-req', '-sha256', '-days', DAYS, '-in', 'server.csr',
  '-CA', 'ca.pem', '-CAkey', 'ca-key.pem', '-CAcreateserial',
  '-out', 'server.pem', '-extfile', 'server-ext.cnf']);

// 3) Client cert (EKU clientAuth — what makes it a candidate for the chooser).
fs.writeFileSync(path.join(certsDir, 'client-ext.cnf'), [
  'basicConstraints = CA:FALSE',
  'keyUsage = digitalSignature',
  'extendedKeyUsage = clientAuth',
  '',
].join('\n'));
openssl(['req', '-newkey', 'rsa:2048', '-sha256', '-nodes',
  '-keyout', 'client-key.pem', '-out', 'client.csr', '-subj', CLIENT_SUBJECT]);
openssl(['x509', '-req', '-sha256', '-days', DAYS, '-in', 'client.csr',
  '-CA', 'ca.pem', '-CAkey', 'ca-key.pem', '-CAcreateserial',
  '-out', 'client.pem', '-extfile', 'client-ext.cnf']);

// 4) PKCS#12 bundle for the NSS import helper (import-client-cert.mjs).
openssl(['pkcs12', '-export', '-inkey', 'client-key.pem', '-in', 'client.pem',
  '-certfile', 'ca.pem', '-name', 'Goldfinch Fixture Client',
  '-passout', `pass:${P12_PASSWORD}`, '-out', 'client.p12']);

// 5) SECOND throwaway CA (DD14) — the trust anchor import-trust-anchor.mjs
//    installs into the operator's own NSS user database. A distinct subject
//    from CA #1 keeps the untrusted and trusted rows independently
//    verifiable within the same session (never imported = untrusted;
//    imported = trusted).
openssl(['req', '-x509', '-newkey', 'rsa:2048', '-sha256', '-days', DAYS, '-nodes',
  '-keyout', 'trusted-ca-key.pem', '-out', 'trusted-ca.pem', '-subj', TRUSTED_CA_SUBJECT]);

// 6) Server cert signed by the trusted CA — the SAME SAN/extensions as (2)
//    (server-ext.cnf is reused byte-identical; Chromium's SAN requirement is
//    per-leaf-cert, not per-CA).
openssl(['req', '-newkey', 'rsa:2048', '-sha256', '-nodes',
  '-keyout', 'server-trusted-key.pem', '-out', 'server-trusted.csr', '-subj', SERVER_SUBJECT]);
openssl(['x509', '-req', '-sha256', '-days', DAYS, '-in', 'server-trusted.csr',
  '-CA', 'trusted-ca.pem', '-CAkey', 'trusted-ca-key.pem', '-CAcreateserial',
  '-out', 'server-trusted.pem', '-extfile', 'server-ext.cnf']);

console.log(`gen-certs: wrote throwaway CA + server + client certs into ${certsDir}`);
console.log('gen-certs: client.p12 password is "goldfinch" (fixture-only). All outputs are gitignored.');
console.log('gen-certs: wrote a SECOND throwaway CA (trusted-ca.pem) + server-trusted.pem — never trusted');
console.log('gen-certs: until `node import-trust-anchor.mjs --import` installs it (see README.md).');
