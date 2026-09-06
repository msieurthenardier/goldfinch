# Flight Debrief: Multi-Vault Portability

**Date**: 2026-09-06
**Flight**: [Multi-Vault Portability](flight.md)
**Status**: landed
**Duration**: 2026-09-02 (planning) → 2026-09-06 (landed)
**Legs Completed**: 6 of 6 (planned 5; opacity added as leg 5 after a
HAT finding)

## Outcome Assessment

### Objectives Achieved

Vault portability delivered whole and in parts: one export produces a
single all-ciphertext bundle carrying every vault plus **opaque** jar
identity; one restore workflow (pick → secret → decrypted-labels
mapping → commit) with per-vault outcomes and non-interactive merge;
fresh adopt mints no admin key and surfaces exactly one dismiss-locked
recovery sheet; and a post-adopt sever offer that actually severs the
donor's master access. The runway work shipped too (main.js glue
extraction; the operator-ruled blur-survival contract with
close-on-lock). Merged as PR #204.

### Mission Criteria Advanced

- **Criterion 4 (whole-profile export, encrypted identity)** — met,
  and proven OPAQUE on real exported bytes at the HAT + leg 5: no jar
  name/color/slug legible before the secret; opaque per-entry handles.
- **Criterion 5 (one restore workflow, mapping, merge)** — met;
  walked live end-to-end.
- **Criterion 6 (fresh-adopt guarantees)** — met; verified on-disk
  (v2 manager, no admin) + a single recovery sheet, no admin sheet.
- **Criterion 7 (selective transplant)** — met; Replace/Merge/skip
  exercised at the HAT (merge correctly deduped identical items).
- **Criterion 8 (sever offered, never forced)** — met; verified TWO
  ways: cold-restart behavioral (new master unlocks, donor dead) AND
  on-disk master-envelope fingerprint change (`6d26d17` → `dd5af8c9`,
  a real re-wrap, not a no-op).
- **Criterion 9 (docs, portability half)** — met; `docs/vault.md`
  updated across legs 3-5.

### Checkpoints

CP1-CP3 met as designed. CP4 (guided HAT) satisfied. CP5 (witnessed
runs): closed via an operator **live smoke** of the opacity build; the
full two-agent `/behavior-test` run + compromise recovery-branch
variant were DEFERRED — specs `active`/CI-ready — per operator ruling
(acceptable long-term).

## What Went Well

- **Design-review catches paid off at acceptance.** DD7's original
  no-step-up sever op was rejected at planning review as a step-up
  bypass (the flight's own pre-named divert trigger firing on
  schedule) and re-routed to the existing change-master/recover ops —
  vindicated at the HAT, where criterion 8 held two independent ways.
  DD6's no-admin adopt needed an unplanned v1-manager relaxation
  (`_readManager` required admin at v1, and v1 is the default state) —
  caught at leg-2 design review, the cheapest place, with containment
  swept and verified (no other site assumes v1⇒admin) and pinned under
  rename-not-silent-edit.
- **The `vault-page-model.js` pure-extraction pattern** was used three
  times (`restoreDestinationOptions`, `restoreOutcomeLines`, the leg-5
  name-join) to keep DOM-free logic unit-testable AND relieve
  vault.js's line budget — twice as an explicit budget rescue. The
  flight's most reusable idiom.
- **The HAT did its job**: several real defects were only reachable
  with a live render / real profile / real timing (the labels-ready
  cross-webContents send, the existing-jar-destination gap, the
  seeded-container duplicate-jar interaction) and were all caught
  before merge.
- **Security depth**: both tag-smuggling vectors pinned separately
  (nested + entry-level sibling); byte-scan now uses a name==slug
  fixture; adversarial-replay proves the donor recovery key is dead
  post-adopt; held-secret zeroize proven under mid-loop throw.
- **Pinned-test discipline** (rename/invert, never silent-edit) held
  across all three store legs.

## What Could Be Improved

### Process

- **Byte-scan fixtures must use name==slug.** The plaintext-sourceId
  leak (criterion 4) slipped past leg 2's byte-scan test only because
  its fixture's display name differed from its slug — so the test
  green-checked a non-representative case. Real profiles have
  name==slug. This was the proximate cause of a whole extra leg (5).
- **Design reviews should sweep every serialization boundary for
  plaintext-identity echoes**, not just the field under discussion.
  Leg 5's *second* leak (the embedded `.gfvault` doc's own `vaultId`)
  was the same identity one level down, closed only because the
  implementer looked past the ruling's literal scope — luck, not
  process.
- **Capture write-time fingerprints live during a HAT.** The sever
  "false alarm" cost investigation time because a single post-hoc
  `manager.json` mtime was ambiguous between the adopt and sever
  writes; a content-hash captured at each transition would have
  settled it instantly. (No wrong ruling resulted.)

### Technical

- **`vault.js` is at its 2820-line budget ceiling** (2819 `wc -l`;
  2820 by the seam-contract metric) — zero headroom. Any future
  vault-page change must extract before it can add. Cheapest buy-back:
  `JAR_COLOR_PALETTE` (vault.js ~786-798, ~14 lines) is a byte-for-byte
  duplicate of `PALETTE` in `src/shared/jar-page-model.js:32-45`;
  vault.js can't import it only because `src/main/internal-page-map.js`
  (vault route ~:55-70) has no `jar-page-model.js` entry. One
  allowlist line + an import reclaims ~14 lines and removes a drift
  risk.
- **Two of the 14 HAT fixes were pre-HAT-catchable latent bugs**, not
  live-UI-only findings: **fix 3** (labels-ready sent to the wrong
  webContents — leg 3's own ruling 3(c) said broadcast; the
  implementation used a targeted send; each end was pinned in
  isolation with no cross-boundary integration test) and **fix 8**
  (existing-jar destinations excluding vault-less containers — root
  cause `selectVaultView` returns `vaults:[]` in not-set-up mode, a
  pure module already under test; a not-set-up-with-jars case would
  have caught it at zero marginal cost). The other 12 are the normal
  yield of first live UI exercise (CSS/render defects unit tests
  structurally cannot catch), consistent with the operator's read.
- **`refresh()` now issues one `hasVault` IPC per jar** (HAT fix 8,
  `vault.js:~2751`) on every lock-state broadcast — O(jars)
  round-trips, cheap per call, a concern only at high jar counts. A
  batched `internal-vault-has-many(ids[])` collapses it to one; do it
  opportunistically, not urgently.

### Documentation

- The `vault-page-model.js` pure-extraction pattern is demonstrated
  three times in comments but written down nowhere as a rule. Name it
  in `docs/vault.md` or CLAUDE.md: "when vault.js is at budget, extract
  pure display/mapping logic into vault-page-model.js rather than
  trimming comments."

## Test Metrics

`npm test` on HEAD (be51268), 3 runs: **4294 / 4294 pass, 0 fail, 0
skip**, wall-clock 5.22-6.08 s. **No flake reproduced** across 3 runs
(the transient 2-test flake noted once during leg 2 did not recur —
consider it not-a-flake pending recurrence). Lint / typecheck /
format:check clean. New restore/bundle suites all well under the ~10 s
watch (largest: `vault-restore-directives` 539 ms).

**Trend across the mission's flights:**

| Flight | Tests | Wall-clock |
|--------|-------|------------|
| F1 debrief | 4008 | 3.58 s |
| F2 debrief | 4118 (+110) | 6.16 s |
| **F3 (this)** | **4294 (+176)** | **~5.2-5.7 s** |

F3 added the most tests of any flight yet, and wall-clock came DOWN
from F2 — direct evidence the leg-2 FAST_SCRYPT-everywhere ruling paid
off and F2's "watch suite wall-clock" recommendation is addressed, not
deferred.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Opacity added as leg 5 (planned 5 legs → 6) | plaintext-sourceId leak only visible once a real multi-jar bundle existed to byte-scan | No (inherent limit of static review vs. dynamic byte inspection) — but standardize the name==slug fixture rule that would catch it in CI |
| DD7 re-ruled at planning review | original sever op was a step-up bypass | Yes — the pre-named divert trigger + review firing before code is the model |
| DD6 v1-manager relaxation (unplanned) | v1 is the default manager state; no-admin adopt was unreachable without it | No (one-off), but the containment-sweep discipline is the model |
| `sever-offer.js` extraction (leg 3) | route logic untestable inside main.js | Yes — extract-for-testability is a standing good move |
| 14 HAT inline fixes | first live UI exercise | Expected yield; not a deviation to standardize |

## Key Learnings

- A privacy guarantee ("nothing human-readable before the secret") has
  to be verified at EVERY plaintext field and EVERY nested
  serialization boundary, with realistic (name==slug) fixtures —
  not just at the one field the design discussion is centered on.
- A guided HAT before witnessed runs is worth its cost: it converted
  what could have been a shipped criterion-4 violation into a caught
  in-flight finding (extra leg, no incident).
- A hard renderer line budget is a genuine planning constraint once a
  page approaches it; the pure-model-module split is the answer, but
  it must be planned up front, not discovered at CI.

## Recommendations

1. **Dedup `JAR_COLOR_PALETTE` into an import from `jar-page-model.js`**
   (one `internal-page-map.js` allowlist line + delete ~14 duplicated
   lines) as PREP before the next vault-page flight — buys back
   headroom against a zero-margin ceiling and removes a drift risk.
2. **Plan a proactive `vault.js` decomposition** (e.g. split the
   mapping-modal / completion-surface code into its own controller) as
   a NAMED deliverable in whatever flight next touches the vault page —
   it is past the point where a budget bump alone leaves room.
3. **Adopt two standing conventions** (CLAUDE.md): (a) plaintext-
   absence test fixtures default to name==slug / real-world-shape data;
   (b) design reviews sweep every ciphertext-envelope's embedded fields
   for independent identity leakage.
4. **Add a `vault-page-model.test.js` case** for not-set-up mode with
   pre-existing (vault-less) jars — closes the exact gap HAT fix 8
   exposed, in an already-tested module.
5. **Document the `vault-page-model.js` pure-extraction pattern** and
   batch the `hasVault` fan-out (`internal-vault-has-many`)
   opportunistically.

## Action Items

- [ ] Dedup `JAR_COLOR_PALETTE` via `jar-page-model.js` import
      (internal-page-map.js entry + import + delete dup) — **logged as
      squawk 0063**
- [ ] Add not-set-up-with-jars regression test to
      `vault-page-model.test.js` — **logged as squawk 0064**
- [ ] Batch `hasVault` fan-out into `internal-vault-has-many` — needs
      a new IPC channel → debrief recommendation (not a squawk;
      shared-interface change), pick up in a future vault-page flight
- [ ] Proactive `vault.js` decomposition — plan into the next
      vault-page flight (design work, not a squawk)
- [ ] Standing conventions (name==slug fixtures; serialization-boundary
      identity sweep) → propose for CLAUDE.md
- [ ] Carry-forward from the flight log: sheet-side `survivesBlur`
      flags are a manually-synced allowlist copy (risk of drift);
      DD8 retired the behavior-test focus-hold/memorize-then-relay
      protocol (update existing specs when next touched); the full
      two-agent witnessed run is deferred (spec active/CI-ready —
      operator ruled acceptable, not gating mission close)

## Methodology Notes (skill-effectiveness)

- **Mission/flight/leg hierarchy worked**, including adding leg 5
  mid-flight (the skill explicitly allows new legs when scope grows).
- **The risk-tiered design review + max-2-cycles discipline was the
  flight's MVP**: it caught the DD7 bypass, the DD6 v1 gap, the leg-5
  export-carried leak and the mechanically-impossible v1 tag, and the
  leg-5 tag-smuggling vector — all before code, or (for smuggling)
  with a dedicated regression pin. Reinforce.
- **The deferred-commit / flight-end-review model** kept a 57-file,
  three-leg diff coherent under one review before commit.
- Two latent bugs (fixes 3, 8) reaching the HAT rather than CI suggests
  a small gap: leg design should call out cross-webContents / cross-
  process seams as explicitly needing an integration pin, and pure
  page-model modules should be swept for the not-set-up state space.
