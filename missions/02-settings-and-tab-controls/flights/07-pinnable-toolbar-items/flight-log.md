# Flight Log: Pinnable Toolbar Items (Media + Shields)

**Flight**: [Pinnable Toolbar Items (Media + Shields)](flight.md)

## Summary
Flight `in-flight` (2026-06-08). Execution via `/agentic-workflow` (Developer + Reviewer crew; leg design
reviewed per leg; code review + commit batched after the last autonomous leg). Execution notes, decisions,
deviations, and anomalies appended here during the flight.

---

## Reconnaissance Report

Source artifact: the **Flight-6 debrief** (`../06-wire-existing-controls/flight-debrief.md`, Recommendations
+ Action Items) — its carry-forwards walked against current `main` (post-v0.4.8):

| Item | Classification | Evidence | Recommendation |
|------|----------------|----------|----------------|
| Rewire "Site settings →" to the settings page (vs slide-out) | `confirmed-live` | `renderer.js` `buildSiteInfo` → the `.si-settings-btn` handler calls `togglePrivacy(true)` | Core of this flight — DD4, leg 4 |
| `buildSiteInfo` defensive `escapeHtml` on string fields | `confirmed-live` | `buildSiteInfo` escapes `host` only; counts are numbers | Fold into leg 4 (same surface) — DD5 |
| `isInternalTab` string-literal coupling comment | `confirmed-live` (minor) | `isInternalTab` checks `id === 'internal'`; the `createTab` trusted branch sets it — no cross-ref comment | Fold into leg 2 (renderer.js touched) — DD5 |
| internal-preload `onSettingsChanged`/`onShieldsChanged` unsubscribe handles | `confirmed-live` | `internal-preload.js` registers `ipcRenderer.on(...)` with no off-handle; guest reloads (electronmon) → accumulation | Fold into leg 3 (adds another subscription) — DD5 |
| `menuController` module graduation (before 4th consumer) | `confirmed-live` but **threshold not crossed** | this flight adds toolbar buttons + a popup-handler change, NOT a 4th roving-menu/popup consumer | **Assessed → not triggered**; stays deferred |
| Styling acceptance criteria for new UI controls + pre-HAT screenshot | `confirmed-live` (process) | Flight-6 controls shipped unstyled, caught at HAT | **Applied to this flight's leg specs**: the toolbar icons + Appearance pin toggles carry explicit styling criteria (match the design system / `.switch` pill model); the Developer verify step includes a screenshot before the HAT |
| Run formal Witnessed `/behavior-test settings-controls` | `confirmed-live` (carry-forward) | run logs are Flight-Director-driven | Out of this flight's scope; note for a future verification pass |
| Per-site Shields overrides (more-strict-only) | `confirmed-live` (future) | mission Known Issues | Future flight; not this one |

**Carried into this flight**: the "Site settings →" rewire (leg 4) + the three on-surface debt items (legs
2/3/4 per DD5). **Process lesson applied**: leg specs for the new toolbar icons + pin toggles include
explicit styling criteria + a pre-HAT screenshot check (the Flight-6 HAT lesson). **Assessed + deferred**:
`menuController` graduation (no 4th consumer); Witnessed re-run; per-site overrides.

---

## Flight Director Notes

### 2026-06-08 — Flight start (execution)
- **Phase file**: `.flightops/agent-crews/leg-execution.md` loaded + validated (Crew / Interaction Protocol /
  Prompts present) — same well-formed file used for flights 5–6. Crew: Developer (Sonnet), Reviewer (Sonnet,
  never Opus).
- **Branch**: `flight/7-pinnable-toolbar-items` cut from `main` (post-v0.4.8; flights 4–6 merged + released).
- **Planning baseline**: the Flight-7 planning artifacts (this flight dir + `tests/behavior/toolbar-pins.md`;
  the mission Flight-7 line was already committed during Flight-6 planning) committed at branch start.
- **Legs**: 7 autonomous + 1 optional HAT — pin-state → toolbar-icons-and-pin-apply → toolbar-context-unpin
  → settings-pin-controls → site-settings-rewire → docs → verify → HAT. Operator refinements folded in at
  planning: pin control = pushpin-icon toggle (DD3); right-click pinned icon → native "Unpin" menu (DD7).

### Planning
- **Operator decisions** (Flight-7 planning): icon **+ count badge** (preserve media-count + blocked-tracker
  signal + Shield alert); **unpinned keeps its keyboard shortcut** (toolbar-only removal; re-pin from
  settings); pin toggles in the settings **Appearance** section; **HAT included**. Store shape:
  `toolbarPins: { media, shields }` (generic, merge-on-read for forward-compat).
- **menuController graduation**: assessed at planning — not triggered (no 4th menu/popup consumer this
  flight). Stays deferred per the Flight-5/6 debriefs.

---

## Decisions

_(none yet)_

---

## Deviations

_(none yet)_

---

## Anomalies

_(none yet)_

---

## Session Notes

_(none yet)_
