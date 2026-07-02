# Leg: hat-and-alignment

**Status**: completed
**Flight**: [Floating Overlay Find Bar](../flight.md)

## Objective

Operator-verified acceptance of the overlay find bar: a guided on-screen HAT covering the interactive
checks the autonomous apparatus could not drive plus every deferred-to-HAT item from legs 1–3, then
the `find-overlay-geometry` Witnessed run and the `npm run a11y` gate in an admin-wired session.

## Context

This is an interactive HAT leg — the human performs verification; the Flight Director guides one step
at a time and fixes failures inline (spawning a Developer if code changes are needed) before moving
on. Acceptance = verification steps below, not implementation tasks. Legs 1–3 are committed
(`433755b`); any HAT fixes land as new commits on the flight branch.

**Deferred-to-HAT accumulator being discharged here** (from the legs 1–3 flight-log entries):
physical-keyboard find flow; ✕ pointer close; on-screen `0/0`; maximize + DPR≠1 positioning;
transparent-corner/theming judgment; unfreeze non-refocus judgment (deliberate accept-or-fix);
guest-side Ctrl+F on an internal tab; **the pre-existing WSLg find cold-start anomaly** (blank
count/highlights on the FIRST query after load / fresh session / restore — logged in all three legs,
A/B-isolated as pre-existing; interactive confirmation deferred here); the dev-gate empty-seed gap is
RETIRED (Leg 3 restores per-tab text — verify it as part of restore, not as a gap).

**Cold-start disposition (applies to steps 1, 5, 7):** if the count is blank on a FIRST query or on a
restore, press Enter (or step) once to warm it. Warm behavior correct → record as the known WSLg
cold-start anomaly (a confirmation data point, NOT a step failure). Warm behavior ALSO wrong → real
failure, stop and fix.

## Setup (operator, once)

- `GOLDFINCH_AUTOMATION_ADMIN=1 GOLDFINCH_AUTOMATION_DEV_MINT=1 npm run dev:automation` with a pinned
  free `GOLDFINCH_MCP_PORT`; capture the minted keys (needed for steps 12–13).
- **For step 13 (`npm run a11y`)**: the audit shell needs `export GOLDFINCH_MCP_ADMIN_KEY=<adminKey>`
  (chrome mode), the same pinned `GOLDFINCH_MCP_PORT` visible, and the media fixture served —
  `python3 -m http.server 8000` from `tests/behavior/fixtures/a11y-media/` (if :8000 is squatted,
  serve on another port and pass `--url=http://127.0.0.1:<port>/` — the Leg-3 run hit exactly this
  and used :8123).
- **Apparatus-wiring litmus (before step 12):** `getChromeTarget()` returns this instance's chrome
  wcId and `enumerateTabs()` lists THIS instance's tabs. If it fails, the Witnessed spec parks; the
  on-screen HAT still proceeds.

## Verification Steps

Steps 1–11 are on-screen, physical input. Each is pass/fail by direct observation.

- [x] **1. Basic flow + float tell.** Open a text-heavy web page. Ctrl+F → bar floats top-right OVER
  the page; the page does NOT shift down (compare content position before/after); the find input has
  focus WITHOUT clicking (typing goes straight into it). Type a word present on the page → live `n/m`
  count, highlights visible beneath/around the bar. *(Cold-start disposition applies.)*
- [x] **2. Stepping.** Enter / Shift+Enter and ↑ / ↓ step the active match (count ordinal moves,
  wraps at ends); the ↑/↓ BUTTONS also step, and clicking them does NOT steal focus from the input
  (keep typing without re-clicking).
- [x] **3. No-match + deletion.** Type a nonsense string → `0/0`. Delete back to empty → count blank.
- [x] **4. Close semantics.** Esc closes the bar, match highlight clears, and keyboard focus returns
  to the page (e.g. Space scrolls). Re-open, close via the ✕ button (pointer) — same result.
- [x] **5. Per-tab restore with live text.** Tab A: find "foo". Open tab B (different page): find
  "bar". Switch A→B→A — the bar re-opens on each with ITS OWN last-typed text and a live count
  *(cold-start disposition applies to the count on restore)*. Esc on A, switch away and back — A
  stays closed (no ghost reopen).
- [x] **6. Chrome-focused Ctrl+F.** Click into the address bar, press Ctrl+F → the overlay opens and
  the find input (not the address bar) has focus.
- [x] **7. Internal tab.** On `goldfinch://settings`: Ctrl+F does nothing (both with the page focused
  and with the chrome focused); switching web→internal removes the bar with zero visual artifact;
  switching back restores it (find was open).
- [x] **8. Menu freeze.** With find open, open the kebab menu → bar disappears while the menu is up;
  close the menu → bar returns with text + count intact. Repeat with a right-click page context menu
  and once with the container (▾) picker (site-info is the fourth freeze consumer — optional).
  **Judgment item (unfreeze focus):** after the menu closes, does the find input need a click before
  typing again? Operator verdict: accept as parity, or file for fix.
- [x] **9. Geometry tracking.** With find open: resize the window (drag edge), maximize, restore,
  toggle the media panel and the Shields panel — the bar stays anchored top-right of the page area
  through all of it (small settle lag during the panel CSS transition is accepted — pre-existing).
- [ ] **10. DPR ≠ 1** *(if the display setup allows a scale change; else record not-run)*: at
  125%/200% scaling the bar sits correctly, not offset or clipped.
- [x] **11. Theming judgment.** Corners/shadow of the floating bar: acceptable as rendered?
  (Transparent-corner rendering may be opaque on WSLg — flight-accepted variation; refine only if
  the operator wants it.)
- [x] **12. Witnessed spec.** Wiring litmus (Setup), then `/behavior-test find-overlay-geometry` →
  PASS (or operator-accepted known issue recorded with the run-log path). The spec carries the
  overlay-wcId-probe apparatus technique (added at this leg's design review). After the run: set the
  spec's `Status` → `active` and `Last Run` fields.
- [x] **13. a11y gate.** `npm run a11y` (against this wired instance) → no NEW violations.

## Completion

- All steps pass (or operator-accepted dispositions recorded per step in the flight log)
- HAT fixes (if any) committed as new commits — no amend
- **Resolve the flight's last Open Question** (overlay `readDom` access vs `captureWindow` + bounds
  tell): Legs 2–3 already produced the answer — the overlay wc IS directly drivable/readable by
  wcId via the probe technique. Record the resolution against step 12's run and tick the question in
  flight.md.
- Flight-log Leg Progress entry for this leg; status here → `landed`

## Files Affected

None planned (verification only); fixes, if any, get their own scope at fix time.
