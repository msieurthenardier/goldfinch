# Leg: toggle-binds

**Status**: completed
**Flight**: [Production gating re-architecture + dev-profile isolation + port free-fallback](../flight.md)

## Objective
Make the Settings `automationEnabled` toggle the **sole** thing that binds the MCP server in production — at launch (bind iff the toggle is on) **and live** (flip ON → cold start-from-null; flip OFF → stop-and-stay-stopped) — and rewrite the in-UI toggle copy that still claims binding requires `--automation-dev`.

## Context
- **DD2** — the security-boundary move. Today the server binds only under the dev flag (`isMcpAutomationEnabled(process.argv)` at `main.js:920`), and `automationEnabled` gates **auth only** (`resolveIdentity` at `mcp-server.js:429` returns null unless `automationEnabled===true`). F8 makes the toggle the bind gate.
- **Net-new wiring, NOT pure infra reuse (Architect):** the F5 `stop()` (`mcp-server.js`, `stop` function — "Stop the server: close the http listener … and EVERY live session's transport. Idempotent") supports unbind-to-zero, but `rebindMcpServer` (`main.js`, "Live-rebind the running MCP server") **no-ops when `mcpServer===null`** (`if (!mcpServer) return;`). So this leg adds: (a) a **start-from-null** path on a cold flip-ON (a packaged build starts with `mcpServer===null`), and (b) a **stop-and-stay-stopped** path on flip-OFF — both hooked off the `automationEnabled` write in `internal-settings-set` (`main.js` `registerInternalHandler(ipcMain, 'internal-settings-set', …)`). Treat `startMcpServerInstance` / `stop()` / `currentAutomationStatus` as **building blocks**, not a ready-made toggle.
- **The auth gate stays the real authority:** `resolveIdentity` returns null → 401 whenever `automationEnabled !== true`, regardless of bind state — so even if a live `stop()` ever leaked a handle, a flipped-off surface still 401s everything (the Adaptation fallback is genuinely safe).
- **Dev-override interaction (load-bearing — boundary between this leg and leg 3):** the live bind/unbind-on-toggle is the **production** behavior. In **dev** (`!app.isPackaged` + `--automation-dev`) the surface must stay bound + auth-enabled **regardless** of the persisted toggle, so the headless harness keeps its connection while the persisted toggle is independently off. **This leg implements the production path and force-binds at launch under the dev flag (preserving today's dev harness); leg 3 (DD3/DD4) replaces the raw dev-flag branch with the in-memory dev-enable override and adds the "skip unbind when the dev-override is active" guard on flip-OFF.** Do not try to build the override here.

## Inputs
What exists before this leg runs:
- Leg 1 landed: dev runs are profile-isolated (`!app.isPackaged` → `userData` `-dev` sibling).
- `main.js`: `let mcpServer = null;` + `let mcpStatus = {...}`; `startMcpServerInstance()` (creates + starts a fresh instance, captures bind-status into `mcpStatus`); `rebindMcpServer()` (no-ops when `mcpServer===null`); `currentAutomationStatus()`; the launch block `if (isMcpAutomationEnabled(process.argv)) { void startMcpServerInstance(); … auto-mint … }`; the `internal-settings-set` handler (sync: `settings.set` + broadcast + return cfg).
- `mcp-server.js`: `start()` (idempotent, rejects on EADDRINUSE without crashing), `stop()` (idempotent full teardown), `resolveIdentity` (auth gate, requires `automationEnabled===true`).
- `src/shared/automation-dev.js`: electron-free predicates `isAutomationDevEnabled` / `isMcpAutomationEnabled`, unit-tested in `test/unit/automation-dev.test.js`.
- `src/renderer/pages/settings.js`: `renderStatus(status)` (status-line + `enabledNote` copy ~lines 330-345), the enable-toggle `change` listener (~line 378, currently does **no** status re-fetch), `onSettingsChanged` two-way sync.

## Outputs
- A pure, unit-tested bind-decision predicate (e.g. `shouldBindAutomation({ automationEnabled, devForceBind })` in `automation-dev.js`) returning true iff `automationEnabled===true` **or** `devForceBind` — so the launch gate and leg 3's override compose from one tested function.
- `main.js` launch block binds the surface when the predicate says so (toggle on **or** dev force-bind), so a **packaged build with the toggle ON binds at launch**.
- `main.js` `internal-settings-set` drives **live** bind/unbind on an `automationEnabled` write: ON with `mcpServer===null` → `startMcpServerInstance()` (start-from-null); OFF → stop + `mcpServer=null` + `mcpStatus` reset to disabled (stop-and-stay-stopped); a fresh status is pushed so the Settings UI + indicator reflect the change.
- `settings.js`: the false `--automation-dev` status-line + `enabledNote` copy is rewritten to the toggle-binds reality; the toggle `change` handler re-fetches status so the UI shows the now-bound/unbound state.

## Acceptance Criteria
- [x] **Pure bind predicate:** `shouldBindAutomation({ automationEnabled, devForceBind })` (electron-free, in `automation-dev.js` or a sibling) returns `true` iff `automationEnabled === true` OR `devForceBind === true`; covered in `test/unit/automation-dev.test.js` (both true-paths + the both-false → false case).
- [x] **Launch gate (DD2):** the `main.js` launch block binds the MCP server when `shouldBindAutomation({ automationEnabled: settings.get('automationEnabled') === true, devForceBind: isMcpAutomationEnabled(process.argv) })` is true. On a packaged build with the toggle persisted ON, the server binds at launch; with the toggle OFF and no dev flag, it does **not** bind (`mcpServer` stays null). *(The `devForceBind` term keeps today's dev harness binding; leg 3 swaps `isMcpAutomationEnabled(process.argv)` for the `!app.isPackaged`-gated dev-enable override.)*
- [x] **Live flip-ON (start-from-null):** writing `automationEnabled=true` via `internal-settings-set` when `mcpServer===null` calls `startMcpServerInstance()` and binds the surface; when already bound it is a no-op (no double-bind).
- [x] **Live flip-OFF (stop-and-stay-stopped):** writing `automationEnabled=false` calls `mcpServer.stop()`, sets `mcpServer=null`, and resets `mcpStatus` to `{ enabled:false, host:'127.0.0.1', port:null, bound:false, error:null }`. A subsequent launch/rebind does not silently resurrect the surface. *(Leg 3 adds the guard that skips this unbind when the dev-enable override is active.)*
- [x] **Concurrency (boundary-move hazard — make it real, not advisory):** `applyAutomationEnabledChange` MUST serialize against the existing `rebinding` guard before touching `mcpServer` — `if (rebinding) await rebinding;` (or route its body through the same promise-chain). Rationale: `automation:set-port` → `rebindMcpServer()` transiently sets `mcpServer=null` between `stop()` and `startMcpServerInstance()`; an interleaved flip could `stop()` a null or double-free. Both handlers are now async and both mutate `mcpServer`.
- [x] **No explicit status push (per review — the `automation-activity-changed` channel carries an activity snapshot `{sessions,log}`, NOT a status object):** do **not** broadcast a status object on that channel. The active-session indicator clears for free because `stop()` cascades `transport.close()` → `onclose` → `noteSessionClose` → broadcast. The Settings status-line coherence comes from the renderer re-fetch below.
- [x] **Indicator/status coherence:** after a live flip, `currentAutomationStatus()` reflects the new state, and the Settings page shows it — the toggle `change` handler in `settings.js` re-fetches status (`automationGetStatus().then(renderStatus)`) after the `settingsSet` resolves. **Note (expected, not a bug):** `currentAutomationStatus()` after flip-OFF returns the *would-be resolved port* (it computes `mcpStatus.port != null ? … : resolvePort(...)`), so the address field stays pre-fillable; `bound:false` + `enabled:false` correctly drive the "not running" copy. The address field does not blank out on OFF.
- [x] **Renderer copy rewrite (DD2 renderer-copy AC — these become FALSE post-flight):**
  - The `renderStatus` "Not running" branch no longer says "start Goldfinch with `--automation-dev` to bind the surface". New copy reflects toggle-binds (e.g. when not enabled: "Not running — turn on the Automation toggle to bind the surface"; preserve the `bound` and `enabled && error` branches).
  - The `enabledNote` no longer says "Takes effect when Goldfinch is launched with `--automation-dev`." Under toggle-binds a flip takes effect live; set it to empty (or a brief "Binds the local automation surface" affordance) — no `--automation-dev` claim.
  - Update the now-stale comments at the toggle `change` listener ("No status re-fetch — a setting flip does not change status.enabled in a non-dev build") since a flip now DOES change bind state.
- [x] **No production self-enable regression:** this leg does not add any programmatic `automationEnabled=true` writer — the launch gate only *reads* the setting; the live wiring only *reacts* to the human IPC write. **Pre-empting a verifier flag:** the dev auto-mint block still calls `enableAndMintJarKey` (which writes `automationEnabled=true`), so during the leg-2-only state a dev auto-mint run still persists the toggle true. That is **fine within the batch** — it fires only under the dev flag, never on a packaged build, and leg 3 removes the side-effect. It is NOT a production self-enable path.
- [x] `npm test`, `npm run typecheck`, `npm run lint` all pass; the existing automation/auth/port/server suites stay green (the auth gate is unchanged).

## Verification Steps
- `npm test` — new `shouldBindAutomation` cases pass; existing `automation-mcp-server` / `automation-auth` / `automation-port` suites green (no auth-gate behavior change).
- `npm run typecheck`, `npm run lint` — clean.
- **Code inspection:** the launch gate reads the toggle; `internal-settings-set` drives start-from-null on ON and stop-and-stay on OFF; the renderer copy no longer references `--automation-dev`.
- **Live bind/unbind (deferred to leg 7 `verify-integration` on the packaged build):** flip ON → `curl 127.0.0.1:<port>/mcp` goes connection-refused → 401-without-key → tools-with-key; flip OFF → connection-refused again + indicator clears. *This leg lands on code-inspection + unit tests; the live curl probes are leg 7's (it owns the packaged build).* Note this in the flight-log entry.

## Implementation Guidance

1. **Add the pure predicate** to `src/shared/automation-dev.js`:
   ```js
   // Bind the MCP automation surface iff the human toggle is on (production) OR a
   // dev force-bind is active (dev-only, leg 3 supplies the override). Pure so it
   // unit-tests electron-free and the launch gate + leg-3 override share one rule.
   function shouldBindAutomation({ automationEnabled, devForceBind } = {}) {
     return automationEnabled === true || devForceBind === true;
   }
   ```
   Add it to the **existing `module.exports` object literal** in `automation-dev.js` (single object — easy to miss); extend the test file's header comment and add cases to `automation-dev.test.js`.

2. **Launch gate** (`main.js`, the `if (isMcpAutomationEnabled(process.argv))` block): split binding from the dev-only auto-mint. Bind under the predicate; keep the auto-mint affordance under its existing dev-flag gate (`isMcpAutomationEnabled` + `shouldAutoMint`). **Preserve `void startMcpServerInstance()` (fire-and-forget — the app must not block on the bind) and migrate the existing SC7/CDP-decoupling comment block rather than deleting it:**
   ```js
   const devForceBind = isMcpAutomationEnabled(process.argv);
   if (shouldBindAutomation({ automationEnabled: settings.get('automationEnabled') === true, devForceBind })) {
     void startMcpServerInstance();   // fire-and-forget, matching today's non-blocking launch
   }
   if (devForceBind) {
     // dev-only auto-mint-to-stdout affordance (unchanged here; leg 3/DD4 gates the
     // dev flag with !app.isPackaged and reworks the enable side-effect)
     if (shouldAutoMint(process.argv, process.env)) { … existing block … }
   }
   ```

3. **Live bind/unbind** in `internal-settings-set`. Make the handler `async` and react to the `automationEnabled` key after persisting:
   ```js
   registerInternalHandler(ipcMain, 'internal-settings-set', async (_e, key, value) => {
     const cfg = settings.set(key, value);
     broadcastToChromeAndInternal('settings-changed', settings.getAll());
     if (key === 'automationEnabled') {
       await applyAutomationEnabledChange(value === true);
     }
     return cfg;
   });
   ```
   Add the helper near `rebindMcpServer`:
   ```js
   // DD2: the toggle is the sole bind gate in production. Flip ON cold-starts the
   // server from null; flip OFF tears it down and stays down. (Leg 3 adds: skip the
   // OFF teardown when the dev-enable override is active, so the dev harness stays
   // connected while the persisted toggle is off.)
   async function applyAutomationEnabledChange(enabled) {
     if (rebinding) await rebinding;   // serialize against an in-flight port-rebind (mcpServer goes null transiently)
     if (enabled) {
       if (!mcpServer) await startMcpServerInstance();   // start-from-null
       // already bound → no-op
     } else {
       if (mcpServer) {
         await mcpServer.stop();
         mcpServer = null;
       }
       mcpStatus = { enabled: false, host: '127.0.0.1', port: null, bound: false, error: null };
     }
   }
   ```
   - **No explicit status broadcast** (review [high]): the `automation-activity-changed` channel carries an activity snapshot `{sessions,log}`, not a status object — pushing a status object would break `updateAutomationIndicator` / the audit viewer (`snap.sessions` undefined). The active-session indicator clears for free via `stop()`'s transport-close cascade; the Settings status-line is refreshed by the renderer re-fetch (step 4). Flip-OFF with **zero** live sessions fires no broadcast — that is harmless (the indicator was already empty); do **not** add a push to "fix" it.
   - **Serialize against `rebinding`** (the `if (rebinding) await rebinding;` above): `automation:set-port` → `rebindMcpServer()` nulls `mcpServer` transiently between `stop()` and `startMcpServerInstance()`; without the guard an interleaved flip could `stop()` a null or double-free. Reuse the existing `rebinding` chain — do not add a second lock.
   - **Bind failure on flip-ON** (EADDRINUSE): `startMcpServerInstance` swallows the error into `mcpStatus.error` / `bound=false` without crashing — intended. The toggle **stays on** (the persisted setting is `true` regardless of bind outcome) and the renderer shows "Failed to bind"; do **not** auto-revert the toggle. (Free-port fallback is leg 5.)

4. **Renderer copy + re-fetch** (`src/renderer/pages/settings.js`):
   - In `renderStatus`, rewrite the `else` status-line branch and the `enabledNote` per the AC (no `--automation-dev`).
   - In the enable-toggle `change` listener, after `settingsSet('automationEnabled', …)` resolves, call `window.goldfinchInternal.automationGetStatus().then(renderStatus)` so the UI reflects the live bind/unbind. Update the stale comment.

## Edge Cases
- **Flip ON when already bound** (e.g. dev launch already force-bound) → `startMcpServerInstance` guarded by `if (!mcpServer)`; no double-bind.
- **Flip OFF in dev** → leg 2 would unbind; **leg 3** adds the dev-override guard so it does not. Within this leg's batch this is acceptable (end state correct after leg 3). **No leg-2 unit test exercises dev flip-OFF** (the live IPC wiring is electron-coupled and not unit-tested; it's verified at leg 7 on the packaged build), so this transient gap trips no leg-2 gate — it is cleanly deferred to leg 3 + leg 7.
- **Bind failure on live flip-ON** (EADDRINUSE) → `startMcpServerInstance` already records `mcpStatus.error` and leaves `bound=false` without crashing; the renderer shows "Failed to bind". Full free-port fallback is leg 5.
- **Overlapping port-save + toggle-flip** → reuse the existing `rebinding` serialization; do not add a parallel lock.
- **Bound-port capture** — leg 2 reuses `startMcpServerInstance`'s existing capture (resolved port == bound port with no fallback yet). Leg 5 moves capture to post-`start()` once retry-on-EADDRINUSE exists. Do not implement port fallback here.

## Files Affected
- `src/shared/automation-dev.js` — `shouldBindAutomation` predicate.
- `test/unit/automation-dev.test.js` — predicate cases.
- `src/main/main.js` — launch gate via predicate; `applyAutomationEnabledChange` live wiring in `internal-settings-set`.
- `src/renderer/pages/settings.js` — rewrite status-line + `enabledNote` copy; status re-fetch on toggle change; comment fix.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (`npm test` + typecheck + lint)
- [ ] Update flight-log.md with leg progress entry (note live bind/unbind deferred to leg 7; note the leg-3 dev-override dependency)
- [ ] Set this leg's status to `completed`
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight: (N/A — leg 2 of 8)
- [ ] Commit deferred to flight-end batch review (do NOT commit per-leg)

## Citation Audit
Citations verified against current code at leg design time (2026-06-17):
- `src/main/main.js` `let mcpServer = null;` / `let mcpStatus = {...}` / `startMcpServerInstance` / `rebindMcpServer` (no-op when `mcpServer===null`) / `currentAutomationStatus` / launch block `if (isMcpAutomationEnabled(process.argv))` / `registerInternalHandler(ipcMain, 'internal-settings-set', …)` — **OK** (read directly).
- `src/main/automation/mcp-server.js` `resolveIdentity` (`if (settings.get('automationEnabled') !== true) return null;`) / `start()` / `stop()` — **OK**.
- `src/shared/automation-dev.js` `isAutomationDevEnabled` / `isMcpAutomationEnabled` + `test/unit/automation-dev.test.js` — **OK** (electron-free helper precedent).
- Renderer file is at **`src/renderer/pages/settings.js`** (the flight spec's `settings.js:334-344` lines map here): status-line `else` ("Not running — start Goldfinch with `--automation-dev`…") and `enabledNote` ("Takes effect when Goldfinch is launched with `--automation-dev`.") — **drifted path, content OK**: cited by snippet; lines are ~330-345 in `src/renderer/pages/settings.js`. Flight DD2 said `src/renderer/settings.js` — corrected here to `src/renderer/pages/settings.js`.
