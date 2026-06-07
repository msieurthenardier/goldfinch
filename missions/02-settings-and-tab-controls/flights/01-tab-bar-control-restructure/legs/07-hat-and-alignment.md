# Leg: hat-and-alignment

**Status**: completed
**Flight**: [Tab-Bar Control Restructure](../flight.md)

## Objective
Guided human-acceptance-test session: tune the pill, frameless chrome, tab sizing, and window
controls live with the operator on the running app until the look/feel is signed off — feeding any
fixes back as renderer changes before the behavior tests run.

## Context
- Optional interactive leg, run inline at the start of `verify-integration` against the live app on
  `:9222`. The Flight Director measured each change via raw CDP (eval + `Page.captureScreenshot`)
  and iterated with the operator. All changes are renderer-only (HTML/CSS/JS); committed in the
  flight-level verify commit.

## Changes Applied (operator-signed-off)

1. **Pill repositioned to hug the right of the tabs** (leg-1 framing pivot). Leg 1 placed the pill
   *leading* the strip; the operator clarified it should sit **immediately to the right of the open
   tabs** (the better reading of SC1's "adjacent to the open tabs"). Reordered `#tabstrip` to
   `[#tabs][#newtab-pill][#tabstrip-drag][#window-controls]`; container menu re-anchored under the
   pill's now-movable position dynamically. (Pivot recorded in flight-log Deviations.)
2. **Window controls flush to the top-right corner + guaranteed drag holder.** Zeroed `#tabstrip`
   right padding so the controls reach the corner; `#window-controls` sizes to content (no fixed
   width); added `#tabstrip-drag { flex:1; min-width:56px }` so a draggable grab region always
   exists between the pill and the controls, even with many tabs. (Root cause of the original
   right-gap: `.icon-btn{width:32px}` overrode `.win-ctrl{width:46px}`; fixed via
   `#window-controls .win-ctrl{width:46px}` specificity.)
3. **Muted-gold frameless window border.** Added `--accent-muted: #7a6a1f` and a `1px solid` border
   on `body` scoped to `html:not(.platform-darwin)` (mac keeps native rounded chrome) so the
   frameless window's edges read against the desktop.
4. **Chrome-matched default tab width (240px).** `.tab` gained `width: 240px` (alongside
   `flex:0 1 240px`, `min-width:88px`, `max-width:240px`) — without an explicit width the
   `overflow:hidden` tabs collapsed to their text width (~110px). Few tabs now sit at 240px (Chrome's
   max), shrinking toward the 88px floor as more open, then `#tabs` scrolls.
5. **Crisp, font-independent CSS-drawn window-control icons.** Replaced the ambiguous text glyphs
   (the `□` maximize read as a broken glyph) with pseudo-element-drawn icons (minimize line,
   hollow-square maximize, two-square restore keyed off `data-state`, X close) using `currentColor`
   — identical on Linux and the forthcoming Windows build. `setMaximized` no longer sets
   `textContent` (it would clobber the CSS icon); it keeps `data-state`/`aria-label`/`title`.

All offline gates stayed green across each change (147 tests / 0 typecheck / 0 lint / prettier).
As-built layout verified via CDP: tabs 240px (few) → 88px floor + scroll (many); pill hug-gap = the
4px strip gap; controls flush (0px right gap); drag holder ≥56px; focus ring + icons confirmed by
screenshot.

## Acceptance Criteria
- [x] Pill hugs the right of the tabs; container menu anchors to it.
- [x] Window controls flush right; a guaranteed draggable region sits between pill and controls.
- [x] Frameless window has a visible (muted-gold) border on Windows/Linux.
- [x] Default tab width matches Chrome (~240px); shrink-then-scroll preserved.
- [x] Window-control icons are crisp and font-independent; maximize/restore states are distinct.
- [x] Operator signed off on the look/feel; offline gates green.

## Files Affected
- `src/renderer/index.html`, `src/renderer/styles.css`, `src/renderer/renderer.js` (renderer-only).

---

## Post-Completion Checklist
- [x] All HAT changes applied + measured live
- [x] Offline gates green
- [x] Operator sign-off
- [x] Changes committed in the flight-level verify commit
- [x] The leg-1 pill-placement pivot recorded in the flight-log Deviations
