# Flight Debrief: Release Integrity

**Date**: 2026-11-19
**Flight**: [Release Integrity](flight.md)
**Status**: landed
**Duration**: 2026-11-19 (single day)
**Legs Completed**: 3 of 3
**Plugin version**: mission-control 1.2.4

## Outcome Assessment

### Objectives Achieved

A release now sees its own gate. This addresses maintenance report 2026-11-18, findings #1 and #16: v0.19.16–.18 were tagged on commits that failed the audit gate, because `build.yml` relied on Concourse having passed.

- **`release-runs-audit`.**
  - **The step:** the `build` job runs `npm audit --audit-level=high` on the Linux entry, BEFORE `npm ci`, so no project install script runs ahead of the gate. The step has no softening and no new permission.
  - **The pins:** invariants in `release-workflow-invariants.test.js` pin the exact step and its placement, the fuse check on every platform, and the gate's EFFECT: `upload` requires `needs.build.result == 'success'`, so a failed audit stops upload, attest and publish even though `fail-fast: false` lets mac and win finish.
  - **Live check:** `workflow_dispatch` [run 44456941596](https://github.com/msieurthenardier/goldfinch/actions/runs/44456941596) passed. The audit step passed on Linux and was skipped on win and mac, all three builds were green, and nothing was published.
  - **Docs:** RELEASING.md has a new *The audit gate* section, and CLAUDE.md is updated.
- **`dependabot-repin-note`.** A note in `.github/dependabot.yml` says to re-pin to a full commit SHA before merging, and a test pins the note.
- **`electron-45-patch`.** Electron 45.3.3 → **45.4.1**. Only Electron moved in the lockfile. The full suite, the fuse check on a packed build and a live smoke all pass, and the required `third-party-cookie-isolation` gate ran **14/14** on 45.4.1, with two app-driven restarts attested ([run log](../../../../tests/behavior/third-party-cookie-isolation/runs/2026-11-19-04-01-53.md)).

### Mission Criteria Advanced

- [x] **A release cannot be built from a commit that fails the audit or fuse gate.** The tag path's first live confirmation is the next real release.
- [x] **Dependabot cannot quietly regress SHA pinning, and the runtime is on the current Electron 45 patch.** The Dependabot side is an advisory note: CI still catches a mutable tag only after merge.
- With Flights 2 and 3 already complete, **all five Mission 24 criteria are met.**

## What Went Well

- **The external change flowed through cleanly.** Leg 3's audit check reported 0 vulnerabilities. The Flight Director traced that to GitHub having WITHDRAWN GHSA-fc5q-39xc-vjpf (`withdrawn_at` 2026-11-18T15:38:56Z), rather than assuming a fix. The operator un-held leg 1 mid-flight. Because the leg had been designed independently of the advisory, it flew unchanged except for one dropped criterion. The maintenance report was annotated at its header, not rewritten.
- **The design review improved the gate itself.** It moved the audit before `npm ci`, and it pinned the gate's effect (the `upload` condition) rather than only the step's presence.
- **The Electron bump's gates were all run, including the behavior spec** CLAUDE.md requires after a bump. That spec also proved isolation genuinely turns off after a real off-and-restart, then back on, which is the evidence that the blocking comes from the feature.
- **Verification was stated honestly.** The dispatch run proves the dispatch path only, and the flight log, RELEASING.md and this debrief all say so.

## What Could Be Improved

### Process

- **The hold was ruled on a stale fact.** The advisory was withdrawn at 15:38 UTC on the inspection day. The inspection's "no patched release" check queried `first_patched_version` but not `withdrawn_at`, and nobody re-checked before the operator ruled "wait for upstream". The fact surfaced only by accident. The cost was small: one leg held across a flight boundary, and an operator decision made on wrong information. Any ruling that rests on external state (an advisory, an upstream release) should record the query and its date, and be re-checked at flight start.
- **A prerequisite with no owner or fallback.** The flight's prerequisite "`fly -t local-goldfinch` authorized" was never met, and its checkpoint (record the Concourse `ci` history since 2026-10-19) was never done. It was superseded in practice, and is recorded as such in the flight spec. Design should mark operator-action prerequisites as optional evidence, not gating, unless they truly gate.
- **The flight spec named an outcome that depended on external state.** Its Verification said a dispatch run "fails at the audit step while GHSA-fc5q-39xc-vjpf is unpatched". After the withdrawal that was simply untrue. Acceptance criteria should not predict outcomes that hinge on third-party state. A debrief note now corrects it in the spec.
- **The flight spec's version target was stale.** The flight named Electron 45.3.4. The leg resolved the current 45 release at design time (45.4.1), within the mission criterion's "or later". Resolve version targets at leg design, not flight design.

### Technical

- **Remaining release-integrity gaps:**
  - The release build still runs no `npm test`, typecheck or lint (only audit and fuses). A tag on a commit that never passed Concourse could still ship a failing build. The flight listed adding `npm test` to the gate as an acceptable variation; it is the next-largest gap.
  - The audit is time-varying and fails closed (documented): a later advisory, or a registry outage, can fail a tag with no code change.
  - The tag path is unverified until the next release.
- **Test hardening, all minor:**
  - The fuse-check pin finds its step with `indexOf('Check Electron fuses')`, which a comment mentioning the name could satisfy.
  - The `upload` pin forbids `!=` but does not forbid an added `always()` that would override `needs`.
  - `fail-fast: false` itself is unpinned.
- **The Dependabot note's command is incomplete for annotated tags.** `gh api …/git/ref/tags/<tag>` returns a tag OBJECT for an annotated tag, which needs a second `git/tags/<sha>` call to reach the commit. The note says "the commit it points at" without spelling that out.
- **The CLAUDE.md *Release / CI* bullet is now very long.** It is a candidate for the CLAUDE.md slimming noted at maintenance (finding #35).

### Test metrics

- **Suite:** 7,382 tests, 7,378 pass, 0 fail, 0 skipped, 4 todo (the known capture cases). Wall clock **8.9 s** (`duration_ms` 8,660) at load average 0.2, which is a quiet host. No flakes in one run.
- **Flight 3 debrief:** 7,378 tests, 10.5 s at load 2.7–5.5.
- **Flight 2 debrief:** 22.6–25.8 s at load 10–17 (shown there to be host load).
- **This flight added 4 tests.** `release-workflow-invariants.test.js` now has 32 tests (1.43 s standalone; it spawns bash).
- **`ipc-gate-invariant.test.js`** is 4.30 s standalone, still about half the run (squawk 0219).

### Documentation

- **Updated:** RELEASING.md (the jobs table and *The audit gate* section), CLAUDE.md *Release / CI*, the `third-party-cookie-isolation` spec's Last Run line, and the maintenance report's header annotation.
- **Corrected at this debrief:** the flight spec's stale Pre-Flight hold, the 45.3.4 target and the Verification text, by appended notes rather than rewrites.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Leg 1 un-held mid-flight; its "bump `picomatch`" criterion dropped | GitHub withdrew the advisory; the audit was clean with no bump (operator ruling 2026-11-19) | Yes: re-check external-state premises at flight start |
| Audit placed before `npm ci`, not after | Design review: no install script runs ahead of the gate | Yes: a CI gate runs before anything it guards against |
| Electron 45.4.1, not 45.3.4 | It is the current 45 release; the criterion said "or later" | Yes: resolve versions at leg design |
| A new pin on `upload`'s `needs.build.result == 'success'` | Pins the gate's effect, not just its presence | Yes |
| Concourse-history checkpoint not done | `fly` was never authorized; superseded by the withdrawal and the release build's own gate | No: mark such prerequisites optional at design |

## Key Learnings

- **Pin a gate's effect, not only its existence.** A step that runs but whose failure nothing downstream respects is not a gate. Here the effect lives in `upload`'s `if:` condition, not in the audit step.
- **Advisories can be withdrawn.** A "no patched version" premise must also check `withdrawn_at`, and be re-checked at the moment it drives a decision.
- **Place a gate before what it guards against.** `npm audit` needs only the lockfile, so it belongs before `npm ci`, where no install script has run.

## Methodology Observations

1. **`routine-maintenance` Phase 4/5 → operator ruling → `agentic-workflow` Phase 1.**
   - **What happened:** a finding rested on external state (an advisory's patch status). The inspection recorded it, the operator ruled on it, and the next flight held a leg because of it. None of these steps re-validated the external fact. The advisory had been withdrawn hours before the inspection's own check, which looked only at the patched version.
   - **What was expected:** a prompt, at flight start, to re-check findings that depend on external state.
   - **What it cost:** one leg held, and an operator ruling made on a stale premise. The flight recovered at no rework, because the fact surfaced by chance.
   - Plugin 1.2.4. Recurrence in Mission 24: 1.
2. **`agentic-workflow` Phase 2b (verification legs depending on CI).**
   - **What happened:** the leg's live verification (a `workflow_dispatch`) is an outward-facing action with real runner cost. The skill gives it no slot, so the Flight Director improvised: commit, open the PR, ask the operator, dispatch, then land.
   - **What it cost:** nothing beyond a slightly irregular sequence; the leg stayed `landed` across a commit.
   - Plugin 1.2.4. Recurrence: 1.

## Recommendations

1. **Watch the next real release as the audit gate's tag-path confirmation,** and record the result in that release's notes or the release-prep PR.
2. **Close the next release-integrity gap:** have the release build also run `npm test` (and typecheck / lint), or add a check that the tagged SHA passed Concourse. This needs an operator ruling; it was an acceptable variation, not done here.
3. **Harden the release invariant pins and the Dependabot note:** squawks 0225 and 0226.
4. **Before ruling on any finding that depends on external state, re-query it** (`withdrawn_at` included) and record the query and its date in the ruling.

## Action Items

- [ ] Next release: confirm the audit step on the tag path.
- [ ] Operator: rule on adding `npm test`, typecheck and lint to the release build (Recommendation 2).
- [ ] Operator: authorize `fly` for future reviews.
- [ ] Squawk 0225: the Dependabot note's annotated-tag dereference.
- [ ] Squawk 0226: the release-invariant pin hardening (the fuse-check step lookup, and an `upload` `always()` guard).
