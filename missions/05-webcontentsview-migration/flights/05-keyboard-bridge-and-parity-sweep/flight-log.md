# Flight Log: Cross-View Keyboard Bridge & Admin-Wired Parity Sweep

**Flight**: [Cross-View Keyboard Bridge & Admin-Wired Parity Sweep](flight.md)

## Summary
Planning. Flight sources the Flight-4 Leg-4 deferral (convenience corpus + a11y) and the mission's named
"automation parity sweep" (SC6), draining both in one admin-wired session, and lands the F8-HAT keyboard-bridge
Known Issue that blocks corpus runs crossing the chrome/guest boundary.

---

## Reconnaissance Report

Source artifacts walked against current code (2026-07-07): the **Flight-4 debrief** action items + the
**mission Known Issues** + the mission's F5/F6 roadmap. Classification per `/flight` Phase 1b.

| Item (source) | Classification | Evidence (repo state) | Recommendation |
|---|---|---|---|
| Run deferred convenience corpus + a11y in an admin-wired session (F4 rec #1) | `confirmed-live` | No run logs on the new surface; `npm run a11y` not run since F4 Leg 2 | Core of this flight (conveniences + a11y legs) |
| Apparatus-wiring litmus as a pre-leg gate (F4 rec #2) | `confirmed-live` | The F4 blocker: MCP client jar-authed to a foreign instance; no litmus gate exists in the flow | Leg 1 (DD2) — hard gate |
| Multi-`WebContentsView` keyboard/focus bridge (mission Known Issue, F8 HAT) | `confirmed-live` | Guest `before-input-event` set at `src/main/main.js:998` captures F12/zoom/print/find/downloads/devtools but **not Ctrl+L or Tab**; DD13 template exists (`src/shared/sheet-accelerator.js`, forwarding at `main.js:385`) | Leg 2 — full three-gap fix (operator-approved into F5) |
| CLAUDE.md conventions: focus-then-send + `isWebTab()`/`isInternalTab()` (F4 rec #3) | `confirmed-live` | Neither string present in `CLAUDE.md` (grep: 0 hits) | Fold into housekeeping leg (DD5) |
| Stale `will-attach-webview` comments | `confirmed-live` | `renderer.js:956` ("Leg 4 removes will-attach-webview / webviewTag"), `internal-preload.js:4`, `settings-store.js:64` | Fold into housekeeping leg (DD5) |
| Plan Flight 7 (F4 rec #4) | `already-satisfied` | Flight 7 LANDED 2026-07-02 (floating overlay find bar) | Retire — done |
| Behavior-test AUTHORING promotions (F4 rec #5, `captureWindow` WSLg-fallback hierarchy) | `needs-human-recheck` | Mission-control-side methodology doc, not this repo | Out of scope here; methodology item |
| Repo-wide `<webview>`→`WebContentsView` terminology sweep (mission Known Issue) | `confirmed-live` (parked) | ~15 specs call the guest a "`<webview>` guest" in prose; `webview-preload.js:1-5` header drift; **zero** `sendToHost` in specs → no functional dependency | **Parked** for F6/maintenance (DD5) — prose only |
| Spec functional `<webview>` dependency (mission constraint: "element-routed find in mcp-* suite") | `already-satisfied` | `sendToHost`: 0 hits across `tests/behavior/*.md`; every spec drives by `wcId` via the MCP client (survives migration) | No functional spec rewrites expected; confirm per-spec on run |
| find `find-in-page.md` WSLg cold-start question | `needs-human-recheck` | Spec flags the open question at `find-in-page.md:15`; defensive retry ported (F4 Leg 1) | Answer on run; update spec |
| Flight-6 macOS gate additions (F4 action item) | `confirmed-live` (F6) | macOS unverified since F3; find-focus + `activeViewWcId` delta + now the keyboard bridge all mac-unverified | Carry to **F6** macOS gate — not this flight |

**Presented to operator; scope confirmed** (2026-07-07): F5 boundary = the admin-wired apparatus corpus
(SC6 + SC4 + SC5-apparatus); F6 = browsing/tab/chrome + macOS + merge. Keyboard bridge folded into F5 as a
prerequisite (blocks corpus runs). See flight.md DD1–DD7.

---

## Leg Progress

_(none yet — planning)_

---

## Decisions

_(runtime decisions recorded here during execution)_

---

## Deviations

_(none yet)_

---

## Anomalies

_(none yet)_

---

## Session Notes

- **2026-07-07** — Flight planned via `/flight`. Reconnaissance walked the F4 debrief + mission Known Issues
  against current code (report above). Four planning decisions locked with the operator: (1) Leg-1 apparatus
  bring-up + wiring litmus; (2) full three-gap keyboard fix; (3) new `chrome-guest-keyboard-nav` Witnessed spec;
  (4) fold small F4 housekeeping, park the terminology sweep. New behavior spec drafted:
  `tests/behavior/chrome-guest-keyboard-nav.md`.
- **2026-07-07 — Architect design review (Phase 5b): approve-with-changes.** All premises verified against real
  code (guest `before-input-event` set `main.js:998` lacks Ctrl+L/Tab ✓; DD13 mapper `sheet-accelerator.js` maps
  `l→focus-address` ✓; apparatus real ✓; zero functional `<webview>` spec dependency ✓). Four fixes applied:
  (1) **[HIGH]** the keyboard-nav spec read focus via `readDom`→`activeElement`, but `readDom` returns only
  `{url,title,html}` and doesn't serialize `activeElement` — rewrote focus observables to `evaluate` +
  `readAxTree` (+ `typeText` typeability proof). (2) **[MED]** `pressKey` chord notation fixed to
  `pressKey(G,"l",["control"])` (name + separate modifiers array). (3) **[MED]** DD3 now states the OS-focus
  requirement (`getChromeContents().focus()` — the sheet branch is *not* a copyable template; it omits `.focus()`).
  (4) **[MED]** DD1 rationale corrected — F6 also needs the admin apparatus; the split is thematic + fix-keyed,
  not "only F5 needs it." Suggestions folded: DD3 narrowed to the named gaps (not the full accelerator union —
  avoids seizing guest Ctrl+R reload); Tab handoff flagged as guest-specific (do NOT edit the shared mapper,
  which returns `null` for Tab by design); internal-tab Ctrl+L intent + deterministic Tab target added as
  leg-design Open Questions.
