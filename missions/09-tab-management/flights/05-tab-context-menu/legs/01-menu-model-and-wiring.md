# Leg: menu-model-and-wiring

**Status**: completed
**Flight**: [Tab Context Menu](../flight.md)

## Objective

Land the tab context menu end-to-end: pure model + unit net, both trigger
paths (pointer contextmenu + Context-Menu-key via the existing catch-all's
extended gate), sheet registration (MENU_LABELS + overlayMenus entry +
tabCtx capture), channel-6 dispatch with the ordered-sweep batch closes,
the two invokes (tab-history-snapshot, closed-tab-stack-size), the a11y
audit hook + SHEET_STATES entry, and the doc grep-ACs.

## Context

Flight DD1–DD4 are authoritative — every design-review ruling is embedded
verbatim (ordered sweeps with anchor-first activation; activeElement-based
keyboard targeting; catch-all gate extension at renderer.js ~842-860;
omitted-only items; MENU_LABELS; the closed-set seam FD ruling for
`openTabContextMenuForAudit`). Read them fully before coding.

## Acceptance Criteria

- [x] `src/shared/tab-context-model.js` + unit tests: id set
      `tab:{close,close-others,close-right,duplicate,reopen-closed}`,
      omission rules (only-tab → no close-others; none-right → no
      close-right; empty stack → no reopen-closed; duplicate always).
- [x] Pointer trigger: `contextmenu` on tab buttons opens the menu anchored
      at the tab (chromePointToSheet); preventDefault; works on background
      tabs without activating them (menu open ≠ activation).
- [x] Keyboard trigger: Context-Menu key / Shift+F10 on a FOCUSED tab —
      via the extended catch-all gate (no parallel listener, no
      double-fire); target from `document.activeElement.closest('.tab')`.
- [x] Dispatch: tab:close (existing path); ordered-sweep close-others /
      close-right (anchor activated FIRST when the active tab is a target);
      duplicate (snapshot invoke + createTab restoreHistory +
      insertAt sourceIndex+1 + title seeded renderer-side); reopen-closed
      (the EXISTING dispatchChromeAction case). All validated-no-op on
      vanished tab ids (TOCTOU).
- [x] Invokes: `tab-history-snapshot` (web tabs only; internal/dead →
      null), `closed-tab-stack-size`; preload bridges + d.ts entries.
- [x] Sheet: MENU_LABELS['tab-context'] ("Tab menu" or similar);
      overlayMenus entry (page-context shape, escape-only refocus to the
      captured returnFocus); tabCtx capture object.
- [x] a11y audit: SHEET_STATES gains `sheet:tab-context` +
      `openTabContextMenuForAudit()` on the closed-set seam (FD-ruled;
      grouped `// a11y-audit`), representative state renders all five items.
- [x] Doc grep-ACs (F4 debrief rule, first application):
      `grep -n "context menu" README.md` hits a tab-context row/paragraph;
      `grep -n "tab-context" CLAUDE.md` hits the menu note (add both:
      README keyboard/mouse affordance note incl. Shift+F10; CLAUDE.md
      hosted-surfaces list + tab-strip section extension).
- [x] Live checks: both triggers; each action; omission states; Escape
      refocus to the invoking tab; menu on a BACKGROUND tab acts on that
      tab (not the active one). Record in the flight log.
- [x] `npm test`, lint, typecheck green; flight log leg entry.

## Files Affected

- `src/shared/tab-context-model.js` (new) + test (new)
- `src/renderer/renderer.js`, `src/renderer/menu-overlay.js`,
  `src/preload/chrome-preload.js`, `src/renderer/renderer-globals.d.ts`
- `src/main/main.js` (two invokes)
- `scripts/a11y-audit.mjs`
- `README.md`, `CLAUDE.md`
- flight-log.md

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Tests passing
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Do NOT commit — the flight commits once after review
