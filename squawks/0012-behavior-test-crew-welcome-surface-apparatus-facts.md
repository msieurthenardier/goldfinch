# Squawk 0012: Behavior-test crew file lacks the apparatus facts learned on the Mission 16 Flight 2 runs

**Status**: open
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-25
**Completed**: —

## Report

Six Witnessed runs on 2026-08-25 (`welcome-home-routing`, `search-engine-upgrade`, `welcome-first-launch`, `welcome-search-handoff`, `new-tab-default-routing`, `search-engine-preference`) each rediscovered apparatus facts that the crew file's Project Apparatus Notes (`.flightops/agent-crews/behavior-tests-execution.md`, added by squawk 0008) do not yet carry. Each run's Orchestrator Notes records them; the next run's crew will not read six run logs. Same shape as squawk 0008 — extend the notes, do not restructure the file.

Facts to add:
- A welcome tab (viewless record) is invisible to `enumerateTabs` and reports `activeTabWcId: null` in `enumerateWindows`; the tab strip is read from chrome DOM.
- Allowlisted sheets are **read-only** to automation (`captureScreenshot`/`readDom`/`readAxTree` only); no write op ever resolves a sheet wcId.
- A star click persists a bookmark immediately (`bookmarkAdd`); the bookmark-edit sheet only edits/closes.
- Re-capture the Settings page before every click — the status line's appearance shifts the controls beneath it by ~24 px.
- `scroll` takes `dx`/`dy` (its own error text says `deltaX`/`deltaY`).
- DOM-count probes do not reflect visibility — use hidden-class flags or an a11y-tree scan; `#welcome-surface` `textContent` includes hidden blocks' text.
- A freshly rendered welcome panel shows a focus ring on its first radio — outline only, unchecked per a11y.
- Welcome-surface controls use chrome-relative coordinates (same frame as `#address`); the Settings engine Clear button sits beneath the eighth radio — locate by rect.
- An earlier step's broadcast can shift a later step's cross-window baseline (DD7 auto-attach of the shown welcome tab); say so in the row when it matters.
- Restart-adjacent rows carry an Orchestrator PID attestation (the process holding the profile's `app.db`) by default; the re-minted key hash and wcId renumbering corroborate a real relaunch.
- Google's `/sorry/` anti-automation interstitial appears after repeated scripted searches from one IP; judge on the committed bar plus the rendered title/`continue=` target, and route scripted rows to non-Google engines where the row allows.
- The Executor's closing summary is the one artifact transcript loss can drop — send `[CLOSING]` right after its last report.

## Evidence

- `tests/behavior/*/runs/2026-08-25-*.md` — Orchestrator Notes and closing summaries of the six runs.
- `.flightops/agent-crews/behavior-tests-execution.md` — `## Project Apparatus Notes (goldfinch)` (the section to extend).

## Corrective Action

*(written at completion)*

## Verification

*(written at completion — a fresh Executor briefed from the crew file alone reaches `[READY]` on a welcome-surface spec without rediscovering any of the above)*

## Sign-Off

*(written at completion)*
