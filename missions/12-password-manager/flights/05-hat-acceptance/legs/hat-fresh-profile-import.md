# Leg: hat-fresh-profile-import — a not-set-up "Import a vault bundle" entry point

**Status**: landed
**Flight**: [HAT + Alignment — End-to-End Acceptance](../flight.md)

## Objective

Make the marquee **fresh-profile adopt** path reachable from the UI so the mission's file-based portability
criterion (`mission.md:144` — "an exported vault imports on a **fresh profile** and unlocks with the master
password and, independently, with the recovery key") can be exercised end-to-end. `importVault`'s fresh
branch (`src/main/vault/vault-store.js:823-841`) already adopts a bundle's manager on a not-set-up profile —
writes the global vault, adopts `manager.json` (all three MRK slots + kdf + adminPublicKeyB64), installs the
MRK, and leaves the profile UNLOCKED (unlockable thereafter by the SOURCE master password OR recovery key).
It is fully implemented + unit-tested (`test/unit/vault-export-import.test.js` "FRESH profile" tests) but
**UI-unreachable**: the Import affordance renders only in the unlocked Settings view
(`buildImportExportSection`, `vault.js`), and the not-set-up view (`buildNotSetUp`, `vault.js:562`) offers
only "Set up the password manager".

## Context

- Banked from the F5 HAT-tail import-fix leg (I17). That fix covered only the EXISTING-profile branch
  (collision + overwrite). The FRESH branch needs a page entry point — **no store/crypto change.**
- The existing Import modal (`openImportModal`, `vault.js`) assumes a set-up profile: it renders a
  **destination-vault select** (`view.vaults`), probes `hasVault(dest)`, and shows the Replace-existing
  checkbox. On a FRESH profile `view.vaults` is empty and the fresh branch **ignores the destination**
  (writes to `GLOBAL_ID` unconditionally, no collision, no overwrite) — so the destination select + Replace
  affordance are meaningless there.
- The import IPC (`pickImportFile(destinationTarget)` → hold + return `{ok,path}`; `beginImportUnlock(overwrite)`
  → forward to the chrome `vault-import-unlock` sheet; `clearPendingImport`) is reused as-is. The chrome
  sheet already lets the user pick **master password OR recovery key** (`vault-import-template.js` radio) —
  so both unlock-secret variants of the criterion are covered by the existing sheet.

## Requirements (UI-only — do NOT expand scope)

1. **Not-set-up entry.** Add an **"Import a vault bundle"** affordance alongside "Set up the password
   manager" in `buildNotSetUp` (`vault.js:562`). Secondary emphasis (the primary CTA stays "Set up").
2. **Destination-less Import modal variant.** A fresh-mode import modal (a `{ fresh: true }` parameter on
   `openImportModal`, or a thin sibling that reuses the shared modal + file-uploader row): **no** vault
   select, **no** `hasVault` probe, **no** Replace checkbox. A restore-oriented lede — e.g. "Restore a vault
   exported from another device. You'll enter its master password or recovery key on a secure prompt." The
   read-only file-uploader row (path field + open-folder icon button) + the dialog-bound read carry over
   unchanged. Continue is disabled until a bundle file is picked.
3. **Thread a fixed destination.** Fresh-mode pick calls `pickImportFile(GLOBAL_ID)` — the fresh branch
   ignores the target, but `vaultImportBeginFromFile`'s guard requires a non-empty string. `overwrite` stays
   `false` (the fresh branch never collides). Continue → `beginImportUnlock(false)` → the chrome sheet.
4. **Post-adopt re-render.** On a successful fresh adopt the store leaves the profile set-up + UNLOCKED and
   broadcasts the lock-state; the page re-renders not-set-up → unlocked automatically (the existing
   `onVaultLockState` path). No extra page wiring — verify it lands on the unlocked view showing the adopted
   global vault's items.

## Out of scope / invariants

- **No store or crypto change** — the fresh branch already works. **No new IPC channel** — reuse
  `pickImportFile` / `beginImportUnlock` / `clearPendingImport` / the chrome `vault-import-unlock` sheet.
- **DD2/DD5 unchanged**: the source master password / recovery key are entered ONLY on the chrome-owned
  sheet; the page modal carries only a file path + status strings; `textContent`-only, no `innerHTML`.
- Held-state discipline: dismissing the fresh modal after a pick clears the held record (`clearPendingImport`),
  same as the existing import modal.

## Acceptance Criteria

- [ ] The not-set-up Secrets page shows **"Import a vault bundle"** alongside "Set up"; the URL is unchanged.
- [ ] Clicking it opens a **destination-less** import modal (no vault select, no Replace checkbox, restore
      lede) with the file-uploader row (path field + folder button); Continue is disabled until a file is
      picked; the read stays dialog-bound.
- [ ] Continue hands off to the chrome `vault-import-unlock` sheet; entering the **source master password**
      adopts the bundle and lands the profile UNLOCKED on the Secrets page showing the imported items.
- [ ] Independently, entering the **source recovery key** (the sheet's radio) on a fresh profile adopts +
      unlocks (the criterion's "and, independently, with the recovery key").
- [ ] No secret enters the page modal (source secret only on the chrome sheet); dismiss-after-pick clears the
      held record.
- [ ] `npm run typecheck`, `npm test`, lint clean; any page-model/unit assertions for the new not-set-up
      affordance + fresh-mode modal wiring added (the fresh-adopt store path already has its unit tests).

## Verification

- **Unit**: the not-set-up affordance renders the import entry; the fresh-mode modal omits the select/Replace
  and threads `GLOBAL_ID` + `overwrite:false` (where cleanly assertable — the DOM page is DD9, so keep to the
  model/wiring seams that ARE unit-testable, mirroring `partitionItemsByType`). The store fresh-adopt is
  already covered.
- **Live (HAT — the marquee round-trip, operator-driven):** on a **fresh second profile** (a clean
  `userDataPath`), from the not-set-up page: Import a vault bundle exported from the primary profile → enter
  the SOURCE master password → adopts + unlocks, items present. Then repeat on another fresh profile with the
  SOURCE recovery key. This closes `mission.md:144`. (Requires the DD4 apparatus: a second `userDataPath` +
  an exported bundle.)
- **DD5 grep**: no master-equivalent secret enters the page modal DOM path on the fresh flow.

## Files Affected (anticipated)

- `src/renderer/pages/vault.js` — `buildNotSetUp` (import entry); `openImportModal` fresh-mode parameter (or
  a thin fresh sibling) omitting the select/probe/checkbox + a restore lede + `pickImportFile(GLOBAL_ID)` /
  `beginImportUnlock(false)`.
- `src/renderer/pages/vault.css` — only if the not-set-up entry / restore lede needs styling (reuse
  `.vault-btn` + the existing modal/file-uploader classes).
- `test/unit/…` — the not-set-up affordance + fresh-mode wiring, where unit-testable.

## Edge Cases

- **Set-up but LOCKED profile** — shows the locked view, not the not-set-up view, so the fresh-import entry
  never appears there (correct: fresh import is only for a genuinely not-set-up profile).
- **Invalid / unreadable bundle** on a fresh profile — `pickImportFile` returns `{error}`; the modal shows
  the read error; nothing is adopted.
- **Wrong source secret** on the chrome sheet — the fresh adopt does ALL crypto before any write, so a wrong
  secret throws VaultAuthError and NOTHING is installed (`vault-export-import.test.js` "wrong secret" test);
  the sheet re-prompts.
- **Dismiss after pick** — `clearPendingImport` drops the held bundle (the profile stays not-set-up).

## Implementation Guidance

1. Prefer a `{ fresh }` parameter on `openImportModal` (branch the select/probe/checkbox + lede) over a
   duplicate function, to keep the file-uploader + held-state + dismiss logic single-sourced.
2. In the not-set-up view, the import entry is a secondary `.vault-btn` (the "Set up" primary CTA stays
   dominant); on click, `openImportModal({ fresh: true })`.
3. Do NOT touch the store, the IPC channels, or the chrome sheet — this is a page-entry + modal-variant leg.

---

## Post-Completion Checklist

- [x] All acceptance criteria verified — operator live fresh-profile round-trip PASSED (master AND recovery)
- [x] Tests passing (`npm test` 2689/0, typecheck, lint)
- [x] Flight-log updated (I19 verified; marquee criterion `mission.md:144` closed; I20 destination-safety banked)
- [x] Leg status → `landed`
- [x] Commit on the flight/05 branch
