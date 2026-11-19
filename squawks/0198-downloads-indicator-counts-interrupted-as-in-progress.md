# Squawk 0198: The downloads indicator counts an interrupted download as in progress

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-17
**Completed**: 2026-11-19

## Report
A download that ends `interrupted` (for example, it cannot connect) keeps the toolbar downloads indicator in its active state — "Downloading — 1 in progress", class `downloads-active`, a count badge — for the rest of the session, while `goldfinch://downloads` correctly shows the row as "Failed". Electron emits `updated` with `interrupted` and no `done` for a resumable failure, so the record gets no end time until quit (`flushInterrupted`). Seen in Mission 23 Flight 3's `update-notice` spec run (step 7): two interrupted records gave a badge of 2.

## Evidence
- `src/renderer/chrome/downloads-indicator-model.js` — the active / in-progress decision; `src/renderer/chrome/downloads-controller.js` — `btn.classList.toggle('downloads-active', model.active)`.
- Run log `tests/behavior/update-notice/runs/2026-11-17-23-53-08.md`, checkpoint 7 and the Validator's product findings.

## Corrective Action
`src/renderer/chrome/downloads-indicator-model.js`: added `IN_PROGRESS_STATES` (`progressing`, `paused`) and `isInProgressState`. The `progress` reducer case now deletes the id from `inFlight` when the state is not in progress (an `interrupted` record) instead of upserting it; a later `progressing` (resume) re-adds it. The `hydrate` case skips `active` rows whose state is not in progress (main marks `active: entry.endTime == null`, `register-download-ipc.js`). `paused` counts, matching `goldfinch://downloads` (`src/renderer/pages/downloads.js` `IN_PROGRESS_STATES`, which labels `interrupted` "Failed"); that file is a classic script so the set is restated, not imported. An interrupted record never enters `recent` (only `completed` does), so it falls in no other bucket; `deriveModel`'s active class, badge, aria label are all driven from `inFlight`. Main's records are unchanged.

## Verification
A model unit test: a record in state `interrupted` (no end time) does not count as in progress; a `progressing` one still does. The downloads page and indicator agree.

Ran: `node --test` on downloads-indicator-model + downloads-controller tests: 34 pass, 0 fail (4 new model tests: interrupted not in progress, progressing-then-interrupted-then-resume, one of each counts 1, hydrate skips interrupted active row). `npm test`: 7393 pass, 0 fail. `npm run lint` clean, `npm run typecheck` clean, `npm run format` then `format:check` clean.

Added: a source-scan drift guard in `downloads-indicator-model.test.js` asserting the model's `IN_PROGRESS_STATES` equals the one in `pages/downloads.js` (throws if the literal is not found).

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the fourth 2026-11-19 turnaround)
**Verdict**: confirmed. An `interrupted` record leaves `inFlight` and is skipped at hydrate, and lands in no other bucket; neuter (adding `interrupted` to the set) fails four tests. One medium finding — the model restated `pages/downloads.js`'s `IN_PROGRESS_STATES` with no guard — was fixed with a source-scan drift guard that throws if the literal is missing; neuter-verified both ways (an added state, a renamed literal). Gates at re-review: `npm test` 7,404 tests (7,399 pass, 0 fail, 1 skipped — the `jq` test, no `jq` on the dev host — and 4 todo); lint, typecheck and format:check clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-d`
