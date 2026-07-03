# Leg: specs-and-docs

**Status**: completed
**Flight**: [Menu Overlay Sheet](../flight.md)

## Objective

Execute the DD11 artifact dispositions and doc bundles now that the code cutover (Leg 5) has
landed: re-author/update the six behavior specs that pin freeze-era observables, rewrite
CLAUDE.md's menu/freeze architecture content to the sheet reality, add the F7-debrief pattern
section (Rec 3) and the `find-overlay-geometry.md` errata (Rec 4), refresh `docs/renderer-menu.md`
and touch `docs/mcp-automation.md` where the automation story changed (DD8 hardening, sheet
addressability, a11y sheet states). No product source changes. Completes CP4's documentation
half; the updated specs are what Leg 6 re-runs.

## Context

- **This is the second half of the pre-authorized Leg-5 split** — Leg 5 deleted the code; this
  leg makes the written record true again. All dispositions were declared at flight design
  (DD11) and accumulated in the flight-log bookkeeping entries (Legs 3–5).
- **Ground truth to write against (the shipped mechanism)**: a lazy-singleton transparent
  full-guest sheet `WebContentsView` hosts all five menu surfaces + the new-container dialog;
  chrome owns models/actions (channels 1–7, tokens, 300 ms suppress); main owns the close
  family (`closeMenuOverlay(reason)`) + DD5 find interplay + DD13 forwarding; the sheet is NOT
  in `tabViews` (not enumerable; addressable by probed wcId — background-tab-safe probe walk,
  Leg-5 lesson); a11y audits five `sheet:*` states with curated `region` ACCEPTED entries; the
  freeze apparatus (`freezeGuest`/`unfreezeGuest`/`guestFrozen`/`capture-active-guest`) no
  longer exists.
- **Boundary rule**: instructions below describe intent + which observables changed; locate
  content within each artifact by reading it, not by heading position. Keep each spec's own
  voice/structure; specs are project-owned.

### Disposition list (DD11 + accumulated bookkeeping)

1. **`tests/behavior/internal-tab-menus.md` — RE-AUTHOR.** Its authoritative observable is the
   `#webviews backgroundImage` freeze tell + `guestFrozen` framing (citations
   `renderer.js:1076,1091` — stale twice over: pre-F8 drift already noted at flight design,
   and the symbols are now deleted). Re-author around sheet observables: menu rendered from
   the sheet wcId over the LIVE internal view (pixels; no still), kebab/container/site-info
   over `goldfinch://` tabs (DD7), dismissal + `aria-expanded` on chrome. Note the Leg-5
   nuance: `evaluate` refuses internal wcIds by design — internal-tab checks re-base on chrome
   tab state + pixels (the Leg-5 flight-log entry records the technique).
2. **`tests/behavior/tab-surface-geometry.md` — RE-AUTHOR the freeze rows only.** Geometry
   rows survive untouched. The freeze-tell rows become sheet rows: menu open ≠ guest
   hidden — assert guest LIVE under an open menu (ticking delta) + sheet bounds ≡ guest
   bounds; drop `captureActiveGuest`-based steps.
3. **`tests/behavior/menu-dismissal.md` — RE-AUTHOR.** It pins the retired chrome
   window-blur/pointerdown dismissal mechanism. The user-observable contract it protects
   (outside-click dismisses + is swallowed; blur closes; Escape closes with refocus; mutual
   exclusion) transfers to the sheet: rewrite steps against sheet-era observables (channel-7
   reasons are internal — assert user-visible effects: menu gone on pixels, no navigation,
   trigger focus/aria state). Fold in the apparatus limits the flight codified
   (injected-clicks-bypass-hit-testing → OS-pointer interception is HAT-only; scripted focus
   can't fake OS blur → blur flavor HAT-scoped).
4. **`tests/behavior/kebab-menu.md` — UPDATE (staleness is deeper than the item count,
   design review).** Menu DOM/AX reads move chrome-wcId → sheet-wcId (probed;
   background-tab-safe walk); "exactly two items, Settings and Exit" (`kebab-menu.md:11`,
   `:93`, AND the Observables count pin ~`:78`) corrects to the real four
   (Settings/Downloads/Print…/Exit); **step 8's "Settings is inert / placeholder" assertion
   INVERTS** (Settings/Downloads open trusted internal tabs now — the Intent/"Not covered"
   placeholder framing goes too); apparatus notes gain the **Print modal-dialog trap**
   (Leg-2 anomaly: `wc.print()` opens a blocking GTK dialog, not MCP-dismissable on this
   rig — verify Print via aria-reset/menu-closed observables, never leave the dialog up)
   beside the existing "do NOT activate Exit" caution; `aria-expanded` stays a chrome-side
   read; note the pressKey-Enter-doesn't-click nuance (real-keyboard activation is HAT;
   scripted activation via `evaluate` `activeElement.click()`).
5. **`tests/behavior/page-context-menu.md` — UPDATE.** Chrome-DOM menu reads → sheet wcId
   (node identity: `#page-context-menu` → the sheet's menu node,
   `data-menu-type="page-context"`); coordinates are now 1:1 guest-relative (delete
   offset-translation framing); **Escape focus-return semantics changed** (step 8 expects
   focus on "the active `<webview>`" — sheet-era: escape-only → guarded
   `pageCtx.returnFocus`, else `els.address`; Leg-4 evidence: audit-open Escape → address
   bar); right-click synthesis via MCP `click {button:'right'}` is PROVEN on this rig
   (Leg 4) — record as the canonical driver; spelling items dispatch by index (labels still
   guest strings); Inspect devtools-open is rig-limited (Leg-4 note) — HAT-carried.
6. **`tests/behavior/find-overlay-geometry.md` — REFRAME step 6 + F7 errata bundle (Rec 4).**
   Step 6's assertion (find bar hidden during menu, restored on dismiss) is UNCHANGED per DD5 —
   only its freeze wording updates to menu-overlay wording. Apply the four F7 errata
   (probe-direction "around" not "above"; step-2 pixel-tolerance band ≤5px/>10px; menu
   DOM-bracketing technique; DOM-anchored control location) + the absence-authoritativeness
   rule + the optional final reopen-check (reset-on-next-open contract) — the F7 debrief's
   Rec 4 verbatim list (`flights/07-find-overlay-view/flight-debrief.md`).
7. **`tests/behavior/menu-overlay.md` (the drafted Leg-6 spec) — RECONCILE to built reality.**
   Keep status `draft` (Leg 6 promotes on first pass). Update: the liveness fixture EXISTS
   (`tests/behavior/fixtures/menu-overlay/` — ticking display, bottom-left link, mid-page
   link, image, editable); apparatus notes gain the Leg-3/4/5 lessons (pressKey-Enter nuance,
   background-tab-safe probe walk, right-click driver proven); precondition "Flight 8 landed"
   still true-to-be.
8. **`test/unit/menu-controller.test.js`** — already re-framed in Leg 5 (comment-only). If
   spec-reading reveals a missed pin: **record it in the flight log** (flight-end review /
   Leg 6 candidate) — do NOT edit the test here (no-code rule; comment-only re-frames at
   most, and only if trivially safe).
9. **CLAUDE.md — REWRITE the menu/freeze content + ADD the F7 pattern section (Rec 3).**
   Stale regions found at design-time grep (locate by content): the a11y command description
   (must gain the five `sheet:*` states + the sheet's probed-addressability; the "find UI is
   NOT audited" note stays true but the parallel "menus" story changed); the renderer
   architecture paragraph (kebab/container/menuController framing → sheet architecture:
   chrome = triggers/models/actions, sheet = presentation + APG via the same
   `menu-controller.js` now loaded ONLY by the sheet document); the find-overlay paragraph
   ("hidden … during menu freeze" → DD5 menu-overlay interplay); the `WebContentsView` gotcha
   paragraph (freeze-frame named as the "current live example" → retired; the sheet IS the
   new example: panel-over-guest compositing proven; keep the gotcha itself — it remains
   true); the site-info/address-chip paragraph; the toolbar-Unpin section; the page-context
   section (guest→main→chrome flow survives, rendering + 1:1 coords changed); the
   freeze-frame pattern section + `capture-active-guest` contract section (DELETE — replaced
   by a menu-overlay-sheet section: singleton lifecycle, channels 1–7 summary, close family,
   DD8 sender validation + non-tab-contents admin hardening, DD5, DD13). New pattern section
   (Rec 3, five entries): `findNext` inversion + adapter; pending-init queue for lazy-view
   first-load races; sender-resolved close refocus; the Electron-free unit-testable module
   pattern (`find-overlay-geometry.js`, now also `menu-overlay-manager.js`); "views not in
   `tabViews` are invisible to automation — enumerable-vs-addressable" rule. **Region-list
   additions (design review)**: BOTH site-info bullets (the address-chip ¶ AND the
   "Site settings →" destination ¶ — the latter names the deleted `buildSiteInfo`); the
   "only trusted call site is the kebab → Settings handler" claim (stale independently of
   F8 — Downloads and `openSiteSettingsTab` are also trusted call sites; kebab actions now
   run in channel-6 dispatch bodies).
10. **`docs/renderer-menu.md` — REFRESH.** It documents the shared menuController contract +
    consumer constraints for chrome consumers; post-cutover its consumers live in the sheet
    document. Update framing (who loads it, entry shapes incl. no-items popups + trigger===menu,
    the sheet's capture-phase reason attribution sitting alongside), keep the contract text
    (unchanged module).
11. **`docs/mcp-automation.md` — TOUCH where the story changed.** DD8: `allowInternal` is no
    longer the sole admin relaxation (non-`tabViews` wcIds resolve admin-only — mirror the
    resolve.js/engine.js comment updates from Leg 2); the sheet as a non-enumerable,
    probe-addressable view (design choice); the a11y audit's sheet states if the doc describes
    the audit's state list.
12. **F7 known-item annotation (corrected location + wording, design review)**: the "overlay
    input does NOT regain OS focus after unfreeze" item lives in the **F7 flight log** (the
    Leg-2 "Known/HAT-observation items" entry ~`:185` and the HAT session note ~`:474`, where
    F7's final disposition was "unfreeze non-refocus ACCEPTED as correct") — NOT in the F7
    debrief action items, and mission.md Known Issues is empty. Annotate THERE (additive,
    dated): "mechanism restructured in F8 — restore is now an owned, explicit step
    (`closeMenuOverlay`'s DD5 hook; see F8 flight.md DD5); live focus behavior ratified at
    the F8 Leg-6 HAT." Do NOT claim "resolved" — F7 accepted the old behavior as correct, and
    the F8 live ratification is Leg 6's.

## Inputs

- Legs 1–5 landed (uncommitted); flight log entries for Legs 1–5 (the bookkeeping lists +
  apparatus lessons are source material for the spec updates).
- The six spec files + `menu-overlay.md` draft; `CLAUDE.md`; `docs/renderer-menu.md`;
  `docs/mcp-automation.md`; F7 debrief Recommendations 3–4 + its Action Items checklist
  (`flights/07-find-overlay-view/flight-debrief.md:137-172` region — check off the two items
  this leg executes, with a dated note).
- No app launch strictly required (this is a writing leg) — but spot-verifying a rewritten
  spec's observables against the running app is encouraged where cheap (the Leg-5 evidence
  set + flight log cover most).

## Outputs

- Modified: the six behavior specs + `menu-overlay.md`, `CLAUDE.md`, `docs/renderer-menu.md`,
  `docs/mcp-automation.md`, F7 debrief action-item checkoffs (+ dated annotations), mission
  known-issue annotation.
- No source-code changes. `npm test`/typecheck/lint untouched (run once to confirm no
  accidental damage).

## Acceptance Criteria

- [x] **AC1 — No stale freeze observables in active specs.**
  `grep -rn "freezeGuest\|unfreezeGuest\|guestFrozen\|capture-active-guest\|captureActiveGuest\|backgroundImage" tests/behavior/*.md`
  → zero matches in ACTIVE specs' step tables/observables — mechanically: any surviving match
  must be OUTSIDE the spec's `## Steps` table and `## Observables Required` section
  (historical run logs under `tests/behavior/*/runs/` are immutable records — untouched; a
  spec's changelog/history notes MAY mention the freeze era as retired prose).
- [x] **AC2 — The six dispositions executed as declared** (re-author ×3, update ×2, reframe+
  errata ×1), each spec still a valid Zephyr-style Witnessed spec per the project's
  ARTIFACTS.md format (Intent/Preconditions/Observables/Steps table), with apparatus notes
  reflecting the proven Leg-3/4/5 techniques and HAT-only scopes.
- [x] **AC3 — `menu-overlay.md` reconciled** (fixture exists; apparatus lessons folded;
  status stays `draft`).
- [x] **AC4 — CLAUDE.md truthful against the tree.** No mention of freeze-frame/
  `capture-active-guest` as LIVE mechanisms (historical mentions allowed only as explicitly
  retired); the menu-overlay-sheet section exists and matches the shipped protocol; the Rec-3
  pattern section present with all five entries; the a11y description lists the sheet states.
  Sanity: every code symbol CLAUDE.md presents as LIVE exists in the tree (names cited as
  explicitly-retired predecessors are exempt — designer answer); PLUS a negative whole-file
  grep of the Leg-5 deleted-symbol inventory (`buildSiteInfo`, `buildPageContextSections`,
  `positionPageContextMenu`, `initNewContainerDialog`, `pageContextItems`, `truncateLabel`)
  over CLAUDE.md + `docs/*.md` — matches allowed only in retired-predecessor framing.
- [x] **AC5 — docs refreshed** (`renderer-menu.md` consumer framing; `mcp-automation.md` DD8 +
  addressability + audit states as applicable).
- [x] **AC6 — F7 debrief Rec 3/Rec 4 action items checked off** with dated annotations
  (executed-by-F8-Leg-5b), and the F7 "focus doesn't return after unfreeze" known item
  annotated resolved-by-F8. Annotations are additive — no rewriting of the original text.
- [x] **AC7 — Gates still green** (`npm test`, `npm run typecheck`, `npm run lint` — this leg
  should not affect them; run to prove it).

## Verification Steps

- AC1: the grep, verbatim; eyeball any remaining prose mentions for "explicitly retired"
  framing.
- AC2/AC3: per-spec diff review against the disposition list; each step table read end-to-end
  for freeze-era observables; format check against `.flightops/ARTIFACTS.md`'s behavior-spec
  format.
- AC4: read the rewritten CLAUDE.md sections; spot-grep named symbols
  (`createMenuOverlayManager`, `closeMenuOverlay`, `menu-overlay:open`, `isTabViewWcId`,
  `sheet-accelerator`, …) against `src/`.
- AC5/AC6: diff review.
- AC7: run the three gates.

## Implementation Guidance

1. Work spec-by-spec in the disposition order; read each spec fully before editing (locate by
   content, not heading — project-owned artifacts).
2. Source material discipline: the flight log (Legs 1–5) contains verified apparatus
   techniques and evidence framing — reuse its language for apparatus notes rather than
   inventing new phrasing.
3. For re-authored specs: preserve each spec's Intent (what user-observable contract it
   protects) — the MECHANISM changed, the contract mostly didn't. Where the contract itself
   changed (e.g. dialog now visible — the fixed defect), say so in the spec's notes.
4. CLAUDE.md: keep edits surgical per region; do not restructure the whole file. The
   freeze-frame + capture-active-guest sections are deletions-with-replacement (one new
   menu-overlay-sheet section covering both concerns).
5. Check off ONLY the two F7 action items this leg executes; leave the rest.
6. Nothing in this leg touches `src/` — if a spec rewrite reveals a code gap, record it in the
   flight log (candidate for Leg 6 HAT or a known issue), don't fix code here.

## Edge Cases

- **Historical run logs** referencing freeze observables: immutable — never edit
  (`tests/behavior/*/runs/`).
- **Specs not in the DD11 list that mention "freeze" incidentally**
  (`settings-activity-viewer.md` — audit-log freshness freeze; `responsive-tab-strip.md` —
  the `freezeTabWidths` family Leg 5 explicitly KEPT): both use "freeze" for concepts
  UNRELATED to the guest freeze-frame — **expected disposition: no change** unless a mention
  actually references the guest freeze/menu mechanism (design-review correction: their step
  observables are correct as-is). Record the inspection outcome in the flight log.
- **`find-in-page.md` cold-start caveat**: explicitly NOT this leg (F7 Rec 5 → Flight 5's
  owner) — leave untouched.
- **ARTIFACTS.md behavior-spec format**: the specs must stay conformant, but ARTIFACTS.md
  itself is not edited by this leg.

## Files Affected

- `tests/behavior/{internal-tab-menus,tab-surface-geometry,menu-dismissal,kebab-menu,page-context-menu,find-overlay-geometry,menu-overlay}.md`
- `tests/behavior/{settings-activity-viewer,responsive-tab-strip}.md` — incidental mentions
  (inspect)
- `CLAUDE.md`, `docs/renderer-menu.md`, `docs/mcp-automation.md`
- `missions/05-webcontentsview-migration/flights/07-find-overlay-view/flight-debrief.md` —
  action-item checkoffs + annotations
- Mission/known-issue annotation site (locate)

---

## Post-Completion Checklist

**Complete ALL steps before signaling `[HANDOFF:review-needed]`** (batch flight: review + commit
are deferred to flight end — do NOT commit, do NOT set `completed`):

- [x] All acceptance criteria verified
- [x] Gates confirmed green (`npm test`, `npm run typecheck`, `npm run lint`)
- [x] Update flight-log.md with leg progress entry (per-spec disposition summary)
- [x] Set this leg's status to `landed` (in this file's header)

---

## Citation Audit

Verified at design time (post-Leg-5 tree, 2026-07-02):

- Freeze/menu mentions in `tests/behavior/*.md` — design-time `grep -l` hit list:
  `find-overlay-geometry`, `tab-surface-geometry`, `menu-overlay`, `internal-tab-menus`,
  `settings-activity-viewer`, `responsive-tab-strip` (+ `menu-dismissal`/`kebab-menu`/
  `page-context-menu` per DD11) — re-grep at implementation.
- `tests/behavior/internal-tab-menus.md:49` stale `renderer.js:1076,1091` citation — **confirmed
  stale** (symbols deleted in Leg 5).
- `tests/behavior/kebab-menu.md:11`, `:93` "exactly two items" — **confirmed stale** (four
  items since M04).
- F7 debrief Rec 3 (`:147-152`), Rec 4 (`:153-156`), action items (`:171-172`) — **OK**.
- CLAUDE.md stale regions — located by design-time grep (a11y command description, renderer
  architecture ¶, find-overlay ¶, WebContentsView-gotcha ¶ naming freeze-frame as live,
  toolbar-unpin section, page-context section, freeze-frame pattern section,
  capture-active-guest section) — content-located, headings not contractual.
- `docs/renderer-menu.md` exists and mentions menuController (design-time `grep -l`) — **OK**.
