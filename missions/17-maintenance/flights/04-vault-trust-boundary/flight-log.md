# Flight Log: Vault Trust-Boundary Hardening

**Flight**: [Vault Trust-Boundary Hardening](flight.md)

## Summary

Flight design ruled 2026-08-29 (Lever/DD conversation): both open questions
resolved — F2 fail-closed (DD1), F8 bounded to recovery+admin rotated inline
under the live MRK (DD2–DD4). Two legs: `kdf-params-validated-on-read`,
`fresh-adopt-forces-rotation`, plus a docs step. In-flight on
`flight/04-vault-trust-boundary`.

---

## Leg Progress

### Leg 1 — kdf-params-validated-on-read (F2, HIGH) — landed 2026-08-29

- **AC1 (choke-point validation).** Added `validateImportedKdf(doc.kdf)` inside
  `_readManager()` (`src/main/vault/vault-store.js:381`), immediately after the
  pre-existing `if (!doc.kdf || typeof doc.kdf !== 'object')` guard, with a
  provenance comment citing `M17 F4 DD1` (fail-closed KDF validation on read).
  Nothing else in the function or file changed. Single source of truth — no other
  read path adds its own kdf check.
- **AC2/AC3 (tests).** New file
  `test/unit/vault-store-kdf-read-validation.test.js` (mirrors the
  `makeStore`/`FAST_SCRYPT`/`managerPath` harness and the
  `assert.throws(() => makeStore(dir), (e) => e instanceof vs.VaultFormatError)`
  idiom from `vault-store.test.js`). 16 tests: a 14-row truth table (N below
  min / above max / non-power-of-two / non-numeric; r>max & r<min; p>max &
  p<min; maxmem below the tampered-doc floor of 128·N·r = 4 MiB for
  FAST_SCRYPT N=2^12,r=8 / above 512 MiB cap / non-integer; algo≠scrypt; the
  **array-valued `kdf: []`** row that reaches the NEW call past the `:375`
  guard; and a missing-kdf row that pins the OLD guard), the untampered-loads
  case, plus the AC3 recovery-path guard (tampers `kdf.N` to 2^30 on disk and
  calls `recoverMasterPassword` on the ALREADY-LOADED instance — rejects with
  `VaultFormatError` and leaves `mrk.master` byte-identical on disk: silent
  KDF-downgrade blocked before any write, and no scrypt hang/OOM since it
  throws before derive).
- **RED/GREEN scrub.** New file green in isolation (16/16). Commented out the
  AC1 `validateImportedKdf(doc.kdf)` line → array-kdf truth-table row AND the
  recovery-path guard both went RED (the missing-kdf row and untampered-loads
  row stayed GREEN, correctly pinned by the OLD `:375` guard); restored the
  line → 16/16 GREEN again.
- **AC4 (no regression).** Canonical `npm test` (globs `test/unit/*.test.js`):
  **before 3982 pass / 0 fail, after 3998 pass / 0 fail** (+16 = exactly the
  new tests; baseline measured by stashing the source edit and setting the new
  file aside). `npm run typecheck`, `npx eslint .`, `npx prettier --check .`
  all clean (exit 0).
- **Deviations.** None. Scope held to the F2 read-path validation; no other
  files touched.

### Leg 2 — fresh-adopt-forces-rotation (F8, HIGH) — landed 2026-08-29

- **AC1 (inline forced rotation).** In `importVault`'s fresh-adopt branch
  (`!this.isSetUp()`, `src/main/vault/vault-store.js`), after the vault write
  and before `_writeManager`, mint a fresh recovery key and admin keypair under
  the already-live `mrk` (`vc.generateRecoveryKey()` → `vc.wrapRecovery(mrk,
  rec.material, { version: MANAGER_VERSION })`; `vc.generateAdminKeypair()` →
  `vc.sealToAdmin(mrk, admin.publicKey, { version: MANAGER_VERSION })`) and
  write THOSE into the adopted manager: `mrk.recovery = recoveryEnv`,
  `mrk.admin = adminEnv`, `adminPublicKeyB64 = admin.publicKeyB64` — instead of
  the donor's. `mrk.master = bundle.mrk.master` retained verbatim (DD4). No
  master-password step-up (the live MRK already authenticates the wrap — works
  for both adopt kinds). `rec.material` zeroized post-wrap (mirrors `setup()`).
  The `_installMrk(mrk); mrk = null` handoff and the `finally` dual-zeroize are
  untouched.
- **AC2 (return shape).** The fresh branch now returns the 5-field shape
  `{ imported: true, fresh: true, vaultId, recoveryKeyDisplay: rec.display,
  adminPrivateKeyB64: admin.privateKeyB64 }`. The existing-profile return
  (`{ imported, fresh: false, vaultId }`) is UNCHANGED. JSDoc `@returns`
  widened with the two optional fresh-only fields (typecheck clean). Confirmed
  single consumer: `main.js:962` (`vaultImportFromSheet`, does not destructure
  the store return); renderer `importVault` rides the IPC `{ ok }`, not the
  store return — so the two new fields break no destructuring.
- **AC3/AC5 (tests, `test/unit/vault-export-import.test.js`).** Three EXISTING
  assertions that encoded the pre-rotation "verbatim adopt" contract were
  REWRITTEN (not restored):
  - the `assert.deepEqual(res, {imported,fresh,vaultId})` → asserts the fixed
    trio plus `typeof recoveryKeyDisplay/adminPrivateKeyB64 === 'string'` and
    non-empty (dynamic secrets);
  - the `mrk[slot]` verbatim-equality loop + `adminPublicKeyB64` equality →
    inverted: `mrk.master` stays `deepEqual` (DD4), `mrk.recovery`/`mrk.admin`
    now `notDeepEqual` and `adminPublicKeyB64` `notEqual` the donor's; `kdf`
    stays `deepEqual`;
  - the "unlock by SOURCE RECOVERY key" test → rewritten: the source recovery
    key is now REJECTED (`VaultAuthError`) and the RETURNED new recovery key
    unlocks.
  Both `secretKind: 'master'` and `secretKind: 'recovery'` fresh adopts now
  each assert the full AC3 set (recovery/admin/pubkey rotated, master retained,
  returned recovery unlocks, returned admin private key opens via
  `openAllWithAdminKey` while the OLD donor admin key is rejected — mirroring
  `vault-admin-key-provision.test.js:120-124`). The `makeSource()` helper now
  captures and returns the donor `adminPrivateKeyB64` so the old-key-rejected
  assertion has the donor key to test. The stale file-header comment (which
  claimed the source recovery key still unlocks) was updated.
- **RED/GREEN scrub.** Temporarily reverted the AC1 recovery substitution
  (wrote `bundle.mrk.recovery` back into the adopted manager): both fresh-adopt
  tests went RED on `'recovery envelope was rotated'` (12 → 10 pass / 2 fail).
  Restored → 12/12 GREEN.
- **AC6 (no regression).** Canonical `npm test` (globs `test/unit/*.test.js`):
  **before 3998 pass / 0 fail, after 3998 pass / 0 fail** (the three existing
  tests were rewritten in place — no net count change; AC3's both-kinds
  coverage folded into the two rewritten fresh-adopt tests). `npm run
  typecheck`, `npx eslint .`, `npx prettier --check .` all clean (exit 0).
  `npm run a11y` not run (no DOM markup change — surfacing is Leg 3).
- **Deviations.** None. Store-only surface held: no `main.js` /
  `register-overlay-ipc.js` / `menu-overlay.js` / schema changes. The only
  shared-interface touch is `importVault`'s fresh-path return (the stated,
  single-consumer scoped change). Leg 1's uncommitted changes left intact.

### Leg 3 — surface-adopted-keys (F8 surfacing half, HIGH) — landed 2026-08-29

- **Files touched.** `src/main/main.js` (AC1 delegate + the pending-admin-key
  store & lifecycle), `src/main/register-overlay-ipc.js` (AC2 handler + AC3
  activated-chain), `src/main/vault/vault-store.js` (AC4 timer-only suppression),
  `src/main/window-factory.js` (AC4 teardown cleanup), plus tests
  `test/unit/vault-import-handler.test.js` (AC5) and `test/unit/vault-store.test.js`
  (AC4 store seam). No sheet template / DOM markup changed — surfacing REUSES the
  existing `vault-recovery-show` / `vault-adminkey-show` sheets (so `npm run a11y`
  was not required).
- **AC1 (delegate forwards fresh-adopt secrets).** `vaultImportFromSheet`
  (`main.js`) now CAPTURES `importVault`'s return: a fresh adopt returns
  `{ ok:true, fresh:true, recoveryKeyDisplay, adminPrivateKeyB64 }`, an
  existing-profile adopt `{ ok:true, fresh:false }` (no secrets); failure/collision
  unchanged. Maps the store's `imported`→`ok`. Secrets ride the DELEGATE return
  only — never the invoke reply, never any page DOM.
- **AC2 (handler shows recovery + stashes admin key).** In the
  `menu-overlay:vault-import` handler, on `res.ok && res.fresh === true`: close the
  import sheet, `stashAdoptAdminKey(chromeId, adminPrivateKeyB64)` (keyed by the
  window chrome id, mirroring `_pendingVaultImports`; also SETS store autolock
  suppression), then `send('vault-recovery-show', { recoveryKey, replacing:true })`.
  Invoke still returns a bare `{ ok:true }` (no secrets). Existing-profile path
  byte-unchanged (no sends, no stash).
- **AC3 (chain: adminkey-show only after recovery ack).** In the
  `menu-overlay:activated` handler, AFTER the existing `closeMenuOverlay`: when
  `current.menuType === 'vault-recovery-show'`, `takeAdoptAdminKey(chrome.id)`
  returns the pending key (or `undefined`); on a value, `send('vault-adminkey-show',
  { adminPrivateKey })`. `take` drops the pending record AND clears suppression. A
  recovery-show with no pending key (setup / rotate-recovery) returns `undefined` →
  inert. Exactly one show sheet open at any time.
- **AC4 (autolock suppression — the mechanism as implemented).** Store-side
  `_suspendAutoLock` boolean (constructor-initialized `false`) consulted ONLY in the
  `_touch` timer callback: when set, the fired timer RE-ARMS (`this._touch()`)
  instead of `lockNow()`; a public `setAutoLockSuspended(bool)` toggles it. TIMER
  SURFACE ONLY — no crypto/rotation/`_installMrk` path touched (so the "too
  invasive" escape hatch never applied; scope held). Driven from main via a
  main-side pending-admin-key `Map` (chromeId→string): `stashAdoptAdminKey` SETs
  suppression, `takeAdoptAdminKey`/`clearAdoptAdminKeyForWindow` CLEAR it once the
  map is empty. `adminPrivateKeyB64` is an immutable JS string (NOT
  `fill(0)`-zeroizable), consistent with the existing one-time-secret handling
  (recovery display, mint secret) — dwell minimized (dropped on the recovery-show
  ack, or on teardown).
- **Teardown cleanup approach.** `_pendingVaultImports` has no dedicated
  window-destroyed hook, so the nearest live per-window teardown precedent was
  matched: `window-factory.js`'s `win.on('close')` block (alongside
  `authChallenges?.cancelForWindow(record)`) now calls
  `clearPendingAdoptAdminKey?.(chromeForAttachment(win)?.id)` — dropping the held
  one-time admin-key string AND clearing suppression when a window closes
  mid-surfacing (recovery-show shown, not yet acked), keyed by the chrome id still
  resolvable during `close` (before the `closed`→`registry.remove`). A no-op when
  the window held nothing (never force-constructs the store).
- **AC5 (IPC-layer tests).** `vault-import-handler.test.js`: made the harness's
  `getCurrentMenu` MUTABLE (was a fixed `{token:7,menuType:'vault-import'}` stub),
  captured the `menu-overlay:activated` listener, and injected faithful
  stash/take fakes that mirror main's suppression toggling (a `suspendCalls`
  transition log). Four new tests, all CHANNEL-FILTERED (`sendsOn(...)`) since the
  activated handler also echoes `menu-overlay-activated`: (1) fresh adopt → exactly
  one `vault-recovery-show`, NO `vault-adminkey-show`, `suspendCalls===[true]`,
  admin key stashed, invoke reply bare `{ok:true}`; (2) recovery-show ack → exactly
  one `vault-adminkey-show` with the admin key, pending dropped,
  `suspendCalls===[true,false]`; (3) existing-profile adopt → NEITHER channel, no
  suppression, even a stray recovery-show ack inert; (4) a non-adopt recovery-show
  ack fully unaffected. AC4 store seam separately covered in `vault-store.test.js`:
  a fired idle timer RE-ARMS (does not lock) while suspended, then locks on the
  next fire once cleared (fake-timer harness mirroring the existing idle-timer
  test).
- **RED/GREEN scrub.** Temporarily made the handler send BOTH shows immediately in
  the fresh branch (no chaining): tests 10 ("no adminkey-show before ack") AND 11
  went RED (11 pass / 2 fail) — the sequential guarantee is genuinely pinned.
  Restored → 13/13 GREEN.
- **AC7 (no regression).** Canonical `npm test` (globs `test/unit/*.test.js`):
  **before 3998 pass / 0 fail, after 4003 pass / 0 fail** (+5 = 4 new AC5
  handler tests + 1 AC4 store test; no existing test rewritten). `npm run
  typecheck`, `npx eslint .`, `npx prettier --check .` all clean (exit 0).
- **Deviation (named, reconciled at flight-end review).** AC4's prose said
  suppression should hold "across the WHOLE surfacing (until admin-key ack)", but
  the implementation clears it at the **recovery-show ack** (AC3's concrete
  clear-condition — pending drop). The flight-end Reviewer traced this and ruled it
  **functionally safe**: `lockNow()` (`vault-store.js:508-524`) only zeroizes
  in-memory key buffers and fires `onLock` → `broadcastVaultLockState()` (a lock-state
  push to the vault *page*, `main.js`), and touches nothing in the `menu-overlay`
  sheet system; the `vault-adminkey-show` sheet already holds its one-time value
  client-side (delivered by a single `send()`), so an idle autolock firing while it
  is open cannot close/blank/lose the admin key. The lockout-critical secret is the
  RECOVERY key, and its window is closed at recovery-ack. AC4's leg text has been
  reconciled to match (clear at recovery-ack, with this rationale). Architecture
  note: the pending-admin-key store + suppression driving live in `main.js`
  (co-located with `_pendingVaultImports`) and reach the electron-free overlay
  registrar as two bound delegates (`stashAdoptAdminKey` / `takeAdoptAdminKey`) plus
  one teardown delegate into `window-factory` — keeping the registrar store-decoupled.
  **AC6 (the guided HAT) is NOT yet performed — it is the operator-driven gate the
  Flight Director runs; the flight does not commit until it passes.**

### Leg 4 — vault-docs (F2 + F8 documentation, LOW) — landed 2026-08-29

- **Single file touched.** `docs/vault.md` only — no source or test edits (Legs
  1–3 own those). Documents the shipped behavior of Legs 1–3.
- **AC1 (read-path KDF validation).** Added a **"KDF params validated on read
  (fail-closed)"** note in the `## On-disk format` section, immediately after the
  existing "Load-loudly, never quarantine" note (chosen over the kdf-field
  description so it sits beside the sibling load-path invariant). States that
  `_readManager` calls `validateImportedKdf(doc.kdf)` on every read
  (unlock / rotate / recover / export), that out-of-bounds params refuse to open
  (fail-closed), that `setup()` is the only writer and only writes in-bounds
  values (so recovery is by re-importing from a trusted bundle), and names the
  **silent-KDF-downgrade** vector this closes (attacker-lowered `N` on the
  un-step-up-gated recovery path).
- **AC2 (fresh-adopt forced rotation).** Rewrote the `## Portability` "Fresh
  profile" adopt bullet AND added a **"Fresh-profile adopt forces these two
  rotations up front"** note after the `## Rotation & recovery` table. Both state
  the forced recovery + admin rotation (inline under the live bundle MRK, no
  master-password step-up), that the donor retains neither the recovery key nor
  the admin private key, that the two one-time keys are shown once (recovery
  first, admin only after the recovery key is acknowledged), and that the profile
  stays unlocked until the lockout-critical recovery key is acknowledged.
- **AC3 (DD4 master-residual).** Added a new bullet — **"The donor's master
  password after a fresh-profile adopt"** — to the threat model's "does NOT
  protect against" list, placed directly beside the squawk-0022
  already-extracted-MRK bullet. States adopt rotates recovery + admin but NOT the
  donor's master envelope (the donor's master password still unwraps the adopted
  vault), and that fully severing the donor is a `changeMasterPassword`
  (compromise-mode backlog), not done by adopt.
- **AC4 (squawk 0022 bullet).** Verified present — the **"A party that already
  extracted the MRK"** bullet is already in the "does NOT protect against" list.
  NOT re-added; the new DD4 residual bullet was placed beside it.
- **AC5 (no stale claims).** Grepped for `import` / `adopt` / `verbatim`. The one
  stale claim was the old "Fresh profile" bullet: it said adopt writes
  `manager.json` from the bundle (i.e. the donor's manager verbatim) and that
  "the source master password / recovery key unlock this profile on restart."
  Reconciled in the AC2 rewrite — the bullet now states the recovery/admin
  envelopes are re-minted (not copied verbatim), the source master password still
  unlocks (master envelope retained, DD4), but the source recovery key is rotated
  away and no longer opens the profile. No sentence anywhere implies KDF params
  are validated only on import (the import-time call was already described; the
  new AC1 note adds the read-path breadth).
- **AC6 (clean).** `npx prettier --check docs/vault.md` clean, `npm run
  typecheck` clean, `npx eslint .` clean (all exit 0). Full test suite NOT run —
  no code changed.
- **Deviations.** None. Scope held to `docs/vault.md`; Legs 1–3's uncommitted
  changes left intact.

---

## Decisions

---

## Deviations

- **Leg split (divert), 2026-08-29 — surfacing separated from store rotation.**
  Leg 2's design review returned a [HIGH] finding: revealing the two new
  one-time secrets requires opening `vault-recovery-show` then
  `vault-adminkey-show` back-to-back, but the chrome sheet manager fires
  `'superseded'` on a menuType change (`menu-overlay-manager.js:325-355`), so
  the second `send()` would destroy the dismiss-locked recovery sheet BEFORE
  the user reads it — a permanent lockout on the recovery-adopt path (that
  user holds no donor master password, and their source recovery key is
  rotated away). Per the leg's own flagged divert, surfacing is split out:
  **Leg 2** is now store-only (rotation + return shape + store tests,
  independently unit-testable, crypto core approved SOUND); **Leg 3
  `surface-adopted-keys`** owns the UI, in the `register-overlay-ipc.js`
  delegate layer (reviewer medium-2 — the only seam compatible with the
  existing IPC test harness and matching the rotate-* precedent), with a
  sequential recovery-ack → adminkey-show chain and a guarantee the profile
  stays unlocked until both one-time sheets are acknowledged (closes the
  lockout window). Docs shift to **Leg 4**. Deferred single commit means the
  rotate-but-unsurfaced intermediate never ships.

---

## HAT — Leg 3 AC6 (guided, operator-driven) — PASSED 2026-08-30

Live fresh-profile adopt on the dev build (`goldfinch-dev`), master-kind adopt
of a global-vault bundle onto a freshly-emptied profile (real vault moved aside
to `vaults.hat-backup`, restorable):

- **Recovery sheet appeared** with a new recovery key and stayed up until the
  operator acknowledged it (no premature clobber).
- **On acknowledgment, the admin-key sheet appeared** with a new admin private
  key — the sequential recovery→admin chain, exactly as designed (no back-to-back
  `'superseded'` clobber of the one-time recovery key).
- **Vault landed unlocked and usable** throughout; no lockout.
- **On-disk confirmation** (adopted `manager.json` vs the source backup): `mrk.recovery`
  DIFFERS, `mrk.admin` DIFFERS, `adminPublicKeyB64` DIFFERS (all rotated), `mrk.master`
  IDENTICAL (donor master retained — the DD4 residual, by design); adopted
  `global.gfvault` byte-identical to source (348→348 B, no item loss).
- **Note (not a defect):** the operator observed the adopted vault had no secrets —
  because a *global* export bundle carries only the global vault (which was empty),
  not the jars. Logged as a future-flight enhancement in Anomalies below; unrelated
  to this flight's trust-boundary change.

## Anomalies

- **Enhancement discovered during the Leg 3 HAT (2026-08-30): export/adopt is
  single-vault; no multi-jar portability.** The operator exported the global
  vault expecting the whole profile (all jars) to travel with it; a global
  export bundle carries ONLY the global vault (existing design — `exportVault`
  builds a one-vault bundle), so the adopted fresh profile showed an empty
  vault. **Not a defect and not caused by this flight**: the fresh adopt
  round-tripped the global vault byte-identically (348→348 B), and item
  decryption is untouched (items live under the vault key inside `.gfvault`,
  wrapped by the MRK, which this flight never re-keys). **Captured as a FUTURE
  FLIGHT candidate, explicitly NOT a squawk** — it adds new user-visible
  capability and needs design decisions (which jars an export includes; a
  source-jar → destination-jar mapping/selection step on adopt), failing the
  squawk qualification gate. Operator's own framing: "there would need to be a
  step where I get to choose which jar vaults to restore to which jars."
  Recommend routing to a future vault-portability flight (kin to the deferred
  god-mode and F6 compromise-mode backlog items). Flagged for the Flight 4
  debrief to pick a vehicle.

---

## Session Notes

### Flight Director Notes

- **Leg 3 design review — approve with changes; incorporated (1 cycle).** The
  chain hook is confirmed `menu-overlay:activated` (`{id:'ack'}`, the only
  close path for the dismiss-locked recovery sheet). The **[HIGH]** correction:
  AC4's document-and-defer fallback is UNSAFE — after the first adopt
  `isSetUp()` is true, so a re-adopt takes the unlock-gated existing-profile
  branch (`_requireMrk`, `vault-store.js:1097`); a recovery-kind adopter holds
  no master password and the donor recovery key was rotated away, so a new
  recovery key lost to autolock is a **permanent lockout**. Ruling: autolock
  suppression is MANDATORY — a store-side `_suspendAutoLock` boolean consulted
  in the `_touch` timer callback (`:464-465`), driven from main (set on
  admin-key stash, cleared at recovery-ack/pending-drop + window teardown — see
  the reconciled Leg 3 Deviations note above; the design review originally said
  "admin-ack" but recovery-ack was ruled equivalent-and-safe). It touches only
  the timer surface, not Leg 2's crypto, so
  the "too invasive" escape hatch does not apply. AC5 re-scoped to the delegate
  return-shape branches (delegate is stubbed at the IPC layer, so `secretKind`
  is vacuous there; both-kinds coverage lives in Leg 2's store tests) with a
  mutable-`getCurrentMenu` harness note and channel-filter assertions. Pending
  admin-key (a non-zeroizable string) drops on ack + window-teardown cleanup.
  No second review cycle: the reviewer prescribed and validated the exact
  revised mechanism.

- **Phase file loaded**: `.flightops/agent-crews/leg-execution.md` (structure
  valid: Crew / Interaction Protocol / Prompts all present).
- **Citation drift corrected.** The flight spec's Technical Approach cites
  pre-drift line numbers. Current code (verified 2026-08-29): `vault-store.js`
  is at `src/main/vault/vault-store.js` (not `src/main/vault-store.js`), 1812
  lines. `_readManager` at `:355` (kdf check `:375`); `validateImportedKdf` at
  `:215` (called on import at `:1002`); `recoverMasterPassword` (the
  un-step-up-gated recovery path) at `:868`; `rotateRecovery` at `:790`,
  `rotateAdminKey` at `:832`; `importVault` fresh-adopt branch writes the
  donor manager around `:1050`. Legs will cite current lines.
- **F2 ruling — fail closed (DD1).** Recon finding that drove it: `setup()`
  (`:583`) is the ONLY writer of `manager.json.kdf`, and it writes
  `vc.SCRYPT_PARAMS` (N=2^17, r=8, p=2, maxmem=192 MiB — `vault-crypto.js:52`),
  which is comfortably inside `validateImportedKdf`'s bounds (`:215`). So no
  legitimately-written manager is ever out-of-bounds → there is no installed
  base to repair → refuse-to-open is both simpler and strictly safer than
  repair-on-unlock. Operator confirmed fail-closed.
- **F8 ruling — inline rotation under the live MRK (DD2), forced one-time
  sheets (DD3), master residual documented (DD4).** Recon finding that drove
  the mechanism: BOTH `rotateRecovery` (`:790`) and `rotateAdminKey` (`:832`)
  require a master-password step-up (they re-unwrap `manager.mrk.master`), but
  a fresh adopt via `secretKind: 'recovery'` has no master password — so the
  spec's literal "use the existing functions" is not callable on that path.
  The fresh-adopt branch already holds a live authenticated `mrk`; rotation is
  therefore done inline there under that MRK (re-mint recovery + admin, write
  fresh envelopes instead of the donor's), returning the two one-time secrets
  so the handler drives the existing sheets. Operator confirmed bounded scope:
  the donor's MASTER envelope residual is documented, not fixed here (F6/
  compromise-mode backlog).
- **Debrief carry-forward (Flight 3).** Treat the new template `scrub()`
  closures as part of the vault trust boundary (relevant to leg 2's key-display
  sheets). The brittle `sheet-automation-gate-invariant.test.js` AC8 grep pin
  is a Flight-3 concern, not on this flight's read-path surface — not retired
  here unless a leg incidentally touches it.
- **Both legs tier HIGH** (security-sensitive crypto trust decisions; leg 2
  changes `importVault`'s fresh-path return shape — a shared interface). Each
  gets a per-leg design review.
- **Leg plan (3 legs).** Leg 1 `kdf-params-validated-on-read` (F2, HIGH),
  Leg 2 `fresh-adopt-forces-rotation` (F8 full vertical slice: store rotation
  + one-time-sheet surfacing + tests, HIGH), Leg 3 `vault-docs` (LOW —
  docs/vault.md read-path + adopt + DD4 residual + squawk 0022 threat-model
  bullet, a shared-surface docs bundle for both findings, so it is one docs
  leg rather than split across the two code legs). Deferred single commit at
  flight end (agentic-workflow Phase 2d), so the store-rotates-but-UI-unwired
  intermediate never ships independently.
- **Leg 2 surfacing is the watch item.** No existing flow shows two one-time
  sheets back-to-back; the design review must confirm the recovery-show →
  adminkey-show chain is feasible in-session, else surfacing splits into a
  HAT-verified leg (a divert).
