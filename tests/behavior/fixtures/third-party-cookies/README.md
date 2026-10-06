# third-party-cookies fixture

Zero-dependency TLS fixture for the `third-party-cookie-isolation` behavior spec
(sortie 02). One port serves three distinct **sites**, routed by the request's
`Host` header (port stripped):

| Site | Origin | Role |
| ---- | ------ | ---- |
| A | `https://127.0.0.1:{fx}` | embedder / first-party cookie site |
| B | `https://localhost:{fx}` | the third party (cookie-setting frame, pixel, API) |
| C | `https://127.0.0.2:{fx}` | a second embedder (partition-leak check) |

The listener is dual-stack wildcard (`::`, falling back to `0.0.0.0`), so
`127.0.0.2` is reachable and `localhost` works over IPv4 or IPv6.

## Run

```
node tests/behavior/fixtures/third-party-cookies/gen-certs.mjs   # once; writes gitignored certs/
node tests/behavior/fixtures/third-party-cookies/serve.mjs --port {fx} --log {log}
```

`{fx}` must differ from the app's MCP port. The cert is self-signed (SAN covers
all three hosts); launch the app with `--insecure-tls-fixtures`
(`--ignore-certificate-errors`). `certs/` is gitignored; regenerate locally
(7-day validity). Needs `openssl`. The `--log` file is truncated on start.

## Paths (all hosts serve all paths; the spec uses the host named)

| Path | Behavior |
| ---- | -------- |
| `/health` | `200 ok` |
| `/b/set-fp` | top-level B page; sets unpartitioned `b_fp=1; SameSite=None; Secure` |
| `/a/set-fp` | top-level A page; sets `a_none` (None; Secure), `a_lax` (Lax), `a_strict` (Strict) |
| `/a/embed` | embedder; `?b=part-only` makes the B frame set only Partitioned cookies |
| `/c/embed` | embedder on C; embeds `/b/frame?report-only=1` |
| `/b/frame` | the claude-shaped frame, embedded `sandbox="allow-scripts allow-same-origin"`. Response sets `b_3p_unpart` (unpartitioned) and `__Host-b_part` (`Secure; Path=/; SameSite=None; Partitioned`); the script writes `js_unpart` and `js_part` (`Partitioned`) via `document.cookie`, then `postMessage`s `{cookieNames, writes}` to the embedder. `?report-only=1`: no Set-Cookie, no writes, report only. `?part-only=1`: only the partitioned cookies are set/written |
| `/b/sa-frame` | **unsandboxed** frame with a 280x40 **Request storage access** button at left:10 top:10; click relays `{storageAccess: "granted" \| "rejected:<ErrorName>", hasStorageAccess}` |
| `/b/pixel` | 1x1 GIF |
| `/b/api` | JSON `{ok:true}`; echoes `Access-Control-Allow-Origin` + `Allow-Credentials` for the request `Origin` |

Every cookie carries `Max-Age=3600`; every `Set-Cookie` header carries `Path=/` (the `document.cookie` writes in `/b/frame` use the default path). Embedders render the relayed reports,
merged, as JSON into `<pre id="frame-report" data-ready="0|1">` and mirror them in
`window.frameReport`. The embedder lays out the sandboxed frame (400x80) above
the sa-frame (400x80); locate the button by `captureScreenshot` and click by
coordinates (a trusted gesture inside the iframe).

## Log schema

JSONL, one line per request:

```
{ "ts": <ms>, "host": "<host without port>", "path": "<pathname>", "search": "<?query or ''>",
  "cookieNames": ["..."], "setCookieNames": ["..."] }
```

`cookieNames` are the cookie **names** on the incoming `Cookie` header;
`setCookieNames` are the names the response set. **Names only, never values.**
`search` is the raw query string (it distinguishes `/b/frame` from
`/b/frame?report-only=1`). The server-observed `Cookie` header is the spec's
ground truth.
