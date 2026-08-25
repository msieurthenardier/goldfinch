# Squawk 0008: behavior-test crew file lacks the goldfinch apparatus facts every run rediscovers — and the production-browser MCP warning

**Status**: in-progress
**Type**: servicing
**Severity**: routine
**Reported**: 2026-08-24
**Completed**: —

## Report

`.flightops/agent-crews/behavior-tests-execution.md` carries generic apparatus-discovery guidance only. Two runs (`bookmarks-jar-scoping`, M16 F1's two specs) have each had to rediscover the same goldfinch-specific facts live, and every crew spawn has had to be told by hand not to use the session-registered goldfinch MCP tools. Add a project apparatus-notes section to the crew file (and reference it from both Initial prompts) carrying:

1. **Never use session-registered `mcp__goldfinch*` / `mcp__chrome-devtools*` tools** — the registrations on the dev machine carry statically pinned keys and at least one points at the operator's production browser; drive the instance under test only through an attach-only client with the run's freshly minted key (`scripts/lib/mcp-client.mjs` pattern).
2. **Reaching internal pages**: `openTab` creates untrusted tabs and `navigate` refuses `goldfinch://` by design; the sanctioned route is `evaluate` on the chrome wcId calling the `globalThis` seam (`kebabActionSettings()`, `openJarsPage()`, …).
3. **Sheets**: kebab and page-context menus are outside `AUTOMATABLE_MENU_TYPES`, refused at every tier, and not composited by `captureWindow`; a tab switch dismisses a stuck sheet, a chrome-targeted Escape does not.
4. **Coordinates**: `click` on a tab wcId is guest-viewport-relative — read from `captureScreenshot {wcId}` (1:1), not from `captureWindow` (includes the chrome). `openTab` lands in the last-focused window — focus the intended window first.
5. **Reads**: the address bar's committed URL is authoritative via `evaluate` of `#address.value` on the chrome wcId (a11y textbox nodes may expose no `value`); the Settings home-page textbox's a11y `value` is build/state-dependent — judge from rendered pixels.
6. **Out-of-band relaunch** (`session-restore` procedure, proven 2026-08-24): the MCP transport dies with the process and `GOLDFINCH_AUTOMATION_DEV_MINT` mints a fresh key per boot — the Orchestrator relaunches, re-reads the mint line, rewrites the crew's env, and briefs the restored topology.

Found at the M16 F1 flight debrief (2026-08-24).

## Evidence

- `.flightops/agent-crews/behavior-tests-execution.md` — `APPARATUS DISCOVERY` block lists only generic name patterns; no goldfinch-specific notes.
- `tests/behavior/bookmarks-jar-scoping/runs/2026-07-31-19-35-58.md` — "the registered MCP client pointed at a DIFFERENT LIVE BROWSER … the operator's actual browser"; three registrations enumerated.
- `tests/behavior/search-engine-preference/runs/2026-08-24-22-41-08.md` and `tests/behavior/search-engine-upgrade/runs/2026-08-24-23-17-56.md` — Orchestrator Notes and closing summaries recording facts 2–6.
- `src/main/automation/resolve.js:53` — `AUTOMATABLE_MENU_TYPES`.

## Corrective Action

Added a `## Project Apparatus Notes (goldfinch)` section to
`.flightops/agent-crews/behavior-tests-execution.md`, placed immediately
before `## Prompts`, carrying the six items from the Report above as
bullets, each with a repo-relative citation into the evidence runs /
source files (`tests/behavior/bookmarks-jar-scoping/runs/2026-07-31-19-35-58.md`,
`tests/behavior/search-engine-preference/runs/2026-08-24-22-41-08.md`,
`src/renderer/renderer.js`, `src/main/automation/resolve.js:53`).

Added one line to each of the `### Executor: Initial` and
`### Validator: Initial` fenced prompt blocks pointing at the new section
("PROJECT APPARATUS NOTES: read the `Project Apparatus Notes (goldfinch)`
section of this crew file before signalling `[READY]` — in particular the
prohibition on session-registered `mcp__goldfinch*` tools."), inserted
after each prompt's `[READY]`/LIFECYCLE line. No other prompt text, crew
definitions, signal names, or protocol sections were touched.

## Verification

- Read-through: the crew file's Executor and Validator `Initial` prompts
  each reference the `Project Apparatus Notes (goldfinch)` section, and
  that section carries all six items from the squawk's Report, each with
  a citation. The next behavior-test run's crew spawns need no hand-added
  apparatus instructions beyond run-specific keys/ports.
- Structure check: `grep -n '^## \|^### '` over the file shows `## Crew`,
  `## Interaction Protocol`, and `## Prompts` all still present, with
  every existing `###` prompt heading intact and the new
  `## Project Apparatus Notes (goldfinch)` section landing right before
  `## Prompts`. Fenced-block count (`grep -c '^```'`) is 18 before and 18
  after the edit — the two added lines went inside the existing Executor
  and Validator `Initial` fenced blocks, no blocks added or removed.
- `npm run lint` passes clean (doc-only change; no source files touched).

## Sign-Off
*(written at completion)*
**Reviewer**:
**Verdict**:
**Commit**:
