# Leg: vault-upgrade

**Status**: completed
**Flight**: [Vault and Automation Boundary](../flight.md)

## Objective

Convert every existing version-1 vault file to version 2 the first time the master key is in hand — in one verified, journalled transaction that can be undone and can never block an unlock or lose an item.

## Context

- Flight DD6, last leg. This is the **only** leg of the flight that rewrites an operator's existing data, and the step an older build cannot undo. Leg `vault-format-v2` made new files and bundles version 2 and proved that a profile holding both versions works; this leg removes the version-1 files.
- Mission constraint: **no vault data loss**. Read `vault-format-recon.md` first.
- **Where it runs.** `_installMrk` (`src/main/vault/vault-store.js`) is the one point every master-key unlock passes — `unlock`, `unlockWithRecovery`, `unlockWithAdmin`, `recoverMasterPassword`, compromise rotation (after its commit) and adopt (`_adoptManagerCore`, after the vault files and the manager are written). It does, in order: reset cached keys, set the master key, bump the generation, new key cache, `_touch()` (arms the idle timer), `onUnlock`. `setup` installs the key directly and its files are born version 2. `changeMasterPassword`, `rotateRecovery` and `rotateAdminKey` act on an already-unlocked store. Automation's admin-key and access-key paths never install a master key, so automation-only use never upgrades — and does not need to.
- **It is synchronous.** Vault crypto here is Node's synchronous AES-GCM; no key derivation is needed (the master key is already in hand). So the whole upgrade is one synchronous block: nothing can interleave with it. Cost is dominated by `fsync`s — a journal and one staged file per vault — tens of milliseconds per vault on a slow disk, after a key derivation that already took far longer.
- **The transaction** (`src/main/vault/vault-txn.js`): `beginTransaction(dir, members)` writes the journal, then each staged file (fsynced); `commit` renames the journal to its committed name (the discriminator), then renames each staged file into place; `recover(dir)` rolls an uncommitted journal back and a committed one forward, and runs at every store construction. Members may be vault files only. `beginTransaction` **refuses while any journal exists** — and compromise rotation uses the same call, so a journal left behind by a failed upgrade would block rotation until restart. Transaction writes bypass `_writeVault` and its re-key guard.
- **Compromise rotation calls `_installMrk` while its re-key gate is still up**; by then every file is version 2. The upgrade's gate check must therefore skip **silently** there.
- **The danger this leg is built around**: a mistake in choosing the id a file is bound to. Verification that reuses the builder's own id would pass, and after restart every vault would be unreadable. So the id used to verify must come from somewhere else each time, and there must be an undo.
- **No persistent backup** (design review, adopted): a kept copy of a version-1 file retains the old access envelopes and the old wrapped key — a revoked access key would still open it, compromise rotation would not enumerate it, and it is exactly the swap material the binding exists to retire. The safety net is verification at three points plus an in-memory undo, and an operator's own copy of the vaults directory before first unlock (release notes).
- **The stated limit** (flight Q6, unchanged): the binding protects files written from this version on. A kept **old version-1 copy** of one vault can still be placed in another vault's slot, where it opens and is upgraded there. An authenticated "this profile is version 2" marker was considered again at design review and rejected: the manager is untouched by the upgrade (re-authenticating it needs the password, which recovery and admin unlocks do not have), and any marker lives in a file an attacker can roll back with the rest.
- Budgets: none of the budgeted files is touched.

## Inputs

- Leg `vault-format-v2` landed: version 2 written for new files; a mixed profile works; the version-1 oracle helper; the released-commit generator script in the scratchpad (and, if the operator approved it, the inline known-answer vector).
- The store's log seam from leg `vault-binding`.

## Acceptance Criteria

**The upgrade**

- [ ] **AC1 — A pure builder and a thin, guarded caller.** `buildUpgrade(input)` takes, per vault, the slot id and the file's bytes plus the master key, and returns rebuilt version-2 documents and a skipped list with reason codes — per-file `try`, no early return inside the loop, no I/O. For each version-1 file: unwrap the vault key under the master key (version-1 AAD), decrypt the items, re-encrypt them and re-wrap the key under the version-2 AADs **for the slot id**, carry every access envelope **verbatim and in order**, keep the informational `kdf`. It does not use `_vaultKeyFromDoc` (which caches keys); every working key buffer is zeroized in a `finally`. The caller, inside `_installMrk` after the new key cache is created and **before** `_touch()` and `onUnlock`, does the I/O. It awaits nothing: pinned by a test that the call returns a non-promise and by a source scan that neither function contains `await`.
- [ ] **AC2 — Which files.** Ids come from the jar registry plus the global id, in their registry spelling; a file on disk is included only if its name equals exactly the path the store would compute for that id (`_vaultPath(id)`). A stray `.gfvault` whose name matches no registered id is **left alone** — never bound, never deleted — and logged once. Files already version 2 are skipped by reading only the parsed version (no decrypt); if nothing needs converting, **no transaction is begun and nothing is written** (assert no file's bytes or mtime change on a second unlock).
- [ ] **AC3 — Verified three times, from three sources of the id.**
  - (a) **In memory, before staging**: each rebuilt document is parsed and decrypted back; plaintext items deep-equal the originals; the access-envelope set is byte-identical to the source's, by key id and order.
  - (b) **From the staged bytes on disk, before commit**: after `beginTransaction`, read each staged file back, derive the slot id from the journal member's **final file name** (not from the builder's variable), and run the ordinary reader's steps — `parseVault`, unwrap the key envelope, decrypt the items — with explicit `(2, thatId)`. Any failure → `recover(dir)` (the journal is uncommitted: rolled back, nothing renamed).
  - (c) **After commit, through the real reader**: `_readVault(registryId)` plus unwrap and decrypt for every upgraded id, taking ids from the registry again. The original version-1 file bytes are held in memory (ciphertext only) until this passes; if it fails for any file, a second journalled transaction writes **all** the originals back, the failure is logged, and the profile is exactly as it was.
- [ ] **AC4 — Never blocks an unlock, never strands a journal.** The entire upgrade is inside one `try` / `catch`; a throw can never reject `unlock`, `unlockWithRecovery`, `unlockWithAdmin`, `recoverMasterPassword` or adopt. On any throw after the journal exists: if the transaction handle is committed, `recover` rolls forward and the upgrade is treated as done; otherwise `recover` rolls back. Each of these leaves the unlock successful, the profile readable, and **no journal behind** — and a compromise rotation in the same process afterwards succeeds (tested): one vault file corrupt, missing, or not unwrapping under this master key (skipped; the rest upgraded; the bad one still fails with its own error when used); a stage write failing (disk full); a read-only vaults directory; `beginTransaction` throwing; a journal already present; the re-key gate up (skipped **silently**, no log). Everything else is logged **once per id per process** with a reason code and the id — never an item, a title, a path or a key — and retried at the next unlock (test: clear the condition, unlock again, upgraded).
- [ ] **AC5 — From the real trigger, through a restart.** Using the version-1 oracle (and the released-commit generator's profile where the test harness can read it): a profile of a global vault and two jar vaults, with an access key on one and an admin key provisioned → construct a store, `unlock` → every file version 2 → **construct a fresh store on the same directory** (a restart), unlock, and list every vault: every item deep-equals the original (card, identity, one-time-code secret, `confirmedOrigins` included); the manager is byte-for-byte unchanged; no journal or temp file remains; the access key still opens its vault and reads its items; the admin key still opens every vault; minting a second access key and revoking the first work. Repeated with the first unlock being `unlockWithRecovery`, `unlockWithAdmin`, and `recoverMasterPassword`.
- [ ] **AC6 — Crash safety.** With the transaction suite's interruption technique: interrupted before the commit marker → a fresh store finds every file version 1 and readable, and its next unlock upgrades; interrupted after the marker → a fresh store (whose constructor runs `recover`) finds every file version 2 and readable. No interruption point leaves any vault unreadable.
- [ ] **AC7 — The worst case is caught.** A test injects a wrong id into the builder (through a seam on the function that chooses it): verification (b) rejects it and nothing is renamed. A second test injects a fault that only the real reader can see (verification (c)): the originals are restored and the profile is as before. A third corrupts one rebuilt document in memory: (a) rejects it, nothing is staged.
- [ ] **AC8 — It composes with everything that installs a key.** Compromise rotation on a version-1 profile: unlock upgrades first, rotation then sees version 2, its final `_installMrk` skips silently, one transaction each, interruption matrix green. Adopt into a directory holding version-1 residue from an earlier failed adopt: residue under the same master key is upgraded, residue under another key does not unwrap and is skipped. A version-1 file whose own `vaultId` field disagrees with its slot (logged by leg `vault-binding`'s diagnostic) is upgraded like any other and bound to its slot — it opens as that slot today, so nothing changes; a test states this as the documented limit.
- [ ] **AC9 — Automation is unaffected.** A session that opened a vault with an access key before the upgrade reads it after: its key is unchanged and `readVaultItems` re-reads the file each call at the file's own version. Tested by holding a key across an upgrade.

**Docs, live, gates**

- [ ] **AC10 — Docs.** `docs/vault.md`: the upgrade — when it runs, one transaction, verified before and after, undone on failure, never blocks an unlock, what is skipped and that a skipped file stays version 1 and usable; **the limit in plain words** (an old version-1 copy of a vault can still be placed in another slot and will be opened and upgraded there; an older copy of the same vault is not detected); that no backup is kept and why. `docs/RELEASING.md`: a release-note line for the first release carrying this — after the first unlock on this version, vault files cannot be opened by an earlier version, and neither can a bundle exported by this version; **the only way back is a copy of the vaults directory made before that first unlock** — say where the directory is per platform. `CLAUDE.md`: the vault section (version 2, the upgrade at `_installMrk`, "a stray vault file is never bound or deleted").
- [ ] **AC11 — Live, nobody typing the operator's master password.** (i) A real boot of a **copy** of the operator's dev profile: starts, vault set-up and locked, **no file in the copy's vaults directory changes while locked** (hashes before launch and after quit). (ii) With the released-commit generator's profile and its throwaway password, a Node script using the store module from this tree: hash the vaults directory, `unlock`, hash again (every vault file changed, the manager unchanged), build a fresh store, unlock, compare every item with what the generator wrote; then unlock a third time and confirm nothing is rewritten. Its output goes in the flight log. The upgrade of the operator's real profile is a HAT step, performed by the operator on a copy first, after copying the vaults directory aside.
- [ ] **AC12 — Gates.** `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check` pass; the vault suites also under Electron's own Node. Report the vault suites' wall time before and after.

## Verification Steps

- AC1–AC9: a new `test/unit/vault-upgrade.test.js` on real temp directories with fast parameters, using the oracle helper; `vault-txn.test.js`'s interruption technique for AC6; additions to `vault-compromise-rotate.test.js`, `vault-export-import.test.js` (adopt residue) and `vault-context.test.js`.
- AC10: read by the Flight Director. AC11: hashes and script output in the flight log.

## Implementation Guidance

1. The builder and its unit tests (pure; no disk).
2. Verification (a); then the caller with the gate, journal and re-key checks; then (b) on staged bytes; then commit; then (c) and the undo.
3. The failure matrix (AC4), crash safety (AC6), the worst-case injections (AC7).
4. Composition tests (AC8, AC9). Docs. Live checks.
5. Do not commit. Leg `landed`, flight log entry, `[LAND:leg]`.

## Edge Cases

- **Unlock with a wrong password**: no master key, no attempt, no log line.
- **A jar with no vault file**: nothing to do.
- **The same unreadable file at every unlock**: logged once per process, not once per unlock.
- **An unlock that happens while a previous upgrade's undo transaction left a journal** (it should not — the undo runs `recover` on failure too): the "journal present" branch — `recover`, skip this time.
- **The vaults directory on a filesystem that is case-insensitive**: AC2's exact-name rule means a file is bound only under the spelling the reader will ask for.
- **Disk full during the undo**: the originals are still in memory for the process's life; log loudly with the ids; the committed version-2 files remain (they passed (a) and (b)); do not loop.
- **If any version-1 fixture — oracle, generated, or the inline vector — cannot be upgraded and read back**: stop. `[BLOCKED:vault-upgrade-<reason>]` with the fixture and the error. This is the flight's Divert condition.

## Files Affected

- `src/main/vault/vault-store.js` (builder, caller, id seam); possibly a small new module beside it for the builder.
- `test/unit/vault-upgrade.test.js` (new) and the suites named above.
- `docs/vault.md`, `docs/RELEASING.md`, `CLAUDE.md`.

## Citation Audit

From `vault-format-recon.md` and the Developer design review of the original combined leg (Sonnet, 2026-11-14), which read `vault-txn.js` in full and traced every caller of `_installMrk`: approve with changes, adopted — verification must also run on the **staged bytes** with an id taken from the journal's file name, and again after commit through the real reader with ids from the registry, with the originals held in memory for an undo; a failed upgrade must run `recover` or it strands a journal that blocks compromise rotation; the gate-up skip during rotation must be silent; no persistent backup, for the reasons given; ids bound only under their exact registry spelling, strays left alone; a per-process once-only log; keys zeroized; the fast path parses only. `_installMrk`'s order and callers, `setup` installing directly, the transaction's refusal while a journal exists, and rotation's `handle.committed` recovery branch were verified by that review.

---

## Post-Completion Checklist

Completion steps — status transitions, flight-log update, checking off in the parent flight, and commit — are Flight Control protocol, driven by the execution workflow. Not repeated here.
