# Flight Debrief: Welcome Branding and Alignment

**Date**: 2026-08-26
**Flight**: [Welcome Branding and Alignment](flight.md)
**Status**: landed
**Duration**: 2026-08-25 – 2026-08-26 (design, two Architect passes, leg 1 and its three-spec gate on 2026-08-25; the HAT session, six inline changes with three scoped reviews, the four-spec gate, review, and landing overnight into 2026-08-26)
**Legs Completed**: 2 of 2

## Outcome Assessment

### Objectives Achieved

The flight delivered its objective and then some. Leg 1 shipped the first pass exactly as specified — the Goldfinch mark, a one-line welcome, the home page and engine choices as cards, the engine chooser as a two-column grid of accessible radio-cards, the burner note as a notice, the Settings Clear buttons as secondary actions — with the surface's DOM contract frozen and pinned by a structural test (DD2). The HAT (leg 2) then did what an alignment leg is for: the operator walked eight states on their own build and drove six changes, two of which were genuine behavior changes taken through scoped design reviews:

1. A bigger mark (96 px).
2. A **white surface** — a light palette scoped to `#welcome-surface` under the otherwise dark chrome, with the brand gold darkened for borders and focus rings on white.
3. A tagline that adapts to which cards are showing.
4. **Selecting an engine keeps the engine card visible** with the selection and a confirmation (`settle`/`render` take a `{ search }` override; the tab's reasons are no longer mutated).
5. **A bare domain typed into either home-page field normalizes to `https://`** (`normalizeHomePageInput`, shared with `toUrl`, which kept its `about:` guard).
6. **Set saves and stays** — the DD7 pivot: the welcome surface never navigates on its own except to run a pending search once an engine is chosen; the cross-window auto-attach is retired.
7. The engine grid collapses by a container query on the surface (the leg-1 viewport breakpoint was unreachable under the window's `minWidth: 900`).

Acceptance: leg 1's three specs (5/5, 7/7, 10/10) and, after the pivot, four re-authored specs re-run on the final build (`welcome-home-first` 5/5, `welcome-first-launch` 7/7, `welcome-home-routing` 10/10, `new-tab-default-routing` 8/8). Unit suite 3763 → 3790, typecheck and lint clean, `renderer.js` at 1649/1650. Landed as three commits on `flight/03-welcome-branding` (`a3d147a`, `87a67cb`, `46b3f5a`); PR #170 ready.

### Mission Criteria Advanced

- **Criterion 6** (a *branded* Goldfinch page offering exactly the missing preference) — **met**: the branded half joins Flight 2's functional half; the mission's last open question (Branding) resolved by the operator at the HAT.
- **Criteria 3, 5, 7, 8** — re-verified on the final build by the four gate re-runs after the DD7 pivot (independence, no unchosen provider, pending search runs, not a trap).
- **Criterion 9** (internal-page protections) — untouched by design; the restyle and the pivot live entirely in the chrome-owned surface.

Both flight checkpoints met. Mission 16 has no flights left.

## What Went Well

- **DD2 — the frozen DOM contract — did exactly what it was for.** Seven behavior runs passed across a full restyle and two behavior pivots with zero id, class, or toggle changes and zero spec rows rewritten for a DOM reason (every rewrite was for a behavior the operator chose). The contract test was hand-neutered on three occasions with different ids and went red each time. The Reviewer's methodology note — commenting out an id assignment leaves the literal in the comment and a grep-shape test still passes; neuter checks must *delete* the line — is a real, general finding.
- **The HAT's fix-vs-feature gate held because it was invoked honestly.** Two of six changes were called features out loud and got scoped design reviews; one multi-surface fix got a lightweight pass. Each review caught a concrete defect before implementation: item 3's `reasons.delete('search')` that would have defeated the very change requested (and a radio-sync race with the stale cache); item 5's `about:` guard that a naive `toUrl` reuse would have dropped (now positively tested); item 6's `new-tab-default-routing` fixture that silently depended on the auto-attach being retired, and the input-clobbering render (fixed with an `activeElement` guard).
- **Flight design review caught the Flight Director's own premise error before a line ran.** The draft `welcome-home-first` spec asserted that Ctrl+T after a home-first Set re-offers the engine block — a category-level claim; the value-level trace (`openNewTab` → `createTab(home, container)` once `currentHomePage()` is non-null) showed a plain tab. Rewritten to the real mechanism (the abandoned choice returns only via the search handoff) and passed 5/5 twice.
- **The DD7 pivot produced a cleaner invariant than the one it replaced.** "The surface never navigates itself; the single exception runs a search the user already asked for" is a save-and-stay model like every other preference surface, and it made the two blocks symmetric (both reason-driven, both `settle`-with-override) — `unsetReasons` and the dead-end fallback were deleted outright, a net reduction in branching. The Reviewer traced only two `attachView` sites left in the controller, both in `settle`'s pending-query branch.
- **Evidence discipline stayed high on the gate runs.** Validators took their own screenshots and DB reads at most rows; coincident `example.*` titles were never accepted alone (strip index/count pairs decided every same-tab claim); restart rows carried PID attestations plus the on-disk session document; the empty bookmarks bar was confirmed by pixel-sampling a 30 px band; a mistyped verdict signal was self-corrected in the same reply.
- **The Executor-loss recovery worked a third time** (replacement Executor briefed with the attested facts performed step 10 of `welcome-home-routing`; the Validator found no continuity concern).
- **Flight-2 recommendations honored**: the two behavior rows were authored (one retired at recon as already covered); the Flight 3 constraints from the F2 debrief were carried into DD6; gates carried wall-clock beside every count; every new absence-asserting test has a positive control; a real premise-audit discipline is now visible in the log (two value-level corrections before runs).
- **Test suite health**: 3790 tests, 0 skips/todos/flakes (an unbroken streak across the lineage); this flight's touched files sit at the per-process floor; no slow suite introduced.

## What Could Be Improved

### Process

- **The value-vs-category lesson recurred twice in one flight — caught both times by review, not by habit.** The F2 debrief's Key Learning 2 ("trace values, not categories") was violated in the FD's own draft spec (caught by the Architect) and again in the item-6 re-authoring of `welcome-first-launch` step 6 ("the engine card still shows Brave selected" — false: that record is opened for `home` only; caught by the FD before the run). The guarantee is currently structural (design review + pre-run vigilance), not behavioral. A mechanical substitute: every re-authored row that names a rendered state cites the controller condition it asserts from (`welcomeReasons(...)` → `{…}`; `render` gate) inline, so the trace is a documentation requirement rather than an audit step that can be skipped.
- **A breakpoint was authored below the window's minimum width.** Leg 1's `@media (max-width: 560px)` was dead CSS under `window-factory.js`'s `minWidth: 900`; the operator discovered it by failing to shrink the window. The eventual fix (a container query on the surface) is strictly better, but one grep at leg design — any new viewport-relative rule against `minWidth`/`minHeight` — would have saved the round trip.
- **The DD7 pivot's corollary was not separately weighed at the time.** Retiring the cross-window auto-attach rode along with item 6 ("the same jarring class"); a background welcome tab in another window now sits reflecting the saved value where it used to resolve itself. No HAT state walked a multi-window case (A–H are all single-window). **Settled at this debrief**: the operator confirms it was intended — a surface should never navigate itself — so the question is closed rather than carried; the process point (weigh a pivot's corollaries explicitly) stands.
- **The F2 debrief's `[CLOSING]`-timing fix was not live before it was needed again.** The third Executor transcript loss happened on the last gate run; squawk 0012 (the crew-file notes) was still an open PR at run time, so the same failure shape recurred with the mitigation unwired. Three occurrences is an apparatus limit to plan around, not a fluke.
- **The HAT leg was under-estimated in the flight's own framing.** Only two of six changes were pure look-and-feel; the majority of this flight's substantive engineering happened inside leg 2 through the DD8 gate. DD8 anticipated this correctly, but the Checkpoints and Adaptation Criteria read as "mostly CSS tweaks". Future alignment legs should be budgeted and communicated as likely to surface behavior gaps.
- **DD2 and DD8 needed each other to be read correctly.** DD2 said controller logic "is not touched"; DD8 supplied the review-gated escape hatch. The reading "contract on hooks, freedom on logic behind a review" is right, but it is not stated in one place — the FD had to add a live-ruling note against the immutable leg-2 artifact.

### Technical

- **Grep-shape structural tests have crossed the line the F2 debrief drew.** This flight added 16 (leg 1: 1; item 3: 4; item 5: 3; state D: 2; item 6: 5; plus the Clear-button test) on top of ~19 already in `test/unit/search-engines.test.js` — a third of that file now reads source text. Every one was neuter-checked and is load-bearing, and the pure-function `normalizeHomePageInput` got ten real behavioral tests — the team knows the difference — but the controller's actual logic (visibility rules, override resolution, confirmation strings) is verified almost entirely by asserting the shape of its source. Fifth consecutive debrief to reach this conclusion.
- **CLAUDE.md's welcome-surface paragraph is now wrong on three counts** (the F2 description of `render`/`settle`: "only while `reasons.has(x) && current<x>() == null`", "the home page attaches if it is now set", "the panel hides and the address bar gets focus" — none of which is true after the HAT). A reader designing from CLAUDE.md would design against retired behavior. Squawk-sized.
- **The cache-staleness workaround is now a pattern.** Threading `{ search }`/`{ home }` overrides through `settle`/`render` is correct and small (exactly two keys), but it is the second flight in a row to hand-fix the same race (`homePageCache`/`searchEngineCache` update on the broadcast, not on the write). A synchronous local cache write at the IPC call site would remove the need for the override at every future consumer.
- **`normalizeHomePageInput` lives in `src/shared/search-engines.js`** — disclosed in its doc comment as reuse of the existing asset route, not a topical fit. Fine until the module gains a third unrelated concern.
- **The white surface is a one-off light island** with its own `--wl-*` token set — confirmed by the operator at this debrief as surface-specific, not a precedent. If a second surface ever wants the same treatment there is no shared pattern to reach for, only this block to copy; revisit then.
- **The multi-flight timing watch item remains unresolved**: in-session readings stayed flat (3.3–3.6 s across the HAT for +27 tests); the debrief's fresh out-of-session reading was 3.97 s. Three flights of "flat within noise" is indistinguishable from "growing slowly on a noisy floor" without the fixed-base-commit A/B the F2 debrief asked for.

### Documentation

- **Crew-file apparatus facts, second batch** (squawk 0012 covered the F2 runs; this flight's seven runs added more): the welcome blocks hide by a `hidden` CSS class — the `.hidden` IDL property is a false signal, assert on className/computed display; the bookmarks bar is app-wide and renders on every web-class or welcome tab (misread once as a stale title strip); burner tabs carry a `.tab-jar` swatch titled "Burner (burner)"; bookmark items are `button.bm-item`; `evaluate` on an internal guest is refused ("internal-session excluded"); re-activate a viewless welcome tab by clicking its strip rect; `enumerateWindows` gains a transient `sheetWcId` (`sheetVisible: false`) after a dismissed sheet or an external-engine navigation; `pressKey` takes `Enter`, not `Return`; the stored `homePage` is as typed (no trailing slash) while navigation normalizes; `scroll` takes `dx`/`dy`; the Settings "Show bookmarks bar" toggle is below the fold at 1080 px.
- **Spec-authoring conventions worth writing down**: rows that fold a follow-on action into the Expected Result cell should be split (`welcome-first-launch` 4 and 6); name the confirmation element (`#welcome-home-status`) rather than "beneath it"; tag `[mixed-frame]` only where a browser observable exists (rows 2/7 of `welcome-first-launch`); pre-seed one bookmark before asserting an empty bar is visible.
- **The flight-log contrast arithmetic for the darkened gold was wrong** (`color-mix(… 65%, black)` yields `#9f8010`, ≈3.8:1 on white, not `~#5c4a09`/3.3:1); corrected at review — recorded here so the audit trail is honest.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| DD1's "dark-only" overturned at HAT state A — a white surface with a scoped light palette | The operator's model: a first-run page should look like Goldfinch-the-brand, not Goldfinch-the-chrome | **Yes** — when a first-run or branded surface is designed, ask "brand or chrome?" explicitly; scope any light island's tokens to the surface |
| Draft `welcome-home-first` rewritten at flight design review (Ctrl+T does not re-offer the engine) | Category-level trace in the FD's own spec | **Yes** — cite the controller condition inline in every re-authored row |
| Engine block stays visible on selection (item 3) via `settle(tab, { search })`; `reasons` no longer mutated | Operator ask; the review found `reasons.delete` would have defeated it and the sync would race the cache | **Yes** — "just-written value overrides the cache" is the house shape until the cache is written synchronously |
| Bare-domain normalization on both surfaces; `toUrl` reuses the helper with its `about:` guard preserved | Operator ask; multi-surface review | **Yes** — shared input normalization lives in one helper; scheme guards stay ahead of it |
| DD7 pivot: Set saves and stays; cross-window auto-attach retired; `unsetReasons` and the dead-end fallback deleted | Operator found the immediate navigation jarring | **Yes** for the invariant ("a surface never navigates itself; only a requested search auto-runs"); the retired auto-attach's replacement, if any, is a mission-debrief question |
| `new-tab-default-routing` fixture re-authored to navigate the boot tab by address | It silently depended on the retired auto-attach (caught at the item-6 review) | **Yes** — fixture premise audits trace the exact mechanism they rely on |
| Container query replaced the leg-1 viewport breakpoint | The breakpoint was unreachable under `minWidth: 900` | **Yes** — check viewport-relative CSS against window minimums at leg design; prefer container queries for surfaces with their own width |
| Two premise corrections to re-authored spec rows before their runs | Value-level traces disagreed with the category-level text | **Yes** — see Process |
| Replacement Executor for `welcome-home-routing` step 10 | Third transcript loss on a long Witnessed run | Already standard; the `[CLOSING]`-immediately mitigation must be in the crew file before the next run |
| Leg-2 artifact's "controller logic never touched" superseded by a live ruling | The HAT's DD8 gate is the sanctioned path for behavior changes; leg artifacts are immutable in flight | **Yes** — state "contract on hooks, logic changes behind a review" in one DD |
| `settings.js` Save now trims | Routing through the shared helper; disclosed as an intended AC | Already standard (disclosed side effects) |

## Key Learnings

1. **A frozen DOM contract is what makes a HAT safe.** Every one of six operator-driven changes — including two behavior pivots — landed without touching a hook, and seven Witnessed runs proved it. Freeze the hooks, review the logic, and the alignment session can move fast.
2. **Ask "brand or chrome?" before defaulting a first-run surface to the app's tokens.** DD1's dark-only default lasted until the operator's first look.
3. **The fix-vs-feature gate is worth its cost only when called honestly** — three scoped reviews each caught a defect that would have shipped; the classification discipline is the whole value.
4. **"Trace values, not categories" is not yet a habit; it is a review catch.** Twice in one flight. Make the trace a documentation requirement on every re-authored row.
5. **A pivot's corollaries need their own weighing.** Retiring the cross-window auto-attach was right by the new invariant but was never examined as its own product change.
6. **Viewport-relative CSS must be checked against the window's minimums** — or written as a container query in the first place.
7. **Recommendations that aren't wired into the apparatus before the next run don't help the next run** (`[CLOSING]` timing; squawk 0012 still open at the third transcript loss).

## Recommendations

1. **[Important] Commission the DOM harness for `welcome-controller.js` and the `settings.js` IIFEs — as a flight, now.** Five consecutive debriefs; this flight added 16 grep-shape tests. The surface is finished; a harness would convert ~35 source-text assertions into behavioral ones before anything else builds on the controller.
2. **[Important] Fix CLAUDE.md's welcome-surface paragraph** to the post-HAT behavior (reason-driven visibility; Set saves and stays; only a pending search auto-navigates; no fallback). Squawk 0013; do it before the next flight reads it.
3. **[Important] Mission debrief questions** (Mission 16 has no flights left): (a) the cache-staleness override pattern — replace with a synchronous local cache write at the IPC call site? (b) the fixed-base-commit timing A/B the F2 debrief asked for. (The cross-window auto-attach retirement is settled — intended by the operator; the white surface is confirmed a one-off, not a precedent, until a second surface asks.)
4. **[Important] Methodology (mission-control side)**: inline value-trace citations on re-authored spec rows; viewport-CSS-vs-window-minimum check at leg design; state "contract on hooks, logic behind a review" in one DD when a HAT follows a restyle; send `[CLOSING]` right after the last report; budget alignment legs as feature-bearing.
5. **[Minor] Crew-file apparatus facts, batch 2** — squawk 0014 (extends what squawk 0012 added).
6. **[Minor] Spec hygiene** — split the folded follow-on rows in `welcome-first-launch`; name `#welcome-home-status` in `welcome-home-first` row 2; retag rows 2/7; pre-seed a bookmark before the empty-bar row. Squawk 0015.

## Action Items

- [ ] Fix CLAUDE.md's welcome-surface paragraph to the post-HAT behavior — [squawk 0013](../../../../squawks/0013-claude-md-welcome-surface-note-stale-after-hat.md)
- [ ] Add this flight's apparatus facts to `.flightops/agent-crews/behavior-tests-execution.md` (batch 2) — [squawk 0014](../../../../squawks/0014-behavior-test-crew-apparatus-facts-batch-2.md)
- [ ] Spec hygiene on `welcome-first-launch` / `welcome-home-first` (split folded rows, name the status element, retag, pre-seed a bookmark) — [squawk 0015](../../../../squawks/0015-welcome-spec-hygiene-after-f3.md)
- [ ] Merge PR #169 (squawk turnaround, carries the `[CLOSING]`-timing and first-batch apparatus notes) before the next Witnessed run
- [ ] Mission debrief: DOM-harness flight; synchronous cache write; timing A/B; the methodology items in Recommendation 4
- [ ] `/mission-debrief` for Mission 16 once PR #170 is merged
