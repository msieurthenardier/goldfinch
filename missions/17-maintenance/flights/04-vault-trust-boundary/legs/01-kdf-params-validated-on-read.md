# Leg: kdf-params-validated-on-read

**Status**: landed
**Flight**: [Vault Trust-Boundary Hardening](../flight.md)
**Finding**: F2 (maintenance report 2026-08-27)
**Risk tier**: HIGH — security-sensitive crypto trust decision on the
`_readManager` choke point that every unlock / rotate / recover / export
read path funnels through.

## Objective

Make `manager.json`'s KDF parameters validated on **read**, failing closed
(DD1): `_readManager` calls `validateImportedKdf(doc.kdf)` so an
out-of-bounds `kdf` makes the manager refuse to open with a
`VaultFormatError`, at every read path. No repair, no migration — per DD1,
`setup()` is the sole writer of `manager.json.kdf` and always writes
in-bounds `vc.SCRYPT_PARAMS`, so the only source of out-of-bounds params is
vault-file tampering, which is exactly the F2 attack (silent KDF downgrade
on the un-step-up-gated recovery path; absurd `N` hangs/OOMs main).

## Context (current code, verified 2026-08-29)

- `_readManager()` — `src/main/vault/vault-store.js:355`. Validates
  `format`, `version`, `typeof doc.kdf === 'object'` (`:375`),
  `adminPublicKeyB64`, and the three mrk envelope shapes. It does **not**
  bound the kdf params. Returns `doc`.
- `validateImportedKdf(kdf)` — `:215`. Throws `vc.VaultFormatError` on:
  non-object; `algo !== 'scrypt'`; `N` not power-of-two or ∉ [2¹²,2²¹];
  `r` ∉ [1,32]; `p` ∉ [1,16]; `maxmem` < 128·N·r or > 512 MiB. Currently
  called only from the import path (`importVault`, `:1002`).
- `_readManager` is the choke point — called at 12 sites — `:325` (eager load-loudly
  in the constructor when `manager.json` exists), and by `unlock` /
  `rotateRecovery` (`:797`) / `rotateAdminKey` (`:839`) /
  `recoverMasterPassword` (`:876`) / export (`:923`) / etc. Validating
  here covers all read paths in one place.
- The F2-named silent-downgrade vector: `recoverMasterPassword` (`:868`)
  has no master-password step-up; it re-unwraps and permanently re-wraps
  `manager.mrk.master` under `manager.kdf`. If `manager.kdf` were
  attacker-lowered, this path would silently downgrade the master
  envelope's KDF. Validating in `_readManager` blocks it before any write.
- Test harness: `test/unit/vault-store.test.js` builds stores via
  `makeStore(dir)` → `vs.load(dir, { scryptParams: FAST_SCRYPT, ... })`
  with `FAST_SCRYPT = { algo:'scrypt', N: 2**12, r: 8, p: 1, maxmem: 64
  MiB }` — **in-bounds**, so setup-written managers pass the new check.
  `managerPath(dir)` = `<dir>/vaults/manager.json`. Every `FAST_SCRYPT`
  variant across the suite (N ∈ {2¹²,2¹⁴}, r=8, p=1, maxmem 64 MiB) is
  in-bounds — the change breaks no existing test.

## Acceptance Criteria

1. **Validation added at the choke point.** `_readManager`
   (`src/main/vault/vault-store.js:355`) calls `validateImportedKdf(doc.kdf)`
   immediately after the existing `typeof doc.kdf === 'object'` guard
   (`:375`). No other read path adds its own kdf check (single source of
   truth). A brief comment cites DD1 (M17 F4) as the provenance.
2. **Truth-table unit test** (new file
   `test/unit/vault-store-kdf-read-validation.test.js`, or an added block
   in `vault-store.test.js` — implementer's call): construct a valid
   manager via `setup()` (FAST_SCRYPT), then rewrite `manager.json`'s `kdf`
   to each of these and assert `vs.load(...)` (which eagerly calls
   `_readManager` at `:325`) throws `vc.VaultFormatError`:
   - `N` below min (2¹¹), above max (2²²), not a power of two (100000),
     non-numeric (`"big"`);
   - `r` above max (33) and below min (0); `p` above max (17) and below
     min (0);
   - `maxmem` below `128·N·r` and non-integer. **Note**: the floor is
     relative to the *tampered doc's* N — for FAST_SCRYPT (N=2¹², r=8) the
     floor is 128·4096·8 = 4 MiB, so pick a value below 4 MiB, not below
     the production 192 MiB. Also test `maxmem` above 512 MiB.
   - `algo` not `'scrypt'`;
   - **an array-valued `kdf` (`kdf: []`)** — this is the row that actually
     reaches the NEW `validateImportedKdf(doc.kdf)` call, since `typeof []
     === 'object'` slips past the pre-existing `:375` guard. (By contrast a
     missing/`null` `kdf` is caught by the OLD `:375` guard, not the new
     call — still `VaultFormatError`, still fail-closed, but it does not pin
     AC1's new line. Include a missing-kdf row too, understanding it pins
     the older guard.)
   And assert the in-bounds FAST_SCRYPT manager (untampered) still loads.
3. **Recovery-path fail-closed guard.** A test that: sets up a valid vault,
   tampers `manager.json.kdf.N` out of bounds, then calls
   `recoverMasterPassword({ recoveryDisplay, newMasterPassword })` and
   asserts it rejects with `vc.VaultFormatError` **and writes nothing** —
   the pre-tamper `manager.mrk.master` bytes are unchanged on disk (the
   silent-KDF-downgrade attack is blocked before any write). Since
   `recoverMasterPassword` calls `_readManager` first (`:876`), validation
   throws before the re-wrap. (This also demonstrates "no hang/OOM": an
   absurd `N` is rejected before it can reach scrypt.) **Trigger note**:
   tamper the file and call `recoverMasterPassword` on the ALREADY-LOADED
   instance — do not construct a fresh store afterward, or it would throw at
   the eager load (`:325`) instead of at the recovery call, passing the
   assertion without exercising the recovery path. (AC2, by contrast,
   deliberately triggers via the eager load on a freshly-constructed store.)
4. **No regression.** `npm test` (canonical — globs `test/unit/*.test.js`)
   stays green with the new tests; `npm run typecheck`, `npx eslint .`,
   `npx prettier --check .` all clean. (Cite `npm test` counts before and
   after; note the bare `node --test` figure is higher only because it
   also sweeps `test/helpers/*.js` — runner scope, not a regression.)

## Verification

- AC1: `grep -n "validateImportedKdf(doc.kdf)" src/main/vault/vault-store.js`
  shows the call inside `_readManager`; read the surrounding lines to
  confirm placement after the `typeof doc.kdf` guard.
- AC2/AC3: run the new test file in isolation
  (`node --test test/unit/vault-store-kdf-read-validation.test.js`) — all
  green; temporarily comment out the AC1 call and confirm the truth-table
  and recovery-guard tests go RED (proving they pin the new behavior),
  then restore.
- AC4: `npm test` green pre/post; `npm run typecheck && npx eslint . &&
  npx prettier --check .` clean.

## Out of Scope

- The F8 fresh-adopt rotation (Leg 2).
- Repair-on-unlock (rejected by DD1).
- Any change to `validateImportedKdf`'s bounds or to the import path.
- The donor master-envelope residual (DD4) — documented in Leg 3 (docs).

## Citation Audit

Verified 2026-08-29 against `src/main/vault/vault-store.js` (1812 lines) and
`vault-crypto.js`: `_readManager`:355, kdf guard:375, `validateImportedKdf`:215,
import call:1002, eager load:325, `recoverMasterPassword`:868/876,
`rotateRecovery`:790/797, `rotateAdminKey`:832/839, export `_readManager`:923.
`SCRYPT_PARAMS` (N=2¹⁷,r=8,p=2,maxmem 192 MiB) at `vault-crypto.js:52` — in
bounds. All current; the flight-spec Technical Approach retains pre-drift
numbers as its original snapshot (see flight log).
