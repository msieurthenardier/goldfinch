# Flight: Gating — opt-in + key auth + audit

**Status**: in-flight
**Mission**: [First-Class Browser Automation Surface](../../mission.md)

## Contributing to Criteria
- [x] **SC7** (key half) — a request with a missing or wrong key is rejected; a valid key is accepted (the structural loopback/Origin-Host half landed in Flight 3).
- [x] **SC8** — off by default + opt-in + requires a valid key; **per-jar keys** (each authorizes its own jar's web surface only) + an **env-gated admin key** (invisible/inert unless the gating env var is set; never issued externally).
- [x] **SC10** (data layer only) — automation activity is **auditable**: while a client is attached the system holds queryable session-active state (distinguishing admin vs jar, naming the jar) + an action log. *The visible indicator + log viewer UI is Flight 5* (the UI-heavy flight) — this flight delivers the data + broadcast it rides on. (data layer; visible indicator is Flight 5)

---

> **Branch / PR cascade.** Flight 3's PR (#40) is not yet merged. This flight **branches off `flight/03-mcp-transport`** (not `main`) and **stacks its PR** on #40 — the auth stack cascades until merged in order. Branch: `flight/04-gating`.

> **Scope boundary (Flight 4 ↔ Flight 5, operator-agreed).** Flight 4 owns the **auth core**: the opt-in toggle, the key *model* + storage + validation, jar-scoping enforcement, the env-gated admin tier, the audit **data layer**, behavior tests, and a **minimal dev path** to enable + mint a jar key (so the gate is real and end-to-end testable). **Flight 5 owns the management UX**: generate/rotate/revoke controls on the jars surface, the admin-key control, the visible "automation active" indicator, and the audit-log viewer. No operator-facing chrome UI ships in this flight.

## Pre-Flight

### Objective

Turn the Flight-3 ungated-but-dev-gated transport into the gated surface the mission requires: **off by default**, **opt-in**, **key-authenticated per jar**, with an **env-gated admin tier**, **jar-scoped** so a jar key sees and touches only its own jar's tabs (the internal-session exclusion staying absolute for jar keys; the admin key its sole authorized relaxation), and **auditable** (queryable session state + an action log as data, broadcast for Flight 5's UI). The auth gate composes with the Flight-3 Origin/Host guard (guard first, then key) and binds identity to the session at creation. Verified by behavior tests (`mcp-auth-gating`, `mcp-jar-scoping`) run this flight.

### Open Questions
- [x] **Flight 4/5 split** → RESOLVED (operator): auth core + minimal key-set here; all management/indicator/audit UI in Flight 5 (see Scope boundary).
- [x] **Key presentation mechanism** → **RESOLVED (DD2):** `Authorization: Bearer <key>` request header, validated in `onRequest` after the origin guard. *Premise to verify at leg time:* the MCP SDK `StreamableHTTPClientTransport` can set the `Authorization` header (via `requestInit.headers` or an auth provider) — confirm against 1.29.0 before locking the client side of the behavior tests.
- [x] **Key storage form** → **DD5 (operator-confirm at review):** store **key hashes** (SHA-256), keyed by jarId, through the settings-store codec seam; validate by hashing the presented key (constant-time compare); the plaintext key is shown **once at generation** (Flight 5 UI) and never persisted. *This revisits the mission's "encrypted `safeStorage` codec seam" sub-detail* — hashing makes the jar keys non-secret-at-rest (no decryption needed, nothing to leak), which is arguably stronger than storing an encrypted retrievable key. Flagged for sign-off; if you want retrievable encrypted keys instead, say so and we use the safeStorage codec.
- [x] **Admin key supply** → **RESOLVED (DD6, operator-chosen 2026-06-14):** the env var `GOLDFINCH_AUTOMATION_ADMIN` is a **presence gate**; the admin key is a **separately-managed hashed credential** (`automationAdminKeyHash`), minted in Flight 4's dev path and managed (generate/rotate/revoke) via Flight 5's env-gated control. Admin matches iff the gate is set AND the key hashes to the stored hash. (Chosen over "env value = the key" — aligns with the mission's "admin key from its env-gated control" and allows rotation without an env change.)
- [x] **Opt-in toggle semantics** → **RESOLVED (DD3):** bind-but-gate — the server binds under `--automation-dev` as today, but the auth gate rejects (401) until `automationEnabled` is true. Runtime toggle, no restart.
- [x] **Per-request re-validation** → **RESOLVED (DD4):** re-validate the Bearer key on **every** request reading settings **live** (so a Flight-5 revoke / toggle-off kills a live session) and verify the resolved identity matches the session's bound identity (no session-id reuse under a different key).
- [x] **Jar-membership mechanism** → **RESOLVED (DD7, design-review-confirmed):** session object identity (`wc.session === session.fromPartition(jar.partition)`), via a **net-new lazy `Session→jar` resolver in `resolve.js`**; scoping authority is the resolved session, never the renderer `jarId`; burner jars are unautomatable.

### Design Decisions

**DD1 — Flight 4 = auth core + minimal dev key-set; Flight 5 = management UX + all indicator/audit UI (operator-agreed).**
- Choice: this flight ships the toggle, key model/storage/validation, jar-scoping, env-gated admin tier, audit data layer, behavior tests, and a **dev-only** enable+mint path (gated on `--automation-dev`); Flight 5 ships the operator-facing Settings/jars controls + the visible indicator + the audit-log viewer.
- Rationale: keeps Flight 4 self-contained and **headless-testable** (no chrome UI → no Accessibility Reviewer, faster verification) while making the gate genuinely real and end-to-end exercisable now. Avoids a chicken-and-egg wait on Flight 5's UI.
- Trade-off: a dev-only enable/mint path exists transiently; it is `--automation-dev`-gated (never in a shipped build) and superseded by Flight 5's UI.

**DD2 — Key presentation: `Authorization: Bearer <key>` header; auth gate is the second pre-routing gate.**
- Choice: in `onRequest`, after the SC7 origin guard (unchanged, runs first), a new auth gate reads `Authorization: Bearer <key>`, validates it, resolves the identity (a jar or admin), and only then proceeds to `routeRequest`. Missing/invalid key or disabled surface → **401** (distinct from the guard's 403).
- Rationale: header-based fits the existing header-inspecting guard; Bearer is the MCP-ecosystem-standard auth shape; keeps the security decision out of `routeRequest`.
- Trade-off: every request carries the header (the SDK client sets it once via `requestInit`). Guard-first ordering is preserved exactly (debrief invariant).

**DD3 — Off-by-default opt-in via a new settings key `automationEnabled` (default `false`); bind-but-gate.**
- Choice: add `automationEnabled: false` to the settings-store schema. The server still binds under `--automation-dev`, but the auth gate **rejects all requests** (401) unless `automationEnabled` is true **and** a valid key is presented. Toggling is runtime (no restart). A dev path enables it for tests.
- Rationale: off-by-default + opt-in (SC8) layered on the existing dev gate; runtime toggle avoids a restart and models the operator consent the mission wants. Shipped builds have no `--automation-dev` → no server at all.
- Trade-off: the server process listens while disabled (but answers only 401) — acceptable; the operator-facing toggle UI is Flight 5.

**DD4 — Identity bound to the session at `onsessioninitialized`; per-request key re-validation.**
- Choice: when an `initialize` creates a session, the validated identity (jarId, or admin) is bound to that session entry. Subsequent requests still present the Bearer key; the gate re-validates it every request and confirms the resolved identity **matches** the session's bound identity (reject session-id reuse under a different key). The per-session `Server` (multi-session model) is built **scoped to that identity** — `buildServer(identity)`.
- **Re-validation reads settings LIVE (not a session-bound snapshot)** — `validateKey` re-reads `automationKeyHashes`/`automationEnabled` from the settings store each request. This is what makes a **Flight-5 revoke kill a live session** (and a toggle-off cut all sessions): if the check read a snapshot taken at session creation, revoke-kills-live-session would be silently unreachable. This is an explicit acceptance property (design-review state-reachability catch).
- Rationale: binds the jar/admin scope to the session (debrief guidance — bind at creation, not per-call), while live re-validation keeps revoke/toggle-off effective and prevents session-token confusion.
- Trade-off: a small per-request hash+compare + settings read; negligible for one local consumer.

**DD5 — Per-jar key storage: SHA-256 hashes keyed by jarId, via the settings-store codec seam (revisits a mission sub-detail — operator-confirm).**
- Choice: a new settings key `automationKeyHashes: { [jarId]: <sha256-hex> }`, persisted through the settings-store `{serialize, deserialize}` codec seam. Validation hashes the presented key and constant-time-compares. The plaintext jar key is generated with a CSPRNG, **shown once** at generation (Flight 5 UI / the dev mint path), and never stored.
- Rationale: hashes are not secrets — nothing to decrypt, nothing to leak at rest; covers the whole generate/rotate/revoke lifecycle (rotate = new hash + show-once; revoke = delete) without ever needing the plaintext back. Arguably stronger than an encrypted-retrievable key for a validation-only credential.
- **Settings-store integration specifics (design review):** `automationKeyHashes` is **object-typed**, so it MUST get an **explicit validator** (the store's `typeof`-fallback wrongly accepts `null`/arrays — `settings-store.js`). The validator must: reject `null`/arrays; accept an object whose every value is a **64-char lowercase hex** string (SHA-256) — do NOT ride the lenient `toolbarPins` "every value is boolean" pattern by analogy. Adding `automationEnabled` (boolean) + `automationKeyHashes` (object) is **additive** — `load()`'s merge-with-repair iterates `Object.keys(DEFAULTS)`, so new keys are picked up once added to DEFAULTS with **no migration** needed; confirm whether the schema `version` bumps per project convention (likely unchanged — additive).
- Trade-off: **revisits the mission's "encrypted `safeStorage` codec seam, not plaintext" sub-detail** — hashing sidesteps `safeStorage` for jar keys entirely (the stored hashes are safe in plaintext). Recorded for operator sign-off; reversible to a safeStorage-encrypted retrievable key if retrievability is wanted.

**DD6 — Env-gated admin tier: the env var ENABLES the tier; the admin key is a separately-managed hashed key (operator-chosen).**
- Choice: the env var **`GOLDFINCH_AUTOMATION_ADMIN`** is a **presence gate** (set = the admin tier exists; unset = it does not exist and nothing about it surfaces). The **admin key itself is a separate, managed, hashed credential** — a CSPRNG key whose SHA-256 hash is stored in a **dedicated** settings key `automationAdminKeyHash` (distinct from the per-jar `automationKeyHashes` map). A request is an **admin session** iff the env gate is set **and** the presented Bearer key hashes to `automationAdminKeyHash`. The admin session bypasses jar-scoping (sees all tabs + the chrome renderer) and is the **sole authorized relaxation** of the internal-session exclusion (drives `goldfinch://settings` chrome, whole-window capture). Never issued to external consumers (policy). In Flight 4 the admin key is minted via the dev path (when the env gate is set); **Flight 5 manages it** (generate/rotate/revoke from the env-gated control — matching the mission's "admin key from its env-gated control").
- Rationale: matches the mission's intent (env var as the visibility/enable gate; the admin key managed via an env-gated control in Flight 5) and lets the admin key rotate without changing the env var / relaunching. Same hash-and-show-once treatment as jar keys (DD5) — the admin key hash is non-secret at rest.
- **Gate + empty edge (design review):** `validateKey` must treat the admin tier as **absent** whenever the env gate is unset **OR** `automationAdminKeyHash` is empty/missing — it must never match in those cases (no empty-Bearer accept, no admin match when the gate is off even if a hash lingers). Explicit `automation-auth.js` unit cases. Admin match uses constant-time hash compare.
- Trade-off: a dedicated `automationAdminKeyHash` settings key + the admin-key lifecycle (minted in Flight 4 dev path, managed in Flight 5). The env gate and the stored hash are **both** required — defense in depth (losing the env var disables admin even if the hash persists).

**DD7 — Jar-scoping enforcement (the SC8 security core) — scope by SESSION OBJECT IDENTITY, never partition-string matching, never the renderer-reported jarId.**
- Choice: a jar session carries its bound jar. `buildServer(identity)` wires a **jar-scoped façade** over the engine (one wrapper, not logic sprinkled across 16 tool `call`s — keeps `mcp-tools.js` security-logic-free). `enumerateTabs` returns only tabs whose resolved `webContents` belong to the jar's session; drive/observe ops resolve the wcId **and** verify membership — a wcId outside the jar → **refused** (`isError`, `out-of-jar`). The internal-session exclusion in `resolveContents` stays **absolute** for jar keys. The **admin** identity bypasses jar-scoping and is the sole internal-session relaxation.
- **Membership mechanism (made precise per design review — this is the linchpin of SC8):**
  - The check is **session object identity**: `wc.session === session.fromPartition(jar.partition)`. Electron interns sessions by partition, so a guest webview created with `partition = jar.partition` (`renderer.js`) shares the *same* `Session` object main resolves via `session.fromPartition` — the same object-identity discipline `resolve.js` already uses for `__goldfinchInternal`. This is **not** partition-string matching (mission carried-in rule) and **not** trusting the renderer.
  - **The Session→jar resolver is NET-NEW work** (the spec previously implied it existed — it does not). Build it **lazily**: for a resolved `wc`, find the jar via `jars.list().find(j => session.fromPartition(j.partition) === wc.session)`. Lazy object-identity compare (cheap — `fromPartition` returns the interned session) avoids stale state when jars are added at runtime (`jars-add`). Place it in `resolve.js` beside `resolveContents` (e.g. `resolveContentsForJar(wcId, jarId, deps)` → live wc or throw `out-of-jar`/the existing bad/dead/internal throws), keeping the engine's authoritative guards co-located, pure, and unit-testable.
  - **Scoping authority is the resolved session, NEVER the renderer-reported `jarId`.** `enumerateTabs` today passes the renderer's `t.jarId` straight through (`tabs.js`); the jar **filter** must key on the resolved session via the resolver, so a tab whose renderer-reported jarId is wrong/spoofed is still scoped by its true session. (Same principle as DD5/resolve: enforce at resolve-time on trusted main state, don't filter on an untrusted label.)
  - **Burner jars are OUT of automation scope.** Burner jars (`burner:N`) are renderer-only and never persisted to `jars.list()`, so a burner tab's session matches no known jar and a jar key can have no hash keyed to a burner — burner tabs are **not enumerable or drivable by any jar key** (confinement holds by construction). The `mcp-jar-scoping` spec asserts this.
- Rationale: a jar key is structurally confined to its jar's session, so an external consumer is its own isolated browser identity and cannot reach the chrome, settings, other jars, or burners. The entire SC8 claim rests on the scoping authority being the resolved session.
- Trade-off: the Session→jar resolver + the jar-membership guard are net-new (in `resolve.js`); the per-session `Server` factory takes the identity and applies the façade. Contained — the multi-session model already gives each session its own `Server`.

**DD8 — Audit data layer only (no UI this flight); broadcast for Flight 5.**
- Choice: an in-process action log records each tool invocation `{ ts, sessionId, identity (jarId|admin), op, targetWcId, outcome }`, plus queryable **session-active** state (which identities are attached). Changes fan out via the M02 `broadcastToChromeAndInternal` channel so Flight 5's indicator + viewer can render them. No visible chrome UI in this flight. (Persistence of the log is optional/bounded — default in-memory ring; confirm at `audit-data`.)
- Rationale: delivers SC10's *data* half now (the surface is auditable in principle and the state exists), letting Flight 5 build the visible indicator + log viewer on a stable data contract.
- Trade-off: SC10 is **not met** until Flight 5 renders the indicator; this flight only advances it.

**DD9 — Request-body size cap (carried from the Flight-3 debrief).**
- Choice: cap `readJsonBody` (default 1 MiB; constant) → respond `413` and do not buffer beyond the cap.
- Rationale: the multi-session router buffers the initialize body unbounded today (debrief technical-debt item #2); fix it as we are in the transport adding the auth gate.
- Trade-off: a fixed cap; generous for an MCP initialize.

**DD10 — Behavior tests are the SC8 acceptance; author + run this flight.**
- Choice: author `mcp-auth-gating` (off-by-default rejects; toggle-on + valid jar key accepted; missing/wrong key → 401; admin key inert unless env set) and `mcp-jar-scoping` (a jar key enumerates only its jar's tabs and is refused on other jars' tabs + the internal session; an env-set admin key sees all + the chrome). Both **run** in `verify-integration`. Reuse the Flight-3 headless multi-session regression discipline (the debrief's standing recommendation) for the auth gate's unit/integration layer.
- Rationale: SC8 is a real-environment security property across the transport + engine — the Witnessed apparatus is the right gate, and it is what caught the Flight-3 lifecycle defect.

### Prerequisites
- [x] **Flight 3 landed** — the multi-session transport (`mcp-server.js`), the 16-tool registry (`mcp-tools.js`), the SC7 origin guard (`origin-guard.js`), and the `--automation-dev` gate exist and are behavior-test-backed. (Completed 2026-06-14; PR #40 open.)
- [ ] **Branch off `flight/03-mcp-transport`** (PR #40 not merged) — verify the stack base at flight start.
- [ ] **SDK client auth-header premise** — confirm `StreamableHTTPClientTransport` (1.29.0) can set `Authorization: Bearer` (via `requestInit.headers` / auth provider) so the behavior-test client can present a key. (DD2 premise — verify before locking the client side.)
- [ ] **Settings-store + jars substrate present** — `settings-store.js` (codec seam, DEFAULTS/VALIDATORS/NORMALIZERS) and `jars.js` (id/partition model) are landed (Mission 02). New keys (`automationEnabled`, `automationKeyHashes`) extend the existing schema.
- [ ] **Env-conflict check** — port `7777` (or `GOLDFINCH_MCP_PORT`) unchanged from Flight 3; no new ports. Confirm `GOLDFINCH_AUTOMATION_ADMIN` is not already used.
- [ ] **No new session category** — the auth tier adds identity *to existing sessions*; it introduces no new `webContents` session partition, so the mission's session-type-registry prerequisite still does not apply (as in Flight 3).
- [ ] **Net-new `Session→jar` resolver** — there is **no** Session→jarId map in main today (jarId reaches automation only via the untrusted renderer hook). DD7's resolver is new work inside `jar-scoping-and-admin`, not an existing facility — scoped accordingly (design-review catch).

### Pre-Flight Checklist
- [x] Open questions resolved (toggle semantics, per-request re-validation, jar-membership mechanism); the DD2 SDK-auth-header premise verified by design review (`StreamableHTTPClientTransport` `requestInit.headers` merges last — confirmed against SDK 1.29.0)
- [x] DD5 (hash + show-once) and DD6 (env-gate + separately-managed admin key) operator-signed-off (2026-06-14)
- [x] Design decisions documented
- [ ] Prerequisites verified (branch base; SDK auth header; settings/jars substrate)
- [ ] Validation approach defined (unit + headless integration over the gate/scoping; the two behavior tests; guided HAT)
- [ ] Legs defined

---

## In-Flight

### Technical Approach

The auth/identity layer wraps the Flight-3 transport without disturbing its guard-first ordering or multi-session model:

1. **`key-model-and-gate`** — add `automationEnabled` (bool, default false), `automationKeyHashes` (object — explicit hex-map validator), and `automationAdminKeyHash` (string hex or empty — admin credential, DD6) to `settings-store.js` (DEFAULTS/VALIDATORS/NORMALIZERS; additive, no migration); a new pure `automation-auth.js`: `hashKey`, `validateKey(presentedKey, { keyHashes, adminKeyHash, adminEnabled }) → jarId | 'admin' | null` (constant-time compare; admin matches only when `adminEnabled` AND the hash matches a non-empty `adminKeyHash`; empty/gate-off never matches). Wire the auth gate into `mcp-server.js` `onRequest` **after** `isAllowed`: disabled surface or no/invalid key → 401. Add the `readJsonBody` size cap (DD9). Add an **`isMcpAutomationEnabled`-gated** dev mint/enable path (mint CSPRNG jar key → `settings.set` the hash → flip the toggle; mint the admin key too when the `GOLDFINCH_AUTOMATION_ADMIN` gate is set) so tests + dogfooding can turn the surface on — narrow predicate, not `isAutomationDevEnabled`.
2. **`jar-scoping-and-admin`** (merged) — bind identity at `onsessioninitialized`; `buildServer(identity)` applies a jar-scoped **façade** over the engine; the **net-new `Session→jar` resolver in `resolve.js`** (`resolveContentsForJar(wcId, jarId, deps)`, lazy `session.fromPartition` object-identity compare, no stale state on runtime jar-add); `enumerateTabs` filtered by the **resolved session** (never the renderer's `t.jarId`); drive/observe refuse out-of-jar (`isError out-of-jar`); burner tabs match no jar (unautomatable); per-request **live** re-validation + session-identity match (DD4); internal-session exclusion absolute for jar keys; the **admin** identity (env value = key) bypasses jar-scoping + is the sole internal-session relaxation.
3. **`audit-data`** — the action log + session-active state + `broadcastToChromeAndInternal` fan-out; no UI.
4. **`behavior-test-specs`** — `mcp-auth-gating` + `mcp-jar-scoping` (run this flight).
5. **`verify-integration`** — live: run both specs; full unit + typecheck + lint; the headless multi-session + auth/scoping integration tests green.
6. **`hat-and-alignment`** *(optional)* — guided HAT: operator drives a keyed client (confined jar), confirms the admin tier (env-set) reaches the chrome.

The SDK stays confined to `mcp-server.js`; `automation-auth.js` is pure (hash + compare + identity resolution), Electron-free, unit-testable. The **`Session→jar` resolver + the jar-membership guard live in `resolve.js` beside `resolveContents`** — the engine's two authoritative guards, co-located, pure, and testable; `mcp-tools.js` stays security-logic-free (the scoping is a single façade in `buildServer(identity)`, not sprinkled across the 16 tool `call`s). Internal-session exclusion stays absolute for jar keys; admin is the sole relaxation.

### Checkpoints
- [ ] `automationEnabled` + `automationKeyHashes` (explicit hex-map validator) + `automationAdminKeyHash` in the settings schema; `automation-auth.js` pure validator unit-tested (jarId/admin/null, admin env-gate + empty edges, constant-time); the `onRequest` auth gate (401 on disabled/missing/invalid, after the 403 origin guard); body-size cap; `isMcpAutomationEnabled`-gated dev mint/enable path.
- [ ] Identity bound at session creation; `buildServer(identity)` jar-scoped façade; the net-new `resolveContentsForJar` (session-object-identity, lazy); `enumerateTabs` filtered by **resolved session** (not renderer jarId); drive/observe out-of-jar refused; burner tabs unautomatable; per-request **live** re-validation + session-identity match (revoke/toggle-off kills live sessions); internal-session exclusion absolute for jar keys; env-gated admin tier (value = key; inert unless set) bypasses jar-scoping + is the sole internal-session relaxation.
- [ ] Audit action-log data + session-active state + broadcast (no UI).
- [ ] `mcp-auth-gating` + `mcp-jar-scoping` specs authored.
- [ ] Live: both behavior tests pass; non-loopback + bad-key + cross-jar + internal-session all refused; full unit suite + typecheck + lint green.
- [ ] Guided HAT.

### Adaptation Criteria

**Divert if**:
- The SDK client cannot set an `Authorization` header (DD2 premise fails) → fall back to a custom request header the guard reads, or an SDK auth provider; re-confirm the behavior-test client path.
- Jar-membership cannot be determined from the resolved `wc` without partition-string matching → escalate (the mission forbids partition-string matching; need a main-process session map).

**Acceptable variations**:
- Toggle semantics (bind-but-gate vs don't-bind-until-enabled).
- Audit-log persistence (in-memory ring vs persisted) and its exact record shape.
- 401 vs 403 for the disabled-surface case (distinct from the origin guard's 403 either way).
- Merging `admin-tier` into `jar-scoping` if the identity plumbing makes them one cohesive change.

### Legs

> **Note:** Tentative; created one at a time as the flight progresses. May merge/split. No operator-facing UI legs — that surface is Flight 5.

- [x] `key-model-and-gate` — settings keys (`automationEnabled`; `automationKeyHashes` with the explicit hex-map validator; `automationAdminKeyHash`); pure `automation-auth.js` (hash / live-validate / resolve-identity → jarId|admin|null, with the admin env-gate + empty edges); the `onRequest` Bearer auth gate (after the origin guard; 401 on disabled/missing/invalid); request-body size cap (DD9); the **`isMcpAutomationEnabled`-gated** dev enable+mint path (mint CSPRNG jar key → store hash → flip toggle, via `settings.set`; mint the admin key when the env gate is set) — gated on the narrow predicate, NOT `isAutomationDevEnabled`, to avoid re-coupling to `--remote-debugging-port`. (SC7 key half, SC8 partial; DD2–DD6, DD9)
- [x] `jar-scoping-and-admin` *(merged per design review — one cohesive identity+scoping change)* — bind identity at `onsessioninitialized`; `buildServer(identity)` jar-scoped façade; the **net-new `Session→jar` resolver in `resolve.js`** (`resolveContentsForJar`, lazy object-identity compare); `enumerateTabs` filtered by **resolved session** (not renderer jarId); out-of-jar drive/observe refused (`isError out-of-jar`); burner tabs unautomatable; per-request live re-validation + session-identity match; internal-session exclusion absolute for jar keys; the **admin** identity (env value = key) bypasses jar-scoping + is the sole internal-session relaxation (chrome/settings/whole-window). (SC8 core; DD4, DD6, DD7)
- [x] `audit-data` — action-log data layer + session-active state + `broadcastToChromeAndInternal` fan-out; no UI. (SC10 data half; DD8)
- [x] `behavior-test-specs` — author `mcp-auth-gating` (SC8) + `mcp-jar-scoping` (SC8; asserts cross-jar + internal + burner refusals, scoping-authority-is-the-session, admin-sees-all-when-env-set) — run this flight. (DD10)
- [x] `verify-integration` — live: run both specs; bad-key/cross-jar/internal/burner/non-loopback refusals + revoke-kills-live-session confirmed; full gates green. (live / FD-guided)
- [ ] `hat-and-alignment` *(optional — included)* — guided HAT with a keyed client (confined jar) + the env-set admin tier (reaches the chrome).

---

## Post-Flight

### Completion Checklist
- [ ] All legs completed
- [ ] Code merged (PR stacked on #40 / `flight/03-mcp-transport`)
- [ ] Tests passing (unit + headless auth/scoping integration + typecheck + lint)
- [ ] Documentation updated (`docs/mcp-automation.md` auth section — how to present a key, the jar-scoping + admin-tier model, the `GOLDFINCH_AUTOMATION_ADMIN` env gate; CLAUDE.md note)
- [ ] Flight debrief written (separate `/flight-debrief` step)

### Verification
- **Unit**: `automation-auth.js` pure validator (hash, constant-time compare, identity resolution — jar/admin/null; disabled-surface); settings-store new-key validators; the body-size cap.
- **Headless integration**: extend the multi-session test pattern — a keyed client connects (valid jar key → identity bound); a wrong/missing key is 401'd; the surface is 401 while `automationEnabled` is false; a jar session enumerates only its jar (filtered by **resolved session**, asserted even when a tab's renderer-reported jarId is mismatched); an out-of-jar wcId is refused (`out-of-jar`); a burner tab is unautomatable; **revoking a key (or toggling off) mid-session kills the live session** (live re-validation); the admin key (env-set in the test) sees all + the chrome.
- **Behavior tests**: `/behavior-test mcp-auth-gating` (SC8) and `/behavior-test mcp-jar-scoping` (SC8) pass live.
- **Static**: `npm run typecheck` and `npm run lint` clean.
- SC8 is met + behavior-test-backed here; SC7's key half lands here (structural half was Flight 3); SC10's data layer lands here, its visible indicator + viewer complete at Flight 5.
