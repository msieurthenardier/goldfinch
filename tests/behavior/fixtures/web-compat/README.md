# web-compat fixture server

Zero-dependency Node fixture server for the Mission 14 web-compat behavior
specs (`web-compat-fullscreen`, `web-compat-basic-auth`, `web-compat-pdf`,
plus the mission-13 carry-forward 302 re-run). Modeled on
`../cross-jar-fetch/serve.mjs`: loopback bind only, CLI args, JSONL request
log, all assets generated in memory at boot — no committed binaries.

## Usage

```
node serve.mjs --port <port> [--log <path>]
```

`--log` is optional; when given, every request appends a JSON line
`{ ts, path, range }` to the file (truncated at boot).

Pick a port that does not collide with the app's MCP automation port.

## Endpoints

This list grows as flight legs land:

- `GET /video.html` — fullscreen test page: an embedded `<video>` (source
  `/media.wav`), a visible **Enter fullscreen** button calling
  `video.requestFullscreen()`, and a `#fs-state` element kept live by a
  `fullscreenchange` listener (the spec's observability seam:
  `inactive` / `active`, or `error: <name>` if the request rejects).
- `GET /media.wav` — in-memory generated 30 s WAV sine (16-bit PCM mono),
  with single-range `Range` support. Decoded video frames are deliberately
  not required — fullscreen mechanics are what's under test.

- `GET /protected` — HTTP basic auth (F1 L2): 401 `WWW-Authenticate: Basic
  realm="fixture"` until valid `fixtureuser`/`fixturepass` credentials
  arrive; then 200 HTML echoing the username only. The JSONL log records
  Authorization presence/validity/match — never the header value.
- `GET /doc.pdf` — (F1 L4) in-memory generated 3-page PDF (large distinctive
  Helvetica text per page, so scroll position and page identity are real
  observables), served `Content-Disposition: inline` — the `web-compat-pdf`
  spec's inline-render + no-auto-download subject.
- `GET /doc-attachment.pdf` — the same PDF bytes with `Content-Disposition:
  attachment` — must download, never render.
- `GET /redirect-302` — 302 whose `Location` is the `?to=<url>` query value
  when given, defaulting to the pinned cross-scheme target
  `data:text/html,redirected` (refused by `isSafeTabUrl`; the mission-13
  `tab-scheme-guard` carry-forward endpoint for the deferred steps 14-15
  re-run).
- `GET /oauth/opener.html` — (F2 L2, `web-compat-oauth-popup`) OAuth-popup
  opener: a **Sign in with popup** button calling
  `window.open('/oauth/popup.html', 'oauth', 'width=420,height=520')` (the
  DD3-qualifying features + named-target + `new-window`-disposition shape —
  since M14 F2 this opens a **real popup window**, not a tab), a
  `#popup-state` line (`none`/`open`/`blocked`/`closed`, driven by polling the
  live handle's `.closed`), and `#result`, which receives the popup's
  postMessage token and acks it back. The live handle is exposed as
  `window.__oauthPopup` for jar-runnable spec assertions.
- `GET /oauth/popup.html` — the popup, provider-shaped: **holds** at
  `#status` `awaiting-approval` until its `#approve` button is clicked (the
  spec's window to census/drive the popup by wcId), then posts
  `{type:'oauth-token', token}` to its opener (same-origin targeted, brief
  retry), waits for `{type:'oauth-ack'}`, and self-closes via
  `window.close()` (the guest-shim path). `#status` reads
  `awaiting-approval`/`delivering`/`acked`/`no-opener`.

## TLS sibling: client-certificate fixture (F1 L3)

The client-cert leg uses a sibling TLS server, not `serve.mjs`:

```
node gen-certs.mjs                     # once per machine/profile (regenerate any time)
node serve-tls.mjs --port <port> [--log <path>]
```

- **`gen-certs.mjs`** shells to `openssl` (fails with a clear message if
  absent) and writes a throwaway CA + server cert (CN=127.0.0.1, SAN IP) +
  client cert (`CN=Goldfinch Fixture Client`, EKU clientAuth) + a PKCS#12
  bundle `client.p12` (password `goldfinch`, fixture-only) into `./certs/`.
  **Everything in `certs/` is gitignored** — regenerated locally, never
  committed (no-committed-baselines rule); validity is 7 days.
- **`serve-tls.mjs`** runs `https.createServer` with `requestCert: true`,
  `rejectUnauthorized: false`: the handshake *requests* a client cert but
  cert-less connections still complete, so the page can serve the
  distinguishable states the behavior spec reads — `#auth-state` is
  `client-cert-presented` or `no-client-cert`. The JSONL log records
  presence/authorization booleans only, never certificate contents.
- Curl verification (from `./certs/`):
  `curl -k --cert client.pem --key client-key.pem https://127.0.0.1:<port>/`
  → authenticated marker; `curl -k https://127.0.0.1:<port>/` →
  unauthenticated state.

### NSS import (operator-machine mutation, reversible)

For the *chooser-appears* live check, Chromium must find the client cert in
the OS store (the user NSS database):

```
node import-client-cert.mjs --import   # pk12util -i certs/client.p12 -d sql:$HOME/.pki/nssdb
node import-client-cert.mjs --remove   # certutil -D -d sql:$HOME/.pki/nssdb -n "Goldfinch Fixture Client"
```

- **Prerequisite**: `pk12util`/`certutil` from the **`libnss3-tools`**
  package (not installed by default — `sudo apt install libnss3-tools`). The
  helper prechecks both binaries and fails with this hint before touching
  anything; it never installs packages itself.
- **This mutates the operator's `~/.pki/nssdb`** — flagged deliberately. The
  import is fully reversed by `--remove` (deletes exactly the fixed
  nickname). If the NSS database has never been initialized:
  `certutil -d sql:$HOME/.pki/nssdb -N --empty-password`.
- Without the import, `select-client-certificate` never fires (Electron
  continues cert-less when no certificate matches) — the chooser legitimately
  does not appear and the page loads in the unauthenticated state.

### Dev-only TLS trust bypass

Chromium won't trust the throwaway CA, and goldfinch now answers that for
real: `app.on('certificate-error')` (`src/main/app-lifecycle.js`) delegates
to `src/main/cert-trust.js` (Mission 20 Flight 2) — refuse, or allow when the
origin is remembered, decided and answered synchronously at once. The
client-cert leg above has nothing to do with TLS trust decisions, though —
it needs Chromium to skip certificate verification ENTIRELY rather than
exercise the interstitial/override flow — so its live check still launches
the app with `npm run dev:automation -- --insecure-tls-fixtures`. The flag
(dev-launch script only, stripped before argv forwarding) appends Chromium's
`--ignore-certificate-errors` switch. Packaged builds never run the
dev-launch script; there is no production path to the switch.

**This flag suppresses the `certificate-error` event entirely** — the event
never reaches `cert-trust.js`. The TLS-trust behavior spec (Mission 20
Flight 2) launches the app **WITHOUT** it, so `certificate-error` fires for
real and `cert-trust.js` makes the decision.

## Second CA: the trusted fixture (Mission 20 Flight 2 Leg 4, DD14)

`gen-certs.mjs` also writes a SECOND throwaway CA (`trusted-ca.pem`/
`trusted-ca-key.pem`, subject `CN=Goldfinch Fixture Trusted CA`) and a server
cert signed by it (`server-trusted.pem`/`server-trusted-key.pem`, same
SAN/validity shape as the default set) — everything still under `./certs/`,
still gitignored. The TLS-trust behavior spec needs BOTH an untrusted row
(`ERR_CERT_AUTHORITY_INVALID`, the existing CA) and a trusted row reachable
in the SAME session, with no mid-run trust-store change.

```
node gen-certs.mjs                                          # writes both CA/cert pairs
node serve-tls.mjs --port <T>                                # untrusted (default, unchanged)
node serve-tls.mjs --port <T2> --cert-set trusted             # trusted — needs the import below
```

- **`serve-tls.mjs --cert-set trusted`** serves `server-trusted.pem` signed
  by the trusted CA (`--cert-set untrusted`, the default, is byte-identical
  to the pre-Leg-4 behavior). Verify with `curl --cacert trusted-ca.pem
  https://127.0.0.1:<T2>/` — succeeds **without** `-k`, once the anchor below
  is imported (before that, it fails exactly like the untrusted set does).
- **`import-trust-anchor.mjs`** (beside `import-client-cert.mjs`, the SAME
  `certutil`/`~/.pki/nssdb` precheck shape) installs/removes the trusted CA
  as an NSS user trust anchor:
  ```
  node import-trust-anchor.mjs --import   # certutil -A -n "Goldfinch Fixture Trusted CA" -t "C,," -i trusted-ca.pem -d sql:$HOME/.pki/nssdb
  node import-trust-anchor.mjs --remove   # certutil -D -d sql:$HOME/.pki/nssdb -n "Goldfinch Fixture Trusted CA"
  ```
  `-t "C,,"` marks the CA trusted for SSL-server certificates only (the two
  trailing trust-flag positions — email, object-signing — are left unset).
  **This mutates the operator's `~/.pki/nssdb`** — the same disclosure as the
  client-cert import above; `--remove` fully reverses it and is **idempotent**
  (a missing nickname prints a note and exits 0, never a failure — covers a
  crashed prior run leaving the anchor behind). Verify either state directly:
  `certutil -L -d sql:$HOME/.pki/nssdb` (lists every nickname; the trusted
  anchor's presence/absence is the ground truth, not this script's own exit
  code alone).
- **Import BEFORE launch, remove AT TEARDOWN** — an anchor imported mid-session
  does not retroactively change decisions Chromium's network service already
  cached for that origin in the current run; always import first, then launch
  the app.
- Electron 44 on Linux was confirmed (Mission 20 Flight 2 Leg 1 spike, finding
  (g)) to honour NSS user trust anchors with no other configuration — no
  external-host fallback is needed for the trusted row.
