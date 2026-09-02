# Leg: Flow Wiring — Entry, Sheets, Surfacing, Completion, Docs

**Status**: completed
**Flight**: [Compromise-Mode Rotation](../flight.md)

## Objective

Wire `compromiseRotate` into the operator-facing flow ruled in Flight 1:
page entry (both lock states) → confirm modal → compromise credential
sheet(s) → pending → post-commit single recovery sheet under a new
refcounted suppression holder → completion broadcast → persistent
"Everything rotated" card + admin-provision state. Plus the suppression
migration of the adopt flow, the lock-state test matrix, and the
`docs/vault.md` updates. Everything renderer/IPC/docs — the store op is
done (leg 3).

## Context (ground truth after leg 3)

Leg-3 handoff (verbatim): `await store.compromiseRotate({oldMasterPassword,
newMasterPassword} | {recoveryKey, newMasterPassword})` →
`{recoveryKey: string, revoked: {admin: boolean, vaultIds: string[]}}`
(`vaultIds` may include `'global'`). Error map: `VaultPasswordReuseError`
→ reuse copy; `VaultAuthError` → wrong credential; `VaultFormatError` →
malformed recovery display / integrity anomaly; `VaultBusyError` →
rotation in progress; `VaultStateError` → args/not-set-up. Timing:
2–3 scrypt derives + per-vault AES — the sheet needs a pending state.
`onUnlock` (vault-state broadcast) fires BEFORE the promise resolves.
Pre-commit failure = truthfully "nothing changed". The op does not
zeroize caller password buffers — the sheet handler owns them. Never
wrap the op in a gated public op.

Wiring pattern to clone: the rotate-recovery chain (page kebab →
`internal-preload` invoke → `register-browser-ipc` bare trigger → chrome
`vault-controller` → sheet → `menu-overlay-preload` → overlay-IPC submit
handler with token/Uint8Array/dual-zeroize discipline → `main.js`
delegate → post-write `vault-recovery-show` send). Registry joins for
new menuTypes (flight design review): `menu-overlay.js` menuType→template
map + JSDoc union (~:2382-2402), `vault-controller.js` SHEET_STATES
(:399-475) + a11y audit-driver hooks (:602-640), `scripts/a11y-audit.mjs`
skip list (:432), `test/unit/seam-contract.test.js` tier-2 expectations.
New `vault-*` menuTypes are automation-refused by default (allowlist
admits nothing new).

## Scope

1. **Page entry + confirm modal** (`src/renderer/pages/vault.js` +
   `.css`): the R2/R4-ruled row — explainer "Think a key or your master
   password leaked?", danger button "Rotate Everything…" — rendered in
   BOTH lock states at the bottom of the Settings flow (unlocked: bottom
   of Master-key management; locked: below the Auto-lock block). Confirm
   modal with the R3-ruled copy, verbatim:
   - Title: "Rotate everything"
   - Lede: "This creates fresh keys for your vault and locks out anyone
     who may have your old ones. Everything you've saved is kept."
   - Steps ("What happens next"): "Enter your current master password." /
     "Choose a new master password." / "Save the new recovery key — it's
     shown once."
   - Consequence: "Your admin key and all jar access keys will be
     revoked. You'll create new ones afterward."
   - Checkbox: "I understand my old keys will stop working" gating a
     danger-styled Continue.
   Continue → `bridge.requestCompromiseRotate()` → bare trigger →
   chrome opens the compromise sheet.
2. **Compromise sheets** (chrome/menu-overlay): two new menuTypes, main
   authoritative on routing:
   - `vault-compromise` — master branch: current password + new password
     + confirm-new fields (the `vault-change-master` template shape,
     compromise lede/labels; submit "Rotate everything"), plus a switch
     affordance "Use your recovery key instead" that swaps the sheet to
     the recover variant (mirroring the unlock sheet's recover link
     idiom).
   - `vault-compromise-recover` — recovery branch: recovery key + new
     password + confirm (the `vault-recover` template shape, compromise
     lede).
   - **Branch-switch mechanism (design-review M1 — no in-sheet swap
     idiom exists):** the switch link uses `sendActivated({id:
     'use-recovery'})` → main's activated handler closes the sheet
     (`'activated'`) → chrome's `handleActivation` gains a
     `vault-compromise` case reopening as `vault-compromise-recover`.
     Close-then-reopen, never a model replace (`'superseded'` closes
     even dismiss-locked sheets — the F17-4 clobber lesson); the
     compromise sheets must never be openable while a
     `vault-recovery-show` is live.
   - Pending-state rules (L1/L2): Cancel/Escape stay live during
     pending — a dismissal mid-op is safe (the reveal arrives via the
     pending-reveal mechanism below; the stale-token close is a no-op,
     pinned). The page-side confirm modal closes at Continue (the mid-op
     `onUnlock` re-render would wipe it anyway — `render()` closes
     body-level modals); there is NO page-side pending indicator by
     constraint (pending lives sheet-side only); the locked-entry view
     visibly flipping to unlocked behind the pending sheet is accepted.
   Both join every registry named in Context. Both get a **pending
     state** (fields + submit disabled, progress note) for the op's
     latency. Inline errors per the leg-3 error map — reuse:
     "Your new master password must be different from your old one.";
     wrong credential and malformed display: existing message idioms;
     busy: "A rotation is already in progress."; unexpected/pre-commit
     failure: sheet closes to an error state carrying DD5's ruled copy
     "Nothing changed; your existing keys remain valid."
3. **Overlay IPC submit handlers** (`register-overlay-ipc.js`):
   `menu-overlay:vault-compromise` + `:vault-compromise-recover`,
   injection-gated like siblings; full discipline (recordForSheetSender,
   token match against `getCurrentMenu()`, `Uint8Array` checks,
   Buffer copies, dual-zeroize ALL secret buffers in `finally` — the
   handler owns caller-buffer zeroization per leg 3).
   - **Success path with the H2 ruling (hold-and-resurface):** on op
     resolution, main FIRST stashes the pending reveal (recovery key +
     revocation report) in main-side state and acquires the suppression
     holder — before any sheet interaction — THEN null-guards
     `rec.sheet`/`rec.win` (the window may have closed during the
     2–3-scrypt await; the naive `rec.sheet.closeMenuOverlay` would
     throw AFTER a durable commit and lose the reveal). Window alive →
     close credential sheet (`'activated'`) → send `vault-recovery-show
     {recoveryKey, replacing: true}` (post-write ordering; key never in
     the invoke reply). Window gone → the reveal stays pending and
     **re-surfaces on the next chrome boot** (recovery-show display
     needs no unlock). **App-quit while a reveal is pending loses it —
     accepted, documented residual**: not a lockout (the operator set
     the new master password and can re-mint a recovery key from it);
     goes in `docs/vault.md`. The card renders from the stashed report
     on the next state fetch regardless of whether the completion
     broadcast ever fired.
   - **Ack discrimination (design-review H1 — the cross-flow crux):**
     the pending compromise reveal is **per-window state keyed by
     chromeId** (the `_pendingAdoptAdminKeys` keying idiom; the
     resurface case re-keys to the new window when it re-opens the
     sheet). The `vault-recovery-show` activated branch checks the
     **adopt marker first, compromise marker second** (Q2 ruling:
     both-on-one-window is unreachable — a dismiss-locked sheet blocks
     the page — but the order makes even the impossible state
     deterministic); it consumes a window's compromise marker **only if
     present**: release the holder by exact `(chromeId, reason)` —
     never "any hold for this window" — then completion broadcast.
     Setup/rotate-recovery acks remain no-ops. **IPC-harness tests for
     all four ack kinds**: setup/rotate no-op; adopt-only;
     compromise-only; both flows in different windows (neither release
     touches the other).
   - `main.js` delegate maps store errors to `{ok:false, reason}` —
     note this diverges from the `VaultAuthError`-only sibling
     delegates: it catches `VaultPasswordReuseError` /
     `VaultFormatError` / `VaultBusyError` / `VaultStateError` into
     reasons and still rethrows unknowns.
4. **Refcounted suppression holder + adopt migration** (DD5):
   `acquire(chromeId, reason)`/`release(chromeId, reason)`, store flag =
   holders > 0, window-`close` teardown releases that window's holds
   (same hook point, `window-factory.js`). **The holder is a NEW
   unit-testable module** (design-review M2 — e.g. beside
   `pending-imports.js`, the exact extraction precedent): `main.js` may
   not be loaded by any test (the source-scan pin), so a main.js-scoped
   holder could not satisfy this leg's direct unit tests; main.js wires
   it, and the adopt stash/take/clear delegate their suppression halves
   to it. **Migrate `_pendingAdoptAdminKeys`' suppression onto the
   holder** (adopt logic otherwise untouched — Flight 3 removes it);
   **re-model squawk 0051's suppression pins to the holder contract by
   rename** (`test/unit/window-factory.test.js:~277-355` —
   fake-delegate-based; they would silently stay green modeling the
   retired `size===0` contract). New holder unit tests: refcount
   semantics, exact-`(chromeId, reason)` release, cross-flow
   interleaving (adopt reveal + compromise reveal concurrently in
   different windows — neither release un-suppresses the other),
   window-close release of that window's holds only.
5. **Completion state + card** (DD6): the revocation report held
   main-side in memory for the app session, exposed on the internal
   vault-state surface (additive fields: `adminProvisioned: boolean` —
   derived `store.adminPublicKey() !== null`; `compromiseReport:
   {admin, vaultIds} | null`). **Completion trigger (design-review M3,
   pinned): re-broadcast `vault-lock-state` at completion** — the page
   refreshes off that channel for free (`refresh()` → state invoke);
   verify chrome's handlers treat the duplicate unlocked state as inert
   (stale-guards). The dismiss channel clones the `internal-vault-lock`
   bare-IPC idiom (same registrar, `{ok:true}` shape). Page renders the
   R8-ruled card — title "Everything rotated", body copy from the Flight
   1 log, "Revoked keys" list with uniform "Revoked" hints (admin row
   first, then per-vault rows by display label, `'global'` rendered with
   its display label), rendering in BOTH view states regardless of entry
   lock state (the flow ends unlocked; the card renders wherever the
   page lands) — plus a dismiss affordance clearing the main-side report
   (new bare IPC). Master-key management renders its provision state
   from `adminProvisioned` (kebab's "Provision admin key" wording when
   false — existing action, relabeled state).
6. **Tests**: IPC handler suite (stubbed-sheet harness idiom —
   `vault-rotation-handlers.test.js:19-56`): both handlers' discipline,
   error mapping incl. `VaultPasswordReuseError`, success →
   close+suppress+recovery-show ordering, ack → release+broadcast.
   Holder suite per 4. Page-model lock-state matrix (R4/R8): entry row
   present in both states at the ruled positions; card renders in both
   states; `selectVaultView`-level tests where the page model allows.
   Seam-contract/a11y registry updates as their suites require.
7. **Docs** (`docs/vault.md`): Rotation & recovery — add compromise mode
   (what it rotates, required new master, single one-time recovery
   sheet, revocation report, v2 manager result, busy semantics); Threat
   model — the "already-extracted MRK survives every rotation" bullet
   gains its answer (compromise-mode rotation now exists; scope: severs
   the live profile, NOT previously exported bundles the operator
   holds — from leg 3's out-of-scope pins; plus the H2 accepted residual: an app-quit during a pending reveal loses the one-time display (recoverable — the operator knows the new master password and can re-mint)), and the on-disk format note
   mentions manager v2 optional-admin. No CLAUDE.md change (no new
   commands).

Out of scope: the behavior-test run and HAT (leg 5); any adopt-flow
behavior change beyond the suppression-holder migration (Flight 3);
automation/MCP surface changes (none — new menuTypes are
refused-by-default).

## Acceptance Criteria

- [x] AC1: Full flow wired — from either lock state: entry row → confirm
      modal (R3 copy) → compromise sheet (branch switch works) →
      pending → on success the reveal is stashed + held BEFORE sheet
      interaction, the recovery sheet appears under suppression AFTER
      the op resolves, ack releases + broadcasts, card renders with the
      correct revocation rows; IPC tests pin the ordering, the
      null-guarded window-gone path, and the resurface re-key. (DOM-level
      verification of copy/placement is leg 5's — see AC4 note.)
- [x] AC2: Error paths render the ruled copy per class (reuse / wrong
      credential / malformed display / busy / pre-commit failure), pinned
      in the handler suite.
- [x] AC3: Suppression holder (new module) replaces the boolean
      discipline for BOTH flows; the 0051 pins are renamed/re-modeled to
      the holder contract; the four ack-kind discrimination tests pass;
      cross-flow interleaving pinned; window-close release pinned.
- [x] AC4: Lock-state matrix pinned **at the page-model level where
      expressible** (design-review M4: vault.js has no DOM harness —
      DOM-level placement/copy pins are explicitly reassigned to leg 5's
      behavior test, which already carries them in its step table);
      `adminProvisioned` drives the master-key section state.
- [x] AC5: `docs/vault.md` updated as scoped; prose contradicts nothing
      shipped (spot-check against leg 1–3 outcomes).
- [x] AC6: `npm test` (4079 + new), `typecheck`, `lint`, `format:check`
      clean; seam-contract and a11y-registry expectations updated by
      rename/extension, never silent edits.

## Verification

Unit-level only in this leg (the live-app pass is leg 5's behavior test +
HAT): stubbed-sheet IPC harness, holder unit tests, page-model tests.
The renderer pieces that only a live app can show (sheet visuals, card
rendering) are exercised in leg 5 — this leg's tests pin logic and
contracts.

## Citation Audit (2026-09-01)

Leg-3 handoff quoted verbatim (same session). Registry-join list from the
flight's second Architect pass (verified 2026-09-01). R3/R8 copy from the
Flight 1 log's rulings (operator-approved verbatim). 0051 pin location
(`window-factory.test.js:278-350`) from the flight's second review.
Line anchors for menu-overlay/vault-controller regions are approximate
(~) by design — locate by symbol at implementation.
