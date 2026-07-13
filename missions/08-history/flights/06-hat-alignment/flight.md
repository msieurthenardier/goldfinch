# Flight: HAT & Alignment — Per-Jar History

**Status**: in-flight
**Mission**: [Per-Jar Browsing History](../../mission.md)

## Contributing to Criteria

All 11 mission criteria are machine-verified and closed (F1–F5). This
flight is the human half: look-and-feel acceptance of the three new
surfaces, the product rulings the live runs surfaced, and inline fixes —
per the mission's optional Flight 6 charter ("vibe coding session on the
jars-page panels and omnibox feel with real-time human judgment").

---

## Pre-Flight

### Objective

A guided HAT session: the Flight Director walks the operator through the
history feature end-to-end on a live build, one step at a time, fixing
look-and-feel issues inline as they're found (fix-vs-feature gate applies;
multi-surface "cosmetic" fixes get a lightweight design-review spawn
first). Product rulings collected during the session are recorded as
Decisions in the flight log. Findings commit as follow-up commits on
`flight/08-history-mission` (PR #79).

### Session protocol (agentic-workflow HAT rules)

- One step at a time; the operator performs and reports; failures are
  diagnosed and fixed inline, then the step re-verified.
- **Fix-vs-feature gate**: new behavior requested mid-HAT → promoted to a
  scoped design review before implementation; only look-and-feel fixes
  ride the inline protocol. The line is the FD's call, made out loud.
- **Multi-surface trigger**: even a "cosmetic" fix spanning more than one
  page/surface gets a Developer design-review pass first.
- Setup: `npm run dev:automation` (or plain `npm start`) on the
  consolidated branch; a profile with a few jars and some real browsing
  helps — the dev profile currently carries useful test data
  (~50k rename-test rows) for scale feel.

### HAT Script

**Part A — Recording sanity (5 min)**
1. Browse a few pages in two different jars; open `goldfinch://jars`;
   confirm the History counts tick up per jar and feel right.
2. Open a burner tab, browse; confirm nothing changes anywhere.

**Part B — Jars page: panels & history content (15 min)**
3. Panel feel: default-collapsed right? Chevron/affordance clear? Toggle
   independence, spacing, long-scroll rhythm with several jars.
4. History panel: browse the list (row layout, title/host/time balance),
   Show more paging, search feel (debounce, empty state), per-row delete,
   Clear History confirm copy + placement.
5. Retention control: copy ("Keep history for:"), preset list adequacy
   (7/14/30/90/180/365), instant-apply feedback.
6. Data-controls integration: wipe a test jar → count zeroes + panel
   empties; delete a test jar → gone cleanly.

**Part C — Omnibox (15 min)**
7. Typing feel: latency, flicker, dropdown geometry/styling under the
   address bar, row content (title vs URL emphasis), empty state.
8. Ranking quality: do frequently/recently visited pages surface first?
   (bucket weights 100/70/50/30/10 over 4/14/31/90d are tunable.)
9. Keyboard: ArrowDown/Up highlight, Enter-selected vs Enter-free-text,
   Escape (close, keep text), continue-typing narrowing.
10. Pointer: row click navigates; the blur/click race feels clean.
11. Gates: burner tab and internal pages never suggest; readOnly address
    bar on internal tabs unchanged.

**Part D — Product rulings to make (collected from the live runs)**
- R1: Click-into-populated address bar does NOT select-all (diverges from
  omnibox convention). Adopt select-all-on-focus? *(single-surface fix if
  yes — inline eligible)*
- R2: Enter-with-no-selection falls through to a search navigation, which
  the recorder then writes into history. Intended? Should derived
  search/redirect navigations be recorded?
- R3: The `automation: out-of-jar` message discloses the caller's own
  bound jar id. Keep (own-binding only) or tighten?
- R4: Suggestion ranking weights / dropdown row count (6) / debounce
  (100 ms) — tune to taste.
- R5: Panel default state (all collapsed) and whether panel open-state
  should persist across page loads.
- R6: Screen-reader parity for the cross-view dropdown (best-effort
  aria today; true combobox semantics impossible across WebContentsViews)
  — accept as documented gap or schedule follow-up work?

**Part E — Close-out**
- Findings fixed inline → gates re-run → commit(s) to
  `flight/08-history-mission` (`flight/06: HAT fixes ...`).
- Rulings → flight-log Decisions.
- Deferred items → mission Known Issues / BACKLOG.

### Prerequisites

- [x] F1–F5 landed on `flight/08-history-mission` (PR #79); suite
      1494/1494 green; app boots on the branch (verified across three
      live behavior runs).

---

## In-Flight

### Implementation phase

The HAT walkthrough (discovery half) is complete — 11/11 functional pass,
findings H1–H7 banked, rulings recorded in the flight log. This flight now
implements the findings as sequenced legs via `/agentic-workflow`, closing
with a HAT re-verification leg. Design-review legs get the Architect/
Developer pass before implementation (same discipline as F1–F5); gates +
affected behavior tests re-run; commits land on `flight/08-history-mission`.

**Finding → leg map & rulings** (all rulings in the flight-log Decisions):
- Leg 1 `address-select-all` — R1 (select-all on address focus). Standalone
  renderer fix; no design review.
- Leg 2 `jars-page-tabs` — H4 (per-jar tab strip replacing collapsible
  panels; History default-selected, count as a badge). Restructures the F2
  panel/confirm-region architecture. **Design-review.** Sequenced BEFORE
  the history-content leg so the tab shell exists first.
- Leg 3 `history-panel-content` — H1 (numbered paging bar; store
  offset-paging + total via `countByJar`; absorbs H5's "of many" status
  bug), H2 (rows → links opening a NEW TAB in the same jar; new
  internal-bridge open-tab-in-jar IPC), H3 (trashcan icon for per-row
  delete). **Design-review.** Lands inside Leg 2's tab shell.
- Leg 4 `confirm-modal-and-wipe` — H7 (modal confirm replacing the
  overlooked inline two-step, across all data-class + wipe + delete
  confirms), H6 (close the jar's tabs on wipe instead of reloading +
  confirm-copy warning; supersedes F4/DD4's reload sweep). **Design-review**
  (cross-surface: main + renderer + jars page).
- Leg 5 `hat-reverification` — the closing HAT leg (operator re-walks the
  fixed surfaces; interactive, not agent-executed per the HAT protocol).

### Legs

- [x] `hat-walkthrough` — the 11-step discovery session (done; 11/11
      functional pass, findings H1–H7 banked, rulings R1–R6 recorded).
- [ ] `address-select-all` — R1.
- [ ] `jars-page-tabs` — H4 (design-review).
- [ ] `history-panel-content` — H1/H2/H3 (design-review).
- [ ] `confirm-modal-and-wipe` — H6/H7 (design-review).
- [ ] `hat-reverification` — closing HAT (interactive).

---

## Post-Flight

### Completion Checklist

- [ ] HAT script completed (or operator-halted with disposition)
- [ ] All inline fixes committed + gates green
- [ ] Rulings recorded; deferred items filed
- [ ] Flight → landed; mission ready for `/mission-debrief`

### Verification

Operator satisfaction is the acceptance signal (HAT). Machine gates
(suite/typecheck/lint) re-run after every inline fix.
