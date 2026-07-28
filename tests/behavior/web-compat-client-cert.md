# Behavior Test: Client-Certificate Chooser

**Slug**: `web-compat-client-cert`
**Status**: active
**Created**: 2026-07-27
**Last Run**: never

## Intent

Verifies that a TLS server requesting a client certificate causes a chooser sheet to appear instead of a silent failure, and that choosing/cancelling behaves cleanly. Chromium caches the choice per session per host (accepted at mission level), so each run needs a fresh profile. Live TLS against a throwaway CA requires the dev-only trust bypass — this spec is only valid under the automation dev launch, never a packaged build.

## Preconditions

- Fixture certs generated: `node tests/behavior/fixtures/web-compat/gen-certs.mjs` (throwaway CA + server cert + client cert, gitignored, regenerated locally).
- TLS fixture running: `node tests/behavior/fixtures/web-compat/serve-tls.mjs --port {P}` with `requestCert: true`.
- Client certificate imported into the NSS user store per the fixture README: `node tests/behavior/fixtures/web-compat/import-client-cert.mjs --import` (`libnss3-tools` required; the helper prechecks and fails with the install hint — operator-checked; reversible via `--remove`). Without it the select-client-certificate event never fires (Electron continues cert-less when no certs match) — the chooser legitimately does not appear and the page loads unauthenticated.
- Fresh-profile recipe: `dev-launch.mjs` has no profile flag today — the run session defines how a fresh profile is achieved (documented in the run log when this spec first executes; expected at HAT).
- App launched via the automation dev path **with the dev-only TLS trust bypass**: `npm run dev:automation -- --insecure-tls-fixtures` (the flag is stripped by the launch script and appends Chromium's `ignore-certificate-errors` switch; dev-launch-only by construction), fresh profile.

## Observables Required

- browser (sheet via `captureWindow`; page state via `readDom` — goldfinch MCP)
- shell (fixture lifecycle, cert generation — Bash)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | Open a tab to `https://127.0.0.1:{P}/`. | Within 3s a certificate chooser sheet appears listing at least the fixture client cert (subject visible). Page has not loaded. |
| 2 | Select the fixture certificate. | Sheet closes; page loads and shows the fixture's authenticated marker (server saw a client cert). |
| 3 | In the same session, open a new tab to the same origin. | Page loads directly with no chooser (session-cached choice — expected Chromium behavior). |
| 4 | Restart with a fresh profile (per this run's recipe — see Preconditions note), navigate again, and press Escape on the chooser. | Sheet dismisses; the handshake continues **without** a client cert and the page loads the fixture's distinguishable **unauthenticated** state (`#auth-state` = `no-client-cert`); app remains responsive; no hang. |

## Out of Scope

- Cert-choice persistence across restarts (Chromium session cache only).
- `certificate-error` UX for untrusted servers generally — out of this mission.
- Packaged-build behavior (dev-flag-gated environment only).
