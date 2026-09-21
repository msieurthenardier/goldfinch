# Flight Debrief: Identity Fill and Capture

**Date**: 2026-09-21
**Flight**: [Identity Fill and Capture](flight.md)
**Status**: landed
**Duration**: 2026-09-20 (planning) – 2026-09-21 (landed; `45a9a44` Legs 1-4, `8d25980` Legs 5-6; PR #228)
**Legs Completed**: 6 of 6 (four planned autonomous legs, an operator HAT, and a fix leg the HAT spawned)

## Outcome Assessment

### Objectives Achieved

The flight did what its objective asked: Flight 2's identity foundations now reach
a live page end to end — detection in the isolated world, a third in-field icon,
fill from the picker, capture back into the vault through `classifyCapture`, and a
capture sheet that names changing fields without ever showing a value. It also
closed both debts handed forward: the fill-precision regression (mission Known
Issue 3, verified live) and `classifyCapture` having no live caller.

It did **not** deliver its own headline scenario as designed. Four legs were built
and reviewed before the HAT found that on a checkout where card and billing fields
share one form — the mission's motivating Jostens shape — the identity could never
be offered by any gesture. It was fixed in-flight as Leg 6 on the operator's ruling
and re-walked live. The flight landed with its headline working, but only because
the HAT caught what four legs of review did not. That is the central fact of this
debrief.

Everything that matters was verified on a real page, because the capture sheet is
unobservable to every automation tier (DD4 rejected a behavior test on exactly that
ground). The HAT walked, and passed: a fresh save; an update naming fields but no
values (DD6) and erasing nothing (LD8); fill landing in the clicked form (DD9); the
multi-hold queue; SPA detachment settle; the stuck-`sheetOpen` fix; a cross-window
lock wiping a held identity (LD7); the locked-vault drain; and, after Leg 6, one
click raising card + identity on a combined checkout and login + identity on a
sign-up form with the login-claimed email never double-counted.

### Mission Criteria Advanced

- **A name, address, email and phone can be saved from a checkout form and filled
  into a later one** — **met for this flight's scope**, live: save, update and fill
  all walked, including the combined checkout after Leg 6.
- **Identity capture is gated by a stated plausibility rule** — **met.** DD2's
  anchor + non-postal gate applied to live capture and observed working at HAT
  Step 6. The operator re-affirmed it at debrief after seeing its cost.
- **An offer when the entry has demonstrably gone somewhere** — navigation-commit
  and field-detachment settle both verified live, with trace evidence.
- **No offer without a genuine gesture** — the `isTrusted` gate is unchanged. Leg 6
  widens *when* a gesture may capture (every family it maps to), never *what*
  counts as a value; each family keeps its own gate.
- **Zero offers on the negative set** — held throughout, and audited structurally
  before Leg 6 changed gesture resolution.
- **The existing exclusions still hold** — no identity value reaches the offer
  model (sentinel-probe pinned, confirmed live); automation still exposes login
  items only.
- **Coverage of the gated corpus** — advanced: `billing-jostens` promoted to
  `offers`; three new `offers-multi` fixtures, proven non-vacuous by neuter.

## What Went Well

- **The HAT was the most valuable leg, and the reason is specific.** Before step 1,
  the Flight Director wrote each step's *expected result against the code*, not
  against the design — and that is what surfaced the headline gap. The same
  discipline then caught two of the Flight Director's own mistakes in the HAT plan
  itself (a checkout "workaround" that could not work, and a Step 7 no operator could
  perform) before the operator ever tried them.
- **Review caught three would-be-shipped defects on the mission's hard zeros**, all
  by a reviewer *running a probe*: a fourth family-blind supersession loop
  (`captureCard`, bound as `prior`) that would have zeroized sibling offers; a
  specified duplicate of an existing resolver; and ten fields of PII that
  `dropCapture` would never have zeroized. Plus Leg 2's two round-2 HIGHs and
  Leg 6's early-`return` HIGH.
- **Structural fixes beat checklists, repeatedly.** LD7 (`dropCapture` zeroizes
  every Buffer instead of a named list) retired a defect class rather than adding
  a fourth name, and is the flight's best single piece of design — it emerged in
  review, not at flight design. `dispatchByFamily`/`FAMILY_REFUSED` and
  `vault-capture-plan.js`'s planner/actuator split did the same for "binary with a
  login default" and "a `return` in a loop drops siblings".
- **Neuter-verification became the house standard.** Nearly every security-critical
  claim was proven by breaking the fix, recording the RED output, and restoring —
  including two follow-ups the Flight Director demanded specifically to prove new
  assertions were not vacuous. The Developer interview names it the standout
  practice of the flight.
- **Mechanism-before-family sequencing was vindicated.** Legs 1-2 proved the
  plumbing on existing login/card behaviour; Leg 6 later built on Leg 2's queue
  with zero rework to Legs 1-4.
- **Security decisions held under live pressure.** The operator asked mid-HAT for
  before/after values on the update sheet; DD6 routed it to a design process
  instead of folding it in on HAT momentum. The fix-vs-feature gate did exactly
  its job on the combined-form gap as well.
- **`GOLDFINCH_VAULT_TRACE` was decisive in the HAT** — it separated "page never
  sent / main refused / sheet never opened" in one repeat, and twice turned an
  ambiguous operator report into a clean answer.
- **Flight 2's recommendations were acted on**: probe-backed input claims (every
  prerequisite carried a probe), extraction as its own first leg, `classifyCapture`
  as a hard-zero AC, and the axes count at drafting. The wall-clock anomaly it
  flagged was re-measured and resolved (see Test Metrics).

## What Could Be Improved

### Process

**The central failure: two design decisions contradicted each other, and no review
asked the question that would expose it.** DD1 named the headline problem verbatim
("the card would win and the billing identity would never be offered at all"), and
the planning recon quoted its cause ("`resolveGestureTarget` returns exactly one
`{kind, ordinal}`"). DD1 then fixed four things at the hold / release / present
layers — none at gesture resolution. Worse, **DD5 affirmatively specified the
defect**: "precedence login > card > identity, consistent at detection, at icon
placement, **and at gesture resolution**" (confirmed at `45a9a44`). One gesture,
one winner. It survived two flight-design rounds, five leg-design reviews and the
flight-end code review. Leg 2's acceptance criteria proved "a login hold and a card
hold coexist" by calling `holdGestureLogin` and `holdGestureCard` *directly* — the
one case that works, bypassing the very function the recon had named.

The two debrief interviews disagreed about what this is, and the disagreement is
worth keeping:
- **The Architect** argues all six Flight Director misses — five enumeration misses
  and this one — are **one root habit**: *verifying a claim against itself instead
  of re-deriving it from the code*. The enumeration misses checked "did I edit every
  site I listed", never "is my list complete"; this one checked "is my mechanism
  correct", never "does my mechanism's own motivating example work". One habit,
  cheaper to teach than two.
- **The Developer** argues this one is a **different and more serious class**: the
  enumeration misses were caught by the existing probe instrument, working as
  designed; this one survived every review because *no review was ever scoped to
  re-derive the flight's founding causal chain*, and a large volume of
  correctly-reviewed mechanism around the bug created false confidence that the bug
  itself was addressed.

**The Flight Director's adjudication: both are right, at different levels.** It is
one root habit, but it fails at different scopes, so it needs a remedy at each
scope — and DD5 contributes a third, concrete, checkable property:
1. **A Scenario Trace at flight design.** Any DD whose own prose names a concrete
   scenario carries a probe-backed trace of that scenario through the *planned*
   post-change code, from its real entry point (`onCaptureGesture`) to the
   observable outcome (two sheets). Five minutes with `grep` and `node -e`; it would
   have hit `resolveGestureTarget` immediately.
2. **A DD-consistency question at flight-design review.** "Does any design decision
   constrain behaviour that another decision's motivating scenario depends on?" —
   DD5 × DD1 is the exact case. No current review prompt asks it.
3. **An AC-trigger rule at leg design.** An acceptance criterion that claims to
   prove a DD's scenario must drive it from the DD's *own stated trigger*, never a
   substitute call into the downstream mechanism.

The irony is instructive: remedy 1 is exactly what caught the gap — performed
informally, by one person, at the last moment before the HAT. The recommendation is
to formalise it and move it to before any code exists.

**The sizing heuristic has the same blind spot.** The "unproven adversarial axes"
count (Flight 2's recommendation, adopted) enumerated *mechanisms to build* — seven
of them — but never asked *how many independent truths must hold for the headline
scenario to work*. Gesture cardinality would have been an eighth axis, and listing
it might have prompted the trace. The Architect judges the leg-split-not-flight-split
call correct and vindicated by outcome — a fill/capture flight split would not have
touched the defect — but "adequate, with its full safety margin used" rather than
comfortably right.

**Five Flight Director enumeration misses, each teaching a sharper version of the
same rule**: search for unclaimed sites, not claimed ones (the renderer line-count
pin, squawk 0096); search by *shape*, not spelling (`\.wcId === wcId` found the
`prior`-bound loop that `rec.wcId === wcId` could not); before specifying a helper,
search for one that already exists (`resolveOrdinalInFamily`, which the Flight
Director had read earlier the same session); and before claiming a mechanism covers
something, read *how* it discovers what to cover (`dropCapture`'s named list). All
five were caught before shipping. The final docs pass was the first enumeration of
the flight that held on first try.

**Leg 2 hit the design-review cap, and the unreviewed surface later yielded a bug.**
Round 2 found two HIGHs in the Flight Director's own round-1 fix; the operator chose
to proceed as amended over the recommended split; the stuck-`sheetOpen` defect later
turned up in exactly the `advance()` surface no second review had seen. It was
caught at acceptance and fixed in scope. **Operator ruling at debrief: escalation at
the cap stays case by case** — no methodology change; recorded as a data point.

**HAT test design cost retries.** A repetitive test PAN (`6011 1111 1111 1117`, where
one miscounted `1` fails Luhn) turned a pass into an apparent failure; the capture
sheet's default vault choice sent the operator to the wrong vault once; and the
sheet's dismiss-on-blur meant every step had to be read before switching windows.
Choose test values whose mistyping is visually obvious, and launch capture HATs
with `GOLDFINCH_VAULT_TRACE=1` from the start.

**A flagged item was never dispositioned in the log.** The Leg 4 Developer
transparently flagged `_seedCaptureForTest` (a write seam on the production
`createVaultHuman` object); the Flight Director deferred it to the flight-end
Reviewer, which ruled it **acceptable as shipped** (reachable from the main process
only, no IPC exposes it, consistent with the `_`-prefixed state-mutating seams in the
same feature). That verdict was relayed to the operator but never written into the
flight log. **Recorded here as its disposition.** When a decision is deferred to a
reviewer, write the verdict back.

### Technical

- **Debt introduced, all logged as squawks**: **0096** (renderer.js's line count
  pinned in two independent test files — it has now caused one real AC9 blocker and
  will cause the next on any renderer-touching leg: promote it), **0097** (a
  surviving private login `setFieldValue` copy beside the new shared
  `field-setters.js`), **0098** (two exports left without callers). **0099**
  (the lock icon has no click action) and **0100** (the kebab and context menu go
  dead in a window after closing an internal tab) are **pre-existing**, found during
  the HAT, confirmed untouched by this flight.
- **"Binary with an implicit else" recurred three times**: `familyOf`, the main-side
  capture dispatch, and the guest-side gesture dispatch — each a two-value branch
  whose `else` silently meant login. Whenever a boolean grows a third case, route it
  through an explicit per-kind table that yields nothing for an unknown kind.
- **Unverified live**: Leg 2's unintended change to detach-watch firing semantics
  (any-field → full-detachment). Unit-pinned both ways at module level, but the HAT's
  SPA page removed the whole wrapper in one mutation, which fires under both.
- **Residual carried**: ordinal fill and capture can still misassociate if the DOM
  mutates between the main-world and isolated-world enumerations — split out of Known
  Issue 3 as its own narrower mission item.
- **The wrong-moment budget is being spent cumulatively.** This flight drew on it
  materially: DD2's gate never offers an update when the site pre-filled the address
  (operator re-affirmed DD2 at debrief), and a single out-of-form button can now raise
  up to three offers. Flight 4's generator adds its own wrong-moment risk
  (new-password-field discrimination) and should plan against the running total, not
  a fresh budget.
- **Operator ruling at debrief — pending saves should survive window blur.** Today
  the capture sheet is deliberately excluded from blur survival, so alt-tabbing to
  check a detail discards the offer. The operator ruled it should survive. It is a
  decided behaviour change but **not** a squawk: it is security-sensitive (a held
  secret stays in memory while unfocused) and it interacts with Leg 2's LD2 (blur is
  an occlusion close that drops the whole queue) and with the lock-close safety valve
  (`closesOnVaultLock` would then also close it, which needs the dismiss-drop to fire
  on that reason). Carried to mission Flight 5 as a scoped design item.

### Documentation

- CLAUDE.md's "Recurring module shapes" should gain the patterns this flight proved:
  the **planner / actuator split** (a pure planner producing one entry per
  independent action, and a dumb actuator loop with a per-iteration `try/catch` and no
  early exit — Flight 4's generator likely needs it) and the **structural superset
  over a named list** (LD7). Same section and file as open squawk 0095.
- **Mission 21 Flight 1 still has no debrief** — carried open from Flight 2's debrief.
  Its test count is known only indirectly and its wall-clock not at all.
- **The flight log reached ~3,200 lines.** Both debrief interviewers read it in full.
  Much of it is Flight Director reasoning that belongs there — but its size is now a
  real reading cost on every downstream agent.
- **Git convention nit**: ARTIFACTS.md calls `Mission: {n}` a commit *trailer*, but
  it is separated from `Co-Authored-By` by a blank line in every flight commit
  (Flight 2's `016e540` included), so git has never parsed it as one. Matched
  precedent rather than diverging; worth fixing in the convention or the template.

### Methodology Feedback (mission-control skills)

- **Flight skill / flight-design review**: the Architect prompt asks about
  feasibility, reachability and cache freshness, but never "does each DD's own
  motivating scenario actually work under the plan" or "do any two DDs contradict
  each other". Both would have caught this flight's headline gap at planning.
- **Leg design**: AC guidance has no rule that a scenario-proving AC must use the
  scenario's own trigger. Leg 2's direct-call ACs were individually correct and
  collectively proved the wrong thing.
- **agentic-workflow — leg immutability**: Leg 1 was amended in-flight with a dated
  Amendment block rather than aborted, when its enumeration of test pins proved
  incomplete. The block preserved the audit trail better than abort-and-recreate
  would have. Worth offering as a sanctioned option for citation-gap amendments.
- **agentic-workflow — HAT that spawns a leg**: the workflow assumes the HAT is last
  and small. Here the HAT spawned a feature leg *after* the flight-end review and
  commit; it needed its own design review, code review and commit. It worked, but the
  skill does not describe the path.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Leg 1 amended in-flight (dated Amendment block) instead of abort-and-recreate | A citation gap, not a requirements change; the Developer had correctly stopped at AC9 | **Yes** — as a sanctioned option for citation-gap amendments |
| Leg 2 changed detach-watch semantics unintentionally, via its AC10b wording | "Extract" and "change" were written into the same criterion | **Yes** — when extracting, first pin current behaviour; describe changes in separate ACs |
| Leg 2 proceeded past the design-review cap as amended | Operator ruling over the recommended split | **No** — operator re-affirmed case-by-case at debrief |
| Docs corrected *before* the commit, not after (the workflow's order) | Committing first would have left CLAUDE.md contradicting its own code | **Yes**, whenever a commit makes documented facts false |
| A sixth leg spawned by the HAT after the flight-end review | The HAT found a design gap in the headline scenario | **No** as a plan; **yes** as a described path in the skill |
| HAT Step 7 replaced, and Step 4b corrected, mid-walk | Both were unperformable or wrong as first written | **Yes** — derive HAT steps from the operator's actual gestures, against the code |
| Leg 3 design round 2 skipped; Leg 4's and Leg 2's run | "Re-review when a fix *adds* mechanism; a fix that removes it toward prior art does not" | **Yes** |

## Key Learnings

1. **Correctly-reviewed mechanism is not evidence that the motivating scenario
   works.** Every mechanism in Legs 1-4 was right and tested; the composition was
   never asserted, and DD5 had specified against it. Trace the named scenario
   end to end, before code.
2. **Check design decisions against each other, not only against the code.** DD1
   and DD5 contradicted each other in plain text through every review round.
3. **Re-derive, don't re-read.** Five enumeration misses and one layer miss shared
   one habit: auditing a claim against itself. The remedy is to re-derive the claim
   independently — by shape, by capability, by scenario.
4. **Retire defect classes structurally.** A named list with a "MUST be added here"
   comment, a binary branch with a login `else`, and a `return` inside a loop were
   each replaced by a structure in which the mistake cannot be written. Each is now a
   pattern worth reusing.
5. **A HAT's expected results are an audit.** Writing them against the code is what
   found the headline gap, and it caught the HAT plan's own mistakes too.

## Test Metrics

**5458 tests — 5455 pass, 0 fail, 0 skipped, 3 todo** (the pre-existing corpus
`known-unsolved` shapes), 25 suites, no flake observed. Wall-clock **5.96s**. The
flight added **+167** tests (5291 → 5458). Every new identity/capture test file
finishes well under 0.5s; the slowest file in the suite remains the scrypt-heavy
`vault-compromise-rotate.test.js`.

| Flight | Tests | Wall-clock |
|---|---|---|
| M18 F1 | 4008 | 3.58s |
| M19 F1 | 4432 | 5.76s |
| M20 F3 | 4996 | 5.33s |
| M21 F1 | 5173 (+177) | not recorded — no debrief exists |
| M21 F2 | 5291 (+118) | 7.3–7.9s (flagged, unexplained) |
| **M21 F3** | **5458 (+167)** | **5.96s — back in band** |

**Flight 2's wall-clock anomaly has resolved, and it was machine variance.** Flight 2
recorded `vault-compromise-rotate.test.js` at 4560ms against a 2548ms M19 F1 baseline
and suspected the environment. Re-measured three times this flight: **2473.8ms,
2430.9ms, 2438.3ms** — back at baseline and stable. This flight did not touch that
file or the scrypt path it exercises, and the full suite is back inside the 5.2–6.2s
band every debrief before Flight 2 held. Close Flight 2's action item.

## Recommendations

1. **Add a Scenario Trace and a DD-consistency question to flight-design review.**
   In `.flightops/agent-crews/flight-design.md`'s Architect prompt: for every DD
   whose prose names a concrete scenario, require a probe-backed trace of it through
   the planned code, entry point to observable outcome; and ask whether any DD
   constrains behaviour another DD's scenario depends on. This is the single change
   that would have caught the headline gap at planning. *(Project-owned crew file.)*
2. **Add the AC-trigger rule to leg-design review.** In
   `.flightops/agent-crews/leg-execution.md`'s "Review Leg Design" prompt: an AC that
   claims to prove a DD's scenario must drive it from the DD's own trigger, never a
   substitute call into the downstream mechanism.
3. **Standardize the structural fixes in CLAUDE.md** — the planner/actuator split,
   the structural superset over a named list, and the fail-closed per-kind table for
   any branch that has grown past two cases.
4. **Flight 4 plans against the cumulative wrong-moment budget**, carries three icon
   kinds into the badge redesign (DD8), and should expect to reuse the
   planner/actuator shape for the generator.
5. **Flight 5 carries two items from this flight**: pending saves surviving window
   blur (**decided** by the operator — needs a scoped design for its security and
   queue interactions) and before/after values on the identity update sheet (a
   **question** — it reverses DD6).

## Action Items

- [x] Amend `.flightops/agent-crews/flight-design.md` — Scenario Trace (item 9) + Decision consistency (item 10) added to the Architect prompt; operator approved at debrief (Recommendation 1)
- [x] Amend `.flightops/agent-crews/leg-execution.md` — Scenario acceptance criteria (item 7) added to "Review Leg Design"; operator approved at debrief (Recommendation 2)
- [ ] CLAUDE.md "Recurring module shapes": planner/actuator split + structural superset (Recommendation 3) — operator ruled at debrief to **fold into squawk 0095** (same file, same section). **0095 exists only on the unmerged `flight/02-identity-items-debrief` branch**, so it was NOT edited here — creating a 0095 on this branch would set up an add/add conflict. Widen 0095 when that branch lands.
- [ ] Promote squawk **0096** off the deferred pile — it has caused one blocker and will cause the next
- [ ] Squawk turnaround for the open set: 0093, 0094, 0095 (from Flight 2) and 0096–0100 (this flight)
- [ ] **Loose end: land Flight 2's debrief branch.** `flight/02-identity-items-debrief` (commit `31452bb`) is still unmerged, so squawks 0093–0095 and Flight 2's `completed` status are not on `main`. The turnaround above cannot touch 0093–0095 until it lands.
- [ ] Backfill the Mission 21 Flight 1 debrief, at minimum its test metrics (carried from Flight 2, still open)
- [x] Re-measure the Flight 2 wall-clock anomaly — **resolved**, machine variance (see Test Metrics)
- [x] `_seedCaptureForTest` — dispositioned: **acceptable as shipped** (flight-end Reviewer; recorded here)
- [x] Flight 5 carried items recorded in mission.md: blur survival (decided) and before/after values (question)
- [ ] Live-verify the detach-watch full-detachment semantics with a PARTIAL-removal page at the next HAT that touches capture
- [ ] Flight 4 planning: cumulative wrong-moment budget, three icon kinds, planner/actuator shape for the generator
