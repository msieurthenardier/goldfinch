# Flight Debrief: Default-Jar Semantics

**Date**: 2026-07-10
**Flight**: [Default-Jar Semantics](flight.md)
**Status**: landed
**Duration**: 2026-07-09 (design) → 2026-07-10 (landed) — two days
**Legs Completed**: 4 of 4 (01-renderer-default-routing, 02-main-retirement-sweep,
03-verify-integration, 04-hat-default-semantics)

## Outcome Assessment

### Objectives Achieved

The flight delivered its full charter: every remaining reserved-`default` assumption
is retired (renderer `DEFAULT_CONTAINER` + boot race, main's `PAGE_PARTITION`
pre-warm/spellcheck/privacy fallbacks, dev auto-mint hardcode, dot suppression), and
all partition-less tab creation routes through the live default flag — boot tab,
Ctrl+T, context-menu opens, automation `openTab` — with Burner-as-default yielding
fresh evaporating burner tabs and re-added jars auto-claiming the flag. The renderer
subscribes to `jars-changed` (open-tab dots and picker stay live across
rename/recolor/set-default with no restart), and the frozen `BURNER` constant is
consumed at all three duplication sites. Two commits (`3998888` legs 1-3, `b5894dc`
HAT fixes + landing), 30+11 files, suite 1132 → **1154**. Flight-level code review:
zero issues. First M06 behavior test (`new-tab-default-routing`) passed **7/7** on
its first run and is now an `active`, re-runnable regression gate.

The HAT leg (operator-requested) earned its place: it produced one pre-existing-bug
fix (guest-focus Ctrl+T forwarding), one operator semantics ruling implemented inline
(link-opens inherit the source tab's jar; burner sources mint a fresh burner, closing
a burner→persistent-jar leak), and the DD6 design decision confirmed by the operator
("Keep the dot on all tabs").

### Mission Criteria Advanced

- **Exactly one default at all times; new tabs open in the default jar** — routing
  half MET and live-proven (behavior test steps 1-4; HAT step 2-3); the flag-moving
  UI is Flight 3's.
- **Deleting the last persistent jar makes Burner the default; re-creation moves the
  flag back** — behavioral halves MET (behavior test steps 5-7; HAT step 4); the
  management-page surface is Flight 3's.
- **Rename/recolor propagates to open tabs and picker without restart** — plumbing
  MET and operator-witnessed (HAT step 3); user-drivable UI is Flight 3's.

## What Went Well

- **The verification leg caught the flight's one real defect again (D1), on its
  first real boot** — F1 and F2 are now two-for-two. DD8's hybrid `BURNER` resolution
  redeclared `const BURNER` in the shared lexical scope classic `<script>` tags share
  in one document: parse-time `SyntaxError`, all of container-menu.js dead, invisible
  to the `require()`-based runner by construction. Fixed minimally
  (`RESOLVED_BURNER`), and pinned with a genuinely reusable net —
  `test/unit/chrome-shared-scripts.test.js` parses index.html's own script list and
  replays it into one `vm` context, so the detector tracks drift automatically.
- **The review pipeline caught four HIGH defects before any code ran**: the DD3
  cross-IPC reference-identity crash (Architect cycle 1), the behavior-spec
  fixture-migration blast radius (cycles 1+2 + two leg reviews — see Improve), the
  picker `containers.push` duplicate (Leg 1 review), and the non-viable S4 apparatus
  route + a false grep AC (Leg 3 review).
- **First M06 behavior test, first run, 7/7** — live two-agent Witnessed run; the
  Validator independently confirmed the auto-claim causal clause with its own
  `jarsGetDefault()` read rather than inferring from routing. The spec is now a
  standing regression gate for Flights 3-5.
- **HAT as designed: reversible-on-real-profile, destructive-on-scratch.** The
  operator's real 12-jar profile was mutated only reversibly (rename A→B→A, flag
  X→Y→X, verified restored by post-restore reads); the delete/burner demo ran on a
  throwaway profile.
- **The pure-decision/impure-wrapper shared-module pattern proved out three times in
  one flight** (`resolveNewTabContainer`, `resolveAutoMintTarget`,
  `inheritContainerDecision`) — pure, dual-exported, truth-table-tested without
  DOM/Electron, stateful parts (the `burner-<n>` counter) kept caller-side.
- **Honest deferrals**: the window.open popup gap, the sibling-accelerator gap, and
  tabs-close-on-delete are all in mission.md Known Issues with exact file:line
  scoping already done — visible cross-flight, not buried in the log.

## What Could Be Improved

### Process

- **Recon scope was the flight's systematic miss (headline item).** The DD7
  fixture-migration surface took FOUR discovery passes to close: recon missed
  `automation-key-gating.md`; Architect cycle 1 caught it but wrongly cleared
  `mcp-jar-scoping.md`/`mcp-auth-gating.md`; cycle 2 corrected that; Leg 2's review
  found a sixth spec (`farbling-correctness.md`) everyone had missed. Root cause:
  the recon grep was `src/`-scoped from the start. **Standing fix: any
  hardcoded-constant retirement recons `tests/behavior/*.md` (and `test/`)
  alongside `src/` from the first grep.** (Also a methodology note for the
  mission-control flight skill's recon phase.)
- **Grep-to-zero ACs on ambiguous literals need pre-enumerated exemptions.** The
  `thumb.style.cursor = 'default'` CSS false positive was re-discovered five times.
  Convention: grep ACs on common literals enumerate known non-target hits in the
  spec text ("grep-to-N with exemptions"), not bare grep-to-zero.

### Technical

- **DD1 conflated "partition-less" with "context-less" — the one design gap a
  sharper pass could have caught (D3's root).** The mission's own Open Questions
  already asked "does the default flag govern anything beyond new-tab placement
  (e.g. external link opens)?" — and Flight 2's Open Questions never carried it.
  DD1 bucketed six call sites as one class because none passed a `jarId`, without
  asking which of them have a natural source jar (context-menu opens do; the new-tab
  button doesn't). The operator's HAT ruling settled it, but a design-time
  classification would have pre-empted one HAT round-trip. Future routing designs:
  classify each call site *context-less vs has-a-source-jar* before bucketing.
- **The classic-`<script>`-tag shared-global-scope architecture has now caused two
  real-boot-only defects in two flights** (F1 D1's cousin class; F2 D1). The vm
  regression net is reactive mitigation. Worth a maintenance-window conversation on
  ES-module migration for `src/shared/` before a third occurrence, as Flights 3-5
  will add more shared modules.
- **D2/D3 fixes have no automated regression protection** — both are real-boot-only
  (keyboard-focus/IPC interaction; live routing semantics), live-verified only. A
  future behavior-test spec covering guest-focus accelerators + link-open
  inheritance would convert manual assurance into a re-runnable gate.

### Documentation

- The "Electron-free injected-deps module" + "dual-export pure decision module"
  pattern write-up is now **two flights overdue** (F1 recommendation 4; F2 added
  three more exemplars without writing it up). Fold in the two real-boot defect
  classes (mkdirSync-before-synchronous-persist; script-tag shared-scope collision)
  as the "why real-boot verification is non-negotiable" rationale.

## Test Metrics

`npm test`: **1154 / 1154 pass, 0 fail, 0 skip, 0 flake**, ~5.04-5.07s across three
debrief-time runs (±25ms spread). Leg 3 ran the suite twice (flake check) and Leg 4
re-ran post-fix — zero flakes at every checkpoint.

**Trajectory**: M05 F9 1050 (~5.1s) → inter-mission 1065 → F1 1132 (~5.06s) →
**F2 1154** (+22: +10 routing/container-menu, +4 auto-mint truth table, +2
shared-scope net, +6 inheritance truth table). Wall-clock statistically flat vs F1
despite four new test files (two planned, two forced by D1/D3) — the
per-file-process-overhead model from F1's debrief continues to hold. Reliability
profile unchanged: zero flakes across three missions.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| D1 (Leg 3): `RESOLVED_BURNER` rename + vm shared-scope regression net | Classic `<script>` tags share one top-level lexical scope; `require()` tests can't see redeclaration collisions | Yes — the vm net now guards the whole class; any new shared `<script>` global gets checked automatically |
| D2 (HAT): `handleGuestNewTab` forwarding | Pre-existing guest-focus gap (bisect-confirmed on `d1e6be0`), not an F2 regression; only chrome-focus Ctrl+T ever worked | Partially — fix shipped for new-tab; the per-key hand-rolled forwarder pattern should become a single generalized chrome-class forwarder before more `handleGuest*` functions accumulate |
| D3 (HAT): link-opens inherit source tab's jar; burner sources mint fresh burners | Operator semantics ruling; DD1's partition-less bucketing discarded available source-jar context | Yes — inheritance is now the product stance for context-menu opens; the context-less vs source-jar classification is the design lesson |
| Leg 2: internal-session guard on all three privacy handlers | Design-review catch — privacy panel survives a switch to the internal tab; `privacy-clear-storage`'s new wc-resolution created fresh reachability | Yes — any handler resolving a session from renderer-supplied ids checks `__goldfinchInternal` |

## Key Learnings

1. **Real-boot verification legs are structurally irreplaceable** — three
   consecutive real defects across two flights (fs ENOENT, script-scope collision,
   focus-routing gap) were invisible to a green 1100+-test unit suite. Never lighten
   the verify-integration or HAT legs because "the suite is green."
2. **Constant-retirement blast radius lives outside `src/`** — behavior specs, docs,
   and fixtures encode retired constants as prose. Grep them at recon, not at review
   cycle four.
3. **HATs generate design input, not just acceptance** — D3 (a semantics ruling) and
   the DD6 confirmation both changed or locked product behavior in ways no agent
   could have decided alone.
4. **A surface property (no `jarId` argument) is not a semantics class** — DD1's
   lesson, generalized: enumerate call sites by what context they *have*, not by
   what arguments they *lack*.

## Recommendations

1. **Flight 3 design inputs (settled, carry as constraints)**: link-open inheritance
   is product stance; tabs-close-on-delete is a firm requirement (doubly
   runtime-observed — behavior-test Validator + operator); popup inheritance
   (main.js:1042 / chrome-preload.js:114 / renderer.js `onOpenTab` subscriber) and
   the generalized accelerator forwarder are pre-scoped candidates for Flight 3/5.
2. **Adopt the recon rule now**: hardcoded-constant retirement flights grep
   `tests/behavior/` + `test/` + `docs/` from the first pass. (Feedback also filed
   for the methodology's flight-skill recon phase.)
3. **Write the CLAUDE.md architecture note this mission** (two flights overdue):
   injected-deps + dual-export pure-module patterns, the two real-boot defect
   classes, and the grep-AC exemption convention.
4. **Author a behavior-test spec for the HAT-fixed surfaces** (guest-focus
   accelerators + link-open jar inheritance) at Flight 3 or 5 planning — converts
   the two live-only fixes into re-runnable gates. Extend
   `new-tab-default-routing.md` per its Validator's notes (explicit read actions in
   step 5; post-add `jarsGetDefault` assertion or a second-jar-no-claim step).
5. **Schedule the ES-module question for `src/shared/`** at the next routine
   maintenance: two real-boot script-scope defects in two flights is a trend, and
   Flights 3-5 add more shared modules.

## Action Items

- [ ] Flight 3 design: fold in Recommendation 1's settled inputs + firm requirement.
- [ ] Flight 3/5 planning: Recommendation 4's behavior-test spec + spec revisions.
- [ ] Next CLAUDE.md-touching flight: Recommendation 3 (pattern + defect-class note).
- [ ] Next routine maintenance: Recommendation 5 (ES-module conversation).
- [ ] Mission-control methodology: recon-phase grep-scope note (Recommendation 2).
