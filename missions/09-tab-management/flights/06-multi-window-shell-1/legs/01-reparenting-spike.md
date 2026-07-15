# Leg: reparenting-spike

**Status**: completed
**Flight**: [Multi-Window Shell, Part 1](../flight.md)

## Objective

Answer DD1's five spike questions on-platform (WSLg/Wayland) with a
throwaway two-window harness — NO product code. The verdict gates DD5's
primary path (re-parent vs close-and-recreate) and fixes DD7's mechanism
(roam vs recreate-per-switch) and DD8's accessor assumptions before legs
2–4 are designed.

## Spike Questions (DD1 — all five, plus DD4's hook check)

- (guest) `winA.contentView.removeChildView(guest)` →
  `winB.contentView.addChildView(guest)` with a LIVE page (playing video
  or animation, scrolled position): webContents survives, renders in B,
  accepts input, media/scroll state intact. **Mid-motion visual bar**:
  capture the transition (paced screenshots through the swap) and judge
  RENDERED PIXELS — white flash / stale surface / zombie compositor frames
  fail the bar; "DOM correct ≠ render correct".
- (a) Apparatus premise, BOTH axes: from the admin MCP surface, `evaluate`
  (and `readDom`/`captureScreenshot`) against the SECOND window's chrome
  by raw wcId — act AND observe.
- (b) `setBounds` across windows with differing content bounds (resize B
  before adopt; verify the guest lands correctly with B's geometry).
- (c) Overlay-class roaming: a transparent chrome-class WebContentsView
  detached/attached across windows while HIDDEN — survives, renders
  correctly on next show in the new window.
- (d) At window `close` vs `closed`: are guest webContents still alive and
  `navigationHistory` readable? (DD4's capture hook — `close` presumed
  safe, verify; check `closed` too so the finding is complete.)
- (e) `BaseWindow.getFocusedWindow()` and programmatic `win.focus()` under
  WSLg with injected (non-physical) input: does getFocusedWindow return
  null/stale? Do window `focus` events fire on programmatic focus?

## Method Constraints

- Throwaway harness only: a standalone script (e.g. run via
  `npx electron <scratch>/spike-main.js` from the repo so the electron
  binary resolves) or a temporary branch-local file DELETED before the leg
  lands — the repo must be byte-identical after the spike (`git status`
  clean).
- Screenshots/captures go to the ephemeral evidence area
  (`/tmp/behavior-tests/goldfinch/f6-spike/…`), never the repo.
- The apparatus premise (a) needs the REAL app (dev:automation, two
  windows) — but F6 hasn't built New Window yet. Acceptable substitute:
  verify from the harness that a second window's chrome webContents gets a
  distinct wcId and is scriptable; verify the MCP resolve tier separately
  by static trace (resolve.js admin relaxation) + a single live probe
  against the running app's EXISTING extra views (the sheet probe-walk
  precedent proves non-tab wcIds resolve at admin tier — cite it). Record
  the residual risk if any.

## Acceptance Criteria

- [x] All six questions answered with evidence (captures for the visual
      bar; error/return transcripts for the API probes).
- [x] Verdict recorded in the flight log: DD5 primary path GO/NO-GO;
      DD7 roam vs recreate; DD4 hook confirmed (`close` or fallback);
      DD8 focus facts.
- [x] Repo byte-identical (no product code, no committed harness).
- [x] Flight log leg entry with findings; leg → landed.

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Do NOT commit — the flight commits once after review
