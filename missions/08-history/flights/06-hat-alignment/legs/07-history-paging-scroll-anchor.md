# Leg: history-paging-scroll-anchor

**Status**: completed
**Flight**: [HAT & Alignment](../flight.md)

## Objective

H9: when the operator pages the history list (numbered pager), anchor the
jar's tab strip / History-panel top back into view on the page change —
so navigating from a full 50-row page to a shorter page doesn't leave the
viewport scrolled far down with the tabs off-screen.

## Context & rulings

- HAT re-verification (Flight 6, Re-Step 3) surfaced H9: paging from a full
  page to a shorter page leaves the scroll position parked low, because the
  short page doesn't refill the viewport. Operator banked it as a follow-up,
  then (post-flight) ruled: **implement it — "anchor it so the tabs are at
  the top when paging."**
- Related same-conversation ruling (no code impact here, recorded for
  context): **clear-history correctly does NOT close tabs** — it is a
  granular data-class clear like cookies/storage/cache; the operator
  confirmed keep-as-is. Only Wipe/Delete close tabs (they already warn).
  That decision is unrelated to this leg's scroll change; noted so the leg
  isn't conflated with a clear-history behavior change.

## The seam (single primary surface — `jars-history-panel.js`)

- The numbered pager's `goToPage(page)` (`src/renderer/pages/jars-history-panel.js:335`)
  clamps the page, sets `currentPage`, and calls `refresh()`.
- **`refresh()` (`~:405`) is a SHARED funnel** — a page click, the initial
  fetch, the search-debounce fetch, an `onHistoryChanged` broadcast
  re-fetch, AND the page-overshoot self-correction re-fetch (`~:429`, when a
  delete shrinks the row count) all route through it. **The scroll-anchor
  must fire ONLY on a user-initiated page change**, never on the other four
  paths — a broadcast repaint or a search fetch that yanks the scroll would
  be a worse bug than H9.
- Therefore: do NOT scroll unconditionally inside `refresh()`. Carry a
  one-shot intent set by `goToPage` and consumed only on that fetch's
  successful, non-stale paint.

## Design

- Add a module-scoped one-shot flag (e.g. `let pendingScrollAnchor = false;`)
  in `createHistoryPanel`. `goToPage` sets it `true` right before calling
  `refresh()`.
- In `refresh()`'s success branch, AFTER the new rows are painted and the
  pager repainted (the non-search, non-stale path), if `pendingScrollAnchor`
  is set: clear it and scroll the anchor into view. Clear it on the
  early-return / stale-token / error paths too so a stale intent can't leak
  into a later background repaint (safest: reset `pendingScrollAnchor = false`
  at the top of the success handler once its value is captured into a local).
- **Anchor target = the jar's tab strip so the tabs sit at the top** (the
  operator's words). The panel's `mountEl` is the History tabpanel's content
  mount; the tab strip lives one level up in `jars.js`'s section. Two
  acceptable implementations — pick one at design review:
  1. **Self-contained**: `mountEl.closest(<jar-section-or-tabpanel selector>)`
     then `.scrollIntoView({ block: 'start' })`. Verify the section/tabpanel
     wrapper selector against `jars.js`'s DOM (the `role="tabpanel"` region
     or the jar section container); scrolling the section top brings the tab
     strip into view since the strip is at the section top.
  2. **Callback**: `createHistoryPanel` accepts an optional `onPageChange`
     (or `scrollAnchorEl`) from `jars.js`, which owns the tab-strip element;
     the panel invokes it after a user page change and `jars.js` scrolls its
     own tab strip into view. Cleaner separation (panel stays ignorant of
     section layout) at the cost of one new constructor param.
  Prefer (1) if a stable wrapper selector exists (no contract change);
  fall back to (2) if the panel can't reliably reach the tab strip.
- **Reduced-motion**: instant scroll (no smooth animation) — mirror the
  tabs leg's reduced-motion handling (`jars-tabs.js` / jars.css use instant
  switching under `prefers-reduced-motion`). Use `scrollIntoView()` without
  `behavior:'smooth'`, or gate `behavior` on the reduced-motion media query.

## Acceptance Criteria

- [ ] Clicking any pager control (prev / next / a page number) that changes
      the page scrolls the jar's tab strip / History-panel top back into
      view, so the tabs are visible at the top after the page renders —
      including the full-page → short-page case that motivated H9.
      (Implemented; live scroll feel is operator-verified per Verification
      Steps below — not eval-observable, so not checked off here.)
- [x] The scroll fires ONLY on a user page change. NONE of these scroll the
      viewport: initial panel fetch, search-debounce fetch, `onHistory
      changed` broadcast repaint, the page-overshoot self-correction
      re-fetch. (The one-shot intent is consumed/cleared so it can't leak
      into a later background repaint.) — verified by code tracing: only
      `goToPage` arms `pendingScrollAnchor`; `refresh()`'s success handler
      captures-then-clears it as its first statement, before the
      stale-token check, the error check, and the self-correction branch,
      so none of the other four `refresh()` callers (nor the self-correction
      re-fetch) can fire `onPageChange`.
- [x] `prefers-reduced-motion` respected — instant anchor, no smooth-scroll
      animation. — the new `scrollIntoView` call rides the existing
      `jars.css` `@media (prefers-reduced-motion: no-preference) { html {
      scroll-behavior: smooth } }` gate (same mechanism already used by
      `tryExpandFromHash`'s `refs.root.scrollIntoView(...)`); no new
      JS-side check needed.
- [x] Stale-response guard (`viewGen`/`token`) untouched; a page click whose
      fetch is superseded does not scroll (its paint is skipped, so the
      intent is consumed only on the paint that actually renders — or reset
      without scrolling on the stale path). — verified by code tracing: the
      `pendingScrollAnchor` capture/clear happens before the
      `token !== viewGen` early return, so a superseded fetch clears the
      intent without scrolling.
- [x] `npm test` / `npm run typecheck` / `npm run lint` green. Report the
      jars-history-panel.js (and, if option 2, jars.js) line counts (watch
      the ~1,800 jars.js DD2 trigger — this leg should add only a few lines,
      and only to jars.js if option 2 is chosen). — all three gates green
      (`npm test` 1502/1502 pass, typecheck clean, lint clean).
      `jars-history-panel.js`: 553 lines (was 512). `jars.js`: 1,598 lines
      (well under the ~1,800 trigger).

## Verification Steps

- Gates + code review. Live scroll feel is operator-verified (internal-page
  DOM scroll position is not eval-observable — no behavior test; consistent
  with the HAT-as-acceptance-signal practice for internal pages, M06 F4 DD9).

## Files Affected

- `src/renderer/pages/jars-history-panel.js` — one-shot scroll-anchor intent
  in `goToPage`, consumed in `refresh()`'s successful paint.
- `src/renderer/pages/jars.js` — ONLY if option 2 (callback/anchor param) is
  chosen; otherwise untouched.

---

## Post-Completion Checklist

- [x] All acceptance criteria verified (static: gates + code tracing; live
      scroll feel remains operator-verified per Verification Steps)
- [x] Tests passing (1502/1502; typecheck + lint clean)
- [x] Update flight-log.md with leg progress entry (incl. line counts)
- [x] Set this leg's status to `landed`
- [x] Do NOT commit (flight-level review + commit after the leg)
