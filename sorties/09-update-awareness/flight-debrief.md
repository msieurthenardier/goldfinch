# Flight Debrief: Update awareness — a "Check now" button and an update dot on the kebab

**Date**: 2026-11-18
**Flight**: [Update awareness](flight.md)
**Status**: landed
**Duration**: 2026-11-17 (chartered) – 2026-11-18 (landed)
**Legs Completed**: 3 of 3
**Plugin version**: mission-control 1.2.3 (1.2.4 available, not installed)

Inputs: the flight log in full; a Developer interview (Sonnet, read-only, ran the suite twice); an Architect design review (Sonnet, read-only). The human interview was skipped: the charter answers, every ruling and the walk verdict are recorded verbatim in the log.

## Outcome Assessment

### Charter criteria

| Criterion | Result | Note |
| --- | --- | --- |
| The kebab shows a dot when a newer release exists, none otherwise, without a restart, in every window | **Met** | Behavior spec rows 10–12 in two windows; operator walk on `v0.19.16-rc.1` (Windows) |
| "Check now" asks GitHub once, even with automatic checks off, and schedules nothing | **Met** | Unit-pinned (one request, timer untouched); spec row 10 (one request, none for 60 s) |
| A short result beside it and an always-shown "Last checked" | **Met** | Spec rows 3, 10, 11; result copy revised twice before the walk (below) |
| Nothing about what the app believes or sends changes | **Met** | Request options pinned on both paths; headers observed on the wire |

The walk verdict, verbatim: **"pass"**. Not walked: installed builds on macOS and Linux.

### Value delivered

The update check that v0.19.16 shipped is now visible without opening a menu, and can be run on demand. Along the way the About controller gained the unit seam the Flight 3 debrief asked for, and an accessibility defect carried over from Flight 3 ("Download now"'s spoken name did not contain its visible words) was found and fixed.

## What Went Well

- **The Architect review at planning paid for itself.** It found the two things that would otherwise have shipped broken: a repeat "up to date" would never have refreshed "Last checked" (the emit was routed through a function that returns early when nothing changed), and the dot was planned in a place the existing tests' fake window cannot reach. It also split one leg into two plus a walk.
- **Verbatim extraction first, tests green, then additions.** The About controller was moved unchanged, checkpointed (7,269 passing, lint clean) with nine tests written against it, and only then extended. Every later fix to it was cheap to test.
- **The behavior spec found what review could not.** The Validator's run found the duplicate line and the stale result line before the operator saw either.
- **A live probe caught a bad CSS insert** (a text replace landed inside a neighbouring rule, so no dot rendered); a source-scan pin now guards it.
- **`renderer.js` untouched** (1,504 of 1,505 lines); evaluate seam 41.

## What Could Be Improved

### Process

- **The page's copy was designed per element, not per state.** DD3 listed strings, but never set out what the About block shows for each answer "Check now" can give, nor what a later shared-state change does to a result already on screen. Three of the four spec gaps came from there:
  - the `too-soon` press looked dead;
  - "Version X is available." appeared twice;
  - the result line went stale after a check from elsewhere.

  A single table — answer × state transition → what the page shows — would have caught all three. *(Important.)*
- **Charter-time sizing was optimistic**: one leg at chartering, two plus a walk after review. A new privileged channel, a new page controller and a chrome change are three surfaces.

### Technical

- **The stale-result logic is the weakest code in the sortie**: five coupled variables in the controller's `render()` (`answerAt`, `adoptFrom`, `pressBaseAt`, `lastAnswer`, `prevShowNotice`). It is correct and tested, but hard to explain. If this area grows, it belongs in a pure reducer.
- **`checkNow`'s outcome mapping is written twice** (in `execute` and `checkNow`); a small helper would collapse it.
- **Flight 3's debt list**: the About controller seam is done. Download matching in the registrar and the two version predicates' naming are unchanged by design. The update stack now spans one more module.

### Documentation

`docs/updates.md`, `docs/mcp-automation.md` and CLAUDE.md are current.

## Test metrics

`npm test`: **7,305 tests — 7,301 pass, 0 fail, 0 skipped, 4 todo** (the same four known-unsolved capture cases); run twice, no flake. Runner 9.2 s, wall 9.6 s. Against Flight 3 (7,254 tests, runner 9.7 s): **+51 tests, slightly faster**. The two grown files are cheap: `settings-about-controller.test.js` 19 tests in 0.07 s, `update-check.test.js` 36 tests in 0.09 s. Earlier sorties ran 6–8 s; the 9–10 s band of Flight 3 and this sortie follows the suite's growth on a noisy host and is not judged a regression.

## Deviations and Lessons Learned

| Deviation | Why | Lesson |
| --- | --- | --- |
| `too-soon` gets its own line instead of keeping the last result | leg 01's live smoke: a press within 30 s of the boot check looked dead | Decide what the page shows for every answer at design time |
| "Download now"'s accessible name changed | leg 02's own a11y run: WCAG label-in-name, from Flight 3 | Run the a11y audit on a page whenever a leg changes it, including markup it only moves |
| "Found a newer version — see above." | the result repeated the notice | Ask "is any text shown twice?" at design review |
| Result line bound to the check it describes | it went stale after a check from elsewhere | Page-local state derived from shared state needs a rule tying it to that state's version |
| A void first attempt in the spec run | a shell helper shadowed `tr` in the Executor's own script | An apparatus slip, redone in full; not a product or spec issue |

## Key Learnings

1. **Design page copy as a state table**: answer × transition → visible text. It is where every UI revision in this sortie came from.
2. **Ephemeral page answers must be bound to the shared state's version** (here `lastCheck.at`). A broadcast state plus a page-local memory is a staleness bug waiting to happen.
3. **Never insert CSS by first-match text replace**; anchor the edit, then pin the rule's placement.

## Methodology Observations

Recorded against mission-control **1.2.3**.

1. **sortie — the vehicle fit.** One outcome and one cluster held throughout. Folding in the About-controller extraction (Flight 3 debrief recommendation 3) was bounded, sequenced first, and paid for itself; it was not scope creep. The one sizing miss was at chartering (one leg), corrected by the Architect review before execution.
2. **sortie / flight — design-review prompts miss UI state.** The Architect and Developer review prompts check state machines and caches thoroughly, and caught both high-severity main-side issues. Neither prompt asks what the user sees for each state transition, and three of four post-review findings were exactly that. Cost: two fixes after the behavior spec had passed, one of them the most complex code in the sortie.
3. **agentic-workflow — landing on an external check again.** Leg 02 ended with `[HANDOFF:review-needed]` and stayed `in-flight` until the Flight Director's behavior-spec run, as in Mission 23 Flight 3 (observation 2 there). It is a recurring pattern, not a one-off.
4. **behavior-test — batched mode again.** One Executor pass and a cold Validator, because the spec relaunches the app. It worked (14/14, no inconclusive), as in Flight 3 (observation 6 there).

## Recommendations

1. **Add a state-table item to flight design for user-facing work** *(important)*: answer × transition → visible text, including what clears a result already on screen. Candidate wording for CLAUDE.md's *Project-specific planning rules*.
2. **Bind page-local answers to shared-state versions** *(important)*, as a standing rule for internal pages that render broadcast state.
3. **Extract the result-line logic into a pure reducer** *(minor)* the next time the About block changes, and collapse `checkNow`'s duplicated outcome mapping.
4. **Release-notes work** *(the next update-area sortie)*: keep the "only a validated version reaches the page" rule; any notes text from GitHub must not reach the DOM unvalidated; walk it against the About block's three status lines.

## Action Items

- [x] Squawk 0205 — collapse the duplicated outcome mapping in `checkNow` / `execute` (`src/main/update-check.js`) into one helper.
- [x] Squawk 0206 — run `npm run a11y` against `goldfinch://settings` in CI-adjacent smoke or the release checklist, so a label-in-name regression is caught where the page is changed.
- [ ] Planning rule (Recommendations 1–2) — for the operator to adopt into CLAUDE.md.

Maintenance check: a mission has completed since the last maintenance report (2026-08-27), so no routine-maintenance recommendation is due from this sortie.
