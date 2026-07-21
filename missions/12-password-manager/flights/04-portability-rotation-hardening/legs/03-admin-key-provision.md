# Leg: admin-key-provision

**Status**: completed
**Flight**: [Portability + Rotation + Hardening + Docs](../flight.md)

## Objective

Wire admin-key rotation and the from-scratch admin provision: with a master-password step-up, mint a
fresh X25519 admin keypair, re-seal `manager.mrk.admin` to the new public key + overwrite
`adminPublicKeyB64`, and show the new private key once on the chrome sheet. This closes F3's deferral
(the setup-minted admin private key was discarded, so the current seal is orphaned — provision mints
anew). A constant-size `manager.json` rewrite; no `.gfvault` touched.

## Context

- **Flight DD4** — admin rotation = eager one-pass re-seal; the from-scratch provision **must mint
  anew** (F3's setup key discarded, seal orphaned). Rotation and provision are the same op.
- **Leg-2 pattern** — `rotateAdminKey` mirrors `rotateRecovery` exactly (master-pw step-up via the
  `mintAccessKey`/`rotateRecovery` idiom → mint → re-seal one `manager.mrk.*` slot → `_writeManager` →
  one-time display), reusing the `vault-stepup` step-up sheet + a new dismiss-locked display sheet.
- **Step-up** — the master password (a durable admin credential warrants fresh confirmation).
- **F1 primitives** — `generateAdminKeypair()→{publicKey, publicKeyB64, privateKey, privateKeyB64}`
  (`vault-crypto.js:606`), `sealToAdmin(vaultKey, adminPublicKey, {version})` (`:450`), `openAdminSeal`
  (`vault-crypto.js:469`), `unlockWithAdmin` (`vault-store.js:518`, caller-less — stays deferred),
  `openAllWithAdminKey` (`vault-store.js:1278`, the seal-open round-trip), `unwrapMaster` (step-up),
  `_readManager`/`_writeManager`, `_requireMrk`, `mrk`/manager composition.

## Inputs

- `src/main/vault/vault-store.js` — the `rotateRecovery` shape (leg 2) to mirror; `manager.mrk.admin` +
  `manager.adminPublicKeyB64`; the `mintAccessKey`/`rotateRecovery` step-up (re-unwrap `mrk.master`);
  `openAllWithAdminKey` (`:1188`) for the round-trip test.
- `src/main/vault/vault-crypto.js` — `generateAdminKeypair`, `sealToAdmin`, `openAdminSeal`.
- `src/renderer/menu-overlay.js` + the leg-2/F3 sheet family — `vault-stepup` (step-up) +
  `vault-recovery-show`/`vault-accesskey-show` (the dismiss-locked one-time-display precedents).
- `src/main/register-overlay-ipc.js` (the rotate handlers), `register-browser-ipc.js` (triggers),
  `main.js` (delegates), `src/renderer/pages/vault.{js,css}` (the rotation section from leg 2).

## Outputs

- **Store op (net-new, `vault-store.js`)** — `rotateAdminKey({ masterPassword })` (require unlocked):
  step-up (re-unwrap `manager.mrk.master` with the entered pw; wrong → throw, nothing changed) →
  `const admin = generateAdminKeypair()` → `manager.mrk.admin = sealToAdmin(this.mrk, admin.publicKey,
  { version: MANAGER_VERSION })` → `manager.adminPublicKeyB64 = admin.publicKeyB64` (**both** — else a
  stale pubkey mismatches the seal + corrupts export) → `_writeManager` → return `admin.privateKeyB64`
  (one-time). Zeroize the transient step-up buffer.
- **Sheet** — the master-pw step-up reuses `vault-stepup`; a new dismiss-locked `vault-adminkey-show`
  (mirroring `vault-accesskey-show`) displays the new private key once + copy + acknowledge. The display
  opens only AFTER the store op returns (post-write ordering).
- **IPC/main/page** — `menu-overlay:vault-rotate-admin` invoke handler (Buffer, dual-zeroize,
  sender+token) → the `rotateAdminKey` delegate (VaultAuthError → `{ok:false}`); the request trigger; a
  "Provision / rotate admin key" action in the rotation section of `goldfinch://vault`. No secret in the
  page / `internal-*` payload.
- **a11y** — `vault-adminkey-show` into `SHEET_STATES`/`NODE_IDS` + `SHEET_DISMISS_EXPR` (dismiss-locked).
- **Tests** — unit: `rotateAdminKey` rewrites ONLY `manager.mrk.admin` + `adminPublicKeyB64` (the other
  slots + `.gfvault` untouched); the returned private key opens the seal AND `openAllWithAdminKey` opens
  **all** vaults (global + a jar) with the new key (the real multi-vault admin guarantee); the **OLD**
  admin private key no longer opens it (invalidation); step-up refuses a wrong master (nothing changed).
  Integration: the sheet Buffer channel (dual-zeroize, sender/token).

## Acceptance Criteria

- [x] `rotateAdminKey` (with a master-password step-up; wrong pw refuses) mints a fresh keypair,
      re-seals `manager.mrk.admin`, overwrites `adminPublicKeyB64`, and shows the private key once on the
      sheet; the returned key opens the admin seal (`openAllWithAdminKey`).
- [x] The **from-scratch provision** case works: on a manager whose admin seal is orphaned (setup key
      discarded), `rotateAdminKey` yields a usable admin key (same op).
- [x] The **old** admin private key no longer opens the seal after rotation (invalidation).
- [x] Only `manager.mrk.admin` + `adminPublicKeyB64` change; the `.gfvault` files + other mrk slots are
      byte-unchanged.
- [x] The step-up secret + the one-time private-key display are on the **chrome sheet**, never the page
      DOM / `internal-*` payload (grep AC); the buffer is dual-zeroized; the display is dismiss-locked.
- [x] Existing tests pass unmodified; `npm test`, `npm run typecheck`, lint clean.

## Verification Steps

- Unit: `rotateAdminKey` (slot-scoped rewrite; `openAllWithAdminKey` opens with the new key, fails with
  the old; step-up refusal → nothing changed); the from-scratch/orphaned-seal case.
- Integration: the `menu-overlay:vault-rotate-admin` channel (dual-zeroize, sender/token).
- `npm test` full — no regressions; crypto/store suites green. typecheck + lint clean.
- Grep: no admin private key / step-up secret on any `internal-*` payload or page DOM path.

## Implementation Guidance

1. **`rotateAdminKey`** — mirror leg-2's `rotateRecovery` (step-up → mint → re-seal ONE slot → write →
   return the one-time secret; zeroize the transient). Re-seal `manager.mrk.admin` AND overwrite
   `manager.adminPublicKeyB64`.
2. **Sheet + IPC** — reuse `vault-stepup` (a `mode:'rotate-admin'` init branch, like leg-2's
   `rotate-recovery`); add `vault-adminkey-show` (mirror `vault-accesskey-show`, dismiss-locked).
   `menu-overlay:vault-rotate-admin` handler + the delegate + the request trigger.
3. **Page** — a "Provision / rotate admin key" action in the leg-2 rotation section.
4. **a11y** — `vault-adminkey-show` into `SHEET_STATES`/`NODE_IDS`/`SHEET_DISMISS_EXPR`.

## Edge Cases

- **Wrong step-up password** — throw before any write; nothing changed; re-prompt.
- **Provision when a key exists** — same op; the prior admin key is invalidated (its seal is replaced).
- **Locked** — `_requireMrk` throws → `{locked:true}` → route to unlock.
- **Display dismissal** — dismiss-locked (only acknowledge closes; the new private key is unrecoverable).
- **Buffer zeroization** — the step-up buffer, on success + throw.
- **Export interaction** — a subsequent export bundles the new `mrk.admin` + `adminPublicKeyB64` (leg 1
  reads them live) — consistent.

## Files Affected

- `src/main/vault/vault-store.js` — `rotateAdminKey`.
- `src/renderer/menu-overlay.js` (+ `src/shared/vault-adminkey-template.js`) — the display sheet + stepup mode.
- `src/main/register-overlay-ipc.js` — the `vault-rotate-admin` handler.
- `src/main/register-browser-ipc.js` — the request trigger; `src/main/main.js` — the delegate.
- `src/preload/*` + `renderer-globals.d.ts` — bridge + types.
- `src/renderer/pages/vault.{js,css}` — the admin-key action.
- `scripts/a11y-audit.mjs` — `vault-adminkey-show`.
- `test/unit/…` — `rotateAdminKey` + the sheet channel.

---

## Post-Completion Checklist

**Complete ALL before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with the leg progress entry
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md
- [x] Do NOT commit (deferred-commit model — Flight Director commits at flight end)
