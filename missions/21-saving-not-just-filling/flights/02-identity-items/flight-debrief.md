# Flight Debrief: Identity Foundations

**Date**: 2026-09-20
**Flight**: [Identity Foundations](flight.md)
**Status**: landed
**Duration**: 2026-09-19 (planning, scope-split at design review) – 2026-09-20 (merged, `016e540`, PR #226)
**Legs Completed**: 3 of 3

## Outcome Assessment

### Objectives Achieved

The flight delivered its one decision cluster in full: **what an identity is, and
how it is stored.** DD1's admissibility boundary is pinned and proven against an
adversarial corpus — a scope anchor (an admissible postal role) *and* a non-postal
role are both required before any field in a scope is admissible, `address` is
never bare-admissible, and matching is alternatives-with-longest-match rather than
a flat token set. The card family's two escalated squawks (0090, 0091) are closed
against real markup, and the tokenizing primitives both families now share live in
one family-agnostic module. The vault gained a fourth item type with one profile
per vault enforced at **every** write path, and bundle import became tolerant of —
and honest about — unknown item types.

Nothing page-facing shipped, as designed. The diff confirms it: no `renderer.js`
touch, no sheet templates, no fill or capture wiring, and exactly one permitted
render line in `vault.js`'s `ITEM_SUBSECTIONS`.

Verification: 5288 pass / 3 todo across 25 suites; lint, typecheck and format
clean. Concourse CI could not be run locally (interactive login unavailable to the
crew) — the local gates stood in, stated plainly in the flight log rather than
implied.

### Mission Criteria Advanced

- **Identity capture is gated by a stated plausibility rule** — the rule is
  *pinned and proven* here; it is not yet *applied to live capture*, which is
  Flight 3. Advanced, not met.
- **A name, address, email and phone can be saved and filled per jar** —
  foundations only: the data layer and the detector exist, with no caller.
  Advanced, not met.
- **No spurious offer anywhere in the corpus, including near-miss cases** — met
  *for the detector*, with one named accepted false positive (below).

Honest framing for the mission's hard-zero on wrong-value: it is enforced in the
detector (this flight) and *specified but unwired* in the conflict rule (also this
flight). End-to-end enforcement does not exist until Flight 3 wires
`classifyCapture` into a live caller.

## What Went Well

- **Splitting the flight at design review was the right call, and the evidence is
  stronger than the self-report.** Leg 2 alone — with fill, capture and sheets
  *already excluded* — drew four HIGH findings across two review rounds. Had
  detection design shared a leg with fill, capture and three-way sheet work (the
  original draft), those four would have been re-litigated against a moving
  target: precisely Flight 1's Leg 3 failure mode.
- **Design review found defects that reasoning alone could not.** Every HIGH in
  this flight came from a reviewer *running code* the draft only reasoned about:
  `billingAddress1` tokenizes to `["billing","address1"]` with no `address` token,
  so DD1's own worked example was internally impossible; `findAllCardFields` does
  not resolve the anchor before other roles (both passes are flat first-match-wins
  scans), which turned Leg 1's fix from "checkpoint" into surgery on `rolesIn`;
  `mergeVaultItems` and two import fresh-write branches each bypassed LD2's
  uniqueness rule; and a fourth type source would have made identity items
  bucketed correctly and then silently never drawn.
- **Crew behaviours worth promoting into standing prompts.** Four agents did
  unasked-for things that mattered: marking squawk sign-offs `pending` rather than
  fabricating them; building a throwaway no-gate detector variant to *prove* the
  scope anchor was load-bearing and reporting honestly that **4 of 5** adversarial
  fixtures flip rather than claiming 5 of 5; narrowing a test rather than loosening
  a regex to make its own draft pass; and self-correcting a documentation draft
  after re-reading the log.
- **Debt was named at the point it matters, not buried in the log.** The
  `EXPIRY_ANCHOR_WINDOW` residual, the incident-form false positive and the
  `fullName` composition gap each carry a code comment where a reader will hit them.
- **Drift guards multiplied deliberately.** `identity-profile.js`'s `IDENTITY_FIELDS`
  is asserted equal to the detector's `POSTAL_ROLES ∪ NON_POSTAL_ROLES`, on top of
  the pre-existing `vault-editor-model.js` ↔ `vault-item-schema.js` guard. Three
  independent guards now cross-tie this feature's four type sources.
- **Leg 3's decoupling from Leg 2 was correct engineering, not an accident.**
  `identity-profile.js` imports only from `vault-item-schema.js`; the two legs are
  tied by a drift-guard *test*, not a code dependency. The Leg 2 → Leg 3 order was
  risk-retirement narrative, exactly as `flight.md` says — and since Leg 2 genuinely
  needed two rounds of rework, retiring that risk first was right even though
  nothing would have broken had the legs run reversed or in parallel. **No cost.**

## What Could Be Improved

### Process

- **The recurring defect class is unstated assumptions, not wrong decisions —
  and there is a cheaper net than a full review round.** Every HIGH this flight
  was falsifiable by a five-line script. The proposed convention, in the spirit of
  the existing **Grep-AC convention** but applied to *positive input claims*: every
  "verified at design time" citation in a leg spec carries either a literal
  probe/grep output, or an explicit **"reasoned, not run"** flag. That would have
  caught the `findAllCardFields` anchor-ordering claim and the flat-token-set claim
  as self-checks. It does **not** replace design review — the merge-collision
  bypass and the fourth type source were genuine design gaps, not unverified claims
  — but it shrinks the class of finding that costs a whole round.
- **A drafting-time sizing heuristic that would have caught the oversizing
  before review**: count a leg's **unproven adversarial axes**, not its
  deliverables. Not "is this leg doing more than one thing" (everything is) but
  "how many of its decisions have zero precedent to lean on." The original single
  leg had four; DD1 alone justified being alone.
- **The cycle cap was hit twice, and the three at-cap decisions are not
  equivalent.** `address` never bare-admissible and the non-postal-role minimum
  are mechanical closures of demonstrated holes — reversible, cheaply checkable,
  and escalating them would have bought latency only. The third — accepting the
  incident form as a named false positive — is different in character: it *declines*
  to close a hole and leans on a backstop, and it trades on the mission's own
  hard-zero success criterion rather than on an implementation detail. That one
  was closer to scope-creep-by-judgement, and the operator, who owns the mission's
  constraint language, was the more appropriate person to accept it. It was flagged
  prominently rather than hidden, so this is a calibration note, not a violation.
- **Skipping Leg 3's second design review was a sound trade, not a lucky one** —
  for a structural reason. Leg 3's round-1 findings were *enumeration-completeness*
  defects (how many write paths, how many type sources), which are mechanically
  checkable by a reviewer reading the whole diff, and the flight-end review did
  exactly that ("all four write paths"). Leg 2's findings were *correctness-of-
  judgement-under-adversarial-input* defects, which a diff-reader is
  disproportionately bad at finding and a fresh adversarial round is
  disproportionately good at. Leg 2 got its second round; Leg 3 did not need one.
  Match the review instrument to the defect class.
- **A conditional sign-off leaves a stale record on the happy path.** Squawks 0090
  and 0091 still read `**Reviewer**: pending` post-merge. This was *not* an
  oversight at write time — each carries an explicit clause that the end-of-flight
  review "will amend this section if it finds otherwise." The review found nothing
  adverse, so the amend never fired and the record is permanently pending. The
  clause should be unconditional: amend on *any* outcome.
- **Flight 1 of this mission has no `flight-debrief.md`.** Discovered during this
  debrief's context loading. It breaks a metrics chain every debrief from M18 F1
  through M20 F3 maintained, and its test-count jump (4996 → 5173) is recoverable
  only from a squawk's incidental record.

### Technical

- **The four hand-edited type sources are real accidental complexity, not a
  documentation gap.** `vault-item-schema.js`'s `SCHEMA`, `vault-store.js`'s
  independent `ITEM_TYPES` literal, `vault-editor-model.js`'s `EDITOR_LAYOUT`, and
  `vault.js`'s `ITEM_SUBSECTIONS` are genuinely independent. DD4's list grew 2 → 3
  → 4 *within one flight*, with the 3rd and 4th found live at design review because
  nothing forces them into view except a reviewer's memory. Recon confirmed the
  sites already claimed; it never independently searched for unclaimed ones. **A
  literal-string grep for `'login'`/`'card'`/`'note'` across `src/` at recon time
  would have surfaced all four.** Better: collapse them toward a single derivation
  point before a fifth type is proposed, retiring the defect class rather than
  relying on ever-better checklists.
- **Flight 3 starts in a compounded deficit, not just a line-budget one.** It
  inherits the fill-precision regression (still live), the unwired DD2 backstop,
  the family-conflict precedence rule (decided, never exercised against a real
  contested field), *and* `renderer.js` at 1576 lines against a 1577 budget
  (verified). Concretely: there are **7 `isCard` branch sites in
  `vault-picker-template.js` and 4 in `vault-capture-template.js`** — 11 binary
  branches that each become three-way. Turning them into a type-keyed dispatch is a
  net line-reducer per site and should be **its own early step**, before a third
  branch is added anywhere. New chrome glue routes through `vault-controller.js`,
  never `renderer.js`, which has one line of slack.

### Documentation

- **`mission.md`'s Flight 2 synopsis is stale.** It still describes DD1's
  **round-1, superseded** rule ("a specific token stands alone, a generic one needs
  a qualifying prefix") rather than the scope-anchor rule that shipped. `flight.md`,
  `flight-log.md` and CLAUDE.md all describe it correctly — only the mission
  artifact is wrong, so a reader starting there gets the wrong plausibility rule.
- The **drift-guard pattern** (a pure module's constant asserted equal to another
  module's derived union) is now used three times across this feature and is worth
  an explicit entry under CLAUDE.md's *Recurring module shapes*.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Flight scope-split at design review; fill/capture/sheets deferred to Flight 3 | First draft repeated Flight 1's sizing mistake across a *narrower* split | **Yes** — adopt the "unproven adversarial axes" count as a drafting-time check |
| Three decisions made at the Leg 2 cycle cap instead of escalating | Two were mechanical closures of demonstrated holes; the third was not | **Partly** — mechanical closures yes; anything trading on a mission success criterion escalates |
| Leg 3's second design review skipped in favour of the flight-end Reviewer | Its findings were enumeration-completeness, which diff-reading closes well | **Yes** — match the review instrument to the defect class, stated out loud |
| DD1 rewritten twice, DD4 amended twice mid-flight | Reviewers ran probes against real code; each fix opened a narrower hole | **No** — this is the process working; reduce it with probe-backed input claims instead |
| Local gates stood in for unrunnable Concourse CI | Interactive login unavailable to the crew | **Yes** — state the substitution plainly, never imply full CI ran |
| Bundle import softened from "load loudly" to tolerant-and-reporting | An unknown type must not fail an entire multi-vault restore | **No** — carve-out is deliberately scoped to bundle import; the `.gfvault` parse path stays loud |

## Key Learnings

1. **Adversarial claims need adversarial proof.** Every HIGH in this flight was a
   claim about existing code that nobody had run. Reviewers who ran probes found
   them; reviewers who reasoned did not.
2. **Prove a gate is load-bearing by removing it.** Leg 2's throwaway no-gate
   detector variant, and its honest 4-of-5 result, is the strongest evidence in the
   flight — and a better pattern than asserting a gate matters.
3. **Two type sources is a documented fact; four is a defect class.** Enumeration
   claims decay silently. Search for unclaimed sites; don't confirm claimed ones.
4. **A backstop with no caller is a plan, not a backstop.** `classifyCapture` is
   unit-proven and unwired. The incident-form acceptance should read: *accepted,
   with DD2's conflict rule as the backstop **once a profile already exists**, and
   no backstop at all on a fresh vault* — because on a first-ever identity capture
   every field is a gap-fill and the conflict rule cannot fire on its own headline
   scenario.
5. **Decoupled legs can still be correctly ordered.** Risk-retirement is a
   legitimate sequencing reason even with no technical dependency — say so in the
   spec, as this flight did, so nobody later mistakes it for a missed parallelism.

## Test Metrics

5291 tests — **5288 pass, 0 fail, 3 todo**, 25 suites, no flakes across two runs.
Wall-clock 7.3–7.9s (`duration_ms` 6605–7330).

| Flight | Tests | Wall-clock |
|---|---|---|
| M18 F1 | 4008 | 3.58s |
| M18 F2 | 4118 (+110) | 6.16s |
| M18 F3 | 4294 (+176) | ~5.2–5.7s |
| M19 F1 | 4432 (+138) | 5.76s |
| M19 F2 | 4436 (+4) | 5.83s |
| M20 F1 | 4565 (+129) | 4.97s |
| M20 F2 | 4783 (+218) | ~5.4–5.6s |
| M20 F3 | 4996 (+213) | 5.33s |
| M21 F1 | 5173 (+177) | **not recorded — no debrief exists** |
| **M21 F2** | **5291 (+118)** | **7.3–7.9s** |

A ~6% test-count rise against a ~35–48% wall-clock rise breaks the flat 5.2–6.2s
band every debrief since M18 F1 held. **This flight's own work is not the cause**,
and that was investigated rather than assumed: all five new test files finish under
1s combined, most under 100ms, while the pre-existing scrypt-heavy
`vault-compromise-rotate.test.js` alone now reports 4560ms against the 2548ms M19
F1 recorded for the same file — a file this flight does not touch. That points to
machine/environment variance (WSL2, sandbox load) rather than a code regression,
but it is a single investigation on one machine and should be re-measured on a
quiet one before anything is concluded.

## Recommendations

1. **Adopt probe-backed input claims.** Every "verified at design time" citation in
   a leg spec carries a literal probe output or an explicit "reasoned, not run"
   flag. Cheapest available net for this mission's dominant defect class.
2. **Collapse the four `ITEM_TYPES` sources** toward a single derivation point
   before a fifth item type is proposed — and until then, run a literal type-name
   grep across `src/` at every flight's recon, rather than confirming named sites.
3. **Flight 3 plans an extraction step as step one**, sized against the concrete
   11 `isCard` sites, with the M20 F3 Leg 1 precedent (1806 → 1532 lines in one
   leg) as the model. Do not discover the budget mid-implementation.
4. **Treat wiring `classifyCapture` into a live caller as a hard-zero acceptance
   criterion in Flight 3**, not an ordinary feature task — the incident-form
   acceptance's validity depends on it, and the fresh-profile residual means a
   first-ever capture currently gets no additional friction at all.
5. **Apply the "unproven adversarial axes" count to Flight 3 at drafting.** Its own
   scoping already calls it "comparable in scope to the original card-type work" —
   that is a signal it may need the same split scrutiny Flight 2 got, this time
   before the first review round rather than at it.

## Action Items

- [x] Correct `flight.md`'s stale "Mission flight list updated" checkbox (the list
      itself was updated correctly in `016e540`; only the box was unticked)
- [ ] **(squawk 0093)** Fix `mission.md`'s Flight 2 synopsis — it states DD1's superseded round-1 rule
- [ ] **(squawk 0094)** Close squawk 0090 and 0091 sign-offs (still `pending` post-merge) and make the
      amend clause unconditional rather than adverse-only
- [ ] Backfill a Mission 21 Flight 1 debrief, or at minimum its test-metrics section
- [ ] Re-measure suite wall-clock on a quiet machine to settle the M20 F3 → M21 F2 jump
- [ ] **(squawk 0095)** Document the drift-guard pattern under CLAUDE.md's *Recurring module shapes*
- [ ] Carry into Flight 3 planning: extraction-first leg, the four dangling threads
      (fill precision, unwired DD2, LD3 precedence, renderer budget), and the
      corrected incident-form acceptance language
