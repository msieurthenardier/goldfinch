# Leg: jar-delete-vault-removal

**Status**: completed
**Flight**: [Portability + Rotation + Hardening + Docs](../flight.md)

## Objective

Complete the vault lifecycle: **jar delete removes the jar's `.gfvault`** (after offering to export it
first), while **jar wipe still spares it**. A net-new `deleteVault(vaultId)` store op (ENOENT-tolerant
`fs.unlink` + evict/zeroize any cached key — there is NO "manager row" to prune) is called fail-soft
from `handleRemove` after `revokeJarKey`; the renderer's existing `Delete jar?` confirm gains an
**offer-export-first** affordance for a vault-bearing jar (reusing Leg 1's export). The global vault is
never touched by a jar delete. The interactive offer + a11y for any new state ride the **F5 HAT**.

## Context

- **Flight DD7 (Architect-corrected)** — `handleRemove` (`jar-registry-ipc.js:64-87`) gains a
  vault-removal step after `revokeJarKey` (`:83`), gated by an offer-export-first prompt. **`deleteVault(vaultId)`
  is just `fs.unlink(_vaultPath(vaultId))` + evict/zeroize `this.vaultKeys.get(vaultId)`** — there is **NO
  per-vault "manager row"**: `manager.json` holds only `{ format, version, kdf, adminPublicKeyB64, mrk }`
  and vault enumeration is `GLOBAL + jars.list()`, so no manager mutation. The jar registry entry is
  already removed by `jars.remove` and the automation key by `revokeJarKey` — this leg only adds the
  `.gfvault` unlink. **Stale checkpoint**: flight checkpoint (e) (`flight.md`) still says "prunes the
  manager row" — superseded by the DD7 correction (no manager row); flag in the flight-log, don't rewrite
  the flight body.
- **Wipe already spares the vault** — `wipeJarData`/`jar-data-lifecycle.js` touches only
  session/history/cookies, never `userData/vaults/`. Confirmed; no change — but pin it with a test.
- **Only vault-bearing jars need the offer** — a per-jar `.gfvault` exists **lazily** (created on the
  first credential save into that jar), so most jars have none. `deleteVault` is ENOENT-tolerant (a
  no-vault jar delete is a clean no-op); the renderer offers export **only** when a vault is present.
- **`handleRemove` is fail-soft** — registry removal already happened (like the existing wipe
  containment), so the vault unlink is wrapped and never fails the delete; revoke/broadcasts run
  regardless.
- **Export requires unlocked** — Leg 1's `exportVault(target)` throws `VaultLockedError` → the
  `internal-vault-export` handler returns `{ locked: true }`. The offer-export path must surface that
  (route to unlock / tell the operator to unlock first) rather than silently failing.

## Inputs

- `src/main/jar-registry-ipc.js:8-18` (`registerJarRegistryIpc` deps), `:64-87` (`handleRemove` — the
  `remove → wipe → revoke → broadcast` composition; the vault unlink slots in after `revokeJarKey` `:83`).
- `src/main/jar-ipc.js:46` (the `registerJarRegistryIpc({...})` call site — where a `deleteVault`/
  `getVaultStore` dep is injected, mirroring how `register-vault-ipc.js` receives `getVaultStore`).
- `src/main/vault/vault-store.js:208-210` (`_vaultPath`), `:188` / `:845-855` (`this.vaultKeys` +
  the evict/zeroize idiom `key?.fill(0); vaultKeys.delete(dest)`), `:706` (`exportVault(target)` — Leg 1,
  for the offer + a `hasVault` sibling), the `VaultLockedError`/`VaultStateError` types.
- `src/main/register-vault-ipc.js:199-209` (`internal-vault-export` — Leg 1's export handler to reuse),
  `src/main/main.js:614` (`vaultSaveBundleToFile` — the save dialog).
- `src/renderer/pages/jars-section-controller.js:590-596` (`DATA_ACTIONS.delete`, `silentSuccess`) +
  `:571` (`DELETE_COPY`, a **static** string today); `src/renderer/pages/jars-confirm-modal.js` (the ONE
  page-level confirm modal — `buildContent` `:158-232` renders `entry.copy` + two buttons; the focus trap
  is a **fixed 2-element cycle** `[confirmBtnEl, cancelBtnEl]` `:290-296` — both must change for a third
  action).
- `src/preload/internal-preload.js:64` (the ONE `goldfinchInternal` bridge to all internal origins),
  `:306` (`jarsRemove`), `:651` (`exportVault` — already bridged; the export offer needs no new export
  wiring). A **new `hasVault`/`vaultPresent` preload method is required** — `internal-vault-state`
  (`register-vault-ipc.js:83-104`) enumerates every jar regardless of whether a `.gfvault` exists and its
  count is locked-ambiguous, so it cannot answer "does THIS jar have a vault file"; add a dedicated
  bridge method.

## Outputs

- **`deleteVault(vaultId)` store op (net-new, `vault-store.js`)** — `fs.unlink` (or `fs.rmSync` with
  `force`) on `_vaultPath(vaultId)`, tolerating ENOENT (a no-vault jar → clean no-op); then
  `this.vaultKeys.get(vaultId)?.fill(0); this.vaultKeys.delete(vaultId)` (evict + zeroize). Returns
  `{ deleted: boolean }` (true iff a file was removed). **Guard the global vault** — refuse / never
  unlink `GLOBAL_ID` (a jar delete must never remove the global vault); a jar id is always passed, but
  assert the guard.
- **`hasVault(jarId)` predicate (net-new, `vault-store.js`)** — `fs.existsSync(_vaultPath(jarId))`, so
  the renderer can decide whether to surface the offer. (Or fold the flag into an existing jar-list/
  metadata read — pick the lighter wiring at implementation.)
- **`handleRemove` vault-removal step** — after `revokeJarKey(removed.id, settings)` (`:83`), call
  `deleteVault(removed.id)` **fail-soft** (wrapped in try/catch like the wipe; a throw sets a
  `vaultRemoved:false` flag but never fails the delete). Inject the op into `registerJarRegistryIpc`
  (a `deleteVault` fn or a `getVaultStore` accessor) via `jar-ipc.js`; offline tests that omit it skip
  the step (the existing injection-gated precedent). Return the existing shape + a `vaultRemoved` field.
- **Renderer offer-export-first — a modal-SHAPE change owned by THIS leg.** When the jar being deleted has
  a vault (`hasVault`), the `Delete jar?` confirm surfaces: (a) permanence copy ("This jar has a saved
  password vault — deleting it is permanent and unrecoverable."), and (b) an **"Export vault first"**
  affordance that calls `bridge.exportVault(jarId)` (Leg 1's `internal-vault-export` → the save dialog)
  **without closing the modal**, then renders the `{ok,path}` / `{locked:true}` / `{canceled}` result; a
  `{locked:true}` surfaces "unlock the vault to export" (never a faked success). Delete stays the separate
  explicit Confirm click (never chained off export). **The structural modal code lands here, not in F5**:
  the fixed 2-element focus cycle (`jars-confirm-modal.js:290-296`) becomes **3-element**
  (`[export?, confirm, cancel]`, the export button present only for a vault-bearing delete) so the Export
  button is keyboard-reachable; `buildContent` (`:158-232`) branches its copy on the vault-present variant
  (today `entry.copy` is a static string). A no-vault jar's confirm is **byte-unchanged** (2-element cycle,
  static copy). **What defers to the F5 HAT**: the full interactive walkthrough + the axe/screen-reader
  a11y audit of the new modal state — NOT the structural reachability, which this leg asserts (see Tests).
- **Tests** — unit: `deleteVault` (unlinks an existing `.gfvault` + evicts/zeroizes the cached key;
  ENOENT → `{deleted:false}` no-throw; refuses/never-unlinks the GLOBAL vault); `hasVault` (true with a
  file, false without). Integration: `handleRemove` calls `deleteVault(removed.id)` after `revokeJarKey`
  and returns `vaultRemoved`; it is **fail-soft** (a `deleteVault` throw still returns `{ok:true}` +
  `vaultRemoved:false`); a **wipe leaves the `.gfvault` intact** (the spare-on-wipe pin); the global
  vault survives a jar delete. Renderer **reachability smoke** (this leg, not F5): for a vault-bearing
  delete the confirm renders the "Export vault first" button AND it is in the focus cycle (3-element);
  for a no-vault delete the modal is the unchanged 2-element `[confirm, cancel]`. The full interactive
  offer + a11y audit are F5-HAT-verified.

## Acceptance Criteria

- [x] `deleteVault(vaultId)` unlinks the jar's `.gfvault` and evicts+zeroizes any cached key; ENOENT is a
      clean no-op; it never removes the **GLOBAL** vault.
- [x] `handleRemove` removes the deleted jar's vault (after `revokeJarKey`), **fail-soft** (a vault-unlink
      failure never fails the jar delete); the result reports `vaultRemoved`.
- [x] **Jar wipe leaves the `.gfvault` intact** (pinned by a test); a jar delete removes it.
- [x] The renderer `Delete jar?` confirm **offers export first** for a vault-bearing jar (reusing Leg 1's
      export; a locked vault surfaces "unlock to export", never a faked success); the Export button is in
      the confirm's **3-element focus cycle** (keyboard-reachable, asserted this leg); a no-vault jar's
      confirm is byte-unchanged (2-element).
- [x] No "manager row" mutation (there is none); `manager.json` is untouched by a jar delete.
- [x] Existing tests pass unmodified; `npm test`, `npm run typecheck`, lint clean. (The interactive
      offer-export + a11y for any new modal state are verified by the F5 HAT.)

## Verification Steps

- Unit: `deleteVault` (unlink + evict/zeroize; ENOENT no-op; GLOBAL guard); `hasVault`.
- Integration: `handleRemove` (vault removed after revoke; fail-soft; `vaultRemoved` reported); wipe
  spares the `.gfvault`; global survives a jar delete.
- `npm test` full — no regressions. typecheck + lint clean.
- Grep: no `manager.json` write on the delete path; the GLOBAL vault path is guarded.

## Implementation Guidance

1. **Store ops** — add `deleteVault(vaultId)` (ENOENT-tolerant unlink + `vaultKeys` evict/zeroize +
   GLOBAL guard) and `hasVault(jarId)` to `vault-store.js`, reusing `_vaultPath` + the `:853-854`
   evict idiom.
2. **`handleRemove` hook** — inject the op through `jar-ipc.js` → `registerJarRegistryIpc`; call it
   fail-soft after `revokeJarKey`; add `vaultRemoved` to the return. Gate on the injection (offline
   tests omit it).
3. **Renderer offer (modal-shape change, owned here)** — branch `jars-confirm-modal.js`'s `buildContent`
   copy on the vault-present variant, add the "Export vault first" button (reuse `bridge.exportVault`;
   handle `{ok,path}`/`{locked:true}`/`{canceled}` without closing the modal), and widen the focus cycle
   to 3-element for that variant (2-element unchanged otherwise). Add the reachability smoke test. Only
   the full interactive walkthrough + a11y audit defer to F5. `textContent`-only.
4. **Flag the stale checkpoint (e)** in the flight-log (no manager row) — do not rewrite the flight body.

## Edge Cases

- **No-vault jar** — `deleteVault` ENOENT → `{deleted:false}`; the confirm shows the unchanged copy (no
  offer). The common case.
- **Locked vault** — the export offer's `internal-vault-export` returns `{locked:true}` → surface
  "unlock the vault to export" rather than proceeding to a silent no-export delete.
- **Cached key present** — a jar whose vault was unlocked this session has a `vaultKeys` entry; the delete
  must zeroize + evict it (no dangling key material after the file is gone).
- **GLOBAL guard** — a jar id is always what `handleRemove` passes, but `deleteVault` must refuse
  `GLOBAL_ID` defensively (a jar delete never removes the global vault).
- **Fail-soft** — a vault-unlink throw (permissions, races) never fails the jar delete; the registry
  entry is already gone; report `vaultRemoved:false`.
- **Wipe** — unchanged; asserts the `.gfvault` survives (the lifecycle contract).
- **Stale vault-page row** (LOW, carry-forward) — an open `goldfinch://vault` derives rows from
  `vaultState` (GLOBAL + `jars.list()`); `handleRemove` broadcasts `jars-changed` but not a vault-specific
  event, so an open vault page may show a stale row for the just-deleted jar until refetch. Pre-existing
  (the jar row's source is already gone) and out of tight scope — note in the flight-log for F5, don't
  expand this leg to chase it.

## Files Affected

- `src/main/vault/vault-store.js` — `deleteVault` + `hasVault`.
- `src/main/jar-registry-ipc.js` — the `handleRemove` vault-removal step + `vaultRemoved`.
- `src/main/jar-ipc.js` — inject the store op into `registerJarRegistryIpc`.
- `src/renderer/pages/jars-section-controller.js` + `jars-confirm-modal.js` — the offer-export-first branch.
- `src/preload/internal-preload.js` (+ `renderer-globals.d.ts`) — a `vaultPresent`/export query if needed.
- `test/unit/…` — `deleteVault`/`hasVault`; `handleRemove` (vault removed / fail-soft / wipe-spares / global survives).

---

## Post-Completion Checklist

**Complete ALL before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with the leg progress entry
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md
- [x] Do NOT commit (deferred-commit model — Flight Director commits at flight end)
