# Flight Debrief: Vault Trust-Boundary Hardening

**Date**: 2026-08-30
**Flight**: [Vault Trust-Boundary Hardening](flight.md)
**Status**: landed
**Duration**: 2026-08-29 (design) – 2026-08-30 (HAT + land)
**Legs Completed**: 4 of 4

## Outcome Assessment

### Objectives Achieved

The flight met its objective: the vault store no longer trusts two things on
its read paths that it shouldn't.

- **F2 (read-path KDF validation).** `_readManager` now calls
  `validateImportedKdf(doc.kdf)` at the single choke point every read funnels
  through (`vault-store.js:387`); out-of-bounds params fail closed. This
  closes the silent-KDF-downgrade vector (an attacker-lowered `N` on the
  un-step-up-gated `recoverMasterPassword` path, blocked before any write) and
  the absurd-`N` scrypt hang/OOM (rejected before derive).
- **F8 (forced fresh-adopt rotation + surfacing).** A fresh-profile adopt now
  rotates the recovery key and admin keypair inline under the live MRK, so
  neither donor envelope survives in the adopted manager; the two new one-time
  keys are surfaced sequentially (recovery, then admin only after the recovery
  key is acknowledged), with a store-side autolock-suppression flag holding the
  profile unlocked across the lockout-critical recovery reveal.

Verified: `npm test` **4003 / 4003 pass / 0 fail / 0 skip**; typecheck, eslint,
prettier clean. Guided HAT passed 2026-08-30 (live fresh adopt: sequential
recovery→admin sheet chain, no clobber, unlocked throughout; on-disk
`manager.json` confirmed recovery/admin/adminPublicKeyB64 rotated, master
retained). All three checkpoints (CP1–CP3) met.

### Mission Criteria Advanced

Advances **criterion 6** (Mission 17): "`manager.json` KDF parameters are
validated on read with a ruled legacy-compat policy, and a fresh-profile bundle
adopt forces recovery and admin key rotation before the profile is usable (F2,
F8)." This was Mission 17's last substantive flight. (The criterion checkbox and
the flight's "Code merged" box are held until PR #194 merges.)

## What Went Well

- **Risk-tiered per-leg design review — the flight's standout methodology win.**
  Both HIGH-tier legs got a mandatory pre-implementation design review, and both
  reviews *changed the design before a line of the risky code was written*:
  - Leg 2's review found the **`'superseded'` clobber** — sending
    `vault-adminkey-show` back-to-back after `vault-recovery-show` fires
    `'superseded'` (`menu-overlay-manager.js:325-355`) and would destroy the
    dismiss-locked recovery sheet before the user reads the one-time key: a
    **permanent lockout** on the recovery-adopt path. This triggered the divert
    (surfacing split into its own leg).
  - Leg 3's review proved the "document-and-defer" autolock fallback **unsafe**
    (after the first adopt `isSetUp()` is true, so re-adopt takes the
    unlock-gated existing-profile branch — a recovery-adopt user is permanently
    locked out), forcing the mandatory `_suspendAutoLock` guard.
- **RED/GREEN scrub on every code leg.** Each leg's log records the exact line
  reverted, which tests went RED, and restoration to GREEN — proving the tests
  pin the *new* behavior, not incidentally pass. Exemplary: Leg 1 (array-`kdf`
  row + recovery guard RED, old-guard rows stay GREEN — the new line and the old
  `:375` guard are pinned separately); Leg 3 (send both sheets immediately →
  sequential-guarantee tests RED).
- **Adversarial, on-disk security assertions.** The F2 test tampers `N`→2³⁰ and
  proves `mrk.master` is byte-identical on disk after a rejected recover (the
  actual attack, blocked before write). The F8 tests positively assert the DD4
  residual (donor master survives) and the negatives (donor recovery/admin keys
  rejected) for **both** adopt kinds.
- **A deviation handled the right way.** The suppression-clear timing
  (recovery-ack vs. the spec's admin-ack) was traced to a safety property at
  flight-end review and the AC text was **reconciled to the verified-safe
  shipped behavior**, with rationale recorded — rather than forcing the code
  back to a stale spec.
- **Strong leg specs** — line-cited, each with a "current code verified" context
  block and a dated Citation Audit; the flight-design recon caught the
  spec's pre-drift citations before legs were written.

## What Could Be Improved

### Process

- **Read the callee's preconditions before citing it as a reuse target.** The
  flight spec's Technical Approach said "force `rotateRecovery` +
  `rotateAdminKey` (existing functions)" — but both require a master-password
  step-up (they re-unwrap `manager.mrk.master`), so they are **not callable** on
  the recovery-adopt path (no master password). The design recon (DD2) caught
  this at the right gate, before implementation, so it cost conversation time,
  not rework — but citing a function's signature/line without reading its
  preconditions is a repeatable design miss. Add to the leg-design risk
  checklist: when a leg reuses an existing function across a context boundary,
  verify the calling context satisfies the callee's preconditions.
- **A foreseeable divert can be planned as a divert trigger.** The surfacing
  hazard was foreseeable enough to have been 4 legs from the start; the Flight
  Director instead pre-named it as the explicit divert trigger in the Session
  Notes and let the design review confirm the split. That is a legitimate (and
  arguably better) choice — don't split until the review confirms it's needed —
  but worth recognizing as the deliberate pattern it was.

### Technical

- **The window-teardown cleanup path is untested** (`clearAdoptAdminKeyForWindow`
  / the `window.on('close')` hook in `window-factory.js`). It drops the held
  one-time admin-key string *and clears autolock suppression* on a
  mid-surfacing window close — a lockout-adjacent safety path (a leaked
  suppression flag leaves the store un-autolockable), currently exercised only
  manually. This is the one place verification is thinner than the risk tier
  warrants. → **Action item / squawk.**
- **DD1's fail-closed rests on a standing coupling, not a proof for all time.**
  It holds only while `setup()` is the sole `kdf` writer and `SCRYPT_PARAMS`
  stays inside `validateImportedKdf`'s bounds. A future production-param bump
  past the import bounds, or a second kdf writer, would fail closed on
  *legitimate* managers. → a guard-test asserting `SCRYPT_PARAMS` passes
  `validateImportedKdf` makes the coupling fail loudly at test time. **Action
  item / squawk.**
- **The surfacing guarantee has no automated regression net.** The IPC-layer
  tests *stub* the sheet manager — they pin the handler logic (which channel
  fires when) but not the real `menu-overlay-manager` `'superseded'` interaction
  the whole sequential design exists to avoid. A future change to the
  activated-path or menuType chain could keep the unit tests green while the
  real clobber (and lockout) returns. The guided HAT is a one-shot, not a
  regression net. → author a **behavior-test spec** for the surfacing chain once
  the chrome MCP apparatus is restored (a fresh recovery-kind adopt → recovery
  sheet → ack → admin sheet, no clobber, unlocked). This is the single
  most-valuable follow-up; recorded as a recommendation (it needs the apparatus
  and is authored in planning, so it is not a squawk).
- **Minor debt, named:** a second recovery+admin minting site now duplicates
  `setup()`'s sequence (extract a shared `_mintRecoveryAndAdmin(mrk)` if a third
  appears); `_suspendAutoLock` is store-wide, not per-window (correct today via
  the per-window map's `size===0` gate, but a watch-item for any future
  multi-window-with-independent-vault-state change); and the neighbor
  `_pendingVaultImports` still has **no** teardown hook, now a visible asymmetry.

### Documentation

- `docs/vault.md` is current and accurate (Leg 4 reconciled the one stale
  "verbatim adopt" claim). No gap on the shipped behavior.
- **Missing:** the **sequential dismiss-locked sheet pattern** (stash → show
  first → chain second on ack, to avoid the `'superseded'` clobber) is a novel,
  reusable sheet-system idiom with no home in the sheet design notes — worth
  capturing so the next multi-one-time-sheet flow doesn't rediscover the clobber
  the hard way.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Leg 2 split into store-rotation + a separate surfacing leg (divert) | Design review found the two-sheet `'superseded'` lockout hazard; the crypto core and the UI sequencing risk warranted separate legs + a HAT gate | Yes — HIGH-tier legs get a design review empowered to restructure legs |
| Autolock guard upgraded from "document-and-defer" to a mandatory store-side `_suspendAutoLock` timer flag | The fallback's "re-adopt to recover" premise is false on the recovery-adopt path (existing-profile branch needs unlock) → permanent lockout | Yes — a modal one-time-secret reveal on a no-recoverable-credential path must suppress autolock |
| Suppression cleared at recovery-ack, not the spec's admin-ack | The lockout-critical secret is the recovery key (window closes at ack); `lockNow` never touches the sheet system, so the already-delivered admin key can't be lost | Yes — reconcile the spec to verified-safe shipped behavior, with rationale recorded |
| Rotation done inline under the live MRK, not via the public `rotateRecovery`/`rotateAdminKey` | Those require a master-password step-up the recovery-adopt path can't supply; the live MRK is already authenticated | n/a — mechanism specific to fresh adopt |

## Key Learnings

- **The pre-implementation design review pays for itself on trust-boundary
  work.** Two lockout-class failures were caught at the design gate, before any
  surfacing code existed. On HIGH-tier legs the review is not a formality — it
  restructured the flight and upgraded a mandatory guard.
- **"Adopt inherits a trustworthy donor manager" is now half-retired.** This
  flight killed it for recovery + admin, but left it standing for the master
  envelope (DD4): **after a fresh adopt, the donor's master password still
  unwraps the adopted vault.** For recovery-adopt the donor is fully severed;
  for master-adopt (or any donor who knows the master password) the donor
  retains full unlock access. This is a genuine, named gap — documented in the
  threat model, deliberately deferred — not a closed boundary.
- **Autolock is no longer "always safe to fire."** The store now has an explicit
  suppression concept; future modal one-time-secret reveals must consciously
  decide whether they need it too.

## Recommendations

1. **Schedule a "Vault Portability & Compromise-Mode" mission** that designs
   these interlocking pieces once, coherently — they share the
   MRK/master/recovery/admin envelope model and the one-time-sheet surfacing
   sequencing:
   - the **DD4 master-envelope severing** (a `changeMasterPassword` re-wrap on
     adopt) and **F6 MRK re-key / compromise-mode rotation** ("fully sever a
     party who once had access");
   - the **multi-jar export/adopt enhancement** discovered in the HAT (a global
     export carries only the global vault; the operator expected the whole
     profile — needs a source-jar→destination-jar mapping/selection step, and
     will re-enter *this* flight's forced-rotation + surfacing branch, likely
     multiplying the one-time-secret surfacing problem);
   - the deferred **admin "god mode"** feature (kin neighborhood).
   Designing any of these in isolation from the surfacing chain built here would
   be a mistake.
2. **Close the two automated-coverage gaps** on lockout-critical safety: a unit
   test for the window-teardown clear, and a guard-test coupling `SCRYPT_PARAMS`
   to `validateImportedKdf`'s bounds (both squawk-sized — see Action Items).
3. **Author a surfacing behavior-test spec** for regression once the chrome MCP
   apparatus is back — the sequential-chain / no-clobber guarantee is
   lockout-critical and currently has only manual (HAT) verification.
4. **Standardize the design-review checklist item**: "when reusing an existing
   function across a context boundary, verify the calling context satisfies the
   callee's preconditions" (the `rotateRecovery`/`rotateAdminKey` step-up miss).
5. **Capture the sequential dismiss-locked sheet pattern** in the sheet-system
   design notes.

## Action Items

- [x] **Squawk 0051** (logged): add a unit test for the window-teardown cleanup path
  (`clearAdoptAdminKeyForWindow` / `window.on('close')`) — assert the close
  handler drops the pending admin-key record and clears `_suspendAutoLock` for
  the resolved chrome id.
- [x] **Squawk 0052** (logged): add a guard-test asserting `vc.SCRYPT_PARAMS` passes
  `validateImportedKdf` (so a future param bump or second kdf writer fails loudly
  at test time, not silently at a user's unlock).
- [ ] **Recommendation (not a squawk)**: author a behavior-test spec for the
  fresh-adopt surfacing chain (recovery → ack → admin, no clobber, unlocked) —
  run once the chrome MCP apparatus is restored.
- [ ] **Recommendation (not a squawk)**: scope a "Vault Portability &
  Compromise-Mode" mission (DD4 master severing + F6 compromise-mode + multi-jar
  export/adopt + god-mode). The multi-jar enhancement is logged in the flight
  log Anomalies.
- [ ] **Backlog note**: give `_pendingVaultImports` the same window-teardown
  cleanup as `_pendingAdoptAdminKeys` (consistency; low sensitivity — holds a
  bundle, not a raw secret).
- [x] **Squawk 0053** (logged): capture the sequential dismiss-locked sheet
  pattern in the sheet-system design notes.
