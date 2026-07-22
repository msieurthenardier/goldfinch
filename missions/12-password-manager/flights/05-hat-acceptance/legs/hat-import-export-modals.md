# Leg: hat-import-export-modals — Unified Import / Export page modals

**Status**: landed
**Flight**: [HAT + Alignment — End-to-End Acceptance](../flight.md)

## Objective

Replace the vault ("Secrets") page's two separate portability affordances — a standalone "Import a vault
bundle" subsection and an export control buried under "Master-key management" — with a **single
"Import / Export" Settings subsection** carrying **exactly two buttons** (Import… / Export…), each opening a
**page-level modal** where the vault (destination for import / source for export) and the file location are
selected, ending in a **Cancel / Submit** button combo. Operator-designed live during the F5 HAT.

Authored **retroactively** — the change was designed, reviewed, implemented, and verified inline during the
HAT session (logged as **I14**); this doc captures it as a leg for traceability.

## Context

- **Fix-vs-feature call (out loud):** this crossed from look-and-feel into a **FEATURE** — it adds page-level
  modal UI, changes main-process IPC (splitting location-pick from commit), and touches a **shared interface
  with a second consumer** plus the import **trust boundary** (DD2/DD5). Per the HAT fix-vs-feature gate +
  multi-surface trigger it was **promoted to a scoped design review before implementation** (one
  general-purpose design-review pass, approve-with-changes; all findings incorporated), then implemented by a
  spawned Developer.
- **Prior state.** Import: a destination `<select>` + "Import…" that routed `requestImport(target)` → a
  main-side file-open dialog → the chrome-owned `vault-import-unlock` sheet (secret entered there). Export: a
  source `<select>` + "Export…" under Master-key management that ran `exportVault(target)` → build
  ciphertext bundle + native save dialog + write, fully main-side.
- **Second consumer of `exportVault` (the load-bearing constraint).** The jars-page delete "export-first"
  offer calls `bridge.exportVault(id)` with **no path** (`jars-section-controller.js:607` →
  `jars-confirm-modal.js`), relying on the build-dialog-write behavior. Same multi-consumer trap as F4 Leg 4's
  `reachableLoginItems` — a blanket contract change would have silently broken it.
- **Modal precedent.** `src/renderer/pages/jars-confirm-modal.js` (role=dialog / aria-modal / Tab focus-trap
  / Esc + backdrop dismiss / focus-return / textContent-only) — mirrored, rebuilt compactly **inline** in
  `vault.js` (no served-module extraction → no `internal-page-map.js` onboarding; vault.js stays well under
  the ~1800-line extraction threshold). Its `.jar-modal-*` CSS is **not reachable** cross-page (vault serves
  only `vault.css`), so `.vault-modal-*` rules were added to `vault.css`.

## Security invariants preserved (DD2 / DD5)

- **No master-equivalent secret enters any page modal or the page DOM.** For import, the source
  master-password / recovery-key entry **stays on the chrome-owned `vault-import-unlock` sheet** — the page
  modal only selects destination + bundle file, then hands off. Grep-verified: the modals handle only vault
  ids, file paths, and status strings.
- Export stays **ciphertext-only and fully main-side** — the bundle never transits to the page.
- All DOM text via `textContent`, never `innerHTML`; strict CSP (default-src 'self', no unsafe-inline) — no
  inline handlers, no dynamic `<script>`/`<style>`.

## Requirements (operator design)

1. **One "Import / Export" subsection** replacing `buildImportSection`; the export block removed from
   `buildMasterKeySection` (its kebab of change-master / rotate-recovery / rotate-admin stays). Exactly two
   buttons: **Import…** and **Export…**.
2. **Export modal** — source-vault `<select>` + "Choose location…" (native save dialog picks a path
   **without writing**) + a path display; **Export** disabled until a location is chosen; submit builds the
   bundle and writes to the chosen path.
3. **Import modal** — destination-vault `<select>` + "Choose file…" (native open dialog reads + holds the
   bundle in main, shows the path) + a path display; **Continue** disabled until a bundle is picked **for the
   shown destination**; submit forwards to the chrome secret sheet.
4. **Cancel / Submit** on both; Esc + backdrop dismiss; Tab focus-trapped; focus returns to the invoking
   button.

## Design-review mitigations (all applied)

- **H1 (held-state binding).** `_pendingVaultImport` binds the destination at file-pick time. The import
  modal invalidates the pick when the destination `<select>` changes after a pick — clears the path, drops
  the held bundle (`clearPendingImport`), disables Continue, forces a re-pick — so the held destination can
  never drift from what the modal shows (`vault.js` import-modal `change` handler).
- **M2 (tests).** `test/unit/vault-request-triggers.test.js` rewritten for the split (pick-file holds +
  returns `{ok,path}` and does **not** forward; begin-import-unlock forwards; canceled/failed pick holds
  nothing).
- **M3 (channel placement).** The "open import sheet" forward needs `chromeForTab` → lives in
  `register-browser-ipc.js` (`internal-vault-begin-import-unlock`), not `register-vault-ipc.js`.
- **M4 (CSS).** Own `.vault-modal-*` rules added to `vault.css` (jars' modal classes aren't reachable).
- **M5 (teardown).** The modal lives on `document.body`, so `render()` calls `closeActivePageModal()` — an
  idle auto-lock mid-modal (`onVaultLockState → refresh`) can't orphan a stale unlocked-context modal;
  single-open enforced via a module-scoped ref.
- **L1 (dismiss clear).** Cancel / Esc / backdrop after a pick calls `clearPendingImport()`.
- **L2 (export feedback).** A `{ locked }` race closes the modal + refreshes + shows a notice; a write error
  shows on the status line — neither silently swallowed.
- **L3 (store arity).** The **store** `exportVault(target)` stays **single-arg** (a unit test pins its
  arity); the pre-chosen `savePath` lives only on the bridge / IPC / main-side save delegate.

## IPC surface (final)

- `exportVault(target, savePath?)` — **dual-mode**: with a path (page modal) write directly, no dialog;
  without one (jars delete-first offer) run the dialog. Second consumer preserved.
- `pickSavePath(target)` — main-side save dialog **only** (no write), for the export modal's up-front
  location pick; holds no main-side state.
- `pickImportFile(destinationTarget)` — dialog + read + **hold** `{bundle, destinationTarget}`, returns
  `{ ok, path } | { canceled } | { error }`; does **not** forward.
- `beginImportUnlock()` — bare forward of `vault-request-import` (opens the chrome secret sheet).
- `clearPendingImport()` — drops the held record (L1). Always safe.
- `requestImport` **removed** (no callers remained after the modal rewrite).

## Acceptance Criteria

- [x] The Secrets page has one **"Import / Export"** subsection with exactly two buttons (Import…, Export…);
      the old standalone import subsection and the export-under-Master-key-management block are gone.
- [x] **Export modal**: source-vault select + up-front location pick (no write until submit) + Cancel/Export;
      submit writes the ciphertext bundle to the chosen path; `{locked}`/write errors surfaced.
- [x] **Import modal**: destination-vault select + file pick (path shown) + Cancel/Continue; Continue hands
      off to the chrome `vault-import-unlock` sheet; the source secret never enters the page modal.
- [x] Destination change after a pick invalidates it (H1); dismiss-after-pick clears the held bundle (L1).
- [x] Modal a11y: role=dialog / aria-modal, Tab focus-trap, Esc + backdrop dismiss, focus-return; torn down
      on page re-render (M5).
- [x] The jars-page delete "export-first" offer still works (dual-mode `exportVault`).
- [x] `npm run typecheck`, `npm test` (2676 pass / 0 fail), lint — all clean.

## Verification

- **Unit**: the import-trigger split, the export save-path branch + `pickSavePath`, the begin-import-unlock
  channel inventory; the store `exportVault` arity pin; the jars-confirm reachability suite.
- **Live (HAT, FD-driven restart)**: app restarted on the new main+preload; operator drives an export
  round-trip and an import handoff to the secret sheet. *(operator live-verification pending at authoring
  time — the app was relaunched with the admin gate for this.)*
- **DD5 grep**: no master-equivalent secret enters the page DOM path (the modals carry only vault ids / file
  paths / status).

## Files Affected

- `src/renderer/pages/vault.js` — reusable inline modal + Import/Export section + the two modal builders;
  removed `buildImportSection` and the export block; `render()` teardown.
- `src/renderer/pages/vault.css` — `.vault-modal-*` styles.
- `src/main/main.js` — `vaultPickSavePath`, dual-mode `vaultSaveBundleToFile`, `vaultImportBeginFromFile`
  returns the path, `clearPendingVaultImport`.
- `src/main/register-vault-ipc.js` — `internal-vault-export` (optional savePath) + `internal-vault-pick-save-path`.
- `src/main/register-browser-ipc.js` — import split: `pick-import-file` / `begin-import-unlock` / `clear-pending-import`.
- `src/preload/internal-preload.js` — `exportVault(target, savePath?)`, `pickSavePath`, `pickImportFile`,
  `beginImportUnlock`, `clearPendingImport`; `requestImport` removed.
- `src/renderer/renderer-globals.d.ts` — bridge type updates.
- `src/renderer/renderer.js` — comment-only (import-trigger provenance).
- `test/unit/vault-request-triggers.test.js`, `test/unit/register-vault-ipc.test.js`,
  `test/unit/register-browser-ipc.test.js` — coverage for the split + save-path branch.

## Deviations from the original design

- `requestImport` fully removed (no callers remained) rather than kept for minimal churn.
- `buildMasterKeySection` lost its now-unused `vaults` parameter (it only fed the deleted export select).
- The dead `.vault-import-section` / `.vault-rotation-actions` CSS the spec mentioned removing did not exist.

---

## Post-Completion Checklist

- [x] All acceptance criteria verified (unit + typecheck + lint; live operator verification in progress)
- [x] Tests passing (`npm test` 2676/0, typecheck, lint)
- [x] Flight-log updated (I14 entry)
- [x] Leg status set to `landed`
- [ ] Commit on the flight/05 branch (bundled with the other HAT fixes at the FD's flight-end commit)
