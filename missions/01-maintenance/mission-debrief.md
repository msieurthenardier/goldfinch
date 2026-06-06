# Mission Debrief: Codebase Health — 2026-06-05 Maintenance

**Date**: 2026-06-06
**Mission**: [Codebase Health — 2026-06-05 Maintenance](mission.md)
**Status**: completed
**Duration**: 2026-06-05 → 2026-06-06 (Flights 1–4 on day one; Flight 5 + release on day two)
**Flights Completed**: 5 of 5

## Outcome Assessment

### Success Criteria Results

All 21 criteria met (F16 met-by-decision as an accepted tradeoff). Grouped by flight:

| Criteria | Flight | Status | Evidence |
|----------|--------|--------|----------|
| F1, F3, F4, F5, F6, F7 | 1 — Hostile-page hardening | ✅ met | `isSafeTabUrl` at two enforcement points (`createTab` + `will-navigate`); download-path containment; poster/`color`/`containers.json` validation; verified by `tab-scheme-guard` (live, real vectors) |
| F8, F9, F10, F11, F12, F13 | 2 — Quality & hygiene floor | ✅ met | `node:test` suite (147), whole-codebase `@ts-check` (0 errors), ESLint flat + Prettier, README/CLAUDE.md refresh, stale branches deleted (by recon) |
| F2, F21 | 3 — Electron upgrade | ✅ met | Electron 33→42 with **zero source changes**, typecheck + `core-browsing-shields` (live, `active`) net; CI dependency-audit gate; Dependabot added (recurrence prevention) |
| F17, F18, F19, F16 | 4 — CI/CD supply-chain | ✅ met | Least-privilege `permissions:`, SHA-pinned actions, semver-gated release; F16 (bot README push) **accepted as a documented tradeoff** |
| F22, F23, F24 | 5 — Accessibility baseline | ✅ met | tablist/roving-tabindex keyboard model (behavior test 7/7, `active`), accessible names + focus indicator, WCAG AA semantics/visual (axe `npm run a11y` 0 violations) |

### Overall Outcome

**The mission delivered its stated outcome in full: "a flight-ready codebase whose stated security priority is backed by a regression net."** The one directly hostile-page-reachable hole (F1) is closed at two enforcement points; Electron is current (33→42) with a recurrence-prevention mechanism; and there is a genuine **three-layer regression net** — 147 unit tests over the privacy/security pure core, two `active` behavior tests (`core-browsing-shields`, `tab-keyboard-operability`), and the `npm run a11y` axe harness — all gated in CI (test → typecheck → lint → audit → package) under SHA-pinned, least-privilege workflows. The work shipped to users in **v0.4.2** (all-platform installers, published stable). The Architect's verdict: architecture **improved, net-additive, no structural regressions** — the three-process boundary the cold baseline praised is now *enforced and documented*, not merely present.

The outcome remained the right goal throughout — every flight mapped one-to-one onto maintenance-report findings, and recon at each flight kept the plan honest as the codebase moved underneath it.

## Flight Summary

| Flight | Status | Key Outcome | Notable challenge |
|--------|--------|-------------|-------------------|
| 1 — Hostile-page hardening | completed | F1 closed + 5 defense-in-depth surfaces; seeded the unit harness; established `src/shared/` dual-export + two-enforcement-point patterns | Two caught gaps (`will-navigate`, partition-dedup) were architectural — design review backfilled what solo design missed |
| 2 — Quality & hygiene floor | completed | Whole-codebase test/lint/type floor + docs; container-`color` injection fixed; F13 retired by recon | Largest flight (7 legs); the auto-fix sweep needed mandatory human diff-review (passing tests insufficient) |
| 3 — Electron upgrade | completed | 9-major bump, zero code changes, verified live; Dependabot for recurrence prevention | "Design-review-runs-live-checks" debuted (ran `npm audit`/bundler/`sendSync` probes during design) — all 3 predictions held |
| 4 — CI/CD supply-chain | completed | Least-privilege + SHA-pinned + semver-gated release, verified on real Actions infra | Recon rescoped 2 of 4 findings (F18 Dependabot half already done; F16 reframed as tradeoff) |
| 5 — Accessibility baseline | completed | Keyboard/SR operability; reusable axe harness + behavior test; **verify leg caught a real `image-alt` bug** no offline gate or reviewer saw | Autonomous legs = no GUI checkpoints → all live-gate risk concentrated on the verify leg (by construction) |

## What Went Well

Patterns that held across the whole mission (and should be reinforced):

- **Recon-before-legs was load-bearing on every findings-sourced flight.** It retired F13 with zero legs (F2), rescoped 2 of 4 findings (F4), and re-located drifted citations (F5). The maintenance report drifted *within a day* — F5's recon found the Node-24 action item already satisfied, and the post-debrief "do the node bump" request confirmed it live. Recon repeatedly prevented redundant or wrong work.
- **Layered design review caught real defects before a line was written, every flight** — the `will-navigate` gap (F1), the `data:` poster breakout (F1), the contrast-math error and axe-collapsed-DOM coverage gap (F5). Flight 3 sharpened this into **"design-review-runs-the-live-checks"** (verify cheap assumptions during review, don't assert confidence), and all predictions held in execution.
- **One runtime-verification mechanism served the whole mission**: the CDP-attach-don't-launch harness over the running app's `:9222`, reused identically in Flights 2/3/5 for behavior tests *and* `scripts/a11y-audit.mjs`. This convergence is the architecture's most valuable cross-cutting decision — it's the net for everything typecheck/unit can't reach (IPC, session/webRequest, ARIA, focus, contrast).
- **The verify leg earned its keep, decisively.** F5's live axe sweep caught a *critical* `image-alt` bug (2 lines) invisible to typecheck/lint and to axe-against-collapsed-DOM — exactly the class of defect the offline gate structurally cannot see. Strongest evidence for the `verify-*` house pattern.
- **Design consistency was high and judged, not cargo-culted** — the `src/shared/` dual-export held F1→F5 as a single source of truth for the security predicate, but F2 correctly *declined* to move `isSafeColor` there (it isn't renderer-predicated). `@ts-check` stayed whole-codebase at 0 errors / 0 suppressions across four flights.
- **Operator experience (interview):** oversight was **smooth — no major friction**; the flight/leg structure + per-flight debriefs gave the operator what they needed to coordinate without confusion.

## What Could Be Improved

- **The most-repeated unactioned recommendation across the entire mission is documentation capture.** Every flight debrief from F1 onward flagged "patterns not captured in CLAUDE.md." Three load-bearing patterns are still undocumented: the **roving-tabindex tablist**, the **CDP axe harness**, and the **guarded focus-restore** (F5). `CLAUDE.md ## Patterns` documents only the two from Flight 1. This is a quick win that kept slipping.
- **Two upgrade tripwires the mission intended are not fully armed.** `farbling-correctness` is still `draft`/never-run — and farbling (the privacy-unique headline feature, riding the deprecated `sendSync` timing) has *no* upgrade gate; Dependabot's manual-gate note names the other two specs but not farbling. `tab-scheme-guard` is still `draft` with its Step-6 Known Issue open in `mission.md`. F1 is verified for the real hostile-page surface (its live vectors passed across F2/F3), but the committed spec was never fully promoted. Both are the upgrade tripwires the mission committed to but didn't finish arming.
- **Debt deferred since Flight 1 was never closed**: the three page-derived `img.src` tracker/SSRF sinks (`renderer.js:532/668/912`, drifted from F1's cited lines) still lack a documented disposition decision (predicate vs accept-and-document). F5 added `img.alt` adjacent to them but left `src` untouched.
- **Autonomous execution concentrates GUI-bound gates onto the verify leg.** F5's DD3 said "run axe at each GUI checkpoint," but all implementation legs ran headless — zero GUI checkpoints existed, so 100% of the live-axe risk front-loaded onto verify by the execution model. The design *identified* the hazard but the model prevented the mitigation from operating. Next GUI-bound flight should budget the verify leg to find ≥1 defect, or insert an explicit mid-flight GUI-checkpoint leg.
- **Tooling/test-hygiene debt** (all quick): `scripts/a11y-audit.mjs` couples to renderer-internal globals + fixed `sleep()` (flake/silent-breakage risk); the lightbox focus-trap query is unfiltered; the `#media-status` live-region announcement has no automated witness; the semver-validation regex still has no permanent unit test; there's no `RELEASING.md`.

Per the operator's call, **all of the above is logged as action items for a `/routine-maintenance` sweep** rather than addressed inline now.

## Lessons Learned

**Technical**
1. **A type-checker is a regression net only for the surfaces it types.** This codebase's IPC / `session.webRequest` / contextBridge layer is `any`-typed and duck-typed (`strict:false`), so typecheck can't police the layer an upgrade most threatens — behavior tests are the only net there. Scope the net's claim honestly (F3). The next mission that adds IPC surface should consider typing the bridge contract.
2. **Whole rule classes are invisible to offline gates.** Missing `alt`, focus management, live-region announcement, reduced-motion, non-text contrast — none are catchable by typecheck/lint/unit, and several are invisible even to axe-against-collapsed-DOM. The live verify gate is the real correctness gate for a11y/UI/upgrade work (F5).
3. **For a major dependency jump, smoke the security/privacy pipeline on the real runtime** — types establish the contract's *shape*, only the behavior test establishes its *behavior* on the new engine (F3).

**Process**
4. **Recon-before-legs is mandatory for findings-sourced flights** — source artifacts drift the moment another flight (or a day) passes; re-verify every cited item against current code before designing legs. Proven 5/5 this mission.
5. **Scoped/subsetted verification gates need a completeness check** — when per-checkpoint gates subset the rules (to avoid premature false-failures), the union of subsets must equal the final gate, or unowned rules must be labelled verify-only. This is exactly how `image-alt` survived to F5's verify leg.
6. **Design-review-runs-the-live-checks** beats design-review-reasons for any assumption whose failure would block execution and is cheap to verify.

**Domain**
7. **Recurrence prevention is the maintenance mission's actual goal** — closing a 9-major Electron gap once is hollow without Dependabot + named manual upgrade gates. The mission built that mechanism (and it already paid off: the Node-24 action cutover landed automatically and was smoke-tested by a release, before its deadline).

## Methodology Feedback

The mission/flight/leg hierarchy + Witnessed behavior tests + the agentic-workflow orchestration **worked well end-to-end**; the operator confirmed the autonomy balance (autonomous implementation legs + operator-gated verify/release/PR/merge) was **about right**. Specific Flight-Control improvements this mission surfaced:

- **Codify recon-before-legs as a named mandatory gate** for any flight sourcing items from a prior artifact (it was applied universally but is methodology-side, not enforced).
- **Add the "design-review-runs-live-checks" and "verify-leg-as-primary-gate" expectations** to the flight/leg templates for upgrade/security/a11y/UI work.
- **Add a completeness-check step** to gated/subsetted verification (Lesson 5) — a `/leg` prompt note: "rules in the final sweep but in no checkpoint subset = front-loaded onto verify; list them."
- **Note the autonomous-execution GUI-gate concentration** in the agentic-workflow guidance: headless legs = no GUI checkpoints, so plan for the verify leg to absorb all live-gate risk.
- **AUTHORING.md candidates** (behavior tests): a served fixture can silently collapse a precondition (shared title / normalized URL — F5's `:8080` Concourse collision); probe fixture *port availability*, don't assume the example port; and the consolidated-single-pass Witnessed fallback is the standing no-`SendMessage` mode.
- **Persistent gap**: "document emergent patterns in CLAUDE.md" was recommended in all five debriefs and actioned in none — the debrief loop surfaces it but nothing forces it. Consider making "capture new patterns" an explicit post-flight checklist item.

## Action Items

> Per operator decision, these are handed to the next `/routine-maintenance` pass rather than actioned now.

- [ ] **Document the three emergent patterns in `CLAUDE.md ## Patterns`** (roving-tabindex tablist, CDP axe harness, guarded focus-restore) — the mission's most-repeated unactioned item.
- [ ] **Arm the upgrade tripwires**: run + promote `farbling-correctness` (`draft → active`) and `tab-scheme-guard` (refine Step 6 → full run → `active`); add farbling to Dependabot's manual-gate note. (Do these before the next Electron major.)
- [ ] **Close the deferred `img.src` decision** (`renderer.js:532/668/912`, `player.src:609`): apply an `isSafeImageUrl`-style predicate or accept-and-document the tracker/SSRF tradeoff.
- [ ] **Quick-win docs**: README keyboard-shortcuts table (add Arrow/Home/End/Delete tab nav + an Accessibility note) and a `RELEASING.md` runbook (semver contract + prerelease behavior + rollback).
- [ ] **Test/tooling hygiene**: unit-cover the semver-validation regex; harden `a11y-audit.mjs` (readiness polling + a renderer test-driver seam); filter the lightbox focus-trap query; add a `#media-status` announcement assertion.
- [ ] **Methodology**: fold the codification items above into the Flight-Control skill prompts (recon gate, completeness-check, pattern-capture checklist).

**Already resolved (not carried forward):** container-`color` injection (F2), `moduleResolution` TS6 debt (F3), the Dependabot Node-24 / Node-20-EOL cutover (PR #17 + Node-22 toolchain bump, shipped in v0.4.2).
