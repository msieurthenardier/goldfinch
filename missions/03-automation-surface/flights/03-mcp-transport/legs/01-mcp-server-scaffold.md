# Leg: mcp-server-scaffold

**Status**: completed
**Flight**: [MCP-Compatible Local Server + Transport](../flight.md)

## Objective

Stand up an MCP `Server` over a loopback-only Streamable-HTTP transport (`127.0.0.1:7777`) inside the Electron main process, gated on `--automation-dev`, with the SC7 Origin/Host allow-list guard wired in the **same** leg so the server is never reachable without it — and prove an `initialize` handshake from a real client. No engine tools are registered yet (legs 2–3).

## Context

- **Flight DD1** — the official MCP SDK (`@modelcontextprotocol/sdk`) is the chosen implementation (operator go/no-go) — Goldfinch's deliberate **first runtime dependency**. Pin it to an exact version; confine it to the transport layer.
- **Flight DD2** — Streamable-HTTP via the SDK's `StreamableHTTPServerTransport`, fronted by a Node `http.createServer` bound to **`127.0.0.1` only**, fixed default port **`7777`**, overridable via `GOLDFINCH_MCP_PORT`. Started in `main.js` after `createWindow()`; stopped on shutdown. **Load-bearing premise to verify FIRST (do not assume): does `StreamableHTTPServerTransport` accept the raw Node `(req, res)` pair?** If it needs Express or a Fetch-API `Request`/`Response` shim, that triggers the **divert to hand-roll** (DD2 / Adaptation Criteria) — escalate, do not push forward.
- **Flight DD3** — Origin/Host allow-list lands **with** the server (defense-in-depth, never a window where the server binds without the guard). Reject/pass policy is precise (see Acceptance Criteria). The allow-list **predicate is pure** and unit-tested exhaustively.
- **Flight DD4** — gate the server on the **`--automation-dev`** flag specifically, **genuinely decoupled from `--remote-debugging-port`**. Add a `dev:automation` npm script launching with `--automation-dev --no-sandbox` (WSL) and **no** `--remote-debugging-port` (required so the Flight-3 DD10 DevTools test is confound-free).
  - **Gate-predicate decision (FD, incorporating design review):** the existing `isAutomationDevEnabled(argv)` returns true for `--automation-dev` **OR** `--remote-debugging-port`, so reusing it would make the MCP server **co-bind under `npm run dev:debug`** — re-introducing the multi-session-CDP confound DD10 exists to eliminate. Instead, add a **narrower** exported predicate to `src/shared/automation-dev.js` — `isMcpAutomationEnabled(argv)` — that matches **only** the `--automation-dev` token. The MCP server gates on this narrower predicate; the legacy `automation:dev-invoke` seam keeps using `isAutomationDevEnabled` unchanged. This makes CDP-decoupling **structural**, not a matter of operator procedure: `dev:debug` (CDP, no `--automation-dev`) does **not** start the MCP server. Note in JSDoc that `--automation-dev` is now also read in the **main** process (it was previously documented as the renderer-injected marker).
- **Prior art** — the interim dev seam (`main.js:736–748`, `ipcMain.handle('automation:dev-invoke', …)`) is the single automation entry point today; this leg stands up the transport that replaces it. The seam **stays in place this leg** as a fallback apparatus (its removal is a later concern — DD4); do not delete it here.
- The MCP server is server-side main-process code: it introduces **no new `webContents` session category**, so the mission's session-type-registry prerequisite does not apply (flight Prerequisites, confirmed).

## Inputs

What exists before this leg runs:
- `src/main/automation/engine.js` — `createEngine(getMainWindow)` exposing all 16 ops (Flights 1–2 landed).
- `src/shared/automation-dev.js` — `isAutomationDevEnabled(argv)` (true for `--automation-dev` OR `--remote-debugging-port`); its unit test is `test/unit/automation-dev.test.js`.
- `src/main/main.js` — `createWindow()` defined (~line 97), called at ~line 728; `mainWindow` module-scoped accessor; dev seam at ~736–748; `app.on('window-all-closed', …)` at ~755.
- `package.json` — zero runtime `dependencies` (only `devDependencies`); scripts include `dev`, `dev:debug`, `test` (`node --test test/unit/*.test.js`), `typecheck`, `lint`.
- No `dependencies` key carrying a runtime dep yet — this leg adds the first.

## Outputs

What exists after this leg completes:
- `@modelcontextprotocol/sdk` in `package.json` `dependencies` at an **exact pinned version** (no `^`/`~`), installed under Electron `^42` / Node 22 and importable in the main process.
- `src/main/automation/origin-guard.js` (new) — a **pure** loopback Origin/Host allow-list predicate (no I/O, no Electron deps).
- `src/main/automation/mcp-server.js` (new) — builds the MCP `Server`, fronts it with a `127.0.0.1`-bound Node `http` server + `StreamableHTTPServerTransport`, runs the origin guard before any MCP processing, returns 403 on reject; exposes `start()`/`stop()` (or equivalent) lifecycle. **No engine tools registered yet** — capabilities advertise an (empty) tools list; `initialize` succeeds.
- `src/shared/automation-dev.js` — adds `isMcpAutomationEnabled(argv)` (matches only `--automation-dev`); JSDoc notes `--automation-dev` is now read main-process-side too.
- `src/main/main.js` — module-scoped `mcpServer` var; mounts the MCP server behind the narrower `isMcpAutomationEnabled` gate after `createWindow()`; stops it on app shutdown.
- `package.json` — new `dev:automation` script: `electron . --enable-logging --no-sandbox --automation-dev`.
- `test/unit/automation-origin-guard.test.js` (new) — exhaustive unit tests of the pure predicate.
- `test/unit/automation-dev.test.js` — extend with cases for the new `isMcpAutomationEnabled` predicate (true for `--automation-dev` only; false for bare `--remote-debugging-port`).
- `CLAUDE.md` — a note that `@modelcontextprotocol/sdk` is the sanctioned first runtime dependency, confined to the transport layer (a stub is acceptable here; the full consumer-facing write-up is Leg 4 / `example-client-and-docs`).

## Acceptance Criteria

- [ ] **SDK premise verified first.** Before scaffolding, a live check confirms `StreamableHTTPServerTransport` works with the raw Node `http` `(req, res)` pair inside the Electron main process under Electron `^42`. The finding (pass, or which shim it needs) is recorded in the flight log. A negative finding halts the leg and escalates (divert to hand-roll) rather than silently adding Express.
- [ ] **SDK installed + pinned.** `@modelcontextprotocol/sdk` appears in `package.json` `dependencies` with an **exact** version (no range specifier); `npm ci`/`npm install` resolves it; `require`/`import` of the SDK succeeds in the Electron main process.
- [ ] **Loopback bind.** The Node `http` server binds **`127.0.0.1`** (not `0.0.0.0`, not `::`), default port `7777`, honoring `GOLDFINCH_MCP_PORT` when set.
- [ ] **Origin/Host guard is a pure predicate and runs first.** A pure function maps `(host, origin, peerAddress) → allow | deny` with the DD3 policy:
  - **Deny (403)** if `Host` is non-loopback, OR `Origin` is **present and** non-loopback, OR the peer socket address is non-loopback.
  - **Allow** a request with **no `Origin` header iff** its `Host` is loopback.
  The guard executes **before** any MCP/transport processing; a denied request gets a `403` and never reaches the SDK.
- [ ] **`initialize` handshake succeeds** from a real MCP client (SDK client or `curl` per the SDK's Streamable-HTTP framing) over `127.0.0.1:7777`; `tools/list` returns successfully (empty or near-empty — tools arrive in legs 2–3).
- [ ] **Dev-gated (structurally CDP-decoupled).** The server starts **only** when `isMcpAutomationEnabled(process.argv)` is true, i.e. **only** when `--automation-dev` is present. It must **not** start under `npm run dev` (no flag) and must **not** start under `npm run dev:debug` (`--remote-debugging-port`, no `--automation-dev`). `npm run dev:automation` (`--automation-dev --no-sandbox`, no CDP port) brings it up.
- [ ] **Clean lifecycle.** The server starts after `createWindow()` and is closed on app shutdown. The primary stop hook is `app.on('before-quit', …)` (fires on real quit across platforms, including macOS where `window-all-closed` does not quit); `window-all-closed` is a secondary stop. The port is released (no `EADDRINUSE` on relaunch). `stop()` is idempotent so both hooks firing is safe.
- [ ] **No engine-bypass invariant (forward-looking).** The MCP layer exposes **no** path to engine ops that bypasses the engine's `resolveContents` internal-session guard. Vacuously true this leg (no tools registered); stated so legs 2–3 honor it.
- [ ] **Unit tests green.** `automation-origin-guard.test.js` exhaustively covers the predicate (loopback/non-loopback Host, present/absent/loopback/non-loopback Origin, loopback/non-loopback peer, IPv4 `127.0.0.1`, IPv6 `::1`, `localhost`). `npm test`, `npm run typecheck`, `npm run lint` all pass.
- [ ] **SDK confined.** The SDK is imported only in `mcp-server.js` (and the `main.js` mount). `engine.js` and the `resolve`/`tabs`/`nav`/`input`/`observe` modules remain SDK-free.

## Verification Steps

- **SDK premise**: in a short main-process spike (or the server module's first wiring), construct `StreamableHTTPServerTransport` and route a raw Node `http` `(req,res)` to it; observe whether an `initialize` POST is handled without Express. Record outcome in flight log.
- **Loopback bind**: `node -e "require('net')"`-style or inspect the `server.listen('127.0.0.1', …)` call; after launch, `ss -tlnp | grep 7777` shows a `127.0.0.1:7777` bind (not `0.0.0.0`).
- **Guard predicate**: `npm test` — `automation-origin-guard.test.js` passes with the full case matrix.
- **403 path (live, integration — may defer the live half to Leg 6)**: `curl -s -o /dev/null -w '%{http_code}' -H 'Host: evil.example' http://127.0.0.1:7777/` → `403`; `curl … -H 'Origin: http://evil.example' …` → `403`; a loopback request with no `Origin` → not 403.
- **Handshake**: run the SDK client (or a `curl` initialize POST) against `127.0.0.1:7777`; `initialize` returns server capabilities; `tools/list` succeeds.
- **Gate**: `npm run dev` (no flag) → `7777` NOT listening; `npm run dev:debug` (`--remote-debugging-port`, no `--automation-dev`) → `7777` NOT listening (structural CDP-decoupling — the whole point of the narrower gate); `npm run dev:automation` (`--automation-dev`) → listening.
- **Static**: `npm run typecheck` and `npm run lint` clean.

## Implementation Guidance

1. **Verify the SDK premise FIRST (load-bearing — flight Open Question #1).**
   - Install `@modelcontextprotocol/sdk` (latest stable), then pin the resolved version exactly in `package.json` (replace any `^`).
   - Confirm `StreamableHTTPServerTransport` consumes the raw Node `(req, res)` pair (the SDK's `handleRequest(req, res, body?)` shape) without Express/Fetch shimming, and that it constructs/runs inside the Electron main process. If it needs a web framework or Fetch adapter → **STOP, record the finding, signal `[BLOCKED:sdk-premise]`** so the Flight Director can trigger the hand-roll divert (DD2). Do not add Express.

2. **Write the pure origin guard (`src/main/automation/origin-guard.js`).**
   - Export a pure predicate, e.g. `isAllowed({ host, origin, peerAddress }) → boolean`, implementing the DD3 reject/pass policy. Treat `127.0.0.1`, `::1`, `::ffff:127.0.0.1`, and `localhost` (with optional `:port`) as loopback; everything else non-loopback. A **present** `Origin` that is non-loopback → deny; an **absent** `Origin` with loopback `Host` → allow.
   - Keep it dependency-free and side-effect-free (it must be unit-testable with plain objects). Document the host/origin parsing assumptions in JSDoc (`@ts-check`, matching the module group's style).

3. **Build the server module (`src/main/automation/mcp-server.js`).**
   - `@ts-check`, `'use strict'`, matching the automation module conventions.
   - Construct the MCP `Server` (name `goldfinch`, version from `package.json` or a constant) advertising `tools` capability (empty registry for now — legs 2–3 populate it).
   - Create a Node `http.createServer` whose request handler **runs the origin guard first** (extract `req.headers.host`, `req.headers.origin`, `req.socket.remoteAddress`); on deny → `res.writeHead(403); res.end()` and return. On allow → hand `(req, res)` to the `StreamableHTTPServerTransport`.
   - `listen(port, '127.0.0.1')` where `port = Number(process.env.GOLDFINCH_MCP_PORT) || 7777`.
   - Expose `start()` and `stop()` (close transport + http server; idempotent). Inject the engine accessor (`getMainWindow` or a built engine) as a parameter so legs 2–3 can register tools without reshaping the constructor — but **register no tools yet**.
   - Decide the session model (stateful per-connection id vs stateless) per whatever the SDK makes simplest for one local consumer; document the choice in a comment (flight Open Question — acceptable variation).

4. **Add the narrower gate predicate.** In `src/shared/automation-dev.js`, add and export `isMcpAutomationEnabled(argv)` matching **only** the `--automation-dev` token (`Array.isArray(argv) && argv.includes('--automation-dev')`). Update the file's JSDoc to note `--automation-dev` is now also consulted in the **main** process (previously documented as the renderer-injected marker). Leave `isAutomationDevEnabled` unchanged (the legacy dev seam keeps it).

5. **Mount in `main.js` behind the dev gate.**
   - Declare a **module-scoped** `mcpServer` variable (alongside `mainWindow`, ~line 95) so the shutdown handlers can reach it.
   - Inside `app.whenReady().then(...)`, after `createWindow()` (near the existing dev-seam block ~730), add: `if (isMcpAutomationEnabled(process.argv)) { mcpServer = createMcpServer(...); mcpServer.start(); }`. Import `isMcpAutomationEnabled` alongside the existing `isAutomationDevEnabled` import (`main.js:16`). Keep the existing `automation:dev-invoke` seam in place (fallback apparatus this flight) — it stays on `isAutomationDevEnabled`.
   - Stop the server on shutdown: primary `app.on('before-quit', () => mcpServer?.stop())` (fires on real quit across platforms). For the secondary stop in `app.on('window-all-closed', …)` (`main.js:755`), place it **inside** the existing `if (process.platform !== 'darwin')` branch — `if (process.platform !== 'darwin') { mcpServer?.stop(); app.quit(); }` — so on macOS, where closing all windows does NOT quit (the app stays dock-resident), the server is **not** torn down while the app lives. `stop()` must be idempotent (both hooks may fire).

6. **Add the `dev:automation` script** to `package.json`: `"dev:automation": "electron . --enable-logging --no-sandbox --automation-dev"`.

7. **Unit-test the predicates** — `test/unit/automation-origin-guard.test.js` (new) for the guard, full case matrix from Acceptance Criteria; and extend `test/unit/automation-dev.test.js` with `isMcpAutomationEnabled` cases (true for `--automation-dev`; false for bare `--remote-debugging-port`, empty argv, non-array). Use `node:test` + `node:assert`, matching existing `automation-*.test.js` style.

8. **CLAUDE.md stub** — note the SDK as the sanctioned first runtime dep, confined to the transport layer (full docs land in Leg 4).

## Edge Cases

- **Port already in use (`EADDRINUSE`)**: surface a clear error (and the `GOLDFINCH_MCP_PORT` override hint); do not crash the whole app silently. Flight prerequisite says confirm `7777` is free before the leg.
- **`req.socket.remoteAddress` IPv6-mapped IPv4** (`::ffff:127.0.0.1`): must be treated as loopback by the guard.
- **Missing `Host` header** (HTTP/1.0 / malformed): treat as deny (fail closed).
- **Host-header port mismatch** (`Host: 127.0.0.1:9999` when bound to 7777): DD3 keys on loopback-ness of the host, not the port — so this is **allowed** (loopback is loopback). Deliberate; note it in the predicate JSDoc so it reads as a decision, not an oversight.
- **Server constructed but window closed before a request**: tools come later; for scaffold, just ensure no null-deref — the engine accessor is lazy.
- **Double-start / double-stop**: `start()`/`stop()` idempotent so the lifecycle hooks can't throw.
- **`--automation-dev` absent**: server must not bind at all (no port listening) — verify the negative case.

## Files Affected

- `package.json` — add `@modelcontextprotocol/sdk` (exact pin) to `dependencies`; add `dev:automation` script.
- `package-lock.json` — regenerated by the install.
- `src/main/automation/origin-guard.js` — new, pure predicate.
- `src/main/automation/mcp-server.js` — new, MCP server + transport + guard wiring + lifecycle.
- `src/shared/automation-dev.js` — add `isMcpAutomationEnabled(argv)` (narrow `--automation-dev`-only gate); JSDoc note.
- `src/main/main.js` — module-scoped `mcpServer`; mount behind `isMcpAutomationEnabled` gate after `createWindow()`; stop on `before-quit` + `window-all-closed`.
- `test/unit/automation-origin-guard.test.js` — new, exhaustive predicate tests.
- `test/unit/automation-dev.test.js` — extend with `isMcpAutomationEnabled` cases.
- `CLAUDE.md` — sanctioned-first-runtime-dep note (stub).

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]` (NOTE: this is an autonomous leg — do NOT commit; the Flight Director defers review + commit to the end of the flight):**

- [ ] All acceptance criteria verified (live-integration halves that need the GUI may be deferred to Leg 6 `verify-integration` and noted as such)
- [ ] Unit tests + typecheck + lint passing
- [ ] Update flight-log.md with a Leg Progress entry (incl. the SDK-premise finding and the chosen session model)
- [ ] Set this leg's status to `landed` (NOT `completed` — completion + flight.md check-off happen at the flight-level commit)
- [ ] Do NOT commit; do NOT check off the leg in flight.md yet
