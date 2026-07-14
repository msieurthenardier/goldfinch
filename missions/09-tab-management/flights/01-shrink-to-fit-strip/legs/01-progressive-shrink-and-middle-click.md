# Leg: progressive-shrink-and-middle-click

**Status**: completed
**Flight**: [Shrink-to-Fit Tab Strip](../flight.md)

## Objective

Implement Chrome-style progressive tab shrink (container-query staged
disclosure, no scrollbar at any count, active tab keeps its close button) plus
middle-click tab close, and evolve the `responsive-tab-strip` behavior spec to
pin the new contract with numeric-read apparatus.

## Context

- Flight DD1: disclosure is CSS container queries on `.tab`
  (`container-type: inline-size`), zero JS. `.tab`'s width is flex-driven
  (`flex: 0 1 240px` + explicit `width`), so the children-can't-size-container
  rule is satisfied; `freezeTabWidths()` pins inline `flex: 0 0 <px>` which a
  container query keys off equally well.
- Flight DD2: `#tabs` goes `overflow-x: auto` → `overflow: hidden`; `.tab`
  loses `min-width: 88px` entirely. No hard floor — a floor would clip tabs
  at extreme counts, breaking the no-scrollbar/no-clip invariant. The old
  spec's Step 4 (scroll-onset) is REPLACED by a positive no-scroll/no-clip
  assertion at a pathological count.
- Flight DD3: middle-click close rides the existing pointer-close path
  (`freezeTabWidths()` + `closeTab(id)`), via `auxclick` filtered to
  `e.button === 1`, with `preventDefault()`.
- Flight DD4/DD5: the spec evolution adopts admin-tier
  `evaluate(chromeWcId, …)` numeric geometry reads as first-class observable
  (`captureWindow` demotes to visual/fallback), adds the fixture-distinctness
  probe, and notes the keyboard-operability interaction (close buttons always
  present at comfortable widths; hidden only under pressure on inactive tabs).
- Apparatus fact (verified in code): the MCP `click` tool forwards a `button`
  option (`'middle'` supported by the engine's `mouseClickEvents`), so
  middle-click is drivable as trusted input in the spec.
- The chrome renderer is an ES module; the tab button wiring lives inside
  `createTab` (`src/renderer/renderer.js` ~956-984). The strip CSS lives in
  `src/renderer/styles.css` (`#tabs` ~153-159, `#tabstrip-drag` ~163-165,
  `.tab` family ~198-247).

## Inputs

- Clean working tree on branch `flight/1-shrink-to-fit-strip`.
- `src/renderer/styles.css` with the current `#tabs`/`.tab` rules
  (`overflow-x: auto`, `min-width: 88px`, `scrollbar-width: thin`).
- `src/renderer/renderer.js` with the tab click handler and
  `freezeTabWidths`/`releaseTabWidths`.
- `tests/behavior/responsive-tab-strip.md` (current, screenshot-primary).
- `BACKLOG.md` with the "Tab strip: Chrome-style shrink, no scrollbar" entry.

## Outputs

- `src/renderer/styles.css` — container-query staged shrink, overflow hidden,
  floor removed, stale comments rewritten, dead `scrollbar-width` removed.
- `src/renderer/renderer.js` — `auxclick` middle-click close handler.
- `tests/behavior/responsive-tab-strip.md` — evolved spec (numeric reads,
  replaced Step 4, middle-click step, fixture-distinctness probe,
  WSLg-distortion fallback note).
- `BACKLOG.md` — shrink-to-fit entry retired (moved to a "done" disposition or
  deleted with a pointer to this flight, matching how prior entries retire).

## Acceptance Criteria

- [x] `#tabs` has `overflow: hidden` (no `overflow-x: auto`, no
      `scrollbar-width`); `.tab` has no `min-width` floor; `.tab` is an
      inline-size query container.
- [x] Staged disclosure via `@container` rules: as a tab narrows, the title
      collapses, then the close button hides on **inactive** tabs, then
      padding compresses to a sliver stage; `.tab.active .tab-close` remains
      displayed at every stage. Exact thresholds are the implementer's call,
      recorded in the flight log. (Thresholds: title-hide `<=72px`,
      inactive-close-hide `<=56px`, padding-compress `<=40px` — literal
      rendered widths; see flight-log Decisions/Anomalies for why the
      compress stage needed an inner `.tab-row` wrapper.)
- [x] The jar dot and active-tab top-bar cue remain visible at the sliver
      stage (jar identity + active state stay distinguishable).
- [x] Middle-click (`auxclick`, `e.button === 1`, `preventDefault()`) on a tab
      closes it through `freezeTabWidths()` + `closeTab(id)` — identical
      deferred-reflow semantics to the ✕ path; other `auxclick` buttons no-op.
- [x] Live render spot-check (dev launch): with ~15 and ~60 tabs, no
      scrollbar/clip appears, disclosure stages render, active tab keeps ✕
      — screenshot(s) captured for the flight log. (DD1 premise check: if
      `@container` display flips misrender in the chrome view, STOP and
      divert per the flight's adaptation criteria.) — premise held (DOM and
      pixels agreed throughout); a real overflow bug was found and fixed
      during the spot-check, see flight-log Anomalies (not a premise
      failure of container queries as a mechanism).
- [x] `tests/behavior/responsive-tab-strip.md` evolved per DD4/DD5: numeric
      `evaluate` reads first-class (widths, `scrollWidth` vs `clientWidth`),
      old Step 4 replaced by the pathological-count no-scroll/no-clip
      assertion, a middle-click close step added (trusted `button: 'middle'`
      click), fixture-distinctness probe added, screenshot fallback retained.
- [x] `npm test`, `npm run lint`, `npm run typecheck` all green.
- [x] BACKLOG entry retired; flight log updated with a leg entry (including
      chosen thresholds and spot-check evidence note).

## Verification Steps

- `grep -n "overflow" src/renderer/styles.css` — `#tabs` shows `hidden`;
  `grep -n "min-width" …` — no `.tab` floor; `grep -n "scrollbar-width" …` —
  0 hits.
- `grep -n "container-type\|@container" src/renderer/styles.css` — container
  + staged rules present; active carve-out visible.
- `grep -n "auxclick" src/renderer/renderer.js` — handler present, button
  filter + preventDefault.
- Dev launch (`npm run dev:automation`), open many tabs (evaluate-driven
  `createTab` loop or repeated Ctrl+T via pressKey), observe stages +
  no-scrollbar; capture `captureWindow` screenshots at ~15 and ~60 tabs.
- `npm test && npm run lint && npm run typecheck`.
- Read the evolved spec end-to-end for internal consistency (apparatus
  section vs steps).

## Implementation Guidance

1. **CSS — `src/renderer/styles.css`**
   - `#tabs`: `overflow-x: auto` → `overflow: hidden`; delete
     `scrollbar-width: thin`; rewrite the trailing comment (the flex min-size
     yield mechanism survives — say "shrinks its tabs instead of scrolling").
   - `#tabstrip-drag`: rewrite the comment's "yields and scrolls" wording.
   - `.tab`: remove `min-width: 88px`; add `container-type: inline-size`;
     keep `overflow: hidden` (it is what keeps the automatic min-size at 0).
   - Add `@container` stages (suggested starting points, tune live):
     `(max-width: 110px)` hide `.tab-title`? — no: title *ellipsizes* first by
     existing CSS; hide it only when it can't show ~3 chars (~72px). Then
     `(max-width: 56px)` hide `.tab-close` on inactive tabs
     (`.tab:not(.active) .tab-close { display: none; }`), and
     `(max-width: 40px)` compress padding (e.g. `padding: 7px 4px`) and gap.
     Keep `.tab.active .tab-close` displayed unconditionally.
   - Mind selector scoping: `@container` rules match *descendants* of the
     query container; `.tab:not(.active) .tab-close` resolves against the
     button's own tab — correct as written.
2. **JS — `src/renderer/renderer.js`** (inside `createTab`, next to the
   existing click handler): add
   `btn.addEventListener('auxclick', (e) => { if (e.button !== 1) return;
   e.preventDefault(); if (tabs.size > 1) freezeTabWidths(); closeTab(id); })`
   — mirror the ✕ branch exactly (last-tab case: `closeTab` already handles
   replacing the final tab; the freeze guard matches the ✕ path).
3. **Spec — `tests/behavior/responsive-tab-strip.md`**: keep the Witnessed
   structure and Step 1 probe/Step 7 maximize/Step 8 keyboard-close bones;
   apparatus section gains the numeric-read rule (admin `evaluate` on the
   chrome `wcId`: read `#tabs.scrollWidth/clientWidth`, per-tab
   `getBoundingClientRect().width`, close-button visibility via
   `getComputedStyle`), demotes screenshots to rendered-truth spot checks +
   WSLg fallback; steps updated per the acceptance criterion above. Note the
   `Last Run` field stays as-is until the verify leg runs it.
4. **BACKLOG** — retire the entry the way this repo retires done entries
   (check how prior completed entries were handled; if no precedent, replace
   the body with a one-line "landed in M09 Flight 1" pointer).
5. **Docs** — CLAUDE.md needs no edit (design review confirmed it never
   states the 88px floor / overflow-x). Do not touch guest-view code paths.

## Edge Cases

- **Single tab**: `flex: 0 1 240px` + `max-width: 240px` keeps one tab at
  240px — unchanged; no disclosure stage engages.
- **Frozen widths during close bursts**: container queries respond to the
  frozen inline width — stages must not flicker during a freeze (they key
  off the same resolved size; no special handling).
- **Middle-click on the ✕ button itself**: lands in the same `auxclick`
  handler (target inside the tab) — closes the tab; acceptable and
  Chrome-consistent.
- **Middle-click on the last remaining tab**: `closeTab` path already
  replaces it with a fresh tab (existing behavior; `tabs.size > 1` freeze
  guard mirrors ✕).
- **Internal tabs**: no jar dot exists (internal pseudo-jar renders no dot) —
  the sliver stage must still show *something* distinguishing; the
  active-tab accent bar + favicon cover it. No special-case CSS.

## Files Affected

- `src/renderer/styles.css` — strip/tab rules + container stages
- `src/renderer/renderer.js` — auxclick handler (~6 lines)
- `tests/behavior/responsive-tab-strip.md` — spec evolution
- `BACKLOG.md` — entry retirement
- `missions/09-tab-management/flights/01-shrink-to-fit-strip/flight-log.md` —
  leg entry

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]`** (batch mode:
commit happens at flight end, not per leg):

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed` (in this file's header)
- [x] Do NOT commit — the flight commits once after review
