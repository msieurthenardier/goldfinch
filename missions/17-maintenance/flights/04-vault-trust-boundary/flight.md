# Flight: Vault Trust-Boundary Hardening

**Status**: completed
**Mission**: [Codebase Health — 2026-08-27 Maintenance](../../mission.md)

## Contributing to Criteria

- [x] KDF params validated on read with a ruled legacy policy; fresh adopt forces rotation (criterion 6)

---

## Pre-Flight

### Objective

Stop the vault store trusting two things it shouldn't on its read paths:
its own `manager.json`'s KDF parameters, and a donor bundle's recovery key
and admin seal on a fresh-profile adopt.

### Open Questions

- [x] F2: on encountering out-of-bounds KDF params in an existing
      `manager.json` — refuse to open or repair on unlock? **Ruled: fail
      closed** (see DD1). No legitimately-written manager is ever
      out-of-bounds, so there is no installed base to repair.
- [x] F8: forced rotation UX after a fresh adopt — silent one-time sheets
      or an explicit step? **Ruled: forced, surfaced through the existing
      one-time sheets** (see DD3), rotated inline under the live MRK (DD2).

### Design Decisions

*(Ruled at flight design 2026-08-29; see flight log Flight Director Notes
for the code recon that grounds each call.)*

**DD1 — F2 policy: fail closed, no repair, no migration.** Call
`validateImportedKdf(doc.kdf)` from `_readManager`
(`src/main/vault/vault-store.js:355`, right after the existing
`typeof doc.kdf === 'object'` check at `:375`); out-of-bounds params throw
`VaultFormatError` and the manager refuses to open. Rationale: `setup()`
(`:583`) is the sole writer of `manager.json`'s `kdf`, and it writes
`vc.SCRYPT_PARAMS` (N=2¹⁷, r=8, p=2, maxmem=192 MiB —
`vault-crypto.js:52`), which sits well inside `validateImportedKdf`'s
bounds (`:215`: N∈[2¹²,2²¹] & power-of-two, r∈[1,32], p∈[1,16],
maxmem∈[128·N·r, 512 MiB]). So no legitimately-written manager is ever
out-of-bounds — the only source of out-of-bounds params is vault-file
tampering, which is exactly the F2 attack (a silent KDF downgrade on the
un-step-up-gated recovery path `:868`; an absurd `N` hangs/OOMs main). The
user recovers by re-importing from a trusted bundle (import already
validates kdf, `:1002`). Repair-on-unlock is rejected: it needs its own
step-up design and re-wraps under attacker-adjacent conditions, for an
installed base that does not exist.

**DD2 — F8 mechanism: rotate inline under the live MRK, not via the
public step-up functions.** The spec's literal "force `rotateRecovery` +
`rotateAdminKey`" is **not callable as written**: both public functions
(`:790`, `:832`) require a master-password step-up (they re-unwrap the
master envelope), but a fresh adopt via `secretKind: 'recovery'` supplies
only the recovery string and has no master password. The fresh-adopt
branch (`importVault`, `:1050` region) already holds a live, authenticated
`mrk`, so rotation is done inline there under that MRK — re-mint recovery
(`vc.generateRecoveryKey` + `vc.wrapRecovery`) and admin
(`vc.generateAdminKeypair` + `vc.sealToAdmin`, overwriting
`adminPublicKeyB64`) and write those fresh envelopes into the adopted
manager **instead of** the donor's `bundle.mrk.recovery` /
`bundle.mrk.admin`. No step-up (the adopt itself authenticated); works
identically for master-adopt and recovery-adopt. The step-up-gated public
functions remain the path for a *later* operator-initiated rotation.

**DD3 — F8 UX: forced, one-time sheets.** Rotation is non-skippable — it
is the trust boundary, not an option. The new recovery display and admin
private key are one-time secrets and are surfaced once through the
existing one-time sheets (`vault-recovery-template.js`,
`vault-adminkey-template.js`), exactly as `setup()` surfaces them. This
means the fresh-adopt path must return the two new secrets so the handler
can drive those sheets — a change to `importVault`'s fresh-path return
shape (see DD2's leg). No "rotate now?" prompt.

**DD4 — Scope boundary: the donor's MASTER envelope is a documented
residual, not fixed here.** Rotating recovery + admin does not sever the
donor's master password — the adopted `manager.mrk.master` is still the
donor's envelope, unwrappable by the donor's master password. Severing
that is a master-password change (re-wrap, distinct from MRK re-key / F6),
and it is **out of this flight's scope** (operator ruling 2026-08-29): the
flight's objective is the recovery key and admin seal. The residual is
documented in `docs/vault.md` (read-path + adopt section) and flagged as a
candidate for the F6 / compromise-mode backlog mission. Expanding F8 to a
forced master reset is explicitly declined (extra UX; the recovery-adopt
path has no existing password to change from; overlaps F6).

### Prerequisites

- [x] Maintenance report 2026-08-27, findings F2 and F8
- [x] Security Reviewer's verified-OK baseline for the crypto core (report
      F11) — this flight changes trust decisions, not primitives

### Pre-Flight Checklist

- [x] The two open questions ruled before leg 1 (DD1–DD4)
- Other items N/A — maintenance flight.

---

## In-Flight

### Technical Approach

**F2 — validate KDF params on read.** `vault-store.js:378-380` checks only
`typeof doc.kdf === 'object'`; the params feed scrypt at `:666, :755,
:786, :825, :871, :1577`. `validateImportedKdf` (`:216`) bounds them but
is called only on import (`:975`). With vault-file write access an
attacker sets test-grade params; the recovery path (`:871`) has no
step-up gating it and permanently re-wraps the master envelope under the
weak params — a silent KDF downgrade; an absurd `N` hangs or OOMs the main
process. Call `validateImportedKdf` from `_readManager`, apply the ruled
legacy policy, and pin with a unit truth table (in-bounds, each bound
exceeded, non-numeric) plus a guard that the recovery path cannot proceed
under rejected params.

**F8 — fresh adopt inherits the donor's keys.** `vault-store.js:1023-1033`
writes `bundle.mrk.recovery` / `bundle.mrk.admin` verbatim as the new
profile's manager; the donor retains a recovery key and admin private key
into the adopted vault, and (F6) rotation never re-keys the MRK. After a
fresh adopt, force `rotateRecovery` + `rotateAdminKey` (existing
functions, `:792`, `:829`) before the profile is usable, surfacing the new
keys through the existing one-time sheets (`vault-recovery-template.js`,
`vault-adminkey-template.js`). Pin: a unit test that adopts a bundle and
asserts neither donor envelope survives in the written manager.

Out of scope, by ruling: MRK re-key / compromise-mode rotation (backlog
mission — inverts the single-slot rotation invariant); anti-rollback AAD
binding (F7 — a format migration); MCP rate limiting (F4).

### Checkpoints

- [x] CP1: out-of-bounds `manager.json` refused/repaired per ruling, no
      hang, unit-pinned
- [x] CP2: fresh adopt → both envelopes rotated, new keys shown once
- [x] CP3: existing vault behavior specs (fill/capture, import/export)
      re-run green; suite/typecheck/lint green

### Adaptation Criteria

**Divert if**: the legacy-params question surfaces a real installed base
with out-of-bounds params (then repair-on-unlock needs its own design and
a migration note in `docs/vault.md`).

**Acceptable variations**: bounding `N`/`r`/`p` with a wider ceiling than
import uses if a documented reason exists.

### Legs

- [x] `kdf-params-validated-on-read` - F2 *(landed 2026-08-29)*
- [x] `fresh-adopt-forces-rotation` - F8 store rotation + fresh-path return shape + store-level tests
- [x] `surface-adopted-keys` - F8 UI: reveal the two rotated one-time keys via the register-overlay-ipc seam, sequential recovery→admin chain, lockout-window guard *(divert 2026-08-29 — see log)*
- [x] `vault-docs` - docs/vault.md (read-path + adopt + DD4 residual) + squawk 0022 threat bullet (shared-surface, LOW)

---

## Post-Flight

### Completion Checklist

- [x] All legs completed
- [x] Code merged
- [x] Tests passing
- [x] Documentation updated (`docs/vault.md` read-path validation + adopt behaviour; squawk 0022's threat-model bullet if not already landed)

### Verification

Unit truth tables for both read paths; the vault import/export and
fill/capture behavior specs re-run on the shipped build.
