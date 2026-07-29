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

Chromium won't trust the throwaway CA and goldfinch has no
`certificate-error` handler, so the live check launches the app with
`npm run dev:automation -- --insecure-tls-fixtures` — the flag (dev-launch
script only, stripped before argv forwarding) appends Chromium's
`ignore-certificate-errors` switch. Packaged builds never run the dev-launch
script; there is no production path to the switch.
