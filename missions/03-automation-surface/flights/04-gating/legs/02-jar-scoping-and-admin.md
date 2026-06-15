# Leg: jar-scoping-and-admin

**Status**: completed
**Flight**: [Gating — opt-in + key auth + audit](../flight.md)

## Objective
Bind the resolved identity to each session and enforce jar-scoping: a jar key sees and drives **only** its own jar's tabs (membership decided by **session object identity**, never the renderer-reported `jarId`), the internal-session exclusion stays **absolute** for jar keys, and the **admin** identity (env-gated) bypasses jar-scoping and is the sole relaxation of the internal-session exclusion.

## Context
- **DD4** — identity is bound to the session at `onsessioninitialized`; every subsequent request re-validates the Bearer key **live** (reads settings fresh) and confirms the resolved identity **matches** the session's bound identity. Live re-validation is what makes a Flight-5 revoke / toggle-off kill a live session. The per-session `Server` is built **scoped to that identity** — `buildServer(identity)`.
- **DD6** — the **admin** identity (`'admin'`, returned by `validateKey` only when `GOLDFINCH_AUTOMATION_ADMIN` is set AND the key hashes to a non-empty `automationAdminKeyHash`) bypasses jar-scoping (sees all tabs + the chrome renderer) and is the **sole authorized relaxation** of the internal-session exclusion (drives `goldfinch://settings`, whole-window capture).
- **DD7 (the SC8 linchpin)** — jar membership is **session object identity**: `wc.session === session.fromPartition(jar.partition)`. Electron interns sessions by partition, so a guest webview created with `partition = jar.partition` shares the *same* `Session` object main resolves — the same discipline `resolve.js` already uses for `__goldfinchInternal`. **NOT** partition-string matching; **NOT** trusting the renderer's `jarId`. Scoping authority is the resolved session. Burner jars (`burner:N`, renderer-only, absent from `jars.list()`) match no known jar → **unautomatable** by construction. The `Session→jar` resolver is **net-new** (no such map exists today).
- **Prior leg (`key-model-and-gate`, landed):** `validateKey → jarId | 'admin' | null` exists; the `onRequest` auth gate currently resolves the identity but **discards it** (`isAuthorized` returns a boolean). This leg makes the identity flow through to the session and the engine façade.
- **Scope (DD1):** no operator-facing UI; audit data is the next leg (`audit-data`).

### Codebase ground truth (verified 2026-06-14)
- `src/main/automation/engine.js` — `createEngine(getMainWindow)` returns a flat 16-op object; `deps()` is built **fresh per call** as `{ fromId, chromeContents, executeInRenderer, activate }`. `fromId = (id) => webContents.fromId(id)`. Op modules are passed `deps()`.
- `src/main/automation/resolve.js` — **electron-free** (fromId/chromeContents injected). `resolveContents(wcId, { fromId, chromeContents })` throws `bad-handle` / `no-such-contents` / `internal-session` (the last absolute today). `isInternalContents(wc)` = `wc.session.__goldfinchInternal === true`. Exports `{ isInternalContents, classifyContents, resolveContents }`.
- `src/main/automation/tabs.js` — `mapEnumeratedTabs(raw, {fromId,chromeContents})` drops non-dom-ready / dead / internal tabs and passes `jarId: t.jarId` (renderer-reported) **straight through**. `closeTab`/`activateTab` call `resolveContents(wcId, { fromId, chromeContents })` before the renderer call. `enumerateTabs` runs `window.__goldfinchAutomation.listTabs()` then `mapEnumeratedTabs`.
- `nav.js` / `input.js` / `observe.js` — each wcId-op calls `resolveContents(wcId, { fromId, chromeContents })` before acting (verify exact destructuring per module at impl time).
- `src/main/jars.js` — `list()` returns persistent jars `{ id, name, color, partition }`; burners are renderer-only and NOT in `list()`. Get a jar's session via `require('electron').session.fromPartition(jar.partition)`.
- `src/main/automation/mcp-server.js` — `buildServer()` (no args) wires `buildToolRegistry(getEngine)`; `getEngine` is lazy. `isAuthorized(req)` resolves identity via `validateKey` then returns a boolean (identity discarded). `sessions` Map entry = `{ server, transport }`; `onsessioninitialized(sid)` registers it. `onRequest`: origin guard (403) → auth gate (401) → `routeRequest`.
- `src/main/main.js:763` — `mcpServer = createMcpServer({ getEngine: () => createEngine(() => mainWindow) })`. The `automation:dev-invoke` (line 743) and `automation:dev-enable-mint` (line 776, prior leg) IPC handlers create engines via `createEngine(() => mainWindow)`.
- `src/renderer/renderer.js` — guest webview partition set from `jar.partition`; `window.__goldfinchAutomation.listTabs()` returns `{wcId,url,title,jarId,active}` with `jarId = container.id`. Internal session marked `__goldfinchInternal=true` in main.js (~line 705/730).
- Tests: `test/unit/automation-mcp-server.test.js` uses a real SDK client + a fake engine + a fake settings reader (`fakeSettings`, `connectClient(key)` sets `Authorization: Bearer`). `resolve.js`/`tabs.js` have offline pure unit tests.

## Inputs
- `key-model-and-gate` landed: `validateKey`, the auth gate, the injected `getSettings`.
- Flight-3 transport + the 16-op engine present.

## Outputs
- `src/main/automation/resolve.js` — `allowInternal`-aware `resolveContents`; net-new `resolveContentsForJar`.
- `src/main/automation/engine.js` — `createEngine(getMainWindow, { allowInternal })`; `deps()` carries `allowInternal` + `fromPartition`; op modules forward full deps to `resolveContents`.
- `src/main/automation/scope.js` — new jar-scoped façade (`scopeEngine`).
- `src/main/automation/mcp-server.js` — identity resolved+bound at session creation; per-request live re-validation + identity-match; `buildServer(identity)` applies the façade; engine accessor takes `{ allowInternal }`.
- `src/main/main.js` — engine accessor updated to `(opts) => createEngine(() => mainWindow, opts)`; scope context (jars/fromId/fromPartition/chrome) wired into `createMcpServer`.
- Unit/integration tests for the resolver, the façade, the enumerate filter, cross-jar/burner/internal refusals, admin-sees-all, and revoke-kills-live-session.
- `docs/mcp-automation.md` — jar-scoping + admin-tier model section.

## Acceptance Criteria
- [x] **`resolveContentsForJar` (net-new, in `resolve.js`, electron-free)** — `resolveContentsForJar(wcId, jar, deps)`:
  - First calls `resolveContents(wcId, deps)` (applies `bad-handle` / `no-such-contents` / `internal-session` — internal stays **absolute** here; jar keys never reach internal).
  - Then verifies **session object identity**: `wc.session === deps.fromPartition(jar.partition)`. `fromPartition` is injected (keeps `resolve.js` electron-free). Lazy compare (no cached map) so a runtime `jars-add` is picked up.
  - On mismatch → throw `automation: out-of-jar — wcId {n} does not belong to jar {jar.id}`.
  - Returns the live `wc` on success. Never trusts a renderer-reported `jarId`.
  - Exported from `resolve.js`.
- [x] **`resolveContents` admin relaxation** — `resolveContents(wcId, deps)` reads `allowInternal` from `deps` (default `false`/undefined). When `allowInternal === true`, the `internal-session` throw is **skipped** (admin's sole relaxation); `bad-handle`/`no-such-contents` always apply. Backward compatible: existing callers that pass no `allowInternal` behave exactly as today.
- [x] **Engine is `allowInternal`-aware** — `createEngine(getMainWindow, { allowInternal = false } = {})`; `deps()` includes `allowInternal` and `fromPartition` (`require('electron').session.fromPartition`). Every op module forwards its **full deps** (carrying `allowInternal`) to `resolveContents` (change `resolveContents(wcId, { fromId, chromeContents })` → `resolveContents(wcId, deps)`). **Every** resolve call site must forward — and several ops resolve **twice** (pre- and post-activate); BOTH must forward or admin's internal drive silently re-throws on the second resolve:
  - `tabs.js` — `closeTab`, `activateTab` (1 each); `mapEnumeratedTabs` (its `isInternalContents` filter → `if (!allowInternal && isInternalContents(wc)) continue`), threaded from `enumerateTabs`.
  - `nav.js` — `navigate`, `goBack`, `goForward`, `reload` (1 each).
  - `input.js` — `sendInput` / `actOn` (resolves **twice**: pre- and post-activate — both).
  - `observe.js` — `captureScreenshot`, `readDom`, `readAxTree` (each resolves **twice** pre/post-activate — both); `captureWindow` takes no wcId (leave).
  - **One shared `fromId`:** the façade's membership resolve and the engine's op resolve MUST use the *same* `fromId` (the engine uses `webContents.fromId`). Inject a single `fromId` from main.js into both the engine and the scope ctx (or have the ctx reuse the engine's) so they cannot diverge — a divergence could pass membership while the engine resolves a different contents.
- [x] **Jar-scoped façade (`scope.js`)** — `scopeEngine(engine, identity, ctx)` where `ctx = { jars, fromId, fromPartition, getChromeContents }`:
  - **admin** → returns the engine **unchanged** (the admin engine is built with `allowInternal: true`, so it enumerates all jars' guest tabs **and** the internal `goldfinch://settings` tab, can drive/observe any of them, and `captureWindow` whole-window capture is allowed). No jar filtering.
    - **Scope clarification (FD decision — see flight log):** "admin sees all + the chrome" for **this flight** means: enumerates every jar's guest tabs + the internal settings tab, and `captureWindow` (whole-window composite, which *includes* the chrome). It does **NOT** mean driving the chrome renderer (`mainWindow.webContents`): the chrome renderer's wcId is never returned by `listTabs()` (renderer enumerates only `<webview>` guests), so it is structurally undiscoverable via the surface. Driving the chrome renderer (toolbar/tab-strip) needs a net-new chrome-enumeration affordance — **deferred** to when dogfooding the chrome's own behavior specs requires it (Flight 6), not this leg. DD6's admin capability for *this* flight is faithfully "internal-session relaxation + whole-window capture + cross-jar visibility."
  - **jar (`identity` is a jarId)** → resolve `jar = jars.list().find(j => j.id === identity)`. If absent (revoked/unknown) → **every** op returns an `out-of-jar`/`no-such-jar` error (a revoked jar key drives nothing). Otherwise a façade:
    - `enumerateTabs()` → `(await engine.enumerateTabs()).filter(t => memberOfJar(t.wcId))`, where `memberOfJar` resolves the wc via `fromId` and compares `wc.session === fromPartition(jar.partition)`. Filters by **resolved session**, never `t.jarId`. Burner tabs (session matches no persistent jar) are dropped.
    - Every **wcId-first** op (`closeTab`, `activateTab`, `navigate`, `goBack`, `goForward`, `reload`, `click`, `typeText`, `scroll`, `pressKey`, `captureScreenshot`, `readDom`, `readAxTree`) → call `resolveContentsForJar(wcId, jar, {fromId, chromeContents: getChromeContents(), fromPartition})` first (throws `out-of-jar`/bad/dead/internal), then delegate to the engine op. Use a generic wrapper over the op-name set (membership needs only the first arg `wcId`) — keep `mcp-tools.js` security-logic-free.
    - `captureWindow()` → **refused** for jar keys (whole-window capture is admin-only) → throw with a **distinct** `automation: admin-only` message (NOT `out-of-jar`), so the next leg's audit log and the behavior test can distinguish "targeted another jar's tab" from "this op is admin-only".
    - `openTab(url)` → delegate to the engine (a new tab opens in the renderer's active container). **Known limitation (note in flight log):** a jar key cannot target the jar for a new tab in v1; a tab that lands in another jar is simply not enumerable/drivable by this key (no cross-jar read — confinement holds). Acceptable for Flight 4; revisit if jar-targeted open is needed.
- [x] **Identity bound at session creation; `buildServer(identity)`** — `buildServer(identity)` builds the per-session `Server` with `buildToolRegistry(() => scopeEngine(getEngine({ allowInternal: identity === 'admin' }), identity, ctx))`. The engine accessor passed into `createMcpServer` takes an options bag: `getEngine({ allowInternal })`. `sessions` Map entry gains `identity`: `{ server, transport, identity }`, set at `onsessioninitialized`.
- [x] **Per-request live re-validation + identity match (DD4)** — two distinct mechanisms, both required; the leg must keep them separate:
  - **Already free via the `onRequest` gate** (runs on *every* request, incl. existing-session ones, reading live settings): a toggle-off (`automationEnabled=false`) or a **fully** revoked key makes `resolveIdentity` return `null` → bare **401**. This already kills a live session on toggle-off / total-revoke — confirm it, don't re-implement it.
  - **Net-new identity-match in `routeRequest`'s existing-session branch:** today a request with a known `Mcp-Session-Id` delegates straight to `entry.transport.handleRequest` with **no** per-request identity check (mcp-server.js ~lines 326–331). Insert, **before** that delegation, a check that the live-resolved identity equals the session's bound `entry.identity`; on mismatch (session-id reused under a *different valid* key, or this jar's key revoked while other valid keys remain) → bare **401**. This is the case the gate does *not* catch.
  - To avoid a double settings-read, prefer resolving identity **once** in `onRequest` and passing it into `routeRequest` (rather than re-resolving). The 401 in both paths is **bare** (`writeHead(401)/end()`), consistent with the gate's convention.
- [x] **Internal-session exclusion absolute for jar keys; admin sole relaxation** — a jar key handed an internal-session wcId is refused (`internal-session` via `resolveContents`, `allowInternal` false). Only the admin engine (`allowInternal: true`) drives the internal session. Verified by unit + integration tests.
- [x] **Mint guard (small carry into the prior leg's dev path)** — `enableAndMintJarKey(jarId, …)` rejects a `jarId` not present in `jars.list()` (it accepts any non-empty string today), so a key can't bind an identity that resolves to no jar. A jarId that exists at mint time but is later deleted still degrades safely (façade → all-ops-error). Burner ids are never valid mint targets.
- [x] **Tests green** — unit: `resolveContentsForJar` (match / out-of-jar / bad / dead / internal; **runtime `jars-add`** resolvable via the lazy `fromPartition` compare); `resolveContents` allowInternal on/off; `scopeEngine` jar façade (enumerate filter by session not jarId — incl. a tab whose renderer `jarId` is mismatched but session is in-jar, and vice-versa; out-of-jar refusal on every wcId op; burner unautomatable; `captureWindow` → `admin-only`; revoked/unknown-jar → all-ops-error); admin pass-through. Integration (extend `automation-mcp-server.test.js`, real SDK client + fake engine returning **multi-jar tabs + one internal-session tab** + a fake `fromId`/`fromPartition` whose partition→session map makes the object-identity compare real): a jar session enumerates **only its jar**; out-of-jar wcId refused; burner refused; admin (env-set) enumerates **all jars' tabs + the internal tab** and `captureWindow` succeeds (a jar key's `captureWindow` is `admin-only`); **identity-mismatch on an existing session → 401**, and **toggle-off/total-revoke mid-session → next request 401**. `npm test`, `npm run typecheck`, `npm run lint` clean.

## Verification Steps
- `npm test` (all, incl. new scoping/resolver/façade cases), `npm run typecheck`, `npm run lint` — clean.
- Reason through: a jar key for `personal` cannot enumerate or drive a `work`/`default`/burner/internal tab; the admin key (env-set) can; a renderer-reported `jarId` that disagrees with the resolved session does not change the scoping decision.

## Implementation Guidance

1. **`resolve.js`**
   - `resolveContents(wcId, deps)`: destructure `{ fromId, allowInternal }` (keep `chromeContents` for callers that classify). Guard `bad-handle`/`no-such-contents` unchanged; gate the `internal-session` throw on `!allowInternal`.
   - `resolveContentsForJar(wcId, jar, deps)`: `const wc = resolveContents(wcId, deps);` then `if (!jar || wc.session !== deps.fromPartition(jar.partition)) throw new Error('automation: out-of-jar — …');` return `wc`. Keep electron-free (`fromPartition` injected).
   - Export the new fn.

2. **`engine.js`**
   - `createEngine(getMainWindow, { allowInternal = false } = {})`. In `deps()` add `allowInternal` and `fromPartition: session.fromPartition` (add `session` to the electron require). Forward `deps()` (the whole object) to op modules as today.
   - Confirm each op module passes its full `deps` to `resolveContents` (change the reconstructed `{fromId, chromeContents}` to the full deps so `allowInternal` flows). Update `mapEnumeratedTabs`/`enumerateTabs` to keep internal tabs when `allowInternal`.

3. **`scope.js` (new)**
   - `scopeEngine(engine, identity, { jars, fromId, fromPartition, getChromeContents })`. Admin → return `engine`. Jar → resolve jar; build the wrapper. Define the wcId-first op-name set; generic wrap = `(wcId, ...rest) => { resolveContentsForJar(wcId, jar, {fromId, chromeContents: getChromeContents(), fromPartition}); return engine[op](wcId, ...rest); }`. Special-case `enumerateTabs` (filter), `captureWindow` (refuse), `openTab` (delegate). Pure-ish + unit-testable with fakes.

4. **`mcp-server.js`**
   - Refactor `isAuthorized(req)` → `resolveIdentity(req)` returning `jarId|'admin'|null` (reads settings live + env gate). `onRequest`: `null` → 401.
   - Thread identity to session creation: capture it in `routeRequest` for the initialize path; pass to `buildServer(identity)`; store in the `sessions` entry.
   - For existing-session requests: re-resolve identity live; if it doesn't equal the stored `identity` (or is null) → 401.
   - `getEngine` accessor now takes `{ allowInternal }`. Build the scope `ctx` (jars, fromId, fromPartition, getChromeContents) — inject via `createMcpServer` opts from main.js (which has electron + jars + mainWindow), keeping `scope.js` testable. Confirm the cleanest injection seam against the current `createMcpServer` signature.

5. **`main.js`**
   - `getEngine: (opts) => createEngine(() => mainWindow, opts)`.
   - Provide the scope context to `createMcpServer` (`jars` module, `fromId`, `session.fromPartition`, `() => mainWindow?.webContents`).

6. **Tests & docs** — per the acceptance criteria; extend the existing fake-engine/fake-settings harness with multi-jar tabs + fake `fromId`/`fromPartition` keyed by a partition→session map; document the jar-scoping + admin model in `docs/mcp-automation.md`.

## Edge Cases
- **Renderer `jarId` spoof / mismatch** — a tab whose renderer-reported `jarId` says `personal` but whose resolved session is `work` is scoped by the **resolved session** (work), not the label. Test both directions.
- **Burner tab** — session matches no `jars.list()` entry → dropped from enumerate, refused on drive. No jar key can be keyed to a burner.
- **Revoked jar mid-session** — the jar hash is deleted; live re-validation returns null → 401. If the jar still exists but the key changed, identity mismatch → 401.
- **Jar deleted from `jars.list()` mid-session** — `scopeEngine` finds no jar → all ops error (`no-such-jar`/`out-of-jar`).
- **Admin env gate unset at request time** — `validateKey` returns null for the (former) admin key → 401 (handled by the prior leg's gate; confirm here).
- **`captureWindow` by a jar key** — refused (admin-only).
- **Double-resolve cost** — the façade resolves for membership, the engine op resolves again; negligible for one local consumer, and the engine remains the authoritative guard.

## Files Affected
- `src/main/automation/resolve.js` — allowInternal + `resolveContentsForJar`.
- `src/main/automation/engine.js` — createEngine option, deps `allowInternal`/`fromPartition`, op-module deps forwarding.
- `src/main/automation/tabs.js`, `nav.js`, `input.js`, `observe.js` — forward full deps to `resolveContents`; `tabs` internal-keep when allowInternal.
- `src/main/automation/scope.js` — new façade.
- `src/main/automation/mcp-server.js` — identity resolve/bind/match, `buildServer(identity)`, engine accessor opts, scope ctx.
- `src/main/main.js` — engine accessor opts + scope ctx wiring.
- `test/unit/automation-resolve.test.js` (or existing), `test/unit/automation-scope.test.js` (new), `test/unit/automation-mcp-server.test.js` (extend).
- `docs/mcp-automation.md` — jar-scoping + admin model.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing
- [ ] Update flight-log.md with leg progress entry
- [ ] Set this leg's status to `completed` (in this file's header)
- [ ] Check off this leg in flight.md
- [ ] If final leg of flight: (not final)
  - [ ] Update flight.md status to `landed`
  - [ ] Check off flight in mission.md
- [ ] Commit all changes together (code + artifacts)

> **Orchestration note:** Under `/agentic-workflow`, the Developer does NOT commit and does NOT signal `[COMPLETE:leg]`. Implement to acceptance criteria, update the flight log, set status to `landed`, signal `[HANDOFF:review-needed]`. Review + commit are batched at flight end.
