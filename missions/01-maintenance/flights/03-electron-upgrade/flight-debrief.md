# Flight Debrief: Dependency Currency — Electron Major Upgrade

**Date**: 2026-06-05
**Flight**: [Dependency Currency — Electron Major Upgrade](flight.md)
**Status**: landed
**Duration**: 2026-06-05 (single session)
**Legs Completed**: 4 of 4

## Outcome Assessment

### Objectives Achieved
Electron **33.4.11 → 42.3.3** (9 majors) + electron-builder 25→26, with **zero source-code changes** (PR #10):
- **F2**: bump clean — `npm run typecheck` 0 errors on E42 types (the `Electron.WebviewTag` casts + `.d.ts` typedefs all resolve), `npm audit --audit-level=high` **0 highs** (the electron CVEs + the tar-via-electron-builder chain cleared), `electron-builder` packages.
- **F21**: `ci.yml` now gates every PR on `npm test` → `typecheck` → `lint` → `npm audit --audit-level=high` (the F21 audit + the test/typecheck/lint gates pulled forward from Flight 4).
- Carry-forwards: `jsconfig` `moduleResolution → "bundler"` (dropped `ignoreDeprecations`); the `sendToHost` "deprecation" confirmed a false alarm; the real `sendSync` landmine handled (kept — it runs silently on E42).
- **Runtime verified on the live E42 app** (CDP behavior tests): `core-browsing-shields` 5/5 pass → promoted `active`; `tab-scheme-guard` F1 vectors 4/4 pass.

### Mission Criteria Advanced
**F2, F21** checked off; the `moduleResolution` Known Issue resolved. Mission `01-maintenance` is now 14/21 criteria; Flights 1–3 complete, 2 remain (Flight 4 narrowed to F17/F16/F18/F19; Flight 5 accessibility).

All checkpoints met; no adaptation/divert criteria triggered.

## What Went Well

- **The typecheck-as-upgrade-net + behavior-tests verification proved the upgrade safe with zero code changes** — the strongest possible signal (nothing to break because nothing needed changing), and it was *verified*, not assumed.
- **The flight-level Architect design review ran the risky checks LIVE** rather than reasoning: it ran `npm audit` (predicted the gate would go green), tested the `bundler`+`commonjs`+`noEmit` combo (confirmed safe), and correctly identified `sendSync` as the genuine landmine while debunking the `sendToHost` claim. All three predictions held in execution. **This is the single most valuable pattern from the flight.**
- **`moduleResolution → bundler FIRST` converted a 2-variable result into a 1-variable one** — landing it clean before the bump meant a post-bump type error would have been unambiguously attributable to the Electron API change.
- **Behavior tests proved the privacy pipeline survived the Chromium bump on the real app** — Shields blocked `google-analytics.com` (shown in the privacy panel) and stripped tracking params on the new Chromium, not just "didn't crash."
- **Integrity held**: `core-browsing-shields` promoted `active` only on a clean 5/5; `tab-scheme-guard` stayed `draft` (partial re-run) — consistent with the Flight 2 precedent.

## What Could Be Improved

### Technical
- **Test metrics (vs Flight 2's 147/~68ms).** `npm test`: **147 pass / 0 fail / 0 flakes**, ~98 ms internal (~0.26 s wall) — unchanged count, expected (zero code changes). **New CI-gate baseline**: `typecheck` ~1.1 s, `lint` ~0.66 s, `audit` ~0.65 s → total fast-gate cost **~2.7 s wall**. Very cheap; no PR-cycle concern.
- **The typecheck-as-upgrade-regression-net is narrower than the "caught nothing because nothing changed" framing implies (key debrief finding).** It genuinely covers the **`Electron.WebviewTag` method surface** (signature changes there *would* fail typecheck). It does **not** cover: (a) IPC payloads — `GoldfinchBridge` in `renderer-globals.d.ts` is pervasively `any`/`Promise<any>`, so any contextBridge/`ipcMain.handle` shape change is invisible; (b) `session.webRequest` callback `details`/`cb` shapes — JS-duck-typed in `main.js`, a removed property is a runtime `undefined`, not a type error; (c) null-safety — `strict:false` disables `strictNullChecks`. **The session/webRequest/IPC layer — the part an Electron upgrade most threatens — is regression-tested by the behavior tests, not typecheck.** Future flights should scope the net's claim accordingly (don't overclaim).
- **Farbling has zero coverage (no unit, no behavior) and depends on the `sendSync` timing** that was explicitly the upgrade landmine — the most compelling unspecced privacy gap. A Chromium change to canvas/`navigator` exposure would be invisible to every current gate. (Action item: author a `farbling-correctness` behavior spec.)
- **`--audit-level=high` CI gate — future false-positive risk.** Correct today (0 highs). But a future transitive high in a *dev-only* dep (e.g. electron-builder's tree) could red the build non-actionably. Policy: the fix is always to update the dep, never lower the gate — but have a triage protocol ready (and distinguish dev-only-tree highs from `electron`-itself highs). Document before the first false positive.
- **`sendSync` latent risk**: works silently on E42, but it's on Electron's long-term deprecation trajectory (works → warns → removed). The decision + the timing-preserving migration path are recorded, so a future upgrade team is forewarned.

### Process
- **The leg specs were "over-prepared" for risks that didn't materialize (sendSync migration paths, audit policy) — and that was correct.** For a 9-major jump with no prior E42 run, bounded over-preparation (check-first-migrate-only-if-needed ACs) is strictly better than under-preparation. Not a problem to fix; a pattern to keep.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Zero code changes for a 9-major bump | E42's typed API surface matched the existing casts; runtime behaviors unchanged | n/a — outcome, not a deviation |
| `sendToHost` migration NOT done | Confirmed non-deprecated (debrief claim was wrong) | Yes — verify deprecation claims against the actual target version before planning a migration |
| `sendSync` KEPT (not migrated) | Ran silently on E42; async would break farble's document-start timing | Yes — don't migrate a sync-for-timing IPC to async on a deprecation *warning* alone |
| CI gates pulled forward from Flight 4 | Already editing `ci.yml`; cheap to consolidate | Situational — fine when touching the same surface |

## Key Learnings

1. **Design-review-runs-the-live-checks beats design-review-reasons.** For any assumption whose failure would block execution and that's cheap to verify, the Architect should *run it* during design review (the audit + bundler-combo + sendSync checks here). Cost: ~0 extra time; benefit: no surprise leg diverts.
2. **A type-checker is a regression net only for the surfaces it actually types.** This codebase's IPC/session layer is `any`/duck-typed, so typecheck can't police it across upgrades — behavior tests are the real net there. Scope the claim honestly.
3. **For a major dependency jump, "smoke the privacy/security pipeline on the real runtime" is the load-bearing verification** — unit tests + typecheck establish the *type* contract; only the behavior test establishes the *behavioral* contract on the new engine.
4. **Recurrence prevention is the maintenance report's actual goal** — closing a 9-major gap once is hollow without a mechanism to stop it recurring (see Recommendations).

## Recommendations

1. **Set up Dependabot for `electron` (recurrence prevention — highest-leverage follow-up).** A `dependabot.yml` (npm ecosystem, weekly) that surfaces each Electron major as its own PR while the behavior suite is green on the current version — so it never silently drifts 9 majors again. Keep the `^42.3.3` semver range (patches carry CVE fixes; pinning is counterproductive). Fold into **Flight 4** (CI hardening) or a standalone micro-task. Document `core-browsing-shields` as the manual upgrade gate (run before merging any Electron major PR).
2. **Author a `farbling-correctness` behavior spec** (draft, during Flight 4 planning): load the fixture in a webview, CDP-evaluate `navigator.userAgent` (assert it doesn't leak the real Chromium build) and a `canvas.getImageData` pixel (assert it's noised for the seed). Promote `active` and run **before** any future Electron upgrade. Closes the largest unspecced privacy-unique feature.
3. **Flight 4 must audit the full 5-step `ci.yml`** (not the pre-flight 1-step snapshot): SHA-pin **all** `uses:` directives (F18), scope `permissions:` to cover all five steps (F17), and the audit/test/typecheck/lint steps are already green — don't re-add them. Have an audit-gate-false-positive triage policy ready.
4. **Flight 5 (accessibility)**: note the Electron-42 Chromium (~130) a11y-tree output may differ from prior versions as a spec precondition; leg ACs must include `npm run lint` + `npm run typecheck` (CI now enforces them on the PR); budget for `els`-member casts and acknowledge the deferred `img.src` sinks (`renderer.js:197/351/469`).
5. **Refine `tab-scheme-guard`** (standing Known Issue): fix Step 6 (reachable `http(s)` media-open path) and do a full 7-step run (the `javascript:`/`data:` vectors weren't re-driven on E42 either) → promote `active`. Tighten `core-browsing-shields` Step 5 ("load fixture *first*, then open the panel") for causal clarity.

## Action Items
- [ ] Add Dependabot for `electron` (+ document `core-browsing-shields` as the manual upgrade gate). (Flight 4 / micro-task)
- [ ] Author `farbling-correctness` behavior spec (draft → run before next Electron upgrade). (Flight 4 planning)
- [ ] Flight 4: SHA-pin all `ci.yml` `uses:`; scope `permissions:` over all 5 steps; audit-false-positive policy.
- [ ] Flight 5: lint+typecheck in leg ACs; Chromium-130 a11y-tree precondition note; `els`-cast budget.
- [ ] Refine `tab-scheme-guard` Step 6 + full 7-step run → promote `active`; tighten `core-browsing-shields` Step 5 wording.

## Skill Effectiveness Notes
- **Flight**: the recon + flight-level Architect-runs-live-checks were the high-value steps. **Methodology suggestion**: add to the flight skill — "for design assumptions whose failure would block execution, the Architect verifies live during design review rather than asserting confidence." And: when documenting a type-checker as an upgrade regression net, explicitly scope it to the typed surfaces (it does not cover `any`-typed IPC or duck-typed callbacks).
- **Leg**: specs were precise and ACs verifiable (exit codes, version checks, behavior verdicts); the conditional `sendSync` AC (observable + decision-rule + record-outcome) is a good model for risk legs.
- **Behavior-test (AUTHORING.md suggestion)**: capture the fixture port-collision rule (serve on a port ≠ the CDP `:9222`) and the consolidated-single-pass Witnessed fallback as named, reusable constraints.
