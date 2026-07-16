# Flight Log: HAT & Alignment

**Flight**: [HAT & Alignment](flight.md)

## Summary

Operator-guided human acceptance test — the mission's closing gate. The Flight Director presents each
station's steps, the operator performs them on their live rig, the FD renders verdicts and fixes issues
inline (look-and-feel) or via scoped review (features) until the operator confirms alignment. Not
autonomous — the FD's session has no live rig (F9 DD9 NO-GO), so the operator drives execution.

---

## Flight Director Notes

- **Branch/stack:** `flight/10-hat-and-alignment` off the F9 head; stacks on `flight/9`.
- **Kickoff (operator):** scope = **full sequential A→F**; mode = **operator runs BY HAND** (the FD
  guides + validates + fixes; the operator is the instrument). Most stations need only the running dev
  build off `flight/10`; the automation MCP/admin key is needed only for Station E's `npm run a11y` and
  any exact-readout step the operator chooses to script. Flight → in-flight; starting Station A.

---

## Leg Progress

### Station A — Session restore (in progress)

**Checkpoint A1 — core restore + burner exclusion: PASS (with one inline cosmetic fix).**
- **Core restore PASS:** operator enabled the setting, opened tabs across two persist jars + a burner,
  quit, relaunched → **exactly the two persist-jar tabs returned** at their addresses/jars and the
  **burner did NOT** (the mission's absolute constraint, witnessed live for the first time on disk).
- **Internal-page exclusion — by design, confirmed with operator ("probably ok").** The open
  `goldfinch://settings` tab did **not** restore. This is correct: internal pages are `trusted`, and the
  snapshot's positive persist-jar allowlist drops trusted tabs by the same mechanism that drops burners
  (no persist jar to belong to). Recorded as a conscious design consequence — restore brings back web
  content in real jars, not internal chrome pages. If restoring internal pages is ever wanted, that is a
  scoped FEATURE change (include trusted tabs with URL-but-no-jar), not a defect.

**Inline fix (look-and-feel, single-surface → inline protocol): the toggle was child-indented.**
- Operator: *"the toggle is misaligned; it should be on its own line, it looks like a subtask of Home
  page."* Root cause: the row was cloned as a bare `.shield-row`, so `.shield-row:not(.shield-parent)`
  applied the 14px child indent (settings.css:196) — the exact divergence the flight-end accessibility
  review predicted. This is the standalone-control case the CSS already documents for spellcheck
  (settings.css:200: "standalone control, not a Shields child: divider above + no indent").
- **Fix:** added `.startup-toggle-group` (divider above + top margin) and `.startup-toggle-row`
  (no indent) in `settings.css`, applied to the restore fieldset/row in `settings.html`. Scoped to the
  startup section — spellcheck untouched. Re-verify pending operator reload.

---

## Decisions

_(fix-vs-feature rulings and runtime decisions appended as they arise)_

---

## Anomalies

_(issues surfaced during the walkthrough)_
