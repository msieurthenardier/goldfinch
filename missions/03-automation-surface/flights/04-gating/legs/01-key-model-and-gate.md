# Leg: key-model-and-gate

**Status**: completed
**Flight**: [Gating — opt-in + key auth + audit](../flight.md)

## Objective
Add the auth substrate — three settings keys, a pure `automation-auth.js` validator, the `onRequest` Bearer auth gate (after the origin guard), the request-body size cap, and an `--automation-dev`-gated dev enable+mint path — so the MCP surface is off-by-default and rejects any request that lacks a valid key.

## Context
- **DD2** — key presentation is `Authorization: Bearer <key>`, validated in `onRequest` *after* the SC7 origin guard (`isAllowed`, runs first, 403). The auth gate is the **second** pre-routing gate; missing/invalid key or disabled surface → **401** (distinct from the guard's 403). The security decision stays out of `routeRequest`.
- **DD3** — bind-but-gate: the server still binds under `--automation-dev`, but the auth gate rejects all requests with **401** unless `automationEnabled` is `true` **and** a valid key is presented. Runtime toggle, no restart.
- **DD5** — per-jar keys stored as **SHA-256 hashes** keyed by jarId (`automationKeyHashes`), through the settings-store codec seam. Validation hashes the presented key and **constant-time-compares**. Plaintext key is generated with a CSPRNG, shown once at mint, never persisted.
- **DD6** — admin tier: env var `GOLDFINCH_AUTOMATION_ADMIN` is a **presence gate**; the admin key is a separate hashed credential in a dedicated settings key `automationAdminKeyHash`. A request is admin iff the gate is set **and** the presented key hashes to a **non-empty** `automationAdminKeyHash`. Empty/missing hash or unset gate → never matches (no empty-Bearer accept).
- **DD9** — cap `readJsonBody` (default 1 MiB) → `413`, do not buffer beyond the cap (Flight-3 debrief tech-debt #2: the initialize body is buffered unbounded today).
- **Scope split (DD1/DD7):** this leg makes the gate *functional* — accept valid keys, reject everything else. It resolves the identity (`jarId | 'admin' | null`) but does **NOT** yet bind identity to the session or apply jar-scoping/`buildServer(identity)` — that is leg `jar-scoping-and-admin`. No operator-facing UI (Flight 5).

### Codebase ground truth (verified 2026-06-14)
- `src/main/settings-store.js` — `DEFAULTS` (line ~27) `{ version:1, homePage, toolbarPins }`; `VALIDATORS` `(v)=>boolean`; `NORMALIZERS` `(v)=>v` applied after validation; codec seam `{serialize,deserialize}` defaults to JSON (plaintext today); `load()` merges-with-repair over `Object.keys(DEFAULTS)` (no migration for additive keys); `set(key,value)` validates-then-persists (atomic temp+rename), throws `TypeError` on unknown/invalid. `toolbarPins` is the object-typed validator pattern to follow (rejects null/arrays).
- `src/main/automation/mcp-server.js` — `onRequest` (line ~182) calls `isAllowed(...)` first → 403 on deny, then `routeRequest`. `readJsonBody` (line ~141) buffers all chunks with **no size limit**. Session creation at `onsessioninitialized` (line ~242); `buildServer()` (line ~117) wires the 16-tool registry.
- `src/main/automation/origin-guard.js` — `isAllowed({host,origin,peerAddress}) => boolean` (true allow / false → 403).
- `src/shared/automation-dev.js` — `isMcpAutomationEnabled(argv)` = `argv.includes('--automation-dev')` (exact). `isAutomationDevEnabled(argv)` is the broader legacy predicate (matches `--remote-debugging-port`) — do **NOT** use it here.
- `test/unit/*.test.js` — `node:test` + `node:assert/strict`. `npm test` = `node --test test/unit/*.test.js`; `npm run typecheck` = `tsc --noEmit -p jsconfig.json`; `npm run lint` = `eslint .`. Patterns: `settings-store.test.js`, `automation-mcp-server.test.js` (real SDK client + fake engine).

## Inputs
- Flight 3 transport landed: `mcp-server.js`, `mcp-tools.js`, `origin-guard.js`, `--automation-dev` gate.
- `settings-store.js` and `jars.js` present (Mission 02).
- Branch `flight/04-gating` off `flight/03-mcp-transport`.

## Outputs
- `src/main/settings-store.js` — three new keys in `DEFAULTS` + `VALIDATORS` (and any `NORMALIZERS` needed).
- `src/main/automation/automation-auth.js` — new pure module (`hashKey`, `validateKey`, `generateKey`, constant-time compare).
- `src/main/automation/mcp-server.js` — auth gate wired into `onRequest`; `readJsonBody` size cap.
- A dev enable+mint path gated on `isMcpAutomationEnabled(process.argv)` (function + dev-only trigger).
- Unit tests for the validator, the new settings validators, the auth gate (401 paths), and the body cap.
- `docs/mcp-automation.md` auth section started (key presentation, env gate) — may be completed in later legs.

## Acceptance Criteria
- [x] **Settings schema** — `settings-store.js` `DEFAULTS` gains: `automationEnabled: false` (boolean), `automationKeyHashes: {}` (object), `automationAdminKeyHash: ''` (string). Each has an **explicit** validator:
  - `automationEnabled`: strictly boolean.
  - `automationKeyHashes`: object that is **not** `null` and **not** an array, every value a **64-char lowercase hex** string; rejects null/array/non-hex values. (Does NOT ride the lenient `toolbarPins` boolean pattern.)
  - `automationAdminKeyHash`: a string that is either `''` **or** a 64-char lowercase hex string.
  - Adding the keys is additive — `load()` picks them up via the `Object.keys(DEFAULTS)` merge with no migration. Schema `version` unchanged unless project convention dictates otherwise (note the decision).
- [x] **`automation-auth.js` (pure, Electron-free)** exports:
  - `hashKey(plaintext) => <64-char lowercase hex>` (SHA-256 via `node:crypto`).
  - `generateKey() => <plaintext>` — CSPRNG (`crypto.randomBytes`), URL-safe, ≥ 32 bytes of entropy.
  - `validateKey(presentedKey, { keyHashes, adminKeyHash, adminEnabled }) => jarId | 'admin' | null`:
    - Returns `'admin'` **iff** `adminEnabled === true` AND `adminKeyHash` is a non-empty hex string AND `hashKey(presentedKey)` constant-time-equals `adminKeyHash`.
    - Else returns the matching `jarId` if `hashKey(presentedKey)` equals one of `keyHashes`' values (constant-time compare).
    - Returns `null` for empty/missing `presentedKey`, no match, admin-disabled-or-empty-hash, or malformed inputs. **Never throws.**
  - Constant-time comparison used for all hash compares (`crypto.timingSafeEqual` on equal-length buffers; length-mismatch → no match without early-out leak).
- [x] **Settings reader injected into the server (design-review high).** `createMcpServer(opts)` today accepts only `{ getEngine, version, port }` — it has **no** access to the settings store. Add an optional `getSettings` (or `settingsReader`) dep, defaulting to a lazy `() => require('../settings-store')` (the module is a singleton exposing `get`/`getAll`). The auth gate calls it **per request** so reads are live, and the headless test stubs it to toggle `automationEnabled`/hashes. A bare per-request `require('../settings-store')` is also live but **not stubbable** in the headless test — the injected reader is required, not optional.
- [x] **Auth gate in `onRequest`** — after `isAllowed` (origin guard, unchanged, still first → 403), a new gate:
  - Reads `Authorization: Bearer <key>` (case-insensitive scheme; tolerant of extra whitespace).
  - Reads `automationEnabled`, `automationKeyHashes`, `automationAdminKeyHash` **live** via the injected settings reader, and the admin env gate from `process.env.GOLDFINCH_AUTOMATION_ADMIN`.
  - If `automationEnabled` is false, or the header is missing/malformed, or `validateKey(...) === null` → respond **401** and do not reach `routeRequest`.
  - **401 response shape:** bare `res.writeHead(401); res.end()` — deliberately mirrors the origin guard's bare 403 (a pre-routing security decision, kept out of the JSON-RPC envelope used by `sendJsonRpcError`). Record this as the chosen shape.
  - On a valid key → proceed to `routeRequest` exactly as today (identity *binding* is leg 2; this leg only allows/denies).
  - The 403 origin guard still runs first and is unchanged (guard-first invariant preserved).
- [x] **Body-size cap (DD9)** — `readJsonBody` caps accumulation at a 1 MiB constant; when exceeded, respond **413**, `req.destroy()` to stop buffering (do not read to end), and signal over-cap **distinctly** from the empty/unparseable case. Today `readJsonBody` resolves `undefined` for both empty and parse-failure, and its sole caller (`routeRequest`) maps a missing/non-initialize body to **400** — the cap must NOT collapse into that 400. Either pass `res` into `readJsonBody` (write the 413 itself, resolve a sentinel so the caller returns early) or resolve a discriminated result (`{ tooLarge: true }`). Normal initialize bodies (well under 1 MiB) are unaffected and still resolve as today.
- [x] **Dev enable+mint path** — a function (e.g. `enableAndMintJarKey(jarId)` / `mintAdminKey()`), gated on `isMcpAutomationEnabled(process.argv)` (NOT `isAutomationDevEnabled`), that: generates a CSPRNG key, stores its hash via `settings.set('automationKeyHashes', ...)`, flips `automationEnabled` true, and returns the plaintext **once**; mints the admin key into `automationAdminKeyHash` only when `GOLDFINCH_AUTOMATION_ADMIN` is set. Exposed so a headless/behavior-test harness can turn the surface on and obtain a key (wire via the existing dev-IPC/startup affordance used for `--automation-dev`). Inert when the gate predicate is false.
- [x] **Tests green** — new unit tests cover: validator (jarId/admin/null, admin env-gate-off + empty-hash edges, empty-Bearer, constant-time path), the three settings validators (accept/reject incl. null/array/non-hex), the auth gate (401 when disabled, 401 missing/bad key, pass-through on valid key — extend `automation-mcp-server.test.js` pattern), and the 413 body cap. `npm test`, `npm run typecheck`, `npm run lint` all clean.

## Verification Steps
- `npm test` — all unit tests pass, including the new auth/validator/cap cases.
- `npm run typecheck` && `npm run lint` — clean.
- Manual reasoning check: with `automationEnabled=false`, an otherwise-valid keyed request is 401'd; flipping it true makes the same key pass. Admin Bearer is 401 when `GOLDFINCH_AUTOMATION_ADMIN` is unset even if a hash is present.
- Inspect: origin guard (403) still evaluated before the auth gate (401) — order preserved.

## Implementation Guidance

1. **Settings schema (`settings-store.js`)**
   - Add the three keys to `DEFAULTS`.
   - Add explicit validators. For `automationKeyHashes`: reject `null` and `Array.isArray`; require a plain object whose every value matches `/^[0-9a-f]{64}$/`. For `automationAdminKeyHash`: `v === '' || /^[0-9a-f]{64}$/.test(v)`. For `automationEnabled`: `typeof v === 'boolean'`.
   - **Deep-copy hazard (two spots):** `freshDefaults()` (line ~40) currently deep-copies only `toolbarPins`; it MUST also spread `automationKeyHashes` (`automationKeyHashes: { ...DEFAULTS.automationKeyHashes }`) or every load shares the one DEFAULTS object. `getAll()` (line ~196) likewise only deep-copies `toolbarPins` — extend it to deep-copy `automationKeyHashes` too, so callers don't get a live ref to the stored map.
   - **Do NOT bump `version`.** `load()` merges over `Object.keys(DEFAULTS)` with no version-gated migration anywhere in the file — additive keys need no bump and there is no migration machinery a bump would trigger. Record the no-bump decision in the flight log.

2. **`automation-auth.js` (new, pure)**
   - `node:crypto`: `createHash('sha256').update(plaintext,'utf8').digest('hex')` for `hashKey`; `randomBytes(32).toString('base64url')` (or hex) for `generateKey`.
   - Constant-time compare: convert both hex strings to Buffers; if lengths differ return false; else `timingSafeEqual`. Wrap in a helper `hashEquals(aHex,bHex)`.
   - `validateKey`: guard inputs (string presentedKey, object keyHashes). Compute the presented hash once. Check admin first (gated), then iterate jar hashes. Return identity or null. No throws.
   - Keep it Electron-free so it unit-tests in isolation.

3. **Auth gate (`mcp-server.js` `onRequest`)**
   - Insert after the `isAllowed` block, before `routeRequest`.
   - Parse the `authorization` header (lowercase header key); split on whitespace; require scheme `bearer` (case-insensitive) + a token.
   - Read settings live via the **injected `getSettings` dep** (default `() => require('../settings-store')`; the singleton exposes `get`/`getAll`). The server has no settings access today — adding the dep to `createMcpServer` opts is part of this leg. Stubbable for the headless test.
   - `adminEnabled = !!process.env.GOLDFINCH_AUTOMATION_ADMIN` (presence, non-empty).
   - On reject: `res.writeHead(401); res.end();` — bare, mirrors the 403 guard (decision recorded in the criteria).
   - Do not change the origin-guard block.

4. **Body cap (`readJsonBody`)**
   - Track accumulated byte length on `'data'`; on exceeding `MAX_BODY_BYTES` (1 MiB constant), `req.destroy()` and stop. `readJsonBody`'s sole caller is `routeRequest` (`const body = await readJsonBody(req)`), which maps a missing/non-initialize body to **400** — the over-cap case must be distinct from that. Either pass `res` into `readJsonBody` so it writes the 413 and resolves a sentinel (caller returns early), or resolve a discriminated `{ tooLarge: true }`. Preserve existing return semantics (`undefined` on empty/parse-fail → existing 400) for the under-cap path.

5. **Dev enable+mint path**
   - Add a function gated on `isMcpAutomationEnabled(process.argv)`. Wire its trigger in `main.js` in the same block that starts the MCP server (`main.js` ~line 762, inside `app.whenReady`, where `isMcpAutomationEnabled(process.argv)` already gates `createMcpServer`/`start` and `process.argv` is available). Reuse the existing dev-IPC pattern (`automation:dev-invoke`, identity-checked to `mainWindow.webContents`, ~lines 741–753) — register a parallel `automation:dev-enable-mint` handler under the **same `isMcpAutomationEnabled` gate** (NOT `isAutomationDevEnabled`). It must be unreachable when the predicate is false.
   - **Returns the plaintext key once via the IPC return value** (the primary, harness-usable channel — console-only would force log-scraping by the leg-4 `mcp-auth-gating` behavior test); never persists plaintext.

6. **Tests**
   - New `test/unit/automation-auth.test.js` for the pure validator.
   - Extend `test/unit/settings-store.test.js` for the three validators.
   - Extend `test/unit/automation-mcp-server.test.js` (or a new auth test) for the 401 gate and 413 cap, using the real SDK client + fake engine pattern; stub the settings reader to toggle `automationEnabled`/hashes.

7. **Docs**
   - Start the auth section in `docs/mcp-automation.md` (Bearer presentation, env gate). Fuller coverage can land in later legs.

## Edge Cases
- **Empty Bearer / `Authorization: Bearer ` (no token)** → null → 401.
- **Admin gate set but `automationAdminKeyHash` empty** → admin never matches; falls through to jar check.
- **`automationKeyHashes` with a non-hex / null value** → rejected at settings-validation time (never stored), so `validateKey` only ever sees clean hex maps; still code `validateKey` defensively.
- **Key matching a jar hash while also admin-enabled** → admin is checked first only for the admin hash; a jar key never resolves to admin.
- **Body exactly at 1 MiB** vs over — define the boundary (cap is exclusive over 1 MiB → 413).
- **`automationEnabled` true but no keys minted** → every request 401 (no hash can match).
- **Hashes flow through `getAll()` to the renderer** (chrome `settings-get` IPC, internal bridge) once added to DEFAULTS. **Decision:** acceptable — hashes are non-secret at rest (DD5), so no filtering this leg; any UI-side filtering is Flight 5's concern. Note it so it's not a silent leak.
- **Broadcast fan-out** (`broadcastToChromeAndInternal('settings-changed', …)` on the new keys) is **out of scope for leg 1** — no UI consumes `automationEnabled` yet; the dev mint path may `settings.set` without broadcasting. Flight 5 wires the indicator/broadcast. Intentional.

## Files Affected
- `src/main/settings-store.js` — three new keys + validators.
- `src/main/automation/automation-auth.js` — new pure module.
- `src/main/automation/mcp-server.js` — auth gate in `onRequest`; `readJsonBody` cap.
- Dev enable+mint wiring (likely `src/main/main.js` or the automation startup module) — `isMcpAutomationEnabled`-gated.
- `test/unit/automation-auth.test.js` (new), `test/unit/settings-store.test.js`, `test/unit/automation-mcp-server.test.js`.
- `docs/mcp-automation.md` — auth section (started).

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

> **Orchestration note:** Under `/agentic-workflow`, the Developer implementing this leg does NOT commit and does NOT signal `[COMPLETE:leg]`. It implements to acceptance criteria, updates the flight log, sets status to `landed`, and signals `[HANDOFF:review-needed]`. Review + commit are batched at flight end.
