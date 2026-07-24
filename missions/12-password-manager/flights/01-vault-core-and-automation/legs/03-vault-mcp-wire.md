# Leg: vault-mcp-wire

**Status**: completed
**Flight**: [Vault Core + Automation Surface](../flight.md)

## Objective

Expose the vault over the fill-only MCP surface: a per-session vault context, the
`vaultUnlock` / `vaultList` / `vaultTotp` tools plus the `vaultFill` tool-def and its
jar-membership + origin-match enforcement (DOM effect deferred to Leg 4), cryptographic
scope by session identity, per-session zeroization on transport teardown + idle backstop,
and audit integration — all unit/fake-testable with no live browser.

## Context

- **Leg 3 of 4.** Depends on Legs 1–2 (landed). Leg 4 wires the real main→preload fill
  delegate, the fixture builder, and the end-to-end behavior test. This is the wire policy +
  scope surface (checkpoint c, part 1).
- **Integration seams (verified against current code):**
  - `mcp-tools.js:614 — buildToolRegistry(getEngine)`; `TOOLS` concat (`:596`); `callTool` (`:632`); `okResult` shaping.
  - `mcp-server.js:375 — buildServer(identity, sessionRef)`; the `CallToolRequestSchema`
    handler (`:384`) wraps `registry.callTool` with `auditLog.record({... detail: deriveAuditDetail(name,args)})` (`:398-405`). **The audit wrap is AROUND `registry.callTool` — anything that returns before it is NOT audited.**
  - `sessions.set(sid,{server,transport,identity})` (`:707`); `transport.onclose` (`:712`) is the single teardown chokepoint (`stop()` and GET-stream-close both cascade through it).
  - `deriveAuditDetail(op,args)` (`:79`) switch, `default→null` — only `wcId→targetWcId` and `detail` are recorded, so `args.accessKey` is structurally never logged (preserve this).
  - `scope.js` `scopeEngine` returns the **raw engine unchanged for admin** (`:88`), pinned by ~6 `assert.equal(scopeEngine(...,'admin',...), engine)` tests. `WCID_FIRST_OPS` generic loop calls `engine[op](wcId,...)` (`:136-142`). `resolveContentsForJar` (`resolve.js`) is the jar-membership primitive; `getHistory` is the jar-confined precedent.
  - `automation-scope.test.js` three-place guard derives every `wcId`-required tool from the registry and asserts membership in a known set.
  - `automation-mcp-tools.test.js:72-79` hard-asserts `tools.length === 30` + an exact 30-name `deepEqual` ("named 1:1 with engine ops"); `docs/mcp-automation.md:19,441` assert "30 tools".
  - `automation-auth.js:validateKey` → transport identity (jarId|'admin'|null). The vault access key is a **separate** secret presented as a tool arg.
- **`vault-store` (Leg 2, landed) findings (verified):** `unlockVaultWithAccessKey(vaultId, secret)` is **already stateless** (reads the doc, iterates non-`mrk` envelopes, returns a fresh Buffer; no singleton mutation) → use it directly for the jar path. `unlockWithAdmin` is **stateful** (`_installMrk` sets the singleton) → must NOT be reused for automation.

### DECISION — automation state is per-session, dispatched OUTSIDE scopeEngine

- **Vault ops never go through `scopeEngine`.** `scopeEngine` returns the raw engine for admin
  (reference-pinned), and vault ops aren't engine ops. They dispatch on a **separate per-session
  path** driven by a per-session vault context. `scope.js` gains a **registration-only** marker
  set `WCID_FIRST_CUSTOM_JAR_OPS = ['vaultFill']` that the three-place guard consults but the
  generic `engine[op]` wrapper does NOT feed. `vaultFill`'s jar-membership check lives in the
  vault dispatch (which `require('./resolve').resolveContentsForJar` directly), never as a
  `scopeEngine` method.
- **Threading = Option 1 only (audit-preserving).** Extend `buildToolRegistry(getEngine, getVaultCtx)`
  and pass the ctx as a 3rd arg: `def.call(engine, args, ctx)`. Existing defs ignore the 3rd arg;
  vault defs use it. The four tools stay in `TOOLS`, so the existing `auditLog.record` wrap around
  `registry.callTool` audits them automatically. **Do NOT special-case vault names in `buildServer`
  before `registry.callTool` — that path skips the audit wrap.**
- **A new electron-free `vault-context.js` module** owns the vault dispatch (unlock/list/totp/fill +
  membership + origin-match + per-session idle lock), with all Electron/host handles injected —
  keeping `mcp-server.js` thin and the logic unit-testable with fakes. `createMcpServer` gains
  injected deps: a `vaultStore` accessor (`unlockVaultWithAccessKey`, `openAllWithAdminKey`,
  `listItems`, `totp`, `listJars`) and a **fill delegate** (Leg 4 real, Leg 3 fake).

### Reachable-vault scope (DD4) — strict per-jar for automation in F1

- **jar transport identity** → reachable set is **that jar's vault only**. `vaultUnlock({accessKey})`
  interprets `accessKey` as the per-jar access secret → `unlockVaultWithAccessKey(jarId, secret)`.
  A per-jar access key has no envelope for global/siblings (structural, Leg 2). **A jar automation
  session cannot reach the global vault in F1** (global logins via automation require the admin key,
  or a future global-scoped access-key tier — noted as an open question; the human picker's
  jar+global view is a separate F2 concern).
- **admin transport identity** → reachable set is **every vault**. `accessKey` is interpreted as the
  **X25519 admin private key (base64)** → `openAllWithAdminKey(privB64)` opens the MRK then every
  vault key. (Handing the admin private key is the mission's intended admin-automation unlock — it
  is the operator-held root; the UI already recommends against embedding it in config.)
- A wrong/foreign key unlocks nothing → normal `okResult` (`unlocked: []`), not a throw.

## Inputs

- `src/main/vault/{vault-store.js, vault-crypto.js}` (landed).
- `src/main/automation/{mcp-server.js, mcp-tools.js, scope.js, resolve.js, automation-auth.js, audit-log.js}` (existing).

## Outputs

- **New** `src/main/vault/vault-context.js` — electron-free, injected-deps per-session vault
  dispatch (unlock/list/totp/fill resolution + membership + origin-match + idle lock + zeroize).
- **New** `test/unit/vault-context.test.js` — the dispatch/scope/zeroization suite (fakes + real `.gfvault` fixtures).
- **Modified** `mcp-tools.js` — `VAULT_TOOLS` (four defs) folded into `TOOLS`; `buildToolRegistry(getEngine, getVaultCtx)`; `def.call(engine, args, ctx)`; tool-count comment updated.
- **Modified** `mcp-server.js` — mint a per-session vault ctx in `routeRequest` (like `sessionRef`), close it over in `buildServer` via `getVaultCtx`, store it **by the same reference** in the `sessions` entry, zeroize it in `transport.onclose`; add injected `vaultStore` + fill delegate deps; `deriveAuditDetail` vault cases (origin/itemId, **no secret**).
- **Modified** `scope.js` — registration-only `WCID_FIRST_CUSTOM_JAR_OPS` marker (NOT fed to the generic wrapper).
- **Modified** `test/unit/automation-scope.test.js` — guard accepts the new marker category; still fails an unregistered wcId tool.
- **Modified** `test/unit/automation-mcp-tools.test.js` — segregate the four vault tools as **non-engine-op** tools; update the count/name assertions.
- **Modified** `docs/mcp-automation.md` — document the four vault tools + corrected tool count + the fill-only wire policy.
- **Modified** `vault-store.js` — additive stateless `openAllWithAdminKey(privB64)` (see guidance).

## Acceptance Criteria

- [ ] **Four tools registered**: `vaultUnlock`, `vaultList`, `vaultTotp`, `vaultFill` in the registry with input schemas (`vaultFill` requires `wcId`). The discovery test passes with the vault tools segregated as non-engine-op tools; the "30 tools" count/docs are corrected.
- [ ] **Per-session vault context**: `vaultUnlock` populates a ctx stored on the session entry (never the `vault-store` singleton); two concurrent sessions with different identities have independent contexts and Buffers (no shared references).
- [ ] **Cryptographic scope**: a jar session with its per-jar access key reaches only that jar's vault (cannot list/totp/fill global or a sibling — open fails, absent envelope). An admin session with the admin private key reaches every vault. Verified against real `.gfvault` fixtures built via the `vault-store` API in a temp dir.
- [ ] **`vaultList` metadata-only**, unlocked vaults only: origin, username, has-TOTP, vault id/badge — no password/TOTP-secret/card data.
- [ ] **`vaultTotp`** returns only the current code for a named unlocked TOTP item; no secret.
- [ ] **`vaultFill` wire behavior**: resolves an origin-matched login from an unlocked reachable vault for the target `wcId`; enforces jar membership (a jar session naming a foreign/sibling tab **throws** `automation: out-of-jar …` via `resolveContentsForJar`) and top-frame/origin-match; calls the **injected fill delegate** with the credential; **the tool result carries no password**. "No match" / "locked" are normal `okResult`s (DD6), not errors.
- [ ] **Scope-guard extended**: `automation-scope.test.js` passes with `vaultFill` present via the registration-only marker set — NOT via `WCID_FIRST_OPS` (generic `engine[op]`) or `WCID_FIRST_EXEMPT` (admin-only); a future unregistered wcId tool still fails the guard.
- [ ] **Audit**: `vaultUnlock`/`vaultFill`/`vaultTotp`/`vaultList` flow through the existing `auditLog.record` wrap (they stay in `TOOLS`); `deriveAuditDetail` emits origin/itemId for vault ops but **never** a password, TOTP secret, vault key, per-jar access secret, or admin private key (asserted for both accessKey secret types).
- [ ] **Session-scoped zeroization**: `transport.onclose` zeroizes (`.fill(0)`) + clears the session ctx (the same reference the tools used); a fresh session must `vaultUnlock` again before `vaultList` returns anything. **No singleton coupling either direction**: MCP unlock/teardown never changes `vault-store`'s human state, and `vault-store.lockNow()` never empties a live MCP session ctx (fresh-buffer copies).
- [ ] **Per-session idle auto-lock**: a per-session idle timer (duration from `vaultAutoLockMinutes`, reset on each vault op) zeroizes the ctx on fire — the DD5 belt-and-suspenders backstop for a client that holds no stream to signal an ungraceful drop.
- [ ] **`openAllWithAdminKey`** opens the MRK via `importAdminPrivateKey` + `openAdminSeal(manager.mrk.admin, priv)`, then unwraps each existing `.gfvault` (skipping lazily-absent jar vaults) with the `mrk` envelope AAD — returning **fresh** Buffers, using neither `_installMrk` nor `_vaultKeyFromDoc`, and zeroizing the local MRK after. No singleton mutation (unit-verified).
- [ ] `timeout 200 node --test test/unit/vault-context.test.js test/unit/automation-scope.test.js test/unit/automation-mcp-tools.test.js` passes; full `npm test` green; typecheck + lint clean.

## Verification Steps

- `timeout 240 npm test` — full suite green (existing automation suites incl. the discovery test still pass after the count restructure).
- `timeout 200 node --test test/unit/vault-context.test.js test/unit/automation-scope.test.js test/unit/automation-mcp-tools.test.js` — green.
- `npm run typecheck` && `npm run lint` — clean.
- Assert in tests: no secret material (password / TOTP secret / vault key / accessKey / admin priv) appears in any `vaultList`/`vaultTotp`/`vaultFill` result or any `auditLog` entry.
- `grep -n "require('electron')" src/main/vault/vault-context.js` — no matches.

## Implementation Guidance

1. **`vault-context.js`** — `createVaultContext(deps)` where `deps = { vaultStore, fillDelegate, getAutoLockMinutes, now?, setTimeout?, clearTimeout? }`; returns a per-session object `{ unlock, list, totp, fill, zeroize, touch }` holding `{ keys: Map<vaultId,Buffer>, unlockedIds: Set, lastActivity }`. `unlock(identity, accessKey)`: jar → `vaultStore.unlockVaultWithAccessKey(jarId, accessKey)` into `keys`; admin → `vaultStore.openAllWithAdminKey(accessKey)` merged into `keys`. `list`/`totp` read `keys`. `fill(identity, {wcId, itemId}, engineDeps)`: membership via `resolveContentsForJar` (throw out-of-jar), origin-match the resolved tab's origin against the item, then `fillDelegate({ wcId, credential })` — **credential never returned**. `touch()` resets the idle timer; on fire → `zeroize()`. `zeroize()` `.fill(0)`s every Buffer and clears the maps. Electron-free; unit-tested with fakes.

2. **`mcp-tools.js`** — add `VAULT_TOOLS` (four defs) to `TOOLS`. Change `buildToolRegistry(getEngine)` → `buildToolRegistry(getEngine, getVaultCtx)`; in `callTool`, call `def.call(engine, args, getVaultCtx?.())`. Vault defs use the 3rd arg; all existing defs ignore it (no signature break). Update the `:590-596` tool-count comment.

3. **`mcp-server.js`** — in `routeRequest`, mint `const vaultCtx = createVaultContext(...)` **before** the transport (like `sessionRef`); `buildServer` closes over it via `getVaultCtx = () => vaultCtx`; store it in the `sessions.set` entry **by the same reference**; in `transport.onclose`, `vaultCtx.zeroize()` before the existing eviction. Add `vaultStore` + `fillDelegate` to `createMcpServer` opts (Leg 4 injects the real fill delegate; Leg 3 tests inject a fake). Source the fill target's origin from the contents `resolveContentsForJar` resolves (via `scopeCtx.fromId`).

4. **`scope.js`** — add `const WCID_FIRST_CUSTOM_JAR_OPS = ['vaultFill'];` exported for the guard, with a comment that it is **registration-only** (enforcement lives in `vault-context.fill`, NOT here) and must never be added to `WCID_FIRST_OPS`. No `scopeEngine` method for `vaultFill`.

5. **`automation-scope.test.js`** — the guard's wcId-first membership check accepts `WCID_FIRST_OPS ∪ WCID_FIRST_EXEMPT ∪ WCID_FIRST_CUSTOM_JAR_OPS`; a wcId tool in none still fails.

6. **`automation-mcp-tools.test.js`** — split the assertion: the engine-op tools keep their 1:1 count/name check; the four vault tools are asserted as a separate expected set (non-engine-op). Update `docs/mcp-automation.md` (count + a vault-tools section + fill-only wire policy). **Also fix the stale "30 tools" *comment* sites** (not just the assertions): `mcp-server.js:358` and `automation-mcp-tools.test.js:1011` — comments, won't fail the suite, but keep them honest.

7. **`deriveAuditDetail`** — add vault cases returning **strings** (match the existing
   `string | null` convention — e.g. `'item=<id> origin=<origin>'` for `vaultFill`/`vaultTotp`,
   `'outcome=<ok|none> count=<n>'` for `vaultUnlock`, `'count=<n>'` for `vaultList`). Never include
   `accessKey`/secret (default-null already drops `accessKey`; keep it that way).

8. **`vault-store.js` additive `openAllWithAdminKey(privB64)`** — `importAdminPrivateKey(privB64)` → `openAdminSeal(manager.mrk.admin, priv)` → MRK; for `['global', ...listJars().map(j=>j.id)]`, read each `.gfvault` (skip ENOENT — lazily-absent jar vaults), `unwrapVaultKey(mrkEnvelope, mrk, mrkAad(doc.version))` into a fresh Buffer; zeroize the local MRK; return `Map<vaultId,Buffer>`. Uses neither `_installMrk` nor `_vaultKeyFromDoc`. Unit-test the no-singleton-mutation property.

9. **Tests** (`vault-context.test.js`) — fakes for engine/fill + real `.gfvault` fixtures via `vault-store`. Cover every acceptance criterion incl. two-session isolation, jar-can't-reach-global/sibling, admin-reaches-all, metadata-only, totp-code-only, fill-delegate-gets-credential + result-no-password, out-of-jar throw, audit-no-secret (both key types), onclose zeroize + re-unlock, no-singleton-coupling both directions, idle auto-lock fires.

## Edge Cases

- **Wrong/foreign accessKey** → `unlocked: []` normal result.
- **list/totp/fill before unlock** → empty ctx → "locked/nothing unlocked" normal result.
- **fill with no matching credential** → "no match" normal result; delegate not called.
- **jar session naming another jar's tab** → `out-of-jar` throw before credential resolution.
- **concurrent sessions, same vault** → independent fresh-buffer copies; one teardown never zeroizes the other's.
- **human `vault-store` locked while an MCP session holds keys** → MCP session keeps working (own copies).
- **admin session on a jar vault created after setup** → reachable (MRK opens it) — the seal-to-future property.
- **idle timer fires mid-session** → ctx zeroized; next op returns "locked" until re-unlock.

## Files Affected

- `src/main/vault/vault-context.js` — **new**.
- `test/unit/vault-context.test.js` — **new**.
- `src/main/automation/mcp-tools.js`, `mcp-server.js`, `scope.js` — **modified**.
- `test/unit/automation-scope.test.js`, `test/unit/automation-mcp-tools.test.js` — **modified**.
- `docs/mcp-automation.md` — **modified** (vault tools + tool count + wire policy).
- `src/main/vault/vault-store.js` — **modified** (additive `openAllWithAdminKey`).
- `missions/12-password-manager/flights/01-vault-core-and-automation/flight-log.md` — leg progress entry.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (new + full `npm test`), typecheck + lint clean
- [ ] Update flight-log.md with the leg progress entry
- [ ] Set this leg's status to `landed`
- [ ] Do NOT check off the leg in flight.md, do NOT commit (deferred-commit model)

---

## Open Questions (resolved at leg or flagged forward)

- **Global-vault logins via jar automation** — F1 scopes a jar automation session to its own
  jar vault only (mission: "a per-jar vault access key unlocks exactly that jar's vault"). Reaching
  global via automation = admin key. A dedicated global-scoped access-key tier (so a jar consumer
  could also fill global logins the way the human picker shows them) is deferred — flag to F2/F3.
- **Admin unlock via the X25519 private key over a tool arg** — intended per mission (operator-held
  root; UI recommends against config-embedding). Kept; per-vault access keys remain the recommended
  config-resident grant.

## Citation Audit

Citations verified against current code at leg design time: `mcp-tools.js:614/596/632`,
`mcp-server.js:375/384/398-405/707/712/79`, `automation-mcp-tools.test.js:72-79`,
`docs/mcp-automation.md:19,441`, `scope.js:88/136-142`, `resolve.js:resolveContentsForJar`,
`automation-auth.js:validateKey`; `vault-store.js:unlockVaultWithAccessKey` (stateless, `:690`)
and `unlockWithAdmin`/`_installMrk` (stateful, `:469/486`). No drift.
