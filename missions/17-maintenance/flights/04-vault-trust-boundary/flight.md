# Flight: Vault Trust-Boundary Hardening

**Status**: ready
**Mission**: [Codebase Health — 2026-08-27 Maintenance](../../mission.md)

## Contributing to Criteria

- [ ] KDF params validated on read with a ruled legacy policy; fresh adopt forces rotation (criterion 6)

---

## Pre-Flight

### Objective

Stop the vault store trusting two things it shouldn't on its read paths:
its own `manager.json`'s KDF parameters, and a donor bundle's recovery key
and admin seal on a fresh-profile adopt.

### Open Questions

- [ ] F2: on encountering out-of-bounds KDF params in an existing
      `manager.json` — refuse to open (fail closed, user re-imports from
      a bundle) or repair by re-wrapping under sane params at next
      successful unlock? Any legitimately-written legacy manager with
      params outside `validateImportedKdf`'s bounds?
- [ ] F8: forced rotation UX after a fresh adopt — silent (new keys shown
      once, as the existing one-time sheets do) or an explicit step?

### Design Decisions

*(to be written at flight design)*

### Prerequisites

- [x] Maintenance report 2026-08-27, findings F2 and F8
- [x] Security Reviewer's verified-OK baseline for the crypto core (report
      F11) — this flight changes trust decisions, not primitives

### Pre-Flight Checklist

- [ ] The two open questions ruled before leg 1
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

- [ ] CP1: out-of-bounds `manager.json` refused/repaired per ruling, no
      hang, unit-pinned
- [ ] CP2: fresh adopt → both envelopes rotated, new keys shown once
- [ ] CP3: existing vault behavior specs (fill/capture, import/export)
      re-run green; suite/typecheck/lint green

### Adaptation Criteria

**Divert if**: the legacy-params question surfaces a real installed base
with out-of-bounds params (then repair-on-unlock needs its own design and
a migration note in `docs/vault.md`).

**Acceptable variations**: bounding `N`/`r`/`p` with a wider ceiling than
import uses if a documented reason exists.

### Legs

- [ ] `kdf-params-validated-on-read` - F2
- [ ] `fresh-adopt-forces-rotation` - F8

---

## Post-Flight

### Completion Checklist

- [ ] All legs completed
- [ ] Code merged
- [ ] Tests passing
- [ ] Documentation updated (`docs/vault.md` read-path validation + adopt behaviour; squawk 0022's threat-model bullet if not already landed)

### Verification

Unit truth tables for both read paths; the vault import/export and
fill/capture behavior specs re-run on the shipped build.
