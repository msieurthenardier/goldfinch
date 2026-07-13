# Flight Log: HAT & Alignment — Per-Jar History

**Flight**: [HAT & Alignment](flight.md)

## Summary

*(session not started — awaiting the operator)*

---

## Leg Progress

### HAT walkthrough (live)

- **Step 1 (recording sanity across jars): PASS** — counts per jar
  reflect own browsing. Observations banked for the findings leg:
  - **H1 (feature)**: real paging for the history list — numbered paging
    bar at the bottom (`< 1, 2, 3, … >`) instead of Show more.
  - **H2 (feature)**: history rows should be actual links navigating to
    the site (open-target decision needed: same-jar tab).
  - **H3 (fix)**: per-row delete `×` → trashcan icon, to read as
    "delete this history entry".
  Operator direction: batch findings into one leg after the walkthrough
  (not inline).
- **Step 2 (burner leaves no trace): PASS** — no count movement, no
  suggestion leakage from burner browsing.
- **Step 3 (panel look & feel): FUNCTIONAL PASS, restyle requested** —
  - **H4 (restyle, design-review required)**: the disclosure dropdowns
    read cartoonish/unprofessional. Replace with per-jar TABS
    (History | Cookies | Other site data) — professional, tight
    appearance. FD working interpretation: horizontal tab strip per jar
    section, History default-selected, count as a badge on the History
    tab; one visible region per jar (supersedes the F2
    independently-collapsible ruling — operator authority, recorded).
    Structural touchpoints to review at leg design: CONFIRM_REGIONS
    machinery, lazy fetch on expand→on tab-select, hash deep-links,
    count wiring.
- **Step 4 (history panel content): PASS with one fix** —
  - **H5 (fix)**: status line says "Showing X of many" even when X < the
    50-row page limit (i.e. the COMPLETE set) — "of many" must only
    render when a full page returned; otherwise show the plain count.
    Likely subsumed by H1's paging bar; tracked so it can't slip.
  Rows/search/delete/clear-confirm otherwise good.
- **Step 5 (retention control): PASS** — copy clear, presets adequate,
  instant-apply trusted. (Operator note: no live way to observe pruning —
  correct; the cutoff behavior is unit-pinned and prune-on-change is
  IPC-tested; observing it live needs time travel.)
- **Step 6 (data-controls integration): two findings** —
  - **H6 (BUG, design-review required)**: "Clear identity did not clear
    the history (in the UI)." Diagnosed by code reading (not live repro):
    the store purge + `history-changed` broadcast are CORRECT (F3 probe 6
    DB-verified the purge; the jars-page `onHistoryChanged` handler
    refreshes count + panel). ROOT CAUSE: `handleWipe` broadcasts
    `jar-wiped`, and the renderer's `onJarWiped` handler (renderer.js:158)
    reloads every open web tab in the wiped jar (F4/DD4 — so the
    logged-out state is visible); reloads re-fire `did-navigate`, which
    the recorder counts as visits → the wiped jar's history is purged then
    IMMEDIATELY re-populated with the current page(s) of its open tabs.
    Operator perceives "not cleared." This is a real interaction bug
    between DD4 (reload-on-wipe) and the recorder (reloads = visits) —
    violates the mission's "wiping removes the jar's history" for any jar
    with open tabs. Fix options for the leg (design-review): suppress
    recording for wipe-triggered reloads (recorder needs a wipe-reload
    signal); or reconsider the reload sweep; or accept + copy. F3 probe 6
    actually FORESAW this ("the 1 residual row is a legitimate
    reload-triggered new visit") but classified it non-defect — HAT
    reclassifies it a real UX bug.
  - **H7 (UX change, design-review)**: clear-history / clear-identity
    confirmation is an easily-overlooked INLINE two-step; should be a
    modal the user cannot miss. Spans the jars-page confirm machinery
    (all data-class + wipe + delete confirms share it) — multi-surface,
    review-gated.

---

## Decisions

Operator rulings (2026-07-13 HAT):
- **H2 open-target → NEW TAB, same jar.** History-row links open a fresh
  web tab in that jar (jars page stays open).
- **H6 wipe fix → CLOSE the jar's tabs on wipe (not reload), and state it
  in the confirm copy.** Supersedes F4/DD4's reload-open-tabs-on-wipe.
  Closing the identity's tabs means no reload → no re-recorded visit →
  history stays cleared. The wipe confirm must warn that open tabs in the
  jar will close.
- **R1 → YES, select-all on address-bar focus** (adopt the standard
  browser convention; click/focus selects the whole URL).
- **R2 → KEEP recording search-fallthrough navigations** (they're real
  visits; appear in history and are suggestable).
- **R3 (out-of-jar msg discloses own jar id) → KEEP** (own-binding only,
  harmless) — FD default, no objection raised.
- **R4 (ranking weights / row count / debounce) → LEAVE AS SHIPPED**
  (operator passed ranking at step 8).
- **R5 (panel default/persist) → SUPERSEDED by H4** (tabs; History is the
  default-selected tab).
- **R6 (SR parity for the cross-view dropdown) → ACCEPT as documented gap
  this mission; BACKLOG a follow-up** — FD default, no objection.

---

## Deviations

*(none yet)*

---

## Anomalies

*(none yet)*

---

## Session Notes

- **2026-07-13 (flight design)**: HAT script assembled from the carry-
  forwards of the three live behavior-test runs (F1/F4/F5) and the five
  flight logs. Branches consolidated first: `flight/08-history-mission`
  = the five flight commits, PR #79 (supersedes #74–#78, closed). HAT
  fixes will land as follow-up commits on that branch.
