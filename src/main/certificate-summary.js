// @ts-check
'use strict';

// Mission 20 Flight 2 Leg 2 (DD9): a pure, never-throwing, strings-only
// certificate summary — the shared shape `cert-trust.js` stamps on a refused
// interstitial and `cert-observer.js` records per verification. Every field
// is a string (or a capped array of strings); no PEM data, no Buffer, no
// Electron/Node object ever leaves this module. Built from Node's own
// `X509Certificate` parse of Electron's `certificate.data` PEM (SANs and hex
// fingerprints Electron's own `Certificate` shape lacks); on a parse failure
// (empty/garbage `data`) this falls back to Electron's own principal fields,
// with `fingerprints.sha256` seeded from Electron's single `fingerprint`
// field (documented as SHA-256) — never a thrown error either way.

const { X509Certificate } = require('node:crypto');

const SAN_CAP = 25;
const CHAIN_CAP = 10;

/**
 * Parse a Node `X509Certificate` `subject`/`issuer` string
 * (`"CN=x\nO=y\nL=z\nST=w\nC=v"`) into named fields. Unknown/absent keys stay
 * `''` — strings-only, never `undefined`.
 * @param {unknown} raw
 * @returns {{ commonName: string, organization: string, locality: string, state: string, country: string }}
 */
function parseNodeName(raw) {
  const out = { commonName: '', organization: '', locality: '', state: '', country: '' };
  if (typeof raw !== 'string' || raw.length === 0) return out;
  for (const line of raw.split('\n')) {
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key === 'CN') out.commonName = value;
    else if (key === 'O') out.organization = value;
    else if (key === 'L') out.locality = value;
    else if (key === 'ST') out.state = value;
    else if (key === 'C') out.country = value;
  }
  return out;
}

/** @param {unknown} raw @returns {string} */
function flattenNodeName(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return '';
  return raw.split('\n').join(', ');
}

/**
 * Electron's `CertificatePrincipal` shape (`commonName`, `organizations[]`,
 * `organizationUnits[]`, `locality`, `state`, `country`) — the fallback-path
 * mirror of `parseNodeName`. Only the FIRST organization is kept (strings-
 * only, single-value fields) — a documented simplification of the fallback
 * path only; the primary Node path never loses this (a single subject string
 * has no multi-value ambiguity to begin with).
 * @param {any} principal
 * @returns {{ commonName: string, organization: string, locality: string, state: string, country: string }}
 */
function parseElectronPrincipal(principal) {
  const out = { commonName: '', organization: '', locality: '', state: '', country: '' };
  if (!principal || typeof principal !== 'object') return out;
  out.commonName = typeof principal.commonName === 'string' ? principal.commonName : '';
  out.organization =
    Array.isArray(principal.organizations) && principal.organizations.length > 0
      ? String(principal.organizations[0])
      : '';
  out.locality = typeof principal.locality === 'string' ? principal.locality : '';
  out.state = typeof principal.state === 'string' ? principal.state : '';
  out.country = typeof principal.country === 'string' ? principal.country : '';
  return out;
}

/** @param {any} principal @returns {string} */
function flattenElectronPrincipal(principal) {
  const fields = parseElectronPrincipal(principal);
  return Object.entries({
    CN: fields.commonName,
    O: fields.organization,
    L: fields.locality,
    ST: fields.state,
    C: fields.country
  })
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join(', ');
}

/**
 * Cap a SAN list at `SAN_CAP` entries, appending a `'+N more'` summary string
 * when truncated (DD9). Never mutates the input.
 * @param {string[]} list
 * @returns {string[]}
 */
function capSan(list) {
  if (!Array.isArray(list)) return [];
  if (list.length <= SAN_CAP) return list;
  const kept = list.slice(0, SAN_CAP);
  kept.push(`+${list.length - SAN_CAP} more`);
  return kept;
}

/** @param {unknown} date @returns {string} */
function isoOrEmpty(date) {
  try {
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : '';
  } catch {
    return '';
  }
}

/**
 * Generic capped, cycle-safe chain walker (Mission 20 Flight 2 Leg 4,
 * acceptance-run fix F2). Starts at `leaf` itself (the certificate being
 * summarised) and walks upward via `getParent`, so `chain[0]` is always the
 * leaf's own subject/issuer. Terminates by VALUE comparison only — never
 * object identity, which Electron does not preserve across `issuerCert`/
 * `issuerCertificate` hops for a self-signed root (the root cause of the
 * duplicate-row bug this walker replaces): a certificate whose subject
 * equals its issuer (self-signed, by name) is pushed once and the walk
 * stops there; a certificate whose fingerprint matches the immediately
 * preceding one (the same cert handed back as a fresh object — or a true
 * reference cycle) is detected BEFORE pushing, so it is never duplicated
 * and the walk still terminates. `CHAIN_CAP` bounds the loop regardless.
 * @param {any} leaf
 * @param {{
 *   getSubject: (node: any) => string,
 *   getIssuer: (node: any) => string,
 *   getFingerprint: (node: any) => string,
 *   getParent: (node: any) => any,
 * }} ops
 * @returns {{ subject: string, issuer: string }[]}
 */
function walkChain(leaf, { getSubject, getIssuer, getFingerprint, getParent }) {
  const chain = [];
  let current = leaf;
  let prevFingerprint = '';
  while (current && chain.length < CHAIN_CAP) {
    const fingerprint = getFingerprint(current);
    if (fingerprint !== '' && fingerprint === prevFingerprint) break;
    const subject = getSubject(current);
    const issuer = getIssuer(current);
    chain.push({ subject, issuer });
    if (subject !== '' && subject === issuer) break;
    prevFingerprint = fingerprint;
    current = getParent(current);
  }
  return chain;
}

/**
 * Walk the Node `X509Certificate.issuerCertificate` chain starting at the
 * leaf itself (`x509`) — see `walkChain`.
 * @param {any} x509
 * @returns {{ subject: string, issuer: string }[]}
 */
function buildNodeChain(x509) {
  return walkChain(x509, {
    getSubject: (node) => flattenNodeName(node.subject),
    getIssuer: (node) => flattenNodeName(node.issuer),
    getFingerprint: (node) => (typeof node.fingerprint256 === 'string' ? node.fingerprint256 : ''),
    getParent: (node) => node.issuerCertificate
  });
}

/**
 * The fallback-path mirror of `buildNodeChain`, walking Electron's own
 * `Certificate.issuerCert` linkage starting at the leaf (`cert`) itself.
 * @param {any} cert
 * @returns {{ subject: string, issuer: string }[]}
 */
function buildElectronChain(cert) {
  return walkChain(cert, {
    getSubject: (node) => flattenElectronPrincipal(node && node.subject),
    getIssuer: (node) => flattenElectronPrincipal(node && node.issuer),
    getFingerprint: (node) => (node && typeof node.fingerprint === 'string' ? node.fingerprint : ''),
    getParent: (node) => node && node.issuerCert
  });
}

/**
 * Electron's own fields, never Node's parser — the degraded path for an
 * empty/garbage `cert.data` (a malformed certificate is exactly the case
 * that must never throw into a security-decision code path).
 * @param {any} cert
 * @param {string} status
 * @param {boolean} knownRoot
 * @param {string} [error]
 * @returns {ReturnType<typeof summarizeCertificate>}
 */
function fallbackSummary(cert, status, knownRoot, error) {
  let validFrom;
  let validTo;
  try {
    validFrom = cert && typeof cert.validStart === 'number' ? new Date(cert.validStart * 1000).toISOString() : '';
  } catch {
    validFrom = '';
  }
  try {
    validTo = cert && typeof cert.validExpiry === 'number' ? new Date(cert.validExpiry * 1000).toISOString() : '';
  } catch {
    validTo = '';
  }
  return {
    subject: parseElectronPrincipal(cert && cert.subject),
    issuer: parseElectronPrincipal(cert && cert.issuer),
    validFrom,
    validTo,
    serial: (cert && typeof cert.serialNumber === 'string' && cert.serialNumber) || '',
    fingerprints: { sha256: (cert && typeof cert.fingerprint === 'string' && cert.fingerprint) || '', sha1: '' },
    san: /** @type {string[]} */ ([]),
    chain: buildElectronChain(cert),
    knownRoot: !!knownRoot,
    status,
    ...(error ? { error: String(error) } : {})
  };
}

/**
 * Build a strings-only, capped, never-throwing certificate summary (DD9).
 * `status`/`error`/`knownRoot` are caller-supplied TRUST CONTEXT — this
 * module has no notion of trust policy and derives none of them.
 * @param {any} cert  Electron's `Certificate` object (`certificate-error`'s
 *   own argument, or the verify-proc's `request.certificate`)
 * @param {{ status?: string, error?: string, knownRoot?: boolean }} [ctx]
 * @returns {{
 *   subject: { commonName: string, organization: string, locality: string, state: string, country: string },
 *   issuer: { commonName: string, organization: string, locality: string, state: string, country: string },
 *   validFrom: string,
 *   validTo: string,
 *   serial: string,
 *   fingerprints: { sha256: string, sha1: string },
 *   san: string[],
 *   chain: { subject: string, issuer: string }[],
 *   knownRoot: boolean,
 *   status: string,
 *   error?: string
 * }}
 */
function summarizeCertificate(cert, ctx) {
  const { status = 'untrusted', error, knownRoot = false } = ctx || {};
  try {
    const data = cert && typeof cert.data === 'string' ? cert.data : '';
    if (!data) return fallbackSummary(cert, status, knownRoot, error);
    const x509 = new X509Certificate(data);
    let san = /** @type {string[]} */ ([]);
    try {
      san =
        typeof x509.subjectAltName === 'string' && x509.subjectAltName.length > 0
          ? x509.subjectAltName.split(',').map((s) => s.trim())
          : [];
    } catch {
      san = [];
    }
    // Mission 20 Flight 2 Leg 4 (live-discovered): `new X509Certificate(data)`
    // constructs a STANDALONE certificate object with no chain-walking
    // capability — `.issuerCertificate` only ever populates when Node builds
    // the object itself from a live, already-chain-verified TLS peer read
    // (e.g. `socket.getPeerX509Certificate()`), never from a bare PEM buffer
    // (confirmed live: `x509.issuerCertificate` is `undefined` for every real
    // fixture certificate this leg exercised, chain-bundled server `cert`
    // option or not — so `buildNodeChain` always yields exactly the leaf's
    // own row in that case, never a walked parent chain). Electron's OWN
    // `Certificate` object carries the real chain via `.issuerCert` linkage
    // (parsed from what the peer actually sent) — used here as a SUPPLEMENT
    // (leaf included) when Node's own walk found no parent link, never
    // overriding a genuine Node-derived chain.
    //
    // Acceptance-run fix pass F2 (2026-09-16): the OLD `nodeChain.length ===
    // 0` guard stopped working once both walkers began at the leaf (`chain`
    // is never actually empty for a successfully-parsed cert) — the correct
    // "Node found nothing beyond the leaf" signal is `!x509.issuerCertificate`.
    const nodeChain = buildNodeChain(x509);
    const chain = !x509.issuerCertificate && cert && cert.issuerCert ? buildElectronChain(cert) : nodeChain;
    return {
      subject: parseNodeName(x509.subject),
      issuer: parseNodeName(x509.issuer),
      validFrom: isoOrEmpty(x509.validFromDate),
      validTo: isoOrEmpty(x509.validToDate),
      serial: typeof x509.serialNumber === 'string' ? x509.serialNumber : '',
      fingerprints: {
        sha256: typeof x509.fingerprint256 === 'string' ? x509.fingerprint256 : '',
        sha1: typeof x509.fingerprint === 'string' ? x509.fingerprint : ''
      },
      san: capSan(san),
      chain,
      knownRoot: !!knownRoot,
      status,
      ...(error ? { error: String(error) } : {})
    };
  } catch {
    return fallbackSummary(cert, status, knownRoot, error);
  }
}

module.exports = { summarizeCertificate };
