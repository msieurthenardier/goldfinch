# Flight Debrief: Closed-Tab Stack and Reopen

**Date**: 2026-07-14
**Flight**: [Closed-Tab Stack and Reopen](flight.md)
**Status**: landed
**Duration**: 2026-07-14 (single session; spike → three legs → doc fix
cycle → land)
**Legs Completed**: 3 of 3

## Outcome Assessment

### Objectives Achieved

The M05 reservation landed: `Ctrl+Shift+T` reopens the most recently closed
tab with address, cookie jar, back/forward history (restore() fidelity
spike-verified live), and original strip position, from all three capture
points. Burner and internal tabs are structurally never captured. The
`closed-tab-reopen` spec passed **9/9 on its first run** — including a
stronger-than-authored jar-fallback case (deleting the resolved DEFAULT
jar). PR #87 (stacked #84←#85←#86←#87).

### Mission Criteria Advanced

- SC5 (reopen) — **keyboard half fully advanced**, behavior-test-backed;
  the menu half is explicitly deferred to Flight 5 (DD3 recorded the split
  so the criterion isn't prematurely checked).

## What Went Well

- **The two-pass design review caught its most expensive error yet**: the
  draft DD2 wiring (main-constructs-renderer-adopts) had no codebase analog
  — a structural premise error that would have meant building a second,
  diverging tab-construction path. Third consecutive flight where the
  flight-level review caught a plausible-in-isolation architecture that
  fails against the actual call graph (F2 mcp-tools mislabel, F3
  address-replace premise, F4 this). The corrected DD2 then held VERBATIM
  through implementation — zero leg-time deviations across two legs
  touching shared surfaces.
- **Spike-first validated a second time** (applied per the F2 lesson:
  before leg 1): restore() full fidelity confirmed live before any module
  code; the divert path was never needed but the confidence was real.
- **Clean reuse discipline**: the jar-fallback resolution required ZERO new
  code (popups' `inheritFromPartition` chain); capture copied the
  history-recorder positive-allowlist idiom; the stack is entry-shape-
  agnostic (F6 can add windowId to captured entries without touching the
  module).
- **Most stable leg breakdown of the mission** — no leg split, merged, or
  resequenced.

## What Could Be Improved

### Process

- **The doc-drift class recurred despite the standing instruction** —
  second flight running the flight-end Reviewer (not the leg) is what kept
  README/CLAUDE.md current. The standing instruction works as a NET but
  doesn't prevent the gap opening. **Root cause named**: "documentation
  updated" lives as a flight-level checklist line, never as a per-leg AC on
  the leg that adds the user-facing surface. **Fix adopted going forward**:
  any leg adding a shortcut/menu-item/user-facing affordance carries a
  mechanical doc grep-AC (e.g. "`grep Ctrl+Shift+T README.md CLAUDE.md` →
  hits in both, or the leg is not done") — Developer-owned gate, not
  Reviewer-owned catch. Flight 5 applies this first.
- **Behavior-test scratch-profile launches should be standard apparatus**:
  the non-fresh dev profile forced a mid-run ruling even though three specs
  already carry the same fresh-profile precondition as prose. Promote to a
  documented `XDG_CONFIG_HOME=<scratch>` launch convention (AUTHORING.md /
  docs) — methodology carry.

### Technical

- **Accepted debt, named**: `tab-create`'s restore branch validates
  `restoreHistory` shallowly (Array.isArray only — no index-range or
  per-entry shape checks). Precedent-consistent and trust-domain-bounded
  today, but Flight 9's session restore reuses this exact seam — tighten
  there before widening the caller set.
- **main.js changed CHARACTER this flight**: +82 lines and its first new
  owned state beyond `tabViews` (the stack singleton). renderer.js is now
  3615 lines (F2's module-split watch item remains unactioned). F6's
  window-registry conversion — "comparable to the M05 migration" — lands on
  top of both. The split decision cannot keep deferring past F6 design.
- **Multi-window questions PINNED for F6 design** (decide, don't
  rediscover): per-window stacks vs one global stack with windowId
  (Chrome parity = per-window; architectural consistency with the other
  per-window conversions also says per-window — but it's a real decision);
  `stripIndex` semantics under multiple strips; whole-window close capture
  (N entries vs a window entry). The stack module itself is shape-agnostic
  — only main's capture site changes.
- **F9 pin**: session restore needs whole-strip ordered reconstruction, not
  eviction-worthy single entries — F9 decides whether it derives a new
  shape from the stack's primitives or extends the entry shape (and
  whether that flows back into toJSON/fromJSON).

### Verification

- **Mid-strip position preservation is under-discriminated** in the
  Witnessed run (every reopen landed last, where insertAt == append); the
  leg-2 live check covers it informally. Spec-polish: a mid-strip variant.
  Also carried: the Flight-5 menu item needs a `closedTabStack.size()`
  bridge for disabled-state rendering — the keyboard path never needed
  conditional UI, the menu does.

## Deviations and Lessons Learned

| Deviation | Reason | Standardize? |
|-----------|--------|--------------|
| DD2 wiring rewritten at design review (renderer-orchestrated chain) | Draft pattern-matched a plausible architecture instead of tracing the real construction path | Yes — standing review item: trace proposed construction paths against actual entry points |
| Non-fresh profile at the Witnessed run; ruled proceed | Dev profile carries state; fresh-seed precondition was prose, not apparatus | Yes — scratch-profile launch convention (methodology carry) |
| insertAt negative sentinel = append (not clamp-to-0) | Unknown-position captures must not teleport tabs to slot 0 | Yes — recorded in flight-log Decisions |

## Key Learnings

1. **Test metrics**: 1640/1640, ~1.1s, zero flakes. +18 vs F3 (1622): +13
   stack suite, +5 reservation pin flips — fully attributed.
2. **Four flights of evidence** for the embedded-rulings pattern: a
   line-level, code-path-specific flight design review lets legs tier LOW
   with zero quality loss (F4: zero deviations against DD2's four steps).
   Ready to promote to a named methodology rule at mission debrief.
3. **Doc-drift mechanism preference ordering** (mission-debrief carry):
   same-leg grep-AC (new, adopted) > flight-end standing audit (proven
   net, twice) > accumulated rider (one-time catch-up only).

## Recommendations

1. **Flight 5 (context menu)**: treat the `tabReopen()` contract as frozen;
   reuse the EXISTING dispatch case (not just the IPC — the chain has
   embedded decisions: negative sentinel, jarFallback announcement, title
   seeding); namespace menu ids `tab:*` per the page-context-model
   precedent; add a stack-size bridge for the disabled menu item; apply the
   doc grep-AC; consider whether the hand-mirror BACKLOG item should land
   alongside (F5 touches both classifier files again).
2. **F6 design inputs**: the pinned multi-window questions above; the
   renderer.js/main.js module-split decision as an explicit F6-design
   agenda item, not a watch item.
3. **Methodology carries** (mission debrief): two-pass design review as a
   standing gate; spike-before-leg-1 confirmed twice; doc grep-AC rule;
   scratch-profile apparatus convention.

## Action Items

- [ ] Flight 5 design: frozen-contract reuse; stack-size bridge; doc
      grep-AC; mid-strip reopen spec variant; hand-mirror timing decision.
- [ ] Flight 6 design: per-window-stack decision; module-split agenda item;
      whole-window capture semantics.
- [ ] Flight 9 design: restore-shape decision; tighten restoreHistory
      validation before widening callers.
- [ ] Mission debrief: methodology carries above.
