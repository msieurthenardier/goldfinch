# Squawk 0008: behavior-test crew file lacks the goldfinch apparatus facts every run rediscovers — and the production-browser MCP warning

**Status**: open
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
*(written at completion)*

## Verification
Read-through: the crew file's Executor and Validator Initial prompts reference the apparatus-notes section, and the section carries the six items above. The next behavior-test run's crew spawns need no hand-added apparatus instructions beyond run-specific keys/ports.

## Sign-Off
*(written at completion)*
**Reviewer**:
**Verdict**:
**Commit**:
