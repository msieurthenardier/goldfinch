# Leg: hat-and-alignment

**Status**: completed
**Flight**: [Crash and Hang Resilience](../flight.md)

## Objective

Walk the operator through the flight's surfaces by eye — the one clause the
apparatus could not observe first — and align look, feel, and wording;
fixes ride the inline protocol, behaviour changes route through the
fix-vs-feature gate.

## Context

- Operator-elected small HAT leg (flight planning ruling). The acceptance
  run (`tests/behavior/crash-and-hang-surfaces/runs/2026-09-17-00-22-28.md`)
  left ONE clause for the eye: row 6's "the guest remains visible" under a
  stopped renderer. Everything else passed or was fixed and re-verified.
- Apparatus facts that shape the walk: SEGV/ABRT do not crash a sandboxed
  guest (use `-KILL`; the `crashed` wording is shown via the
  `showCrashPanelForAudit()` seam for copy review); the frameless window
  has no OS title bar — the paused title is visible only in the taskbar /
  alt-tab (H5 checks whether that is enough).
- The Flight Director drives signals through the attach client with an
  env-only admin key; the operator only looks and clicks.

## Verification Steps (operator, one at a time)

- [x] H1 Hang bar over a stopped renderer — the page stays painted under
      the bar (row 6's by-eye clause); Wait hides the bar; CONT clears it.
- [x] H2 Crash panel wording — `killed` (real SIGKILL) and `crashed`
      (synthetic via the audit seam); Reload revives the real one with
      history.
- [x] H3 Real hang (busy.html) — bar appears while the loop runs; Kill and
      reload brings the page back without a crash panel.
- [x] H4 Chrome crash — strip/toolbar rebuild with every tab and the same
      active tab; open guests untouched.
- [x] H5 Crash loop — after the fourth crash in a minute the window pauses;
      is the paused state perceivable (taskbar/alt-tab title)?
- [x] H6 Crash records — the operator reads the tail of `crash-log.jsonl`
      and the dump directory listing: nothing but the eight fields, host-only
      origins.
- [x] H7 Look and feel — panel, bar, strip glyphs; operator opinions.

## Files Affected

- flight log, `flight.md`, this leg; any inline fix's own files.
