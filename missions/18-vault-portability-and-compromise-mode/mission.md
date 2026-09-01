# Mission: Vault Portability & Compromise Mode

**Status**: active

## Outcome

The operator can move their vault profile between machines as a whole and in
parts, and can fully sever any party who once had access. Concretely: one
export carries every vault in the profile; one restore workflow lets the
operator decide exactly where each vault lands (an existing jar, a new jar,
or nowhere); and one "compromise mode" action re-keys the entire vault
hierarchy so that nothing previously issued or extracted — recovery key,
admin key, extracted MRK, extracted vault keys, automation access keys —
opens anything ever again.

## Context

Mission 17 Flight 4 hardened the vault's read-path trust and forced
recovery/admin rotation on fresh adopt, but deliberately left three named
gaps that share the same envelope model and the same lockout-critical
one-time-secret surfacing chain:

- **The DD4 master residual** — after a fresh adopt, the donor's master
  password still unlocks the adopted profile (the donor's `mrk.master`
  envelope is carried over unchanged).
- **The F6 rotation gap** — every existing rotation re-wraps one
  `manager.json` slot and never re-keys the MRK; a party who already
  extracted the MRK (or a vault key) survives every rotation. The threat
  model documents this plainly as unimplemented.
- **Single-vault portability** — the Flight 4 HAT surfaced that a global
  export carries only the global vault; the operator expected the whole
  profile, with a mapping step to choose which jar vaults restore to which
  jars.

The F4 debrief's recommendation is to design these together, once,
coherently — designing any one in isolation from the surfacing chain would
be a mistake. This mission is that design. The deferred admin "god mode" is
explicitly **not** part of it (operator ruling 2026-08-31): it is an
automation-access capability, kin by key model but different in kind, and
will be its own mission.

**Use cases this mission serves** (operator ruling): whole-profile
migration to a new machine, and selective jar transplant into an existing
profile. Disaster backup and person-to-person handoff are not first-class
targets; the master-envelope severing on adopt is therefore *offered*, not
forced.

**Architect validation (2026-08-31): feasible with caveats.** All crypto is
existing primitives (per-vault whole-blob re-encryption, fresh-key minting,
envelope wrapping, admin-key enumeration); access-key revocation and live
automation-session teardown fall out of machinery that already ships
(`revalidate()` probes the access envelope per op). The surfacing problem
does **not** multiply with vault count: both compromise mode and fresh
adopt surface exactly one one-time secret (the new recovery key) — admin
keys are never minted implicitly (Flight 1 ruling R5; extended to adopt at
Flight 2 planning), so F4's two-sheet stash-then-chain machinery has no
remaining consumer once Flight 3 lands; the autolock-suppression guard
generalizes directly. *(Reconciled to R5 at the Flight 1 debrief and to
the adopt extension at Flight 2 planning, 2026-09-01.)*
The genuinely new structure is contained: a multi-file transaction layer
with load-time recovery in the vault store, and the restore-mapping
workflow spanning store + jar registry + IPC/UI.

## Success Criteria

- [ ] **Full sever, one action.** A single operator-initiated compromise-mode
      action re-keys the vault hierarchy such that afterward no previously
      issued or extracted key material — a prior recovery key, a prior admin
      private key, an extracted MRK, an extracted vault key, or any minted
      per-jar automation access key — can open the manager or any vault.
      The operator sets a **new** master password as part of the action
      (required, and it must differ from the old one — enforced on both the
      master-unlocked and recovery-unlocked branches); vault items are
      kept without re-entry. The admin key is **revoked, not re-issued** —
      the rotated manager carries no admin provision until the operator
      provisions one manually. The action reports the complete revocation
      set (admin key + which jars carried access keys), so the completion
      surface can direct manual recreation rather than letting the operator
      discover breakage one dead session at a time. Verified by adversarial
      on-disk tests (captured old material replayed against the rotated
      profile). *(Refined during Flight 1 alignment, 2026-09-01 — rulings
      R1, R5, R6, R7 in the flight log.)*
- [ ] **Interruption-safe re-key.** Interrupting the compromise-mode action
      at any point (crash, kill, power loss) leaves the profile fully
      openable either entirely under the old key state or entirely under the
      new — never a mix, never a lockout. Verified by fault-injection tests
      over the write sequence.
- [ ] **Compromise-mode surfacing.** The new one-time recovery key minted
      by compromise mode is surfaced exactly once through a dismiss-locked
      sheet, with the profile held unlocked until the lockout-critical
      acknowledgment *(a single sheet, not the two-sheet chain — the admin
      key is revoked, not re-minted; refined during Flight 1 alignment,
      ruling R5)* —
      backed by a hybrid witnessed behavior test (operator-witnessed sheet
      steps; agent-verified observables: sheet-visibility transitions,
      on-disk key state, lock signals). The chain opens only **after** the
      transaction's durable commit point; a pre-commit failure surfaces an
      error ("nothing changed; your existing keys remain valid") and shows
      no secret — never printed keys that a rollback then invalidates.
- [ ] **Whole-profile export.** One export produces a single bundle carrying
      the global vault and every jar vault, plus jar identity metadata
      (name, appearance) sufficient for a human-readable mapping step after
      the bundle is opened. **Everything in the bundle remains ciphertext**
      — jar metadata included (operator ruling; the current all-ciphertext
      headline is preserved unchanged).
- [ ] **One restore workflow, explicit mapping, unified with import.**
      Restoring a bundle walks a single workflow — file pick → bundle
      secret → mapping — in which each source vault is explicitly directed
      by the operator to an existing jar, to a new jar created in that
      step, or skipped. Nothing lands without an explicit choice. The same
      workflow serves a fresh profile (adopt) and an existing profile
      (transplant into current jars), and it IS the import experience: a
      single-vault bundle is the one-row case of the same flow, not a
      separate path. For a destination that already holds a vault, the
      operator chooses per vault between **Replace** (existing vault
      destroyed, explicit confirm) and **Merge** (existing items kept, the
      bundle's items imported alongside, item-level collisions surfaced
      through an explicit mechanism — semantics ruled in the owning
      flight's design). *(Refined during Flight 1 alignment, 2026-09-01 —
      observations O1–O3 in the flight log.)*
- [ ] **Fresh-adopt guarantees extend to multi-vault bundles.** A fresh
      adopt of a multi-vault bundle still forces a recovery-key rotation
      before the profile is usable, and **no admin key is provisioned** —
      the donor's admin access is severed by omission, and an admin key
      exists only when the operator deliberately provisions one (same
      opt-in rule as compromise mode). The adopt surfacing (a single
      dismiss-locked recovery sheet, profile unlocked until the
      acknowledgment) is backed by a hybrid witnessed behavior test of the
      same form as the compromise-mode one — closing the F4 debrief's
      standing recommendation. *(Amended at Flight 2 planning, 2026-09-01
      — operator ruling: admin keys are never minted implicitly; extends
      Flight 1 ruling R5 to the restore workflow. Supersedes F4's
      two-key-chain form of this guarantee.)*
- [ ] **Selective jar transplant.** The operator can bring a chosen subset
      of a bundle's vaults into an existing profile, re-keyed under the
      destination's own MRK; a destination collision is never resolved
      silently — the operator explicitly chooses Replace or Merge, per
      vault.
- [ ] **Master severing offered, never forced.** After any fresh adopt the
      operator is offered a master-password change that severs the donor's
      master envelope; declining leaves the profile fully usable. The offer
      states what it severs.
- [ ] **Docs tell the new truth.** The threat model's "already-extracted MRK
      survives every rotation" and "donor's master password after adopt"
      bullets are updated to describe the compromise-mode and offered-sever
      answers; portability docs describe the multi-vault bundle and the
      mapping workflow.

## Stakeholders

- **The operator** — sole human user; gains real migration, transplant, and
  break-glass severing.
- **Automation consumers** — per-jar access keys are revoked by design
  under compromise mode; jar automation must be re-minted afterward, and
  the flow must make that consequence visible at the moment of choice.
- **Methodology** — closes the F4 debrief's standing surfacing-chain
  behavior-test recommendation and retires the two remaining "adopt
  inherits a trustworthy donor manager" residuals.

## Constraints

- **God mode is out of scope.** No widening of automation read surfaces, no
  secret-sheet wall changes. (Separate future mission.)
- **The secret-sheet automation gate is never widened for testability.**
  `AUTOMATABLE_MENU_TYPES` admits no `vault-*` surface; the behavior tests
  work around the gate (hybrid witnessed form), never through it. Trading
  the exfiltration boundary for a regression net is refused (operator
  ruling 2026-08-31).
- **No plaintext secret ever touches disk or bundle.** Same headline
  property as today; compromise mode and multi-vault bundles introduce no
  exception — the v2 bundle stays all-ciphertext, jar metadata included.
- **Load-time transaction recovery is a ruled exception to "load-loudly,
  never repair"** (operator ruling 2026-08-31): completing or rolling back
  an authenticated, journaled re-key at load is transaction recovery, not
  ciphertext repair. Recovery must be deterministic, idempotent, and
  ciphertext-only; the store still never quarantines or repairs vault
  content.
- **Existing single-slot rotations keep their semantics.** `rotateRecovery`,
  `changeMasterPassword`, `recoverMasterPassword`, `rotateAdminKey` remain
  cheap, one-slot, `manager.json`-only operations; compromise mode is a
  distinct, deliberate, heavier action — not a change to their invariant.
- **The surfacing chain is lockout-critical.** Any flow minting one-time
  secrets must reuse (or deliberately extend) the sequential dismiss-locked
  pattern and its autolock-suppression guard from Mission 17 F4; no new
  ad-hoc sheet sequencing.
- **Planning produces documentation only**; implementation happens in
  flights via the orchestrated workflow.

## Environment Requirements

- Local Electron dev environment (`npm test`, typecheck, eslint, prettier —
  the standing green bar).
- The chrome-MCP behavior-test apparatus (`goldfinch` /
  `goldfinch-development` MCP servers) for the two surfacing-chain behavior
  tests; squawks 0054/0055 addressed the prior session's connection
  failures and both servers connected in the planning session (2026-08-31).
  Note the tests are hybrid witnessed — the apparatus observes window/disk
  state, never the sheets themselves.
- Operator availability for HAT sessions on the restore workflow and
  compromise-mode flow, and for the alignment flight.

## Open Questions

*Ruled during planning (recorded here, detail in flight design):*

- [x] **Compromise-mode step-up is the master password**, with a
      set-new-master branch when the session was unlocked via recovery key.
      This is cryptographically forced — re-wrapping `mrk.master` requires
      the password, which the store never holds — and it simultaneously
      answers whether the flow offers a master change: a party who merely
      *knows* the password survives a re-key under the same password, so
      the recovery-unlock branch sets a new one and the master-unlock
      branch may offer a change in the same pass.
- [x] **Bundle format is a v2**, with v1 accepted on import — v1 is
      hard-version-checked in the importer, so multi-vault cannot ride it.

*Open for flight design:*

- [x] **The restore mapping workflow lives on the vault page** (operator
      ruling 2026-08-31, on UX-review evidence): the codebase already
      routes all non-secret import/export configuration through
      `goldfinch://vault` page modals with the chrome sheet reserved for
      the secret alone, and sheet cards are sized for a one-line key, not
      an N-row mapping table. The alignment flight (still optional)
      focuses on flow feel and wording, not location.
- [ ] **The decrypt-before-mapping inversion.** Encrypted jar metadata
      means human-readable mapping labels exist only after the bundle is
      opened, so the flow becomes file pick → secret (sheet) → back to the
      mapping surface with decrypted labels → commit. The main process
      holds live bundle key material across a user-paced mapping step of
      arbitrary duration — cancellation, idle-autolock, and window-close
      semantics for that held state need explicit design (kin to the F4
      autolock-suppression guard).
- [ ] Fresh-adopt mapping semantics: whether jar creation must work before
      `isSetUp()` flips true, and the write-ordering invariant ("a failure
      never flips `isSetUp()` true without a vault") re-derived for N
      vaults + jar-registry writes. Includes the degenerate case "fresh
      adopt, skip everything except one jar vault."
- [ ] **Item-level merge semantics** (from Flight 1 observation O3): what
      identifies two items as "the same" across vaults (origin + username?
      card fields?), how a conflict between two same-identity items is
      surfaced and resolved, and how merge outcomes are reported per vault.
      A genuine design-decision cluster for the owning flight — potentially
      its own leg.
- [ ] Multi-vault restore interruption semantics: per-vault atomicity with
      explicitly stated rerun/collision behavior (a half-restored profile
      is recoverable by rerun; full transactionality is reserved for
      compromise mode, where rerun is not a recovery path) — **and the
      restore result reports per-vault outcomes** (landed / skipped /
      collision-refused / failed), so a rerun's presentation can
      distinguish the interrupted run's own residue from a genuine
      pre-existing collision. A single ok/error result shape forecloses
      this and would force an IPC reshape later.
- [ ] Whether the offered master-sever is transient (a sheet in the adopt
      chain — miss it and it's gone) or persists as a vault-page affordance
      until acted on. If persistent: where the pending-offer flag lives
      (`manager.json` is crypto-only today), and which mechanism serves a
      post-lock sever on the recovery-adopt path (only reachable via
      `recoverMasterPassword` with the new recovery key once the adopt
      window's live MRK is gone).

## Known Issues

*(none yet)*

## Flights

> **Note:** These are tentative suggestions, not commitments. Flights are
> planned and created one at a time as work progresses. This list will
> evolve based on discoveries during implementation.

- [x] Flight 1: Alignment (landed 2026-09-01) — hands-on session prototyping the
      restore-mapping workflow (page-modal, per the mission ruling) and
      compromise-mode flow: flow feel, held-key/cancellation semantics,
      wording of the severing offer and revoked-key aftermath — before
      committing Flight 2/3 designs
- [ ] Flight 2: Compromise-mode rotation — fresh MRK + fresh vault keys,
      item re-encryption, access-key revocation, the journaled
      interruption-safe write sequence + load-time recovery, store-wide
      write exclusivity for the re-key's duration (the manager lock covers
      only `manager.json` mutations today), surfacing chain extension + its
      hybrid witnessed behavior-test spec. Pre-named divert trigger: the
      transaction layer growing into its own leg cluster.
- [ ] Flight 3: Multi-vault portability — bundle v2, whole-profile export,
      the single restore workflow with explicit mapping / create-new-jar /
      skip (create-jar-then-import ordering: the resolver requires the
      destination jar to exist), selective transplant, offered master
      severing (an inline adopt-window re-wrap under the live MRK —
      `changeMasterPassword`'s old-password step-up is not satisfiable on
      the recovery-adopt path, the F4 callee-precondition trap named up
      front), adopt surfacing behavior-test spec, docs reconciliation.
      Pre-named divert trigger: the restore-mapping UI growing into its
      own leg cluster or flight.
