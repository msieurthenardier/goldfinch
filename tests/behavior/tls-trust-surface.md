# Behavior Test: TLS Trust Surface

**Slug**: `tls-trust-surface`
**Status**: draft
**Created**: 2026-09-15
**Last Run**: never

## Intent

Verifies Mission 20 Flight 2 end to end on the live app: a navigation to an
origin with an untrusted certificate lands on an interstitial (never a blank
page) that names the origin and the exact error, offers a certificate viewer
and a gated proceed; proceeding is a human-only action (every automation op
is refused on the proceed card) that is remembered for that origin for the
session; the address chip, the site-info popup, and the automation census
carry one "not secure" vocabulary for plain `http:` and overridden pages
and read `secure` for a trusted page; the certificate viewer reads a real
certificate's subject, issuer, validity, fingerprint, and chain. The chain —
verify-proc observer → `certificate-error` → registry state → hidden guest →
push → panel/sheet/chip/census — is only observable on the live app; unit
tests pin each link but not the rendered result nor the engine's ordering.

## Preconditions

- The live rig is up: `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation`
  (WSLg). Launched **WITHOUT** `--insecure-tls-fixtures` (that flag appends
  `--ignore-certificate-errors`, which suppresses every certificate error).
  Admin MCP key by env-var reference ONLY (standing carry).
- Fixture certs generated with the Flight 2 generator:
  `node tests/behavior/fixtures/web-compat/gen-certs.mjs` (throwaway CA +
  server cert for the UNTRUSTED rows; second CA `trusted-ca.pem` + server
  cert for the TRUSTED rows; gitignored, 7-day validity).
- **Before launch**: the second CA imported as an NSS trust anchor —
  `node tests/behavior/fixtures/web-compat/import-trust-anchor.mjs` (uses
  `certutil` on `~/.pki/nssdb`; prints the removal command). The untrusted
  CA is NEVER imported.
- Two TLS fixtures on bind-probed free ports:
  `node tests/behavior/fixtures/web-compat/serve-tls.mjs --port {T}` (untrusted)
  and `node tests/behavior/fixtures/web-compat/serve-tls.mjs --port {T2} --cert-set trusted`.
  A plain-HTTP fixture for the insecure row:
  `python3 -u -m http.server {P} --bind {L} --directory tests/behavior/fixtures/keyboard-nav`
  (readiness by `ss -ltn` + a curl 200). `{L}` = a loopback host that
  refuses an unbound port (`127.0.0.2` under WSL2 mirrored networking — see
  `navigation-failure-surface.md`); `{Q}` = a second free port on `{L}` with
  nothing listening (the #216 regression row).
- Prechecks: `curl -k -m 3 https://127.0.0.1:{T}/` answers;
  `curl --cacert tests/behavior/fixtures/web-compat/certs/trusted-ca.pem -m 3 https://127.0.0.1:{T2}/`
  answers WITHOUT `-k`; `curl -m 3 http://{L}:{Q}/` fails with "Connection
  refused" immediately.
- At least one persistent jar exists. Close stale failed tabs restored from
  earlier sessions before step 0.
- **The operator is present** for step 6 (the proceed click cannot be driven
  by any automation op, by design).

## Observables Required

- rendered chrome state — `captureScreenshot` of the CHROME wcId
  (`getChromeTarget`; `captureWindow` paints the hidden guest over chrome
  panels on this rig — squawk 0075) and the chrome's accessibility tree
  (`readAxTree`)
- sheet state — `enumerateWindows` (`sheetWcId`, `sheetVisible`);
  `readAxTree` on the sheet wcId for the `site-info` and `cert-viewer`
  cards; the REFUSAL result of `readAxTree`/`evaluate`/`click` on the sheet
  wcId while the `cert-override` card shows (the refusal is the observable)
- app tab state — per-tab `url`, `loadState`, `loadError`, `security`,
  `active` via `enumerateTabs`
- chrome DOM drive — admin `evaluate` on the chrome wcId
  (`document.getElementById('load-failure-view-cert').click()`,
  `…('load-failure-advanced').click()`, `openSiteInfoOverlay()`); `pressKey`
  for the keyboard row (supplementary evidence only)
- guest DOM — `readDom` of the loaded fixture page (`#auth-state`)
- shell — `openssl x509 -noout -fingerprint -sha256 -in certs/server.pem`
  for the viewer's fingerprint row; fixture processes; `certutil` teardown

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 0 | Enumerate tabs; enumerate windows. | Every row has `loadState: "ok"`, `loadError: null`, and a `security` value; the window row has `sheetVisible: false`. *(active precondition check)* |
| 1 | Open a tab via `openTab` to `https://127.0.0.1:{T}/`. Wait up to 10 s. Capture the chrome. Read the chrome a11y tree. Enumerate tabs. | An interstitial in the page area — never blank — with a heading saying the connection is not private, the address `https://127.0.0.1:{T}/`, wording naming an untrusted/unknown certificate authority, the raw `ERR_CERT_AUTHORITY_INVALID` with its code, and three buttons: **Retry**, **View certificate**, **Advanced**. Census: `url` `https://127.0.0.1:{T}/`, `loadState: "cert-blocked"`, `loadError.name` `ERR_CERT_AUTHORITY_INVALID`, `security: "none"`. |
| 2 | Capture the chrome framing the strip and address bar; read the chip's accessible name. | The strip entry carries the warning glyph and the host title; the address bar reads the intended address; the chip's name does not claim a secure connection. |
| 3 | `evaluate` a click on `#load-failure-view-cert`. Wait 1 s. Enumerate windows; read the sheet a11y tree. In the shell, compute the untrusted server cert's SHA-256 fingerprint. | `sheetVisible: true`; the sheet's tree is READABLE and shows a certificate card with subject CN `127.0.0.1`, issuer CN `Goldfinch Fixture Throwaway CA`, a validity window (7 days), a SHA-256 fingerprint EQUAL to the shell's, a chain of two entries (server → CA), and a status line reading not trusted with `ERR_CERT_AUTHORITY_INVALID`. |
| 4 | Open a second tab via `openTab` to `about:blank` (closes the card via tab switch), then `activateTab` back to the first tab. Enumerate windows. | `sheetVisible: false`; the interstitial is projected again on the first tab. |
| 5 | `evaluate` a click on `#load-failure-advanced`. Wait 1 s. Enumerate windows. Attempt `readAxTree`, `evaluate`, and `click` on the sheet wcId. | `sheetVisible: true`; ALL THREE ops on the sheet are refused (an error/refusal result, not sheet content) — the proceed card is not readable or drivable by automation at the admin tier. |
| 6 | **OPERATOR**: on the visible card, confirm focus starts on **Back to safety**, then click **Proceed to 127.0.0.1:{T} (unsafe)**. Executor: wait up to 10 s, then capture the chrome, read the chip's accessible name, read the guest DOM, enumerate tabs and windows. | The interstitial is gone and the fixture page shows (`#auth-state` = `no-client-cert`); `sheetVisible: false`; the strip entry is ordinary; the chip's name says **not secure** and mentions the overridden certificate; census: `loadState: "ok"`, `loadError: null`, `security: "overridden"`, `url` unchanged. |
| 7 | `evaluate` `openSiteInfoOverlay()`. Wait 1 s. Read the sheet a11y tree. | The site-info card is READABLE: host `127.0.0.1:{T}`, a Connection row reading not secure with the certificate error overridden, and a **Certificate** action. |
| 8 | Close the card via tab switch (open `about:blank` via `openTab`, then `activateTab` back to the first tab). | (setup; no judgment) |
| 9 | Open a third tab via `openTab` to `https://127.0.0.1:{T}/` (same jar). Wait up to 10 s. Enumerate tabs. Capture the chrome. | The page loads DIRECTLY with no interstitial (the decision is remembered for the origin); census `loadState: "ok"`, `security: "overridden"`. |
| 10 | Navigate the third tab to `http://{L}:{P}/links.html`. Wait up to 10 s. Read the chip's name. `evaluate` `openSiteInfoOverlay()`; read the sheet a11y tree. Enumerate tabs. | Chip name says not secure (no certificate mention); the site-info Connection row reads not secure (HTTP); census `security: "insecure"`. |
| 11 | Navigate the third tab to `https://127.0.0.1:{T2}/` (the trusted fixture). Wait up to 10 s. Capture the chrome. Read the chip's name. Enumerate tabs. Close any card via tab switch, then `evaluate` `openSiteInfoOverlay()` and read the sheet a11y tree. | No interstitial; the page shows; the chip's name does NOT say not secure; census `security: "secure"`, `loadState: "ok"`; the site-info Connection row reads secure (HTTPS) and offers **Certificate**. |
| 12 | Close the card (tab switch and back). Open the viewer through the product path: `evaluate` `openCertificateViewer()` on the chrome (the site-security controller's seam-published opener for the ACTIVE tab's real certificate — never the synthetic audit hook). Read the sheet a11y tree. In the shell, compute `server-trusted.pem`'s SHA-256 fingerprint. | The viewer is READABLE: subject CN `127.0.0.1`, issuer CN of the trusted fixture CA, fingerprint EQUAL to the shell's, chain of two, status line reading trusted. |
| 13 | Open a fresh tab via `openTab` to `about:blank`. On the chrome: focus `#address` and read the focused node; set `#address` to `http://{L}:{Q}/` and press Enter (the typed path — #216's regression row). Wait up to 10 s. Read the focused node. Press F6, read; press Tab up to 6 times, reading after each. | After the typed failure the focused node is the panel heading, not `<body>`; F6 lands on the heading; Tab reaches Retry. `[a11y]` *(HAT-only clause: a visible focus ring on Retry — #216's retroactive-fail condition.)* |
| 14 | Navigate that tab to `https://localhost:{T}/` (the same untrusted fixture under a different host name: a fresh override key, and `ERR_CERT_COMMON_NAME_INVALID` because the cert's SAN is `IP:127.0.0.1` only). Wait up to 10 s. Read the chrome a11y tree. Press F6; Tab until the focused node is **Advanced**; press Enter. Enumerate windows. Then close the card by tab switch. | The interstitial shows `ERR_CERT_COMMON_NAME_INVALID` with name-mismatch wording (or `ERR_CERT_AUTHORITY_INVALID` if Chromium reports the authority error first — either is a fresh interstitial); keyboard reaches Advanced; Enter opens the card (`sheetVisible: true`). *(No proceed — this origin stays refused.)* |
| 15 | Stop both TLS fixtures and the HTTP server; remove the trust anchor (`node …/import-trust-anchor.mjs --remove`). | (cleanup; no judgment) |

**Row notes**: DRAFT — leg 4 (`security-indicator-and-certificate-viewer`) finalises the opener name in step 12 before its run; the error class in step 14 is resolved by leg 1's spike (i) and reflected in leg 2's classification table (leg 3 supplies only the keyboard half of that step).

## Out of Scope

- Persistence across app restart (unit grep-AC: `cert-trust.js` imports no
  storage; a relaunch is not part of this run).
- A second jar's independence of the override (unit-pinned key shape; the
  HAT walks it).
- Subframe/subresource certificate errors (silently refused; DD1).
- Popup windows with certificate errors (accepted gap; DD1).
- Renderer crashes and hangs — Flight 3.
- Rendered focus ring under automation (step 13's HAT-only clause).

## Variants (optional)

- **`external-trusted`** — if the NSS trust anchor is not honoured on this
  rig (spike (g)), steps 11–12 run against one operator-confirmed external
  `https:` host instead of `{T2}`; the run log records the substitution.
