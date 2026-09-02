# Flight Debrief: Compromise-Mode Rotation

**Date**: 2026-09-02
**Flight**: [Compromise-Mode Rotation](flight.md)
**Status**: completed
**Duration**: 2026-09-01 (planning) – 2026-09-02 (behavior-test pass + land)
**Legs Completed**: 5 of 5

## Outcome Assessment

### Objectives Achieved

The flight delivered its objective in full: one operator action fully
severs every previously issued or extracted vault credential, as a
crash-safe multi-file transaction, with the ruled Flight-1 UX end to end.
**Mission criteria 1, 2, and 3 are verified and checked**; criterion 9's
compromise half is done (Flight 3 owns portability).

- Manager format v2 with optional-but-paired admin fields and
  per-document AAD version threading (leg 1); journal-first transaction
  primitive + load-time recovery + drain/gate exclusivity (leg 2);
  `compromiseRotate` with R7 reuse rejection on both branches, the
  registry∪disk union enumeration, kdf preservation, and committed-flag
  failure discrimination (leg 3); the complete operator flow — entry in
  both lock states, verbatim R3 modal, compromise sheets with
  close-then-reopen branch switch, hold-and-resurface reveal under a
  refcounted suppression holder, completion card + `adminProvisioned`
  state, docs (leg 4); hybrid witnessed behavior test authored, amended,
  and passed (leg 5).
- Verified: suite **4008 → 4118** (+110, zero skips, every pinned-test
  touch a rename/invert); typecheck/lint/format clean; independent
  flight-end review with zero blocking findings; behavior test
  **run 2: 7/7 PASS** after run 1's fail→amend cycle; guided HAT
  satisfied within the witnessed runs (operator performed every sheet
  flow across four rotations incl. verbatim reuse rejection,
  dismiss-locked holds, and a witnessed unlock). PR #199 ready for
  review.
- Operator verdict on the shipped flow: **"panic button feels good,
  works as expected without being alarmist."**

### Test Metrics

4118 / 4118 / 0 skipped, 13 suites, **6161 ms** (one debrief run; no
flakes; zero-skip streak holds). Trail: 4003 (M17F4) → 4008 (M18F1) →
4118 (this flight, all increments logged per leg). **Wall-clock finding**:
3576 ms → 6161 ms (+72% for +2.7% tests) — attributable, not variance:
the two scrypt-heavy fault-matrix suites are the cost centers
(`vault-compromise-rotate.test.js` ~3.4 s/26; `vault-txn.test.js`
~2.6 s/22 — each interruption row is a full rotation × ~23 kill points).
Bought-and-paid-for crash-safety proof, but Flight 3's adopt/restore
suites will be scrypt-heavy too: if the battery approaches ~10 s,
consider a lower FAST_SCRYPT N for pure-machinery rows or a tagged tier
for the kill matrices.

## What Went Well

- **Nine design decisions, zero reversed, zero diverted** — and the
  correction distribution proves the layered-review architecture: every
  HIGH catch landed at a leg design review (staged-write durability;
  post-discriminator failure; H1 ack discrimination; H2
  hold-and-resurface; the CP1 inversion over-reach), and the flight-end
  review then found nothing blocking. The per-leg review layer is where
  the weight belongs, and it carried it.
- **The risk-tiering discipline paid every time it was exercised**: leg 4
  tiered up from the spec's MED-HIGH on when-in-doubt and its review
  yielded two HIGHs; the pre-named divert triggers were visibly checked
  and never fired.
- **Verbatim handoff-API quoting between legs** (leg 2 → 3 → 4 → 5)
  produced zero API friction and first-pass spec finalization — the
  strongest leg-spec set this project has had (zero implementation
  anomalies across four autonomous legs; six deviations, all
  interpretive, all accepted with rationale).
- **`vault-txn.js` is the flight's best artifact** — a general multi-file
  transaction primitive whose ordering-is-the-correctness-argument
  commentary makes it reviewable in isolation; Flight 3's restore should
  consume it rather than invent a second scheme (with the committed-flag
  caller idiom documented beside it).
- **The behavior-test fail→amend→pass cycle is the pattern's
  certification.** Run 1: 3/1/3, every non-pass an evidence artifact,
  not a product defect. Run 2 under the amended protocol: 7/7, with
  commit-before-surfacing proven mechanically (91 consecutive ticks of
  rotated-disk + visible-sheet; triple-timestamped ack-gate) — an
  ordering property proven through a wall the apparatus is forbidden to
  see through, without ever pressuring the never-widen constraint.
- **The reclassification discipline held sound epistemics**: run 1's
  checkpoint-7 verdict stands as rendered; disk forensics reclassified
  the claim to UNWITNESSED (never to "passed"); the remediation (pure
  row model + real cross-hop suite) shipped anyway; the re-run inherited
  an explicit new requirement and proved it with margin.
- **Anomaly protocol worked under fire**: the mid-HAT mint failure was
  logged at occurrence, investigated as grounding, and resolved as
  pre-existing (squawk 0058) with all three flight suspects cleared by
  direct reproduction — plus three real-store regression pins the
  stubbed harness had structurally missed.
- **Operator-witnessed testing teaches**: "Not only can I catch
  subtleties not capturable by screenshots and AI, it also teaches me
  exactly what was implemented" (operator).

## What Could Be Improved

### Process

- **Operator-facing instructions must be natural language, self-contained,
  and context-resetting** (operator, verbatim intent): mid-run
  instructions leaned on implementation-proprietary shorthand ("DD-X",
  internal component names) and drifted asynchronously from the
  operator's screen ("I had to scroll up to find these three questions").
  The operator multi-tasks and "comes in green" at every prompt — each
  operator cue should restate its own context in plain words, name
  on-screen things by their visible labels, and repeat any pending
  questions rather than referencing them. Ceremony judged "a little
  heavy" but the value high — the fix is clarity, not less rigor.
  **→ methodology item for the mission-control batch.**
- **When DOM pins are reassigned to a behavior test, ask what pure-model
  slice can stay unit-side** (the flight's one review miss, both
  debrief agents independently): leg 4's M4 reassignment left the
  report→rows mapping with zero coverage at any layer; the
  `compromiseCardRows` extraction that fixed it in hours was available
  at design time. Review-checklist candidate.
- **Per-hop canned-payload testing is structurally blind** — both
  investigations traced to fake delegates and canned shapes that only
  model imagined failure classes. The rule: for any multi-hop surfacing
  chain, at least one test must *derive* the payload end-to-end through
  real modules (`vault-compromise-report-surface.test.js` is the
  template). **→ methodology item.**
- **Prerequisites misses, both instructive**: the MCP client does not
  re-read `.mcp.json` mid-session after a key re-mint (standing M17
  risk, realized — cost a `/mcp` reconnect cycle; belongs in
  docs/dev-testing.md), and lazy vault creation grounded the flight
  briefly (mint fails on an item-less jar — now in the spec's fixture
  preconditions).

### Technical

- **The transcribed-glue-test pattern is the flight's real debt** (both
  agents, same remedy): main.js is untestable by pin, so two suites
  carry verbatim re-typed delegate/stash wiring that can drift silently
  — the exact failure class the 0051 lesson warns about, now growing.
  Extract the vault delegates (error-class→reason mapping), the
  report/stash glue, and `resurfaceCompromiseReveal`'s composition into
  a module beside `pending-compromise-reveals.js` (the M2 holder
  precedent), then delete the transcriptions. This also closes the one
  remaining composition-level coverage gap (resurface-on-next-chrome-
  boot is pieces-tested only). **Do before Flight 3 adds delegates to
  the same neighborhood.**
- **Busy-error UX is compromise-sheets-only**: a `VaultBusyError` from
  the mint delegate would collapse to "Wrong master password" — the
  same collapse class squawk 0058 pins. 0058's fix should widen
  reason-forwarding to sibling delegates (annotated on the squawk).
- **The revocation report carries no generation identity** — correct
  behavior (last-rotation-wins, session-scoped) that is nearly
  unwitnessable when consecutive reports are content-identical; one
  additive nonce/timestamp field would cheapen all future evidence.
  Fold into Flight 3's vault-state surface work.
- **Blur asymmetry is unruled and unpinned**: the credential sheet dies
  on window blur (clean abort, zero disk mutation) while the
  dismiss-locked reveal survives — arguably correct security behavior,
  but it destroyed run 1's witnessed sequence and the design question
  (should security-critical credential sheets survive focus loss?) is
  open. Rule it at Flight 3 design (more sheets ride the same
  substrate), then pin the asymmetry either way.
- **CLAUDE.md:303 is stale** ("wrapped THREE ways", "a rotation rewrites
  ONLY manager.json" — both conditionally false post-v2/compromise).
  `docs/vault.md` checked clean against shipped behavior.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Six leg deviations (zeroization wording, committed-branch best-effort recover, inline errors over invisible toasts, per-branch error mapping, menuType predicate, budget bumps) | All interpretive applications of existing discipline; each logged with rationale and FD-accepted | Yes — the accept-with-rationale flow worked |
| Behavior-test run 1 treated as fail→amend→pass cycle rather than a landing blocker to argue with | Every non-pass was an evidence-protocol artifact; the spec absorbed the amendments | Yes — evidence-design-first; see methodology items |
| Checkpoint-7 FAIL reclassified via disk forensics, verdict left standing | The card faithfully rendered a repeat rotation's correct report | Yes — the reclassification discipline (verdict immutable; claim → UNWITNESSED; addendum not edit; remediation ships; re-run inherits a new requirement) |
| Mid-HAT grounding investigation cleared flight suspects by worktree reproduction at the pre-flight commit | Distinguish flight-caused from pre-existing before touching anything | Yes — bisect-to-baseline before fixing |
| Orchestrator-performed one-word doc tidy + artifact hygiene at Reviewer direction | Reviewer-directed, zero-behavior, logged transparently | Case-by-case; log it always |

## Key Learnings

- **Evidence design is a first-class design activity.** Run 1 failed on
  protocol, not product; run 2's five-law protocol (poll-until-false with
  per-tick hashing started pre-touch; throwaway-generation provisioning
  with own-generation controls; timestamped ack-gates; focus-hold +
  memorize-then-relay; second-location mirrors; hash-verified freezes)
  converted every gap. None of it is compromise-specific.
- **The layered reviews are complementary, not redundant**: flight-level
  passes caught cross-cutting/compat issues (the v2-bundle AAD
  unimportability), leg reviews caught implementation-adjacent HIGHs the
  flight level couldn't see (staged-write durability,
  post-discriminator failure), and the behavior test caught what no
  unit layer modeled. Each layer's catches were invisible one layer up.
- **The operator is a measurement instrument with a context budget** —
  witnessed testing's value is real (subtlety-catching + teaching), but
  its instructions must be written for someone arriving cold, every
  time.
- **Untestable glue attracts transcription; extraction is the answer**
  (the holder proved it; the delegates now need it).

## Recommendations

1. **Extract the main.js vault glue** (delegates, report/stash,
   resurface composition) into a testable module and delete the two
   transcriptions — before Flight 3 builds in that neighborhood.
2. **Flight 3 design inherits, verbatim**: consume `vault-txn` for the
   restore write; design the per-vault result shape at flight level
   before any handler; rule the held-bundle lifetime matrix (this
   flight's H2 at flight scale) at design time; re-derive the
   both-reveals-one-window argument for the new adopt shape; re-verify
   every vault-store.js line citation (+818 lines — locate by symbol);
   schedule the on-script recovery-branch behavior variant; new
   import/restore entry points join the gated-op list with a restore
   row in the race pins.
3. **Methodology batch (mission-control side, with the Flight 1 items at
   mission debrief)**: promote the five evidence-design laws into
   `behavior-test/AUTHORING.md`; add the reclassification discipline to
   the run-log protocol; the real-store cross-hop test law; the
   DOM-pin-reassignment review heuristic; the natural-language
   self-contained operator-instruction rule.
4. **Rule the blur-dismissal question at Flight 3 design**, then pin the
   asymmetry.
5. **Watch suite wall-clock** into Flight 3 (tagged-tier or lower-N
   fallback ready if the battery nears ~10 s).

## Action Items

- [x] **Squawk 0060** (logged): CLAUDE.md:303 MRK-model bullet stale
  (three-wraps / manager-only-rotations claims) — servicing, routine
- [x] **Squawk 0061** (logged): docs/dev-testing.md missing the
  MCP-client-does-not-re-read-config note (`/mcp` reconnect after a
  DEV_MINT re-key) — servicing, routine
- [x] **Squawk 0058 annotated**: its fix widens non-secret
  reason-forwarding to sibling delegates (busy collapse rides the same
  path)
- [x] flight.md prerequisites checkbox hygiene (fixed in this debrief
  pass)
- [ ] **Flight 3 design inputs** (recommendation 2) — carried via the
  mission's open questions and this debrief
- [ ] **Mission debrief**: alignment-flight pattern verdict (operator
  hold from Flight 1) now has its first full downstream data point —
  every Flight-1 ruling survived implementation unchanged
- [ ] **Maintenance/next-flight**: main.js glue extraction; blur-dismissal
  ruling + pin; report generation-identity field
