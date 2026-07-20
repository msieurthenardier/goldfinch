# Leg: vault-store

**Status**: landed
**Flight**: [Vault Core + Automation Surface](../flight.md)

## Objective

Build the stateful main-process `vault-store` that composes the landed `vault-crypto`
module into persisted, lockable vaults: first-run manager setup, `.gfvault` persistence
with a net-new atomic writer, the in-memory unlock lifecycle (auto-lock, Lock now,
lock-on-quit, zeroization), step-up re-auth, per-jar access-key minting, and the
burner/internal exclusion — all verifiable headlessly with real temp dirs.

## Context

- **Leg 2 of 4.** Depends on Leg 1 (`vault-crypto`, landed). Legs 3–4 (the MCP surface)
  consume this module's API. No UI (DD9) — the store API is the seam both the F1 tests and
  the eventual F2/F3 UIs sit on.
- Consumes `src/main/vault/vault-crypto.js` exports: `newVaultKey`, `encryptItems`,
  `decryptItems`, `wrapVaultKey`, `unwrapVaultKey`, `wrapMaster`, `unwrapMaster`,
  `wrapRecovery`, `unwrapRecovery`, `wrapAccess`, `unwrapAccess`, `sealToAdmin`,
  `openAdminSeal`, `generateRecoveryKey`, `parseRecoveryKey`, `generateAccessKey`,
  `generateAdminKeypair`, `importAdminPublicKey`, `importAdminPrivateKey`, `serializeVault`,
  `parseVault`, `listEnvelopeKeyIds`, `SCRYPT_PARAMS`, `VaultAuthError`, `VaultFormatError`.

### DECISION — Manager Root Key (MRK) composition (resolves DD3 vs. lazy jar creation)

The flight's **DD3** describes each vault as "wrapped twice — once under master, once under
recovery." Taken literally, that conflicts with three explicit **mission** requirements:
one *manager-wide* recovery key, jar vaults created *lazily* on first save, and
*"jar-vault creation must never mint a new secret the operator has to file away."* At lazy
jar-vault creation the recovery material is not in memory (shown once at setup, operator-held),
so a per-vault recovery envelope cannot be added without re-prompting or persisting the
recovery secret — both unacceptable.

**Resolution (adopted):** a single random 256-bit **Manager Root Key (MRK)**. The MRK is
wrapped under master + recovery + admin-pub in `manager.json`. **Each vault key is wrapped
under the MRK** (a `mrk` envelope on each `.gfvault`). Per-jar automation access keys still
wrap individual vault keys **directly** (independent `access` envelopes on the jar vault).

Why this is the faithful realization of mission intent, not a deviation from it:
- **One recovery key truly recovers everything** — master OR recovery OR admin unwraps the
  MRK, which unwraps every vault key, including jar vaults created *after* setup. No new
  secret is minted at jar creation.
- **Admin seal-to-future is trivial and total** — the MRK is sealed to the admin public key
  once; every current and future vault is reachable by the admin key (mission SC satisfied
  more strongly than per-vault sealing).
- **Rotation is cheap** — master change / recovery rotation / admin rotation re-wraps only
  the MRK's three envelopes, never per-vault data (F3 rotation gets simpler).
- **Structural per-jar scope is preserved** — a jar's access key opens only that jar's vault
  key via its own `access` envelope; it has no envelope for the MRK, so it cannot reach the
  global vault or sibling jars. The behavior test's absent-envelope property (global carries
  no envelope for jar-2's access key) still holds.
- **Leg 1 is unchanged** — `vault-crypto`'s primitives already support this: `wrapMaster`/
  `wrapRecovery`/`sealToAdmin` wrap the MRK; `wrapVaultKey`/`unwrapVaultKey` (generic
  AES-256-GCM) form the `mrk` envelope on each vault; `wrapAccess` forms access envelopes.

This decision is recorded in the flight log as a DD3 refinement and was flagged to the
operator for veto at Leg 2 design.

**Portability consequence (carried to F3 — do NOT solve here):** under MRK a `.gfvault`
file is **no longer independently unlockable** — it holds only an `mrk` envelope (+ access
envelopes), and unlocking needs the MRK from `manager.json`. This shifts the mission's
"the on-disk format IS the export format / a single file imports and unlocks with master or
recovery" property: **F3's export must bundle the `manager.json` MRK envelope set** (master +
recovery envelopes) alongside the vault, OR re-wrap the exported vault key under fresh
master/recovery envelopes at export time. This leg does NOT implement export; it only must
not preclude either approach (the MRK envelopes are standard `vault-crypto` envelopes, so a
future export can copy or re-derive them). Recorded in the flight log Decisions and the
mission Known Issues so F3 plans it rather than discovering it late.

### Convention anchors (verified)

- `src/main/settings-store.js` — the Electron-free injected-`userDataPath` store pattern
  (`load(userDataPath, opts)`), and the additive `DEFAULTS` + `VALIDATORS` idiom
  (`restoreSession` is the strict-boolean template; additive keys need no version bump).
- `src/main/app-lifecycle.js:registerAppLifecycle` — owns `app.on('before-quit')` /
  `app.on('will-quit')`; the lock-on-quit hook wires in here (main injects, store stays
  Electron-free).
- `src/main/jars.js:list` — returns persistent jars only (burner ∉ list). **This is the
  reusable primitive for the store's jarId gate:** `listJars().some(j => j.id === jarId)`.
  (`persist-jar-gate.js:resolvePersistJar` is *tab-partition*-shaped — `(tabEntry, jarsList)`
  over `{partition,trusted}` — so it is NOT the right primitive here, where the store
  receives a bare `jarId`; the id-membership check gives the same positive-allowlist,
  burner-excluded-structurally guarantee.)
- **`.gfvault` files are NOT `app.db` rows** (DD1) — do NOT `require('./app-db')`. Post-M10
  stores moved onto SQLite rows, so there is no live temp-write+rename helper to copy; this
  leg writes its own.

## Inputs

- `src/main/vault/vault-crypto.js` (landed).
- `node:fs`, `node:path`, `node:crypto` (built-in). No new dependency.

## Outputs

- `src/main/vault/vault-store.js` — the stateful store (Electron-free; deps injected).
- `src/main/vault/atomic-write.js` — net-new `writeFileAtomic(path, data)` helper
  (tmp write in the same dir → `fsync` → `rename`; `fsync` the dir where feasible). *(May
  live inside `vault-store.js` if the implementer prefers; a separate small module is
  cleaner and independently testable.)*
- `test/unit/vault-store.test.js` — unit suite with real temp dirs.
- `test/unit/vault-atomic-write.test.js` — atomic-writer suite (if factored out).
- **Modified** `src/main/settings-store.js` — add the additive `vaultAutoLockMinutes` key
  to `DEFAULTS` + a `VALIDATORS` entry (see Edge Cases for bounds).

## Acceptance Criteria

- [ ] `src/main/vault/vault-store.js` exists, is `// @ts-check` clean, and is **Electron-free** (`require('electron')`-free; all Electron/host handles — `userDataPath`, a `listJars()` provider, and any quit hook — injected at `load(...)`).
- [ ] **Atomic write**: `writeFileAtomic` writes to a temp file in the target directory, fsyncs, then renames over the destination; a crash/throw mid-write leaves the previous file intact (verified by simulating a failed write and asserting the old bytes remain). No partial file is ever observable at the destination path.
- [ ] **First-run setup**: `setup({ masterPassword })` generates the MRK, a one-time recovery key, and an admin keypair; writes `manager.json` (MRK wrapped under master + recovery + admin-pub; admin **public** key stored plaintext; **no plaintext secret on disk**) and the global `.gfvault` (vault key wrapped under the MRK). Returns the recovery-key display string and the admin private key **exactly once**; neither is persisted.
- [ ] **Unlock paths**: after setup, the manager unlocks via (a) the master password, (b) the recovery key, and (c) the admin private key — each unwraps the MRK and thereby every vault key. A wrong secret on any path throws (surfaced as a typed error), never unlocks.
- [ ] **Recovery after forgotten master**: unlocking with the recovery key while the master is unknown succeeds and allows setting a **new** master password (re-wraps the MRK's master envelope only; item ciphertext untouched).
- [ ] **Lazy jar-vault creation**: saving an item to a jar with no vault yet creates `userData/vaults/<jarId>.gfvault` with the vault key wrapped under the MRK — **with no new operator secret and no re-prompt**. The recovery key and admin key both unlock this jar vault (verified) despite it being created after setup.
- [ ] **Burner/internal exclusion**: attempting to create/open a vault for a burner id or an id not in `listJars()` is refused (no file created), via `listJars().some(j => j.id === jarId)` — the positive allowlist idiom, no dedicated burner-name check.
- [ ] **Failed unlock leaves the manager LOCKED**: a wrong secret on any unlock path throws and leaves `mrk === null`, no vault keys cached, and no idle timer armed (assign `this.mrk` only *after* a successful unwrap); a subsequent save/mint while locked throws.
- [ ] **`mrk`-envelope tamper protection**: the `mrk` envelope binds a stable AAD (document version); altering its `keyId`/`type`/version makes unwrap fail authentication.
- [ ] **In-memory unlock lifecycle**: unlocked MRK + vault keys are held only in main-process memory as `Buffer`s; `lockNow()` and the quit hook zeroize them (`.fill(0)`) and drop references; after locking, reading items requires a fresh unlock. No plaintext key is ever written to disk or logs.
- [ ] **Idle auto-lock**: an idle timer (duration from the new `vaultAutoLockMinutes` setting, default 10) locks the manager after inactivity; any store operation resets it; firing the timer zeroizes keys. Verified with an injected/short timer in the test.
- [ ] **Step-up re-auth (DD6)**: `mintAccessKey(vaultId, { masterPassword })` refuses unless the supplied master password still unwraps the MRK's master envelope — **even while already unlocked**; a wrong password throws and mints nothing. Fill/reveal/list/TOTP/export-style reads are NOT gated by step-up.
- [ ] **Access-key minting**: on success `mintAccessKey` generates a secret + independent keyId, adds an `access` envelope wrapping **that vault's** key, persists the vault, and returns the plaintext secret + keyId **once**. `unlockVaultWithAccessKey(vaultId, secret)` then unwraps only that vault's key (no MRK access). `revokeAccessKey(vaultId, keyId)` deletes the envelope and takes effect immediately.
- [ ] **Corrupt vault surfaces loudly**: a truncated/tampered `manager.json` or `.gfvault` makes `load`/unlock throw a typed error — the file is **never** quarantined, renamed, or recreated (explicitly opposite of `app-db.js`). Verified.
- [ ] `settings-store` gains `vaultAutoLockMinutes` (additive `DEFAULTS` + strict `VALIDATORS`), existing `settings-store` tests still pass, and `settings-store.set('vaultAutoLockMinutes', <out-of-bounds>)` throws.
- [ ] `node --test test/unit/vault-store.test.js` (and the atomic-write suite) pass; `npm run typecheck` + `npm run lint` clean; full `npm test` green (no regressions).

## Verification Steps

- `timeout 120 node --test test/unit/vault-store.test.js test/unit/vault-atomic-write.test.js` — green.
- `npm test` — full suite green (settings-store additive key causes no regression).
- `npm run typecheck` && `npm run lint` — clean.
- `grep -n "require('electron')" src/main/vault/vault-store.js src/main/vault/atomic-write.js` — no matches.
- `grep -n "require('./app-db')" src/main/vault/vault-store.js` — no matches (vaults are not app.db rows).
- Manual: after a setup + save, `strings userData/vaults/*.gfvault userData/vaults/manager.json` in a test temp dir shows no plaintext password, recovery key, admin private key, or item secret.

## Implementation Guidance

1. **`atomic-write.js`** — `writeFileAtomic(destPath, buf)`: write `destPath + '.tmp-' + randomBytes(6).hex` in the **same directory**, `fs.fsyncSync(fd)` before close, then `fs.renameSync(tmp, destPath)`; best-effort `fsync` the directory fd (swallow a dir-fsync `EINVAL` — unsupported on some FS). On any error, unlink the tmp **inside its own best-effort try** (so a cleanup failure doesn't mask the original throw) and rethrow (destination untouched). Synchronous is fine (matches the store idiom). **Failure-injection test mechanism:** monkeypatch the module's `fs.renameSync` (or `fs.fsyncSync`) to throw for one call then restore, and assert the pre-existing destination bytes are intact and no `.tmp-*` file remains; or target a read-only/nonexistent dir.

2. **`manager.json` shape** (vault-store owns this format; non-secret + MRK envelopes):
   `{ format:'gfmanager', version:1, kdf:{...SCRYPT_PARAMS}, adminPublicKeyB64, mrk:{ master:<env>, recovery:<env>, admin:<env> } }` where each `<env>` is a `vault-crypto` envelope wrapping the MRK. **The MRK never appears in plaintext.** Parse strictly (typed throw on malformed/unknown-version; never quarantine).

3. **Per-vault `.gfvault`** — use `serializeVault`/`parseVault`. Envelopes: `{ keyId:'mrk', type:'mrk', ...wrapVaultKey(vaultKey, MRK, aad) }` plus any `access` envelopes. `items` = `encryptItems(itemArray, vaultKey)`. The item payload shape (Login/Card/Secure note) is defined and validated **here** (vault-crypto treats items as opaque). Document the item typedef.
   - **`mrk`-envelope AAD (required — do not pass empty):** `vault-crypto`'s internal
     `envelopeAad` is not exported, so bind a concrete, stable AAD mirroring its scheme:
     `Buffer.from('gfvault/mrk-env/v' + version)` where `version` is the **`.gfvault`
     document version** (the envelope lives there). Pass the **identical** buffer to
     `wrapVaultKey` and `unwrapVaultKey`, so a relabel/version-downgrade of the `mrk`
     envelope fails authentication — matching the tamper protection DD3 mandates for every
     other envelope. (If cleaner, add an additive `envelopeAad` export to `vault-crypto` and
     reuse it — either is acceptable; the buffer just must be identical on wrap and unwrap.)

4. **`load(userDataPath, deps)`** — `deps = { listJars, getAutoLockMinutes, onLock?, setTimeout?, clearTimeout?, now? }`. Reads `manager.json` if present (sets `isSetUp`); does NOT unlock. Store stays Electron-free; main injects `listJars = () => jars.list()`, `getAutoLockMinutes = () => settings.get('vaultAutoLockMinutes')`, and wires `app.on('before-quit', lockNow)` at the call site.

5. **Unlock state** — hold `{ mrk: Buffer|null, vaultKeys: Map<vaultId,Buffer> }`. `unlock(masterPassword)` / `unlockWithRecovery(display)` / `unlockWithAdmin(privB64)` unwrap the MRK. Vault keys unwrap lazily from their `mrk` envelope on first access and cache in the Map. `lockNow()` zeroizes every Buffer (`.fill(0)`) and clears the Map + mrk. Reset the idle timer on every operation (`touch()`).

6. **Access keys** — `mintAccessKey(vaultId, { masterPassword })`: step-up check first
   (re-unwrap the MRK master envelope with the supplied password; throw on mismatch — a
   **policy** gate, the MRK is already in memory), then `generateAccessKey()`, add an
   `access` envelope via `wrapAccess(vaultKey, secret, keyId)`, persist, return
   `{ secret, keyId }` once. Zeroize the transient step-up MRK buffer after the compare
   (`.fill(0)`). `unlockVaultWithAccessKey(vaultId, secret)`: a bare secret does not name its
   envelope, so **iterate the vault's `access` envelopes calling `unwrapAccess(env, secret)`,
   catching `VaultAuthError` and continuing** until one succeeds (return that vault key) or
   all fail (throw). Does NOT touch the MRK. `revokeAccessKey(vaultId, keyId)` removes the
   envelope by keyId and persists (immediate effect).

7. **settings-store additive key** — add to `DEFAULTS`: `vaultAutoLockMinutes: 10` with a
   comment matching the `restoreSession`/`automationEnabled` additive-key template; **also
   extend the `Settings` typedef** (settings-store.js:32–43 — `DEFAULTS` is `@type {Settings}`,
   so an un-declared key errors under `@ts-check`); add a `VALIDATORS` entry accepting an
   integer in `[1, 1440]` (the `automationPort` integer-range validator is the exact
   template; reject non-int, <1, >1440).

8. **Tests** — real temp dirs (the `settings-store.test.js` `mkdtempSync` pattern). Use a
   short/injected auto-lock timer. Cover every acceptance criterion, including: atomic-write
   crash leaves old bytes; corrupt manager/vault throws-not-quarantines; recovery-after-forgot;
   lazy jar vault recoverable by recovery+admin; burner/unknown-jar refusal; step-up wrong
   password refuses mint; access key opens only its vault; revoke is immediate; no-plaintext
   `strings` check on the written files.

## Edge Cases

- **Double setup** — `setup` on an already-set-up manager throws (no silent overwrite of `manager.json`).
- **Save to burner / unknown jar id** — refused via `listJars()` allowlist; no file created.
- **Unlock before setup** — typed "not set up" error.
- **Auto-lock while an operation is mid-flight** — timer resets on operation entry (`touch`), so an active session doesn't lock under the operator.
- **Corrupt/truncated file** — typed throw, never quarantine/recreate (the load-loudly rule; the anti-`app.db` behavior).
- **`vaultAutoLockMinutes` out of bounds or non-integer** — `settings-store.set` throws (strict validator), consistent with existing keys.
- **fsync unsupported on the dir** (some FS) — best-effort; the file-level fsync + rename still gives atomicity; don't hard-fail on a dir-fsync `EINVAL`.
- **Empty vault (no items yet)** — encrypts an empty item array cleanly.

## Files Affected

- `src/main/vault/vault-store.js` — **new**.
- `src/main/vault/atomic-write.js` — **new** (or inlined).
- `test/unit/vault-store.test.js` — **new**.
- `test/unit/vault-atomic-write.test.js` — **new** (if factored out).
- `src/main/settings-store.js` — **modified**: additive `vaultAutoLockMinutes` key + validator.
- `missions/12-password-manager/flights/01-vault-core-and-automation/flight-log.md` — leg progress entry.

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[COMPLETE:leg]`:**

- [ ] All acceptance criteria verified
- [ ] Tests passing (new suites + full `npm test`), typecheck + lint clean
- [ ] Update flight-log.md with the leg progress entry (note the MRK composition as built)
- [ ] Set this leg's status to `landed` (orchestrator batch-commits at flight end)
- [ ] Do NOT check off the leg in flight.md, do NOT commit (deferred-commit model)

---

## Citation Audit

Citations verified against current code at leg design time:
`vault-crypto.js` exports (`wrapMaster`/`wrapVaultKey`/`wrapAccess`/`sealToAdmin`/… —
confirmed present in `module.exports`, Leg 1 landed); `settings-store.js` `DEFAULTS` +
`VALIDATORS` + `load(userDataPath)` (verified, `restoreSession` strict-boolean template);
`app-lifecycle.js:registerAppLifecycle` `before-quit`/`will-quit` (verified);
`persist-jar-gate.js:resolvePersistJar` (verified — exact allowlist expression);
`jars.js:list` (verified present). No `file:line` bare citations; no drift found.
