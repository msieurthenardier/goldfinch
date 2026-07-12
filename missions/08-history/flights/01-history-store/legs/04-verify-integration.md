# Leg: verify-integration

**Status**: completed
**Flight**: [Per-Jar History Store](../flight.md)

## Objective

Verify the flight's work end-to-end in the real app (recording, burner and
internal exclusion, restart survival — via `/behavior-test history-recording`),
probe search latency at scale (~50k rows, uncommitted scratch script), and
land the documentation the flight owes (CLAUDE.md history section; README
untouched unless user-visible claims changed — none did this flight).

## Context

- Legs 1–3 landed (uncommitted): store, recorder + wiring + retention field,
  IPC twins + preload. Suite 1376/1376 ~1.1s; typecheck/lint clean.
- The behavior-test spec `tests/behavior/history-recording.md` was authored
  at flight design (status `draft`) and Architect-reviewed (kebab-Exit quit
  path pinned). The Flight Director runs it via `/behavior-test` — NOT a
  Developer task.
- Flight DD1 requires the decision record to be discoverable: CLAUDE.md gets
  a history-store section (substrate ruling + experimental-API cost + the
  Electron-bump re-verify rule), pointing at flight.md DD1.

## Split of work

**Developer part (this leg's spawned agent):**
1. **Scale probe** (uncommitted, scratch): script in /tmp seeding ~50k rows
   across 3 jars via `history-store` `open()` on a temp dir, then timing
   `search(jar, 'exa')`-style prefix queries and `listRecent` (10 runs,
   report median/max). Record numbers in the flight log. Informal bound:
   single-digit ms median for search. Delete the temp dir after.
2. **CLAUDE.md**: add a "History store (`src/main/history-store.js`)"
   section alongside the Settings-store section covering: node:sqlite
   substrate ruling + M03-style decision record pointer (flight DD1) +
   ExperimentalWarning acceptance + "every Electron major bump re-runs the
   store suite" rule; the recording pipeline (wireTabViewEvents partition
   threading, recorder decision gates, positive registered-jar allowlist,
   burner/internal structural exclusion); retentionDays on the jar record +
   prune cadence; `history-changed { jarId }` invalidation contract;
   history-ipc twin channels + static error-string contract; the
   history.db WAL file family under userData; plus a one-line note on the
   two live-probed sqlite gotchas (never mix bare `?` with numbered
   placeholders; default unicode61 tokenizer — no tokenchars override or
   prefix search silently breaks) in the spirit of the "real-boot defect
   classes" block *(design review suggestion)*.
3. Flight-log entry for the leg (probe numbers, docs delta).

**Flight Director part (after the Developer returns):**
4. Run `/behavior-test history-recording` against the built app
   (`npm run dev:automation` + mint envs per the spec's preconditions).
   Pass → spec status `draft → active`, run log committed with the flight.
   Fail → fix cycle before the flight-level review.

## Acceptance Criteria

- [x] Scale probe executed; median prefix-search latency at ~50k rows
      recorded in the flight log (informal bound: ≤ single-digit ms).
      *(51k rows: search median 2.05–2.2ms, max 2.8ms; listRecent ~0.1ms)*
- [x] CLAUDE.md history section added (content list above); no other doc
      claims stale.
- [x] `/behavior-test history-recording` run: verdict **pass** (8/8, first
      run, live two-agent mode); run log at
      `tests/behavior/history-recording/runs/2026-07-12-19-37-28.md`;
      spec status → `active`.
- [x] `npm test` / typecheck / lint still green after doc edits (1376/1376,
      ~1.05s).

## Files Affected

- `CLAUDE.md` — new section
- `missions/08-history/flights/01-history-store/flight-log.md` — entries
- `tests/behavior/history-recording.md` — status flip after pass
- `tests/behavior/history-recording/runs/*` — run log (created by the run)

---

## Post-Completion Checklist

- [x] All acceptance criteria verified
- [x] Update flight-log.md with leg progress entry
- [x] Set this leg's status to `landed`
- [x] Do NOT commit (flight-level review + commit follows immediately)

## Citation Audit

References are to flight-internal artifacts and legs 1–3 outputs verified in
prior leg audits; no new line-form source citations introduced.
