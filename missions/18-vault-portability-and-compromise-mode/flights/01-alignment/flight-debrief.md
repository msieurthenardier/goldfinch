# Flight Debrief: Alignment — Vault Flows Prototyping

**Date**: 2026-09-01
**Flight**: [Alignment — Vault Flows Prototyping](flight.md)
**Status**: completed
**Duration**: 2026-08-31 (design) – 2026-09-01 (session + land)
**Legs Completed**: 2 of 2

## Outcome Assessment

### Objectives Achieved

The flight met its objective — exit with the compromise-mode flow ruled — and
overshot it usefully:

- **Nine binding rulings (R1–R9)**: single visible entry ("Think a key or
  your master password leaked?" → danger-styled "Rotate Everything…",
  bottom of Settings in both lock states, no kebab item); plain-language
  confirm modal (final copy captured verbatim in the log); master-password
  change **required** and **must differ from the old** (enforced, both
  unlock branches); admin key **revoked, not re-minted** — collapsing the
  surfacing chain to a single dismiss-locked recovery sheet; persistent
  "Everything rotated" completion card with uniform "Revoked" rows,
  rendering post-flow regardless of entry lock state.
- **Four observations (O1–O4)** from the restore feel pass, two of which
  amended mission criteria: unified import/restore (one button, one
  workflow — operator-verbatim requirement at wrap) and Replace-or-Merge
  per colliding vault with item-level collision semantics as a new open
  question. The calmed merge-default mapping shape was approved as Flight
  3's design baseline.
- **Two Flight 2 acceptance criteria pre-registered from prototype
  artifacts**: the lock-state matrix (entry visible + placement consistent
  in both states; completion card renders post-flow from both entry
  states) and the commit-before-surfacing ordering already in criterion 3.
- **Mission criteria 1/3/5/7 refined live**, each edit annotated to a
  logged ruling with operator attribution.

Verified at debrief: `npm test` 4008/4008 pass, 0 skip, 13 suites,
~3.6 s; typecheck and lint clean; `main` verifiably free of prototype
residue (artifact-only commit 0e7390b; working tree empty; scratch branch
gone, no remote counterpart). DD2's no-source-reaches-main promise was
checked mechanically, not asserted.

### Mission Criteria Advanced

None completed (by design — an alignment flight); four de-risked before
their implementing flights are specced (1, 3, 5, 8), and two (5, 7)
materially improved by observations.

### Test Metrics

4008/4008 / 0 fail / 0 skip, 3576 ms (vs. M17 F4's 4003/4003 baseline).
The +5 delta is fully attributable to the pre-flight squawk turnaround
(#196: squawk 0052's KDF-guard suite, squawk 0051's window-teardown
tests) — this flight itself is delta-zero, as a zero-code flight must be.
Per-test time ≈0.89 ms vs. F5's ≈0.80 at 3839 tests; growth tracks test
count, no drift finding.

## What Went Well

- **DD1 (live app + real dev vault + stubs only for the new) validated
  decisively.** The flight's three sharpest outcomes — the kebab entry
  *tried and rejected* (R2), the locked-state placement discovery (R4),
  and the completion-card lock-state near-miss converted into a Flight 2
  acceptance criterion (R8) — do not fall out of static mocks or
  conversation. Operator confirmation: "very helpful, definitely caught a
  few things, most notably the unified button and the merge secrets
  options."
- **Teardown discipline held mechanically.** DD4's artifact separation
  (artifacts on `main`, prototype source only on scratch) made CP4's
  branch deletion structurally safe; the debrief verified the result.
- **Citation-disciplined mid-flight mission edits.** Stale criteria
  contradicting live rulings would have been worse than editing an active
  mission; every edit carries a ruling citation and date. The Architect's
  verdict: an audit trail, not drift.
- **The gate skip was made out loud.** Skipping the multi-surface
  design-review pass for fix passes, with rationale logged ("that gate
  catches riders headed for a merge; this branch never merges"), is the
  visible-and-reasoned form a gate skip should take.
- **Iteration granularity ruled right by the operator** ("just right");
  the planned loop structure (page-reload loops for wording, batched
  relaunches for chrome/main) matched reality. The only reported friction
  was waiting on prototype builds.

## What Could Be Improved

### Process

- **Anomalies must land in the log at occurrence.** The session's
  operational discoveries (internal session serves stale cached modules on
  reload — close/reopen the tab; `openTab` refuses internal URLs — go
  through the chrome target) never reached the Anomalies section, which
  read "(none yet)" at teardown. They survived only because the debrief
  interviews recovered them. Rulings had a land-immediately discipline;
  anomalies need the same.
- **"Attach screenshot at teardown" is an anti-pattern — unrecoverable by
  construction.** R3's promised confirm-modal capture was dropped; O4's
  approved mapping layout survives only as prose (the branch that rendered
  it is gone). Rule for future alignment work: capture every **approved**
  state at approval time, not just every ruled state.
- **Leg artifact hygiene**: AC checkboxes were never ticked despite
  completed status; Leg 1's AC2 still named the kebab entry the session
  ruled out. An alignment leg's AC should name the decision ("the ruled
  entry affordance"), never a presumed answer.
- **The calibration skip is deferred, not mooted.** R5 removed the
  two-sheet chain from *compromise mode*, but Flight 3's adopt flow still
  uses it (criterion 6) — the export→wipe→re-adopt chain walk is still
  owed and should be scheduled in Flight 3's design.
- **Operator wait time** was the only reported friction. Candidate
  mitigation for the next alignment session: pre-build increment 1 before
  the operator sits down, and overlap builds with click-through segments.

### Technical

- **R5 created a state the manager format cannot represent** — the
  flight's one substantive unnamed design gap, caught at debrief:
  `_readManager` hard-requires all three MRK slots and `adminPublicKeyB64`
  (`vault-store.js:391–408`, `VaultFormatError` otherwise). "No admin
  provision" needs either an optional admin slot (a load-loudly validation
  change) or an explicit revoked representation — and it ripples into
  Flight 3's bundle v2 (what does exporting a compromised, not-yet-
  reprovisioned profile carry?). **Named Flight 2 design decision.**
- **R7's mechanism verified implementable** (`unwrapMaster`,
  `vault-crypto.js:367`; the old envelope is in scope pre-re-key exactly
  as in `recoverMasterPassword`, `vault-store.js:903–930`), with one
  implementation trap recorded: the *good* case (password differs) throws
  `VaultAuthError` through the same path as tampering and must be
  swallowed as "not a reuse" without weakening load-loudly semantics.
- **O2 is an IPC-contract reshape, not a UI change**: destination binding
  moves from pick time (`_pendingVaultImports.hold(chromeId, { bundle,
  destinationTarget })`, `main.js:968`) to commit time, with a new
  decrypted-labels return leg; the held-bundle lifetime then spans the
  user-paced mapping step — confirming the mission's open held-key
  question is shared by both flows. Fresh mode already has the target
  shape (destination-less handoff), so unification mostly *deletes* modal
  complexity.
- **Mission echo drift, found and fixed**: the Context Architect-
  validation note still claimed "two one-time secrets regardless of vault
  count" after R5 made compromise mode single-secret. Reconciled in this
  debrief pass — the known failure mode of mid-flight edits is that the
  criteria get edited and the prose echoes don't; a mission-consistency
  sweep belongs in alignment-flight teardown.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| DD3's binding/non-binding line blurred: feel-pass observations amended mission criteria | The real distinction is "ruled now" vs. "constrained now, designed later" — O2/O3 bind the what, defer the how | Candidate — pre-authorize an in-session criterion-amendment escalation path (operator present, ruling citation mandatory); hold for mission-debrief verdict |
| Multi-surface design-review gate skipped for fix passes | Scratch branch never merges; gate targets merge-bound riders | Candidate rule: merge-directed gates void on scratch branches, all other judgment intact |
| Calibration walk (export→wipe→re-adopt) skipped | Session flow; later mooted for compromise mode by R5 | No — record such skips as *deferred to a named session*; Flight 3 owes this one |
| Fix passes applied without per-pass design review, statuses tracked in-log | Interactive leg protocol | Yes for alignment flights (already the skill's HAT-fix protocol) |

## Key Learnings

- **Live prototyping caught what conversation would not** — the operator
  names the unified import/restore button and the merge option as caught
  by clicking, not talking. Both became mission-level requirements.
- **The single-sheet simplification (R5) was found before a line of
  implementation existed** — the two-sheet chain inherited from F4 would
  otherwise have been built and then torn out.
- **The secret-sheet capture gate survived a testing-convenience
  temptation** at every tier, including the debrief agents' own
  verification attempts — the strongest evidence yet that the
  never-widen constraint is real and enforced by structure, not policy.
- **The alignment-flight pattern is promising but unproven** — operator
  ruling: hold standardization until the mission debrief shows whether the
  rulings held through Flights 2–3 ("wait and see how things turn out at
  the end of the mission… maybe bake into the mission control protocol
  over time"). The six failure modes named by the Architect (ruling-scope
  creep; stub-artifact rulings; evidence decay; mission-edit echo drift;
  gate-skip leakage; calibration skipped under session pressure) are
  recorded here as the evaluation rubric for that decision.

## Recommendations

1. **Flight 2 spec must name four design decisions up front**: the admin
   no-provision representation (format change vs. revoked marker, and its
   bundle-v2 ripple); the R7 `VaultAuthError`-swallow; the lock-state
   matrix acceptance cluster (R4 + R8); and the single-sheet surfacing
   shape (do not inherit F4's chain machinery wholesale).
2. **Flight 3 spec treats O2 as an IPC reshape** (commit-time destination
   binding, decrypted-labels leg, held-bundle lifetime) and schedules the
   deferred adopt-chain calibration walk; the item-merge semantics cluster
   likely warrants its own leg.
3. **Promote the two dev-loop findings to `docs/dev-testing.md`**
   (stale-module reload behavior; openTab internal-URL workflow) —
   squawk-sized.
4. **Alignment-flight template improvements** (recorded for the
   mission-debrief standardization decision, not applied yet):
   screenshot-at-approval-time; anomalies-at-occurrence; pre-authorized
   criterion-amendment path; teardown mission-consistency sweep;
   scratch-branch gate rule; deferred-calibration recording.

## Action Items

- [x] **Squawk 0056** (logged, open): add dev-loop notes to
  `docs/dev-testing.md` — internal-session stale module cache
  (close/reopen, not reload) and openTab's internal-URL refusal (drive via
  chrome target) (servicing, routine)
- [x] Mission echo reconciled: Context Architect-validation note updated to
  R5's single-secret compromise mode (this debrief pass)
- [ ] Carry the four named design decisions into Flight 2's spec (above)
- [ ] Carry the O2-reshape framing + deferred calibration into Flight 3's
  spec (above)
- [ ] Mission debrief: evaluate the alignment-flight pattern against the
  six-failure-mode rubric; decide on mission-control standardization
  (operator hold, 2026-09-01)
