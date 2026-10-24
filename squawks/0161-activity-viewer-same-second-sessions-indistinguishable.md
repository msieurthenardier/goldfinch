# Squawk 0161: Activity viewer can't tell apart two sessions opened in the same second

**Status**: open
**Type**: defect
**Severity**: routine
**Reported**: 2026-10-24
**Completed**: —

## Report
The Automation page's active-sessions list (`#automation-active-sessions`) renders each session as kind, name and "connected since `<h:mm:ss>`". It shows no session id. Two sessions of the same kind and identity opened in the same second render as identical rows. For example, two admin sessions both read "ADMIN · app / chrome · connected since 6:30:29 PM". An operator can't tell which one to worry about, and the `settings-automation` spec's "identify the staged session by sessionId/since" assertion can't be met in the UI. Found in that run's Step 12, which was judged partial on identification.

## Evidence
- `src/renderer/pages/automation.js` session-row renderer (`since.className = 'activity-since muted'`, `since.textContent = 'connected since ' + fmtTime(s.since)`, ~L766). No id or other distinguishing field is rendered.
- `tests/behavior/settings-automation/runs/2026-10-23-23-19-44.md` Checkpoint 12 (identification partial) and Validator spec feedback item 2.

## Corrective Action
*(written at completion)*

## Verification
Add a unit test that two sessions with equal kind, name and `since` render distinguishable rows. Re-run `settings-automation` Step 12 and identify the staged admin row in the UI. If rendering a session identifier needs a ruling (what to show; whether a session id is safe to display), escalate to a sortie rather than decide inline.

## Sign-Off
*(written at completion)*
