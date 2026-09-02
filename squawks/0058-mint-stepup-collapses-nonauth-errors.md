# Squawk 0058: Mint step-up sheet renders every failure as "Wrong master password" — including no-vault-for-jar

**Status**: completed
**Type**: defect
**Severity**: routine
**Completed**: 2026-09-02
**Reported**: 2026-09-01

## Report

Minting an access key for a jar with no vault file (no item ever saved
into it) fails with `VaultStateError('no vault for "<jar>" — save an
item first')` — but the operator sees "Wrong master password. Nothing was
minted." even with a correct password. Chain: the step-up unwrap
succeeds, `_mintAccessKey` throws `VaultStateError`
(`vault-store.js:2315-2317`); the main delegate maps only
`VaultAuthError` to `{ok:false}` so the invoke rejects
(`main.js:1786-1794`); `submitVaultStepup`'s catch collapses every
rejection into the wrong-password copy
(`menu-overlay.js:1498-1500, 1511-1517`). Fix shape (one read pass):
forward a non-secret reason through the delegate (the vault-import
precedent) and branch the sheet copy; and/or gate the jar-row mint
affordance on `hasVault`. Pre-existing (M12 F3 Leg 5 vintage — verified
byte-identical at pre-flight commit 2c5c144); surfaced 2026-09-01 during
Mission 18 Flight 2 leg-5 fixture setup on an item-less fresh profile.

## Evidence

- Live reproduction + worktree bisect to 2c5c144 (Flight 2 diagnosis,
  2026-09-01); cited lines above verified at HEAD af95fb1.
- Regression pins added (green, real-store):
  `test/unit/vault-stepup-mint-handler.test.js` — the
  correct-password/no-vault-file rejection is now modeled with a comment
  on the sheet-side collapse.

## Corrective Action

**Fix shape** (2026-09-02): widened non-secret reason-forwarding per the
Flight-2 compromise-delegate precedent (`main.js` `vaultCompromiseRotate`),
plus per-reason sheet copy. Reason-mapping + copy only — the delegates were
NOT restructured into a module (that extraction remains a named maintenance
item).

**Delegates (`src/main/main.js`)** — each keeps `VaultAuthError → { ok:false }`
(bare, no reason key — the auth path is byte-identical) and adds mappings only
for classes reachable at its sheet:

- `vaultMintAccessKey` (`main.js:1793-1802`): `VaultStateError →
  { ok:false, reason:'state' }` (the pinned no-vault-for-jar case,
  `vault-store.js:2315-2317`) and `VaultBusyError → { ok:false, reason:'busy' }`
  (mint is a gated op — `_enterGatedOp`, `vault-store.js:2287`).
- `vaultRotateRecovery` (`main.js:1866`), `vaultRotateAdminKey`
  (`main.js:1884`), `vaultChangeMaster` (`main.js:1901`): added
  `VaultBusyError → 'busy'` (reachable via the write sinks' second wall,
  `vault-store.js:554` — see Verification survey).
- `vaultRecover` (`main.js:1927-1928`): added `VaultFormatError → 'format'`
  (a typo'd recovery display — `parseRecoveryKey`,
  `vault-crypto.js:584-590`) and `VaultBusyError → 'busy'`.
- `vaultUnlock`: UNCHANGED (no non-auth class reachable — see survey).

**Handlers (`src/main/register-overlay-ipc.js`)** — the five sheet channels
forward the delegate's non-secret reason using the vault-import idiom
(`res && res.reason ? { ok:false, reason } : { ok:false }`): stepup-mint
(`:329`), rotate-recovery (`:430`), rotate-admin (`:470`), change-master
(`:506`), recover (`:545`). No new IPC shapes — the reply object gains only
the optional `reason` string the vault-import channel already established.

**Sheet copy (`src/renderer/menu-overlay.js`)** — three small named mappers
(the `vaultCompromiseErrorCopy` idiom), rendered from the submit else-branches:

- `vaultStepupErrorCopy` (`:1477`, used `:1534`): `'busy'` → "A rotation is
  already in progress." (the existing idiom); `'state'` in mint mode → "No
  vault for this jar yet — save an item into it first, then mint."; default →
  the three per-mode wrong-password strings, unchanged.
- `vaultChangeMasterErrorCopy` (`:1849`, used `:1897`): `'busy'` → rotation
  copy; default → "Wrong current master password. Nothing was changed."
  (unchanged).
- `vaultRecoverErrorCopy` (`:1974`, used `:2022`): `'busy'` → rotation copy;
  `'format'` deliberately shares the wrong-key default (truthful for a
  malformed key — the `vaultCompromiseRecoverErrorCopy` precedent).

All messages are non-secret (no paths, no jar contents, no key material).

## Verification

**Reachability survey** (which non-auth classes can actually reach each
delegate — re-read 2026-09-02 at the cited lines):

- **mint** (`vault-store.js mintAccessKey:2282-2293`): GATED op —
  `_enterGatedOp` (`:2287`) throws `VaultBusyError` at entry while a
  compromise rotation holds the re-key gate, and `_writeVault`'s second wall
  (`:584`) throws it mid-derive; `_mintAccessKey` (`:2315-2317`) throws
  `VaultStateError` on a no-vault jar with a CORRECT password. Both mapped.
- **rotate-recovery / rotate-admin / change-master**
  (`vault-store.js:1043-1110, 999-1030`): manager-lock ops with NO entry gate
  — but each ends in `_writeManager`, whose second wall
  (`vault-store.js:549-557`, `_assertNotRekeying:744-748`) throws
  `VaultBusyError` when the compromise re-key gate rises during their scrypt
  awaits (reachable: a second window can start Compromise Mode while these
  sheets are open). `'busy'` mapped. `VaultStateError` here is only
  'not set up' / empty-secret guards — unreachable through these sheets
  (they open only on a set-up profile; empty fields are guarded sheet-side)
  — NOT mapped.
- **recover** (`vault-store.js recoverMasterPassword:1124-1155`):
  `parseRecoveryKey` throws `VaultFormatError` on a typo'd display
  (operator-reachable on every submit; `vault-crypto.js:584-590` — invalid
  base32 char or wrong length); `_writeManager` second wall as above. Both
  mapped.
- **unlock** (`vault-store.js unlock:917-924`): read-only — no
  `_enterGatedOp`, no write sink, so `VaultBusyError` is UNREACHABLE;
  `VaultStateError('not set up')` unreachable through the unlock sheet (it
  only opens on a set-up profile); `VaultFormatError` requires an on-disk
  corrupt/tampered `manager.json` — not operator-actionable at the sheet, and
  the delegate's boolean reply shape would need widening (a new IPC shape,
  out of squawk scope). NOT widened.
- Residual (noted, not mapped — outside the annotated precedent's taxonomy):
  `VaultLockedError` from `_requireMrk`/`_assertMrkGeneration` can reach the
  step-up/change-master delegates if idle autolock fires while a sheet sits
  open; it still rejects and renders the wrong-password copy. Left for a
  follow-up squawk if judged worth a `'locked'` reason.

**Regression tests** (all at the stubbed-sheet harness layer, plus real-store
pins):

- `test/unit/vault-stepup-mint-handler.test.js`: stubbed per-reason
  forwarding for `'state'` and `'busy'`; the real-store no-vault green pin
  UPGRADED from asserting the collapse (rejected invoke) to asserting
  `{ ok:false, reason:'state' }`; NEW real-store busy pin (re-key gate up →
  `{ ok:false, reason:'busy' }`); real-store wrong-password pin now titled to
  assert the bare `{ ok:false }` (no reason key) — auth unchanged.
- `test/unit/vault-rotation-handlers.test.js`: busy forwarding on
  rotate-recovery and change-master; format + busy forwarding on recover.
- `test/unit/vault-admin-key-handlers.test.js`: busy forwarding on
  rotate-admin.
- `test/unit/vault-sheet-error-copy.test.js` (new): the renderer reason→copy
  mapping pinned as a source contract (the downloads-popup-contract idiom —
  `menu-overlay.js` runs only in the overlay webContents, so this is the
  available unit layer; live rendering remains behavior-covered-only).

**Battery** (2026-09-02, branch `squawk/turnaround-2026-09-02`): `npm test`
4131 pass / 0 fail (baseline 4120 + 11 new); `npm run typecheck` clean;
`npm run lint` clean; `npm run format:check` clean.

## Sign-Off

**Reviewer**: independent batch Reviewer (squawk turnaround 2026-09-02, scoped to the diff)
**Verdict**: confirmed — reachability survey spot-checked accurate (gated-op busy; second-wall busy on manager-lock rotations; parseRecoveryKey format; unlock verifiably read-only, correctly not widened); auth paths byte-identical; all copy non-secret; tests meaningful incl. the upgraded reason:'state' pin and a real re-key-gate busy pin. Residual VaultLockedError→'locked' logged as follow-up candidate.
**Commit**: `squawk/turnaround-2026-09-02` (via its PR)
