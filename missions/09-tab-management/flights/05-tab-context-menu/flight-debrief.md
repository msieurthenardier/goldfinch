# Flight Debrief: Tab Context Menu

**Date**: 2026-07-14
**Flight**: [Tab Context Menu](flight.md)
**Status**: landed
**Duration**: 2026-07-14 (single session; two legs → one doc-fix review cycle → land)
**Legs Completed**: 2 of 2

## Outcome Assessment

### Objectives Achieved

Every tab has a context menu rendered from the menu-overlay sheet: Close /
Close other tabs / Close tabs to the right / Duplicate / Reopen closed tab,
anchored at the tab, omitted-only per the model rules. Duplicate carries
address + jar + full navigation history (the F4 restore seam, inserted
beside the source); reopen reuses F4's dispatch chain verbatim — the
mid-strip positional-reopen assertion F4 couldn't make was made here
(Witnessed step 8). The `tab-context-menu` spec passed **10/10 on its first
run** — the mission's fifth first-run-passing Witnessed spec. PR #88
(stacked #84←#85←#86←#87←#88).

### Mission Criteria Advanced

- SC5 (reopen) — **menu half completed** (F4's DD3 deferral closed); the
  criterion is now fully behavior-test-backed across both halves.
- Tab-context-menu criterion — advanced to all-but "move to new window",
  which lands with the multi-window flights per the criterion's own note.

## What Went Well

- **Pattern-reuse density**: the flight was almost entirely pre-adjudicated
  reuse (page-context-model sibling, TOCTOU capture discipline, ordered-sweep
  idiom, toolbar-pin double-fire gate, F4 dispatch chain). Zero product
  defects; the flight-end review's only fix cycle was documentation.
- **Every DD2 embedded ruling was load-bearing, with in-tree counterfactual
  proof** (Architect): the ordered-sweep ruling guards the codebase's
  twice-fixed flicker class (`closeTab`'s fallback would cascade mid-sweep);
  the catch-all gate prevents a deterministic wrong-menu on every keyboard
  invocation; MENU_LABELS was the one defect class ONLY design review stood
  in front of (axe passes on the raw-string fallback); dispatch reuse
  carried F4's jar-fallback + positional logic free — step 8 passed first
  try because of it. Fifth consecutive flight of evidence for the
  embedded-rulings pattern.
- **The scratch-profile convention worked on first application** (the F4
  carry): `XDG_CONFIG_HOME` at an empty per-run dir made the empty-stack
  omission precondition provable — no mid-run ruling, unlike F4.
- **The doc grep-AC rule worked as designed on first application**: the
  README/CLAUDE.md content the flight ADDED was present at review. What
  drifted was a different class (see below).
- **LOW risk-tier call vindicated** (Architect): the flight-level review had
  already spent the budget at leg resolution — DD2 embeds five rulings with
  file-and-line integration points — so the legs inherited pre-adjudicated
  design. Neither miss (count drift, stale-resolve guard) reaches the cost
  of two per-leg review gates.

## What Could Be Improved

### Process

- **Count/enumeration staleness is a distinct doc-drift class that grep-ACs
  structurally cannot catch.** Third consecutive flight where the flight-end
  audit caught drift — but this time the drift was in EXISTING enumerations
  the flight's changes invalidated (CLAUDE.md "18-entry" seam, "five sheet
  states"), not missing content. Grep-ACs detect absence; counts need their
  own mechanism. **Candidate fix**: pin doc counts to code the way
  `SEAM_COUNT` pins the seam (a tiny doc-lint asserting CLAUDE.md's numbers
  against the source arrays), or a leg-design question "which existing doc
  enumerations does this leg invalidate?". Tooling beats more review gates
  for a recurring mechanical class — mission-debrief carry.
- **Deviations-section discipline** (Architect): two improving mechanism
  substitutions were misfiled. The keyboard-target ruling
  (`activeElement.closest('.tab')`) was superseded by a structurally better
  single-listener mechanism (Chromium fires native `contextmenu` at the
  focused element — the divergence becomes impossible, not merely avoided),
  and DD4's keyboard-trigger verification was scoped down to
  structural + HAT (KEY_MAP gap). Both are documented — in the Triggers
  paragraph and the Anomalies/checkpoint notes — but "Deviations: None" is
  wrong on the letter. Reserve "None" for flights where the letter of the
  DDs was built; improvements are deviations too.

### Technical

- **The async-opener shape is new debt, named**: `openTabContextMenu` is the
  only sheet opener that awaits an invoke (`closedTabStackSize()`) before
  channel-1. Its supersede guard (`tabCtx.tabId !== id`) misses cross-type
  supersession (Reviewer issue 6, accepted, harmless — one local IPC
  round-trip, dispatch TOCTOU makes consequences cosmetic). A sibling in the
  same class: duplicate's `sourceIndex` is computed pre-await, so `insertAt`
  can be stale by one slot. **F6 disposition** (Architect): either
  (a) generalize supersession chrome-side (monotonic open-generation across
  all menu types, checked before any deferred `openOverlayMenu`), or —
  preferred — (b) make the opener synchronous again by having main PUSH
  stack-size to a chrome cache, which multi-window wants anyway (the stack
  becomes a shared cross-window resource). (b) deletes the unique shape;
  (a) is a cheap belt.
- **renderer.js growth estimate missed 2×** (~60–80 est. vs ~153 net;
  file now 3768 lines, +505 across M09). main.js +26 (exactly the two
  invokes). The module-split watch item was breached on the flight before
  the split decision — the F6 agenda item is now mandatory with data behind
  it. The Architect proposes the organizing unit: the recurring per-menu
  cluster (overlayMenus entry + capture object + opener + audit hook +
  channel-6 case + MENU_LABELS entry) as one module-per-menu or a registry
  record — which also collapses the two-file registration DD2 had to spell
  out as "named work".
- **Multi-window sheet questions pinned for F6 design** (decide, don't
  rediscover): the sheet is a lazy SINGLETON (manager tracks THE active
  guest and THE window's blur; probe-walk discovery and `SHEET_STATES`
  addressing assume one sheet) — per-window sheets need a window dimension
  everywhere; the overlayMenus/pageCtx/tabCtx module-singletons assume one
  chrome renderer per window — state as an F6 DD, not silently; "Move to new
  window" gives `tabContextModel` a window-count parameter and re-tests
  omitted-only against a case where Chrome parity (disabled) and the sheet's
  capability (no disabled shape) genuinely diverge; `tab-history-snapshot`'s
  null-semantics contract is stable API for move-to-new-window if
  re-parenting falls back to close-and-recreate.

### Verification

- **The literal Context-Menu-key/Shift+F10 press is the one shipped behavior
  no automated check exercises end-to-end** (KEY_MAP has neither key; live
  rejection probes captured as substitution evidence). Structurally verified
  (shipped toolbar-pin mechanism + unit-covered gate extension); HAT item.
  DD4 overpromised slightly — a leg-start apparatus check for the KEYBOARD
  premise, parallel to the right-click one, would have surfaced the gap at
  design time. Second motivating datapoint (after PgDn/PgUp) for the KEY_MAP
  extension BACKLOG item; once landed, the keyboard-trigger spec variant
  (incl. the double-fire dedupe assertion) is pre-sketched and ready.
- **Validator spec-quality notes carried**: positional assertions must key
  on `dataset.id`/wcId, never title/URL, when duplicates are in play (three
  tabs saw page5 this run); the exact-cardinality sweep end-states are the
  pattern that makes cascade failures structurally detectable — reuse it;
  Step 10's "reason: escape" phrase has no readable observable (causal
  Escape→hidden sequence carried it) — drop the phrase or expose a
  dismissal-reason attribute.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| Keyboard-target mechanism substituted: single native `contextmenu` listener covers both trigger paths (no `activeElement` resolution) | Chromium dispatches the same native event at the focused element; makes the focused/active divergence impossible rather than avoided | Yes — but FILE it as a deviation next time; "Deviations: None" reserved for letter-built DDs |
| DD4's keyboard-trigger verification scoped to structural + HAT | KEY_MAP lacks ContextMenu/F10 (apparatus, discovered leg 1) | Yes — add a leg-start keyboard-apparatus premise check alongside pointer ones |
| Anchor = element rect (not pointer coordinate) | One anchor idiom for every element-triggered menu (toolbar-Unpin parity) | Recorded in flight-log Decisions; fine |
| Duplicate uses source `container` directly (not `inheritContainerFrom`) | Inheritance chain carries page-opened-link rulings; Chrome parity is literal same-jar | Recorded in flight-log Decisions; fine |

## Key Learnings

1. **Test metrics**: 1646/1646, ~1.10 s wall-clock (two runs 0.2 ms apart),
   13 suites, zero skips, zero flakes — fifth consecutive zero-flake flight.
   +6 vs F4 (1640): fully attributed (6 new `tab-context-model` tests;
   seam-contract was a pin update, not a count change). Heavy suites
   (automation-mcp-server ~846 ms solo, downloads-store ~593 ms,
   history-store ~506 ms) untouched by this flight; timing flat.
2. **The review-tier economics compound**: a concrete flight-level review
   (five embedded rulings) bought two LOW legs, zero deviations-in-substance,
   and a first-run 10/10. The pattern is ready for its mission-debrief
   promotion with five flights of evidence.
3. **Async anywhere in a UI-open path is a design-review trigger**: DD3
   treated `closed-tab-stack-size` as "a tiny invoke feeding the model"
   without noticing it created the sheet's only async opener — which is
   where the flight's only accepted edge AND the spec's only special polling
   note both originated. One DD line ("model build awaits an invoke; define
   the supersede rule") would have pre-empted both.

## Recommendations

1. **F6 design (multi-window part 1)** must decide: per-window vs global
   closed-tab stack (F4 pin); stripIndex semantics; whole-window close
   capture; the module-split (mandatory agenda item — per-menu cluster as
   the organizing unit); sync-vs-async opener disposition (prefer push-cache
   (b)); per-window sheet singleton conversion; the one-chrome-per-window
   assumption as an explicit DD.
2. **Adopt a count-pinning doc-lint** (or the leg-design enumeration
   question) for the count/enumeration drift class — third occurrence;
   tooling, not more review.
3. **KEY_MAP extension** (BACKLOG, now two datapoints): add ContextMenu,
   F10, PageDown/PageUp; then activate the pre-sketched keyboard-trigger
   spec variant.
4. **Mission debrief carries**: embedded-rulings promotion (5 flights);
   grep-AC vs count-drift distinction; scratch-profile convention (proven
   first use); Deviations-section discipline; async-opener design-review
   trigger.

## Action Items

- [ ] F6 design: pinned multi-window decisions + module split + opener
      disposition + sheet singleton conversion (all listed above).
- [ ] Doc count-drift mechanism: count-pinning lint or leg-design question
      (owner: next flight design).
- [ ] HAT flight: literal ContextMenu/Shift+F10 press; mid-drag menu-open
      interaction; the accumulated HAT list.
- [ ] Mission debrief: methodology carries above.
