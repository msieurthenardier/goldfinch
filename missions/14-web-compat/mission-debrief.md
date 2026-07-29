# Mission Debrief: Web Compatibility — Silent Failures Become Working Features

**Date**: 2026-07-28
**Mission**: [Web Compatibility — Silent Failures Become Working Features](mission.md)
**Status**: completed
**Duration**: 2026-07-27 → 2026-07-28 (planned, executed, and HAT-verified across one autonomous run + one interactive session)
**Flights Completed**: 3 of 3

## Outcome Assessment

### Success Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| Fullscreen expands over chrome, restores cleanly, live site | **met** | 7/7 Witnessed run; operator-ruled at checkpoint 7 with the stale-bounds Known Issue recorded (ratified; disposition: maintenance queue) |
| OAuth fixture flow end to end | **met** | Live run: real popup window, census verified while floating, self-close + token delivery operator-witnessed |
| Live-provider witnessed OAuth | **met (ratified deviation)** | Google popup on claude.ai — the *harder* provider than the "GitHub preferred" wording; ratified by operator |
| Popup ruling human-approved with parity checklist | **met** | Option B ruled 2026-07-28 against the FD recommendation — an *informed* decline; costs priced accurately (zero implementation surprises) |
| Popups visible to automation census | **met** | enumerateWindows + enumerateTabs popup rows verified live |
| Basic auth prompts via secure chrome UI | **met** | 7/7 Witnessed run; five security positives proven live (P1–P5) |
| Agent vault-mediated auth answer | **met** | `vaultAnswerAuth` live: `{answered:true}`, zero credential fields ever crossing the boundary |
| Client-cert chooser | **met** | Closed after un-stacking THREE defects (SIGSEGV cancel; cross-flight gate regression; host-scheme parse) — the mission's hardest verification |
| PDF inline without double-download | **met** | Premise-checked at build (viewer = guest subframe), operator-verified at HAT |
| No mission-13 posture regression | **met** | F1's recorded security assessment + live positives + 3095-test suite; partially inherited from F1 artifacts (stated, not implied) |

### Overall Outcome

**Achieved, validated by adoption**: the operator's closing verdict — *"it's becoming my daily driver, we still have gaps though"* — is the outcome statement confirmed in the strongest currency available, and every named remaining gap maps onto an already-routed seed (#143, #144, vault-on-auth-sheet). Nothing surfaced at HAT that lacks a home.

## Flight Summary

| Flight | Status | Key Outcome |
|--------|--------|-------------|
| 1 main-process-wiring | completed | Four wiring gaps closed in 4 legs; zero implementation deviations from design-reviewed specs; the three-outcome premise check born (DD5); apparatus tier-gap discovered |
| 2 popup-opener | completed | Spike-grounded proposal → human ruled Option B (recommendation declined, informed); parity re-implemented in full; two premise checks favorable |
| 3 alignment-hat | completed | Seven-item bundle discharged live; **seven inline fixes**; three defect classes only reachable by HAT; apparatus calibrated across four failure axes; two mission seeds filed |

## What Went Well

1. **The gate-and-latitude structure**: one human ruling (popup approach) gated exactly the right thing; delegated latitude absorbed two DD refinements (disposition axis; eligibility decoupling) without re-opening it. The declined recommendation was implemented faithfully — proposal costs priced so accurately that implementation produced zero surprises.
2. **Premise-check-first with pre-made rulings** (three uses) — falsified Electron folklore twice, once paid off in code *not* written, and the F3 isolation harness turned a silent native crash into a four-shape measurement table.
3. **Risk-tiered design review at a 100% catch rate** across six legs — every high finding (wrong event object, data-loss eligibility case, ledger-first ordering, wrapper-replaces-registration) was caught pre-code.
4. **The Witnessed pattern with a live human**: operator overrides in both directions; the trailing-dot probe that caught a production-wide attribution bug; the accidental alt-tab that live-verified the occlusion contract; the Chrome contrast that seeded #143.
5. **Architecture improved, not just survived**: three flights' additions form one design (the kind-parametric challenge store absorbed certs and popups without reshaping); composition root healthy; vault surface growth exemplary (`answerAuth` mirrors `fill` exactly).

## What Could Be Improved

1. **All-terminal live verification concentrates and stacks risk**: three defects on the client-cert path masked each other serially. Adopt the deferral-masking disclosure rule and thin early live smokes for live-unverifiable legs.
2. **The apparatus lied four ways before we audited it**: key tier, instance binding, capture veridicality (three forms — one structural), launch-environment fidelity. It is now calibrated, not self-checking; the standing infrastructure (bounds-source stamps, tiered self-check, launch attestation, four-axis pre-flight checklist) converts that.
3. **Proposal rigor concentrated on the recommendation**: B lacked an A-grade parity checklist and DD1a–f had to be derived post-ruling. Rule: price non-recommended options to comparable depth when a decline is plausible.
4. **Artifact hygiene class recurred three flights running** (checkbox drift, duplicate headings, the mission Known-Issues omission) — the mechanical flight-close lint is now overdue, not merely owed.

## Lessons Learned

- The unit-modeled-reality gap (fake callback arities, bypassed dispatch gates, input-domain monoculture fixtures) is where all three archaeology defects lived — with closure classes now named per defect (live premise probes + real-shape pins; producer→consumer contract pins + consumer census; input-form matrices + never-blank fallbacks).
- Parallel registries convert structural guarantees into convention+pins — sustainable only with the mandatory "popups: in scope / named-out" DD classification (canonized).
- Origin attribution on credential surfaces is a design-review checklist line, not copy polish.
- Chromium-native behaviors (empty-store cert-less continue; per-session credential caching) must be calibrated against a reference browser before being triaged as goldfinch bugs.

## Methodology Feedback

**Ratified rulings** (operator, this debrief): Google-for-GitHub substitution ratified; stale-bounds → **maintenance queue** (top of next routine-maintenance; if root cause implicates the slot-measurement convention, the fix may ride the renderer-extraction flight); vault fill/capture re-run **NOT subsumed** — residue rides the vault-on-auth-sheet flight as prerequisite verification (Architect independently concurred: `answerAuth` structurally cannot stand in for fill-path evidence).

**Adopted for the methodology** (route to mission-control): lean-HAT mode blessed with four guardrails (eligibility, actor≠judge, condensed run logs, FAIL-escalates); observation-channel-first bundle ordering; four-axis apparatus audit + veridicality preamble into behavior-test AUTHORING (+S1–S4, fixture diversity, capture-timeout substitution rule); deferral-masking disclosure; fix-vs-feature tiebreaker (sibling-surface parity = fix; external-browser parity = feature); delegated-latitude shape (replace a wrong approved sub-rule, log it, don't re-open); leg lifecycle vocabulary ruling + flight-close artifact lint (build it).

**Operator's process verdict**: pacing/rhythm fine (multi-session working style); the one-gate autonomous structure held; popup minimal chrome reclassified from inferred-gap to confirmed design choice.

## Action Items

- [ ] **Next-mission seed**: "site trust & permissions" from #143 + #144 — per-origin store first (jar-scoped — architectural constraint recorded: a global store would leak cross-jar signal), trust UX second; **renderer.js extraction is a named prerequisite before its first flight**; fold basic-auth O1 (jar auth-cache surfacing) into scope
- [ ] **Vault-on-auth-sheet flight** (standalone): a11y sheet-sweep ruling as first DD; M13 fill/capture re-run as prerequisite verification (with F1's `--no-sandbox` scope note)
- [ ] **Maintenance queue**: stale-bounds diagnosis (apparatus now instrumented for it); `modelShapeOk` extraction + loud dev rejection (quick win, pays two debt classes); D1 literal discharge (one basic-auth prompt); comment/doc scrubs (`ALLOWED_NONGUEST_SCHEMES`, cert-picker test comment, stale-instance check → docs)
- [ ] **Docs owed**: goldfinch CLAUDE.md popup subsection + pattern canonizations (premise-check-first, observer hooks, kind-parametric stores, contract pins, never-blank derivations, popup-registry-first ladder) + consolidated **Electron-bump standing-tax section** (PDF premises, three popup premises + disposition semantics, four cert-callback shapes)
- [ ] **Mission-control side**: AUTHORING/skill updates per adopted rulings; GitHub-popup warm-up check optional at next dev session (not required by the ratified substitution)
- [ ] **Watch**: fix-#5 single-run transient (no recurrence in two debrief runs)
- [ ] Mark PRs #141/#142 ready for review; merge chain in order
