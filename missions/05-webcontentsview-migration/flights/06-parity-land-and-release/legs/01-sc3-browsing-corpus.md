# Leg: sc3-browsing-corpus

**Status**: landed
**Flight**: [Parity Sweep, Mission Landing & v0.6.0 Release](../flight.md)

> **Outcome (2026-07-08): SC3 parity PASS — 8/8 specs + DD9 OFF-branch witnessed.** No regressions. Spec-drift
> (settings-shell step 10/11) → Leg 2 reconciliation; pre-existing tensions (axe-on-internal a11y gap;
> admin-allowInternal drivability) → debrief. Two transient 529s during the run; recovered via backoff+retry.
> Details in flight log.

## Objective
Certify SC3 — browser-behavior parity — by running the browsing / tab-strip / chrome-UI behavior-test corpus on
the native `WebContentsView` surface, plus the DD9 mint-gate OFF-branch positive-witness carried from F5.

## Specs (this leg)
- `core-browsing-shields`, `unified-tab-controls`, `responsive-tab-strip`, `tab-keyboard-operability`,
  `settings-shell`, `settings-controls`, `settings-activity-viewer`, `toolbar-pins`.
- **DD9 mint-gate OFF-branch witness** (F5 carry-forward): with the dev profile's `automationEnabled` set
  **false**, confirm the "Enable automation surface" toggle renders OFF and every mint button is DISABLED.

## Acceptance Criteria
- [ ] All 8 specs PASS on the native surface (or triaged: real regression → fix-and-rerun; WSLg-venue → recorded).
- [ ] DD9 OFF-branch witnessed (toggle OFF + mint disabled when persisted-false).
- [ ] Per-spec run logs under `tests/behavior/{slug}/runs/{ts}.md`; raw/pixel evidence in the ephemeral dir.
- [ ] SC3 called: browser-behavior parity holds on the native surface.

## Notes
- Apparatus: admin-wired instance on `GOLDFINCH_MCP_PORT=8899` (49707 Hyper-V-reserved). Executor→Validator model.
- **Pre-classify `settings-activity-viewer`'s known apparatus-limited steps** (pager/freeze) as WSLg-venue-deferred
  so they aren't mistaken for SC3 regressions.
- WSLg venue limits (focus-ring pixel deltas via captureWindow, etc.) → recorded, macOS-authoritative deferred.

## Files Affected
- `tests/behavior/{slug}/runs/*.md`. Source fixes only on a real regression.

---

## Post-Completion Checklist
- [ ] 8 specs + DD9 OFF-branch run; verdicts recorded with evidence
- [ ] Flight log updated (results + any regressions)
- [ ] Leg status → `landed` (no commit — batch-commit at flight end); check off in flight.md
