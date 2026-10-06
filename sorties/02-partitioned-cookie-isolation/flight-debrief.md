# Flight Debrief: Partitioned-cookie-aware third-party isolation

**Date**: 2026-10-06
**Flight**: [Partitioned-cookie-aware third-party isolation](flight.md) (sortie 02)
**Status**: landed
**Duration**: 2026-10-01 (root cause traced) → 2026-10-05 (charter, planning) → 2026-10-06 (all legs, HAT, landing)
**Legs Completed**: 3 of 3: 01 native-cookie-isolation, 02 isolation-panel-ux, 03 hat-claude-artifacts (plus HAT-F1)
**Plugin version**: mission-control 1.2.0
**Commits**: `31be656` (legs 01+02), `ac56929` (HAT-F1), `7cd28a2` (landing), `b8269be` (squawks 0120–0132); PR #246

## Outcome Assessment

### Objectives Achieved
Shields' third-party cookie isolation moved from header stripping to Chromium's native `ForceThirdPartyCookieBlockingEnabled`, which is decided before `app.ready` from the persisted config by a read-only, fail-closed peek. The results:
- claude.ai artifacts, including their images, now work with Shields fully on.
- The long-standing `document.cookie` hole in cross-site frames is closed.
- CHIPS partitioned cookies keep working.
- The privacy panel and `goldfinch://settings` show what is actually in force versus configured.
- A guarded two-step **Restart now** applies the change. It is proven in dev and in a packaged AppImage.
- A pre-existing privacy-panel defect, where every network push destroyed keyboard focus, was fixed by a persistent section patched in place.

### Charter Criteria (sortie, so this is the only assessment)
| Criterion | Result | Evidence |
|---|---|---|
| A claude.ai artifact renders with Shields fully on | **Met** | HAT step 1: operator, live, signed-in profile, including an image-heavy artifact. The operator also observed prod failing on the same link. |
| Unpartitioned 3P cookies are withheld on HTTP and `document.cookie` (read and write), fixture-proven | **Met** | Behavior runs `2026-10-06-01-29-15` (11/11) and `2026-10-06-15-24-26` (14/14), with fixture server logs as ground truth. Step 12 shows cookies stored while isolation was off being withheld once it is back on. |
| Isolation accounting is truthful | **Met** | Spec step 8 ("1 isolated" vs none for partitioned-only); HAT step 2 (no count on claude.ai). |
| Unit tests pin the rule; a behavior spec covers the artifact case | **Met** | 76 new tests, neuter-verified pins; `tests/behavior/third-party-cookie-isolation.md` (active). |

## What Went Well
- **Empirical spikes during planning, not as a leg.** The spike eliminated five mechanisms that do nothing. It also found the process-wide and restart-only properties, which forced DD5 and DD11, and the missing partition data, which forced DD6 and DD8. A pre-check on `main` de-risked criterion 1 before any code was written and separated it from PR #244. Had these been a leg, any one finding would have invalidated the flight design mid-flight.
- **Risk-tiered design review earned its cost.** The Leg 02 HIGH-tier review rounds caught four load-bearing defects before implementation:
  - Electron 44's `relaunch` has no `env` option;
  - the single-instance-lock relaunch race;
  - MCP re-attach semantics;
  - a11y audit mutation safety.

  The max-2-rounds rule held with no escalation.
- **Isolated-profile apparatus (`XDG_CONFIG_HOME` scratch) plus PID-scoped teardown.** More than 15 app launches and relaunches never touched the operator's signed-in profile.
- **Batched behavior runs for the regression sweep** (operator-approved) covered six specs, including two first-ever runs, at roughly a third of the per-checkpoint cost. Independence was kept, because the Validator re-observed the live app before teardown.
- **Neuter verification on real sources** for every critical pin: startup order, the `readOnly` typo trap, call order, drift guard, patch-in-place identity.
- **The HAT surfaced a real UX defect** ("Reload to apply" always visible) and routed it correctly through the fix-vs-feature gate: a FEATURE, then a scoped design review, implementation, review and commit, all mid-HAT.

## What Could Be Improved

### Process
- **Root-cause triage.** Squawk 0119 shipped a user-agent fix as the cause before the hypothesis was falsified. A strategy bisection (pause Shields on the site, toggle each strategy, capture the failing subframe's headers) would have found the real cause in minutes. 0119 was relabelled "preventive", but only after the operator's live check disproved it.
- **DD11 (relaunch) was the only DD not spiked.** All three of its review corrections (no `env` option, the lock race, MCP re-attach) were lifecycle facts a ten-minute probe would have found at planning.
- **Apparatus reachability was checked after the spec was authored.** Leg 01 AC10 (storage access) was written as automatable. That is impossible: MCP `click` uses `sendInputEvent`, which is delivered to the top document and never to a cross-site OOPIF. One live run was spent discovering this.
- **Second decision cluster absorbed.** Restart-to-apply UX (in-force display, master hints, Restart now, two-step confirm, the focus fix, and later HAT-F1) entered through planning-time operator rulings, not the charter. It carried its own HIGH-risk lifecycle surface. The gate re-check judged it a consequence, not a cluster. It landed cleanly, but the sortie sat at its upper bound.

### Technical
- **Missing in-flight latch on `restartToApply`.** Two activations before quit completes (panel plus settings page, or two windows) would each pass the business gate and each call `app.relaunch`. Also, if `relaunch`/`quit` throws after `releaseSingleInstanceLock()`, the lock is never re-acquired.
- **Unrecorded trade-off of releasing the lock early.** Between release and exit, an OS-handed URL launch can become a full primary instance while the parent still has `app.db` open. The window is low-probability and short. It is also unproven that the release was *necessary*, since no control run was done without it.
- **Three copies of one truth table:** `decideStartup`, the CJS `effectiveAfterRestartFromConfigured`, and the ESM `effectiveAfterRestart`. They are drift-guarded, but this is the repo's third ESM/CJS twin pair.
- **Relaunch logic lives in `register-settings-ipc.js`.** Process lifecycle belongs with `app-lifecycle.js`. Extract a generic relaunch service before a second restart-to-apply consumer appears.
- **The Electron-bump fail-open guard is human-process only.** An unknown feature name is silently ignored. The spike harness lived in an ephemeral scratchpad, so there is no automated canary.
- **The settings-page controller has no DOM harness.** About 127 new lines are covered only by source pins and live runs.

### Documentation
- CLAUDE.md's standing unobservable-surfaces list lacks:
  - cross-site OOPIF input (no user activation is possible);
  - the downloads popup sheet;
  - Wayland popup and window placement (by eye only).
- There is no "web-compat triage" recipe anywhere.
- CLAUDE.md is accreting: the two new Shields bullets are each about 1,000 characters.
- Leg 02's artifact still contains one stale pre-R2 sentence (Outputs, "On pass they delete … then `app.quit()`"), despite the in-place rewrite.

## Test Metrics
**5828 tests:** 5824 pass, 0 fail, 0 skipped, 4 todo (the pre-existing `save-moment-corpus` known-unsolved cases); **6.54 s** wall-clock. No flakes across two runs.

| Flight | Tests | Wall-clock |
|---|---|---|
| M20 F3 | 4996 | 5.33 s |
| M21 F4 | 5654 | 6.5 s |
| M22 F1 | 5682 | 6.45 s |
| Sortie 01 | 5752 | 6.0 s |
| **Sortie 02** | **5828 (+76)** | **6.54 s (+0.5 s)** |

The +76 breaks down as leg 01 +38, leg 02 +30 and HAT-F1 +8. They come from cheap pure-function and mock-DOM suites, and none of this flight's files appear in the slowest 12 (the slowest are vault-txn 3.0 s, vault-compromise-rotate 2.3 s and vault-context 1.5 s). The +0.5 s sits inside the established 5.2–7.9 s band. Line budgets: `renderer.js` 1545/1546 (untouched), `bookmarks-bar.js` 1076/1100.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|---|---|---|
| Spikes run during planning (two harness spikes, two Architect probe sets, a live pre-check on `main` and on the branch) | DDs rested on undocumented Electron/Chromium behavior | **Yes:** spike any DD resting on undocumented platform behavior, and keep the harness when it doubles as a regression canary |
| Leg 01 AC10 and spec step 9 struck; live Storage Access moved to the HAT | MCP `click` cannot reach cross-site OOPIFs | **Yes:** check apparatus reachability per step at spec-authoring time |
| AC12 regression sweep run in batched mode | Cost (six specs, about 43 checkpoints); operator-approved | **Yes:** for regression re-runs of established specs |
| `app.releaseSingleInstanceLock()` before `app.relaunch` | Design review R2-1 (relaunch lock race) | Yes, with a latch and lock re-acquire on failure (see Action Items) |
| HAT-F1 ("Reload to apply" only when needed) implemented mid-HAT | Operator UX feedback, classified as a FEATURE | It is the standard fix-vs-feature flow, and it worked |
| Squawk 0119 (UA strip) shipped as "preventive" | The initial hypothesis was disproved by a live check | **Yes:** a squawk claiming to fix a user symptom must show before/after on the real failing site |

## Key Learnings
1. **Bisect Shields strategies first when a site breaks in Goldfinch.** Pause on the site, toggle each strategy, then capture the failing subframe's request/response headers. Only then form UA or fingerprint hypotheses.
2. **Process-wide Chromium features need the peek → decide → process-constant chain.** Chromium features only take effect if set before ready, while Shields loads after it. The chain is: a read-only fail-closed peek, then `decideStartup`, then an `isolateEffective` process constant, then an in-force-vs-configured render model, then Restart now. `appendSwitch('enable-features')` *replaces* earlier values, so it is single-sited and composes in the operator's flags.
3. **Any DD that relaunches, quits or exits needs a lifecycle-transition checklist.** For each module-load singleton and per-process resource, state what happens across the transition, backed by a probe. In this project: the single-instance lock, `crashReporter`, the `DEV_MINT` rotation, the MCP port and session, the `app.db` handle, the snapshot flush, and pending external URLs.
4. **A step that passes through an apparatus limit is a false pass, not a pass.** Strike it or move it to the HAT; never accept a non-event.
5. **CHIPS makes cross-site partition copies first-class, and Electron can't tell them apart.** They appear as duplicate unlabeled rows (DD8), and copy that counts "third-party" cookies reads as leakage. Expect user confusion until Electron exposes partition keys.

## Methodology Observations
*(mission-control 1.2.0; recorded, not judged)*
- **Sortie skill, plan verb (gate re-check).** What it did: re-checked "one decision cluster" after the Architect rounds. What was expected: the re-check should also re-run after planning-time **operator rulings** add deliverables that trace to no charter criterion (here Restart now, the master-switch hints and the two-step confirm). Cost: the restart UX became a second HIGH-risk cluster inside the sortie, with two extra review rounds, a 228-line amended leg and a mid-HAT feature. Nothing broke, but the sortie sat at its upper bound without the charter being amended.
- **Flight skill, Phase 4 (premise audit, apparatus "can it act").** What it did: the flight skill asks to audit the apparatus on both axes, and this flight audited observe (the fixture log) and act (`click`) in general terms. What was expected: per-*step* action reachability, especially input into cross-site frames, sheets or native windows. Cost: Leg 01 AC10 and spec step 9 were authored as automatable, discovered impossible live, and struck (one live run, plus a HAT step to recover). A per-step reachability check at authoring time would have pre-marked them `[by-eye]`.
- **Squawk skill, Log/Complete (corrective-action verification).** What it did: completed squawk 0119 on unit tests and a review; the live check was "left to the operator/PR test plan". What was expected: a squawk whose report claims to fix a user-visible symptom should be verified against that symptom before completion. Cost: a wrong-root-cause fix shipped (PR #244), then had to be relabelled "preventive", and a sortie was needed for the real cause. The real cause would have been found during the squawk if a live before/after had been required.
- **Behavior-test skill, Phase 4 (execution modes).** What it did: it defines live and re-spawn-per-checkpoint modes only. What was expected: a sanctioned **batched** mode for regression re-runs. The Executor runs the whole spec with rich evidence; the Validator judges every step afterwards and can still re-observe the live app before teardown. Cost: none, since the operator approved it ad hoc. It worked well (six specs, two first runs), but it is not in the skill, so each use needs fresh approval and fresh prompt engineering.
- **Agentic-workflow skill, Phase 2b HAT (live apparatus for HAT steps).** What it did: the HAT protocol assumes the operator performs steps. What was expected: some HAT steps need Flight Director-side apparatus first (a fixture server, an `--insecure-tls-fixtures` relaunch, an `npm run dist` AppImage build, a FUSE workaround). Cost: minor, but the setup and teardown of FD-side apparatus between operator steps is undocumented, and one step (the AppImage) needed an improvised `APPIMAGE_EXTRACT_AND_RUN` path on WSL.

## Recommendations
1. **Adopt a lifecycle-transition checklist and a planning spike for any relaunch/quit/exit DD.** Record it as a project planning rule in CLAUDE.md beside the global-hook rule. It would have pulled all of DD11's corrections into planning.
2. **Add a web-compat triage recipe** to `docs/dev-testing.md`: Shields strategy bisection, then subframe header capture, then other hypotheses. Also require before/after on the real failing site for any squawk claiming to fix a user symptom.
3. **Run per-step apparatus reachability at spec-authoring time,** and add cross-site OOPIF input, the downloads popup sheet and Wayland popups to CLAUDE.md's standing unobservable-surfaces list.
4. **Build an automated Electron-bump canary** for `ForceThirdPartyCookieBlockingEnabled`: preserve the spike harness in-repo as a headless three-site TLS check with server-observed Cookie headers, so a silently dropped feature name fails CI-adjacent tooling rather than relying on the human checklist.
5. **Harden `restartToApply`:** an in-flight latch, plus lock re-acquire if `relaunch`/`quit` throws. Then extract a generic relaunch service into `app-lifecycle.js` before a second consumer appears.

## Action Items
- [ ] **Squawk candidates** (offered to the operator at debrief):
  - restart latch and lock re-acquire;
  - stale Leg 02 artifact sentence;
  - CLAUDE.md unobservable-surfaces additions;
  - web-compat triage recipe doc;
  - the `MODULE_TYPELESS_PACKAGE_JSON` warning for `src/shared/password-generator.js`.
- [ ] Open squawks from this flight: 0120–0132 (logged 2026-10-06).
- [ ] Sortie or flight candidates, needing design:
  - an automated Electron-bump canary (Rec 4);
  - a generic relaunch service (Rec 5, extraction);
  - a settings-page DOM harness;
  - collapsing the ESM/CJS truth-table twins;
  - patching every privacy-panel section in place, since the other sections still lose focus on rebuild;
  - optionally, `goldfinch://jars` panels that update live on page-set cookies (not a squawk: new behavior).
- [ ] PR #244 (squawk 0119, UA strip, preventive): review and merge independently of PR #246.
