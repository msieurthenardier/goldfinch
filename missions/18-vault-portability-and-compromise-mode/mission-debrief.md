# Mission Debrief: Vault Portability & Compromise Mode

**Date**: 2026-09-06
**Mission**: [Vault Portability & Compromise Mode](mission.md)
**Status**: completed
**Duration**: 2026-09-01 (Flight 1 alignment) → 2026-09-06 (Flight 3 landed)
**Flights Completed**: 3 of 3

## Outcome Assessment

### Success Criteria Results

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | Full sever, one action | **met** (F2) | Compromise-mode rotation re-keys the whole envelope set in one operator action |
| 2 | Interruption-safe re-key | **met** (F2) | `vault-txn.js` journal-first/staged/single-rename commit; interrupting leaves the old state intact |
| 3 | Compromise-mode surfacing | **met** (F2) | One-time recovery key on a dismiss-locked sheet; hybrid witnessed test |
| 4 | Whole-profile export | **met** (F3) | v2 bundle carries every vault + **opaque** identity — proven on real bytes (no name/color/id legible pre-secret) |
| 5 | One restore workflow, mapping, merge | **met** (F3) | pick → secret → decrypted-labels mapping → commit; existing-jar/new-jar/skip + Replace/Merge; walked live |
| 6 | Fresh-adopt guarantees (multi-vault) | **met** (F3) | Forced recovery rotation, no admin mint, single sheet — verified on-disk (v2 no-admin manager) |
| 7 | Selective jar transplant | **met** (F3) | Subset restore re-keyed under destination MRK; explicit Replace/Merge per vault |
| 8 | Master severing offered, never forced | **met** (F3) | Session card routes to existing step-up ops; verified two ways (cold-restart + on-disk envelope re-wrap) |
| 9 | Docs tell the new truth | **met** (F3) | `docs/vault.md` threat model + portability + opaque-bundle guarantee updated |

All five mission-planning Open Questions (decrypt-before-mapping, fresh-adopt
jar-creation ordering, item-level merge semantics, multi-vault interruption
semantics, transient-vs-persistent sever) were resolved during Flight 3 design
(DD1-DD7).

### Overall Outcome

The mission delivered its stated outcome: goldfinch's vault subsystem went from
single-slot rotation + single-vault bundles to **transactional whole-hierarchy
re-key + multi-vault, all-ciphertext, identity-opaque portability** — without a
rewrite, by layering coherent extensions on two primitives Flight 2 introduced
(`vault-txn` and the gated-op/second-wall write-exclusivity discipline). The
outcome remained the right goal throughout; Flight 1's alignment work *refined*
the criteria (one unified workflow, decrypt-before-mapping, the calmed
merge-default modal) rather than redirecting them.

**One consistency gap remains open** (see Known Issues): single-vault export
still emits a v1 (plaintext-`sourceVaultId`) bundle, so the "nothing
human-readable before the secret" bar the mission set for whole-profile export
is not uniform across both export modes.

## Flight Summary

| Flight | Status | Key Outcome |
|--------|--------|-------------|
| F1 — Alignment | completed | No code; produced the O1-O4 rulings that shaped F2/F3, and pruned F4's two-sheet stash-then-chain machinery *before* it was built (ruling R5) |
| F2 — Compromise-Mode Rotation | completed | `vault-txn` transaction primitive + gated-op/second-wall write exclusivity + manager v2 (optional-but-paired admin) + refcounted autolock-suppression holder |
| F3 — Multi-Vault Portability | completed | Bundle v2 (multi-vault, opaque identity), one restore/mapping workflow, adopt-no-admin, offered sever, blur-survival contract; 6 legs (planned 5 + opacity), 14 HAT fixes |

### Flight Patterns

- **F1 (alignment) was decisive precisely because it wrote no code** — its value
  was killing a machinery (the two-sheet chain) before implementation, and
  fixing the mission's criteria (unified workflow, decrypt-before-mapping). The
  operator judges the alignment-flight pattern **worth keeping for UX-heavy
  missions specifically** — situational, not default; a pure backend/store
  mission likely wouldn't need it.
- **F2 struggled least of the build flights** — its primitives were designed once
  and consumed cleanly by F3, evidence of sound abstraction boundaries.
- **F3 carried the most surface churn** (14 HAT fixes, a whole extra leg) but the
  operator reads this as **normal yield of the first live UI exercise**, not
  spec-thinness — and the debrief agrees for 12 of 14 (CSS/render/UX defects
  unit tests structurally can't catch). Two (the labels-ready cross-webContents
  send, the not-set-up-mode destination gap) were genuinely pre-HAT-catchable.

## Process Analysis

### Planning Effectiveness

The initial 1-3-flight plan held: three flights, in the planned shape. The only
structural growth was Flight 3 adding leg 5 (opacity) mid-flight — and that was
**not reasonably anticipatable at planning**, because the plaintext-identity leak
only became visible once a real multi-jar bundle existed to byte-scan (which
requires legs 1-4 to have landed). This is an inherent limit of static design
review versus dynamic byte inspection, not a planning miss.

### Execution Patterns

- **The risk-tiered design-review gate was the mission's MVP.** Across the three
  flights it caught, before code: the F3 DD7 sever step-up-bypass, the F3 DD6 v1
  manager gap, the leg-5 export-carried leak, the mechanically-impossible v1 tag,
  and the leg-5 tag-smuggling vector. The operator's own read matches: the
  design-review gates + the flight/leg structure "worked well as-is."
- **The mission paid down its own debt before compounding it**: F2's debrief named
  the transcribed-glue-test debt and ordered its extraction; F3 leg 1 executed
  that extraction *before* adding new delegates, not after.
- **The deferred-commit + flight-end-review model** kept large multi-leg diffs
  coherent under one review before commit.

### Methodology Assessment

The mission/flight/leg hierarchy worked, including adding a leg mid-flight. The
mission-level judgment was consistently good — primitives were applied by their
actual invariants (the autolock-suppression holder was *deliberately not* reused
for the held bundle, because a re-enterable bundle secret isn't a one-time
reveal) rather than reflexively.

## Known Issues (carried forward)

- **Single-vault export is not identity-opaque.** `exportVault`/`_exportVault`
  (`vault-store.js`) still emit a plaintext `sourceVaultId` (v1 bundle format).
  The operator restored the single-vault export UI option at the F3 HAT (veto 1),
  but the opacity redesign (leg 5) scoped to the v2 whole-profile format only, so
  a user choosing single-vault export from the same modal gets a bundle that
  leaks the one jar name. **Not a regression** (single-vault export was always
  v1-plaintext), so it does not block the release — but the mission's own privacy
  bar is now non-uniform across the two export modes. → **Action item / next-
  mission input**: decide deliberately — bring single-vault export to the opacity
  standard (emit a one-entry opaque v2 bundle), OR document it as a
  lesser-guaranteed legacy path in the threat model, OR deprecate the UI option.
- **`vault.js` at its line-budget ceiling** (2819/2820) — the next vault-page
  flight must plan a decomposition (the `vault-page-model.js` pure-extraction
  pattern is the mechanism). Cheap first buy-back logged as **squawk 0063**.
- **Manually-synced `survivesBlur` allowlist copy** — the authority in
  `menu-overlay.js` and the gating set `VAULT_BLUR_SURVIVAL_MENU_TYPES` in
  `overlay-menus.js:77` must stay in lockstep, with no test enforcing equivalence
  today. Drift risk on a security-relevant surface.
- **Full two-agent witnessed run deferred** — `multi-vault-adopt` +
  compromise recovery-branch variant are spec-complete/CI-ready but never
  executed as a full run (closed via operator live smoke). Operator ruled this
  acceptable, not gating; schedule the actual run rather than carrying "CI-ready"
  indefinitely.
- **`hasVault` IPC fan-out** (per-jar round-trip on every refresh) — batch into
  `internal-vault-has-many` opportunistically.
- **not-set-up-with-jars regression test** — logged as **squawk 0064**.

## Lessons Learned

- **A privacy guarantee must be verified at every plaintext field and every
  nested serialization boundary, with realistic (name==slug) fixtures.** The
  mission's marquee lesson: leg 2's byte-scan passed on a non-representative
  fixture (name≠slug), hiding the criterion-4 leak until a real HAT export;
  leg 5 then found a *second* leak (the embedded `.gfvault` `vaultId`) only by an
  implementer looking past the ruling's literal scope. And the single-vault gap
  above shows the same lesson a third time — a security bar applied to one code
  path silently doesn't cover its sibling.
- **"Route to an existing step-up-carrying op; never mint a new no-step-up op"**
  (F3 DD7) is the mission's sharpest reusable security principle.
- **A named "watch this" recommendation can actually get fixed and verified**:
  F2's "watch suite wall-clock" (scrypt-heavy, +72% time for +2.7% tests) was
  acted on by F3's FAST_SCRYPT-everywhere ruling — F3 added the most tests of any
  flight yet and wall-clock came *down* (6.16s → ~5.2s). Model for carry-forward
  items that don't rot.

## Methodology Feedback

- **Reinforce the risk-tiered design-review gate** — it was the highest-leverage
  part of the methodology this mission, catching security issues before code
  repeatedly.
- **Add two standing conventions to CLAUDE.md**: (a) plaintext-absence / identity
  test fixtures default to name==slug (real-world shape); (b) design reviews
  sweep every ciphertext-envelope's embedded fields for independent identity
  leakage, not just the field under discussion.
- **Add a leg-design checklist item**: cross-process / cross-webContents seams
  require an explicit integration pin — pinning each end in isolation let two F3
  latent bugs reach the HAT.
- **The alignment-flight pattern is worth keeping for UX-heavy missions**
  (operator ruling) — codify it as situational, not default.
- **A hard renderer line budget is a real planning constraint** once a page
  nears it — plan the pure-model decomposition up front, not at the CI wall.

## Action Items

- [ ] Decide the single-vault-export opacity question (opaque v2 / documented
      legacy / deprecate) — next-mission input or a scoped fast-follow
- [ ] squawk 0063 — dedup `JAR_COLOR_PALETTE`
- [ ] squawk 0064 — not-set-up-with-jars regression test
- [ ] Add a test enforcing the `survivesBlur` authority/allowlist equivalence
- [ ] Schedule the deferred two-agent witnessed runs (`multi-vault-adopt`,
      compromise recovery-branch variant)
- [ ] Batch the `hasVault` fan-out (`internal-vault-has-many`)
- [ ] Plan a proactive `vault.js` decomposition into the next vault-page flight
- [ ] Propose the two byte-scan/serialization conventions + the
      cross-webContents integration-pin checklist item for CLAUDE.md
