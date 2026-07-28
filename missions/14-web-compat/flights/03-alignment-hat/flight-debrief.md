# Flight Debrief: Alignment / HAT — Deferred Verification Bundle + Human Acceptance

**Date**: 2026-07-28
**Flight**: [Alignment / HAT](flight.md)
**Status**: landed
**Duration**: single interactive session, 2026-07-28
**Legs Completed**: session-plan flight (no pre-designed legs); all 8 session-plan items executed

## Outcome Assessment

### Objectives Achieved

The seven-item deferred verification bundle was discharged in full, live, with the operator witnessing: fullscreen 7/7; basic-auth 7/7 (incl. the `vaultAnswerAuth` agent path); client-cert closed after un-stacking three defects; PDF closed; OAuth fixture closed with the census criterion verified while the popup floated; the live-provider witnessed run closed via a Google OAuth popup on claude.ai. **Every mission criterion is now checked** (`2a3404a`). Seven inline fixes landed (~656 insertions, each root-caused, live re-verified, and pinned before close; 3089→3095 tests). Two mission seeds filed (#143, #144); one follow-up flight promoted (vault-on-auth-sheet); one Known Issue accepted and (per this debrief) recorded in mission.md.

### Mission Criteria Advanced

All ten. Four closures are **soft and go to the mission debrief as ratification items, not inheritances** (Architect audit): (1) the Google-for-GitHub live-provider substitution (strong argument — Google was flagged the harder provider — but the criterion text named GitHub; GitHub's specific flow remains unexercised); (2) fullscreen checked against the accepted stale-bounds Known Issue (operator-ruled; mission.md now carries the entry this ruling was conditioned on); (3) the vault-login re-run subsumption (check the M13 carry-forward's specific intent before ratifying); (4) **D1's declared closure was not literally discharged** — the port re-verify happened on the *cert* sheet (shared `displayHost` helper), not the *basic-auth* sheet; one basic-auth prompt at the next dev session closes it cheaply. The no-regression criterion rests partly on F1's recorded assessment + P1–P5 live positives — within its own terms, stated explicitly here.

## What Went Well

- **Bundle ordering vindicated**: fullscreen-first exposed the capture-composite lie at checkpoint 2, so every later capture ran on a repaired apparatus. The generalized principle: **the item that stress-tests the observation channel runs first**.
- **The Witnessed pattern + human co-pilot earned everything**: operator overrides in both directions (machine FAIL overturned by eyes; machine PASS overturned by screenshot); the operator's trailing-dot probe caught a defect that would have blanked attribution on essentially every real mTLS domain; the operator's accidental alt-tab live-verified the blur/re-present occlusion contract; the operator's Chrome contrast seeded #143.
- **Fix-vs-feature gate held under pressure**: seven inline fixes (all restore-intended-behavior class), three feature-shaped findings correctly diverted (two issues, one follow-up flight). Tiebreaker precedent recorded: *parity with a sibling surface shipped this mission = fix; parity with an external browser = feature*.
- **Fixes at house standard despite live pressure** (Developer audit): rationale-dense comments with live measurements cited; parametric test-table threading; the six-form/seven-case input pins (#7, displayHost) named the model for premise-gap pinning.
- **Honest epistemics**: the two-candidate crash-mechanism attribution, the "attempted" AC deviation records, and the unreproduced-transient flag were all preserved rather than smoothed.

## What Could Be Improved

### Process
- **Apparatus audit was reactive**: four defect classes (key tier, instance binding, capture veridicality ×3 forms, launch-environment fidelity) were each found by collision with reality. The audit must become a pre-flight checklist with standing infrastructure (below).
- **Deferral stacking**: three defects on one path masked each other serially (crash hid blank sheet hid blank attribution), making diagnosis sequential and expensive. Candidate standing rule: *a leg landing live-unverifiable code names the first defect its deferral could mask*; a thin early live smoke unstacks.
- **Lean-HAT record asymmetry**: client-cert, PDF, and oauth-popup produced flight-log narrative but no committed per-spec run logs — the per-spec run history has holes exactly where the most defects were found. Lean mode gets blessed only with its guardrails (below), including a condensed-run-log requirement.
- The mechanical flight-close artifact lint (owed since F1) would have caught the mission.md Known-Issues omission — third flight in a row to hit this class.

### Technical
- **The fixed shape-gate still fails silent** (`modelShapeOk` reject → bare return after the sheet is already visible): the enabling condition for blank-sheet symptoms is pinned, not removed. Remedy: extract the gate table to an importable module (unit-testable with live payloads — also pays down the exact-literal source-pin debt F2 flagged and F3 grew by ~7 instances) and make dev-build rejection loud.
- **Capture veridicality forms 2–3 are structural**: no in-process capture sees physical cropping. Permanent rule: that class requires a human witness or out-of-process capture; captures carry bounds-source provenance stamps; tiered self-check (automatic dimensional check per run; HAT-preamble known-state-vs-operator check).

### Documentation
- CLAUDE.md popup subsection still owed (F2 debrief). Stale test comment in `cert-picker-template.test.js` (pre-#7 host derivation description). AUTHORING gains: S1–S4 from the basic-auth run + the fixture input-domain diversity rule.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Lean-HAT mode (no crews) for 3 items | Operator-centric steps; session economy | Yes, with 4 guardrails: eligibility (trusted observables only, never zero-prior-evidence items), role separation (actor ≠ judge), condensed run log required, FAIL escalates to full crew |
| Google-for-GitHub live provider | Operator's GitHub path doesn't force a popup; Google is the harder target | Ratify at mission debrief |
| Verdict batching / parallel operator steps | HAT pacing | Yes for HAT mode |
| Seven mid-run app relaunches | Main-process fixes require restart | Expected HAT cost; front-load fixes that need relaunch where possible |

## Key Learnings

1. **All three archaeology defects lived in the unit-modeled-reality gap** (fake callback arity, bypassed dispatch, digit-leading-only fixtures) — the gap behavior tests exist to close, and the argument against concentrating all live verification in a terminal flight.
2. **Closure classes per defect** (Developer + Architect concur): native-callback contracts → live premise probes + real-object shape pins (join the Electron-bump standing tax with all four measured callback shapes); cross-flight shape changes → producer→consumer contract pins + consumer census at design review; platform-delivered strings → input-form matrices + never-blank display fallbacks.
3. **The apparatus is now calibrated, not self-checking** — trustworthy-as-audited against four known modes with no mechanism to catch a fifth; the standing infrastructure (stamping, tiered self-check, launch attestation, four-axis checklist) is what converts that.
4. **Credential-surface origin-attribution parity** is a design-review checklist line, not a copy nicety — it would have caught D1 and the cert-sheet gap on paper.

## Recommendations

1. **Mission debrief must**: ratify the four soft closures; set the stale-bounds follow-up disposition; ratify vault-login subsumption after checking the M13 item's specific intent; discharge D1's literal closure (one basic-auth prompt); keep the fix-#5 transient on the watch list.
2. **Adopt the standing rules** consolidated by the Architect (§5 of the interview, recorded in the flight log): lean-HAT guardrails; observation-channel-first ordering; four-axis apparatus checklist + stamping/self-check/attestation; native-contract premise obligation; producer→consumer pin class + loud gates; fixture diversity + never-blank; deferral-masking disclosure; the fix-vs-feature tiebreaker.
3. **Route the seeds**: #143+#144 as the "site trust & permissions" mission (per-origin store first, trust UX second; fold basic-auth O1 — jar auth-cache semantics — into its scope; **renderer.js extraction is a named prerequisite before its first flight**). Vault-on-auth-sheet as a standalone small flight with the a11y sheet-sweep ruling as its first DD — not a passenger on the trust mission.
4. **Pay the pin debt**: extract `modelShapeOk` to an importable module (first payoff of the source-pin normalization owed since F2).
5. Behavior-test protocol (mission-control side): promote S4's capture-timeout substitution rule, the four-axis audit, and the veridicality preamble into the skill/AUTHORING docs — three apparatus classes in one mission is a protocol gap, not project bad luck.

## Test Suite Timing

3095 / 3095 pass, 0 skipped, twice (2863 ms, 2814 ms runner-internal); F1 2993 → F2 3089 → F3 3095; duration flat — HAT pins absorbed at zero time cost. Slow tests unchanged (pre-existing crypto/session-log band). The fix-#5 single-run transient did not recur in either debrief run — watch item, no action.

## Operator Interview

1. **Pacing**: "the rhythm is fine, working multiple sessions at a time" — the HAT cadence (one-step cueing, fix-loop waits) suits an operator who multitasks across sessions; waits are not dead time. No structural change requested.
2. **Popup limitations**: fine as shipped — with a correction worth preserving: the "no address bar in popups" item was an FD-inferred gap, not an operator complaint; the operator rates address-bar-less popups as **preferred** (matches mainstream minimal popup chrome). Reclassify from named-accepted-gap to confirmed-design-choice; close-with-opener and inert shortcuts drew no objection in practice.
3. **Daily-drive confidence**: "yes, it's becoming my daily driver — we still have gaps though." The mission's outcome statement validated by adoption; the acknowledged gaps map to the queued seeds (#143 trust UX, #144 popup defense/permissions, vault-on-auth-sheet).
