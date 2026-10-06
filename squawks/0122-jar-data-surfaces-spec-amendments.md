# Squawk 0122: jar-data-surfaces spec: make the retention premise reachable and pin DD8

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-10-06
**Completed**: 2026-10-06

## Report
On a fresh isolated profile, step 6's aged-data premise can't be reached, so the sweep is a no-op and the step proves little. DD8's per-row delete of a partition duplicate is also never exercised. Amend the spec as the Validator recommended:
- backdate `history.db` visits and `cookie_seen.first_seen_ms` in the isolated profile while the app is closed, then sweep, which makes retention removal, DD8's retention clause and the repaint observable;
- correct the rationale: `cookie_seen` is stamped at set time;
- refresh both panels after the step-6 re-seed;
- require positive evidence that the sweep ran;
- add a DD8 per-row delete of one `js_part` duplicate;
- adopt the isolated-profile pattern in the preconditions;
- fix the DD7 wording against the reveal rider (e07e21a).

## Evidence
`tests/behavior/jar-data-surfaces/runs/2026-10-06-13-24-48.md` (Orchestrator Notes, items 1–7).

## Corrective Action
Amended `tests/behavior/jar-data-surfaces.md` only (no source changes):
- Preconditions: isolated `XDG_CONFIG_HOME` scratch profile replaces dev-profile backup/restore; launch stdout goes to a private `chmod 600` dir; backdating mechanism described (`history.db` `visits.visited_at`, `app.db` `cookie_seen.first_seen_ms`, ms epoch, verified against `history-store.js` / `app-db.js` schemas).
- Step 6 split into 6 (seed + refresh both panels + quit), 6a (backdate C's visits and cookie K's `cookie_seen` row to now-2d while closed), 6b (relaunch, re-capture key, `jarsSetRetention({id:'work', days:1})`; requires positive sweep evidence: `jar-data-changed` classes plus a vanished backdated item; C pruned/cleared, all partition copies of K removed, fresh data survives, panels repaint unaided), 6c (DD8 per-row delete of one duplicate: both rows gone, session read empty, merged `cookie_seen` row removed).
- Cookie-half rationale corrected (`cookie_seen` stamped at set time by the cookies listener in `session-runtime.js`); the HAT-scoped/first-sweep out-of-scope text removed.
- DD7 wording now "no cookie value absent an explicit reveal click" (e07e21a); independent corroboration (page `document.cookie`, fixture log) added to step 2.

## Verification
Spec-only change; behavior test not run (per instructions). Table/column names checked against `src/main/history-store.js` and `src/main/app-db.js`. `npx prettier --write` and `npm run format:check` run on the changed files.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the 2026-10-06 turnaround)
**Verdict**: confirmed, no blocking issues (`npm test` x3 green, lint/typecheck/format:check/audit clean). Electron 44.5.0 and SDK 1.31.0 also live-verified by the third-party-cookie-isolation run 2026-10-06-18-13-21 (pass).
**Commit**: the `squawk: turnaround 2026-10-06` commit on `squawk/turnaround-2026-10-06`
