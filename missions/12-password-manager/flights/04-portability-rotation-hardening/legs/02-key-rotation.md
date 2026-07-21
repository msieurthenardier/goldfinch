# Leg: key-rotation

**Status**: completed
**Flight**: [Portability + Rotation + Hardening + Docs](../flight.md)

## Objective

Wire the operator-secret rotation surface: rotate the recovery key, change the master password (with an
old-password step-up), and recover after a forgotten master password (recovery key → set a new master) —
each a constant-size `manager.json` rewrite (the MRK is never re-keyed, so `.gfvault` files are
untouched). All secret entry + one-time displays live on the chrome-owned sheet (DD2). *(Admin-key
rotation/provision was split to its own leg (`admin-key-provision`) at design review — distinct secret,
distinct crypto, independently testable.)*

## Context

- **Flight DD3** — recovery rotation is net-new, mirroring the existing (unwired)
  `changeMasterPassword` shape: require unlocked → step-up → rewrap the one `manager.mrk.*` slot →
  `_writeManager` → show the new one-time secret. `changeMasterPassword` gains an **old-password
  step-up**. The MRK is never re-keyed — verified, `changeMasterPassword` rewrites only
  `manager.mrk.master` (`vault-store.js:554`).
- **Flight DD2** — every master-equivalent secret ENTRY (master pw / old master pw for step-ups;
  recovery-key entry for the recover flow) + the one-time recovery DISPLAY is on the chrome sheet
  (Buffer channel; dismiss-locked show-once). **Note: the master-change sheet (old-pw + new-pw +
  confirm) and the recover sheet (recovery-string + new-pw + confirm) are NEW multi-field templates,
  not simple reuse of the single-secret `vault-stepup`.**
- **Step-up kinds:** recovery rotation re-prompts the **master password** (mission-mandated durable-
  grant step-up, `mission.md:147-148`); master change re-prompts the **old master password**
  (DD3 hardening); recover uses the **recovery key** as the step-up (it IS master-equivalent proof).
- **F1 primitives** — `changeMasterPassword` (`:548`, unwired, rewrites only `mrk.master` `:554`,
  rejects Buffer `:550`), the `mintAccessKey` **step-up pattern** (`vault-store.js:1119-1128` —
  re-unwrap `mrk.master`, `.fill(0)` the transient), `generateRecoveryKey`+`wrapRecovery`,
  `unlockWithRecovery`/`unwrapRecovery` + `parseRecoveryKey` (string), `unlockWithRecovery` (`:489`,
  caller-less), `_readManager`/`_writeManager`, `_requireMrk`, `_installMrk`, `unwrapMaster`.

## Inputs

- `src/main/vault/vault-store.js` — `changeMasterPassword`, `_readManager`/`_writeManager`, `_requireMrk`,
  `_installMrk`, `unlockWithRecovery`, the `mrk`/manager composition; `mintAccessKey`'s step-up pattern
  (`:1119-1128` — re-unwrap the master envelope, `.fill(0)` the transient) to mirror.
- `src/main/vault/vault-crypto.js` — `generateRecoveryKey`, `wrapRecovery`, `unwrapMaster`, `unwrapRecovery`,
  `parseRecoveryKey`.
- `src/renderer/menu-overlay.js` + `src/shared/modal-card-controller.js` + the F3/leg-1 sheet templates
  — the step-up + one-time-display sheet patterns to mirror.
- `src/main/register-overlay-ipc.js` — the sheet Buffer-channel handlers; `register-vault-ipc.js` — the
  request triggers; `src/renderer/pages/vault.{js,css}` — the settings/rotation section.

## Outputs

- **Store ops (net-new + one wiring, `vault-store.js`)** — all require unlocked, rewrite one
  `manager.mrk.*` slot, `_writeManager`, zeroize transient buffers:
  - `rotateRecovery({ masterPassword })` → **step-up** (re-unwrap `manager.mrk.master` with the entered
    master pw; wrong → throw, nothing rotated) → `generateRecoveryKey` → `manager.mrk.recovery =
    wrapRecovery(this.mrk, rec.material, {version:MANAGER_VERSION})` → write → `rec.material.fill(0)` →
    return `rec.display` (one-time).
  - `changeMasterPassword({ oldMasterPassword, newMasterPassword })` (extend the existing) → **step-up**
    (re-unwrap `manager.mrk.master` with `oldMasterPassword`; wrong → throw) → rewrap `manager.mrk.master`
    with `newMasterPassword` → write. **Accept `Buffer|string`** (mirror `setup`'s guard, `:401-405`).
  - `recoverMasterPassword({ recoveryDisplay, newMasterPassword })` — the recover-after-forgotten-master
    flow as a **SINGLE dedicated op** (review [HIGH]: NOT an `authenticated:true` flag on
    `changeMasterPassword` — that's a step-up bypass; NOT a two-call `recoverUnlock`+`change`): the
    **recovery key IS the step-up** — `const mrk = unwrapRecovery(manager.mrk.recovery,
    parseRecoveryKey(recoveryDisplay), {version:MANAGER_VERSION})` (wrong key → throw, nothing written)
    → `_installMrk(mrk)` (the user ends **unlocked** — they recovered) → `manager.mrk.master =
    wrapMaster(mrk, newMasterPassword, …)` → write. Uses `unlockWithRecovery`'s primitive internally.
- **Sheets** — the master-pw step-up reuses `vault-stepup`; **two NEW multi-field templates**:
  `vault-change-master` (old-pw + new-pw + confirm) and `vault-recover` (recovery-string + new-pw +
  confirm). The one-time new-recovery display reuses the dismiss-locked `vault-recovery-show`. The
  `confirm === new` check is renderer-side; only the secret fields cross the Buffer channel (dual-zeroized).
- **IPC/main/page** — the `menu-overlay:vault-rotate-recovery` / `:vault-change-master` /
  `:vault-recover` invoke handlers (dual-zeroize), the request triggers, the delegates; a **rotation/
  recovery section** on `goldfinch://vault` (Change master password / Rotate recovery key / "Forgot
  master password? Recover"). No secret in the page. The one-time recovery display opens only AFTER
  the store op returns (post-write ordering, the `vault-setup`→`vault-recovery-show` idiom).
- **a11y** — `vault-change-master` + `vault-recover` into `SHEET_STATES`/`NODE_IDS`.
- **Tests** — unit: each op rewrites ONLY `manager.mrk.master`/`.recovery` as appropriate (assert the
  other slots + `.gfvault` unchanged); new-secret-unlocks/old-secret-fails (recovery rotation: new
  recovery unlocks, old fails; master change: new master unlocks, old fails); step-up refuses a wrong
  password (nothing written); `recoverMasterPassword` (valid recovery → unlocked + new master unlocks;
  wrong recovery → nothing written; NOT a flag skip). Integration: the sheet Buffer channels
  (dual-zeroize, sender/token).

## Acceptance Criteria

- [x] **Recovery rotation** — with a master-password step-up, mints a new recovery key (shown once on
      the sheet); the **new** recovery key unlocks, the **old** one no longer does; only
      `manager.mrk.recovery` changed (`.gfvault` + the other slots untouched).
- [x] **Master change** — with an **old-password** step-up (wrong old pw refuses), the new master
      unlocks and the old no longer does; only `manager.mrk.master` changed.
- [x] **Recover after forgotten master** — the single `recoverMasterPassword` op: a valid recovery key
      unwraps the MRK (a wrong one refuses, nothing written), the user ends **unlocked**, the new master
      unlocks; only `manager.mrk.master` changed; the recovery entry is on the sheet (Buffer channel).
      It is **not** an `authenticated`-flag skip on `changeMasterPassword`.
- [x] Every step-up secret + one-time display is on the **chrome sheet**, never the page DOM / an
      `internal-*` payload (grep AC); every secret buffer is dual-zeroized.
- [x] Existing tests pass (the one forgotten-master test rewritten to `recoverMasterPassword` — the
      intentional `changeMasterPassword` contract change, assertions preserved); `npm test` 2572/0,
      `npm run typecheck`, lint clean.

## Verification Steps

- Unit: each op (slot-scoped rewrite; new-unlocks/old-fails; step-up refusal); the recover flow
  (valid recovery → unlocked + new master unlocks; wrong recovery → nothing written).
- Integration: the `menu-overlay:vault-rotate-recovery`/`-change-master`/`-recover` sheet channels
  (dual-zeroize, sender/token).
- `npm test` full — no regressions; the crypto/store suites green. typecheck + lint clean.
- Grep: no step-up/recovery/admin secret on any `internal-*` payload or page DOM path.

## Implementation Guidance

1. **Store ops** — add `rotateRecovery`/`recoverMasterPassword` + extend `changeMasterPassword`
   (old-pw step-up + `Buffer|string`, mirror `setup`'s guard `:401-405`), each mirroring the
   `mintAccessKey` step-up (`vault-store.js:1119-1128` — re-unwrap the master envelope, throw
   `VaultAuthError` on a wrong secret before any write; `recoverMasterPassword` re-unwraps
   `mrk.recovery` instead). Zeroize transient material.
2. **Sheets + IPC** — the master-pw step-up reuses `vault-stepup`; add `vault-change-master` +
   `vault-recover` multi-field templates + reuse `vault-recovery-show`. `menu-overlay:vault-rotate-recovery`
   / `:vault-change-master` / `:vault-recover` invoke handlers (Buffer, dual-zeroize, sender+token);
   the delegates in `main.js`.
3. **Page** — a rotation/recovery section on `goldfinch://vault`; each action triggers the step-up
   sheet then (where applicable) the one-time-display sheet. No secret in the page.
4. **a11y** — new sheet kinds into `SHEET_STATES`/`NODE_IDS`/`DISMISS_EXPR`.

## Edge Cases

- **Wrong step-up password** — throw before any write; nothing rotated; sheet re-prompts.
- **Rotation while locked** — `_requireMrk` throws → `{locked:true}` → route to unlock. (The recover
  flow is the exception: it works FROM locked, since the recovery key is its own step-up + installs the MRK.)
- **Recover flow** — the recovery key unwraps the MRK and installs it (user ends unlocked); the new
  master is authenticated by the recovery proof — a **single atomic op**, never a skip-flag.
- **Buffer zeroization** — every step-up/entry buffer + the transient recovery material, on success + throw.
- **One-time display dismissal** — dismiss-locked (only acknowledge closes; the new secret is unrecoverable).

## Files Affected

- `src/main/vault/vault-store.js` — `rotateRecovery`/`recoverMasterPassword` + `changeMasterPassword` step-up.
- `src/renderer/menu-overlay.js` (+ `src/shared/vault-change-master-template.js` / `vault-recover-template.js`) — sheets.
- `src/main/register-overlay-ipc.js` — the rotate invoke handlers.
- `src/main/register-browser-ipc.js` — the request triggers; `src/main/main.js` — the delegates.
- `src/preload/*` + `renderer-globals.d.ts` — bridge + types.
- `src/renderer/pages/vault.{js,css}` — the rotation/recovery section.
- `scripts/a11y-audit.mjs` — new sheet states.
- `test/unit/…` — the rotations, the step-ups, the recover flow, the sheet channels.

---

## Post-Completion Checklist

**Complete ALL before signaling `[COMPLETE:leg]`:**

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with the leg progress entry
- [x] Set this leg's status to `landed`
- [x] Check off this leg in flight.md
- [x] Do NOT commit (deferred-commit model — Flight Director commits at flight end)
