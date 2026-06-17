# Leg: port-free-fallback

**Status**: completed
**Flight**: [Production gating re-architecture + dev-profile isolation + port free-fallback](../flight.md)

## Objective
Scope `GOLDFINCH_MCP_PORT` to **dev-only** (`honorEnv: !app.isPackaged`), make the dev env override **bind-exactly-or-fail-loudly**, give the setting/default path a **free-port fallback** (retry the real `listen` on the next free port on EADDRINUSE), and **capture + surface the actually-bound port** — without overwriting the persisted `automationPort` preference.

## Context
- **DD6** (operator: "env strict, else auto-fallback"; env scoped to dev 2026-06-17). The F7 HAT surfaced two Goldfinch instances contending for one port (mission Known Issue). Under F8 the surface now actually binds in production (leg 2), so this must be resolved.
- **Keep `resolvePort` pure (Architect principle):** today `resolvePort(getSettings)` reads `process.env.GOLDFINCH_MCP_PORT` unconditionally and is unit-tested electron-free (`test/unit/automation-port.test.js`). Do **not** add `app.isPackaged` inside it. Pass the decision in: `resolvePort(getSettings, { honorEnv })` where the call site supplies `honorEnv: !app.isPackaged`. The electron coupling lives in `startMcpServerInstance` / `createMcpServer`, not the pure function.
- **Bound-port capture (Architect — concrete):** `mcpServer.port` is a `const` fixed at construction (resolved port), and `currentAutomationStatus` reads `mcpStatus.port` set **pre-`start()`** (`main.js:141`). A `start()` that retries a different port would leave both **stale** → the UI shows the *attempted* port, not the *bound* one. So `start()` must expose the **final bound port** (a getter / mutable field), and `startMcpServerInstance` must capture it **post-`start()`**.
- **Ephemeral fallback:** a fallback bind does **not** overwrite the persisted `automationPort`. A fixed-port production deployment sets `automationPort` (UI / pre-seeded `settings.json`), not an env var.

## Inputs (current code, post-leg-4)
- `mcp-server.js`:
  - `DEFAULT_PORT = 49707` (`:128`).
  - `resolvePort(getSettings)` (`:152`) — precedence: valid `GOLDFINCH_MCP_PORT` env (any positive int) > range-bound persisted `automationPort` [1024,65535] > default; never throws.
  - `freePortInRange(lo=49152, hi=65535)` (`:170`) — first loopback-free port or null; **advisory** (documents its own TOCTOU).
  - `createMcpServer(opts)` — `const port = Number.isInteger(opts.port) && opts.port > 0 ? opts.port : resolvePort(getSettings);` (~`:254`); returns `{ start, stop, port, getActivity }` (~`:683`).
  - `start()` — single `listen(port, '127.0.0.1')`; on EADDRINUSE rejects with `'automation: MCP port ' + port + ' is in use — set GOLDFINCH_MCP_PORT to override'` (~`:624`); resets `started=false`/`httpServer=null` on error so a later retry can re-start.
- `main.js`:
  - `startMcpServerInstance()` — `mcpStatus = { enabled:true, host, port: mcpServer.port, bound:false, error:null }` **pre-start** (`:141`), then `await mcpServer.start(); mcpStatus.bound = true;`.
  - `currentAutomationStatus()` — `port: mcpStatus.port != null ? mcpStatus.port : resolvePort(() => settings)` (`:201`).
- `test/unit/automation-port.test.js` — `resolvePort` precedence + `freePortInRange` cases (electron-free).

## Outputs
- `resolvePort(getSettings, { honorEnv = true } = {})` — when `honorEnv` is false, the env is **ignored** (setting > default only). Default `true` preserves every existing caller/test.
- `createMcpServer` accepts `honorEnv` (default true) and threads it into `resolvePort`; `startMcpServerInstance` passes `honorEnv: !app.isPackaged`.
- `start()` resolves the port with **strict-vs-fallback** semantics and exposes the **final bound port**:
  - **Strict** (an explicit `opts.port`, or a dev env pin) → bind exactly or **reject loudly** on EADDRINUSE (no retry).
  - **Fallback** (setting/default, env not the source) → on EADDRINUSE, **retry the real `listen`** on the next free port (capped); reject with a clear error only if exhausted.
- The returned object exposes the bound port via a **getter** (`get port()`), updated by `start()`; `startMcpServerInstance` captures it **post-`start()`**; `currentAutomationStatus`'s would-be branch passes `honorEnv: !app.isPackaged`.
- The EADDRINUSE message is **build/mode-aware**; the fallback **never** writes `automationPort`.
- `automation-port.test.js` extended for both `honorEnv` modes; `start()`-level strict/fallback tests added.

## Acceptance Criteria
- [x] **`resolvePort` gains `honorEnv` (pure):** `resolvePort(getSettings, { honorEnv = true } = {})`; when `honorEnv === false`, `GOLDFINCH_MCP_PORT` is not read (setting > default). No `app.isPackaged` / electron inside the function. Default `true` keeps existing behavior.
- [x] **Env scoped to dev at the call sites:** `createMcpServer`/`startMcpServerInstance` resolve with `honorEnv: !app.isPackaged`; `currentAutomationStatus`'s would-be-port branch likewise passes `honorEnv: !app.isPackaged`. On a packaged build the env is ignored everywhere; the port comes from `automationPort` + free-fallback.
- [x] **Strict mode binds-exactly-or-fails-loudly:** when the port source is an explicit `opts.port` **or** a dev `GOLDFINCH_MCP_PORT` pin, `start()` attempts that port **once**; on EADDRINUSE it rejects (surface stays unbound, `mcpStatus.error` set, app does not crash) — it does **not** silently move. (A deliberate test pin must bind where asked.)
- [x] **Fallback mode retries the real listen (single, definitive shape):** when the port came from the setting/default (env not the source), `start()` on EADDRINUSE picks the next candidate via `freePortInRange(attempt + 1)` (advisory, fast) and then **the real `listen` is the authority** — if that races to EADDRINUSE again, loop. Capped at a sane retry count (e.g. ≤ 20); if exhausted (or `freePortInRange` returns null), reject with a clear "no free port found" error. *(This is the one prescribed approach — do NOT also blindly increment; the advisory probe only chooses a candidate, the real bind confirms it, which is what defeats the TOCTOU per DD6.)* The fallback is **ephemeral**: `start()`/`startMcpServerInstance` never call `settings.set('automationPort', …)`.
- [x] **Bound-port capture:** the server exposes the **final bound port** via a getter (`get port()` returning the mutable `boundPort` that `start()` sets on a successful listen, including a retried one). `startMcpServerInstance` sets `mcpStatus.port = mcpServer.port` **after** `await mcpServer.start()` resolves (post-start), so the Settings live-address UI shows the **bound** port, not the attempted one. On a bind failure the pre-start attempted port + the error remain visible.
- [x] **Two instances back-to-back both bind (the Known Issue):** *(mechanism + unit/integration coverage landed here; live two-instance verification deferred to leg 7 on the packaged build)* launching a second instance whose preferred port is taken falls back to a free port (verified live at leg 7; this leg provides the mechanism + unit/integration coverage).
- [x] **Build/mode-aware EADDRINUSE hint:** the error replaces the unconditional "set GOLDFINCH_MCP_PORT to override". Dev env-strict → mention the env (it must bind exactly; free the port or change the env). Fallback-exhausted (dev-no-env or packaged) → "no free port found" + (packaged) point at the Settings port control, not the env (which is ignored when packaged).
- [x] **Tests (no-hang discipline is MANDATORY, per the agentic-workflow hanging-test warning):** `automation-port.test.js` covers `honorEnv:false` (env set but ignored → setting/default), `honorEnv:true`/default (env honored — keeps the 9 existing cases green), and confirms the zero-arg `resolvePort()` call still works (default `honorEnv=true`). Add `start()`-level coverage: (a) **fallback** — occupy a port via `net.createServer().listen(0)` (OS-ephemeral, to avoid colliding with the fixed 7790/7791/7792 ports the `automation-mcp-server` suite uses in the same `node --test` process), start in fallback mode preferring that occupied port, assert it binds a *different* free port, `server.port` reflects the bound port, and `automationPort` was **not** written; (b) **strict** — occupy an ephemeral port, start in strict mode (explicit `opts.port` set to it, or a simulated env pin), assert `start()` rejects and does not move. **Both tests must wrap the occupier AND the started server in `try/finally` close**, and the retry cap must guarantee loop termination (assert it terminates, not just that it binds).
- [x] `npm test`, `npm run typecheck`, `npm run lint` pass; existing `resolvePort`/`freePortInRange` and server tests stay green.

## Verification Steps
- `npm test` — new `honorEnv` + strict/fallback cases pass; existing port tests unchanged-green.
- `npm run typecheck`, `npm run lint` — clean.
- **Code inspection:** `resolvePort` stays electron-free; `honorEnv: !app.isPackaged` at all three call sites; `start()` strict-vs-fallback; getter exposes the bound port; no `settings.set('automationPort')` in the fallback path.
- **Live (deferred to leg 7 on the packaged build):** preferred port occupied → `GOLDFINCH_MCP_PORT=<taken>` (dev) fails loudly, surface unbound; the setting/default path binds the next free port and surfaces it; two instances launched back-to-back both bind (different ports). Packaged: env ignored.

## Implementation Guidance
1. **`resolvePort`** — add the `{ honorEnv = true } = {}` second arg; gate the env read on `honorEnv`. Keep everything else identical (still never throws; default keeps existing tests green).
2. **`createMcpServer`** — accept `opts.honorEnv` (default true). Read the env **once** and derive strict robustly (avoids the double-`process.env`-read fragility the review flagged):
   ```js
   const explicit = Number.isInteger(opts.port) && opts.port > 0;
   const envRaw = opts.honorEnv ? process.env.GOLDFINCH_MCP_PORT : undefined;
   const envN = Number(envRaw);
   const envUsed = !explicit && Number.isInteger(envN) && envN > 0;   // !explicit short-circuit: explicit forces strict on its own
   const preferred = explicit ? opts.port : resolvePort(getSettings, { honorEnv: opts.honorEnv });
   const strict = explicit || envUsed;
   ```
   (Single env read into `envRaw`; `resolvePort` still reads env internally but synchronously at construction — deterministic. *Alternative if you prefer: have `resolvePort` report its source and derive `strict` from `source==='env'` — only if it doesn't disturb the 9 existing port tests.*) Hold `let boundPort = preferred;` and expose `get port() { return boundPort; }` in the returned object (replaces the `port` value). **Getter caveat:** safe for all current consumers (none destructure `mcpServer.port`); add a one-line comment that a future caller must read `mcpServer.port` live, not destructure (which would snapshot the getter).
3. **`start()`** — loop with a fresh `http.createServer(onRequest)` **per attempt** (a failed attempt's server never bound, so no close needed — just discard the reference, don't leak it); `listen(attempt, '127.0.0.1')`. On success set `boundPort = attempt`, keep `started=true` + `httpServer` = the bound server, resolve. On EADDRINUSE: if `strict` → reset `started=false`/`httpServer=null` (today's semantics, so `stop()`/rebind still work) and reject with the dev-env-strict message; else pick the next candidate via `freePortInRange(attempt + 1)` and retry the **real** listen, capped (≤ 20); on `freePortInRange===null` or cap-exhaustion reset `started`/`httpServer` and reject "no free port found". On a non-EADDRINUSE error reject as today (reset state).
4. **`startMcpServerInstance` (`main.js`)** — pass `honorEnv: !app.isPackaged` into `createMcpServer`. Keep the pre-start `mcpStatus.port = mcpServer.port` (attempted) for the failure case, but **after** `await mcpServer.start()` add `mcpStatus.port = mcpServer.port;` (now the bound port). Do **not** persist the fallback.
5. **`currentAutomationStatus` (`main.js`)** — change the would-be branch to `resolvePort(() => settings, { honorEnv: !app.isPackaged })`.
6. **EADDRINUSE message** — make it mode-aware per the AC.
7. **Tests** — extend `automation-port.test.js` (honorEnv modes) and add the `start()` strict/fallback integration cases (occupy a port with `net.createServer` like the existing `freePortInRange` tests).

## Edge Cases
- **Packaged + `GOLDFINCH_MCP_PORT` set** → ignored (`honorEnv:false`); port = `automationPort`/default with fallback. (Verified leg 7.)
- **Dev + env pin taken** → strict reject, surface unbound, `mcpStatus.error` shows the attempted port + the env-aware hint; app keeps running.
- **Fallback retry TOCTOU** → mitigated by retrying the real `listen` (not trusting the advisory probe); cap retries.
- **`opts.port` in tests** → explicit ⇒ strict; existing tests that pass a free high port bind exactly, unchanged.
- **Live-rebind (`rebindMcpServer`) + fallback** → a port save that collides now falls back (dev-no-env/packaged) or fails loudly (dev env pin); `currentAutomationStatus` returns the bound port post-rebind. Don't persist the fallback on rebind either.

## Files Affected
- `src/main/automation/mcp-server.js` — `resolvePort` `honorEnv`; `createMcpServer` strict/fallback + `boundPort` getter; `start()` retry loop; mode-aware hint.
- `src/main/main.js` — `honorEnv: !app.isPackaged` at `createMcpServer` + `currentAutomationStatus`; post-start bound-port capture.
- `test/unit/automation-port.test.js` — `honorEnv` cases + `start()` strict/fallback integration cases.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (`npm test` + typecheck + lint)
- [ ] Update flight-log.md with leg progress entry (note live two-instance/env-strict verification → leg 7)
- [ ] Set this leg's status to `completed`
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight: (N/A — leg 5 of 8)
- [ ] Commit deferred to flight-end batch review

## Citation Audit
**Line numbers are approximate and symbol-anchored** (leg-3's edits shifted them; the review re-measured: `resolvePort`≈:151, `freePortInRange`≈:172, port const≈:270, EADDRINUSE reject≈:642, return shape≈:703, `main.js` pre-start≈:154, `currentAutomationStatus`≈:229). Find each by symbol/snippet, not the line number. Confirmed at leg design time (2026-06-17, post-leg-4):
- `mcp-server.js:128` `DEFAULT_PORT = 49707`; `:152` `resolvePort` (unconditional env read); `:170` `freePortInRange` (advisory/TOCTOU-documented); `~:254` `const port = … resolvePort(getSettings)`; `~:624` EADDRINUSE message "set GOLDFINCH_MCP_PORT to override"; `~:683` `return { start, stop, port, getActivity }` — **OK** (read directly).
- `main.js:141` pre-start `mcpStatus.port = mcpServer.port`; `:201` `currentAutomationStatus` would-be `resolvePort(() => settings)` — **OK** (note: leg-3 added lines shifted some numbers; cited by symbol/snippet).
- `test/unit/automation-port.test.js` — `resolvePort`/`freePortInRange` suites, electron-free — **OK**.
