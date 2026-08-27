# Squawk 0022: `docs/vault.md` threat-model list omits that an already-extracted MRK survives every rotation

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-27
**Completed**: —

## Report

The vault architecture doc is honest that rotations re-wrap one `manager.json` slot and never re-key the master root key (`docs/vault.md:342-344`, `:127`). But the "does NOT protect against" list (`:426-433`) — the section a security-conscious reader consults — omits the corollary: a party that already extracted the MRK is not revoked by any rotation. Add that bullet, and qualify `:351`'s "the prior admin key is invalidated" to "can no longer unwrap the MRK". Leave the one-time key-sheet ledes alone (they describe the key as a credential, which is accurate). Compromise-mode rotation (minting a new MRK) is a backlog feature, not this squawk.

Source: maintenance report 2026-08-27, finding F6 (roundtable-resolved).

## Evidence

- `docs/vault.md:426-433` — non-protections list; `:351` — rotation table wording
- `src/main/vault/vault-store.js:760, :792, :829` — each rotation replaces a single envelope

## Corrective Action

*(written at completion)*

## Verification

*(written at completion)*

## Sign-Off

*(written at completion)*
**Reviewer**: —
**Verdict**: —
**Commit**: —
