# Squawk 0060: CLAUDE.md MRK-model bullet stale after manager v2 / compromise rotation

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-09-02

## Report

`CLAUDE.md:303` (vault Module layout / MRK bullets) still states the MRK
is "wrapped three ways in `manager.json`" and that "a rotation rewrites
only `manager.json`". Both are conditionally false since Mission 18
Flight 2: a v2 no-admin manager carries two wraps (master + recovery;
admin optional-but-paired), and compromise rotation rewrites the manager
plus every on-disk `.gfvault`. Fix: reword the bullet(s) to state the
v1/v2 split and carve out compromise rotation, consistent with
`docs/vault.md` (which is accurate). Docs only; found at the Flight 2
debrief (Developer interview).

## Evidence

- `CLAUDE.md:303` region — "wrapped three ways", "rewrites only
  manager.json" (grep at HEAD 52494f9).
- Shipped contract: `_readManager` v2 optional-admin pairing;
  `compromiseRotate` multi-file transaction
  (`src/main/vault/vault-store.js`, `vault-txn.js`); `docs/vault.md`
  compromise section (accurate reference text).

## Corrective Action

*(recorded at completion)*

## Verification

*(recorded at completion)*

## Sign-Off

*(recorded at completion)*
