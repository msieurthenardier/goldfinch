# Flight Debrief: Tear-off and Cross-Window Drag

**Flight**: [08-tearoff-cross-window-drag](./flight.md)
**Mission**: [First-Class Tab Management](../../mission.md)
**Status**: landed → **completed**
**Commits**: `7b47498` (flight), `8c791fd` (HIGH-1 residual, found at debrief)
**PR**: [#91](https://github.com/msieurthenardier/goldfinch/pull/91)

## Outcome Assessment

The flight was designed to ship tear-off **and** cross-window drag. It ships **tear-off by
drag** and the **cross-window move by keyboard**, and records the cross-window *drag*
criterion **unsatisfied** — because a leg-2 spike, using a **second instrument**, measured
that the transport both of the flight's central design decisions rested on is a **cached
fiction** on this rig.

That is not a failure. It is the flight's option working exactly as design review
predicted, and the deferral is the best-instrumented this mission has produced. The
mission's *substance* for cross-window movement — a tab moves A→B keeping jar identity and
page state — ships by keyboard, and **DD2, the mission's absolute constraint, was proven
live for the first time** on both doors.

### Objectives Achieved

- **Tear-off by drag** — a tab dragged out of the strip and released becomes its own
  window, same live `webContents`, jar and page state intact (window-local coordinates
  only; DD16).
- **Cross-window move by keyboard** — "Move to window …" moves a tab A→B, keyed by
  `windowId`, refusing on a stale target rather than mis-targeting (DD8).
- **F7's blocking prerequisite** — the DD1 synchrony invariant pinned as an executable
  test anchored on a string literal, with a vacuity guard on anchor *and* pair.
- **F7's artifact debt** — the leaked-wrapper scan (**9 lines / 6 files**, not the 2 the
  debrief scoped), 11 stale run headers, the AC27 record, the kebab count.
- **F7's owed `multi-window-shell` clean re-run** — 9/9 + both variants, paying the
  history-gate debt with a real control.

### Mission Criteria Advanced

- **Criterion 7** (move to own window — drag + command): the drag half **ships**; F6
  delivered the command.
- **Criterion 8** (cross-window drag): **UNSATISFIED, deferred with an owner** — the
  gesture's subject is the drag, and the transport is dead. The keyboard move ships the
  outcome.
- **Criterion "keyboard-reachable equivalent"**: the cross-window move's equivalent ships;
  tear-off's already existed (the context-menu path).
- **The privacy/isolation criteria are strengthened**: DD2 (jar + page state survive the
  re-parent) had nothing proving it until this flight.

## What Went Well

- **The re-scope was the option working, not a scramble.** Design review pass 2 refused
  the FD's proposed pre-cut on the grounds that *"the proposed cut is exactly the
  V1-negative adaptation outcome — already encoded as an empirical gate; pre-cutting
  spends the option value for nothing."* The gate fired (on V4, not V1) and the cut
  happened on **measured evidence**. One spike leg bought the knowledge that the transport
  was fiction; the alternative was building three legs on it.
- **The vacuity guard earned its cost twice** — the whole argument for it. Leg 3's
  factoring fired guard (b) (4 of 8 failed, naming the missing pair); leg 4's rename fired
  guard (a) (9 of 11 failed, naming the missing anchor). An unguarded pin would have
  **silently retired itself** at both moments. Leg 3 added guard (c) — the channel must
  still *reach* the core — closing a hole the design didn't anticipate.
- **House-idiom fit is excellent and self-citing.** `tab-drag-zone.js` tracks
  `tab-order.js` (purity, LTR clause, the negative `isOutsideStrip` so unreadable input
  falls through to the non-destructive branch); `move-targets.js` tracks
  `window-census.js` (zero-state, total never-throwing accessors, source-exclusion by
  record identity).
- **The toolkit extraction was proven by byte-identity, not by "the suites still pass."**
  A `maskComments` that masks everything makes every source-scan pass vacuously — "still
  green" is the exact non-evidence these nets exist to warn about. The three text
  divergences were ruled at the toolkit; the regex-literal blind spot documented as
  latent-but-loud.
- **Every crew agent found a real defect, and several corrected the FD.** Leg 1's
  Developer caught that "four line numbers all wrong" was itself wrong (three were). Leg
  3's caught the `Math.abs` arm threshold that made a straight-down tear-off impossible —
  a blocker no artifact named. Leg 4's moved a builder into a pure module because
  `main.js` is unexecutable. Leg 5's Developer refused to tick ACs whose runtime readings
  nobody took. The flight-end review found the HIGH-1 double-active defect. **Every one
  was load-bearing.**

## What Could Be Improved

### The FD's commit message asserts a gate result the flight log refuses to assert

Commit `7b47498`: *"1892 tests, lint, typecheck, **a11y green**."*
The flight log's own gate table: *"`npm run a11y` — **NOT RUN, deliberately** … Not run ≠
green."* The Post-Flight checklist's a11y line is **unticked** (honest).

The resolution neither artifact states: a11y ran green at **leg 5** (a characterization of
the script's exit codes for a Known Issue), and was **not re-run at flight-end** after the
HIGH-1 fix landed in the same commit. Both literally true at different moments — and the
commit message collapses them into a claim about the final tree that **nobody measured**.

> **This is the flight's own thesis violated in its most durable and most-read artifact.**
> The flight built a Known Issue around *"an instrument that cannot discriminate between
> two states is not measuring them — Not run ≠ green"* and then wrote "a11y green" on the
> tin. Actual defect risk is low (the HIGH-1 fix touches main-process guest visibility;
> a11y audits chrome DOM). Thesis risk is high: **the commit message is outside the
> Completion Checklist's reach.** → Recommendation 1.

### The `Math.hypot` threshold is unowned, and the case it exists for is unfalsified

The arm threshold changed from `Math.abs(dx)` to `Math.hypot(dx, dy)` because a
straight-down tear-off holds `dx` at 0 and could never arm. Verified: `grep -rn "hypot"
test/` → three hits, all the word "hypothetical"; no test references `hypot` or
`DRAG_ARM_THRESHOLD_PX`. `tab-reorder`'s only drag holds y constant so `hypot ≡ abs`;
`tab-tearoff` rows 3/4 share a common `DROP_X` so both carry `dx ≠ 0` and arm under `abs`
too. **No instrument in the repo — unit or behavior — exercises `dx = 0, dy > 5`, the
exact case the change was made for.** And the straight-down drag is the *primary* tear-off
gesture, not an edge case.

> **This is a NEW failure shape for this lineage, and distinct from its own "vertical"
> recursion.** The vertical one is each generation re-deriving from a proxy. This is
> **lateral**: `tab-tearoff.md` **asserted that `tab-reorder.md` owned the threshold** — a
> claim about *another artifact's* coverage, made without reading it. Neither spec was
> wrong about itself. The gap lived in the space between them, where no single-artifact
> review can see it, and it took reading three artifacts *against each other* to find it.
> → Recommendation 3 (the cheap rule that prevents it) and the F9 carry (the test).

### `main.js` is executed by zero tests, and this flight priced that

`grep -rl "require.*main/main" test/` → zero files. `renderer.js` the same. Between them,
**7,836 lines of unexecuted product code** — every IPC handler and the entire drag
gesture. HIGH-1 was a **live defect on the headline new path**, found by *reading source*
because **no instrument could see it** (see below). The extract-pure-modules-and-source-
scan strategy is right and working — `move-targets.js` exists precisely so DD8's AC3 is
expressible as a test — but source scans pin **code shape, not behavior**, and HIGH-1's
bug was in the *interaction* between a pre-set and a guard 200 lines away.

### Verification

`npm test` **1892 pass / 0 fail / 0 skipped**, 13 suites; zero flakes across 4 consecutive
runs (1119–1162ms, ~51ms spread). Count reconciles to the line: F7's 1833 → 1841 (leg 1,
+8) → 1867 (leg 3, +26) → 1892 (leg 4, +25) → 1892 (leg 5 + flight-end, +0), restoring the
F1–F6 discipline F7 dropped. The flight-end **+0 is correct**: the new assertions landed
*inside* existing cases (`node --test` counts cases), `tab-drag-invariants` is 10/10 with
three more mutations inside the DD16 case.

**Timing, flat, first reading in two flights** (F7 recorded none): F8 ~1.12–1.16s against
F6's ~1.11s. F8's three source-scan suites (102–154ms) are the **first new suites to break
F6's "every new suite sub-100ms"** — structural, because they `readFileSync` + mask +
mutate `main.js`/`renderer.js` repeatedly; nowhere near the `automation-mcp-server` 823ms
pole. **`main.js` +209 (3517→3726), `renderer.js` +187 (3923→4110)** — F2's module-split
watch item is now **five flights unactioned**.

**Behavior**: `tab-tearoff` 9/9 (filed `partial` — two spec-instrument errata folded
mid-run; DD2 proven live); `multi-window-shell` 9/9 + both variants (F7's debt paid with a
real control: D=1, T1=1, R1=1, R2=2); `tab-context-menu` 10/10 (filed `pass`);
`tab-reorder` 8/9 (Step 4 inconclusive — reads `screenX === 564`, the exact cached fiction
this flight refuted).

## The HIGH-1 defect, and its residual

**The bug**: `moveTabIntoWindow` pre-set `target.activeTabWcId = p.wcId`, which **disarms**
the `tab-set-active` guard (`owner.activeTabWcId !== null && owner.activeTabWcId !== wcId`).
By the time the adopt round-trip's `tab-set-active` arrives with `wcId === p.wcId`, the
guard is already false — so the displaced tab keeps `active: true` + `setVisible(true)`,
and `enumerateTabs` reports **two active tabs** in the target window.

**Why every instrument missed it — the keeper:**

| Instrument | Why it could not fail |
|---|---|
| Unit tests | `main.js` never executed |
| `tab-tearoff` rows 3-7 | tear-off targets a `noBootTab` window (`activeTabWcId === null`) — **structurally unable** to fail this way |
| `tab-tearoff` row 8 (drives the path) | asserted the **moved** tab's identity; never asked what became of the tab it **displaced** |
| `captureScreenshot` | at equal window sizes the moved tab **completely covers** the stale guest — byte-identical either way, discrimination zero |

> **A row that drives the defective path is not coverage of it. The gap was never in which
> path was driven — it was in which observable was read.**

**It is a design flaw, not a slip.** The pre-set exists to make a *synchronous
transient-caption* concern work (`broadcastMoveTargetsChanged` reads `activeTabWcId`), and
it disarms a **correctness** guard to save a cosmetic transient that self-corrects in ms.
The pattern — *"disarm a guard, then hand-compensate for what it guarded"* — is a
latent-defect generator: it is stable only while someone enumerates the guarded set
correctly, and this flight's entire thesis is that unchecked enumerations are how defects
ship.

**The residual, found at debrief and fixed (`8c791fd`).** The disarmed guard gates **two**
effects, and the flight-end fix mirrored only one. The second is
`owner.sheet?.closeMenuOverlay('tab-switch')`. The Architect caught it; the fixing
Developer verified it is **stronger** than "menu stays open" — on the disarmed path
`tab-set-active`'s `else if (owner.sheet?.isMenuOpen()) owner.sheet.show()` branch
**actively re-shows the stale menu, re-positioned to the moved tab's bounds**. Fixed by
mirroring the menu-close synchronously. **This is the generator producing its second
instance one branch deep, exactly as predicted** — which is why the structural fix
(Recommendation 5) matters more than either patch.

**HIGH-1's regression net (`tab-tearoff` row 8a) is UNRUN.** It is well-built — asserts the
`{T1: true, T2: false}` **pair** from one `enumerateTabs` call (not the bare count "one",
which a stuck-true instrument passes), failing reading `2`, forbids a screenshot and says
why. But it has never taken a reading. **HIGH-1's fix ships on source reasoning alone**,
and the residual fix adds a second unrun assertion. Both are owed to F9's clean re-run.

## Key Learnings

### Two portable products — belong in the mission debrief and the methodology

> **1. A read-back is not a second reading unless it is a second instrument.**
> Every coordinate reading behind DD1 was Electron reporting on Electron: `setPosition`
> read back its own cached write; `screenX ≡ getBounds.x − 16`, two proxies of one value.
> V2 ("is `screenX + clientX` consistent?") compared two proxies and **could not fail** —
> and was then designated V8's control. The premise survived two design reviews and died
> to one `powershell.exe` call bringing Win32/RAIL. This is the **independence clause DD10
> was missing**: DD10 demands two readings; this demands they come from instruments that
> can disagree.

> **2. A row that drives the defective path is not coverage of it — the gap is in which
> observable was read.** HIGH-1's `tab-tearoff` row 8 drove the exact code that was broken
> and passed, because it read the moved tab and not the displaced one. Belongs in the
> behavior-test authoring guidance.

> **3. A coverage gap OF a spec is an honest boundary; a nothing-discriminating clause
> WITHIN a row is a false witness.** (Leg 5's Validator, ruling why `tab-context-menu`
> filed `pass` while three specs filed `partial`.) This is the criterion for when
> `partial` vs `pass` is honest.

### The recursion named itself, and reached six generations

*"Every correction inherits its predecessor's blind spot unless it changes instruments."*
The purest instance is AC8 — headed **"REPO-WIDE"**, instructing *"Scan `missions/**`"*,
with four leaked lines living in `tests/behavior/`. **The scope claim and the scope are in
the same sentence, and they disagree.** DD12's stale-header scan is the same shape:
`toolbar-pins` has **no `Last Run` field at all** over a genuine run — *"a grep for the
value `never` structurally cannot find a missing header"* — so the true drift is **28 of
48**, not the 11 DD12 measured at its instrument's boundary. The *principle* is real (and
is finding #1's family); the six-generations narrative is its evidence, not a separate
rule.

### The lateral gap is a distinct shape from the vertical recursion

The recursion above is **vertical** — each generation re-derives from a proxy. The
`Math.hypot` gap is **lateral** — two artifacts, each correct about itself, one asserting
coverage *about the other*, nobody's instrument pointed at the claim. It is cheaper to
prevent than to find: **an artifact may not assert that another artifact covers something;
it may only record what it covers itself.** Cross-references become pointers, never claims.

## Recommendations

1. **Re-run gates AFTER flight-end review fixes, and put it in the Completion Checklist.**
   Those fixes touch product source; F8's own checklist a11y line is unticked (honest) but
   the commit message asserted "a11y green" anyway — **the commit message is outside the
   checklist's reach.** That's the gap: the checklist should require a post-fix gate re-run
   whose result is what the commit message may claim.
2. **Recon must bring a second instrument before DDs are written on a geometry/coordinate
   premise.** This is the cheap catch F8 missed — a coordinate premise probed only through
   the framework that owns it is unverified. It is the honest counter-weight to the
   (correct) "don't pre-cut the spike" ruling: the spike leg was correctly sized; the
   *recon* was under-instrumented, and it cost the entire DD1/DD3/DD15 edifice.
3. **Adopt the lateral-gap rule** (an artifact may only record its own coverage; cross-refs
   are pointers, not claims). Cheap; would have prevented the `Math.hypot` gap outright.
4. **Adopt DD11's refined unit — CODE lines, comments excluded.** A total-line budget taxes
   exactly the documentation this lineage's corrections live in. Leg 3 came in +117 vs +90
   total, **stopped and reported** (the behavior DD11 exists to produce), and the residue
   was 51 comment lines carrying three measured corrections.
5. **Restructure the move core so nothing is pre-set into a disarmed guard (F9).** The
   pattern already produced two defects one branch apart (the double-active, the re-shown
   menu). Either stop pre-setting `target.activeTabWcId` and let `tab-set-active` do the
   hide+menu-close through its own armed guard, or feed `broadcastMoveTargetsChanged` an
   explicit caption for `p.wcId` rather than mutating shared authority state early. **F9
   touches this exact path.**

## Action Items

- [ ] **F9 — run `tab-tearoff` row 8a and the new menu-close residual assertion.** HIGH-1's
      fix and its residual both ship on source reasoning; neither net has taken a reading.
      Booked to the clean re-run `tab-tearoff` already owes (it filed `partial`).
- [ ] **F9 — land the `Math.hypot` arm-threshold unit test** (`dx=0,dy=6` arms; `dx=0,dy=4`
      does not). It **must be a unit test**, and the threshold is currently inline in
      `renderer.js`'s `pointermove` handler, in a file no test executes — so **extract the
      arm predicate (e.g. `shouldArm(dx,dy)`) into `tab-drag-zone.js`** where it is
      testable at all. Same move that made `move-targets.js` testable. Converts the debt
      from "owed forever, needs a rig" to a 5-line test.
- [ ] **F9 — apply the move-core structural fix** (Recommendation 5) before editing this
      path, or the next effect `tab-set-active` gains behind that guard silently regresses.
- [ ] **F9 — `tab-reorder` Step 4**: re-instrument against a second instrument (Win32/RAIL)
      or **delete it and mark it HAT**. It PASSES on `screenX === 564`, the cached fiction
      this flight refuted; its WSLg hatch keys on *zero* but the failure is *frozen*, so it
      is a guaranteed false green.
- [ ] **AC4/AC5 runtime half** — the flight's only genuinely unowned verification debt
      (fresh `getBoundingClientRect()` vs the `slotRects` snapshot). Needs a DOM harness
      this repo lacks; leg 5 did not take it either. **Decide an owner or accept explicitly.**
- [ ] **Mission-debrief carries**: the two portable products (#1, #2 above); the lateral-gap
      rule (#3); DD11's code-line unit (#4); the recon-second-instrument lesson (#2 in
      Recommendations). And the standing carries already in mission Known Issues: the DD7
      blur gap is **reachable** (V7 refuted F7's ruling on measured evidence — WSLg *does*
      deliver OS blur to a real stimulus); the HTML5-drag candidate-2 spike (the only
      transport that needs no app coordinates, foreclosed by omission and **never
      measured** — and it has its own unmeasured premise, cross-`BaseWindow` DnD delivery,
      so the flight's thesis applies to its own escape route); 28-of-48 header drift → F10;
      `getAttachedWindow`/`crossWindow` retirement now unblocked (DD13's coupling has V7's
      verdict).
- [ ] **Fix the `tab-drag-invariants.test.js` `CALL_RE` comment**: it says the naive grep
      reads *nine* (7 calls + definition + one prose mention); measured **10** (two prose
      mentions), and the flight log's own audit says 10. The assertion is correct (7,
      masked); only the comment is wrong — a measured count stated as measured, wrong, in
      the test whose subject is that naive counts over-read.
- [ ] Leg 3's ACs were all unticked at `landed`; leg 5's Developer applied a stated tick
      discipline at flight-end (7 ticked, runtime ACs left open with pointers). Confirm the
      leg files match their logs before the mission debrief reads them.
