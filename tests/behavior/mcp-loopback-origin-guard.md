# Behavior Test: MCP loopback transport enforces the Origin/Host guard

**Slug**: `mcp-loopback-origin-guard`
**Status**: active
**Created**: 2026-06-13
**Last Run**: never

## Intent

Verify SC7's transport defense in the running app: the Goldfinch MCP server binds **loopback only** (`127.0.0.1`, never `0.0.0.0`/`::`), and its Origin/Host allow-list guard (`origin-guard.js`, wired to run **first** on every request in `mcp-server.js`) returns **403** for the request shapes a DNS-rebinding / hostile-page attacker would send, while letting a legitimate local non-browser tool through. It needs a behavior test rather than a unit test because the **wiring** — that the pure predicate actually runs ahead of the SDK on the real Node HTTP listener, with real `req.headers.host` / `req.headers.origin` / `req.socket.remoteAddress` — only manifests in the running server; the unit test (`automation-origin-guard.test.js`) covers the predicate in isolation. This spec exercises the guard end to end with `curl` and confirms a denied request reaches **no tool** (no side effect).

**Scope honesty (read before running).** The guard has three deny clauses: non-loopback **Host**, present-non-loopback **Origin**, and non-loopback **peer socket address**. The **peer-address** clause is **not** end-to-end exercised here — genuinely connecting from a non-loopback address needs a second NIC that a dev box may not have. That clause is **unit-tested** (`origin-guard.js` `isAllowed` / `automation-origin-guard.test.js`) and **bind-check-proxied** by Step 1 (a server bound only to `127.0.0.1` cannot receive a non-loopback peer in the first place). So SC7's "a non-loopback connection cannot reach it" is **bind + unit-backed here, not behavior-tested end to end** — stated plainly so a reader does not over-read the coverage.

## Preconditions

- Goldfinch is running via **`npm run dev:automation`** (no `--remote-debugging-port`); the MCP server is up on the loopback transport.
- `curl`, `ss` (or `lsof`/`netstat`), and Bash are available.
- **Port (load-bearing for every URL below).** Pin the listen port with **`GOLDFINCH_MCP_PORT`** (default `49707`); export it once at launch and reuse it in all curl calls.
- A legitimate MCP client is available (for Step 7's side-effect check) pointed at `http://127.0.0.1:$GOLDFINCH_MCP_PORT/mcp`.
- **Apparatus note:** the apparatus is **`curl` (shell/http frame) plus a bind-address check (`ss`)** against the server on `127.0.0.1:$GOLDFINCH_MCP_PORT`, app launched via `npm run dev:automation` — **not** the `:9222` CDP path, and **not** the `chrome-devtools` MCP (which would launch its own browser and never touch this server). The endpoint is `/mcp`.
- **curl Host-replacement note (load-bearing):** `curl -H 'Host: <value>'` **replaces** (does not append to) the auto-generated `Host` header. So `curl -H 'Host: evil.example' http://127.0.0.1:$GOLDFINCH_MCP_PORT/mcp` sends `Host: evil.example` to a socket connected to `127.0.0.1` — exactly the spoofed-Host shape. Without a `-H 'Host: …'` override, curl sends `Host: 127.0.0.1:$GOLDFINCH_MCP_PORT` automatically, which is loopback. Each row below relies on this behavior; an Executor whose curl appends rather than replaces must use an equivalent raw-request tool.

## Observables Required

- http (HTTP response **status code** from the MCP server — measured via `curl -s -o /dev/null -w '%{http_code}'`; the guard's verdict is the status: 403 = denied, not-403 = passed the guard)
- shell (bind-address listing from `ss -tlnp` / `lsof`; curl exit/status — measured via Bash)
- mcp (the legitimate client's `enumerateTabs` result, for the Step-7 no-side-effect check — measured via the MCP client)

## Steps

| # | Actions | Expected Results |
|---|---------|------------------|
| 1 | **Active-precondition probe.** Run `ss -tlnp` (or `lsof -iTCP -sTCP:LISTEN -n -P` / `netstat -an`) and locate the listener on port **$GOLDFINCH_MCP_PORT** (default 49707). | A listener exists on **`127.0.0.1:$GOLDFINCH_MCP_PORT`** specifically — **not** `0.0.0.0:$GOLDFINCH_MCP_PORT` and **not** `[::]:$GOLDFINCH_MCP_PORT`. This is the SC7 bind check (and the proxy for the peer-address clause: a loopback-only bind cannot accept a non-loopback peer). **If the bind is `0.0.0.0`/`::`, or nothing is listening on `$GOLDFINCH_MCP_PORT`, halt — preconditions not met.** |
| 2 | **Loopback, no Origin (the pass clause).** `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$GOLDFINCH_MCP_PORT/mcp` (curl auto-sends `Host: 127.0.0.1:$GOLDFINCH_MCP_PORT`, **no** `Origin`). | The status is **NOT 403** — the guard **allowed** the request (the no-Origin + loopback-Host **pass** clause: `isAllowed` returns true when Host is loopback, peer is loopback, and Origin is absent). Assert "**not the guard's 403**", **NOT** "200": a bare `GET /mcp` may draw a non-403 4xx (e.g. 400/406) from the MCP/SDK layer for a non-handshake request — that still proves the guard passed (the request reached past the guard into the SDK). |
| 3 | **Non-loopback Host → deny.** `curl -s -o /dev/null -w '%{http_code}' -H 'Host: evil.example' http://127.0.0.1:$GOLDFINCH_MCP_PORT/mcp`. | The status is **403**. This proves the **Host-loopback clause** fired (`isAllowed` step 1: `!isLoopbackHostname(host)` → deny) — a non-loopback `Host` is rejected even though the socket connected to `127.0.0.1`. |
| 4 | **Non-loopback Origin → deny.** `curl -s -o /dev/null -w '%{http_code}' -H 'Origin: http://evil.example' http://127.0.0.1:$GOLDFINCH_MCP_PORT/mcp` (curl's auto `Host: 127.0.0.1:$GOLDFINCH_MCP_PORT` stays loopback; only the Origin is hostile). | The status is **403**. This proves the **Origin-present-non-loopback clause** fired (`isAllowed` step 3: Origin present and `!isLoopbackHostname(originHost(origin))` → deny) — isolated from the Host clause, since the Host here is loopback. (A rendered hostile page always sends an Origin; this is the page-defense branch.) |
| 5 | **DNS-rebinding shape → deny (load-bearing SC7 control).** `curl -s -o /dev/null -w '%{http_code}' -H 'Host: 127.0.0.1:$GOLDFINCH_MCP_PORT' -H 'Origin: http://attacker.example' http://127.0.0.1:$GOLDFINCH_MCP_PORT/mcp`. | The status is **403**. This is the rebinding attack shape — a hostile page that has rebound a public name to `127.0.0.1` sends a **loopback Host** but its own **non-loopback Origin**. The **Origin clause** defeats it even though the Host passes the loopback test. This is the load-bearing SC7 control (binding loopback alone is not sufficient; the Origin pin is). |
| 6 | **Loopback Host, mismatched port → allow (deliberate port-agnostic rule).** `curl -s -o /dev/null -w '%{http_code}' -H 'Host: 127.0.0.1:9999' http://127.0.0.1:$GOLDFINCH_MCP_PORT/mcp`. | The status is **NOT 403** — allowed. `bareHost` strips the port, so `Host: 127.0.0.1:9999` normalizes to loopback `127.0.0.1` and passes; DD3 keys on the **loopback-ness of the host, not the port** (a decision, not an oversight). The `9999` in the Host header is deliberately **not** the listen port — it is the mismatched-port control proving the guard is port-agnostic. Again assert "not 403", not "200" (the bare request may draw a non-403 4xx from the SDK). |
| 7 | **[mixed-frame] Guard runs before any MCP processing (no side effect).** Via the **legitimate** MCP client, call `enumerateTabs` and record the tab set (call it **T0**). Then fire a guard-denied request (the Step-3 or Step-5 shape, which returns 403). Then call `enumerateTabs` again via the legitimate client (**T1**). | The 403'd request causes **no state change**: **T1 equals T0** — the same set of tabs, none opened/closed/navigated by the denied request. This makes "the denied request reached no tool" an **observable** (not an unfalsifiable claim): if the guard ran *after* MCP dispatch, the request could have mutated tab state. `[mixed-frame]` — justification: the deny verdict is an HTTP observable (403), but "no tool executed" is only observable through the MCP tab-state frame; pairing them is the only way to prove the guard is truly *ahead* of the SDK. |

## Out of Scope

- **Key authentication half of SC7 (Flight 4).** The per-request key/auth gate and audit are a Flight-4 concern; this spec covers only the **transport origin/host/bind** half of SC7.
- **The peer-address deny clause, end to end.** Not behavior-tested here (needs a non-loopback NIC). It is **unit-tested** (`automation-origin-guard.test.js`) and **bind-check-proxied** by Step 1. See "Scope honesty" in Intent.
- **The MCP tool happy path** (that the tools work once past the guard) — covered by `mcp-drive-end-to-end`. This spec is the **guard / transport** gate only; the Step-7 `enumerateTabs` calls are used purely as a side-effect probe, not to verify tool behavior.

## Variants (optional)

- N/A. Could later parametrize Steps 3–5 over additional hostile authorities (IPv6 literals, the `"null"` opaque Origin, bracketed `[::1]` forms) once the predicate's edge handling is the focus.
