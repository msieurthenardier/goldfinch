# Flight Debrief: Jar-Scoped Bookmarks

**Date**: 2026-08-04
**Flight**: [Jar-Scoped Bookmarks](flight.md)
**Status**: landed
**Duration**: 2026-07-30 (diversion) – 2026-08-04
**Legs Completed**: 4 of 4

## Outcome Assessment

### Objectives Achieved

Bookmark ownership moved from the application to the cookie jar. The store left the `documents` blob for a real `bookmarks` table keyed by `jar_id`; every IPC channel became jar-addressed; `bookmarks-changed` gained a jar dimension; the chrome consumers re-derive against the active tab's jar, with tab activation added as a re-derive trigger alongside navigation and broadcast. Burner and internal tabs are inert for bookmarking and suppress the bar. Deleting a jar takes its bookmarks with it. Existing app-scoped bookmarks were dropped (clean slate).

Verified by four behavior specs, all green: `bookmarks-jar-scoping` 17/17 (graduated `draft` → `active`), `bookmarks-omnibox` 6/6, `bookmarks-bar` 14/14, `bookmarks-star-sync` 11/11. Suite 3356 pass / 0 fail; typecheck and lint clean.

### Mission Criteria Advanced

Both diversion criteria — jar scoping across bar/star/suggestions, and burner inertness plus jar-deletion teardown — are met and behavior-test-backed. The restart-persistence criterion was **re-verified, not re-earned**: this flight changed the mechanism satisfying it, so `bookmarks-bar` checkpoints 11 and 12 re-established it against the table-backed store.

*(Bookkeeping note: those two diversion criteria were still unchecked at mission level when the debrief began, despite being marked complete in the flight artifact. Found by the Architect interview and corrected.)*

## What Went Well

**The verification leg found a shipped defect the unit suite structurally could not.** `bookmarks-bar` checkpoint 7: the overflow chevron laid out past the bar's content edge and clipped away by `overflow: hidden` — DOM-present, `display: block`, correct `aria-expanded`, invisible, and still keyboard-focusable. `partitionOverflow` budgeted for item widths and the chevron but never for the bar's `padding: 0 6px` or `gap: 2px`. Introduced in Flight 1 (`d9e764e`) and undetected through an entire flight. Recorded as **FAIL with a linked re-verify** rather than retroactively greened; fixed in `457445f`, which also caught that the `total <= availableWidth` branch carried the same blindness.

**Design decisions largely held, and the ones that moved moved for good reasons.** DD1/DD3 make cross-jar mutation *unrepresentable* rather than merely unlikely — every by-id operation is `WHERE jar_id = ? AND id = ?`, and the `(jar_id, url)` unique index turns the feature's core claim into a database constraint. DD7's narrowing from "mostly coincides with tab switch" to "always" eliminated a whole class of trigger. DD9's split of `handleRemove` from `wipeJarData` was made at *planning* time and prevented identity-wipe silently destroying bookmarks.

**The migration ladder came out better than it went in.** Leg 2's review found that a v3-step throw on a fresh profile would leave v1/v2 tables durably on disk with `user_version` still 0 — bricking every subsequent open, *unquarantined*. Reworking to per-step `BEGIN IMMEDIATE`/bump/`COMMIT` (L2-DD-B2) makes a failed migration resumable, which the pre-existing ladder was not. Found by reasoning about failure interleaving, not by reading the spec.

**Live probing beat specification.** DD10 asserted a migration-failure classification mechanism that turned out false — `err.code` is uniformly `'ERR_SQLITE_ERROR'`; only numeric `err.errcode` discriminates. The reviewer probed `node:sqlite` live rather than trusting the design. That is Flight 1's negative-probe recommendation applied one flight later.

**HAT FIX 2 is the model for a shared-helper fix.** The reviewer caught that fixing `attachModalCard` alone would be a *silent partial fix* — three sibling backdrops hand-roll the same vulnerable logic. The FD then declined the tempting over-fix (retrofitting all three, which would have silently changed three keyboard contracts under cover of a cosmetic change) and extracted a minimal shared gate. Whole bug class fixed, nothing else touched.

**Test-timing analysis was done properly for the first time.** The Developer refused to difference two debriefs' recorded numbers, checked out the base commit into a worktree, and ran both on one machine — finding **5.6% machine-level drift with zero code change**. True cost of this flight: +78 tests (+2.4%) for +163 ms (+5.2%), not the +11.1% a naive comparison suggests. This finally answers M14 F1's standing recommendation: **cross-flight duration deltas under ~6% are indistinguishable from drift**, and any future timing-regression claim must A/B against its own base commit.

## What Could Be Improved

### Process

**Do not bundle work whose acceptance criterion is a rendered pixel into a leg whose acceptance criteria are unit-testable.** DD12 folded two carry-forward cosmetic fixes into a jar-scoping refactor because "both live in files leg 3 already opens." Two of the three HAT fixes then went to repairing those bundled items, while **the designed jar-scoping work passed every HAT step first time**. The bundling rationale is sound for *edit locality* and wrong for *verification budget*.

The deeper cause, named by the Architect: this codebase has **two surfaces no automated verification can observe** — the overlay sheet (`automation: secret-sheet`, refuses every tier by design) and the chrome toast layer (`#toasts` at y=884, under a guest view covering y=119–899). DD12 bundled two decisions whose entire success criterion was "the user sees X" on exactly those surfaces. Neither unit tests nor three review rounds could touch either.

**Leg 2's second review round was an enumeration failure, not the cost of a migration leg.** Round 1 found that adding a fifth `JAR_DATA_CLASSES` member broke a per-class-id consumer, fixed that instance, and did not sweep for others. Round 2 found the *same defect class at a second site* (`CLEAR_COPY`/`CLEAR_OK_NOTE` rendering literal `"undefined"`). A single grep for per-class-id lookup tables would have enumerated all three in round 1. The migration axis — the hardest part, carrying the boot-brick risk — was fully settled in one round.

**Leg 4 was under-sized in the plan relative to what it cost.** One bullet ("run the specs") became four sessions, two app restarts, mid-run replacement of both crew agents, nine spec defects found and fixed, and the discovery of a shipped Flight 1 defect. **A verification leg that amends nine specs is doing authoring work**, and the plan budgeted none.

**Risk tiering keyed on change shape rather than blast radius.** Leg 1 was tiered LOW on shape — behavior-neutral, single-surface, established pattern, all true. But what moved was 534 lines of the **human vault flow** (unlock, capture, recovery-show, admin-key-show, change-master, step-up, plus a subscribe-then-fetch ordering contract). `createVaultController` has no dedicated unit test; the four vault behavior specs were not run; the HAT and spec round were bookmarks-only. The extraction didn't *lose* coverage — `renderer.js`-resident code is unit-untested by design — but the convention is that such code is verified by behavior specs, and **none covering the moved slice were run. That verification is still outstanding.**

### Technical

**The fix's own guard is comment-only, and the identical defect is one CSS edit away.** `styles.css:668-676` and `bookmarks-bar.js:32,43,44` carry matching PINNED-PAIR comments. **No test enforces the pair** — change `gap: 2px` → `4px` and the suite stays green while the chevron leaves the box again. The repo already has the pattern to close it (`csp-pins.test.js`, `tab-drag-invariants.test.js` both `readFileSync` a non-JS source and assert against it). Note `BAR_GAP`/`BAR_PADDING_X`/`CHEVRON_WIDTH` are module-private, so such a test must scan the source or the constants need exporting.

**The same mirror-by-comment pattern appears twice more**, in code this flight touched. `bookmark-edit-validate.js:22-24` says it *"mirrors bookmarks-store.js's own `validUrl` predicate exactly (not imported)"*; nothing diffs them. This became more load-bearing when HAT FIX 1 gave main a second, independent duplicate-check path — the sheet's validator and the store's now gate the *same* user action at two points.

**A fallback that cannot fire visibly.** `bookmarks-client.js:191-197` retains `surfaceRejection` as a "residual-race fallback" with an honest comment — but it routes to the invisible toast layer. Either fix the surface or remove the fallback and document the race as unhandled.

**`bookmarkReorder` is unproven code, not shipped code.** Zero renderer call sites; the entire DD2 position machinery is unit-test-only. Correctly de-prioritised then; Flight 3 is its first consumer and must treat it as unproven.

**Dead export**: `DATA_IMAGE_RE` (`bookmarks-store.js:288`) has no consumers — a mirror of `favicon-fetch.js:41` with a test pinning a dead export.

### Documentation

- `CLAUDE.md:207`'s bar/overflow bullet should name the CSS↔JS pinned pair — the one thing a Flight 3 drag implementer will break without knowing.
- The two unobservable surfaces (overlay sheet, toast layer) belong in `CLAUDE.md` as an explicit standing list, so any future decision whose criterion is "the user sees X" there is HAT-gated at design time or declined.
- `find-overlay-geometry.js:14-15` mirrors a retired CSS rule; the comment points at nothing.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|---|---|---|
| Checkpoint 7 recorded FAIL + linked re-verify rather than a retroactive PASS | The defect shipped and sat undetected for a flight; erasing it would understate what the test caught | **Yes** — a same-session fix does not retroactively green a real finding |
| Leg 4 steps 10–11 not run (3 adjacent + 6 Flight-1 deferrals) | Operator scoped the leg to the four bookmark specs | **No** — but see Recommendation 5; this is the item's *third* deferral |
| Two spec rows split mid-run into `[operator-hover]` / `[operator-keyboard]` | Each bundled an automatable claim with one no apparatus can observe | **Yes** — screen for this at authoring time |
| `[a11y]` dropped from a sheet-interior row | `secret-sheet` refuses every tier *by design*; the tag was unsatisfiable in principle, not merely unmet | **Yes** |
| Overflow fix committed separately from the run log | Behavior-test no-amend rule | Already standard |
| HAT step 6's expectation corrected in the flight log, not the leg | Legs are immutable once `in-flight` | **Partly** — see Recommendation 7 |
| Both crew agents replaced mid-run (sessions ended) | Context exhaustion over a long run | **No** — but it validated the evidence-banking discipline; a fresh Executor reproduced from banked artifacts with no loss of rigor |

## Key Learnings

**Fixture legibility and fixture discrimination are anti-correlated.** The Developer reconstructed the pre-fix `partitionOverflow` and proved all four original unit cases were **blind** to the bug, then sampled 200,000 random plausible fixtures: only **4.9%** would have discriminated. The four that existed sat in the *systematically least* discriminating region — because they were chosen for arithmetic legibility (`[40,40,40]` in 200) so the test comment could spell out the math. Round numbers with comfortable slack are exactly what a human picks, and slack is exactly what makes a small additive term inert.

**The same blindness appeared in three independent places this flight**: the unit fixture; `bookmarks-jar-scoping` step 8c (undetectable when the test jar is the default jar); and `bookmarks-bar` step 12 (passing on an append-then-drop that never exercises order-stitching). That is not a coincidence about one function — it is a house tendency to pick the fixture that reads well over the one that can fail.

**A pure function's contract and its caller's units are different tests.** Half the overflow defect (the gap term) lived inside `partitionOverflow` and a tight unit fixture catches it. The other half (padding) lived in the *caller*, which passed a **border-box** width into a parameter documented as **content** width. No test of the pure function could ever have caught that — it needed the DOM-harness test the fix added.

**When a flight reverses a scoping ruling, the premise audit must cover Intent, Preconditions, and fixtures — not only numbered checkpoints.** The flight did a careful checkpoint-level audit and correctly dispositioned three inversions. It missed that the corpus encoded the app-scoped model in *preconditions* and *intent paragraphs*: four of leg 4's nine spec defects were assertions silently assuming one global collection. Those fail **silently** — a spec passes vacuously — rather than loudly.

**Adding a member to a frozen registry has a greppable fan-out.** When review finds one broken consumer of an enum extension, the correct response is a completeness sweep in that same round, not a point fix.

**Threshold prerequisites must be measured with the pinning test's own metric.** The `RENDERER_LINE_BUDGET` prerequisite said "1932, one line of headroom" using `wc -l`; the seam test's own metric measured **1933 — zero headroom**. Both the number and the conclusion were wrong.

**Behavior tests are the instrument for rendered-state claims, and this codebase has no substitute.** There is no jsdom/happy-dom harness; every layout number in a renderer unit test is asserted by the test author, not derived by a layout engine. Divergence between the author's mental model and the browser's is invisible **by construction**. That bounds what unit tests can claim about rendering — it is not fixable with better fixtures.

## Recommendations

1. **Adopt "one tight case per budget function," asserting the invariant rather than the example.** For any function computing a partition/budget/fit, require at least one fixture where *every* term changes the answer, and assert the property the formula maintains (`laid-out width ≤ available`) plus maximality — not `visibleCount === 9`. `test/unit/bookmarks-bar.test.js:75` is the template; the 4.9% measurement is the justification.

2. **Add a mechanical CSS↔JS pin test** for `BAR_GAP`/`BAR_PADDING_X`/`CHEVRON_WIDTH` against `styles.css`, on the existing `csp-pins.test.js` source-scan pattern. Without it, the fix's comment is the only guard and the identical defect is one edit away. While there, give `bookmark-edit-validate.js`'s `validUrl` a differential test against the store's, or import one from the other.

3. **Screen behavior specs at authoring time for the two shapes that produced 7 of 9 spec defects** — (a) assertions carried over from a superseded scoping ruling, re-read against the new scoping, *including Intent and Preconditions*; (b) rows bundling an observable claim with an unobservable one, split and tagged by apparatus. Both belong in `AUTHORING.md`, along with the five methodology items leg 4 promoted (id-based target verification against a snapshot banked immediately before the action; absence claims need controls; load-bearing claims need artifacts; same-document-vs-reload markers; identify an element before characterising it).

4. **Resolve the sheet-automation disposition before Flight 3 designs drag.** Flight 3's target surface *is* the overflow sheet. Flight 1 asked for this disposition; leg 4's resumption note asked again; it is still open, and it hid the next bug exactly as Flight 1's debrief predicted (H7's invisible star, a render-body sizing defect with no harness). The choice remains: admit the automation tier for sheet content, or formally accept the limit and stop paying for attempts.

5. **Schedule the deferred-spec backlog as its own work, not a third carry-forward.** Nine specs (six from Flight 1's landing, three adjacent) have now slipped twice. Critically, Flight 1's justification — *"prose was edited, no code contradiction is known"* — **no longer holds**: this flight moved real code under `menu-overlay.js`, `page-context-model.js`, and `bookmark-star-icon.js`, so two of the six deferred specs now sit over changed code. That is a leg's worth of work, not a tail-end checkbox.

6. **Verify leg 1's extraction.** The four vault behavior specs covering the moved slice were never run. Either run them or record an explicit acceptance of the gap — and re-tier future extractions on blast radius, not change shape.

7. **When an in-flight leg's expectation is invalidated, leave a pointer in the leg's AC line, not only in the log.** Leg 4's step 6 says "expect the duplicate-url toast"; after HAT FIX 1 the correct expectation is an inline sheet error. The correction is right and the immutability rule is right, but the artifact now reads wrong on its face.

8. **Chase the two open anomalies before they decay.** The Ctrl+click duplicate-tab anomaly is narrowed (both branches call a literally identical `createTab`, so if real it is event dispatch/routing, not handler logic) but open. The `navigate()` fragment asymmetry — adding a fragment is same-document, removing one reloads — is undiagnosed as to layer and **matters well past bookmarks** if it reproduces without MCP in the loop: an unwanted reload discarding page state on a back-button transition would be a real product defect. Determining that is cheap.

## Action Items

- [ ] Add the CSS↔JS pin test for the bar's gap/padding/chevron constants (Rec 2)
- [ ] Add a differential test for the two `validUrl` mirrors, or import one from the other (Rec 2)
- [ ] Add the budget-function fixture rule and the spec-authoring screens to `AUTHORING.md` (Recs 1, 3)
- [ ] Name the CSS↔JS pinned pair in `CLAUDE.md:207`; add the two unobservable surfaces as a standing list
- [ ] Decide the sheet-automation disposition **before** Flight 3 design (Rec 4)
- [ ] Schedule the nine deferred specs as their own work (Rec 5)
- [ ] Run the four vault behavior specs, or record acceptance of the leg-1 verification gap (Rec 6)
- [ ] Determine whether the `navigate()` fragment asymmetry reproduces without the MCP tool (Rec 8)
- [ ] Retire the dead `DATA_IMAGE_RE` export and its test, or document why the mirror is kept
- [ ] Fix or remove `surfaceRejection`'s invisible-toast fallback (`bookmarks-client.js:191-197`)
- [ ] Correct the dead CSS mirror comment at `find-overlay-geometry.js:14-15`
- [ ] Flight 3 design: settle index-vs-id dispatch for the overflow snapshot; treat `bookmarkReorder` as unproven; decide the `renderer.js` budget question (63 lines headroom) at design stage
