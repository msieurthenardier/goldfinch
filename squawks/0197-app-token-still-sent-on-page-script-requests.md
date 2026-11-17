# Squawk 0197: The `goldfinch/<ver>` app token still goes out on page-script requests

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-16
**Completed**: —

## Report
Squawk 0169 removed the near-unique `goldfinch/<ver>` token from the web-guest User-Agent. It is still on the wire. One tab sends two different User-Agent values:

- navigations and subframe requests carry the stripped value, `… Chrome/156.0.8078.100 Electron/45.3.2 Safari/537.36`;
- requests made by the top frame's own document — XHR, fetch and subresources, first-party and third-party alike — carry `… goldfinch/0.19.14 Chrome/156.0.8078.100 Electron/45.3.2 Safari/537.36`.

`navigator.userAgent` reads the stripped value, so the page's own view and its request headers disagree. Every site and every third party a page calls still receives the token 0169 set out to remove.

Found during the squawk 0195 triage. It is **not** the cause of that failure: the unpatched build loads the site with farbling off.

Repro: launch with `--log-net-log=<file>`, open any page that makes script requests, quit, and list the distinct `User-Agent` values in the log's request-header events.

## Evidence
- `src/main/session-runtime.js` `onSessionCreated`: the one `session.setUserAgent(stripped)` site (0169). The network log shows it covers navigations and subframes, not the top-frame renderer's own requests.
- Network log, branch build on Windows, one tab on one site: the token-bearing value appears on renderer-supplied request headers (`CORS_REQUEST`) and on the sent h2/h3 headers for over thirty hosts; the stripped value appears on the main-document request and on subframe hosts.
- Probe in a throwaway copy (not a reviewed fix): setting `app.userAgentFallback` to the stripped value before any session is created made the log single-valued. The `--user-agent=` command-line switch changed nothing.
- 0169's live check compared `navigator.userAgent` on the main thread with a Worker's; it never read the wire.

## Corrective Action
*(written at completion)*

## Verification
*(written at completion)*

Note for whoever picks this up: a process-wide User-Agent change also reaches the chrome view and the internal session, and `test/unit/session-runtime.test.js` pins exactly one `setUserAgent(` site in `src/main`. Re-run the squawk 0145 Cloudflare check (`https://go.teamsnap.com/login/signin`) on the result. If the fix needs more than moving where the strip is applied, escalate rather than grow it.

## Sign-Off
*(written at completion)*
