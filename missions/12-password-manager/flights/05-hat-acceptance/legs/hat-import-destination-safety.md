# Leg: hat-import-destination-safety — surface the bundle's source vault + prevent wrong-vault imports

**Status**: planning (BANKED follow-up — operator deferred at F5 close, 2026-07-22)
**Flight**: (future) — a follow-up leg / flight; recorded here for traceability

## Objective

Close the import-destination safety gap the operator found while verifying the fresh-profile round-trip
(`hat-fresh-profile-import`): a bundle can land in the **wrong vault** with no warning, and a **jar** vault
**flattens to Global** on a fresh-profile adopt. Two parts, banked together but distinct in scope.

## Context / the gap

- **A bundle carries `sourceVaultId`** (`exportVault`, `vault-store.js:717`) but nothing surfaces or uses it.
- **Fresh-profile adopt hardcodes Global** — `importVault`'s fresh branch writes the vault to `GLOBAL_ID`
  unconditionally (`vault-store.js:826`) and ignores `sourceVaultId`. A bundle carries the vault + the
  manager's MRK envelopes but **NOT the jar's definition** (name/color/id), so on a jar-less fresh profile the
  vault has nowhere to land but Global. A jar's secrets silently become the Global vault.
- **Existing-profile re-key uses the operator-selected destination** (`openImportModal`'s destination select)
  with **no name-match and no mismatch warning** — pick the wrong destination and a vault merges into the
  wrong place.

## Part A — Surface the source vault + match/warn (the safety fix; UI + a metadata return)

1. **Return `sourceVaultId` from the pick.** `pickImportFile` / `vaultImportBeginFromFile` (`main.js`) already
   read + hold the bundle — additionally return the bundle's non-secret `sourceVaultId` (+ optionally a
   human label) alongside `{ok, path}`. No secret; the bundle is already parsed.
2. **Show it in the import modal.** "This bundle is the **&lt;source&gt;** vault." (`textContent`-only.)
3. **Existing profile:** default-select the destination whose id/name matches `sourceVaultId` when one exists;
   when the chosen destination differs from the source, show a **mismatch warning** before Continue
   (distinct from the Replace-existing collision confirm).
4. **Fresh profile:** state plainly that the vault will be **restored as your Global vault** (no jars exist
   yet to land in) — so the flatten-to-Global is explicit, never a surprise.

## Part B — Restore a jar AS a jar (the bigger, format-level change; a design decision → likely its own flight)

- Extend the **bundle format** to carry the source jar's identity (name/color/id) so a fresh-profile adopt can
  **recreate the jar** and land the vault there, instead of flattening to Global. This is a `BUNDLE_VERSION`
  bump + a fresh-adopt path change (create the jar, then write its vault) + migration/back-compat handling for
  v1 bundles. **Mission-level** — its own design decision + flight, NOT folded into Part A.

## Invariants

- DD2/DD5 unchanged: `sourceVaultId` is non-secret metadata; the source master/recovery secret still lives
  ONLY on the chrome sheet. `textContent`-only. No change to the fill/automation surface.

## Notes

- **Part A** is a scoped safety leg (surface + match/warn) — small–medium, reuses the import flow.
- **Part B** is a mission-level portability-fidelity decision — carry to `/mission-debrief` /
  `/routine-maintenance` as an action item, size as its own flight.
- Discovered at the F5 acceptance gate; the fresh-profile **criterion itself passed** (import + unlock by
  master AND recovery). This is a fidelity/safety follow-up, not a criterion failure.
