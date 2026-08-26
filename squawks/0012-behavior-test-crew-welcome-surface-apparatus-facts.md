# Squawk 0012: Behavior-test crew file lacks the apparatus facts learned on the Mission 16 Flight 2 runs

**Status**: completed
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-25
**Completed**: 2026-08-25

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

Extended `.flightops/agent-crews/behavior-tests-execution.md`'s
`## Project Apparatus Notes (goldfinch)` section (now lines 164–298) with the
twelve facts from the six 2026-08-25 runs, in the section's existing style —
one bullet per fact, each ending in a `— see tests/behavior/<slug>/runs/<ts>.md
(…)` citation to the run that recorded it — merging three into existing
bullets per the Flight Director's mapping and adding six new bullets:

- **Sheets** bullet (line 185) gained the read-only clarification: allowlisted
  sheets admit only `captureScreenshot`/`readDom`/`readAxTree`
  (`allowSheet: true`) — no write op ever resolves a sheet wcId.
- **Coordinates** bullet (line 201) gained welcome-surface chrome-relative
  coordinates and the Settings engine Clear button's rect-based location.
- **Reads** bullet (line 214) gained the DOM-count/`textContent`
  visibility-blindness fact and the unchecked-focus-ring fact.
- **Out-of-band relaunch** bullet (line 231) gained the PID-attestation
  default and the `[CLOSING]`-timing note for Executor transcript loss.
- New bullets added: **Welcome tabs** (line 249, `enumerateTabs`/
  `enumerateWindows` invisibility), **Bookmarks** (line 257, star-click
  persists immediately), **Settings layout shift** (line 264, ~20–24px
  post-Save/Clear shift), **`scroll` parameters** (line 272, `dx`/`dy` vs.
  the CDP `deltaX`/`deltaY` naming), **Cross-window/broadcast baselines**
  (line 279, DD7 auto-attach shifting a later step's baseline), and
  **Anti-automation interstitials** (line 288, Google `/sorry/` judged on
  the committed URL).

Also updated the section's intro sentence (lines 166–169) to list the four
new run slugs (`welcome-home-routing`, `welcome-first-launch`,
`welcome-search-handoff`, `new-tab-default-routing`) alongside the three
already named.

Each code-level claim was verified against source before writing the bullet:
`AUTOMATABLE_MENU_TYPES` (`src/main/automation/resolve.js:53`) and the three
`allowSheet: true` call sites (`src/main/automation/engine.js:222,249,250`,
feeding `resolve.js`'s `admitted` check); the `scroll` tool's `wcId, x, y,
dx, dy` signature (`src/main/automation/mcp-tools.js:309-322`,
`src/main/automation/engine.js:211-212`) against the CDP dispatch's
`deltaX`/`deltaY` naming (`src/main/automation/input.js:364-383`); and
`enumerateTabs`' chrome-DOM-only enumeration path
(`src/main/automation/tabs.js:98-131`) that gives a viewless welcome record
no row. No other file was touched; the `## Prompts` section and all protocol
text are unchanged (confirmed via `git diff` — a single contiguous hunk
inside `## Project Apparatus Notes (goldfinch)`).

## Verification

- `git diff --stat .flightops/agent-crews/behavior-tests-execution.md` shows
  one file changed, 97 insertions / 7 deletions, and `git diff` shows a
  single hunk spanning lines 164–298 (the Project Apparatus Notes section) —
  `## Prompts` and everything after it is byte-for-byte unchanged.
- All twelve facts are present, each with its run-log citation, at the line
  numbers listed under Corrective Action above.
- `npm test` — 3765/3765 passing (0 fail, 0 skipped), matching the expected
  count with squawk 0011's uncommitted test changes still in the tree.
- `npm run lint` — clean, no output, 0 errors/warnings.
- This squawk changed only documentation (`.flightops/agent-crews/
  behavior-tests-execution.md` and this squawk file) — no source, test, or
  config files were modified, so a fresh Executor/Validator crew spawn reads
  the extended notes with no other behavior change.

## Sign-Off

**Reviewer**: Reviewer agent (independent, no knowledge of the implementers' reasoning) — one review round, batch turnaround 2026-08-25
**Verdict**: confirmed
**Commit**: `squawk: turnaround 2026-08-25 (0011, 0012)` on `squawk/turnaround-2026-08-25` (PR number recorded on the PR itself)

Reviewer confirmed the diff is confined to the Project Apparatus Notes section (Prompts byte-identical), all twelve facts present with run-log citations (six spot-checked against the run logs), every code claim verified in `src/main/automation/` (`AUTOMATABLE_MENU_TYPES`, the three `allowSheet` read-only sites, `scroll`'s `dx`/`dy`, `enumerateTabs`' chrome-DOM path), no identity leaks. Suite 3765/3765, lint clean.
