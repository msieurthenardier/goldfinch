# Squawk 0168: Behavior-test TLS fixtures start with expired certs instead of failing fast

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-10-28
**Completed**: —

## Report
Both TLS behavior fixtures generate gitignored throwaway certs with **7-day validity**, and both servers load them without checking the dates. Runs keep reaching setup with expired certs and only notice by chance:
- `third-party-cookie-isolation` run 2026-10-22-16-14-55: certs expired 2026-10-13; the Executor regenerated them ad hoc. Its Validator asked for "regenerate whenever expired, not only on the first run".
- `tls-trust-surface` run 2026-10-23-00-18-01: web-compat certs expired 2026-09-23; same ad hoc regen. Its Validator asked for "a cert-expiry precheck".
- Run 2026-10-28-22-10-53 started with certs that expire about 18 hours later.

How much expiry matters depends on the fixture. `third-party-cookies` runs under `--insecure-tls-fixtures` (`--ignore-certificate-errors`), so an expired cert is probably still accepted (not verified). The `web-compat` fixture backs `tls-trust-surface`, which asserts the interstitial and override flow for an untrusted issuer. An expired cert adds a date error that can change what that spec observes, and it backs the NSS-imported client cert (`web-compat-client-cert`).

Expected: a fixture server refuses to start on an expired (or nearly expired) cert, with a clear "run `gen-certs.mjs`" message, the same way it already refuses on a missing cert.

**Fix shape: fail fast, don't auto-regenerate.** Auto-regenerating in `serve-tls.mjs` would silently invalidate a web-compat CA or client cert the operator already imported into NSS (`import-trust-anchor.mjs`, `import-client-cert.mjs`, squawk 0166). A precheck keeps regeneration an explicit operator step. If the fix needs anything beyond the precheck plus a matching Preconditions line in the affected specs, escalate.

## Evidence
- `tests/behavior/fixtures/third-party-cookies/gen-certs.mjs` — `'-days', '7'`; `serve.mjs:readCert` — checks existence only (`missing certs/${name}` then `process.exit(1)`).
- `tests/behavior/fixtures/web-compat/gen-certs.mjs` — `-days DAYS` on CA, server, client and trusted-CA certs ("short validity (7 days) so a leaked…"); `serve-tls.mjs:readCert` — existence only.
- Current local certs: third-party-cookies `server.pem` notAfter 2026-10-29 16:15:57 GMT; web-compat `ca.pem`, `server.pem`, `client.pem`, `trusted-ca.pem`, `server-trusted.pem` notAfter 2026-10-30 00:19:5x GMT.
- Node 22+ `crypto.X509Certificate` exposes `validTo`, so no `openssl` call is needed at serve time.

## Corrective Action
*(written at completion)*

## Verification

## Sign-Off
*(written at completion)*
**Reviewer**:
**Verdict**:
**Commit**:
