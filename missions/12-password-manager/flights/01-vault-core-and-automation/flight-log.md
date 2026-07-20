# Flight Log: Vault Core + Automation Surface

**Flight**: [Vault Core + Automation Surface](flight.md)

## Summary

Flight in-flight on branch `flight/01-vault-core-and-automation`. Autonomous execution
(operator pre-authorized at mission design). Four legs: vault-crypto → vault-store →
vault-mcp-wire → vault-fill. Code review + commit deferred to flight end (single review
pass over all legs).

---

## Leg Progress

### Leg 1 — `vault-crypto` (landed, 2026-07-20)

**Implemented** the pure, Electron-free crypto + `.gfvault` format module
(`src/main/vault/vault-crypto.js`, `node:crypto` only) and its offline unit suite
(`test/unit/vault-crypto.test.js`, 41 cases). All acceptance criteria met:

- **Item crypto**: `newVaultKey` (256-bit) + AES-256-GCM `encryptItems`/`decryptItems`
  over opaque JSON; the document `version` binds as items AAD. Tamper (ct/iv/tag byte
  flip), wrong key, and version-AAD mismatch all throw the typed `VaultAuthError`.
  IV freshness verified (successive encrypts → distinct IVs).
- **Four envelope operations** over the 32-byte vault key: scrypt master (async),
  HKDF recovery, HKDF per-jar access, X25519 admin seal. Each round-trips byte-equal;
  each wrong-key path throws. `keyId` + `type` + document `version` bound as GCM AAD
  (relabel / type-swap / version-downgrade all fail authentication).
- **Envelope independence + revoke**: a 4-envelope vault opens identically via any
  grantee; revoking one by keyId leaves the others functional.
- **Key-ids readable without key material** via `parseVault` + `listEnvelopeKeyIds`;
  access keyIds minted independently of the secret (`randomBytes(8)` base64url).
  Duplicate-keyId rejection in both `serializeVault` and `parseVault`.
- **X25519 seal**: `epk` serialized SPKI-DER base64, re-imported through a full
  `serializeVault`/`parseVault` JSON cycle; opens via both the live and the
  exported/re-imported admin private key. `generateAdminKeypair` returns KeyObjects +
  SPKI/PKCS8 base64 exports.
- **Re-wrap only**: master-password change / recovery rotation swaps only the
  envelope — the items ciphertext is byte-identical before/after.
- **Serialization** self-contained + versioned (`format`/`version`/`vaultId`/`kdf`/
  `envelopes`/`items`); strict parse rejects malformed JSON, unknown/missing version,
  wrong format id, malformed items/envelopes, and duplicate keyIds — all typed
  `VaultFormatError` (feeds Leg 2's load-loudly rule).
- **TOTP (RFC 6238)**: local base32 decode, explicit-timestamp pure function.
  Reproduces the published SHA-1 8-digit vectors (`59s→94287082`,
  `1111111109s→07081804`, `1111111111s→14050471`), plus a 6-digit default assertion,
  algorithm/digits/period overrides, and a period-boundary case. `parseOtpauth`
  handles `otpauth://totp/...` URIs (percent-encoding, issuer/label) and bare base32.

**scrypt parameters (DD11)** — benchmarked async `crypto.scrypt` on this dev rig
(WSL2, Node v22.22.0). Measurements (avg of 3, warmed): N=2¹⁵→58 ms, N=2¹⁶→119 ms,
N=2¹⁷ r8 p1→238 ms, **N=2¹⁷ r8 p2→434 ms**, N=2¹⁸ r8 p1→472 ms. **Chosen:
`N = 2¹⁷ (131072), r = 8, p = 2, maxmem = 192 MiB` → ~434 ms measured** (solidly in
the 250–500 ms target). `128·N·r` = 128 MiB, so `maxmem` (192 MiB) comfortably
exceeds it; empirically `maxmem ≤ 128·N·r` throws `ERR_CRYPTO_INVALID_SCRYPT_PARAMS`
(boundary pinned by a dedicated test). Functional round-trips run at a fast
`N = 2¹⁴` to keep the suite quick (887 ms total); one isolated test exercises the
production params + the too-low-maxmem throw.

**Decisions/notes**:
- Chose to raise cost via `p` (2¹⁷/r8/**p2**) over pure `N` (2¹⁸/r8/p1): both hit
  ~450–470 ms, but p2 keeps the transient memory footprint at 128 MiB instead of
  256 MiB — cheaper per-unlock allocation on a desktop while landing mid-target.
- `hkdfSync` returns an `ArrayBuffer`; wrapped every result in `Buffer.from(...)`
  (the `@ts-check`/`.equals()` hazard called out in the leg).
- Two verification-grep hazards avoided: reworded the doc comment so the literal
  `scryptSync` never appears in the source, and the `totp` JSDoc types `opts` as
  nullable-object (not an optional `[opts]`) so a required `timestampMs` can follow
  it without TS1016.
- Fully additive: no existing source file touched. `npm run typecheck` and
  `npm run lint` clean; `require('electron')` and `scryptSync` greps empty.

### Leg 2 — `vault-store` (landed, 2026-07-20)

**Implemented** the stateful, Electron-free vault store and its crash-safe writer,
composing the landed `vault-crypto` under the **Manager Root Key (MRK)** design:

- `src/main/vault/atomic-write.js` — `writeFileAtomic(dest, buf)`: temp file in the
  same dir → `fsyncSync` → `renameSync`, best-effort dir fsync (swallows EINVAL and
  any other dir-fsync error), and on failure unlinks the temp inside its own
  best-effort try before rethrowing (destination untouched). `fs` is referenced
  through the module object so the suite can monkeypatch one syscall to simulate a
  crash.
- `src/main/vault/vault-store.js` — `load(userDataPath, deps)` returning a
  `VaultStore` (deps: `listJars`, `getAutoLockMinutes`, `onLock?`, `setTimeout?`,
  `clearTimeout?`, `now?`, `scryptParams?`). Electron-free and app-db-free.

**MRK composition as built.** `setup()` mints one random 256-bit MRK, wraps it three
ways, and writes `manager.json` (vault-store owns this format):
`{ format:'gfmanager', version:1, kdf:{…scrypt params}, adminPublicKeyB64, mrk:{ master:<scrypt env>, recovery:<hkdf env>, admin:<x25519 seal> } }`.
The MRK is never stored in plaintext; only the admin PUBLIC key is plaintext. Each
`.gfvault` (global + lazily-created jar vaults) carries a single `mrk` envelope =
`{ keyId:'mrk', type:'mrk', …wrapVaultKey(vaultKey, MRK, aad) }` where
**aad = `Buffer.from('gfvault/mrk-env/v' + docVersion)`**, the identical buffer on
wrap and unwrap (tamper/downgrade protection, since vault-crypto's `envelopeAad` is
not exported). Per-jar automation access keys wrap the individual vault key DIRECTLY
via `wrapAccess` (independent `access` envelopes) — an access key holds no envelope
for the MRK, so it structurally opens only its own vault.

- **Unlock lifecycle**: MRK + vault keys held only as in-memory Buffers; `this.mrk`
  is assigned ONLY after a successful unwrap, so a wrong secret on any of the three
  paths throws and leaves the manager LOCKED (`mrk === null`, no timer armed).
  `lockNow()`, the idle-timer fire, and the (main-injected) quit hook zeroize every
  buffer (`.fill(0)`) and drop refs. Idle auto-lock reads `getAutoLockMinutes()` and
  resets on each op (`_touch`); the real timer is `unref`'d so it never wedges a
  headless process.
- **Step-up (DD6)**: `mintAccessKey` re-unwraps the MRK master envelope with the
  supplied password even while unlocked, zeroizes that transient buffer, then mints;
  a wrong password throws and mints nothing. `unlockVaultWithAccessKey` iterates the
  vault's non-mrk envelopes calling `unwrapAccess`, catching `VaultAuthError` until
  one opens or all fail. `revokeAccessKey` removes the envelope (immediate effect).
- **Gate**: burner/unknown jars refused via `listJars().some(j => j.id === jarId)`
  (the `'global'` sentinel is always allowed); no file created on refusal.
- **Load-loudly**: corrupt `manager.json` / `.gfvault` throw typed errors
  (`VaultFormatError` / `VaultAuthError`) and are NEVER quarantined, renamed, or
  recreated (deliberately opposite of app-db.js).
- **settings-store**: additive `vaultAutoLockMinutes: 10` in DEFAULTS + `Settings`
  typedef + a strict `[1,1440]` integer VALIDATORS entry (automationPort template).

**Tests** (real temp dirs): `test/unit/vault-atomic-write.test.js` (6 cases —
crash-injection leaves old bytes + no temp) and `test/unit/vault-store.test.js`
(24 cases — 3 unlock paths, wrong-secret-stays-locked, recovery-after-forgotten +
new master with item ciphertext byte-identical, lazy jar recoverable by recovery AND
admin, burner refusal, in-memory zeroize, injected-timer idle auto-lock, step-up
refusal, access-key single-vault scope + immediate revoke, corrupt-not-quarantined,
mrk-AAD tamper + ciphertext-flip, and a `strings`-style no-plaintext scan). All new
suites green; full `npm test` 2280/2280; `typecheck` + `lint` clean; electron/app-db
greps empty.

**Decision/anomaly notes**:
- **scrypt params flow through `manager.json.kdf`** so tests inject FAST params at
  `setup` and every later unlock/step-up reads them back — production defaults to
  `SCRYPT_PARAMS`. This is what keeps the 24-case suite sub-500 ms.
- **`setup()` leaves the manager UNLOCKED** (the MRK was just generated in memory) —
  natural and lets the first save proceed without a redundant unlock.
- **Item schema (Login/Card/Secure note) is validated in the store** (vault-crypto
  treats items as opaque): `type ∈ {login,card,note}`, id minted if absent,
  `createdAt`/`updatedAt` from the injected clock; `saveItem` upserts by id.
- No deviation from the MRK design; the F3 export/portability consequence remains as
  recorded in Decisions + mission Known Issues (not touched this leg).

---

## Flight Director Notes

**2026-07-20 — Flight start.**
- Loaded crew from `.flightops/agent-crews/leg-execution.md` (Developer/Reviewer, Sonnet;
  a11y reviewer disabled — F1 has no UI). Validated: has Crew / Interaction Protocol /
  Prompts with fenced blocks.
- **Branch decision:** branched `flight/01-vault-core-and-automation` from `main`
  (7f5d074), the methodology default. Observation to surface: the prior flight branch
  `flight/01-indicator-and-popup` (an earlier mission's completed flight) is 3 commits
  ahead of `main` and **not yet merged**. Vault work is independent of the download-indicator
  code, so branching from `main` is correct and isolates this flight for its own PR; the
  prior flight's PR merges separately. No code dependency crosses the two.
- **Design-review posture (reuse, don't re-derive):** this flight already passed two
  Architect validation passes during planning (mission-level + two flight-design cycles),
  which resolved the high-risk crypto/scope design questions. Per-leg design review in 2a
  is still risk-tiered on its own merits below.
- **Prior-flight debrief scan:** no prior debrief in this mission (F1 is the first). No
  carried-forward test-timing/flake concerns touch the greenfield `vault-*` modules.

**2026-07-20 — Leg 1 `vault-crypto` risk-tier: HIGH.** Additive/single-surface, but a
**security-sensitive surface** (the cryptographic core) — the rubric tiers that high
regardless of blast radius. Running the per-leg design review (a Developer pass over the
leg artifact) even though the flight-level crypto model already cleared two Architect
passes; the leg adds new specifics worth a codebase check (module location `src/main/vault/`,
the envelope-derivation table, TOTP API + RFC vectors, scrypt starting params). Module-location
call: new `src/main/vault/` dir, mirroring `src/main/automation/`.

**2026-07-20 — Leg 1 design review: approve with changes → incorporated.** Developer
design-review verified all crypto claims on Node v22.22.0 (RFC 6238 vectors reproduce
exactly, x25519/scrypt/maxmem confirmed). Folded three medium fixes into the leg spec:
(1) `hkdfSync` returns ArrayBuffer → wrap `Buffer.from(...)`; (2) RFC vectors are 8-digit
→ tests call `{digits:8}` + a separate 6-digit default assertion; (3) pinned the x25519
`epk` serialization (SPKI-DER base64) + admin-key KeyObject input types + `generateAdminKeypair`.
Adopted hardening suggestions as leg criteria: **AAD-authenticated envelope headers**
(keyId/type/version bound into GCM — defends Leg 2's trust-the-parsed-header rule),
duplicate-keyId rejection, IV-freshness test, fast-N functional tests + one production-param
test. **Judgment call:** not running a 2nd design-review cycle — the fixes are the
reviewer's own unambiguous prescriptions, and the flight-end Reviewer + the implementing
Developer are the backstop. Leg → `ready`. `[HANDOFF:review-needed]` satisfied; proceeding
to implementation.

---

## Decisions

### Manager Root Key (MRK) — DD3 refinement (Leg 2 design)
**Context**: Flight DD3 ("each vault wrapped under master + recovery") conflicts with three
explicit mission requirements — one *manager-wide* recovery key, *lazy* jar-vault creation,
and "jar-vault creation must never mint a new secret." At lazy jar-vault creation the
recovery material isn't in memory, so per-vault recovery envelopes can't be added without
re-prompting or persisting the recovery secret (both unacceptable).
**Decision**: introduce a Manager Root Key. The MRK is wrapped under master + recovery +
admin-pub in `manager.json`; each vault key is wrapped under the MRK; per-jar access keys
still wrap individual vault keys directly. Master/recovery/admin each unwrap the MRK → every
vault key (incl. future jar vaults). Structural per-jar scope preserved (access key opens
only its vault, never the MRK). Leg 1 primitives support it unchanged.
**Impact**: faithful realization of the mission's manager-wide-recovery intent; admin
seal-to-future is total and trivial; rotation (F3) re-wraps 3 envelopes not per-vault. The
behavior test's absent-envelope property still holds. **Flagged to operator for veto at Leg 2
design; proceeding under autonomous authorization pending any objection.**

**Design review (Leg 2) validated the MRK and recommended adoption** — verified all vault-crypto
primitives support the composition unchanged; compartmentalization + absent-envelope +
admin-seal-to-future all hold; no weakening vs. the per-vault model. **One high-severity
consequence recorded:** under MRK a `.gfvault` is no longer *independently* unlockable (needs the
MRK from `manager.json`), shifting the mission's "on-disk format IS the export format" property.
**F3 export must bundle the `manager.json` MRK envelope set (or re-wrap the vault key under fresh
master/recovery envelopes at export).** Leg 2 doesn't implement export and doesn't preclude either.
Carried to the mission Known Issues so F3 plans it. Five spec-completeness fixes folded into the
leg (mrk-envelope AAD, unlock-by-access-key iterate-and-catch, Settings typedef extension,
atomic-write injection mechanism, jarId-membership gate not the tab-shaped resolvePersistJar) + two
new ACs (failed-unlock-leaves-locked, mrk-AAD tamper). Not running a 2nd design-review cycle — fixes
are spec completeness, MRK itself validated; flight-end Reviewer + F3 design are the backstop.

### Leg 3 — `vault-mcp-wire` (landed, 2026-07-20)

**Built** the fill-only MCP vault surface: a new Electron-free per-session vault context, the four
vault tools, cryptographic scope by session identity, per-session zeroization + idle backstop, and
audit integration. DOM fill effect deferred to Leg 4 (stub delegate injected here).

- **New `src/main/vault/vault-context.js`** (Electron-free — requires only `../automation/resolve`
  + `./vault-crypto`; every host handle injected). `createVaultContext(deps)` → per-session
  `{ unlock, list, totp, fill, touch, zeroize }` over `{ keys: Map<vaultId,Buffer>, unlockedIds }`.
  `unlock(identity, accessKey)`: jar → `vaultStore.unlockVaultWithAccessKey(jarId, secret)`; admin →
  `vaultStore.openAllWithAdminKey(privB64)` merged in. Wrong/foreign key → `{ unlocked: [] }` normal
  result (auth failures swallowed, never thrown). `list` = login metadata only (origin/username/
  hasTotp/vaultId/id/title — no secret); `totp(itemId)` = current code only (via `vc.parseOtpauth`+
  `vc.totp`). `fill(identity,{wcId,itemId},engineDeps)`: jar → `resolveContentsForJar` (throws
  `out-of-jar` on a foreign tab), admin → `resolveContents(allowInternal)`; then top-frame
  origin-match against the item; credential handed to the injected `fillDelegate({wcId,credential})`
  — **never returned** (result is `{filled,id|reason}`). `touch()` resets the idle timer; fire →
  `zeroize()` (`.fill(0)` every Buffer + clear).

- **Threading (Option 1, audit-preserving).** `mcp-tools.js`: added `VAULT_TOOLS` (4 defs) into
  `TOOLS`; `buildToolRegistry(getEngine, getVaultCtx)`; `callTool` passes the vault ctx as the 3rd
  `call` arg (existing engine-op defs ignore it). Tools stay in `TOOLS` so the existing
  `auditLog.record` wrap around `registry.callTool` audits them — no bypass. `mcp-server.js`: mint
  `vaultCtx = createVaultContext(...)` per session in `routeRequest` BEFORE the transport; the SAME
  reference threads into `buildServer` (a per-session bound adapter closing over identity + scopeCtx
  as the fill membership deps), the `sessions.set` entry, and `transport.onclose` (which
  `vaultCtx.zeroize()`s before eviction). `createMcpServer` gained injected `vaultStore` +
  `fillDelegate` + `getAutoLockMinutes`. `deriveAuditDetail` vault cases return strings and NEVER a
  secret (`vaultFill`/`vaultTotp` → `item=<id>`; `vaultUnlock`/`vaultList` → null — the `accessKey`,
  a per-jar secret OR the admin private key, is structurally never logged).

- **Dispatch OUTSIDE scopeEngine (the leg DECISION).** `scope.js` gained registration-only
  `WCID_FIRST_CUSTOM_JAR_OPS = ['vaultFill']` (exported for the three-place guard) — deliberately
  NOT in `WCID_FIRST_OPS` (the generic `engine[op]` wrapper would throw "engine.vaultFill is not a
  function") and NO `scopeEngine` method (admin returns the raw engine, reference-pinned).
  Enforcement lives in `vault-context.fill`. `automation-scope.test.js` guard now accepts
  `WCID_FIRST_OPS ∪ WCID_FIRST_EXEMPT ∪ WCID_FIRST_CUSTOM_JAR_OPS` (+ a new disjointness/no-façade-
  method assertion).

- **Fill-delegate stub for Leg 4.** `createMcpServer` defaults `fillDelegate` to a throwing stub;
  `main.js` injects an explicit `vault-fill-not-wired — … lands in Leg 4` stub. So the running app's
  `vaultUnlock`/`vaultList`/`vaultTotp` are live now; `vaultFill` throws until Leg 4 swaps the real
  main→preload fill effect in. `main.js` also wires a **dedicated, memoized** `vault-store` instance
  for the automation read path (its stateless methods only) — never the human-lock singleton.

- **Counts corrected 30 → 34** everywhere: `mcp-tools.js`/`mcp-server.js` comments,
  `automation-mcp-tools.test.js` (segregated the 4 vault tools as a non-engine-op set + a
  vault-schema test + the stale :1011 comment), `automation-mcp-server.test.js`
  `EXPECTED_TOOL_COUNT`, and `docs/mcp-automation.md` (new **Vault tools** section + fill-only wire
  policy + the two count sites).

- **Tests.** New `test/unit/vault-context.test.js` (real `.gfvault` fixtures built via the
  vault-store API + fakes for the browser world/fill delegate): every AC — two-session isolation
  (independent buffers), jar-can't-reach-global/sibling, admin-reaches-all, metadata-only list,
  totp-code-only, fill-delegate-gets-credential + result-no-password, out-of-jar throw,
  origin-mismatch/no-match/locked normal results, audit-no-secret (both key types), onclose zeroize
  + re-unlock, no-singleton-coupling both directions, `openAllWithAdminKey` no-mutation, idle
  auto-lock fires + zeroizes. **Full `npm test` green (2299 pass), typecheck + lint clean**, the
  `require('electron')` grep on `vault-context.js` empty.

### Leg 4 — `vault-fill` (landed, 2026-07-20)

**Wired** the real main→preload credential-injection channel, staged the headless vault-fixture
builder + login-form fixture page, and pinned the DD7 security invariant. Code + fixtures + unit
tests only — the `vault-mcp-surface` behavior test is a **staged prerequisite** for the Flight
Director / operator (live GUI not stood up in this session; fixtures + run command ready).

- **`src/preload/vault-fill-fields.js` (NEW pure core) + `webview-preload.js` (listener).** The
  field-selection/fill logic is factored into a small **electron-free, side-effect-free** sibling
  module so it unit-tests headlessly — the preload itself cannot be `require()`d under `node --test`
  (its top-level `window`/`MutationObserver`/`ipcRenderer` side-effects throw in plain Node). The
  preload adds `ipcRenderer.on('vault-fill', (_e, cred) => fillLoginForm(document, cred))` right by
  the `rescan-media` listener; the existing media-catalog + fingerprint behavior is untouched.
  `findLoginFields(doc)` pins the leg's DOM surface exactly: FIRST `input[type=password]` → its
  `pw.form` (fallback `pw.closest('form')`) → the LAST text/email/tel/no-type input PRECEDING the
  password in that form. `fillLoginForm(doc, cred)` guards `window.top !== window` (top-frame only),
  sets `.value`, dispatches bubbling `input` + `change`, fills nothing when there is no password
  field, and returns `{ filled }` — never the credential.

- **`main.js` real fill delegate (stub swap at main.js:629-631).** Replaced the `vault-fill-not-wired`
  throwing stub with `fillDelegate: ({ wcId, credential }) => { webContents.fromId(wcId)?.send('vault-fill', credential); }`
  — byte-for-byte the shape `vault-context.fill` already calls. `webContents.send` targets the MAIN
  frame only (natural top-frame gate); a tab closed mid-fill → `fromId()` null → optional-chain
  no-op. The credential travels main→preload ONLY; `vault-context.fill` still returns `{ filled, id }`
  (grep confirms the sole `password` reference in the fill path is the delegate hand-off at
  `vault-context.js:329`, never the tool result).

- **DD7 invariant pinned — `test/unit/register-tab-ipc.test.js`.** The web-branch `tab-create` test
  now asserts `webPreferences.nodeIntegration === false` AND `sandbox === false` (previously pinned
  only on the internal branch). This is the load-bearing premise that page JS cannot obtain
  `ipcRenderer` to register a rogue `vault-fill` listener.

- **`test/unit/vault-fill-fields.test.js` (NEW).** Zero-dep hand-rolled fake `document`
  (jars-page-dom.js / media-controller precedent), 7 cases: both fields filled + `input`/`change`
  dispatched on a normal form; no-password-field → no fill; multiple forms → the password-bearing
  form's username is chosen; the closest-preceding username heuristic is deterministic (skips
  checkbox, ignores an earlier qualifying input and a trailing input after the password);
  password-only form; and the top-frame guard refuses an iframe (`window.top !== window`).

- **`tests/behavior/fixtures/vault-login/build-fixtures.mjs` (NEW headless builder).** Uses
  `createRequire(import.meta.url)` to require the CJS `vault-store` (dev-launch.mjs interop). `load`s
  the store with **`listJars: () => [{id:'jar-a'},{id:'jar-b'}]`** (REQUIRED — `_resolveTarget`
  throws for jar targets otherwise) + `getAutoLockMinutes: () => 10`; `setup({masterPassword})`
  RETAINING the master password (both step-up mints re-check it); `saveItem` a Login for global +
  jar-a + jar-b at the fixture origin (jar-a's carries an `otpauth://` TOTP secret,
  `JBSWY3DPEHPK3PXP`); `mintAccessKey(jarId, {masterPassword})` per jar. Prints JSON
  `{ jarKeyIds, jarAccessSecrets, adminPrivateKeyB64, recoveryKeyDisplay, fixtureOrigin }`.
  **Verified**: `node tests/behavior/fixtures/vault-login/build-fixtures.mjs /tmp/vault-fixture-check`
  builds + prints without error; `grep` over the written `vaults/*.gfvault` finds NO plaintext
  password / username / TOTP secret / access secret — and the global vault carries only the `mrk`
  envelope (no per-jar keyId), the file-level absent-envelope scope property behavior step 8 asserts.

- **`tests/behavior/fixtures/vault-login/index.html` (NEW) + README.** A static login page — a
  `<form>` with `<input name=username>` + `<input type=password name=password>` + submit, submission
  suppressed (a fill must never navigate — behavior step 5). **Serve method** (documented in-file +
  README): `python3 -m http.server 8099` from the fixture dir → `http://127.0.0.1:8099/`. That origin
  is `FIXTURE_ORIGIN` in the builder, so the seeded logins' exact-origin match succeeds.

- **How to run the behavior test (staged for the operator).** Build a fresh dev profile's fixtures
  (`build-fixtures.mjs <userDataDir>`), serve `index.html` on 8099, launch `npm run dev:automation`
  on this branch, export the transport keys + `GOLDFINCH_AUTOMATION_ADMIN` + the printed access
  secrets/admin key per `tests/behavior/vault-mcp-surface.md`, then the Flight Director runs
  `/behavior-test vault-mcp-surface`.

- **Verification.** `node --test test/unit/vault-fill-fields.test.js test/unit/register-tab-ipc.test.js`
  green (14); **full `npm test` green (2305 pass, 0 fail)**; `npm run typecheck` + `npm run lint`
  clean.

---

## Deviations

_(departures from the planned approach — append during execution)_

- **Leg 3 — added one extra stateless `vault-store` method beyond the enumerated
  `openAllWithAdminKey`.** The leg enumerated only `openAllWithAdminKey` as the `vault-store` change,
  but listed `listItems`/`totp` on the injected accessor — both of which the real `vault-store`
  implements as STATEFUL (MRK singleton) operations, contradicting the leg's hard "no singleton"
  rule. To honor no-singleton while still reading item metadata from the session's own key Buffers,
  added a small **stateless** `readVaultItems(vaultId, key)` (reads the doc via the existing
  `_readVault`, decrypts with the SUPPLIED key, no MRK/no cache/no mutation). TOTP code generation
  lives in `vault-context` via the pure `vault-crypto` primitives (no `vault-store.totp` added).
  Both additions are additive + stateless; the human `listItems` path is untouched.
- **Leg 4 — field helpers live in a NEW sibling module `src/preload/vault-fill-fields.js`, not
  inline in `webview-preload.js`.** The leg's Files Affected listed only `webview-preload.js`
  modified, but the guidance offered "export them for the unit test, or structure so a fake document
  drives them." Exporting from the preload is unworkable: `webview-preload.js` cannot be
  `require()`d under `node --test` (its top-level `window`/`MutationObserver`/`ipcRenderer`
  side-effects throw in plain Node), so the pure `findLoginFields`/`fillLoginForm` core is factored
  into an electron-free, side-effect-free sibling module the preload requires and the unit test
  drives directly — the same electron-free-core discipline vault-context / vault-store already
  follow. One-line eslint config addition to give the new file webview-preload.js's node+browser
  main-world globals.
- **Leg 4 — added `tests/behavior/fixtures/vault-login/README.md`** (operator build/serve guide),
  matching the existing fixture-dir convention (mcp-drive-end-to-end, tab-scheme-guard, …). Not in
  the leg's enumerated outputs but consistent with the house pattern; the dir is lint/prettier-
  excluded.
- **Leg 4 — behavior test STAGED, not run.** Per the leg's behavior-test-execution prerequisite (no
  live GUI/automation env stood up in this session), `vault-mcp-surface` is recorded as a staged
  prerequisite: fixtures build + login page + run command are ready; the Flight Director / operator
  runs `/behavior-test vault-mcp-surface`. No run log written yet.
- **Leg 3 — `vault-context.js` requires `../automation/resolve`** (the leg text wrote
  `require('./resolve')`, but the module lives in `src/main/vault/`, so the correct relative path to
  the automation resolver is `../automation/`). Functionally identical to the intent.

---

## Anomalies

_(unexpected issues — append during execution)_

---

## Leg risk-tiering (Flight Director)

- **Leg 1 `vault-crypto`: HIGH** — security-sensitive crypto surface. Design-reviewed.
- **Leg 2 `vault-store`: HIGH** — persistence + security + state lifecycle + MRK composition. Design-reviewed.
- **Leg 3 `vault-mcp-wire`: HIGH** — security-sensitive MCP boundary, shared-interface changes
  (`scope.js`/`mcp-server.js`/`mcp-tools.js` have existing consumers + the three-place guard test),
  new per-session lifecycle state. Design-review cycle 1: **approve with changes** (3 HIGH, 4 MED,
  all concrete). Leg rewritten to resolve them: mandate audit-preserving Option 1 threading
  (`buildToolRegistry(getEngine, getVaultCtx)`), dispatch vault ops OUTSIDE `scopeEngine` via a new
  electron-free `vault-context.js` (admin passthrough is reference-pinned, so `vaultFill` can't be a
  scope method), `WCID_FIRST_CUSTOM_JAR_OPS` as a registration-only guard marker, drop the redundant
  jar stateless helper (Leg 2's `unlockVaultWithAccessKey` is already stateless) + keep
  `openAllWithAdminKey` (no `_installMrk`, fresh buffers, zeroize local MRK), fix the "30 tools"
  discovery test + docs, strict per-jar automation scope (jar session → own vault only; global via
  admin — behavior test steps 2/7/8 updated + MRK envelope structure corrected). Design-review cycle 2 (focused): **approve** — all 3 HIGH + 4 MED confirmed resolved against real
  code; two low residuals folded in (two stale "30 tools" comment sites; keep audit `detail` as a
  string to match convention). Two cycles complete (process max). Proceeding to implementation.
- **Leg 4 `vault-fill`: HIGH** — web-content trust boundary (`webview-preload.js`), live
  credential injection. Design review: **approve with changes**. Key point CONFIRMED — the real
  delegate `webContents.fromId(wcId)?.send('vault-fill', credential)` matches Leg 3's
  `vault-context.fill` call byte-for-byte; stub swap site is `main.js:629-631`. Folded fixes:
  commit to adding the web-guest `nodeIntegration:false` assertion (DD7 premise, currently
  unpinned); fixture builder must inject `listJars` (two jar ids) + retain master pw for async
  step-up mint; pinned the `findLoginFields` DOM surface; moved fixtures to
  `tests/behavior/fixtures/vault-login/`; added the hostile-main-world/exact-origin-confinement
  note. Flight.md housekeeping: corrected stale "Three legs" → four (Leg 3 split at design review).
  Proceeding to implementation.

---

## Session Notes

_(chronological notes from work sessions)_

### Flight Director — flight-end review & commit disposition (2026-07-20)

Independent flight-end review (Sonnet) over all four legs' diff confirmed crypto correctness,
fill-only wire policy, session isolation/zeroization, and no regressions — and caught **one
BLOCKING finding the four per-leg reviews all missed**: the `'global'` sentinel collision (below).
Fixed + re-reviewed to **`[HANDOFF:confirmed]`** (collision closed on both paths, migration data-safe
— partition preserved, `usesEngine`/version-passthrough clean, suite **2308/0**).

**Commit disposition:** the flight is code-complete, reviewed, and committed on branch
`flight/01-vault-core-and-automation`. It remains **in-flight** (not `landed`, not checked off in the
mission) pending the one live acceptance gate — the `vault-mcp-surface` behavior test — which needs an
Electron GUI + the dev automation build and cannot run in this headless session. Fixtures + login page
+ run command are staged under `tests/behavior/fixtures/vault-login/`. Flight lands + PR marked ready +
`[COMPLETE:flight]` only after that behavior test passes (operator-run).

### Flight-end review fixes

Reviewer flagged one BLOCKING security issue + two non-blocking cleanups. All three fixed
(no leg-status or commit changes made here).

**BLOCKING — `'global'` jar-id sentinel collision (cross-vault privilege escalation).**
`vault-store` reserves the literal id `global` (`GLOBAL_ID`) for the manager-wide global vault,
and `_resolveTarget` treats `target === GLOBAL_ID` as a hard sentinel. But `jars.js`'s
`isReservedId()` did NOT reserve `global`, so a container named "Global" slugged to id `global`
and every jar-scoped vault op (`saveItem`/`mintAccessKey`/`unlockVaultWithAccessKey`/
`openAllWithAdminKey`) aliased onto the true global vault — a per-jar access key could unlock the
shared global vault. Fixed in two layers:
- **Layer 1 (prevents future collisions):** added `global` to `jars.js` `isReservedId()` (same
  exact-match discipline as `admin`/`internal`/`default`). `slug()`/`add()` now remap it to
  `jar-global` and `validateContainers()` remaps any pre-existing `global` entry, so no container
  id can ever collide. No existing test asserted `global` was a valid jar id.
- **Layer 2 (defense-in-depth for pre-existing installs):** `_resolveTarget`'s jar allowlist and
  `openAllWithAdminKey`'s jar enumeration now EXCLUDE any `listJars()` entry whose id === `GLOBAL_ID`
  (`&& j.id !== GLOBAL_ID` / `.filter(id => id !== GLOBAL_ID)`). A `{ id: 'global' }` jar surfaced by
  a store written before Layer 1 can never become a second, jar-scoped route to the manager-wide
  vault, and admin-open never double-visits/mis-maps the `global` slot. The legitimate sentinel
  path stays intact.
- **Regression tests:** `jars.test.js` — `validateContainers` remaps a literal `{id:'global'}` →
  `jar-global`, and `add('Global')` mints `jar-global` not `global` (both FAIL on the pre-fix code).
  `vault-store.test.js` — a `listJars()` returning `[{id:'global'}, {id:'work'}]` cannot reach the
  manager-wide global vault via the jar path: the `global` slot always decrypts the true global
  vault, and a jar access secret opens nothing on it.

**Non-blocking #4 — lazy engine for vault-only MCP tools.** `mcp-tools.js` `callTool` resolved
`getEngine()` unconditionally even for the four vault tools (which dispatch to the per-session vault
ctx, never the engine). Added a declarative `usesEngine: false` marker on the four vault defs;
`callTool` now resolves the engine only when the dispatched def needs it, so a future throwing/null
`getEngine` (e.g. a closed window) can't fail a vault-only call. Engine-op tools omit the marker and
keep resolving the engine inside the try (null engine still degrades to isError). No behavior change
for engine tools.

**Non-blocking #5 — manager-envelope AAD version binding.** `setup()`/`changeMasterPassword()`
wrapped the MRK envelopes (`wrapMaster`/`wrapRecovery`/`sealToAdmin`) without an explicit version, so
their AAD bound vault-crypto's `.gfvault` `VERSION` rather than `MANAGER_VERSION` (the gfmanager
format's own version). Both are `1` today (no live bug). Applied the explicit pass-through (preferred
option — the wrap fns accept a `version` opt): all manager-envelope wrap AND matching unwrap sites
(`unlock`/`unlockWithRecovery`/`unlockWithAdmin`/`mintAccessKey` step-up/`openAllWithAdminKey`) now
pass `{ version: MANAGER_VERSION }`, symmetrically, so GCM auth still matches and the two version
spaces can diverge safely later.

**Verification:** full suite green (2308 pass / 0 fail), `npm run typecheck` clean, `npm run lint`
clean. Reviewer PoC path confirmed closed: a jar named "Global" can no longer be created
(`isReservedId`), and a `listJars()` entry with id `global` can no longer reach the manager-wide
vault via the jar path.
