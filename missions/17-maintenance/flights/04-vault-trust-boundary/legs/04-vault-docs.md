# Leg: vault-docs

**Status**: landed
**Flight**: [Vault Trust-Boundary Hardening](../flight.md)
**Finding**: F2 + F8 documentation (shared-surface: both land in `docs/vault.md`)
**Risk tier**: LOW — additive documentation, single file, established doc
patterns. No design review; straight to implementation. The flight-end
Reviewer still covers it.
**Depends on**: Legs 1–3 (documents their shipped behavior).

## Objective

Update `docs/vault.md` so the vault architecture doc reflects the two
trust-boundary changes this flight ships — KDF params validated on READ
(F2, fail-closed), and fresh-adopt forced recovery+admin rotation with the
donor MASTER-envelope residual stated plainly (F8 / DD4). One shared-surface
docs pass rather than splitting the doc edits across the two code legs.

## Context (current doc, verified 2026-08-29)

- `docs/vault.md` — 372+ lines. Relevant sections: `## On-disk format`
  (`:46`) with the "Load-loudly, never quarantine" note (`:97`);
  `## Portability` (`:312`); `## Rotation & recovery` (`:340`);
  `## Threat model` (`:372`) with the "does NOT protect against" list
  (`:426-433`), whose neighbor bullet **"A party that already extracted the
  MRK"** (`:432`) is the natural sibling for the DD4 residual.
- **Squawk 0022 is already completed** — the "already-extracted MRK survives
  rotation" bullet (`:432`) is already present. This leg does NOT re-add it;
  it verifies presence and places the DD4 residual bullet beside it. (The
  flight Post-Flight note "if not already landed" resolves to: already landed.)
- Shipped behavior to document (from this flight's landed legs):
  - **Leg 1 (F2)**: `_readManager` now calls `validateImportedKdf(doc.kdf)`
    — out-of-bounds KDF params refuse to open, fail-closed, on every read
    path (not just import). No repair, no migration (setup only ever writes
    in-bounds params).
  - **Legs 2–3 (F8)**: a fresh-profile adopt forces rotation of the recovery
    key and admin keypair (inline under the live MRK, no step-up), so the
    donor retains neither the recovery key nor the admin private key into the
    adopted vault; the two new one-time keys are surfaced once (recovery then
    admin) and the profile stays unlocked until both are acknowledged.
  - **DD4 residual**: adopt does NOT rotate the donor's MASTER envelope — the
    donor's master password still unwraps the adopted vault. Severing that is
    a master-password change (distinct from MRK re-key / F6), deferred to the
    compromise-mode backlog.

## Acceptance Criteria

1. **Read-path KDF validation documented.** The "Load-loudly, never
   quarantine" note (`docs/vault.md:97`) — or the on-disk-format kdf
   description (`:51-57`) — states that `manager.json`'s KDF params are
   validated against sane bounds on READ (every unlock/rotate/recover/export
   path, via `_readManager`), and out-of-bounds params refuse to open
   (fail-closed); recovery is by re-importing from a trusted bundle. Names
   this closes the silent-KDF-downgrade vector (an attacker-lowered `N` on
   the un-step-up-gated recovery path).
2. **Fresh-adopt forced rotation documented.** `## Portability` (`:312`)
   and/or `## Rotation & recovery` (`:340`) states that a fresh-profile
   adopt forces recovery + admin rotation before the profile is usable, so
   the donor cannot retain recovery/admin access; the two new one-time keys
   are shown once (recovery, then admin after the recovery key is
   acknowledged), and the profile stays unlocked until both are acknowledged.
3. **DD4 master-residual stated plainly in the threat model.** A new bullet
   in the "does NOT protect against" list (beside `:432`) states: a
   fresh-profile adopt rotates the recovery key and admin key but NOT the
   donor's master envelope — the donor's master password still unwraps the
   adopted vault; fully severing it is a master-password change (compromise-
   mode backlog), not done by adopt.
4. **Squawk 0022 bullet verified present** (not re-added) — note it in the
   flight-log entry.
5. **No stale claims.** Any existing sentence that implies adopt copies the
   donor's manager verbatim, or that KDF params are validated only on import,
   is corrected. (Grep the doc for "import" / "adopt" / "verbatim" and
   reconcile.)
6. **Clean.** `npx prettier --check .` clean (docs/vault.md formatted);
   `npm run typecheck` and `npx eslint .` clean (no code touched, but run
   them to confirm the tree is green). No source/test edits in this leg.

## Verification

- Read the edited sections; confirm ACs 1–3 present and accurate against the
  shipped code, AC4 verified, AC5 reconciled.
- `npx prettier --check docs/vault.md` clean.

## Out of Scope

- Any source or test change (Legs 1–3 own those).
- Re-adding the squawk 0022 bullet (already present).
- Documenting compromise-mode / MRK re-key beyond naming it as backlog.

## Citation Audit

Verified 2026-08-29 against `docs/vault.md`: On-disk format `:46`, load-loudly
`:97`, kdf field `:51-57`, Portability `:312`, Rotation & recovery `:340`,
Threat model `:372`, non-protections list `:426-433`, MRK-survival bullet
`:432` (squawk 0022, present). All current.
