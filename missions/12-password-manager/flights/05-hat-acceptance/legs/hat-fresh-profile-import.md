# Leg: hat-fresh-profile-import — a not-set-up "Import a vault bundle" entry point

**Status**: planning
**Flight**: [HAT + Alignment — End-to-End Acceptance](../flight.md)

## Objective

Make the marquee **fresh-profile adopt** path reachable from the UI. `importVault`'s fresh branch
(`src/main/vault/vault-store.js:823-841`) adopts a bundle's manager on a not-set-up profile — writes the
global vault, adopts `manager.json`, installs the MRK, and leaves the profile UNLOCKED (unlocked by the
SOURCE master password / recovery key). This is the cross-machine / new-device restore story, but it is
currently **UI-unreachable**: the Import affordance renders only inside the unlocked Settings view
(`buildImportExportSection`, `vault.js`), and the not-set-up view (`buildNotSetUp`, `vault.js:562`) offers
only "Set up the password manager".

## Context / gap (banked from the M12 F5 HAT tail import-fix leg)

- Discovered while fixing the **import-over-existing** bug (re-import over a set-up+unlocked profile —
  the collision + overwrite work). That fix covered ONLY the EXISTING-profile branch. The FRESH branch has
  full store + crypto coverage (`test/unit/vault-export-import.test.js` — "FRESH profile" tests) and is
  correct; it simply has no page entry point.
- The existing Import modal (`openImportModal`) assumes a set-up profile: it renders a **destination-vault
  select** (`view.vaults`), probes `hasVault(dest)`, and shows the Replace-existing checkbox. On a FRESH
  profile `view.vaults` is empty and the fresh branch **ignores the destination** (writes to `GLOBAL_ID`
  unconditionally, no collision, no overwrite) — so the destination select + Replace affordance are
  meaningless there.

## Scope (UI-only — do NOT expand)

1. A not-set-up **"Import a vault bundle"** entry alongside "Set up" in `buildNotSetUp`.
2. A **destination-less** Import modal variant: no vault select, no `hasVault` probe, no Replace checkbox;
   a different lede ("Restore a vault exported from another device — you'll enter its master password or
   recovery key on a secure prompt."). The file-uploader row (path field + folder button) and the
   dialog-bound read carry over unchanged.
3. Thread a fixed destination of `GLOBAL_ID` into `pickImportFile` (the fresh branch ignores it, but the
   held-record's `destinationTarget` must be a non-empty string for `vaultImportBeginFromFile`'s guard).
   `overwrite` stays false (the fresh branch never collides).

## Out of scope / invariants

- No store or crypto change — the fresh branch already works. No new IPC channel (reuse pickImportFile /
  beginImportUnlock / the chrome vault-import-unlock sheet).
- DD2/DD5 hold unchanged: the source secret stays on the chrome-owned sheet; the page modal carries only a
  file path + status strings. `textContent`-only.

## Risk

Small, UI-only, its own leg. Design-review-lite (a new not-set-up affordance + a modal variant; no
security-sensitive surface beyond the already-reviewed import flow).
