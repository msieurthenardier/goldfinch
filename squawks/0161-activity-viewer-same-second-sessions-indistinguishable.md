# Squawk 0161: Activity viewer can't tell apart two sessions opened in the same second

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-10-24
**Completed**: 2026-11-19

## Report
The Automation page's active-sessions list (`#automation-active-sessions`) renders each session as kind, name and "connected since `<h:mm:ss>`". It shows no session id. Two sessions of the same kind and identity opened in the same second render as identical rows. For example, two admin sessions both read "ADMIN · app / chrome · connected since 6:30:29 PM". An operator can't tell which one to worry about, and the `settings-automation` spec's "identify the staged session by sessionId/since" assertion can't be met in the UI. Found in that run's Step 12, which was judged partial on identification.

## Evidence
- `src/renderer/pages/automation.js` session-row renderer (`since.className = 'activity-since muted'`, `since.textContent = 'connected since ' + fmtTime(s.since)`, ~L766). No id or other distinguishing field is rendered.
- `tests/behavior/settings-automation/runs/2026-10-23-23-19-44.md` Checkpoint 12 (identification partial) and Validator spec feedback item 2.

## Corrective Action
Operator ruling (2026-11-19): each active-session row shows the first 8 characters of the session id (e.g. `ADMIN · app / chrome · a1b2c3d4 · connected since 6:30:29 PM`). No main, snapshot or IPC change; the page already received the full `sessionId` (`audit-log.js` `activeSessions()`).
- `src/renderer/pages/automation-session-row.js` (new, pure): `sessionIdPrefix` (null for a missing/empty/non-string id), `SESSION_ID_PREFIX_LENGTH = 8`.
- `src/renderer/pages/automation.js` `renderSessions`: adds a `span.activity-session-id.muted` (textContent only) between name and since, only when the prefix is non-null.
- `src/renderer/pages/automation.css`: one rule `.activity-session-id` (monospace, `flex: 0 0 auto`).
- Wiring for the new module: `internal-page-map.js` automation route, `eslint.config.mjs` module list, pins updated in `internal-page-map.test.js` and `automation-page-shared-scripts.test.js`.
- Spec text: `tests/behavior/settings-automation.md` Step 12 Expected Result now names the 8-char id prefix as how the staged admin row is identified (wording only; spec not run).

## Verification
Add a unit test that two sessions with equal kind, name and `since` render distinguishable rows. Re-run `settings-automation` Step 12 and identify the staged admin row in the UI. If rendering a session identifier needs a ruling (what to show; whether a session id is safe to display), escalate to a sortie rather than decide inline.

Ran (no live run; the Step 12 re-run is the Flight Director's): `node --test` on the three touched/new test files: 20 pass, 0 fail (new `automation-session-row.test.js`: 5 tests). Neuter-verified: `slice(0, 0)` made 3 of 5 fail; dropping the `typeof` guard made 1 fail; both restored. `npm test`: 7428 tests, 7423 pass, 0 fail (5 skipped/other non-fail). `npm run lint` clean, `npm run typecheck` clean, `npm run format` then `format:check` clean.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the sixth 2026-11-19 turnaround)
**Verdict**: confirmed, no issues, following the operator ruling of 2026-11-19 (the first 8 characters of the session id). Exact route on the automation host, eslint entry, and the pinned-list tests updated; route-closure and host-drift guards green. **Live**: three admin sessions opened in the same second rendered three distinct prefixes (all `connected since 6:44:31 PM`). Gates at re-review: `npm test` 7,430 tests (7,425 pass, 0 fail, 1 skipped — the `jq` test — and 4 todo); lint, typecheck and format:check clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-f`
