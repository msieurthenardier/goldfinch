# Squawk 0022: `docs/vault.md` threat-model list omits that an already-extracted MRK survives every rotation

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: 2026-08-27

## Report

The vault architecture doc is honest that rotations re-wrap one `manager.json` slot and never re-key the master root key (`docs/vault.md:342-344`, `:127`). But the "does NOT protect against" list (`:426-433`) — the section a security-conscious reader consults — omits the corollary: a party that already extracted the MRK is not revoked by any rotation. Add that bullet, and qualify `:351`'s "the prior admin key is invalidated" to "can no longer unwrap the MRK". Leave the one-time key-sheet ledes alone (they describe the key as a credential, which is accurate). Compromise-mode rotation (minting a new MRK) is a backlog feature, not this squawk.

Source: maintenance report 2026-08-27, finding F6 (roundtable-resolved).

## Evidence

- `docs/vault.md:426-433` — non-protections list; `:351` — rotation table wording
- `src/main/vault/vault-store.js:760, :792, :829` — each rotation replaces a single envelope

## Corrective Action

In `docs/vault.md`, added a new bullet to the "does NOT protect against" list (in the same
voice as its neighbours), after the keylogger bullet:

> - **A party that already extracted the MRK.** Rotation re-wraps envelopes; it never re-keys
>   the MRK itself. If the MRK was already extracted — via a returned recovery key or a
>   rotated-out admin key used against a copied `manager.json`, or a memory capture while
>   unlocked — no subsequent rotation revokes that access. Compromise-mode rotation (minting a
>   fresh MRK) is not implemented.

Qualified the rotation table's `rotateAdminKey` row wording:

- Before: `...returns the new one-time private key; the prior admin key is invalidated`
- After: `...returns the new one-time private key; the prior admin key can no longer unwrap the MRK`

The `rotateRecovery` row was checked and does not use equivalent absolute revocation wording
("mints a fresh recovery key, re-wraps `mrk.recovery`, returns the new one-time display") —
no change needed there. `src/shared/vault-recovery-template.js` and
`vault-adminkey-template.js` were left untouched per the squawk's scope.

## Verification

- Confirmed the doc has no internal line/section cross-references (`grep -n '\[.*\](#'` and
  `grep -n 'vault\.md:'` both empty) — nothing to re-point after the insertion.
- `npm run lint` — clean (doesn't cover Markdown, run per instructions).
- `npx prettier --check docs/vault.md` — "All matched files use Prettier code style!", no new
  formatting drift.
- Manually re-read the new bullet against `docs/vault.md:342-344` and `:127` (rotation
  mechanics) for consistency — the added bullet restates the same underlying fact from the
  threat-model reader's perspective, no contradiction.

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the Developers' reasoning) — one review round, clean on the first pass; batch turnaround 2026-08-27 (batch 3)
**Verdict**: confirmed
**Commit**: `squawk: turnaround 2026-08-27 (batch 3)` on `squawk/turnaround-2026-08-27-3` (PR number recorded on the PR itself)

Batch gates at review: 3792/3792 tests (no code changed), lint clean, typecheck clean.
