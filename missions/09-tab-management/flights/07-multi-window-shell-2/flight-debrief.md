# Flight Debrief: Multi-Window Shell, Part 2

**Date**: 2026-07-15
**Flight**: [Multi-Window Shell, Part 2](flight.md)
**Status**: landed
**Duration**: 2026-07-15 (design → 4 legs → 6 Witnessed runs → land)
**Legs Completed**: 4 of 4

## Outcome Assessment

### Objectives Achieved

Every interim F6 shipped is retired. The find overlay and menu sheet are true
per-window instances — `find-overlay-manager.js` extracted from ~224 lines of raw
module state, both overlays on the registry record, the cross-window attachment
machinery **deleted rather than extended**, and destruction relocated into the
per-window `close` handler. The automation surface has deliberate multi-window
semantics: `enumerateWindows` as a single discovery primitive, an all-windows
`enumerateTabs` carrying `windowId`, `windowId` params, an identity-bound capture
picker, a schema pin.

**And two live defects in shipped F6 code were found and fixed — in no source
artifact, by recon**: cross-window `activateTab` silently no-op'd (acts on another
window's tab hit an unraised background guest and **reported success**), and five
unguarded `capturePage` awaits could wedge a request forever.

`multi-window-automation` PASS 9/9 (promoted). Leg 1's invariant proven by an
exposure triple, specs unmodified: `menu-overlay` 6/6 (guest viewport
**byte-identical**, maxdelta 0), `find-overlay-geometry` 8/8, `menu-dismissal`
9/9. 1833/1833, lint, typecheck, a11y green. Landed `b2d3afc` (61 files,
+10613/-872); PR #90.

### Mission Criteria Advanced

- Per-window surfaces never cross-talk — **two sheets visible simultaneously in
  two windows with distinct wcIds, confirmed on pixels**. F6's roaming singleton
  could not express this by construction.
- Multi-window automation semantics decided deliberately: the six decisions the
  F6 audit enumerated all land here.

## What Went Well

**Every one of DD1-DD9 survived; five were materially revised — and not one
revision came from the FD re-reading its own work.** Every one came from a review
pass or a leg re-deriving against code. That is the governance signal of this
flight.

**DD2 is the flight's best decision.** One op discharges four of six owed
decisions, retires the probe walk for 11 specs, supplies the `windowId` vocabulary
DD1/DD3 need — and provides the `booted` signal **that is what let DD1 drop its
marker**. Zero-new-state is *provable*, not asserted, because `window-census.js`
is pure and unit-tested.

**DD8 is the best decision-making moment, and the most transferable.** The flight
posed a binary — positive form (needs scope resolution, infeasible) vs negative
form (aliasing-defeated). Both bad. Leg 1 **refused the binary and changed the
axis**: from *detect the bad read* to *ban the registration shape that permits
it*. Tier 1 is stronger than both, because a registration shape cannot be evaded
by aliasing, and it **forces** the wrapper. Note what this is: **F6's own "make
the class unrepresentable" lesson applied one level up from where F6 applied it**,
by a leg, unprompted. F6 made the bad read unrepresentable; leg 1 made *not using
the wrapper* unrepresentable.

**DD5's relocation: three review layers each caught a real defect in one
decision.** Pass 1 — the original design leaked **two views per closed window
forever**, the exact class F6 had just fixed. Pass 2 — ruled the mechanism (`close`
not `closed`; `before-quit` keeps no role or it double-destroys; above the `!rec`
early-return). Leg 1's own review — the `close`→`closed` **gap**, where a late IPC
would reconstruct an orphaned view on a dying window. Each catch needed the
previous to exist.

**F6's "the debt lives where the tests can't go" was acted on, not restated.**
Four pure modules, **606 lines of logic living outside unit-test-exempt main.js**,
79 new unit tests. `capture-source-picker`'s test pins the decisive case as a
named contract: **a decoy that is the better size match loses to the identity
match** — the deleted heuristic's own failure mode covered by its replacement.

**Leg 2's smoke step 0 is the model for the whole project**: a positive control
run *before* the fix landed and unrecoverable afterward — `captureScreenshot` on a
detached view **hung at 20,000ms**, so step 8's bounded 3086ms named refusal is a
**measurement**, not an absence claim. Same action, same instrument, opposite
outcomes.

**Recon earned its keep twice**: two live F6 bugs no artifact knew about, and S8
(the sheet/find asymmetry) is what made leg 1 sizable at all. Notable:
`multi-window-shell` 9/9 **could not have caught S1** — it drives non-first windows
via chrome targets, and chrome classification skips activate. **A green spec over
a real bug.**

## What Could Be Improved

### Process

**Leg 4 was tiered MEDIUM and skipped design review — and it is where three of the
flight's instrument defects originated** (AC17's defeated pin, the `getHistory`
gate, the duplicated harmful caveat). The tiering rule keys on the blast radius of
the *code* a leg touches. **Leg 4's blast radius was the flight's entire
verification apparatus** — it authored the assertions by which everything else is
judged. That is high-risk in a dimension the rule does not measure.

> **New HIGH trigger: "this leg authors or rewrites the assertions that discharge
> the flight's Verification section."** A leg that writes the gates is not
> low-risk because it writes no product code.

**A deferral justified by another leg's future work must create an AC in that leg
at the moment of deferral — not a note.** Leg 1 deferred five specs to leg 4 on
the explicit reasoning "they are re-run at leg 4 anyway." Leg 4 **re-pointed but
never re-ran** them; the FD then asserted AC27 discharged **without checking**.
Leg 1's ruling was sound; its bookkeeping was a promise with no owner. **3 of the
5 have never run at all** — so "re-run" is a misnomer; their re-point has no
baseline to regress against.

**Three of the flight's errors were the FD's own, all the same shape**: the
`menu-dismissal` topic-name ruling (a spec selected on its title while its text
disclaimed the mechanism), the "nine DD7 tests" claim (1-of-9 on enumeration), and
AC27 asserted discharged. **The FD reasoned from a label rather than an artifact
three times, and the third would have shipped an untrue ticked box.**

### Technical

**main.js 3461 → 3517 (+56).** Having a number was **worth it, decisively** — and
the finding is that it was mis-**set**, not merely missed. The case: **the number
changed behavior.** Leg 3 extracted two pure modules explicitly to "buy back lines
against a blown target the honest way." **Without the target there is no pressure
to extract, and ~170 lines of census + picker logic land in main.js where no unit
test can reach them.** The target did not control the file's *size* — it controlled
its *shape*. It also produced an attributable breakdown (leg 1 −69, leg 2 +77, leg
3 +48, leg 4 0), and leg 2's overage was **refused absorption**, which is what
keeps the inheritance honest.

But it was set as a single flight-net (hold flat) that the flight's own scope made
unreachable at design time — leg 2's raise idiom and leg 3's op wiring were scoped
*before* the target was written. Nothing could be judged until it was already
blown.

> **Carry: a flight-net line target with no per-leg budget is unactionable by
> construction. Set it per leg or don't set one.** F6's failure was having no
> number; F7's was having one nobody could steer by until it was gone.

**DD9 held and immediately proved insufficient in the way that mattered.** It pins
`inputSchema` and the tally — but `listTools` also projects **`description`**, and
nothing guarded it, so both DD3 descriptions asserted the **old** contract while
all 30 tools, every schema, and every count stayed green. **A description is what
an agentic consumer reads to decide how to call a tool**; a client could have
picked `readDom` as a raise primitive and silently gotten no raise — the exact
hazard DD6 retired. Leg 4's fix is the flight's best permanent artifact: the pin
ships as a **pair**, so the raise half is the no-raise half's **same-run positive
control**.

### Verification

**`multi-window-shell` filed `partial`, not pass** — product green on every row,
but two spec-instrument errata survived leg 4's rewrite and were folded *after* the
run, so **the spec has never run clean as written**. Owed at F8.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|---|---|---|
| Leg 1's AC13 scoped to an exposure triple, not all 8 specs | F6 leg-2 precedent; the other 5 re-run at leg 4 anyway | **No** — the deferral rolled twice and landed unowned (AC27) |
| DD3 corrected mid-flight (wire shape unchanged) | Not implementable as written — positional consumption | Yes — the correction is the design |
| Leg 4 broke its own `src/` byte-unchanged pin (AC23) | Fixed a real consumer-facing product defect | Yes — a live defect outranks a scope pin, **when declared** |
| `getAttachedWindow` retirement deferred to maintenance | FD's premise wrong at 1-of-9; `attachment` is live | Yes — a well-formed, sized deferral |
| The DD7 blur gap accepted as permanent | Unreachable by any single-window test; WSLg has no OS blur, and it's the only desktop | Yes — better than a HAT ticket with no venue |

## Key Learnings

### The count errors and the instrument errors are ONE class with ONE fix

The flight recorded 13 instances of what it called a count/citation pattern, and
proposed: *"a boundary or count quoted from memory, from prose, or from another
artifact's range is wrong at a measured rate; print it and read it."*

**That diagnosis covers 5 of 13 — and it is itself an instance of the pattern**: a
total generalized from the salient subset (counts) instead of read off the
enumeration. It fails outright where it matters most: the recon *ran* the tool and
ran the **wrong query**; `observe.js` — the repo's canonical Electron-free
exemplar — **fails** the "is this Electron-free" grep, so reading harder gives the
*wrong* answer; `getHistory` involved no quote at all (**a name was trusted instead
of a signature read**); AC17's control was written *and run* and tested the fixture
rather than the token; `menu-dismissal`'s citations were **true when written** and
the act of annotating moved them.

**The actual root cause:**

> **A claim was asserted about a property while only a *proxy* for that property
> was consulted, and the proxy's fidelity was assumed rather than tested.**

Every instance is a proxy substitution: a prose total for the enumeration; a line
number for the code; a citation for the artifact's *current* content; an op's
**name** for its signature; a URL matcher for "probes for the sheet"; a synthetic
fixture for the real artifact; a **plan** ("leg 4 will re-run them") for a run log
on disk; an exit code for "all six states ran"; a return **type** for the
consumer's **parse**. "Quoted from memory" is one proxy among many — the most
frequent, which is why it captured the diagnosis.

### The generalization that unifies both patterns

> **An assertion is evidence only if its instrument has been shown to vary with
> the property asserted — on the real artifact, in the same run, in both
> directions.**

Every failure had discrimination of zero or unverified: the AX `focused` node
reads identically whether focus was restored or not; the naive grep reads 1 on the
Electron-**free** exemplar; `JSON.stringify` makes the array-own-property claim
**structurally** unfalsifiable; the `getHistory` gate refuses **identically whether
or not the defect occurred**. **A prose total "eight" reads "eight" whether there
are 8 or 9, and a line number reads `:2699` wherever the code moves** — that is the
degenerate case, discrimination exactly zero, which is why it is the same class.

Every success **demonstrated** discrimination: `document.hasFocus()` varying
T1→T2; the masked grep (`observe.js`→0, `engine.js`→1); AC17's mutation table
(86 → 85+1 → 86); leg 2's step 0 vs step 8; row 7 as row 8's same-run control;
DD8's lint firing at `974:38` on the injected violation and **silent on the correct
wrapper**.

**"Both directions" is the half the flight only learned at the end.** A positive
control alone doesn't establish the token discriminates *this* artifact — that's
AC17's lesson. A mutation alone doesn't prove the instrument isn't stuck-on-fail.

### Enumeration doesn't prevent error — it makes error survivable

The flight's claim that "the one artifact that never erred is the one that
enumerated" is **false, and the truth is a better lesson.** DD6's table *did* err —
three labels wrong, and a `getChromeForTab` citation stale onto **a
different-but-plausible function that would have type-checked at the call site**.

What it got right was **arity**: nine rows for nine sites, while the prose said
"eight" three times inches away.

> **Enumeration preserves arity even when it corrupts content — and arity is what
> a downstream re-derivation needs.** A prose total "eight" has no slot for the
> ninth site; it is unrecoverable. A nine-row table has a slot with a wrong label
> in it, and every ruling survived re-derivation.

### A lesson applied as a checklist step travels; a lesson recorded as prose does not

Run 1 of `multi-window-automation` recorded the serialization lesson as prose → it
was applied to step 2 and **not to step 1, the very next absence assertion in the
same spec**. The Executor who carried it as a **pre-flight sweep** applied it to a
*different* spec and caught the `getHistory` gate.

**The proof that prose carries nothing is in the tree**: leg 2's **AC7 is checked
`[x]` while its own command fails** — `grep -c "require('electron')"
capture-timeout.js` → **1**, because the implementer wrote the earned comment that
the same artifact demanded 320 lines away. Legs 3 and 4 both root-cause this exact
class and both cite `observe.js` as the decisive control, while AC7 sits green two
legs behind them, still failing. And "four grep-ACs failed" is asserted twice and
**never enumerated** — AC7 is the missing fourth.

## Recommendations

1. **Put the discrimination proof in the AC template.** Not "ship a control" — too
   vague; leg 3 shipped one and `&&` **silently swallowed it** (`grep -c` exits 1
   on zero, so a *correct* control broke the chain and the positive control never
   ran). An AC asserting a state must record **two numbers in the log**: the
   instrument's reading on the real artifact when the property holds, and when it
   is **mutated** to not hold. Equal numbers, or an unrun mutation ⇒ **the AC is
   not discharged.** Leg 4's mutation table (86 / 85+1 / 86) is the template.
2. **Add to the premise-audit checklist: "what serialization sits between the
   property and the instrument?"** `JSON.stringify` drops array own-properties,
   `undefined`, functions, and Symbol keys — a whole class of assertions dies
   silently crossing it, and it is knowable at authoring time.
3. **Never assert an op's behavior from its name — print the signature.**
   `getHistory` cost the flight its marquee gate: a gate ordered *specifically to
   make a silent failure loud*, written against an op nobody read.
4. **Land DD1's F8 constraint as code, not prose — before F8 starts.** See below.
   The flight derived *"pin constraints to code identity, never a line number"* and
   **did not apply it to the one constraint it named as F8's critical
   inheritance.**
5. **Mission-debrief carries**: the new HIGH trigger (a leg that authors the
   flight's assertions); per-leg line budgets instead of flight-net targets;
   deferrals must create an AC in the target leg; and **commit hygiene** — the
   commit-once pattern makes `git commit -a`/`git add -u` **actively dangerous**
   (it would have silently dropped **four product source files** here), and nothing
   in the workflow says so.

## Action Items

- [ ] **BEFORE F8**: land a comment at `main.js:2756-2757` naming the
      synchronous-delete/set invariant, **and a test that fails if the handler
      becomes async**. DD1's "duplicates are structurally impossible" rests
      entirely on that adjacency; **four recorded line numbers for it are all
      wrong**, the pair moved a **fourth** time inside leg 3 (after leg 3 warned it
      had moved twice — *the artifact warning that the pin drifts drifted, in the
      act of warning*), `main.js` carries **no warning at the site**, and **no test
      pins the handler's synchrony**. F8's implementer reading the code sees
      nothing.
- [ ] **Fix leg 2's AC7** — checked green, command fails (`grep -c
      "require('electron')" src/main/capture-timeout.js` → 1, matching its own
      header comment). Apply comment-masking; a live instance of the class two
      later legs root-caused.
- [ ] **F8 owns AC27**: the five re-pointed specs (`kebab-menu`,
      `internal-tab-menus`, `page-context-menu`, `tab-context-menu`,
      `tab-surface-geometry`) — **3 have never run at all.**
- [ ] **F8 owns** the clean re-run of the folded `multi-window-shell`.
- [ ] **F8**: check whether cross-window drag makes the **DD7 blur gap
      rig-reachable** (it's the first flight with a real two-window open handoff) —
      don't inherit the accepted-gap ruling blind.
- [ ] **F8/maintenance**: `renderer.js:250-251` says the kebab has "four items";
      `kebabModel` at `:385-392` has **six**. The count pattern's only instance in
      **product source**.
- [ ] **F9**: must NOT `preventDefault` on `close` without re-homing overlay
      destruction (DD5's named residual). Poll `enumerateWindows().booted` at
      restore — it was designed for exactly this.
- [ ] **Maintenance**: the `getAttachedWindow`/`crossWindow` retirement (sized,
      owner named); main.js at 3517 with a per-leg budget.
- [ ] Leg 2's artifact ends with a **leaked tool-call wrapper** (`</content>`
      `</invoke>`), committed. Cosmetic; scrub.
