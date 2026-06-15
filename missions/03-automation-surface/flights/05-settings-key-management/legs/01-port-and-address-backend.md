# Leg: port-and-address-backend

**Status**: completed
**Flight**: [Settings key management + automation UI](../flight.md)

## Objective
Add a persisted, configurable `automationPort` setting with an env-overridable resolution precedence, a free-port scanner, a moved default off the squatted `7777`, and an origin-checked status/find-free-port IPC pair that the settings UI (leg 2) will consume — all main-process backend, no preload/UI.

## Context
- **DD1** (flight): persisted+configurable `automationPort` (default in the IANA dynamic range, proposed **`49707`**), precedence **`GOLDFINCH_MCP_PORT` env > persisted `automationPort` > default**, a "find a free port" scanner over loopback `49152–65535`, and a status surface exposing the live bind result. Host stays `127.0.0.1` (hard SC7 — never configurable).
- **Port-change semantics = NEXT-LAUNCH** (DD1, resolved-to-divert): `resolvePort()` runs at `createMcpServer` construction; a live rebind is out of scope. A changed `automationPort` takes effect on next launch. This leg only stores/resolves/surfaces; it does not rebind a running server.
- Flight-4 left a real UX gap: `main.js` only `console.error`s an EADDRINUSE and the bind result is invisible. This leg captures that outcome into queryable state.
- This leg is the backend half. Leg 2 adds the `window.goldfinchInternal` bridge methods and the Settings "Automation" section that call these IPCs.

## Inputs
What exists before this leg runs:
- `src/main/automation/mcp-server.js` — `resolvePort()` (lines ~81–85, env-only, default `DEFAULT_PORT = 7777` at line 63); `createMcpServer` resolves `port` at line ~157 (`opts.port` override else `resolvePort()`); `start()` rejects on EADDRINUSE (lines ~494–522); exports at lines ~640–646. It already accepts an injectable `getSettings` accessor (`() => require('../settings-store')`, lines ~144–146).
- `src/main/settings-store.js` — `DEFAULTS` (lines 39–53), `VALIDATORS` (lines 84–120), `freshDefaults()` (lines 64–72). Existing integer-free schema; `automationEnabled`/`automationKeyHashes`/`automationAdminKeyHash` already present.
- `src/main/main.js` — MCP start site (lines 762–786): `if (isMcpAutomationEnabled(process.argv)) { mcpServer = createMcpServer({...}); mcpServer.start().catch(...console.error...) }`. `registerInternalHandler(ipcMain, channel, handler)` origin-checked IPC pattern in use (lines 551–566). `let mcpServer = null;` at line ~100.
- `src/main/internal-ipc.js` — `registerInternalHandler` (origin-checked: `goldfinch://settings` origin + `__goldfinchInternal` session).
- Test runner: `node --test test/unit/*.test.js` (`npm test`); `npm run typecheck` (tsc `--noEmit -p jsconfig.json`); `npm run lint` (eslint). Existing `test/unit/automation-mcp-server.test.js`, `test/unit/settings-store.test.js`.

## Outputs
What exists after this leg completes:
- `automationPort` setting (default `49707`) persisted + validated in `settings-store.js`.
- `resolvePort(getSettings)` with precedence `env > setting > default 49707`; `DEFAULT_PORT = 49707`.
- `freePortInRange(lo, hi)` exported from `mcp-server.js`, scanning loopback `49152–65535` sequentially.
- Queryable bind status in `main.js` (`{ enabled, host, port, bound, error }`).
- Origin-checked IPC: `automation:get-status` and `automation:find-free-port`.
- Unit tests for the validator, `resolvePort` precedence, and `freePortInRange`.

## Acceptance Criteria
- [ ] **AC1** — `settings-store.js` defines `automationPort` in `DEFAULTS` with value `49707`, adds `automationPort: number` to the `Settings` typedef (the file is `// @ts-check` and `DEFAULTS` is annotated `/** @type {Settings} */`, so the typedef MUST grow or `tsc` fails), and adds a `VALIDATORS.automationPort` that accepts an integer in `[1024, 65535]` and rejects non-integers (`1024.5`), out-of-range (`1023`, `65536`), and non-numbers (string, `null`, array, boolean).
- [ ] **AC2** — `DEFAULT_PORT` in `mcp-server.js` is `49707` (no remaining `7777` literal in `mcp-server.js`).
- [ ] **AC3** — `resolvePort` takes the injectable settings accessor and resolves with precedence **valid `GOLDFINCH_MCP_PORT` env > valid persisted `automationPort` > `49707`**; a missing/invalid env value falls through to the setting, and a missing/invalid setting falls through to the default. `createMcpServer` passes its `getSettings` to `resolvePort` (and `opts.port` still wins over all of it). **Range intent (resolves design-review):** the env branch accepts any positive integer (`> 0`) — the env var is the dev/operator escape hatch and may deliberately be `< 1024` (e.g. `GOLDFINCH_MCP_PORT=80`), matching Flight-4 behavior; the *persisted setting* branch is range-bound (`>= 1024 && <= 65535`) to match its validator. Status reflects the single startup attempt (no retry path in `main.js`).
- [ ] **AC4** — `freePortInRange(lo = 49152, hi = 65535)` is exported and returns the first loopback-free port at or above `lo` (probing sequentially with `net.createServer().listen(p,'127.0.0.1')`+close); it skips an occupied port; returns `null` if none free in range. Result is advisory (documented TOCTOU window).
- [ ] **AC5** — `main.js` captures the MCP start outcome into module state and exposes it via origin-checked `automation:get-status` returning `{ enabled, host: '127.0.0.1', port, bound, error }`: `enabled` = MCP surface active in this process (`isMcpAutomationEnabled`); `port` = the resolved/bound port (or the resolved value when not bound); `bound` = `true` only after `start()` resolves; `error` = the EADDRINUSE/other message on failure, else `null`. When the surface is not active, `{ enabled:false, bound:false, error:null }` with the resolved port.
- [ ] **AC6** — `main.js` exposes origin-checked `automation:find-free-port` returning `{ port }` from `freePortInRange()` (or `{ port: null }`). Both new IPCs are registered via `registerInternalHandler` (NOT bare `ipcMain.handle`).
- [ ] **AC7** — `npm test`, `npm run typecheck`, `npm run lint` all pass, including new unit tests covering AC1 (validator), AC3 (precedence: env-wins, setting-when-no-env, default-when-neither, invalid-env-falls-through), and AC4 (`freePortInRange` returns free / skips an occupied port).

## Verification Steps
- AC1/AC3/AC4/AC7: `cd /home/cprch/projects/goldfinch && npm test` — new cases green.
- AC2: `grep -n 7777 src/main/automation/mcp-server.js` returns nothing.
- AC5/AC6: `grep -n "automation:get-status\|automation:find-free-port" src/main/main.js` shows both via `registerInternalHandler`; `npm run typecheck && npm run lint` clean. (Live IPC exercise is leg 2 / verify-integration once the bridge exists.)

## Implementation Guidance

1. **settings-store.js — add the setting (AC1).**
   - In `DEFAULTS`, add `automationPort: 49707` (with a short comment: configurable MCP listen port; DD1; moved off the squatted 7777).
   - In `VALIDATORS`, add `automationPort: (v) => Number.isInteger(v) && v >= 1024 && v <= 65535`. (`Number.isInteger` rejects strings, `null`, arrays, booleans, and non-integers — no extra guards needed.)
   - No normalizer; the value is a primitive so `freshDefaults()`' spread copies it correctly — no change there.

2. **mcp-server.js — port resolution (AC2, AC3).**
   - Change `const DEFAULT_PORT = 7777;` → `49707`. Update the nearby comment and the `resolvePort` docstring (drop the "7777 (DD2)" wording; describe `env > setting > default 49707`).
   - Refactor `resolvePort` to accept the settings accessor:
     ```js
     function resolvePort(getSettings) {
       const envRaw = process.env.GOLDFINCH_MCP_PORT;
       const envN = envRaw == null ? NaN : Number(envRaw);
       if (Number.isInteger(envN) && envN > 0) return envN;
       try {
         const s = (typeof getSettings === 'function' ? getSettings() : require('../settings-store'));
         const p = s && typeof s.get === 'function' ? s.get('automationPort') : undefined;
         if (Number.isInteger(p) && p >= 1024 && p <= 65535) return p;  // setting is range-bound (matches its validator)
       } catch { /* settings unavailable — fall through */ }
       return DEFAULT_PORT;
     }
     ```
   - At the `createMcpServer` port line (~157), pass the existing `getSettings`: `const port = Number.isInteger(opts.port) && opts.port > 0 ? opts.port : resolvePort(getSettings);`. (`getSettings` is defined just above at ~144.)

3. **mcp-server.js — free-port scanner (AC4).**
   - `const net = require('net');` at the top (with the other requires).
   - Add and export:
     ```js
     async function freePortInRange(lo = 49152, hi = 65535) {
       for (let p = lo; p <= hi; p++) {
         const free = await new Promise((resolve) => {
           const srv = net.createServer();
           srv.once('error', () => resolve(false));
           srv.listen(p, '127.0.0.1', () => srv.close(() => resolve(true)));
         });
         if (free) return p;
       }
       return null;
     }
     ```
   - Add `freePortInRange` to the module exports (alongside `resolvePort`, `DEFAULT_PORT`, etc.).

4. **main.js — bind-status capture + IPC (AC5, AC6).**
   - Near `let mcpServer = null;`, add `let mcpStatus = { enabled: false, host: '127.0.0.1', port: null, bound: false, error: null };`.
   - Inside the `if (isMcpAutomationEnabled(process.argv)) {` block, after `mcpServer = createMcpServer({...})`, set `mcpStatus = { enabled: true, host: '127.0.0.1', port: mcpServer.port, bound: false, error: null };`. Replace the `.catch`-only with `.then(() => { mcpStatus.bound = true; }).catch((err) => { mcpStatus.bound = false; mcpStatus.error = (err && err.message) || String(err); console.error('[mcp] failed to start automation server:', err && err.message); });`.
   - When the surface is NOT active, report the would-be port so the UI can still show it. Do this **only** in the `automation:get-status` handler when `mcpStatus.port == null` (compute `resolvePort(() => settings)` there) — do NOT also set `mcpStatus.port` eagerly in the disabled branch (pick one path so the two cannot drift). For the enabled path `mcpStatus.port` is always set from `mcpServer.port`, so the handler fallback is only reached when disabled.
   - Also update the now-stale `EADDRINUSE on 7777` comment in the rewritten `.catch` block (this leg rewrites that block anyway) to drop the `7777` literal.
   - Register the IPCs near the other `registerInternalHandler` calls (lines ~551–566):
     ```js
     registerInternalHandler(ipcMain, 'automation:get-status', () => ({
       enabled: mcpStatus.enabled,
       host: '127.0.0.1',
       port: mcpStatus.port != null ? mcpStatus.port : resolvePort(() => settings),
       bound: mcpStatus.bound,
       error: mcpStatus.error,
     }));
     registerInternalHandler(ipcMain, 'automation:find-free-port', async () => ({ port: await freePortInRange() }));
     ```
   - Import the two functions from `./automation/mcp-server` (check the existing import of `createMcpServer` and extend it).

5. **Tests (AC7).**
   - `settings-store.test.js`: add `automationPort` validator cases (accept `49707`, `1024`, `65535`; reject `1023`, `65536`, `1024.5`, `'49707'`, `null`, `[]`, `true`). Confirm a stored invalid value is repaired to the default on load (follow the existing repair-test pattern).
   - `automation-mcp-server.test.js` (or a new `automation-port.test.js`): `resolvePort` precedence — (a) env valid → env; (b) no env, setting valid → setting; (c) neither → `49707`; (d) env invalid (`'abc'`), setting valid → setting. Inject a stub `getSettings = () => ({ get: (k) => (k === 'automationPort' ? 50000 : undefined) })`; save/restore `process.env.GOLDFINCH_MCP_PORT` around env cases. `freePortInRange` — returns a port in range; occupy a port with a real `net` server then assert `freePortInRange(thatPort, thatPort)` returns `null` and `freePortInRange(thatPort, thatPort+1)` returns `thatPort+1`.

## Edge Cases
- **Invalid `GOLDFINCH_MCP_PORT`** (e.g. `abc`, `0`, negative): falls through to the setting, then the default — never throws.
- **Settings store unavailable at `resolvePort` time** (early call / test without a loaded store): `try/catch` falls through to the default.
- **`automation:get-status` queried before `start()` settles**: `bound:false`, `error:null` — a transient honest state, not an error.
- **`freePortInRange` whole range occupied**: returns `null`; the IPC returns `{ port: null }` (leg 2's UI handles the null).
- **Port-change does NOT rebind** a running server (DD1 next-launch). This leg does not attempt a live rebind; leg 2's UI labels the stored value "(takes effect on next launch)".

## Files Affected
- `src/main/settings-store.js` — `automationPort` in `DEFAULTS` + `VALIDATORS`.
- `src/main/automation/mcp-server.js` — `DEFAULT_PORT` → `49707`; `resolvePort(getSettings)` precedence; `freePortInRange` + export; `net` require; createMcpServer port line.
- `src/main/main.js` — `mcpStatus` capture; `automation:get-status` + `automation:find-free-port` via `registerInternalHandler`; import `resolvePort`/`freePortInRange`.
- `test/unit/settings-store.test.js` — `automationPort` validator/repair cases.
- `test/unit/automation-mcp-server.test.js` (or new `test/unit/automation-port.test.js`) — `resolvePort` precedence + `freePortInRange`.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight: (N/A — not the final leg)
- [ ] Commit deferred to Phase 2d (batched flight review + commit) — do NOT commit per-leg
