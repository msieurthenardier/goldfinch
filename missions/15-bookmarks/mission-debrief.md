# Mission Debrief: Bookmarks

**Date**: 2026-08-06
**Mission**: [Bookmarks](mission.md)
**Status**: completed
**Duration**: 2026-07-28 → 2026-08-06
**Flights Completed**: 3 of 3 (one inserted mid-mission by diversion)

## Outcome Assessment

### Success Criteria Results

| Criterion | Status | Notes |
|---|---|---|
| Star / context menu / shortcut, quick-edit popover, star state sync | **Met** | F1; behavior-tested (`bookmarks-star-sync` 11/11) |
| Affordances inert on internal pages | **Met** | F1, tightened by F2's burner rule |
| Settings section merge + bar toggle, instant reflow | **Met** | F1 |
| Bar renders order, icons, tooltips; click / middle-click / overflow | **Met** | F1; `bookmarks-bar` 14/14 |
| Right-click rename / change URL / remove, propagating everywhere | **Met** | F1 |
| **Drag: reorder, bar↔overflow both directions, drag-onto-page** | **NOT MET** | 3 of 4 clauses ship and are HAT-verified. Overflow→bar has an open defect — [#150](https://github.com/msieurthenardier/goldfinch/issues/150) |
| Bookmarks in address-bar suggestions, deduped | **Met** | F1 |
| Jar-scoped (added by diversion) | **Met** | F2; `bookmarks-jar-scoping` 17/17 |
| Burner inertness + jar-deletion teardown (added by diversion) | **Met** | F2 |
| Survives restart; corrupt data repairs | **Met** | Re-verified in F2 (mechanism changed) and again in F3 (reorder created a path it had never been exercised on) |

**9 of 10 met.**

### Overall Outcome

The mission's stated outcome — *"keep a personal list of web pages per cookie jar and return to them without retyping addresses, at parity with flat bookmarks in modern browsers"* — is substantially delivered. A user can bookmark, edit, organise, search, and reorder bookmarks per jar, and everything except one drag direction works.

**The one criterion that failed is failing honestly, and that is worth as much as the nine that passed.** It was not checked off on a green unit suite; it is tracked as a public issue with its diagnosis, its confidence bound, and a requirement that any fix be verified against a captured failing trace. Four operator sessions were spent avoiding exactly the overclaim that a checkmark would have been.

**The outcome was still the right goal at the end** — with one mid-mission correction (below) that improved it.

## Flight Summary

| Flight | Status | Key Outcome |
|---|---|---|
| 1 — Bookmarking core and surfaces | completed | The whole non-drag feature: store, star, popover, settings, bar, overflow, omnibox. 7 of 8 criteria. |
| 2 — Jar-scoped bookmarks *(inserted by diversion)* | completed | Ownership moved from app to jar: real `bookmarks` table, jar-addressed IPC, every consumer re-derived. |
| 3 — Drag interactions | completed | 3 of 4 drag clauses; the sheet-automation disposition resolved; a pre-existing vault-pixel leak closed. |

### Flight patterns

**Flight 2 is the mission's best-executed flight**, and it was the one that was not planned. A wholesale store replacement plus five consumer rewrites landed with no residue — I grepped `src/` for app-scoped assumptions and found none. Constrained scope, one clear objective, and a design settled before implementation.

**Flight 3 struggled, and its difficulty was structural, not incidental.** It carried the mission's only unproven mechanism *and* a security-guard change, and the two competed. It ran nine review rounds and four operator sessions to F1's zero, and produced the mission's only unmet criterion.

## Process Analysis

### Planning effectiveness

The mission planned three flights and ran three — but not the three it planned. Drag moved from Flight 2 to Flight 3 and a refactor was inserted. **The plan's shape survived; its content did not, and the replan was correct.**

The operator's own assessment of the diversion is the one to record: **nothing at mission planning would have caught it.** The scoping problem became visible only once bookmarks existed and were used across jars. That closes the question — this was not a planning failure and no additional up-front interview would have prevented it. The diversion protocol worked: framing preserved as commentary, criteria amended in place, Flight 1 left `completed` because it was correct against the ruling in force.

**The sequencing call — refactor before drag — is validated in hindsight.** `bookmarkReorder`, the mission's only order-mutating path, was authored once against the final model, and Flight 3 was its first consumer.

### Execution patterns

**The escalation across flights was not earned.** F1: 5 legs, no operator sessions. F3: 7 legs, 9 review rounds, 4 operator sessions. The operator's verdict is *too heavy, diminishing returns* — and it sits alongside their flight-level verdict that the individual rounds were *worth it, keep as is*. Both are true and the combination is the finding: **each round found something real; the aggregate cost more than it returned.** The lever is not fewer reviews. It is (a) fewer rounds *generated by weak first drafts*, and (b) not letting one flight absorb two risk domains.

Concretely, of Flight 3's nine rounds, several existed only because a spec asserted something the author had not verified — an index formula wrong twice, a guard named wrong four times, a snapshot location that was unimplementable. Those rounds were valuable *and* avoidable.

### What worked, and should be kept

- **Measuring transports instead of assuming them.** Three measured verdicts, one withdrawn and re-measured. The mission's riskiest claims rest on observation.
- **Treating unproven code as unproven.** `bookmarkReorder` had zero call sites for a whole flight; verifying it first found a pre-existing position gap in live data.
- **Recording failures as failures.** F2's chevron-clipping FAIL was not retroactively greened; F3's criterion 6 was not checked off. This is the mission's most consistent discipline.
- **Implementers refusing to transcribe false claims.** Twice in F3 an agent was told to write something into a security comment that was wrong, and corrected it instead.

## Lessons Learned

### The intent-vs-predicate failure is this project's signature error — five instances, one mission

Naming a guard by what it is *for* rather than tracing which predicate actually executes:

1. `non-tab-contents` claimed to refuse jar keys; `out-of-jar` does.
2. A fail-open/fail-closed direction inverted.
3. `will-navigate` named as the navigation gate; Electron does not fire it for programmatic `loadURL`.
4. A precedent's shape cited instead of a menuType predicate named.
5. **`dropHandled` — found at this debrief, in no flight debrief.** `bookmarks-bar.js` declares it (`:274`), initialises it (`:543`), sets it (`:969`) and **never reads it**. In `tab-controller.js` it is read at `:219`/`:224` to gate tear-off; bookmarks has no tear-off. F3 DD2 states the ruling as though it were load-bearing. The test titled *"AC8: `dropHandled` is set synchronously"* (`bookmarks-bar.test.js:559`) **passes identically if the field is deleted**.

Four were caught by design review. The fifth slipped a design review, an implementation pass, and a flight-end review — because a test *named* for the guard was green.

**So what:** a citation rule catches one of five. **Make the claim executable** — for any AC asserting a guard refuses something, require a test that goes RED when the named predicate is neutered. That shape already exists in F3 leg 1's AC4 and was never generalised. It would have caught `dropHandled` at the moment the test was written.

### Every flight shipped a defect the unit suite could not see — three for three

F1: a blank popover field through three legs and three design reviews. F2: chevron clipping through an entire flight, where the debrief *measured* that only 4.9% of plausible fixtures would have caught it. F3: [#150](https://github.com/msieurthenardier/goldfinch/issues/150), plus a 5× suite regression hiding behind a green pass count.

The cause is known and stated in F2's debrief: **there is no jsdom/happy-dom harness — every layout number in a renderer unit test is asserted by its author, not derived by a layout engine.** F3 then wrote ~2,000 lines of renderer unit tests over a hand-built fake whose geometry semantics were extended *twice mid-flight*. The pyramid is inverted, both debriefs said so, and it was not corrected.

### Probe verdicts can be true only under conditions nobody enumerated

F1 established *"a negative probe result is a hypothesis about the probe."* This mission extended it twice — both times because **the operator caught it, not the audit**: is the *stimulus* representative (a tab carries tear-off machinery no bookmark drag has), and is this the *gesture the product actually has* (a pre-opened menu vs spring-loading)? A verdict was recorded "not viable", withdrawn, and re-measured as viable.

A third extension appeared and was not recognised at the time: the gate probe measured **54** chrome-side `dragover`s on a deliberately slow gesture; the shipped defect is that a normal-tempo release produces 0–3. **The verdict that authorised building the leg was true only under an unrepresentative tempo** — in the very next probe after the lesson was written down, because "representative" was read as *representative object* rather than *representative dynamics*.

**So what:** pre-register probes (claim, stimulus, gesture, **tempo including a naive repetition**, positive control, what would be an artifact), and **report counters as ranges, never a single number.** A probe reporting 54 should immediately prompt *"what is the minimum that still works?"* — which in this mission **is** the defect.

### A grep returning nothing is not evidence of absence

Two independent readbacks lied in one session: a literal NUL byte made GNU grep return no matches for an entire 847-line file (with `node --test`, `git diff`, `tsc` and `eslint` all green), and a `readDom` readback was grepped against JSON-escaped HTML.

This matters beyond two incidents, because the project's verification method is grep-shaped: Grep-ACs, source-scan tests, Citation Audits, and **absence pins**. An absence pin over a poisoned file passes vacuously and silently. **Every absence-asserting scan needs a positive control** — the CSS pin test did exactly that, which is why it is the one such test that is trustworthy.

### Corrections land in one place and are not swept

Three instances: DD3's rewrite left three orphaned "index translation" claims; DD12's `wc -l` correction left the wrong number in three other places; and — found at this debrief — **the Known Issue 2 correction applied to `mission.md` during the flight debrief was never swept into the three behavior specs that state the same falsified premise.** `bookmarks-jar-scoping.md:20` still said the guard was *"keyed on the shared sheet WebContentsView's wcId identity rather than on content"* — the exact superseded mechanism. A runner following those specs would have **under-tested by instruction**. Corrected during this debrief.

### The line-budget guard became a displacement pump

`bookmarks-bar.js` went 326 → 1,046 lines across the mission (executable: 151 → 374). F3 honoured `renderer.js`'s budget perfectly by relocating ~740 lines into a file with **no budget of its own**. The guard measures one file and intends something broader. The bar now holds three concurrent drag session models and 12 mutable closure variables against `tab-controller.js`'s 4.

### Verification deferred three times is verification abandoned

Nine behavior specs deferred since F1 have now slipped three times. DD1e and DD1c hopped leg → operator session → HAT → skipped, with `[x]` on their acceptance criteria throughout. F2's leg-1 vault extraction (534 lines of the human vault flow) was never verified by the four specs covering it.

**So what:** a check deferred twice should escalate, not defer again — and a HAT criterion must distinguish *performed / blocked / skipped*, because in F3 leg 7 "recorded" was allowed to satisfy "performed."

## Methodology Feedback

**The mission/flight/leg hierarchy held.** Both mid-mission splits (F3's leg 1 and leg 5) improved outcomes; the diversion protocol absorbed a reversed ruling without corrupting the record; risk-tiering keyed on blast radius rather than change shape, per F2's lesson.

**Three specific frictions:**

1. **Tiering as classification worked; tiering as control did not bind.** Five of six F3 legs were HIGH, and the consequence (a design review) was then waived three times — each time naming the flight-end Reviewer as the compensating control, whose output exists only as prose. If HIGH means "takes a design review," a HIGH leg that skips it should record an explicit waiver *and that control's output*.

2. **A flight-level checklist item is not a falsifiable commitment.** Four F3 legs deferred documentation to one, and it silently did not happen: ~1,900 lines of drag machinery are undocumented, and CLAUDE.md's Bookmarks section contains **zero** occurrences of "drag." **Every leg that adds a mechanism needs its own documentation AC.**

3. **`AUTHORING.md` has accumulated three mission-scale asks that were never landed** — F1's operator-corroboration tiers, F2's budget-function fixture rule and spec-authoring screens, F3's probe pre-registration. F3 demonstrated the cost of the third one *in the next probe after writing it down*. Methodology recommendations that live only in debriefs do not change behaviour.

### Operator experience — the most actionable feedback in this debrief

The operator's verbatim assessment: *"we need to instrument the chrome behavior from the admin mcp in the future, or create some other instrumentation to the drag and drop. The instructions were heavy, and sometimes difficult to follow (e.g. x,y coordinates are not something a human can see)."*

Two distinct problems, both the Flight Director's:

**Instructions were written in the instrument's units, not the operator's.** Pixel coordinates (`x≈1243, y≈104`) were handed to a human repeatedly across four sessions. A person cannot see coordinates; they see *"the chevron at the far right of the bar"* and *"the second bookmark, Debian."* The FD had coordinates because `evaluate` returned them and passed them straight through without translating for the reader.

**There is a real capability hole, and it was papered over with the operator's hands.** `dragPointer` cannot drive native HTML5 DnD — a recorded, load-bearing fact. So every drag verification ran: launch → hand-patch a probe into source → rebuild → operator gesture → read `<body>` counters → revert. Five cycles, two of which lied silently. The human supplied *both* the gesture and, effectively, the measurement harness.

**So what:** build first-class drag observation into the admin automation surface, so the human supplies only the **gesture** and the apparatus supplies the **measurement**. This is the single highest-leverage investment for the next mission that touches drag, and it converts the mission's most expensive verification into a repeatable one.

## Action Items

- [ ] **Build drag/drop instrumentation into the admin MCP surface** (operator request) — counters or an event log for `dragenter`/`dragover`/`drop` per surface, so drag verification stops requiring hand-patched probes. Highest-leverage item in this debrief.
- [ ] **Write operator instructions in human-perceivable terms** — never pixel coordinates; name the element and its position on screen.
- [ ] **Fix [#150](https://github.com/msieurthenardier/goldfinch/issues/150)** via scoped design review, `dragenter` hypothesis first (there is no `dragenter` handler anywhere in `src/`), verified against a captured **failing** trace.
- [ ] **Investigate overflow-row → page, a dead gesture** *(new, found at this debrief)*: the sheet sets only `BOOKMARK_DND_MIME` (`menu-overlay.js:321`) while the bar sets `text/uri-list` and `text/plain` too (`bookmarks-bar.js:514-516`), and main refuses the forward because a foreign drag never declares. Net: dragging an overflow row onto a page does nothing **and** the page's own dropzone receives no URL — worse than inert, because the row is `draggable` and advertises the affordance. Either complete the path or suppress it.
- [ ] **Delete `dropHandled` from `bookmarks-bar.js`** (`:274`, `:543`, `:969`) and retitle `bookmarks-bar.test.js:559`, or implement the guard DD2 describes. Correct DD2's payload table while there (the MIME is a marker with two incompatible writers and no readers).
- [ ] **Make refusal claims executable** — for any AC asserting a guard refuses something, require a test that reddens when the named predicate is neutered. Promote F3 leg 1 AC4's shape to a house rule.
- [ ] **Schedule the behavior-test work as a flight, not a leg** — sweep the falsified apparatus preconditions (done at this debrief), amend + run `bookmarks-drag`, re-run `bookmarks-bar` and `bookmarks-jar-scoping` against the reorder path, then the nine deferred specs.
- [ ] **Extract `bookmarks-bar.js`** at the visible seam (drag-session state machine vs render/partition), and **give the budget test a second file**.
- [ ] **Document the drag machinery in CLAUDE.md** — MIME set and its marker-only semantics, `bookmark-drag.js`, `guest-bookmark-drop.js`, the foreign session, spring-loading, and the four-timer ordering invariant.
- [ ] **Land `AUTHORING.md`'s three outstanding asks** — operator-corroboration tiers (F1), budget-function fixtures + spec screens (F2), probe pre-registration with tempo and range-reporting (F3).
- [ ] **Add the two unobservable surfaces as a standing CLAUDE.md list** (F2 action item, still open) and record the "instrument from inside, not outside" sheet method (F1 action item, still open).
- [ ] **Verify the sheet's non-bookmarks consumers** — DD1f's eager scrub and the (menuType × op) gate changed a contract every sheet menuType depends on; vault, auth, cert-picker and downloads sheets were never re-verified. DD1e and DD1c remain genuinely unverified.
- [ ] **Add a literal-control-character guard** and require **a positive control on every absence-asserting scan**; require **a duration alongside every pass count**.

---

## A note on scope, for the next mission

F3's DD1 began as "make the sheet measurable so bar↔overflow drag can be verified" and ended as a reclassification of all 23 automation ops plus the reversal of a documented sheet-lifetime invariant that every menuType depends on. The flight artifact contains the tell, written as an accepted trade-off: *"the leg grows to touch `menu-overlay-manager.js` and `menu-overlay.js`, and this flight otherwise has no reason to open the sheet's own machinery."*

The sequencing was right — the disposition had slipped three times and blocked drag verification. The scope was not. **When a design review expands a change from "gate one predicate" to "reclassify a subsystem's op surface and reverse one of its invariants," that is a re-scoping event, not a trade-off to absorb.** The flight should re-plan.

The evidence that it mattered: DD1's own validating checks (DD1e, DD1c) were the two HAT steps that got skipped, and the capability it was purchased for — accessibility-tree inspection of sheets — was never exercised. A security widening shipped with its confirming evidence outstanding, inside a mission about bookmarks.
