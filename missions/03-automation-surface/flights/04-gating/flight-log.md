# Flight Log: Gating — opt-in + key auth + audit

**Flight**: [Gating — opt-in + key auth + audit](flight.md)

## Summary
**Flight LANDED 2026-06-15.** All 6 legs complete. Auth core delivered: opt-in toggle (`automationEnabled`), per-jar key auth + env-gated admin tier, jar-scoping enforcement (session-object-identity), audit data layer (in-process ring + broadcast). **SC8 met + behavior-test-backed** (`mcp-auth-gating` full live pass; `mcp-jar-scoping` partial live + exhaustive headless, operator-accepted). SC7 key half met. SC10 data layer met (visible indicator + log viewer deferred to Flight 5). **HAT** satisfied live (external user-wide MCP client drove the confined default jar; admin tier confirmed; cross-OS-boundary consumer completed `initialize` — proving the use-case #2/#3 reach path early). Out-of-band operator-requested fix: `scroll` rewired to in-process CDP mouseWheel (commit `cb58231`, crosses DD8, verified live). **590 tests green; typecheck + lint clean.** PR #41 ready, stacked on `flight/03-mcp-transport` (#40). Flight debrief is the separate `/flight-debrief` step.

---

## Design Review Notes (Phase 5b)

Architect review (2026-06-14): **approve with changes** — incorporated before crew approval.
- Both load-bearing premises **verified against the codebase**: DD2 (SDK `StreamableHTTPClientTransport` `requestInit.headers` merges last → Bearer header works) and DD7's mechanism (jar membership via **Session object identity** `wc.session === session.fromPartition(jar.partition)`, the same discipline as `__goldfinchInternal`).
- **DD7 sharpened (the SC8 linchpin):** the `Session→jar` resolver is **net-new** (no such map exists today; jarId only reaches automation via the untrusted renderer hook). Scoping authority must be the **resolved session, never the renderer-reported `jarId`**. Resolver placed in `resolve.js` beside `resolveContents` (lazy `session.fromPartition` compare). **Burner jars** (`burner:N`, renderer-only, absent from `jars.list()`) are **unautomatable** by construction.
- **DD4 sharpened:** per-request re-validation reads settings **live** (not a session-creation snapshot) — otherwise Flight-5 revoke-kills-live-session is silently unreachable (state-reachability catch).
- **DD5:** `automationKeyHashes` is object-typed → needs an **explicit** validator (64-char-hex map; reject null/arrays — don't ride the `toolbarPins` boolean pattern); additive keys → no migration.
- **DD6:** empty/missing `GOLDFINCH_AUTOMATION_ADMIN` must never match (no empty-Bearer accept).
- **Leg merge:** `admin-tier` folded into `jar-scoping-and-admin` (one cohesive identity+scoping change; avoids a half-identity model). Dev mint/enable path gated on `isMcpAutomationEnabled` (not `isAutomationDevEnabled`) to avoid re-coupling to `--remote-debugging-port`.
- Single review cycle; changes were the Architect's own prescribed fixes (no new design risk introduced). Per-leg design reviews at execution provide the next rigor gate.

---

## Leg Progress

### Leg 05 — verify-integration
**Status**: in-flight (code portion implemented 2026-06-14; FD drives the live behavior-test runs + finalizes)

#### Implementation — CODE portion (2026-06-14)

Built the env-gated **auto-mint-to-stdout** dev affordance so the SC8 behavior tests are runnable by an external headless / FD-driven harness (the chrome-renderer-only `automation:dev-enable-mint` IPC is unreachable from outside). Three headless gates green.

**Files changed:**
- `src/shared/automation-dev.js` — added pure `shouldAutoMint(argv, env)` double-gate predicate: true **iff** `isMcpAutomationEnabled(argv)` (exact `--automation-dev` token) **AND** `env.GOLDFINCH_AUTOMATION_DEV_MINT === '1'` (strict equality on the literal `'1'`). Pure, never throws; admin gate is deliberately NOT folded in.
- `src/main/main.js` — at the MCP-start block (inside the existing `isMcpAutomationEnabled(process.argv)` branch, after the `automation:dev-enable-mint` handler) added a dev-only auto-mint block guarded by `shouldAutoMint(process.argv, process.env)`. When it fires: `enableAndMintJarKey('default', settings, jars)` mints a jar key for the canonical persistent `default` jar (always present in `jars.list()`; the mint guard rejects unknown/burner ids) and flips `automationEnabled=true`; if `GOLDFINCH_AUTOMATION_ADMIN` is set, `mintAdminKey(settings)` mints the admin key too (else `adminKey: null`). Prints the result **once** to stdout.
- `test/unit/automation-dev.test.js` — added a `shouldAutoMint` suite: fires only under BOTH gates; FALSE when env unset (plain `dev:automation` stays inert), when `--automation-dev` absent, for `--remote-debugging-port`+env (dev:debug must not auto-mint), for non-`'1'` env values (`'true'`/`'yes'`/`'0'`/`''`), and for non-array argv / missing env; never throws.

**Exact stdout line format (FD parses this for the Bearer key):**
```
AUTOMATION_DEV_MINT {"key":"<plaintext-jar-key>","adminKey":"<plaintext-admin-key-or-null>"}
```
Single line, terminated with `\n`. `adminKey` is `null` when `GOLDFINCH_AUTOMATION_ADMIN` is unset. Produced via `process.stdout.write('AUTOMATION_DEV_MINT ' + JSON.stringify({ key, adminKey }) + '\n')`.

**Gating predicate:** `shouldAutoMint(process.argv, process.env)` = `isMcpAutomationEnabled(argv) && env.GOLDFINCH_AUTOMATION_DEV_MINT === '1'`. Inert otherwise — no enable, no print. Never runs in a shipped build (it sits behind `--automation-dev`, which only `npm run dev:automation` supplies).

**Headless gate summaries:**
```
npm test       → # tests 579  # pass 579  # fail 0   (suites 7)
npm run typecheck (tsc --noEmit -p jsconfig.json) → clean
npm run lint      (eslint .)                        → clean
```

**Not done here (FD's job):** live behavior-test runs (`mcp-auth-gating`, `mcp-jar-scoping`), run logs, `Last Run` stamps, leg finalization, commit. No GUI launched.

---

### Leg 01 — key-model-and-gate
**Status**: landed (implemented 2026-06-14; awaiting batched Reviewer pass + commit at flight end)

#### Implementation (Phase 2b — 2026-06-14)

Implemented to all acceptance criteria. Three gates green.

**Files changed:**
- `src/main/settings-store.js` — added the three additive keys to `DEFAULTS` (`automationEnabled: false`, `automationKeyHashes: {}`, `automationAdminKeyHash: ''`) with a `Settings` typedef; added explicit strict validators (boolean; 64-char-lowercase-hex map rejecting null/array/non-hex via a shared `HEX64` regex; `'' || 64-hex` admin hash). Extended the deep-copy guard for `automationKeyHashes` in **both** `freshDefaults()` and `getAll()`.
- `src/main/automation/automation-auth.js` — **new** pure, Electron-free module: `hashKey` (SHA-256 hex), `generateKey` (CSPRNG, 32 bytes base64url), `hashEquals` (constant-time `timingSafeEqual` over fixed-length hex digests; false on malformed/length-mismatch without an early-out leak), and `validateKey(presented, {keyHashes, adminKeyHash, adminEnabled}) → jarId | 'admin' | null` (admin checked first only when gate+non-empty-hash; never throws).
- `src/main/automation/mcp-server.js` — added injected `getSettings` dep (default `() => require('../settings-store')`); added the auth gate in `onRequest` **after** the origin guard (live per-request read; bare `401` on disabled/missing/malformed/invalid; guard-first order preserved); capped `readJsonBody` at a 1 MiB exclusive constant resolving a discriminated `BODY_TOO_LARGE` sentinel → `413` (distinct from the empty/parse-fail → 400 path); added module-level `enableAndMintJarKey(jarId, settings)` / `mintAdminKey(settings)` dev helpers.
- `src/main/main.js` — wired a parallel `automation:dev-enable-mint` IPC handler in the MCP-start block under the **same `isMcpAutomationEnabled` gate** (chrome-renderer identity check mirroring `automation:dev-invoke`); returns `{ key, adminKey }` plaintext once via the IPC return value.
- `test/unit/automation-auth.test.js` — **new** (validator jarId/admin/null paths, admin env-gate-off + empty-hash edges, empty-Bearer, `hashEquals` malformed/length-mismatch, never-throws).
- `test/unit/settings-store.test.js` — extended (three validators accept/reject incl. null/array/non-hex/uppercase/wrong-length; no-version-bump; getAll + freshDefaults no-shared-ref for the key map).
- `test/unit/automation-mcp-server.test.js` — extended with an injected `getSettings` stub + Bearer-on-`connectClient` + a raw-POST helper (401 disabled / missing / empty-Bearer / wrong-key, pass-through on valid key, case-insensitive scheme, 413 over-cap distinct from 400, normal body unaffected).

**Decisions:**
- **No schema `version` bump** — confirmed: `load()` merges over `Object.keys(DEFAULTS)` with no version-gated migration anywhere in the file, so additive keys need no bump and a bump would trigger no machinery. (DD-noted in the design review; carried out.)
- **413 implementation deviation from the leg's literal `req.destroy()` ordering:** destroying the request inside `readJsonBody` tore down the socket *before* the 413 could be written (client saw ECONNRESET, not 413 — caught by the new cap test). Final shape: on over-cap, **pause** the stream and release buffered chunks, resolve the `BODY_TOO_LARGE` sentinel; the caller (`routeRequest`) writes the bare `413` and **then** `req.destroy()`s to stop the inbound flood. Same intent (no buffering past the cap, distinct from 400), correct ordering.

**Decision recorded — 401/403 shapes:** the auth gate's 401 is bare `writeHead(401)/end()`, mirroring the origin guard's bare 403 (both pre-routing, envelope-free). The 403 origin guard is unchanged and still runs first.

**Scope (carried as designed):** identity is resolved (`jarId|'admin'|null`) but NOT bound to the session / jar-scoped — that is leg `jar-scoping-and-admin`. Key hashes flow through `getAll()` to the renderer (acceptable — non-secret at rest per DD5; UI filtering is Flight 5). No `settings-changed` broadcast on the new keys (out of scope for leg 1).

**Test results:**
```
# tests 515
# suites 6
# pass 515
# fail 0
```
`npm run typecheck` (tsc) — clean. `npm run lint` (eslint) — clean.

**Anomalies:** none beyond the 413 ordering deviation noted above.

#### Design review (Phase 2a)
Developer design review: **approve with changes** — all incorporated (single cycle; changes were the reviewer's own prescribed fixes, no new design risk → no second review needed):
- **[high]** Server has no settings access today (`createMcpServer` opts = `{getEngine,version,port}` only). Mandated an injected `getSettings` dep (default `() => require('../settings-store')`), read live per-request, stubbable in the headless test.
- **[med]** `readJsonBody` over-cap (413) must be distinct from the empty/unparseable → 400 case (both resolve `undefined` today). Specified discriminated result / `res`-write-sentinel + `req.destroy()`.
- **[med]** 401 shape fixed as bare `writeHead(401)/end()` mirroring the 403 guard (pre-routing, envelope-free).
- **[low]** Definitive: do **not** bump settings `version` (additive keys, no migration machinery).
- Deep-copy hazard named in **both** `freshDefaults()` and `getAll()` for `automationKeyHashes`.
- Dev mint wiring located: `main.js` ~line 762 MCP-start block; parallel `automation:dev-enable-mint` IPC under the `isMcpAutomationEnabled` gate; plaintext returned via IPC return value (harness-usable).
- Scope decisions recorded: hashes flow through `getAll()` to renderer — acceptable (non-secret per DD5), UI filtering is F5; broadcast fan-out out of scope for leg 1.

---

## Flight Director Notes

**2026-06-14 — Out-of-band fix (operator-requested during HAT): synthetic `scroll` rewired to CDP.**
Discovered live while demoing the surface through the user-wide MCP: `scroll` (sendInputEvent mouseWheel) does **not** move `<webview>` guests — empirically confirmed (no-op recapture is byte-identical → capture is a reliable observable; post-scroll hash unchanged). A first attempt (prepend `mouseMove` + chunk the wheel delta + `canScroll`) still produced zero movement → it's an Electron `sendInputEvent`-wheel-on-webview limitation, not a builder bug.
- **Decision (operator-approved via AskUserQuestion): rewire `scroll` to in-process CDP `Input.dispatchMouseEvent({type:'mouseWheel'})`** — the only reliable, SC2-compliant mechanism (fires real wheel handlers). This **crosses Flight-2's DD8** ("input.js is debugger-free") — recorded as a deliberate, operator-approved partial supersession of DD8 (annotated here, not by rewriting Flight-2's artifact).
- **Implementation:** extracted the shared debugger discipline into `src/main/automation/cdp.js` (`withDebuggerSession` + the **single shared `attached` lock** + `debuggerUnavailable`); `readAxTree` refactored to use it (contract preserved exactly); `scroll` reimplemented through it. The shared lock means a concurrent `scroll` + `readAxTree` on one wcId cannot both attach (one gets the `locked` refusal). Dead `scrollEvent`/`scrollEvents` builders removed.
- **Verified LIVE** through the gated MCP (key `tpuKI…`): a Wikipedia article scrolled ~2500px (screenshot hash changed `92bfa2…`→`8c3c02…`; after-shot shows the version-history table). Independent code review: `[HANDOFF:confirmed]` (readAxTree contract intact, lock race-safe, no detach/lock leak). Gates: 590/590 tests, typecheck + lint clean.
- **Scope note:** this is a Flight-1/SC2 behavior fix riding on `flight/04-gating` (committed separately from the gating work); the flight debrief should carry it forward. Not part of SC8.

**2026-06-14 — Leg 05 (`verify-integration`) — live runs + operator disposition.**
Auto-mint-to-stdout helper built (Developer; gated on `isMcpAutomationEnabled(argv)` + `GOLDFINCH_AUTOMATION_DEV_MINT=1`; prints `AUTOMATION_DEV_MINT {"key","adminKey"}` once). **Full headless gates green: `npm test` 579/579, typecheck clean, lint clean.**
FD-driven machine-read live runs (apparatus: `curl` + SDK MCP client over the loopback transport; app via `npm run dev:automation` + the mint env; ports overridden via `GOLDFINCH_MCP_PORT` 7797–7799 because a stale server held 7777 — apparatus note, not a defect):
- **`mcp-auth-gating` → PASS (full).** off-by-default (clean profile, no mint) → 401; valid jar key → 200; missing/wrong/empty-Bearer → 401; **bad-origin+valid-key → 403 (guard-first live)**; admin key vs admin-env-SET → 200, **same admin key vs admin-env-UNSET → 401 (admin tier inert unless env set)**. Run log: `tests/behavior/mcp-auth-gating/runs/2026-06-14-13-20-52.md`.
- **`mcp-jar-scoping` → PARTIAL.** Live-confirmed: jar key `enumerateTabs` scoped to its own jar; jar `captureWindow` → `automation: admin-only` (distinct refusal, live); admin `captureWindow` → image (~61 KB png); admin enumerate works. NOT staged live (the MCP surface cannot switch jars or open internal/burner tabs): cross-jar `out-of-jar`, internal-session refusal, burner unautomatable, admin-sees-multiple-jars+internal — **exhaustively covered by the 579 headless integration tests** (fake multi-jar world keyed by real session-object-identity). Run log: `tests/behavior/mcp-jar-scoping/runs/2026-06-14-13-24-38.md`.
- **Operator disposition (2026-06-14, via AskUserQuestion):** **Accept FD-driven + headless** — land verify-integration on the full auth-gating live pass + the partial jar-scoping live pass + exhaustive headless coverage. The full GUI-staged Witnessed `mcp-jar-scoping` run is a **noted follow-up** (not a blocker). `mcp-jar-scoping` run-log status stays `partial`.
- Revoke/toggle-off-kills-live-session: covered by the headless integration suite (live per-request re-validation); not separately re-staged live.

### Leg 05 — verify-integration
**Status**: landed (helper built + headless gates green + live runs + operator disposition 2026-06-14)

---

**2026-06-14 — Leg 04 (`behavior-test-specs`) design + design-review.**
Developer design review: **approve with changes** (single cycle; reviewer's prescribed fixes + FD decisions — no second review). Incorporated:
- **[high → FD decision] Enable/mint apparatus gap is real.** The `automation:dev-enable-mint` IPC is **unreachable** by any external behavior-test harness (ipcMain locked to `mainWindow.webContents`; no preload bridge wrapper; chrome renderer is `contextIsolation:true`/`nodeIntegration:false`; a standalone script can't reach a running app's IPC). **Mechanism decided:** an **env-gated auto-mint-to-stdout** in `main.js` — gated on `isMcpAutomationEnabled(argv)` AND a NEW env var **`GOLDFINCH_AUTOMATION_DEV_MINT=1`** (distinct from `--automation-dev` so the off-state stays observable in a no-mint launch); mints jar key (+admin key when `GOLDFINCH_AUTOMATION_ADMIN` set), flips `automationEnabled`, prints `{key,adminKey}` once to stdout. **This helper is a CODE change → built in `verify-integration`, NOT this leg (specs only). ⚠️ CARRY-FORWARD: `verify-integration` must build the auto-mint-to-stdout helper before running the two specs.**
- **[med]** Off-by-default must be a **two-run split** (Run A no-mint → 401-while-disabled; Run B mint → accepted), since the helper enables at boot. Reflected in `mcp-auth-gating`.
- **[med]** Admin enumerate phrased **positively** ("at minimum all persistent jars + internal tab"); admin also sees burners (`allowInternal:true`) → no negative admin assertion; burner-exclusion confined to jar-key rows.
- Kept **two specs per DD10** (`mcp-jar-scoping` carries both jar-key and admin runs as relaunch-gated variants; admin needs a 2nd relaunch).
- Confirmed exact against code: refusal codes `out-of-jar`/`internal-session`/`admin-only`; all 401 paths (disabled/missing/empty-Bearer/bad-key); admin-inert-unless-env-set; guard-first 403 (delegated to `mcp-loopback-origin-guard`); admin re-scope faithful (sees-all-guests+internal+captureWindow, not drives-chrome — chrome wcId undiscoverable via `listTabs()`); session-vs-jarId scoping authority correctly flagged unit-backed.

### Leg 04 — behavior-test-specs
**Status**: ready (designed + design-reviewed 2026-06-14)

---

**2026-06-14 — Leg 03 (`audit-data`) design + design-review.**
Developer design review: **approve with changes** (single cycle; reviewer's own prescribed fixes, no new design risk → no second review). Incorporated:
- **[high]** Per-session `sessionRef = {id:null}` allocated in `routeRequest` *above* the transport construction, closed over by `onsessioninitialized` AND threaded into `buildServer(identity, sessionRef)`; callTool wrapper reads `sessionRef.id` **lazily** at call time. No shared/module-level ref (would be a cross-session bug; `buildServer` news a fresh Server+registry per session — confirmed).
- **[high]** `noteSessionClose` made **idempotent** (no-op + no `onChange` if sid absent) → no double-broadcast from stop()+onclose+double-close.
- **[med]** Wire `noteSessionClose` into `transport.onclose` **only** (stop() cascades through it); dropped the separate stop()-loop call.
- **[med]** `errorCode` regex anchored to the ` — ` separator (`/^automation:\s*([a-z-]+)\s+—/`) so bare messages (`engine unavailable`) fall back to `'error'` instead of a truncated code.
- **[low]** `getActivity()` added to the returned `{start,stop,port}`.
- Pinned: `recentEntries()` newest-last (append) order; broadcast **per-mutation** (fine for one consumer); `activeSessions()` tracks **transport lifecycle not auth-liveness** (revoke enforced at the gate, indicator lags to transport close) — documented for Flight 5.
- Confirmed sound: callTool is the single choke (`mcp-tools.js:367`); `{content,isError}` shape + `errResult` text carry the `automation:` prefix; `broadcast` opt fits the injected-deps pattern; harness can express the tests with no changes.

### Leg 03 — audit-data
**Status**: landed (implemented 2026-06-14; awaiting batched Reviewer pass + commit at flight end)

#### Implementation (Phase 2b — 2026-06-14)

Implemented to all acceptance criteria. Three gates green.

**Files changed:**
- `src/main/automation/audit-log.js` — **new**, pure, Electron-free, dependency-free. `createAuditLog({ capacity = 500, now = () => Date.now(), onChange } = {})` → `record`, `noteSessionOpen`, `noteSessionClose`, `recentEntries` (copy, newest-LAST), `activeSessions` (`{sessionId, identity, kind:'admin'|'jar', jarId, since}`), `snapshot` (`{sessions, log}`). `record` stamps `ts` via the injected `now`, fills `sessionId`/`targetWcId`/`errorCode` defaults to `null`, and evicts oldest past `capacity` (plain-array ring, `shift` on overflow). `noteSessionClose` is **idempotent** — unknown sid → no-op, **no `onChange`**. Every mutator fires `onChange(snapshot())`. `DEFAULT_CAPACITY = 500` exported as the named constant.
- `src/main/automation/mcp-server.js` — one `auditLog = createAuditLog({ onChange: (snap) => broadcast(snap) })` per server. New `broadcast` opt (default no-op). Recording wired at the **callTool choke** by **wrapping `registry.callTool` inside `buildServer(identity, sessionRef)`** (mcp-tools.js stays audit-free): records after the call, `outcome` from `result.isError`, `errorCode` parsed via the module-scoped `ERROR_CODE_RE = /^automation:\s*([a-z-]+)\s+—/` (separator-anchored; bare messages → `'error'` fallback). Per-session `const sessionRef = { id: null }` allocated in `routeRequest` **above** the transport, set in `onsessioninitialized`, threaded into `buildServer`, and read **lazily** (`.id` at call time) in the wrapper. `noteSessionOpen` at `onsessioninitialized`; `noteSessionClose` in `transport.onclose` **ONLY** (relies on idempotency for the stop()-cascade). Returned object gains `getActivity()` → `auditLog.snapshot()`.
- `src/main/main.js` — injected `broadcast: (payload) => broadcastToChromeAndInternal('automation-activity-changed', payload)` into `createMcpServer`.
- `test/unit/automation-audit-log.test.js` — **new**: `DEFAULT_CAPACITY`; `record` ts-stamping + newest-last; default-fill; errorCode on error; ring eviction at capacity; `recentEntries` is a copy; jar `kind`/named `jarId` + admin `kind`/null `jarId`; close removal; **close idempotency (no spurious `onChange`)**; `onChange` fires a full snapshot per mutation; `snapshot` point-in-time independence; optional `onChange`.
- `test/unit/automation-mcp-server.test.js` — **extended** with an audit section over the existing multi-jar fake world + a broadcast sink: a successful `navigate` appends one entry (`identity:'test'`/`op`/`targetWcId:1`/`outcome:'ok'`/`errorCode:null`, populated `sessionId`); an out-of-jar `navigate` records `outcome:'error'`/`errorCode:'out-of-jar'`; a no-wcId op records `targetWcId:null`; session open/close updates `getActivity().sessions` (named jar; admin → `kind:'admin'`/`jarId:null`); the injected `broadcast` fires the snapshot on open + tool call + close. Added a `waitFor` poll helper.
- `docs/mcp-automation.md` — new "Activity audit + the `automation-activity-changed` broadcast (Flight-5 contract)" section documenting the channel, the snapshot shape, the per-mutation cadence, `getActivity()`, ring-is-a-live-tail / no-persistence, and the transport-liveness-not-auth-liveness lag note.

**Decisions / deviations:**
- **Persistence: in-memory ring only, no disk persistence** (DD8, confirmed this leg). The data backs a live Flight-5 indicator, is bounded (capacity 500, a named constant), and is cheap to lose on restart. Reversible to a persisted store later if Flight 5 wants cross-restart history. Documented in both the module header and the consumer docs.
- **Recording lives in the transport wrapper, not the op layer.** `registry.callTool` is wrapped once in `buildServer` so `mcp-tools.js` and the 16 tool `call`s stay audit-free — a single choke point.
- **`noteSessionClose` wired into `transport.onclose` ONLY** and made idempotent, so `stop()` (which closes each transport → cascades through `onclose`) does not double-fire or emit a spurious broadcast.
- **Test-harness deviation:** the session-drain / close-broadcast tests call `client.transport.terminateSession()` (HTTP DELETE) before `client.close()` to fire the server transport's `onclose` mid-life. A bare `client.close()` over the `connection: close` harness does not tear down the **server-side** transport (only `stop()` would, which is end-of-life), so the explicit DELETE is the realistic disconnect that exercises `noteSessionClose`. The active-set drain is async over HTTP → polled via the new `waitFor` helper.

**Test results:**
```
# tests 571
# pass 571
# fail 0
```
`npm run typecheck` (tsc --noEmit) — clean. `npm run lint` (eslint) — clean.

**Anomalies:** none beyond the test-harness terminateSession deviation noted above.

---

**2026-06-14 — Leg 02 (`jar-scoping-and-admin`) design + design-review.**
Developer design review: **approve with changes** (single cycle; all changes were the reviewer's own prescribed fixes + one FD scope decision — no new design risk → no second review). Incorporated:
- **[high]** DD4 split into two mechanisms in the leg: the `onRequest` gate already kills toggle-off/total-revoke (runs every request); the **net-new** identity-match goes in `routeRequest`'s existing-session branch (before `entry.transport.handleRequest`) to catch session-id reuse under a different valid key. Resolve identity once in `onRequest`, pass to `routeRequest`; bare 401 both paths.
- **[high → FD scope decision]** "admin sees all + **the chrome**" re-scoped. The chrome renderer (`mainWindow.webContents`) is **structurally undiscoverable** via the surface — `listTabs()` enumerates only `<webview>` guests, never the chrome renderer. For **Flight 4**, admin = cross-jar guest-tab visibility + internal `goldfinch://settings` tab + `captureWindow` (whole-window composite, which *includes* the chrome). This is faithful to DD6 ("whole-window capture"). **Driving the chrome renderer** (toolbar/tab-strip) needs a net-new chrome-enumeration affordance — **deferred to Flight 6** (when dogfooding the chrome's own behavior specs, e.g. `tab-keyboard-operability`, actually requires it). **Carry-forward:** the `behavior-test-specs` leg's `mcp-jar-scoping` admin assertion must be written to this re-scoped capability (sees-all-guests + internal + captureWindow), NOT "drives the chrome", or it would be unsatisfiable.
- **[med]** `input.js`/`observe.js` resolve **twice** (pre/post-activate) — both sites must forward `allowInternal` or admin's internal drive silently re-throws. Enumerated all resolve sites in the leg.
- **[med]** One shared `fromId` across the façade and the engine (no divergence).
- **[low]** Bound identity is a jarId matching a `jars.list()` id; added a **mint guard** (reject mint for a jarId absent from `jars.list()`). Bare 401 for the routeRequest identity-mismatch.
- **Confirmed sound:** session-object-identity membership (`wc.session === fromPartition(jar.partition)`) — same discipline as `__goldfinchInternal`; the wcId-first op categorization (13 wcId-first ops; `enumerateTabs`/`openTab`/`captureWindow` special-cased); the test harness can express multi-jar + internal tabs via injected fake `fromId`/`fromPartition`.

### Leg 02 — jar-scoping-and-admin
**Status**: landed (implemented 2026-06-14; awaiting batched Reviewer pass + commit at flight end)

#### Implementation (Phase 2b — 2026-06-14)

Implemented to all acceptance criteria. Three gates green.

**Files changed:**
- `src/main/automation/resolve.js` — `resolveContents(wcId, deps)` now reads `allowInternal` from deps and **skips** the `internal-session` throw only when `allowInternal === true` (admin's sole relaxation); `bad-handle`/`no-such-contents` always apply; back-compatible (existing no-arg callers behave as before). Added net-new **`resolveContentsForJar(wcId, jar, deps)`**: calls `resolveContents` first, then verifies `wc.session === deps.fromPartition(jar.partition)` (session **object identity**, DD7) → throws `automation: out-of-jar` on mismatch or a null jar. Lazy `fromPartition` compare (no cached map) so a runtime `jars-add` resolves. Kept electron-free (`fromPartition` injected). Exported.
- `src/main/automation/engine.js` — `createEngine(getMainWindow, { allowInternal = false } = {})`; `deps()` now carries `allowInternal` + `fromPartition: session.fromPartition` (added `session` to the electron require). The shared `fromId` and `fromPartition` flow to every op so the façade and engine cannot diverge.
- `src/main/automation/tabs.js`, `nav.js`, `input.js`, `observe.js` — every op now forwards its **full deps** (carrying `allowInternal`) to `resolveContents` instead of reconstructing `{fromId, chromeContents}`. The double-resolve ops (`input.js` `actOn`; `observe.js` `captureScreenshot`/`readDom`/`readAxTree`) forward on **both** the pre- and post-activate resolve. `tabs.js` `mapEnumeratedTabs` drops the internal session only when `!allowInternal` (admin keeps it); threaded from `enumerateTabs`.
- `src/main/automation/scope.js` — **new** jar-scoping façade `scopeEngine(engine, identity, ctx)`. admin → engine unchanged. jar → resolve jar from `jars.list()` per call (so a deleted jar degrades), a generic wrapper over the 13 wcId-first ops calling `resolveContentsForJar` first; `enumerateTabs` filtered by **resolved session** (not the renderer `jarId`); `captureWindow` → distinct `automation: admin-only`; `openTab` delegated; unknown/revoked/deleted jar → all-ops-error (`automation: no-such-jar`). Electron-free (ctx-injected `fromId`/`fromPartition`/`getChromeContents`/`jars`).
- `src/main/automation/mcp-server.js` — `isAuthorized(req) → boolean` refactored to **`resolveIdentity(req) → jarId|'admin'|null`** (live settings read + env gate). Identity resolved **once** in `onRequest` (`null` → bare 401) and passed into `routeRequest`. New existing-session **identity-match** check before delegating to `entry.transport.handleRequest` (bare 401 on mismatch — the case the gate doesn't catch). Identity **bound** into the `sessions` entry (`{server,transport,identity}`) at `onsessioninitialized`. `buildServer(identity)` builds `buildToolRegistry(() => scopeEngine(getEngine({ allowInternal: identity==='admin' }), identity, scopeCtx))`. Engine accessor now `getEngine({ allowInternal })`. Scope ctx injected via a new `createMcpServer` `scopeCtx` opt. Mint guard added to `enableAndMintJarKey(jarId, settings, jars?)` — rejects a jarId absent from `jars.list()`.
- `src/main/main.js` — `getEngine: (engineOpts) => createEngine(() => mainWindow, engineOpts)`; `scopeCtx` wired (`jars`, `webContents.fromId`, `session.fromPartition`, `() => mainWindow?.webContents`); `enableAndMintJarKey(jarId, settings, jars)` now passes `jars` so the mint guard fires.
- `test/unit/automation-resolve.test.js` — extended: `resolveContents` allowInternal on/off (internal skipped only on true; bad/dead still throw); `resolveContentsForJar` match / out-of-jar / burner / null-jar / bad-dead-internal-first / **runtime jars-add** via lazy `fromPartition`.
- `test/unit/automation-scope.test.js` — **new**: admin pass-through (same reference); jar enumerate filtered by session not label (both spoof directions); every wcId-first op membership-gated; out-of-jar / burner / internal refusals; `captureWindow` → admin-only (distinct from out-of-jar); `openTab` delegated; unknown jar + jar-deleted-mid-session → all-ops-error.
- `test/unit/automation-mcp-server.test.js` — extended with a multi-jar fake world (partition→session map with **real object identity**, a burner tab, an internal-session tab, injected fake `fromId`/`fromPartition`/`jars`): a jar session enumerates only its jar; out-of-jar refused; burner refused; internal refused; jar `captureWindow` → admin-only; admin (env-set) enumerates all jars + internal + `captureWindow` succeeds + drives internal; admin env-unset → 401; existing-session **identity-mismatch → 401**; **toggle-off mid-session → next request 401**; mint-guard known/unknown/burner/no-jars cases. Updated the shared harness to inject `scopeCtx`; the two image ops' fakes return `''` (base64) so the SDK accepts the image-content envelope.

**Decisions / deviations:**
- **`resolveContentsForJar` accepts a null jar and throws `out-of-jar`** (rather than a separate signature) so the façade's "jar gone mid-call" path and "out-of-jar tab" path share one guard.
- **Unknown/revoked/deleted jar → `automation: no-such-jar`** (a sibling of `out-of-jar`) raised inside the façade per-op via a `requireJar()` re-resolve each call, so a jar deleted mid-session degrades safely without a cached map.
- **`enableAndMintJarKey` jars accessor is optional** — passing `jars` activates the mint guard (main.js always does); omitting it keeps the legacy non-empty-string check so the pure auth tests need no jars module.
- **Test-harness deviation:** the new identity-mismatch / live-revalidation tests open the session via a **raw initialize** (capturing the `Mcp-Session-Id` response header) instead of the SDK client, to avoid the SDK client's background SSE stream leaking a dead socket across the raw probe + `stop()` (it surfaced as a "fetch failed" on `client.close()`).

**Known limitation (carried, as designed):** a jar key's `openTab` cannot **target** the jar in v1 — a new tab opens in the renderer's active container. A tab that lands in another jar is simply not enumerable/drivable by the key (no cross-jar read — confinement holds). Acceptable for Flight 4; revisit if jar-targeted open is needed.

**Scope confirmations:**
- Admin = cross-jar guest visibility + internal `goldfinch://settings` tab + `captureWindow` (whole-window composite). Driving the chrome renderer is **not** in scope (structurally undiscoverable via `listTabs()`; deferred to Flight 6 per the FD scope decision above).
- DD4 live re-validation: the existing `onRequest` gate already kills a live session on toggle-off / total-revoke (`resolveIdentity → null` → 401) — **confirmed by test**, not re-implemented. The net-new mechanism is only the existing-session **identity-match** in `routeRequest`.
- Session-object-identity membership and the identity-binding plumbing matched the leg's assumptions exactly — no divergence.

**Test results:**
```
# tests 552
# suites 6
# pass 552
# fail 0
# skipped 0
# todo 0
```
`npm run typecheck` (tsc --noEmit) — clean. `npm run lint` (eslint) — clean.

**Anomalies:** none beyond the test-harness raw-initialize deviation noted above.

**2026-06-14 — Flight execution started (`/agentic-workflow`).**
- Phase file loaded: `goldfinch/.flightops/agent-crews/leg-execution.md` (valid structure — Crew / Interaction Protocol / Prompts present). Crew: Developer (Sonnet), Reviewer (Sonnet, never Opus). Accessibility Reviewer disabled — correct for this flight (no operator-facing chrome UI; DD1).
- Branch base: branched `flight/04-gating` off `flight/03-mcp-transport` (PR #40 not yet merged) per the flight's branch/PR cascade note. PR will stack on #40.
- Flight status `ready` → `in-flight`.
- State check: no legs created yet; flight-log clean. Fresh start at leg 1 (`key-model-and-gate`).
- Plan: design + design-review each leg, batch-implement the autonomous legs (no per-leg commit), single Reviewer pass + commit at flight end. `behavior-test-specs` authors specs (autonomous); `verify-integration` runs the two behavior tests FD-driven; `hat-and-alignment` is interactive (operator-guided, no autonomous agents).

**2026-06-14 — Leg 04 (`behavior-test-specs`) — specs authored.**

Authored the two SC8 acceptance specs (markdown only — **no source changes**, lint clean):
- `tests/behavior/mcp-auth-gating.md` — SC8 **auth gate** (status `active`, matching the Flight-3 specs). Active-precondition probe leads; structured as **Run A** (no mint env → off-by-default: keyless and fabricated-Bearer both 401 while `automationEnabled=false`), **Run B** (`GOLDFINCH_AUTOMATION_DEV_MINT=1` → valid jar key accepted via `initialize`+`enumerateTabs`; missing/wrong/empty-`Bearer ` all 401; admin key inert → 401 with `GOLDFINCH_AUTOMATION_ADMIN` unset), **Run C** (admin env set → same admin-key shape accepted). Guard-first ordering (403 origin is the sibling's concern) stated in Intent + Out of Scope.
- `tests/behavior/mcp-jar-scoping.md` — SC8 **confinement** (status `active`). Setup row (no judgment) stages `personal` + `work` persistent tabs, a burner, and the internal `goldfinch://settings` tab. Jar-key run: enumerate lists only `personal`; cross-jar drive → `automation: out-of-jar`; internal drive → `automation: internal-session`; burner absent + drive → `out-of-jar` (burner-exclusion confined to jar-key rows); jar `captureWindow` → `automation: admin-only`. Admin run (2nd relaunch, env-set, tabs re-staged): enumerate **at minimum** all persistent jars + internal (positive, no negative); drives any jar + internal; `captureWindow` → image. `[mixed-frame]` markers on the refusal+no-side-effect pairings (Steps 3/5). Session-vs-`jarId` authority flagged **unit-backed** (Leg-2 units), not behavior-tested. Admin assertion written to the **FD re-scope** (sees-all + internal + `captureWindow` composite, NOT driving the chrome renderer).

Both specs' Preconditions name the enable/mint apparatus precisely (`isMcpAutomationEnabled(argv)` + `GOLDFINCH_AUTOMATION_DEV_MINT=1` → `enableAndMintJarKey`/`mintAdminKey` → prints `{ key, adminKey }` once to stdout) and name the key-attach mechanism (`Authorization: Bearer <key>` on the SDK client transport via `requestInit.headers`, the `connectClient(key)` pattern). Refusal strings + 401 paths grounded against `scope.js`/`resolve.js`/`mcp-server.js`.

**`verify-integration` PREREQUISITE (restated):** the **auto-mint-to-stdout wrapper in `main.js`** does **NOT** exist yet. `enableAndMintJarKey`/`mintAdminKey` are landed, but the boot-time helper that calls them (gated on `--automation-dev` + `GOLDFINCH_AUTOMATION_DEV_MINT=1`) and prints `{ key, adminKey }` to stdout must be **built in `verify-integration`** before either spec can run. Each spec's Preconditions flags this.

**Authoring notes:** verified the SDK client transport accepts a static Bearer via `opts.requestInit.headers` (node_modules check); `enableAndMintJarKey` already enforces a mint guard (jarId must be in `jars.list()`, so a `personal` mint is valid and burner ids are rejected at mint). `npm run lint` clean (no code touched).

---

## Decisions
_Runtime decisions not in the original plan will be recorded here._

---

## Deviations
_Departures from the planned approach will be recorded here._

---

## Anomalies
_Unexpected issues will be recorded here._

---

## Session Notes
_Chronological notes from work sessions will be recorded here._
