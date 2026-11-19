# Squawk 0221: MCP `pressKey` cannot send PageDown or PageUp

**Status**: completed
**Type**: defect
**Severity**: routine
**Reported**: 2026-11-18
**Completed**: 2026-11-19

## Report
`KEY_MAP` has Home and End but no PageDown/PageUp, so `pressKey(wcId, 'PageDown')` throws "automation: unknown key", although the browser's own sheet keyboard contract uses both. Carried since Mission 09 (maintenance 2026-08-27).

## Evidence
- `src/main/automation/input.js:KEY_MAP` — Tab, Enter, Escape, Space, arrows, Home, End, Delete, Backspace, F6, F5; no PageDown/PageUp.
- `KEY_NAMES` is derived from `KEY_MAP`, so the tool schema follows automatically.

## Corrective Action
Added `PageDown: 'PageDown'` and `PageUp: 'PageUp'` beside Home/End in `src/main/automation/input.js:KEY_MAP` (`KEY_NAMES` and the MCP schema derive from it; the existing `automation-mcp-tools.test.js` derivation pin stays green). `docs/mcp-automation.md` pressKey key list updated. New test in `test/unit/automation-input.test.js` (`keyEvents: PageDown / PageUp ...`). No change to jar-tier suppression.

## Verification
Unit test: `keyEvents('PageDown')` / `('PageUp')` produce the `PageDown`/`PageUp` accelerator events; `docs/mcp-automation.md` key list updated if it enumerates keys.

Ran: `node --test` on automation-input + automation-mcp-tools (169 pass, 0 fail); `npm test` 7380 pass, 0 fail; lint, typecheck, format:check clean.

## Sign-Off
**Reviewer**: Reviewer agent (independent, diff-scoped batch review of the second 2026-11-19 turnaround)
**Verdict**: confirmed, no issues. PageDown and PageUp are in `KEY_MAP`; the new test checks both `keyEvents` and `KEY_NAMES`; the `docs/mcp-automation.md` key list matches. Gates at review: `npm test` 7,388 tests (7,383 pass, 0 fail, 1 skipped — the `jq` test, no `jq` on the dev host — and 4 todo); lint, typecheck and format:check clean.
**Commit**: the `squawk: turnaround 2026-11-19` commit on `squawk/turnaround-2026-11-19-b`
