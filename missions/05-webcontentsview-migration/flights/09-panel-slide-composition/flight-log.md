# Flight Log: Side-Panel Slide Composition (#27 / SC10)

**Flight**: [Side-Panel Slide Composition](flight.md)

## Summary

Planning began 2026-07-06. Focused SC7/#27/SC10 flight, inserted as Flight 9 (operator decision) —
the mission's tentative plan folded panel work into Flight 6 (bundled with parity-sweep + land); this
is the panel-slide piece pulled out as a small, verify-first flight, matching the F7/F8 insertion
pattern.

---

## Reconnaissance Report (Phase 1b)

Source: the mission's SC7 + Mission-04 Flight-6 (`missions/04-browser-conveniences/flights/06-polish-and-mcp-hygiene/`)
#27 record.

| Item | Classification | Evidence | Recommendation |
|------|----------------|----------|----------------|
| #27 = side-panel **overlay** over guest? | `already-refuted` | The M04 record is explicit: "#27 — side-panel open-**animation** glitch; `#media-panel` animates `width 0.18s` + `margin-right`; both `.collapsed {width:0}`." Not overlay-vs-inset. | Framed correctly as the slide animation (DD1). |
| M04 `slidePanel`/transform-composited fix | `reverted` | `togglePanel` (`src/renderer/renderer.js`) now only toggles `.collapsed`; no `slidePanel`/`slideState`/`beforeReveal` in source (grep-clean). The transform machinery was reverted at the M04 Flight-6 HAT (mission Context: "three CSS mechanisms failed identically"). | Current state = plain CSS `width 0.18s` slide (`styles.css:558-560`) + per-frame guest re-bound via the `#webviews` `ResizeObserver` → `sendActiveBounds` (`renderer.js:2614`, `:937`). This is what Leg 1 verifies on the native surface. |
| F1 spike SC7 prediction | `needs-live-verify` | Mission Flight-1 line: "#27 mis-composite does not reproduce under native views; SC7 looks free." | The premise this flight tests; not yet verified on the shipped surface since the M04 revert. |
| Privacy-panel asymmetry (M04) | `confirmed-live-risk` | M04 log: "Media smooth, Shields glitches, despite identical CSS — Shields content population *during* the slide." | DD3: exercise privacy WITH populated body. |

**Current panel mechanism (verified in source, 2026-07-06):** `#media-panel`/`#privacy-panel` are
`flex:none` chrome-DOM siblings of `#webviews` in `#main` (`display:flex`); `.collapsed {width:0}` →
`width: var(--panel-w)` (360px) with a `width 0.18s` CSS transition; the `#webviews` `ResizeObserver`
fires `sendActiveBounds()` (debounced one-shot rAF) which re-bounds the active guest to
`measureWebviewsSlotDIP()` as the slot resizes. No overlay view involved. **Chrome view is opaque and
below the guests** (`main.js:860/863` add chrome first, `#1e1f25`; guests added after) — which is why
panels must inset, not overlay (DD1). No source changes required unless Leg 1/2 find a glitch (Leg 3).

---

## Flight Director Notes

### 2026-07-06 — Flight planning

- Operator clarified the intent: panels must **compress the content side-by-side, not overlay it** —
  which reframed the flight entirely (my initial framing offered the overlay migration, which the
  operator does not want). #27/SC10 confirmed via the M04 record to be the **slide animation**
  smoothness, not overlay-vs-inset — a much smaller, better-aligned flight.
- Decisions: **focused Flight 9 (panel-slide only)** (defer F5 parity + macOS + land);
  **verify-and-certify (minimal)** — fix only if a glitch surfaces.
- Scope kept to CSS/animation + guest-bounds-sync; no overlay view, no shared-overlay-base extraction
  (that F8-debrief item is unrelated and stays a separate maintenance concern).
- `panel-slide` Witnessed spec drafted (status draft) — settled-state compositing net; smoothness is
  HAT-authoritative (DD4 apparatus limit).

---

## Leg Progress

*(none yet)*

---

## Decisions

*(none yet)*

---

## Deviations

*(none yet)*

---

## Anomalies

*(none yet)*

---

## Session Notes

### 2026-07-06 — Planning

- Flight spec + `panel-slide` behavior spec drafted; recon report above.
- Architect design review: **approve with changes** — zero design flaws; all issues spec/recon
  accuracy. Applied: [HIGH] `panel-slide` step-4 false-passed the privacy-population goal
  (`renderPrivacy` always appends its ~8 sections, so a child-count check on the static fixture is
  trivially true; the real M04 asymmetry is async-populate-during-open, an inter-frame property) →
  reframed to require a **real tracker-heavy page** with a non-zero stat signal + moved the
  async-reflow concern to the Leg-2 HAT (DD3 rewritten). [MEDIUM] transition duration corrected
  `0.2s` → **`0.18s`** in the recon report + spec (the `0.2s` was the unrelated toast bar,
  `styles.css:889`). [LOW] keyboard-toggle path (Ctrl+M/Ctrl+Shift+P at `renderer.js:2354-2360`
  skips the explicit `sendActiveBounds`) → added to the Leg-2 HAT (DD6). Suggestions folded:
  DD6 records the structural ~1-frame guest-bounds IPC lag (why "free" must be earned at CP1/CP2,
  not rubber-stamped, and why Leg 3 is pre-authorized); find/menu-overlay-simultaneous-with-panel
  noted out-of-scope in the spec. Reviewer confirmed DD1 (chrome opaque + below guests → panels
  MUST inset), the M04 revert (grep-clean), and the apparatus on both axes.
- FD call: issues were prescribed accuracy corrections applied faithfully, no new design surface →
  second review cycle skipped. Flight → `ready` (pending operator walkthrough).
