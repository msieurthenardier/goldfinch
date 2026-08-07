# Flight Debrief: Drag Interactions

**Date**: 2026-08-06
**Flight**: [Drag Interactions](flight.md)
**Status**: landed
**Duration**: 2026-08-04 → 2026-08-06 (design + 7 legs + 4 operator sessions + HAT)
**Legs Completed**: 7 of 7

## Outcome Assessment

### Objectives Achieved

The mission's last unmet criterion is three-quarters delivered. Bar reorder, drag-onto-page (including the page-wins case), and bar → overflow all work and were operator-verified. Overflow → bar is implemented and works on a second attempt — it has an open, diagnosed defect.

Alongside it, the sheet-automation disposition that had slipped three times is resolved: the overlay sheet's blanket refusal became a two-allowlist gate (admitted menuType **and** one of exactly three read ops), plus an eager DOM scrub without which the gate would have rested on a false premise. A pre-existing admin-tier secret-pixel leak in `captureWindow` was found by this flight's own review and closed.

Scale: 3 commits, ~1,900 new source lines, +202 tests (3356 → 3558).

### Mission Criteria Advanced

**Criterion 6 is deliberately NOT checked off.** Three independent reasons, and this is the debrief's clearest endorsement of a judgement call: the overflow → bar defect is user-visible and operator-reproducible; the criterion is *behavior-test-backed* by the mission's own wording and `bookmarks-drag` has never run; and the flight's standing rule forbids retroactive greening. Checking it on a green unit suite would have been the exact overclaim four operator sessions were spent avoiding.

Criterion 2 (persistence) was **re-verified, not re-earned** — this flight created a reorder path it had never been exercised on, and HAT step 2 confirmed order and icons survive it byte-identically.

## What Went Well

**Measuring transports instead of assuming them was the flight's defining choice, and it paid three times.** Four operator sessions produced: axis-(a) reproduced independently, DD5b's finding that Chromium does *not* auto-navigate (which made `drag-onto-page` a real leg rather than an empty one), and the axis-(b) gate. The mission called drag "the distinct risk cluster, unproven, no precedent"; the flight treated that as a measurement problem rather than a design problem.

**A verdict was withdrawn rather than defended.** Session 2 recorded axis (b) "NOT VIABLE" with a positive control and six refutation hypotheses. The operator's *"why are we talking about tabs?"* exposed that it had been measured with the wrong drag source; a later correction exposed the wrong gesture. The verdict was withdrawn **in place with the correction appended**, not rewritten, and re-measured as VIABLE. That entry is the template for how to be wrong in an artifact.

**`bookmarkReorder` was treated as unproven and verified live first.** DD7's instruction to exercise the chain before building UI on it found a **pre-existing position gap** in the live `personal` jar that the reorder normalised. Design review then extended it to the composed `moveIndex` pair, which also had zero `src/` importers.

**DD6 got stronger under implementation than it was on paper.** The live pass drove a hostile `text/uri-list: https://attacker.invalid/` through the guest and the tab went to the *dragged* bookmark. Then `event.sender` targeting resolved the tab-switch-mid-drag open question **by construction** rather than by a guard.

**Two implementing agents refused to transcribe a false claim and corrected it instead.** Leg 1's AC9 told the implementer to write into a security comment that a particular combination is fail-*open*; the shipped predicate makes it fail-*closed*. Leg 5b likewise found and named a security argument two design-review cycles had missed. The last line of defence held twice.

**Leg 2 proved its own pin test could fail** — mutating all three constants, and catching that a naive string replace hit `.star-btn`'s identical `width: 24px` instead of the chevron. A less careful check would have concluded a working test was broken.

## What Could Be Improved

### Process

**A 5× suite regression shipped behind a green count.** Two tests (`bookmarks-bar.test.js:1218`, `:1237`) arm a foreign drag session and never clear its 15 s latch, holding the event loop open. Suite wall clock was **15,365 ms**; without that file, 3,068 ms. Their AC3 sibling already had the fix.

The defect is trivial. **How it survived is not**: six leg "Gates" entries and a flight-end code review all reported *"3558 pass / 0 fail"* — and none reported a duration. Fixed at debrief (15,365 → 3,091 ms). The honest lineage number is **+5.2% runtime for +6.0% tests**, A/B'd against `5aa4932` on one machine per Flight 2's own rule. There was never a performance regression; there was a leaked timer wearing one.

**Record hygiene degraded monotonically and nobody noticed.** Legs 1–3: 12/12, 7/7, 12/12 acceptance criteria checked. Legs 4, 5a, 5b: **0/12, 0/15, 0/9** — all marked `landed`. The flight log narrates each as complete and is excellent; the leg artifacts simply stopped being maintained. The flight's Post-Flight checklist was entirely unchecked at landing, **including two items requiring mission Known Issues updates that were consequently never made**.

Worse: `mission.md`'s Known Issue 2 still described the guard as refusing the sheet "by identity" — **factually false about the very guard leg 1 replaced**. Corrected at debrief.

**Leg 5a shipped with no AC5.** Its criteria run `AC1, AC2a, AC2, AC3a, AC3, AC4, AC4b, AC6, AC7, AC8, AC6b, AC8b, AC9, AC10, AC11` — a list that accreted through two review cycles without renumbering. Verification Steps reference AC5 three times. Two design reviews and an implementation pass missed the hole.

**"Recorded" was allowed to satisfy "performed."** Leg 7 AC1 — *"each step performed by the operator and its result recorded"* — was satisfied by recording `BLOCKED → skipped` for steps 9 and 10. HAT criteria need a disposition vocabulary (performed / blocked / skipped) so a skip cannot tick a box.

**Deferred verification hopped three times and then evaporated.** DD1e and DD1c travelled leg 1 → operator session 1 (blocked) → HAT steps 9–10 → skipped, with their leg-1 ACs showing `[x]` throughout — because those ACs contained their own live checks in their text while the leg's section header said those checks were *"NOT an acceptance criterion."* They are genuinely unverified.

**Five of six legs were tiered HIGH, and the consequence was then waived three times.** Legs 3 and 4 skipped cycle 2; leg 5b had no design review at all after the split. Each time the flight-end Reviewer was named as the compensating control — as it also was for leg 2, for DD1f's implementation, and for leg 1's IPC-ordering residual. **Five deferrals to one control whose output exists only as prose.** Zero findings on an 8,495-line diff containing a security-guard rewrite is itself a claim that deserves an artifact.

### Technical

**`bookmarks-bar.js` grew 326 → 1,046 lines (3.2×)** — one closure now owning rendering, overflow partition math, three concurrent drag session models, spring-load dwell, three timers, two indicator systems, and both commits. DD12's `renderer.js` budget was honoured perfectly (1587 → 1605/1650) **by relocating ~742 lines into a file with no budget of its own.** The mechanism guards the composition root and is silent about where displaced work lands. Flight 1's debrief said `renderer.js` wanted extraction rather than another ceiling raise; one flight later the same argument applies here, at a larger size.

**Four timing constants now coordinate one gesture across three processes** — `DRAG_END_GRACE_MS` 1500, `DRAG_HOLD_MS` 2000, `FOREIGN_DRAG_MAX_MS` 15000, `SPRING_DWELL_MS` 250, over a pre-existing `BLUR_REOPEN_SUPPRESS_MS` 300. Each is reasoned locally and well. **Nowhere is the set stated as one ordering invariant** — which bounds what, which relations are load-bearing, which are arbitrary. The one defect that shipped is a timing/ordering failure.

**~1,900 lines of new drag machinery are undocumented.** `CLAUDE.md` gained 7 lines this flight, all from legs 1–2. It contains zero occurrences of `x-goldfinch-bookmark`, `bookmark-drag.js`, `guest-bookmark-drop`, `spring`, or any of the four timers. The mechanism is worth naming: **legs 3, 4, 5a and 5b carried no documentation AC**, so 5a and 5b each deferred to "a flight-level Completion Checklist item" — and a checklist item is not falsifiable, so it silently did not happen.

**A fresh mirror-by-comment landed** — `guest-bookmark-drop.js` is CJS `require()`ing an ESM `shared/` module, safe only because esbuild bundles it, asserted in a comment that also notes the existing preload-graph test does not govern it. That is the pattern Flight 2's debrief flagged twice.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|---|---|---|
| Axis-(b) verdict withdrawn and re-measured | Wrong stimulus *and* wrong gesture, both caught by the operator | **Yes** — the correction-in-place format is the template |
| Leg 1 split (gate / carried-debt) and leg 5 split (drop-target / drag-source) | DD1f grew the security surface; leg 5's seam was measured-vs-unmeasured transport | **Yes** — splitting at a measurement gate is a good seam |
| DD1f extended to `openMenu`'s model-replace branch, unprompted | The AC named only `closeMenuOverlay`; model-replace is also a close | **Yes** — implementers extending a guard to a path the AC missed |
| Leg 5a made the sheet close *conditional* on snapshot change | An unconditional close would race the in-flight drop report | **Yes** — better than the AC |
| Leg 5b decided AC2 (payload shape) in-leg, shrinking a capability | The security argument that settled it was missed by two review cycles | **No** — a criterion-shrinking decision belongs at flight level |
| Three verification commitments vanished between planning and leg 7 | a11y-tree inspection, `bookmarks-bar` and `bookmarks-jar-scoping` re-runs | **No** — Verification-table items need an owning leg |

## Key Learnings

**Naming a guard by its intent instead of tracing which predicate executes is this project's most repeated error — four instances in one flight.** Leg 1 cycle 1 (`non-tab-contents` vs `out-of-jar`), leg 1 cycle 2 (a fail-open/fail-closed direction inverted), leg 4 (`will-navigate`, which Electron does not fire for programmatic `loadURL`), leg 5a (a precedent cited instead of a predicate named). All four survived a Citation Audit, because audits verify a cited line *exists*, not that it is *on the path*. Flight 1's debrief already said *"rulings that rest on a mechanism claim should cite the guard condition, not infer it"* — and it recurred four times.

The proposed fix ("cite the call path") catches **one** of the four. What catches the class: **make the claim executable** — for any AC asserting a refusal, require a test that goes red when the named predicate is neutered. That shape already exists in this flight (leg 1's AC4, itself a cycle-1 correction); it was never generalised into a rule.

**A wrong justification with a right conclusion is the hardest kind to catch, because the conclusion validates it.** DD3's premise (a visible→full index translation) was the identity function; the real requirement was the inverse. Had it shipped, leg 3 would have unit-tested a function with no terms — and applied *the previous flight's own fixture rule* to it, executing a methodology recommendation vacuously.

**The probe discipline needed a third extension, and this flight demonstrated it without noticing.** Session 4's gate measured **54** chrome-side `dragover`s on a deliberately slow gesture. The shipped defect is that a *normal-tempo* release produces ~0–3 and HTML5 rejects the drop. **The verdict that authorised building leg 5b was true only under an unrepresentative tempo** — extension (a) recurring in a dimension nobody enumerated, in the very next probe after the lesson was written down, because "representative" was read as *representative object* rather than *representative dynamics*. Corollary: **record probe counters as a range, never a single number.** A probe reporting 54 should immediately prompt *"what is the minimum that still works?"* — which in this flight **is** the defect.

**A grep returning nothing is not evidence of absence.** Two independent readbacks lied in one session: a literal NUL byte made GNU grep return no matches for an entire 847-line file (with `node --test`, `git diff`, `tsc` and `eslint` all green), and a `readDom` readback was grepped against JSON-escaped HTML. Both read exactly like "the thing isn't there." This matters more than two incidents: the flight's verification method is grep-shaped end to end — Grep-ACs, source-scan tests, Citation Audits, and **absence pins**. An absence pin over a poisoned file passes vacuously and silently. **Every absence-asserting scan needs a positive control.** Leg 2 did exactly that for the CSS pin test, which is why that one test is trustworthy.

**Green counts without durations hide regressions of any size.** Six gates and a code review reported a passing suite that had silently gone 5× slower.

**The verification pyramid was inverted.** ~2,000 lines of renderer unit tests were written over a hand-built fake whose geometry semantics were extended *twice* mid-flight — a fixture progressively simulating a layout engine the repo does not have, at a layer Flight 2's debrief already ruled structurally incapable of the claims that matter. Meanwhile the OS transport was measured once per direction, at a non-representative tempo. HAT step 1 was *"the first time anything in this repo checked a drawn drop position against a committed one with a real layout engine."*

## Recommendations

1. **Make refusal claims executable.** For any AC asserting a guard refuses something, require a test that exercises it through the named entry point and goes RED when that predicate is neutered. Pair with an **absent-input drill** (evaluate each predicate with each injection missing; record the literal outcome) and a **state-the-negative** rule (say what the guard does *not* cover). This targets the four-instance class that a citation rule would only partly catch.

2. **Pre-register probes; report counters as ranges.** Before the gesture, write down the claim the verdict will license, the stimulus and why it is the artifact the product uses, the gesture and where it appears in the specified interaction, **the tempo/dynamics including one naive-tempo repetition**, the positive control, and what result would be an instrument artifact. A negative verdict re-reads all of it, not only the last item.

3. **Require a duration alongside every pass count** in leg Gates entries and in the flight-end review. Add a **standing guard for literal control characters** in source (lint rule or `git grep -I --files-without-match`) — the flight proposed this itself and did not land it — and require a **positive control on every absence-asserting scan**.

4. **Schedule the behavior-test debt as its own leg.** `bookmarks-drag` is `draft` / never run and needs amending first (the interaction changed materially mid-flight). `bookmarks-bar` and `bookmarks-jar-scoping` both pre-date the reorder mutation path this flight created and were slated for re-run. Criterion 6 is behavior-test-backed by the mission's own wording; none of that testing happened.

5. **Queue `bookmarks-bar.js` (1,046 lines) for extraction, and document the four-timer ordering model as one invariant.** Natural seams: the drag-session state machine (local + foreign + hold) and the overflow partition/snapshot machinery. Also give the budget mechanism a second file to watch, or it will keep guarding the composition root while complexity accumulates one directory over.

6. **Give every leg that adds a mechanism its own documentation AC.** Deferring to a flight-level checklist item is deferring to something unfalsifiable, and it silently did not happen for four legs.

7. **Fix the overflow → bar defect as a scoped design review, testing the `dragenter` hypothesis first.** The chrome registers `dragover` + `drop` on `document` and **no `dragenter` anywhere in `src/`**. Per the HTML5 drag model a target is established by cancelling `dragenter` *or* `dragover`; a cancelled `dragenter` would establish it at the moment of entry, collapsing the vulnerable window to zero. That is ~6 lines against three multi-surface candidates. **Instrument `dragenter` and capture a *failing* trace before and after** — the current diagnosis is an inference from a gap, and a fix validated against reasoning rather than a failing trace would be as unfalsifiable as the diagnosis it treats.

## Action Items

- [ ] Land a standing guard for literal control characters in source (Rec 3) — proposed by this flight, not implemented
- [ ] Promote leg 1 AC4's shape to a standing rule: assert a refusal at the layer it occurs, through the named entry point, with a test that reddens when the predicate is neutered (Rec 1)
- [ ] Add probe pre-registration incl. tempo/dynamics and range-reporting to `AUTHORING.md` and the flight/leg skills (Rec 2)
- [ ] Record in `docs/mcp-automation.md`: `readDom` returns JSON — parse it, never grep the escaped payload; the MCP port is not reliably 49707 and nothing prints it (`ss -ltnp`); a grep returning nothing is not evidence of absence
- [ ] Require a duration alongside every pass count in leg Gates and the flight-end review (Rec 3)
- [ ] Schedule the behavior-test leg: amend + run `bookmarks-drag`; re-run `bookmarks-bar` and `bookmarks-jar-scoping` (Rec 4)
- [ ] Fix overflow → bar via scoped design review, `dragenter` hypothesis first, verified against a failing trace (Rec 7)
- [ ] Queue `bookmarks-bar.js` extraction; document the four-timer ordering invariant (Rec 5)
- [ ] Document the drag machinery in `CLAUDE.md` — the MIME set, `bookmark-drag.js`, `guest-bookmark-drop`, spring-loading, the foreign session (Rec 6)
- [ ] Carry DD1e and DD1c as **open** — genuinely unverified, blocked by the dev profile having no vault
- [ ] Carry DD1f's IPC-ordering residual as open: the eager scrub **narrows** the window; `webContents.send` and `executeJavaScript` are not formally ordered in Electron
- [ ] Reconcile leg 4 / 5a / 5b acceptance-criteria checkboxes against the flight log, and fix leg 5a's missing AC5
- [ ] Land the `menu-overlay.js` fake-DOM harness — open since Flight 1, and the file now carries drag lifecycle, not just render bodies
- [ ] Note: commit `4bdd9f6`'s message says *"Completes mission criterion 6"*, which `5e40741` and `mission.md` contradict. Left unrewritten (a later commit corrects it in sequence); recorded so the permanent record is not read in isolation

---

## Merge Record

Landed on `main` as squash commit `053d016` via PR [#151](https://github.com/msieurthenardier/goldfinch/pull/151) (2026-08-06), following the convention M14 and M15 F1/F2 all used.

**The review requirement was bypassed with an admin override at the operator's explicit instruction, after the blocked state and the open defect were both surfaced.** Recorded here rather than left silent, exactly as Flight 1's debrief did — the guard exists on this repo, and a bypass that leaves no trace is worse than the guard not existing. Note also that **no CI checks are configured for this branch** (`gh pr checks` reported none), so the merge rests on locally-run verification: 3558 pass / 0 fail, typecheck and lint clean.

The flight **shipped with a known user-visible defect** — [#150](https://github.com/msieurthenardier/goldfinch/issues/150), overflow → bar failing on first attempt — accepted by the operator at merge time. Mission criterion 6 is correspondingly unmet.

**The `flight/03-drag-interactions` branch is deliberately retained.** The flight log and both debriefs cite per-commit SHAs (`4bdd9f6`, `5e40741`, `33a324d`, `027b551`, `4563486`, `682161e`) that a squash merge would otherwise orphan — the same reason Flight 1's branch was kept.
