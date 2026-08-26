# Mission Debrief: Search and Startup Choice

**Date**: 2026-08-26
**Mission**: [Search and Startup Choice](mission.md)
**Status**: completed
**Duration**: 2026-08-09 → 2026-08-26 (planning conversation 2026-08-09; Flight 1 designed 2026-08-11 and landed 2026-08-24 after a cut-off session; Flights 2 and 3 designed, flown, and debriefed 2026-08-24 → 2026-08-26)
**Flights Completed**: 3 of 3 (the optional alignment flight was flown)

## Outcome Assessment

### Success Criteria Results

| Criterion | Status | Notes |
|-----------|--------|-------|
| Address-bar searches go to a chosen engine from a curated list; survives restart; every window, no restart | met | F1 (`search-engine-preference`), re-verified F2 |
| Context-menu "Search for …" uses the same engine | met | Structurally shared `toUrl`; operator-verified by hand at the F1 and F2 debriefs (the page-context sheet is outside every automation tier) |
| Home page and search engine are independent, adjacent, each settable and clearable; neither changes the other | met | F1 settable half; F2 clearable half; pinned by four specs |
| Upgrading an existing profile changes nothing observable; the Google default becomes visible and changeable | met | F1 (`search-engine-upgrade` 5/5 once F2 fixed squawk 0005) |
| A fresh profile has neither preference set; no query ever reaches an unchosen provider | met | F2 (`welcome-first-launch`, `welcome-search-handoff`) |
| A branded Goldfinch page offers exactly the missing preference (new tab / search / both) | met | F2 functional; F3 branded; the engine-unset context-menu path operator-verified |
| A search typed before an engine was chosen runs once one is chosen | met | F2/F3 (`welcome-search-handoff`, `welcome-home-first`) |
| The welcome page is not a trap (address bar and bookmarks work; same-tab navigation) | met | F2/F3 (`welcome-home-routing`) |
| Internal-page protections not weakened | met | F2 DD1: the surface is chrome-owned; zero internal-page gates touched across three flights |
| Only curated engines storable; corrupt values repair without blocking startup or silently choosing | met | F1 validator (red-when-neutered), F2 repair-to-unset |

All ten criteria met, nine of them behavior-test-backed on the shipped build.

### Overall Outcome

The mission achieved exactly its stated outcome: Goldfinch no longer sends anyone to Google without asking. Existing installs saw nothing change except that their Google default became a visible, changeable choice; fresh installs start with neither preference set and meet a branded surface the first time each choice matters — and can leave it without choosing anything. The outcome was still the right goal at the end; the only thing that moved was *how* the surface behaves once a choice is made (Flight 3's pivot: it saves and stays rather than navigating), and that moved because the operator saw it and said so, which is what the alignment flight was for.

Value delivered: two user-owned preferences, a repair-safe schema, a first-run surface that is trusted (chrome-owned) without touching the internal-page conflation, and — as a side effect of how it was built — a general "tab without content yet" primitive and a hardened behavior-test apparatus that ran fifteen live two-agent acceptance runs in this mission.

Operator's verdict at this debrief: status was clear throughout, the autonomy level was right ("decide, tell me, keep moving"), nothing surprised them, and they would fly the same three-flight plan again.

## Flight Summary

| Flight | Status | Key Outcome |
|--------|--------|-------------|
| 01 Search Engine as a Preference | completed | `searchEngine` key with an eight-engine curated table; `toUrl` off the hardcoded URL onto a live cache; Settings control; schema v3 force-pins both keys explicit so "no row" means "never ran". Two specs authored and run. Design review found a live pre-existing defect (squawk 0005) and a corrupt-row repair that never persisted. Session cut-off cost time, not state. |
| 02 The Welcome Surface | completed | DD1: a chrome-owned panel in a viewless tab record — the mission's principal architectural obstacle sidestepped, not solved. Search handoff with a capped pending query; defaults flipped to `null`/`null`; caches unified; squawks 0005/0006/0010 closed by observation. Two fixes at the acceptance gate (a missing hint; `show()` never settled). Six runs, all green. |
| 03 Welcome Branding and Alignment | completed | First-pass restyle behind a frozen DOM contract, then a HAT that drove six changes — two behavior pivots (engine block stays; Set saves and stays — reversing F2's DD7) through scoped design reviews. Seven runs, all green; four specs re-authored for the pivot. |

### Flight patterns

- **Every flight's design review earned its keep**, and the catches got sharper as the mission went: F1 (DD4 would have copied a defective cache pattern; a corrupt-row repair never persisted), F2 (the DD10 predicate could never match; DD8 reversed; the boot barrier didn't await the engine — a Google search without a choice under DD5), F3 (the FD's own draft spec traced a category, not a value; `reasons.delete` would have defeated item 3; the `about:` guard; a fixture that silently relied on the retired auto-attach).
- **Every flight found something only at the acceptance gate that unit tests could not see** — F1's context-menu row and first-tab miss; F2's missing hint and un-settled `show()`; F3's dead breakpoint and jarring navigation. Three for three, same as Mission 15. The Witnessed pattern is where the real-environment defects surface; the question the mission leaves is how much of that could move earlier (see Methodology Feedback).
- **Flights got tighter, not looser**: F1 took thirteen days to land across a cut-off; F2 landed in a day with six runs; F3's design + HAT + seven runs fit in a day and a night. The deferred-commit model and the recorded apparatus facts are why.

## What Went Well

- **DD1 of Flight 2 is the mission's best decision.** The mission named "how does the welcome page get a working address bar and bookmarks bar while staying trusted?" as its principal architectural obstacle and sketched three ways through the `isInternalTab` conflation. Flight 2's design review found the feature didn't need to go through it: a chrome-owned surface in a tab record with no web contents has a working address bar for free. Three flights later, zero internal-page gates were touched and criterion 9 was met structurally. Recognizing that a named obstacle can be bypassed rather than solved is the pattern to keep.
- **The frozen DOM contract (F3 DD2) made the alignment session safe.** Six operator-driven changes, including two behavior pivots, landed without touching a hook; seven Witnessed runs proved it. The contract test was neutered three times with different ids and went red each time.
- **Cross-flight traceability held.** F1's debrief listed five inherited items; F2's design claimed every one explicitly (and the Architect verified the fixes are in the code). F2's debrief routed constraints to F3; F3 carried them as DD6. The one honored-late recommendation (`[CLOSING]` timing) is called out below.
- **The squawk log worked as a defect log, not a backlog.** Fifteen squawks over the mission; 0005/0006 closed by observation on the build that fixed them; 0007–0009 turned around before F2's gate so the runs inherited the apparatus notes; three turnarounds, each with an independent Reviewer. Only three remain open, all servicing.
- **Evidence discipline matured run over run**: before/after strip-index probes for same-tab claims; diffed `enumerateTabs` for negative claims; PID attestations plus the on-disk session document for restarts; pixel-sampling for an empty bar; Validators taking their own observations. Every "known issue" landing carried a proof (F1's differential against the pre-flight worktree is the template).
- **The Executor-loss recovery worked all three times** (replacement briefed with the established facts; Validators found no continuity concern).
- **Test-suite health is flat and clean across the mission**: 3667 → 3714 → 3763 → 3790 tests, ~3.0–4.0 s, zero skips, todos, or reproducible flakes in every debrief of the lineage.

## What Could Be Improved

- **The mission's signature error is "trace categories, not values" — and it is caught by review, not by habit.** F1: two spec premises contradicted by the flight's own prior text (squawks 0006/0007). F2: the fixture premise (both reasons on a boot tab) and the paired-control asymmetry. F3: the FD's own draft spec, then a re-authored row, both false at the value level. Every instance was caught before it cost more than a run, but each time by a structural check (design review, the gate, pre-run vigilance). The mechanical substitute — cite the exact controller condition on every re-authored spec row — is the one methodology change this debrief asks for most.
- **A prior debrief's mitigation was not live before it was needed again.** F2's debrief said "send `[CLOSING]` right after the last report"; squawk 0012 (the crew-file notes carrying it) was still an unmerged PR when F3's last gate run lost its third Executor. Recommendations that live in a debrief and not in the apparatus do not protect the next run.
- **The record carried a stale claim forward.** The F1 debrief (2026-08-24) correctly said squawk 0003 (broadcast-invariant substring detection) was open; it was completed that same day in turnaround #166, before Flight 2 started — yet the F2 debrief (2026-08-25) still says it "stays open for a fourth flight", and the F3 Developer interview repeated it. Nobody re-read the squawk log. The mission's own F1 Key Learning ("read the code, not its description") recurred at the process-tracking level. Corrected here; the F2 debrief is annotated.
- **Grep-shape structural tests have crossed from convention into liability.** Five consecutive debriefs, and F3 added sixteen; a third of `test/unit/search-engines.test.js` now asserts source text. Every one is neuter-verified, and pure functions (`normalizeHomePageInput`) got real tests — the team knows the difference — but the welcome controller's decision logic is verified by the shape of its source because no DOM harness exists for chrome controllers or internal-page IIFEs. `test/unit/tab-controller.test.js`'s factory-deps harness is the template; nobody has extended it.
- **The same cache race was hand-fixed in two consecutive flights** (F2: the boot barrier and pre-seed; F3: the `{ search }`/`{ home }` override threaded through `settle`/`render`). Both fixes are correct and small; both are workarounds for the caches updating on the broadcast round-trip rather than at the write. A synchronous local write at the two IPC call sites would retire the pattern before a third consumer copies it.
- **`renderer.js` sits at 1649 of a 1650-line budget** — the next flight that grows it needs a trim or a ruling before writing code.
- **One recommendation has been deferred at every debrief since M15 F2** (the DOM harness). Leaving it open is now the more expensive choice.
- **A HAT reviewing a first pass surfaces features, not polish.** F3's leg 2 was framed as look-and-feel with an escape hatch; in practice four of six changes were behavior or multi-surface. DD8 handled it, but the flight's own checkpoints under-sold the leg. (The operator would keep the plan as flown — the point is budgeting and framing, not restructuring.)
- **A pivot's corollaries want their own weighing.** Retiring the cross-window auto-attach rode along with F3's item 6 and was settled only at the F3 debrief — the operator confirms it was intended, so nothing is owed, but the process point stands.

## Lessons Learned

### Technical

1. **The viewless tab record is a general primitive** — one constructor, one attach function, one shared wcId-arrival continuation, ~10 enumerated guard sites, each with a test. The next placeholder surface (onboarding, error recovery) should reuse it rather than re-derive the guards. It should be named and documented as such, not left as welcome-surface commentary.
2. **`render` / `settle` / `show` is a house shape** for a state-derived surface that must also decide whether to disappear: `render` draws, `settle` is the single decision point (reached from every path that can invalidate it), `show` is the thin activation entry.
3. **Reason-driven blocks beat live-unset-driven blocks** for a surface that must stay put: visibility from *why the tab was opened*, with a just-written value overriding the cache, keeps the surface stable under broadcasts.
4. **A first-run surface is brand, not chrome** — DD1's dark-only default lasted until the operator's first look. Ask "brand or chrome?" before defaulting a branded surface to the app's tokens; scope any light island's tokens to the surface.
5. **Viewport-relative CSS must be checked against the window's minimums**, or written as a container query from the start.
6. **Absence-asserting scans need positive controls; neuter checks must delete the line** (a commented-out id still satisfies a grep-shape test).

### Process

7. **A named architectural obstacle may not need solving** — check whether the feature can bypass it before designing the resolution.
8. **Freeze the hooks, review the logic** — a DOM contract plus a fix-vs-feature gate is what lets an alignment session move fast without regressing behavior. State the pairing in one DD.
9. **The fix-vs-feature gate's value is the honesty of the classification** — three scoped reviews in F3 each caught a defect that would have shipped.
10. **"Trace values, not categories"** must become a documentation requirement on re-authored spec rows, not an audit step.
11. **Known-issue landings need a proof, and the proof is cheap** — a worktree at the pre-flight commit plus the same steps (F1) settles regression-vs-pre-existing in minutes.
12. **Recommendations must be wired into the apparatus (crew file, checklists) before they can protect the next run** — a debrief bullet is not a mitigation.
13. **Re-read the source of record before carrying a claim forward** — the squawk log, not the previous debrief.

### Domain

14. **The user's mental model of a preference surface is save-and-stay.** Flight 2 reasoned "setting a home page is itself a navigation"; the operator found it jarring on first contact. The single sanctioned auto-navigation is completing an action the user already asked for (a pending search).
15. **A preference set from a burner tab persists app-wide** — the surface says so in one notice, and the operator judged that sufficient. Recorded as a deliberate mitigation, not an oversight.

## Methodology Feedback

For mission-control (the methodology repo), from three flights of evidence:

1. **Spec re-authoring rule** (`AUTHORING.md`, `/flight`, `/agentic-workflow` leg design): every re-authored row that asserts a rendered state cites the controller condition it derives from, inline. This turns the mission's signature error into a documentation lint.
2. **HAT-after-restyle pattern** (`/flight`, `/agentic-workflow`): when a HAT leg follows a restyle, state "contract on hooks, logic changes behind a review" in one DD; budget the HAT as feature-bearing (expect scoped reviews), not as CSS polish; walk at least one multi-window state.
3. **Leg-design risk check** (`/agentic-workflow` 2a): add "any viewport-relative CSS is checked against the window's `minWidth`/`minHeight`; prefer container queries for surfaces with their own width".
4. **Pivot corollaries** (`/agentic-workflow` mid-execution scope changes): when a pivot retires a documented behavior as a corollary, weigh the corollary as its own decision and put it to the operator explicitly.
5. **Behavior-test crew protocol** (`/behavior-test`): send `[CLOSING]` to the Executor immediately after its last report; carry a PID attestation on every restart-adjacent row; the replacement-Executor recovery is the documented path; note that `[mixed-frame]` belongs only on rows with a browser observable, and that follow-on actions get their own rows.
6. **Debrief discipline** (`/flight-debrief`, `/mission-debrief`): a claim about a squawk's status is re-read from the squawk log at debrief time, never carried from the prior debrief; a debrief recommendation that names an apparatus change gets a squawk id in the same debrief (F2 did this for 0008; the `[CLOSING]` timing did not get one until F3's 0012/0014).
7. **Grep-AC guidance** (methodology-wide): positive controls on absence scans; neuter checks delete the line; scope scans to the new region.
8. **What worked and should be kept as written**: risk-tiered leg design reviews (every high-tier review paid); the deferred-commit model (survived a cut-off session and enabled one Reviewer per flight); the squawk log with independent sign-off; the Witnessed pattern's evidence rules (rendered state first, evidence-for-pass, frame-aware judgment); the out-of-band relaunch procedure; the differential-against-pre-flight-build proof.

## Action Items

- [ ] **Decide the DOM harness now** — commission a small flight (a follow-on mission or a maintenance flight) extending `tab-controller.test.js`'s factory-deps harness to `welcome-controller.js` and `settings.js`'s two IIFEs; or ratify grep-shape tests in CLAUDE.md and stop re-litigating. Default: commission.
- [ ] **Synchronous local cache write** at `chrome-welcome-set` and `internal-settings-set` so `homePageCache`/`searchEngineCache` never lag their own write; then retire the `{ search }`/`{ home }` override pattern. Squawk-sized or a one-leg flight — decide at the harness flight's planning.
- [ ] Squawk 0013 — rewrite CLAUDE.md's welcome-surface paragraph (stale on three counts); add the DOM-contract + "logic behind a review" rule and name the viewless tab record as a reusable primitive in the same pass
- [ ] Squawk 0014 — crew-file apparatus facts, batch 2
- [ ] Squawk 0015 — welcome spec hygiene
- [ ] `renderer.js` line budget — rule at the next flight's design that touches it
- [ ] Fixed-base-commit timing A/B (M15 F3 `3091 ms / 3558` vs today's `3790`) — one afternoon; closes a three-flight watch item either way
- [x] Correct the squawk-0003 claim in the F2 flight debrief (annotated alongside this debrief)
- [ ] Methodology items 1–7 above → mission-control skill edits
- [ ] Mission 16 → `completed`
