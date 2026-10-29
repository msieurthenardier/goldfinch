# Squawk 0168: Behavior-test TLS fixtures start with expired certs instead of failing fast

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-10-28
**Completed**: 2026-10-28

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
Both fixture servers now run a startup expiry precheck in `readCert` (node:crypto `X509Certificate`, no new dependency, small duplicated helper per file, constant `EXPIRY_MARGIN_MS` = 1 h). A loaded certificate that is expired, not yet valid, or expires within the margin makes the server print the file, notBefore/notAfter and the `gen-certs.mjs` command to stderr and `process.exit(1)`, like the missing-cert path. No auto-regeneration.
- `tests/behavior/fixtures/third-party-cookies/serve.mjs`: checks `server.pem`.
- `tests/behavior/fixtures/web-compat/serve-tls.mjs`: checks the leaf and CA of the selected cert set (`server.pem`+`ca.pem`, or `server-trusted.pem`+`trusted-ca.pem`); the message also says to re-run `import-trust-anchor.mjs` / `import-client-cert.mjs --import` for NSS users.
- Docs: both fixture READMEs and the Preconditions lines of `third-party-cookie-isolation.md`, `tls-trust-surface.md`, `navigation-failure-surface.md`, `web-compat-client-cert.md` (one clause each: regenerate when the server refuses; re-import into NSS for web-compat).

## Verification
Copies of both fixture dirs were run from the scratchpad with substituted certs (real `certs/` untouched). Expired and inside-margin certs were issued with `openssl ca -startdate/-enddate` (OpenSSL 3.0.13).
- Real valid certs, each server on port 48713, HTTPS GET with verification off, killed by PID: third-party-cookies `200`, web-compat `200`.
- Expired cert (2026-01-02): both servers print the message and exit 1.
- Cert expiring in 30 min (inside margin): both servers print the message and exit 1.
- `npm run lint` clean; `npm run format:check` clean; `npm run typecheck` clean; `npm test`: 6055 tests, 6051 pass, 0 fail, 4 todo.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped review)
**Verdict**: confirmed, no blocking issues.
- Every loaded certificate is checked and no key file reaches `X509Certificate`; the single condition covers expired, not-yet-valid and inside-margin. `new Date(validTo)` matches `validToDate` on Node 22.
- Independently re-verified on scratchpad copies (real `certs/` untouched): both servers start on the real certs (web-compat in both cert sets), and refuse with exit 1 on paths the Developer didn't run: a not-yet-valid cert (third-party-cookies), an expired `server-trusted.pem` and a not-yet-valid `trusted-ca.pem` (`--cert-set trusted`), and an expired untrusted `ca.pem`. A bad untrusted set doesn't block the trusted set.
- NSS re-import advice confirmed: `import-trust-anchor.mjs` imports `trusted-ca.pem`, `import-client-cert.mjs` imports `client.p12`; regeneration replaces both.
- Gates: lint, format:check, typecheck clean; `npm test` 6055 (6051 pass, 0 fail, 4 todo).
- Accepted non-blocking: a malformed PEM exits 1 with a raw `X509Certificate` throw rather than the friendly message; `validToDate` would be marginally tidier on newer Node.

**Commit**: the `squawk/0168` commit on `squawk/0168-fixture-cert-expiry-precheck`
