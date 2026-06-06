# Flight Debrief: Accessibility — Keyboard & Screen-Reader Baseline

**Date**: 2026-06-06
**Flight**: [Accessibility — Keyboard & Screen-Reader Baseline](flight.md)
**Status**: landed
**Duration**: 2026-06-06 (single session)
**Legs Completed**: 5 of 5

## Outcome Assessment

### Objectives Achieved
Made the Goldfinch browser chrome operable by keyboard and screen-reader users, verified in the real environment (PR #18; commits `13f0cf2` planning, `286f019` legs 1-4, `2b9195a` verify+land):
- **F22** — the tab strip is a WAI-ARIA `tablist`/`tab` widget with roving tabindex, automatic activation, Arrow/Home/End navigation, Delete/Backspace close, a focusable title-tracking close `<button>`, and a visible focus ring; the key handler is scoped to the strip (no global hijack). Pinned by the `tab-keyboard-operability` behavior test (**7/7 PASS**, spec promoted `draft → active`).
- **F23** — every icon-only control has an explicit `aria-label`; the reload control's name tracks Stop/Reload; Shields switches are named; a global `:focus-visible` indicator (incl. the id-specific `#address:focus-visible`) exists. A reusable `npm run a11y` axe-core harness + an `a11y-media` fixture were stood up.
- **F24a** — live regions (toasts + an sr-only media-status region), lightbox `role="dialog"` + focus trap + focus restore, container-menu/panel Escape + focus management, labeled complementary landmarks, and `<h2>` panel headings.
- **F24b** — `prefers-reduced-motion` support, AA contrast fixes (`.ps-main.bad`, switch off-track + border), color-independent state cues (`aria-pressed`/`aria-expanded`/active-tab accent bar/`(N)` count), and named media-pick checkboxes.

### Mission Criteria Advanced
**F22, F23, F24** all checked off. Mission `01-maintenance` is now **21/21 criteria** — every Action-Required finding plus the advisory backlog resolved across Flights 1-5. This was the mission's final flight; `/mission-debrief` is the natural next step.

All Pre-Flight, Checkpoint, and Post-Flight items met except "Code merged" (PR #18 open, ready). No adaptation/divert criteria triggered.

## What Went Well

- **The verify-a11y leg earned its keep — decisively.** The live `npm run a11y` sweep caught a **critical `image-alt` (WCAG 1.1.1)** defect — media-card thumbnail `<img>` and the lightbox `<img>` were created without `alt` — that **no implementation leg, no per-leg design review, and neither flight-level reviewer caught**. The verify commit (`2b9195a`) adds exactly two lines of `src/` (`img.alt = item.label || item.name` at `renderer.js:571` and `:595`). The bug was structurally invisible to the offline gate (typecheck/lint can't see a missing `alt`) and to any axe sweep run against collapsed DOM (both images only exist with the media panel open / lightbox open on a raster image — the exact DD3 coverage hazard). Strongest possible evidence for the `verify-*` house pattern on a11y work.
- **Per-leg design review caught what implementation would have shipped wrong.** Both the contrast *math* (the maintenance report implied `--fg-dim` failed AA; review recomputed it at 4.53:1 — a passing-but-thin value — and instead identified the *real* failure `.ps-main.bad` at 4.47:1) and the coverage *gap* (axe false-passing collapsed-DOM controls) were caught at design-review time, not mid-sweep. The `#address` `:focus-visible` specificity trap (id 1,0,0 beats bare `:focus-visible` 0,1,0) was foreseen and fixed with an id-specific rule + comment.
- **High-fidelity spec → mechanical implementation.** Every DD (DD1-DD5) is traceable line-for-line into the diff; the few revisions (the DD3 WCAG-tag-gate refinement, leg-3's live-region redesign, leg-4's `--fg-dim` reframe) all landed at design-review time, not during coding. Offline gates stayed green across every leg (147 tests / 0 typecheck / 0 lint / Prettier-clean), with zero type suppressions and zero lint downgrades.
- **The DD3 WCAG-tag gate scoping proved exactly right.** Under axe's full default set the verify sweep reported **only `region`** (best-practice) — precisely the app-shell exception the design predicted (a browser chrome legitimately has no `<main>`/`<h1>` and content outside landmarks). Had the gate been the full default, verify would have surprise-failed on rules no leg owns.
- **Apparatus discipline held live.** The behavior test attached to the running `:9222` **renderer** target (not a `<webview>` guest), delivered **trusted** `Input.dispatchKeyEvent` (not synthetic events), and avoided chrome-devtools MCP — the three traps the DD2 premise-audit named. Step 8's negative no-hijack assertion passed, validating the strip-scoped (not `document`-scoped) handler.
- **Three genuinely reusable patterns emerged**: the roving-tabindex tablist, the attach-don't-launch CDP axe harness, and the "guarded" focus-restore (restore focus on close only if `panel.contains(document.activeElement)` — don't strand, don't steal).

## What Could Be Improved

### Process
- **The per-checkpoint rule-subset scheme had no completeness check — and that's how `image-alt` survived to verify.** DD3 scoped each checkpoint's axe run to a subset (F23: `button-name`/`label`/aria-*; F24a: ARIA-validity/dialog-name) to avoid per-checkpoint *false* failures on not-yet-fixed rules. But `image-alt` was owned by **no** subset, so by construction it could not surface until the verify leg's full-tag sweep. The union of per-checkpoint subsets did not equal the verify tag set, and nothing flagged the gap. **Generalizable fix**: when scoped gates are used, audit that *every rule in the final sweep is owned by some checkpoint subset, or is explicitly labelled "verify-only."*
- **DD3's "run `npm run a11y` at each GUI-available checkpoint" mitigation was inert.** All four implementation legs ran autonomously/headless, so there were **zero** GUI-available checkpoints before verify — 100% of the live-axe risk front-loaded onto the verify leg by the execution model, exactly the concentration DD3 said it wanted to avoid. The design correctly *identified* the hazard but the autonomous model structurally prevented the proposed mitigation from operating. Future autonomous a11y flights should either (a) accept the concentration and budget verify as the primary correctness gate (expect ≥1 real defect), or (b) insert an explicit mid-flight GUI-checkpoint leg between the JS-heavy and CSS legs.

### Technical
- **Test metrics (this run):** `npm test` **147 pass / 0 fail / 0 skipped / 0 flakes**, ~76.3 ms internal (~0.22 s wall). Per-suite (count / ms): `url-safety` 49 / 51.9, `jars` **38** / 52.7, `download-path` 29 / 45.6, `shields` 16 / 41.0, `trackers` 15 / 40.3. Fast gate: `typecheck` ~1.02 s (0 errors) + `lint` ~0.67 s (0) ≈ ~1.7 s (~2.2 s with audit). **Deltas vs priors**: count **unchanged at 147** (Flights 2-4 also 147) — this flight added **zero unit tests**, exactly as expected for CSS/DOM/ARIA work the renderer harness can't reach; timing within machine-noise of Flight 3/4. **Bookkeeping correction**: the `jars` suite is **38**, not the **37** the Flight 2 debrief recorded (its per-suite figures summed to 146 against a stated 147 — an off-by-one); the true total has been 147 since Flight 2. No tests lost or gained.
- **The flat 147 is the honest signal, not a coverage gap.** A11y/CSS/rendering behavior is not unit-testable in this vanilla-DOM renderer; coverage legitimately lives in the behavior test (F22) + the axe harness (F23/F24). Together they are a permanent regression net — strictly better than the one-shot checks prior debriefs warned against.
- **`scripts/a11y-audit.mjs` couples to renderer internals (latent debt).** It drives the UI by calling renderer module-scope globals over CDP (`navigate(...)`, `togglePanel(true)`, `togglePrivacy(true)`, `openLightbox(...)`) — global only because the renderer is `sourceType:"script"`. A rename or an ESM migration would break the harness silently-in-spirit (it throws at `Runtime.evaluate`, but nothing offline exercises it, so breakage surfaces only at the next manual verify). It also uses fixed `sleep()` delays (2500 ms / 400 ms) rather than readiness polling — a flake vector on a loaded machine.
- **Lightbox focus-trap query is unfiltered** (`renderer.js:744` `querySelectorAll('button')`) — fine today (all lightbox buttons are always visible) but will mis-trap if a conditionally-hidden control is added; filter to visible/enabled before that happens.
- **One observable has no automated witness**: the `#media-status` live-region *announcement* is wired but neither axe (can't see 4.1.3 announcement) nor the behavior-test step table asserts it fires on update.

### Documentation
- **README keyboard-shortcuts table is stale.** `README.md:92-101` lists `Ctrl+T/W/L/M/Shift+P/R` but not the new tab-strip model this flight shipped (Arrow/Home/End to switch/jump, Delete/Backspace to close). A keyboard/SR user reading the docs can't discover the very operability the flight added. CLAUDE.md was updated for `npm run a11y`, but the user-facing shortcut table and an "Accessibility" note were not.
- **The three reusable patterns aren't documented.** Prior debriefs already flagged that architectural patterns weren't being captured; the roving-tabindex tablist, the CDP axe harness, and the guarded focus-restore are the strongest candidates yet for a CLAUDE.md patterns note.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Verify sweep caught + fixed an `image-alt` bug no leg owned | Missing `alt` on runtime-built `<img>` is invisible to offline gates + collapsed-DOM axe | n/a — outcome of the verify leg; **standardize the verify-leg-as-primary-a11y-gate** |
| DD3 axe gate = WCAG A/AA tags, best-practice advisory (refined mid-flight in leg-3 review) | App shell legitimately violates `region`/`landmark-one-main`/`page-has-heading-one` | **Yes — for app-shell a11y, gate on WCAG tags, not axe's full default** |
| Fixture moved `:8080 → :8090` + spec Step 2 tightened | `:8080` was a pre-existing Concourse instance that collapsed per-tab URLs | **Yes — probe fixture port availability; don't assume the example port is free** |
| `--fg-dim` left unchanged (maintenance report implied a failure) | Design review recomputed it at 4.53:1 (passing) | **Yes — recompute maintenance-report contrast values at planning; treat them as leads, not facts** |
| Consolidated single-pass Witnessed behavior run (not per-checkpoint) | `SendMessage` unavailable | Already standardized (Flight 2/3 fallback) |

## Key Learnings

1. **For accessibility work, the verify leg is the primary correctness gate, not a rubber stamp — budget it to find a real defect.** Whole rule classes (`image-alt`, live-region announcement, focus trap/restore, reduced-motion, non-text contrast, color-independence) are invisible to typecheck/lint/unit, and several are invisible to axe-against-collapsed-DOM. The offline gate is a necessary floor, not an a11y net.
2. **Scoped per-checkpoint gates must be completeness-checked against the final gate.** Subsetting rules to avoid premature false-failures is correct, but the *union* of subsets must equal the verify set (or unowned rules must be explicitly verify-only) — otherwise a real rule silently defers to the last step.
3. **An autonomous (headless) execution model concentrates every GUI-bound gate onto the verify leg.** "Run the live check at each checkpoint" is vacuous when no checkpoint has a GUI. Plan for the concentration explicitly.
4. **Design review pays for itself on threshold-driven and coverage-driven work.** Recomputing contrast ratios and enumerating hidden DOM states at planning caught two real errors before a single line was implemented.
5. **Test-harness → app-internal coupling is the same boundary risk the methodology warns about, transplanted into tooling.** A GUI harness reaching into renderer private function names is pragmatic now but wants an intentional, stable "test driver" seam as more GUI gates accrete.

## Recommendations

1. **Author a small doc follow-up**: add the tab-nav keys (Arrow/Home/End/Delete) to README's keyboard-shortcuts section and a short "Accessibility" note pointing at `npm run a11y` + the behavior test. (User-facing accuracy gap.)
2. **Document the three reusable patterns** in CLAUDE.md (roving-tabindex tablist, CDP axe harness, guarded focus-restore), alongside the existing `src/shared/` dual-export + two-enforcement-point notes.
3. **Add a completeness-check convention** to a11y/visual flight templates: "rules in the final sweep but in no checkpoint subset = front-loaded onto verify — list them."
4. **Harden `scripts/a11y-audit.mjs`**: replace fixed `sleep()` with readiness polling, and consider a thin named "test driver" seam in the renderer instead of calling private globals.
5. **Extend the `tab-keyboard-operability` (or a sibling) behavior test** to assert the `#media-status` live-region announcement — the one F24a observable with no automated witness.

## Action Items
- [ ] Doc follow-up: README tab-nav keys + Accessibility note (fold into the next docs touch or `/mission-debrief` actions).
- [ ] Add the three reusable patterns to CLAUDE.md.
- [ ] Harden the axe harness (readiness polling; consider a renderer test-driver seam) — opportunistic, when a future flight touches `scripts/`.
- [x] ~~(Carry-forward from Flight 4, deadline-bearing) Accept the Dependabot `github-actions` Node-24 major-bump PRs **before 2026-06-16**; smoke-test a release on the new action majors.~~ **Already done** (verified 2026-06-06, before this debrief shipped): merged as PR #17 (`45a4644 build(deps): bump github-actions to Node-24 majors`) — both workflows now on `checkout@v6`/`setup-node@v6`/`upload-artifact@v7`/`download-artifact@v8`/`action-gh-release@v3`, no v4-era pins remain. **Smoke-tested live** by the v0.4.1 release (build run `27062318615` success, `update-readme` fired) — the feared upload/download-artifact breaking change did not materialize. The item was stale within a day (recon-drift); no further action.
- [ ] Filter the lightbox focus-trap button query to visible/enabled controls before any conditionally-hidden control is added.

## Skill Effectiveness Notes

- **Flight skill** — the **reconnaissance phase** again paid off (re-located all maintenance-report citations drifted by Flights 1-3) and the **Phase-4 apparatus premise-audit on both axes** held perfectly in the live run (renderer target, trusted keys, attach-don't-launch). The one premise that slipped through was **environmental, not apparatus**: fixture *port availability* (`:8080` Concourse collision) — the premise-audit should extend to "the example port is actually free." The **F24 split** (semantics/visual) and the **added verify leg** (house `verify-*` pattern) were both right-sized.
- **Leg skill** — **per-leg design review** was the highest-leverage step for this flight: it caught contrast-math and coverage errors before implementation. The leg **citation audits** correctly tracked line drift across legs (each leg re-located citations after the prior leg's edits). The gap the leg skill *didn't* surface: the per-checkpoint-subset union vs verify-set completeness — worth a prompt addition for gated/subsetted verification.
- **Agentic-workflow** — the **deferred single review+commit** across autonomous legs plus a **separate operator-gated verify leg** fit an a11y flight well; spawning a second **Accessibility Reviewer** at flight-review (despite the crew default `Enabled:false`) was a sound FD call for wholly-a11y work. The lesson surfaced: autonomous legs = no GUI checkpoints = all live-gate risk on verify (see Key Learning 3).
- **Behavior-test skill** — the **consolidated single-pass Witnessed** fallback (no `SendMessage`) preserved act/judge separation and produced a clean 7/7. The Validator's spec-quality note (fixture collapsed the distinct-URL discriminator) was exactly the kind of cold, independent read the Witnessed pattern is for; it drove a real spec tightening (Step 2). **AUTHORING.md candidate**: note that a served fixture can silently collapse a precondition (shared title/normalized URL) — pick targets whose load-bearing observable stays distinct.
