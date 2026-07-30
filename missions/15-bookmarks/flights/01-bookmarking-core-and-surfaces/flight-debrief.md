# Flight Debrief: Bookmarking Core and Surfaces

**Date**: 2026-07-30
**Flight**: [Bookmarking Core and Surfaces](flight.md)
**Status**: landed
**Duration**: 2026-07-28 → 2026-07-30 (design + 5 legs + HAT)
**Legs Completed**: 5 of 5

## Outcome Assessment

### Objectives Achieved

The complete non-drag bookmarks feature for issue #122 shipped: a versioned `bookmarks` document store with per-entry repair; `bookmarks-changed` invalidation broadcasts; chrome-only sender-resolved IPC; the address-bar star with a five-path state sync and a quick-edit popover; page-context "Bookmark this page"/"Edit bookmark…"; `Ctrl+D` and `Ctrl+Shift+B`; the merged "Startup & appearance" Settings section with an off-by-default bar toggle; the bookmarks bar (icons/monograms, tooltips, click-to-navigate, middle-click background-tab open, instant non-animated guest reflow, overflow menu with per-row editing); and bookmarks as an address-bar suggestion source with FTS5-parity matching.

Scale: 7 commits, 83 files, +6798/−179, 18 new source and test modules.

### Mission Criteria Advanced

Seven of the mission's eight success criteria are met and checked off. The eighth (drag interactions) belongs to Flight 2 by design. All three cross-cutting mission risks were retired: the drag spike produced a measured verdict on its primary axis, the activate-on-create audit completed with a session-restore rewrite, and the shortcut-classifier lockstep debt was converted into a pinned invariant.

## What Went Well

**Per-leg design review earned its cost with verifiable saves.** The Architect confirmed four pre-implementation catches as real, each traceable in the diffs rather than merely narrated:

- A `createTab(url, {background:true})` two-arg call that would have placed the options bag in the `container` parameter — silently defeating background-open *and* corrupting the new tab's jar/partition resolution.
- DD11's original substring matcher, replaced with adjacency-required quoted-phrase-prefix semantics after live FTS5 testing showed substring matching over-matches real behavior.
- A missing fifth star-sync path (`createTab`'s wcId-arrival site) without which `restoreHistory`-based tabs (duplicate, reopen-closed, session restore) could boot with a permanently hidden star.
- A false audit premise crediting cross-window adopt as a `createTab` call site, which would have produced a misleading audit table.

**The FTS5-parity test is the flight's strongest artifact.** It builds a live in-memory `node:sqlite` FTS5 table with production's exact `unicode61`/`prefix` config and diffs the JS matcher against FTS5's real match-set over a 19×25 corpus — an external oracle, not a self-consistency check. Its discriminating power was proven by deliberately swapping in the wrong implementation and watching 3/12 tests fail. This is the template for any future hand-mirror in this codebase.

**Rendered-state judgment caught what DOM-level testing structurally could not.** The overflow menu's right-edge clipping passed every DOM assertion (the names were all present and correct) and failed only because the Validator judges pixels and the operator confirmed the clipping was real. Same class of win: the operator's eye caught a pre-existing `box-sizing` bug on `.sg-option` that had been bleeding every suggestion row 16px past the sheet edge since the sheet's M08-era origin — older than this flight.

**Architecture discipline held under real pressure.** Both evaluate-seam growths (31→32→33) followed the documented every-new-sheet precedent with FD rulings recorded before implementation and the CLAUDE.md dual-source note updated in the same change. Both `RENDERER_LINE_BUDGET` bumps enforced their precondition first — business logic moved into `bookmarks-client.js` (115 lines) and `bookmarks-bar.js` (274 lines) before the ceiling was raised, leaving renderer.js's growth to genuine composition-root glue.

**Honest reporting under pressure to fabricate.** The drag spike's hard constraints (no synthetic-drag attempts, no fabricated `DragEvent` evidence) were enforced even when honoring them meant returning "unmeasurable" from an implementation session. During the HAT, the Executor halted rather than pressing Ctrl+D on a drifted precondition, and reported the sheet-automation refusal rather than substituting a fake.

## What Could Be Improved

### Process

**An FD ruling was accepted on reasoning instead of verified against the code.** In leg 3 I ruled that reordering `SHEET_STATES` would give the two new bookmark sheet states real a11y coverage "instead of being masked by the kebab." That model of the guard was wrong: `isSheetContents` refuses by the shared sheet `WebContentsView`'s wcId identity, not by menuType content, so whichever state runs first fails unconditionally at any tier. The reorder accomplished nothing. Rulings that rest on a mechanism claim should cite the guard condition, not infer it.

**Four legs each spent verification budget on an a11y attempt that was structurally guaranteed to fail.** After the first confirmation, the "attempt and record" ritual stopped discovering information. Either declare sheet-hosted a11y permanently out of reach in Pre-Flight, or scope a fix to `resolve.js`.

**Enumerate-all-call-sites tasks undercounted at first draft for the second flight running.** Leg 2's star-sync sketch listed three paths where five existed; design review caught it. The fix is cheap: leg specs that enumerate cross-cutting call sites should carry a grep-verified count in the draft, not wait for review.

### Technical

**The flight's one shipped functional bug had no test surface at all.** The popover's Name field was blank from leg 2 through the HAT because the store's `title` was never translated to the sheet model's `name` on the *open* side — the translation existed on the submit side and in the a11y fixture, so the asymmetry looked complete. It survived three design reviews and every automated gate because no test exercises `menu-overlay.js`'s render bodies (house convention: no jsdom harness). A human's eyes were the only instrument that could see it.

**Two hand-mirror pairs landed in one flight with unequal evidentiary strength but equal-sounding documentation.** The FTS5 matcher has an external oracle; the shortcut classifier pair cannot have one (there's no reference implementation to diff against), so its parity test pins agreement, not correctness — both classifiers could be wrong identically. Their doc comments currently read with similar confidence.

**`RENDERER_LINE_BUDGET` has now been bumped by one-off FD ruling in several consecutive flights.** The mechanism is working as a forcing function, but the repetition suggests renderer.js wants extraction rather than another ceiling raise.

### Documentation

CLAUDE.md gained a Bookmarks pattern section and both seam-count updates. The gap worth closing: the "instrument from inside, not outside" method for anything touching the overlay sheet is a durable methodology fact discovered three separate times this flight and currently recorded only in the flight log and the behavior specs' preconditions.

## Test Suite Timing

**3278 / 3278 pass, 0 fail, 0 skipped, 0 todo**, run twice (2951.86 ms / 2939.95 ms runner-internal; ~3.3 s wall), no flakes. `npm run typecheck` and `npm run lint` both clean. 198 test files (was 187 at M14 F1).

Lineage: M12 close 2689 (~2100–2390 ms) → M13 close 2840 → M14 F1 2993 (~2815 ms) → M14 F2 3089 (~2795 ms) → M14 F3 3095 (2863/2814 ms) → **M15 F1 3278 (2940–2952 ms)**.

The suite grew **+183 tests (+5.9%)** — the largest single-flight jump in this lineage (M14's three flights added +305 combined) — while runner-internal time grew only ~3–5%. Sub-linear, consistent with the established convention that count is the comparable metric. No new slow-test class: the slowest individual tests remain the pre-existing crypto/vault band (monotonic-id 651 ms, scrypt derivation 495 ms, session-log clamp 280 ms), with this flight's slowest new tests at ~112 ms (the `Promise.allSettled` navigation-controller cases, paying legitimate fake-timer overhead). The FTS5-parity test's live in-memory SQLite table per assertion pass is the other measurable cost — a necessary price for an external-oracle test, not incidental bloat.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| `session-restore-wiring.test.js` mutation pin re-targeted to a specific string | Leg 1's rewrite added a second `continue` guard; the pin was made more specific, not weakened | Yes — rename-not-delete for pins whose premise shifts |
| Anchoring for the popover succeeded; centered fallback never needed | Pre-authorized adaptation criterion went unused | n/a — pre-authorizing the fallback cost nothing and removed risk |
| `toolbar-pins.md` prose sweep hit 22 sites vs the spec's "~16" estimate | Every occurrence genuinely applied | No — estimate variance, not a process problem |
| Drag-spike axis (b) procedure declared obsolete rather than executed | Its premise (agents can instrument the sheet) was falsified mid-flight | Yes — retire a procedure whose premise dies; don't force a verdict |
| First drag-probe read looked like a failure; cause was the probe, not the app | Probe never called `preventDefault()` on `dragover`, which HTML5 requires before `drop` fires | **Yes — highest-value lesson of the flight** |
| Six affected pre-existing specs deferred rather than re-run | Operator decision; text updated, no known code contradiction | No — a scope call, recorded as an open item |

## Key Learnings

**A negative probe result is a hypothesis about the probe, not a fact about the system.** The drag spike's first read (24 `dragover` events, no `drop`) would have been recorded as "cross-surface drag not viable," and Flight 2 would have been designed around a limitation that does not exist. The actual answer — viable, with the app's own `application/x-goldfinch-tab` payload arriving intact — only surfaced because the probe itself was re-examined. Any spike returning a negative should get one round of "what would make this instrument lie?" before the verdict is written down.

**A template's structural contract and its dynamic behavior are different tests.** This flight pinned the `bookmark-edit` card's shape and still shipped a blank field for three legs. DOM-shape assertions verify what the builder makes; only an open→populate→observe test verifies what the user sees. This is the second time this flight a structural contract was pinned while dynamic behavior went unexercised.

**Operator eyewitness is a legitimate evidentiary tier, and it should be tiered explicitly.** Three clauses across the runs (two animation-absence, one native tooltip) are structurally uncapturable by stills, and the Validator reasoned each acceptance in the open. It also flagged that a terse "hover works" is weaker corroboration than a null-result check against a standing instruction. The Validator's own recommendation — name these tiers in the authoring guide, and require content-specific operator reports when a clause specifies content — is the single best methodology improvement to come out of this flight.

**Pre-existing bugs surface when a human finally looks.** The `.sg-option` overflow had shipped since M08. Nothing in this flight caused it; the HAT simply pointed a person at the surface for the first time in a while.

## Recommendations

1. **Resolve the sheet-a11y wall instead of re-discovering it.** Either scope a `resolve.js` change admitting the automation tier for sheet content (refusing normal user sessions), or state in Pre-Flight that sheet a11y is permanently out of reach and drop the per-leg attempt ritual. Four legs paid for the same finding.
2. **Add a fake-DOM harness for `menu-overlay.js` render functions.** `bookmarks-bar.js` already proved the pattern works for a renderer module here. This is the gap that produced the flight's only shipped functional bug, and it's the same gap that will hide the next one.
3. **Formalize operator-corroboration tiers in `AUTHORING.md`** (temporal/animation null-result check; apparatus-gap direct report, requiring content-specific wording when the clause names content; frame-occlusion re-observation). Also add a standing instruction: dismiss any overlay before capturing "did the surface update" evidence.
4. **Adopt the negative-probe discipline as methodology.** Add to the behavior-test and leg-design guidance: before recording a negative spike verdict, audit the instrument against the spec it depends on.
5. **Queue renderer.js extraction for routine maintenance** rather than a fourth consecutive `RENDERER_LINE_BUDGET` ruling, and document the hand-mirror strength distinction (oracle-backed vs agreement-only) where the classifier pin lives.

## Action Items

- [ ] Run the six deferred behavior specs (`page-context-menu`, `settings-shell`, `settings-controls`, `toolbar-pins`, `omnibox-suggestions`, `menu-overlay`) in a follow-up verification session — leg 3 edited their prose; no code contradiction known
- [ ] Decide the sheet-a11y disposition (fix `resolve.js` vs formally accept and stop attempting) before the next mission that adds sheet UI
- [ ] Add a fake-DOM harness for `menu-overlay.js` render bodies; backfill an open→populate→observe test for `bookmark-edit`
- [ ] Fix the suggestions-sheet star sizing by removing the builder's hardcoded `width`/`height` presentation attributes (or making them parameterized) rather than relying on CSS percentage-height to resolve against a stretched flex item — the observed symptom (centering works, sizing silently no-ops) matches a percentage-resolution timing edge case, not a specificity problem
- [ ] Surface the duplicate-URL edit rejection to the user — currently `handleEditSubmit`'s `.catch()` never fires because `{ok:false, reason:'duplicate-url'}` is a resolved value that nothing reads; the edit silently reverts with no feedback. Operator-accepted for v1, but it is the flight's most likely real-user confusion
- [ ] Record the "instrument from inside, not outside" sheet-spike method in CLAUDE.md (currently only in the flight log and spec preconditions)
- [ ] Flight 2 planning: run the corrected in-source axis-(b) drag probe before designing bar↔overflow drag; budget operator time for sheet-touching verification from the start; re-examine whether DD9's frozen-snapshot index dispatch survives live reordering, or whether id-based addressing is needed

---

## Merge Record

Landed on `main` as squash commit `d9e764e` via PR #145 (2026-07-30), following the recent project convention (M14's flights landed the same way). The review requirement was bypassed with an admin override at the operator's explicit instruction — noted here because the guard exists on this repo and the bypass should be visible rather than silent.

The per-commit SHAs cited throughout this debrief and the flight log (`7dbf08b` foundations+surfaces batch, `2d1a5f3` prefill fix, `fc9f87e` settings/bar polish, `5d2d098` overflow anchor fix, `0b4d8e9` row overflow + star indicator, `f7586b2` star sizing attempt, `b336696` landing, `04ea5c2` debrief) are pre-squash branch commits. **The `flight/01-bookmarking-core-and-surfaces` branch is deliberately retained** so those references stay resolvable; they also remain visible in PR #145's commit list.
