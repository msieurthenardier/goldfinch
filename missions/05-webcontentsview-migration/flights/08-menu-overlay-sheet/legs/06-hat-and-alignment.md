# Leg: hat-and-alignment

**Status**: ready
**Flight**: [Menu Overlay Sheet](../flight.md)

## Objective

Human acceptance test of the menu overlay sheet across all five surfaces + the new-container
dialog, on screen with a real OS pointer and keyboard — the authority for everything the
apparatus could not exercise — plus the Witnessed `/behavior-test menu-overlay` run and re-runs
of the re-authored specs where apparatus permits. **CP5**: HAT pass + Witnessed pass; the flight
lands. Interactive leg: the Flight Director guides the operator one step at a time; failures are
fixed inline (new commits, no amend) and the step re-verified.

## Context

- All six autonomous legs are `completed` and committed (`32f4f0e`); the flight-level review
  passed. The sheet is the only menu mechanism; freeze-frame is deleted.
- **Operator ratification items** (decisions taken autonomously, flagged for this HAT):
  1. **New-container dialog fixed via the sheet** (Leg-3 FD decision on the flight's operator
     call — the flight's "parity-plus-correctness" option). Revert path stays contained if
     rejected.
  2. **Dialog modality is guest-region-scoped** (DD12 consequence): toolbar clicks dismiss the
     dialog AND perform their action; no full-window dim.
  3. **F7 "unfreeze non-refocus" restructuring**: find-bar restore after a menu closes is now
     an owned explicit step — this HAT ratifies the live focus behavior.
- **HAT-carried items** (apparatus limits accumulated in the flight log, Legs 1–5b):
  real-OS-pointer click interception; blur dismissal flavors (app switch, chrome click);
  real-keyboard Enter/Space activation of sheet menuitems; live spellcheck correction;
  DevTools open via Inspect; menu-survives-minimize observation; DPR≠1 geometry; guest-zoom
  coordinate skew spot-check; Shift+F10 with a side panel open (clamp variation); the
  dialog-chained-open blink + find-bar flash (accepted variations — confirm transient);
  accelerator composite feel (DD13).
- **Witnessed run**: `/behavior-test menu-overlay` (spec status `draft` → promote to `active`
  on first pass). Apparatus caveat: the session MCP client is pinned to port 49152, which the
  operator's INSTALLED Goldfinch holds — the run needs the flight build on that port (operator
  closes their instance and launches the dev build with `GOLDFINCH_MCP_PORT=49152`), else the
  spec's wiring litmus parks it (HAT still covers the surface). Re-runs where apparatus
  permits: `internal-tab-menus`, `page-context-menu`, `kebab-menu`, `menu-dismissal`
  (post-Leg-5b versions).

## Verification Steps (the guided HAT script — one step at a time)

Setup: operator launches the flight build (`npm run dev` or `dev:automation` per Witnessed
needs) on a web page with motion (the ticking fixture or a video).

1. **Live-guest float**: open each of kebab ⋮ / container ▾ / site-info 🔒 — page content
   visibly keeps updating under the open menu (no frozen still); menus flush at the toolbar
   boundary (the accepted ~4px shift reads fine).
2. **Pointer dismissal + swallow (OS pointer — the real thing)**: with each menu open, click a
   link in the page — menu dismisses AND the page does NOT navigate. Click the toolbar — menu
   dismisses, toolbar action fires.
3. **Trigger re-click toggle**: click ⋮ to open, click ⋮ again — closes cleanly, no blink or
   re-open.
4. **Keyboard contract (real keyboard)**: focus ⋮ (Tab); Enter, Space, and ArrowDown each
   open with the first item focused (ArrowUp-open lands on the last); Arrow/Home/End rove;
   **Enter AND Space activate a menuitem** (Settings opens; also fire Print… and cancel the
   OS print dialog — dialog handling was never rig-verifiable); Escape closes with focus back
   on the trigger; **Tab while open closes with focus returned to the trigger** (escape
   flavor). Repeat spot-wise on ▾ and 🔒.
5. **Page context menu**: right-click a link mid-page — menu at the cursor (1:1); right-click
   near the right/bottom edge — menu clamps inside; Shift+F10 on a focused toolbar element —
   menu at the element; Escape returns focus to the invoking element. Activate Copy link →
   paste somewhere confirms. **Inspect** → DevTools actually opens (rig-limited in
   automation — this is the authoritative check); close DevTools.
6. **Spellcheck live**: type a misspelling in a real page's text field, right-click it, pick a
   suggestion — the word corrects.
7. **Toolbar-unpin**: right-click a pinned toolbar icon → single Unpin item → activates,
   button unpins, focus lands in the address bar.
8. **New-container dialog (ratification #1/#2)**: ▾ → "+ New container…" — the transition
   blink is transient/acceptable; dialog appears CENTERED AND VISIBLE over the page (the
   fixed defect — compare memory of the broken behavior); type a name, Enter — jar created +
   tab opens in it; reopen ▾ — new container listed; Escape/Cancel paths close without
   creating; toolbar click while dialog open dismisses it and fires the toolbar action
   (modality variation — operator judges acceptable).
9. **Find-bar interplay (ratification #3)**: Ctrl+F, type a query; open any menu — find bar
   hides; dismiss — find bar returns with the query intact and usable focus; also close the
   menu via Escape vs outside-click vs app-switch (Alt-Tab away and back) — restore correct
   in each flavor; open the dialog from ▾ with find live — a brief find-bar flash during the
   chained open is the accepted variation (confirm transient).
10. **Blur family (app switch)**: with a menu open, Alt-Tab to another app — menu closes; on
    return, focus is NOT stolen; minimize with a menu open — observe (menu may survive
    minimize-restore: accepted variation, record what the rig does).
11. **Internal tabs (DD7)**: on `goldfinch://settings`, open ⋮ / ▾ / 🔒 — menus float over the
    internal page; right-click on the internal page does nothing (exclusion preserved).
12. **Accelerators under an open menu (DD13 feel)**: menu open → Ctrl+= zooms the page (menu
    stays); Ctrl+F closes menu and opens find; Ctrl+W closes the tab (menu goes with it);
    Ctrl+T opens a tab. Composite feels right (operator judgment).
13. **Environment extras (as available)**: DPR≠1 display — menus/dialog position correctly;
    guest page zoom (Ctrl+= then right-click) — context menu lands at the cursor (parity
    check); side panel open + Shift+F10 — clamped menu position acceptable.
14. **Witnessed runs**: operator closes their installed instance and relaunches the flight
    build with the FULL invocation
    `GOLDFINCH_AUTOMATION_DEV_MINT=1 GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_MCP_PORT=49152
    npm run dev:automation` (plain `npm run dev` fails the wiring litmus) → FD invokes
    `/behavior-test menu-overlay`; on pass, spec → `active`, run log committed. Then re-runs:
    `internal-tab-menus`, `page-context-menu`, `kebab-menu`, `menu-dismissal` as time/apparatus
    permit (park with record if mis-wired). **Draft re-run specs that pass are promoted to
    `active` too** (CP5's "updated specs promoted" — `internal-tab-menus` and
    `page-context-menu` are at draft/never-run).
15. **Exit (the literal last action)**: kebab ⋮ → Exit — the app quits cleanly (deferred from
    Leg 2, code-identity-only until now; running it last costs nothing).

## Acceptance Criteria

- [ ] Steps 1–13 + 15 pass on screen (failures fixed inline + re-verified, or explicitly
  accepted by the operator with disposition recorded)
- [ ] Ratification items 1–3 explicitly accepted (or rejected → contained revert planned)
- [ ] `/behavior-test menu-overlay` passes (or parked with recorded apparatus reason; HAT
  covers the surface)
- [ ] Spec re-runs executed or parked-with-record
- [ ] Flight log updated (HAT results per step, dispositions, run-log references)

## Post-Completion (FD-driven at HAT wrap)

- If any inline code fix landed during the HAT: re-run the gates (`npm test`, typecheck, lint,
  `npm run a11y`) before the merge — the flight's Completion Checklist requires them at
  landing
- Leg status → `completed`; check off in flight.md
- Flight status → `landed`; check off Flight 8 in mission.md (Contributing-to-Criteria boxes
  per results)
- Commit (code fixes, if any, are separate commits made inline during the HAT; the wrap commit
  covers artifacts + run logs)
- Merge `flight/08-menu-overlay-sheet` → `mission/05-webcontentsview-migration` (local; `main`
  untouched)
- Signal `[COMPLETE:flight]`; `/flight-debrief` runs separately
